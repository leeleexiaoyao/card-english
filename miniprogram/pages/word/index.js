const { getSettings } = require("../../utils/settings");
const {
  clearWordPageCache,
  fetchWordBatch,
  getWordPreview,
  listMarkedWords,
  WORD_DEFAULT_PAGE_SIZE,
  searchWords,
} = require("../../utils/word-cloud");
const {
  DEFAULT_CUSTOM_WORD_TAG_NAME,
  batchGetWordMarks,
  getWordMarkMeta,
  normalizeWordKey,
} = require("../../utils/word-mark");
const { createAudioOwner, playAudio: playGlobalAudio, stopAudio } = require("../../utils/audio-player");

const SEARCH_DEBOUNCE_MS = 300;
const FILTER_ALL = "all";
const FILTER_CUSTOM_TAGGED = "customTagged";

Page({
  data: {
    loading: true,
    loadingMore: false,
    searching: false,
    error: "",
    settings: getSettings(),
    keyword: "",
    activeFilter: FILTER_ALL,
    counts: {
      total: 0,
      favorited: 0,
      customTagged: 0,
    },
    customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
    visibleWords: [],
    searchResults: [],
    page: 0,
    pageSize: WORD_DEFAULT_PAGE_SIZE,
    hasMore: true,
  },

  async onLoad() {
    this.audioOwner = createAudioOwner("word");
    this.audioRequestId = 0;
    this.searchTimer = null;
    this.searchRequestId = 0;
    await this.syncWordMarkMeta({
      forceRefresh: true,
      skipReload: true,
    });
    this.loadWords();
  },

  onShow() {
    this.setData({
      settings: getSettings(),
    });
    this.syncWordMarkMeta({
      forceRefresh: false,
      skipReload: true,
    }).then(() => {
      this.refreshCurrentWordMarks();
    });
  },

  requireActionAuth() {
    const app = getApp();
    if (!app || typeof app.requireAuth !== "function") {
      return true;
    }
    return app.requireAuth({
      route: "pages/word/index",
      isTab: true,
    });
  },

  onPullDownRefresh() {
    if (!this.requireActionAuth()) {
      wx.stopPullDownRefresh();
      return;
    }
    const task = this.isSearchMode()
      ? this.executeSearch(String(this.data.keyword || "").trim())
      : this.loadWords({
          forceRefresh: true,
        });
    Promise.resolve(task).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (this.isSearchMode()) {
      return;
    }
    this.appendMoreWords();
  },

  onHide() {
    this.audioRequestId += 1;
    stopAudio(this.audioOwner);
  },

  onUnload() {
    this.clearSearchTimer();
    this.audioRequestId += 1;
    stopAudio(this.audioOwner);
  },

  clearSearchTimer() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  },

  isSearchMode() {
    return Boolean(String(this.data.keyword || "").trim());
  },

  getEffectiveFilter() {
    return this.data.activeFilter;
  },

  async syncWordMarkMeta(options = {}) {
    const forceRefresh = Boolean(options.forceRefresh);
    const skipReload = Boolean(options.skipReload);
    const previousFilter = this.data.activeFilter;
    const meta = await getWordMarkMeta({
      forceRefresh,
    });
    const nextData = {
      customWordTagName: meta.customWordTagName || DEFAULT_CUSTOM_WORD_TAG_NAME,
      counts: {
        total: Number((meta.counts && meta.counts.total) || 0),
        favorited: Number((meta.counts && meta.counts.favorited) || 0),
        customTagged: Number((meta.counts && meta.counts.customTagged) || 0),
      },
    };
    this.setData(nextData);
    if (nextData.activeFilter === FILTER_ALL && previousFilter !== FILTER_ALL && !skipReload && !this.isSearchMode()) {
      await this.loadWords();
    }
    return nextData;
  },

  async decorateWordListWithMarks(list = [], options = {}) {
    if (!Array.isArray(list) || !list.length) {
      return [];
    }
    const marks = await batchGetWordMarks(
      list.map((item) => item.word),
      {
        forceRefresh: Boolean(options.forceRefresh),
      }
    );
    return list.map((item) => {
      const state = marks[normalizeWordKey(item.word)] || {};
      return {
        ...item,
        favorited: Boolean(Object.prototype.hasOwnProperty.call(state, "favorited") ? state.favorited : item.favorited),
        customTagged: Boolean(
          Object.prototype.hasOwnProperty.call(state, "customTagged") ? state.customTagged : item.customTagged
        ),
      };
    });
  },

  async loadWords(options = {}) {
    if (options.forceRefresh) {
      clearWordPageCache();
    }
    this.setData({
      loading: true,
      error: "",
      page: 0,
      hasMore: true,
      settings: getSettings(),
    });
    try {
      const filter = this.getEffectiveFilter();
      const result =
        filter === FILTER_ALL
          ? await fetchWordBatch({
              page: 0,
              pageSize: this.data.pageSize,
              forceRefresh: Boolean(options.forceRefresh),
            })
          : await listMarkedWords({
              filter,
              page: 0,
              pageSize: this.data.pageSize,
            });
      const list = await this.decorateWordListWithMarks(result.list, {
        forceRefresh: Boolean(options.forceRefresh),
      });
      this.setData({
        visibleWords: list,
        page: 1,
        hasMore: result.hasMore,
      });
    } catch (err) {
      this.setData({
        visibleWords: [],
        hasMore: false,
        error: "加载词库失败，请检查 words 集合数据",
      });
    } finally {
      this.setData({
        loading: false,
      });
    }
  },

  async appendMoreWords() {
    if (!this.requireActionAuth()) {
      return;
    }
    const { page, pageSize, hasMore, loadingMore, visibleWords } = this.data;
    if (!hasMore || loadingMore) {
      return;
    }
    this.setData({
      loadingMore: true,
    });
    try {
      const filter = this.getEffectiveFilter();
      const result =
        filter === FILTER_ALL
          ? await fetchWordBatch({
              page,
              pageSize,
            })
          : await listMarkedWords({
              filter,
              page,
              pageSize,
            });
      const appendedList = await this.decorateWordListWithMarks(result.list);
      this.setData({
        visibleWords: visibleWords.concat(appendedList),
        page: page + 1,
        hasMore: result.hasMore,
      });
    } catch (err) {
      wx.showToast({
        title: "加载更多失败",
        icon: "none",
      });
    } finally {
      this.setData({
        loadingMore: false,
      });
    }
  },

  refreshCurrentWordMarks() {
    const requests = [];
    if (this.data.visibleWords.length) {
      requests.push(
        this.decorateWordListWithMarks(this.data.visibleWords).then((visibleWords) => {
          this.setData({
            visibleWords,
          });
        })
      );
    }
    if (this.data.searchResults.length) {
      requests.push(
        this.decorateWordListWithMarks(this.data.searchResults).then((searchResults) => {
          this.setData({
            searchResults,
          });
        })
      );
    }
    return Promise.all(requests);
  },

  onChangeFilter(e) {
    if (!this.requireActionAuth()) {
      return;
    }
    const { filter } = e.currentTarget.dataset;
    if (!filter || filter === this.data.activeFilter) {
      return;
    }
    this.setData({
      activeFilter: filter,
    });
    if (!this.isSearchMode()) {
      this.loadWords();
    }
  },

  onSearchInput(e) {
    if (!this.requireActionAuth()) {
      return;
    }
    const keyword = String((e.detail && e.detail.value) || "");
    this.setData({
      keyword,
    });
    const normalizedKeyword = keyword.trim();
    this.clearSearchTimer();
    if (!normalizedKeyword) {
      this.searchRequestId += 1;
      this.setData({
        searching: false,
        error: "",
        searchResults: [],
      });
      return;
    }
    this.searchTimer = setTimeout(() => {
      this.executeSearch(normalizedKeyword);
    }, SEARCH_DEBOUNCE_MS);
  },

  onSearchConfirm(e) {
    if (!this.requireActionAuth()) {
      return;
    }
    const keyword = String((e.detail && e.detail.value) || this.data.keyword || "").trim();
    this.clearSearchTimer();
    if (!keyword) {
      this.setData({
        keyword: "",
        searching: false,
        error: "",
        searchResults: [],
      });
      return;
    }
    this.executeSearch(keyword);
  },

  onClearSearch() {
    if (!this.requireActionAuth()) {
      return;
    }
    this.clearSearchTimer();
    this.searchRequestId += 1;
    this.setData({
      keyword: "",
      searching: false,
      error: "",
      searchResults: [],
    });
  },

  async executeSearch(keyword) {
    const requestId = this.searchRequestId + 1;
    this.searchRequestId = requestId;
    this.setData({
      searching: true,
      error: "",
    });
    try {
      const result = await searchWords(keyword);
      if (requestId !== this.searchRequestId) {
        return;
      }
      const searchResults = await this.decorateWordListWithMarks(result.list, {
        forceRefresh: true,
      });
      this.setData({
        searchResults,
      });
    } catch (err) {
      if (requestId !== this.searchRequestId) {
        return;
      }
      this.setData({
        searchResults: [],
        error: "搜索失败，请稍后再试",
      });
    } finally {
      if (requestId !== this.searchRequestId) {
        return;
      }
      this.setData({
        searching: false,
      });
    }
  },

  onTapWord(e) {
    if (!this.requireActionAuth()) {
      return;
    }
    const { word } = e.currentTarget.dataset;
    if (!word) {
      return;
    }
    wx.navigateTo({
      url: `/pages/word-detail/index?word=${encodeURIComponent(word)}`,
    });
  },

  async onPlayAudio(e) {
    if (!this.requireActionAuth()) {
      return;
    }
    const { audio, word } = e.currentTarget.dataset;
    let targetAudio = audio;
    const requestId = this.audioRequestId + 1;
    this.audioRequestId = requestId;
    if (!targetAudio && word) {
      try {
        const preview = await getWordPreview(word);
        if (requestId !== this.audioRequestId) {
          return;
        }
        targetAudio = preview.audio;
      } catch (err) {
        if (requestId !== this.audioRequestId) {
          return;
        }
        targetAudio = "";
      }
    }
    if (!targetAudio) {
      wx.showToast({
        title: "暂无音频",
        icon: "none",
      });
      return;
    }
    this.playAudio(targetAudio, requestId);
  },

  playAudio(audioUrl, requestId) {
    const activeRequestId = requestId || this.audioRequestId + 1;
    this.audioRequestId = activeRequestId;
    playGlobalAudio({
      src: audioUrl,
      playbackRate: Number(this.data.settings.playRate || 1),
      owner: this.audioOwner,
    });
  },
});
