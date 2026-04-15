const { getSettings } = require("../../utils/settings");
const {
  clearWordPageCache,
  fetchWordBatch,
  getWordPreview,
  WORD_DEFAULT_PAGE_SIZE,
  searchWords,
} = require("../../utils/word-cloud");

const SEARCH_DEBOUNCE_MS = 300;

Page({
  data: {
    loading: true,
    loadingMore: false,
    searching: false,
    error: "",
    settings: getSettings(),
    keyword: "",
    visibleWords: [],
    searchResults: [],
    page: 0,
    pageSize: WORD_DEFAULT_PAGE_SIZE,
    hasMore: true,
  },

  onLoad() {
    this.audioContext = this.createAudioContext();
    this.searchTimer = null;
    this.searchRequestId = 0;
    this.loadWords();
  },

  onShow() {
    this.setData({
      settings: getSettings(),
    });
  },

  onPullDownRefresh() {
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

  onUnload() {
    this.clearSearchTimer();
    if (this.audioContext) {
      this.audioContext.destroy();
      this.audioContext = null;
    }
  },

  createAudioContext() {
    const audioContext = wx.createInnerAudioContext();
    audioContext.obeyMuteSwitch = false;
    return audioContext;
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
      const result = await fetchWordBatch({
        page: 0,
        pageSize: this.data.pageSize,
        forceRefresh: Boolean(options.forceRefresh),
      });

      this.setData({
        visibleWords: result.list,
        page: 1,
        hasMore: result.hasMore,
      });
    } catch (err) {
      this.setData({
        visibleWords: [],
        hasMore: false,
        error: "加载单词失败，请先把词库导入 words 集合",
      });
    } finally {
      this.setData({
        loading: false,
      });
    }
  },

  async appendMoreWords() {
    const { page, pageSize, hasMore, loadingMore, visibleWords } = this.data;
    if (!hasMore || loadingMore) {
      return;
    }

    this.setData({
      loadingMore: true,
    });

    try {
      const result = await fetchWordBatch({
        page,
        pageSize,
      });

      this.setData({
        visibleWords: visibleWords.concat(result.list),
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

  onSearchInput(e) {
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
      this.setData({
        searchResults: result.list,
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
    const { word } = e.currentTarget.dataset;
    if (!word) {
      return;
    }
    wx.navigateTo({
      url: `/pages/word-detail/index?word=${encodeURIComponent(word)}`,
    });
  },

  async onPlayAudio(e) {
    const { audio, word } = e.currentTarget.dataset;
    let targetAudio = audio;

    if (!targetAudio && word) {
      try {
        const preview = await getWordPreview(word);
        targetAudio = preview.audio;
      } catch (err) {
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

    this.playAudio(targetAudio);
  },

  playAudio(audioUrl) {
    if (!this.audioContext) {
      this.audioContext = this.createAudioContext();
    }
    this.audioContext.stop();
    this.audioContext.src = audioUrl;
    this.audioContext.playbackRate = Number(this.data.settings.playRate || 1);
    this.audioContext.play();
  },
});
