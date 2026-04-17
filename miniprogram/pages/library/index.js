const {
  fetchSentences,
  fetchUserStateMap,
  getLocalSentenceStateMap,
  mergeSentencesWithState,
  buildCounts,
  lazyLoadImageUrl,
  preloadImageUrls,
  resolveImageUrl,
} = require("../../utils/sentence-repo");
const { getSettings } = require("../../utils/settings");
const { tokenizeSentence } = require("../../utils/word");
const { getWordDetail } = require("../../utils/dictionary");
const {
  DEFAULT_CUSTOM_WORD_TAG_NAME,
  batchGetWordMarks,
  getWordMarkMeta,
  normalizeWordKey,
  setWordMark,
} = require("../../utils/word-mark");
const { getSentenceTtsPath, getChineseTtsPath } = require("../../utils/tts");
const { createAudioOwner, playAudio: playGlobalAudio, stopAudio } = require("../../utils/audio-player");

const SENTENCE_DETAIL_CONTEXT_KEY = "sentence_detail_context_v1";
const LIBRARY_PAGE_SIZE = 30;

function getAudioErrorMessage(err) {
  const message = String((err && err.message) || err || "");
  if (message.includes("url not in domain list") || message.includes("request:fail url not in domain list")) {
    return "请在小程序后台配置 request 域名 tsn.baidu.com";
  }
  if (message.toLowerCase().includes("timeout")) {
    return "音频请求超时，请稍后重试";
  }
  return "句子发音暂不可用";
}

Page({
  data: {
    loading: true,
    error: "",
    settings: getSettings(),
    visibleSentences: [],
    counts: {
      total: 0,
      mastered: 0,
      unmastered: 0,
      unlearned: 0,
      favorited: 0,
    },
    activeFilter: "all",
    displayOptions: {
      image: true,
      english: true,
      chinese: true,
    },
    pageSize: LIBRARY_PAGE_SIZE,
    hasMoreVisible: false,
    loadingMore: false,
    wordModalVisible: false,
    wordModalLoading: false,
    wordModalError: "",
    wordDetail: null,
    wordQuery: "",
    wordMarkMeta: {
      isVip: false,
      customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
    },
  },

  onLoad() {
    this.audioOwner = createAudioOwner("library");
    this.audioRequestId = 0;
    this.fullSentences = [];
    this.filteredSentenceIds = [];
    this.sentenceIndexMap = {};
    this.loadData({
      showLoading: true,
      syncRemoteState: true,
    });
  },

  onPullDownRefresh() {
    if (!this.requireActionAuth()) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadData({
      showLoading: true,
      syncRemoteState: true,
    }).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onShow() {
    if (!this.fullSentences.length) {
      return;
    }
    this.refreshPageStateFromLocal();
  },

  onReachBottom() {
    this.appendVisibleSentences();
  },

  requireActionAuth() {
    const app = getApp();
    if (!app || typeof app.requireAuth !== "function") {
      return true;
    }
    return app.requireAuth({
      route: "pages/library/index",
      isTab: true,
    });
  },

  onHide() {
    this.audioRequestId += 1;
    stopAudio(this.audioOwner);
  },

  onUnload() {
    this.audioRequestId += 1;
    stopAudio(this.audioOwner);
  },

  buildSentenceViewModel(sentence, index, options = {}) {
    const tokenizeForDisplay = Boolean(options.tokenizeForDisplay);
    return {
      ...sentence,
      globalIndex: index,
      resolvedImageUrl: resolveImageUrl(sentence),
      englishTokens: tokenizeForDisplay ? tokenizeSentence(sentence.english) : [],
    };
  },

  rebuildSentenceIndexMap() {
    this.sentenceIndexMap = this.fullSentences.reduce((map, item, index) => {
      map[item._id] = index;
      return map;
    }, {});
  },

  buildFilteredSentenceIds(activeFilter = this.data.activeFilter) {
    return this.fullSentences
      .filter((item) => {
        if (activeFilter === "mastered") {
          return item.mastered === true;
        }
        if (activeFilter === "unmastered") {
          return item.mastered === false;
        }
        if (activeFilter === "unlearned") {
          return item.mastered == null;
        }
        if (activeFilter === "favorited") {
          return item.favorited;
        }
        return true;
      })
      .map((item) => item._id);
  },

  buildVisibleSentenceList(count) {
    return this.filteredSentenceIds
      .slice(0, count)
      .map((id) => {
        const index = this.sentenceIndexMap[id];
        const sentence = this.fullSentences[index];
        if (!sentence) {
          return null;
        }
        return this.buildSentenceViewModel(sentence, index, {
          tokenizeForDisplay: true,
        });
      })
      .filter(Boolean);
  },

  renderVisibleSentences(options = {}) {
    const append = Boolean(options.append);
    const currentCount = append ? this.data.visibleSentences.length : 0;
    const nextCount = Math.min(currentCount + this.data.pageSize, this.filteredSentenceIds.length);
    this.setData({
      visibleSentences: this.buildVisibleSentenceList(nextCount),
      hasMoreVisible: nextCount < this.filteredSentenceIds.length,
      loadingMore: false,
      ...(options.extraData || {}),
    });
    this.ensurePreviewImageUrls();
  },

  refreshPageStateFromLocal() {
    const settings = getSettings();
    const stateMap = getLocalSentenceStateMap();
    this.fullSentences = mergeSentencesWithState(this.fullSentences, stateMap).map((item, index) =>
      this.buildSentenceViewModel(item, index)
    );
    this.rebuildSentenceIndexMap();
    this.filteredSentenceIds = this.buildFilteredSentenceIds(this.data.activeFilter);
    this.renderVisibleSentences({
      extraData: {
        settings,
        counts: buildCounts(this.fullSentences),
        error: "",
      },
    });
  },

  async loadData(options = {}) {
    const showLoading = options.showLoading !== false;
    const syncRemoteState = options.syncRemoteState !== false;
    this.setData({
      loading: showLoading,
      error: "",
      settings: getSettings(),
      loadingMore: false,
    });
    try {
      const sentences = await fetchSentences({
        resolveImages: false,
      });
      const stateMap = getLocalSentenceStateMap();
      this.fullSentences = mergeSentencesWithState(sentences, stateMap).map((item, index) =>
        this.buildSentenceViewModel(item, index)
      );
      this.rebuildSentenceIndexMap();
      this.filteredSentenceIds = this.buildFilteredSentenceIds(this.data.activeFilter);
      this.renderVisibleSentences({
        extraData: {
          counts: buildCounts(this.fullSentences),
          loading: false,
        },
      });
      if (syncRemoteState) {
        this.syncSentenceStatesFromRemote(sentences.map((item) => item._id));
      }
    } catch (err) {
      this.setData({
        error: "加载句库失败，请稍后重试",
        loading: false,
      });
    }
  },

  async syncSentenceStatesFromRemote(sentenceIds = []) {
    if (!sentenceIds.length || !this.fullSentences.length) {
      return;
    }
    try {
      const stateMap = await fetchUserStateMap(sentenceIds, {
        preferLocal: false,
      });
      this.fullSentences = mergeSentencesWithState(this.fullSentences, stateMap).map((item, index) =>
        this.buildSentenceViewModel(item, index)
      );
      this.rebuildSentenceIndexMap();
      this.filteredSentenceIds = this.buildFilteredSentenceIds(this.data.activeFilter);
      this.renderVisibleSentences({
        extraData: {
          counts: buildCounts(this.fullSentences),
        },
      });
    } catch (err) {
      console.error("[library] syncSentenceStatesFromRemote failed", err);
    }
  },

  ensurePreviewImageUrls() {
    const previewList = this.data.visibleSentences.slice(0, 12);
    const cloudFileIds = previewList
      .map((item) => item.imageUrl)
      .filter((url) => url && url.startsWith("cloud://"));

    if (cloudFileIds.length) {
      preloadImageUrls(cloudFileIds);
    }

    previewList.forEach((sentence) => {
      if (!sentence || !sentence.imageUrl || !sentence.imageUrl.startsWith("cloud://")) {
        return;
      }
      if (sentence.resolvedImageUrl && !sentence.resolvedImageUrl.startsWith("cloud://")) {
        return;
      }
      lazyLoadImageUrl(sentence.imageUrl)
        .then((localPath) => {
          if (!localPath || localPath === sentence.resolvedImageUrl) {
            return;
          }
          this.patchSentenceImage(sentence._id, localPath);
        })
        .catch(() => {});
    });
  },

  patchSentenceImage(sentenceId, resolvedImageUrl) {
    if (!sentenceId || !resolvedImageUrl) {
      return;
    }
    const targetIndex = this.sentenceIndexMap[sentenceId];
    if (!Number.isInteger(targetIndex) || !this.fullSentences[targetIndex]) {
      return;
    }
    this.fullSentences[targetIndex] = {
      ...this.fullSentences[targetIndex],
      resolvedImageUrl,
    };
    this.setData({
      visibleSentences: this.data.visibleSentences.map((item) =>
        item._id === sentenceId
          ? {
              ...item,
              resolvedImageUrl,
            }
          : item
      ),
    });
  },

  onChangeFilter(e) {
    if (!this.requireActionAuth()) {
      return;
    }
    const { filter } = e.currentTarget.dataset;
    if (!filter) {
      return;
    }
    this.setData({
      activeFilter: filter,
    });
    this.filteredSentenceIds = this.buildFilteredSentenceIds(filter);
    this.renderVisibleSentences();
  },

  onToggleDisplay(e) {
    if (!this.requireActionAuth()) {
      return;
    }
    const { key } = e.currentTarget.dataset;
    if (!key) {
      return;
    }
    const nextOptions = {
      ...this.data.displayOptions,
      [key]: !this.data.displayOptions[key],
    };
    const enabledCount = Object.keys(nextOptions).filter((item) => nextOptions[item]).length;
    if (!enabledCount) {
      wx.showToast({
        title: "至少显示一项",
        icon: "none",
      });
      return;
    }
    this.setData({
      displayOptions: nextOptions,
    });
  },

  onTapSentenceItem(e) {
    if (!this.requireActionAuth()) {
      return;
    }
    const { id } = e.currentTarget.dataset;
    if (!id) {
      return;
    }
    wx.setStorageSync(SENTENCE_DETAIL_CONTEXT_KEY, {
      source: "library",
      filter: this.data.activeFilter,
      ids: this.filteredSentenceIds.slice(),
      updatedAt: Date.now(),
    });
    wx.navigateTo({
      url: `/pages/sentence-detail/index?id=${id}&source=library`,
    });
  },

  appendVisibleSentences() {
    if (!this.data.hasMoreVisible || this.data.loadingMore) {
      return;
    }
    this.setData({
      loadingMore: true,
    });
    this.renderVisibleSentences({
      append: true,
    });
  },

  patchSentenceAudio(sentenceId, audioUrl) {
    if (!sentenceId || !audioUrl) {
      return;
    }
    const targetIndex = this.sentenceIndexMap[sentenceId];
    if (!Number.isInteger(targetIndex) || !this.fullSentences[targetIndex]) {
      return;
    }
    this.fullSentences[targetIndex] = {
      ...this.fullSentences[targetIndex],
      audioUrl,
    };
    this.setData({
      visibleSentences: this.data.visibleSentences.map((item) =>
        item._id === sentenceId
          ? {
              ...item,
              audioUrl,
            }
          : item
      ),
    });
  },

  async resolveSentenceAudio(sentence) {
    if (!sentence) {
      return "";
    }
    if (sentence.audioUrl) {
      return sentence.audioUrl;
    }
    if (sentence.audioMode !== "tts") {
      return "";
    }
    const audioUrl = await getSentenceTtsPath(sentence.english);
    this.patchSentenceAudio(sentence._id, audioUrl);
    return audioUrl;
  },

  async onPlayAudio(e) {
    if (!this.requireActionAuth()) {
      return;
    }
    const { id } = e.currentTarget.dataset;
    const sentence = this.data.visibleSentences.find((item) => item._id === id);
    if (!sentence) {
      return;
    }
    const requestId = this.audioRequestId + 1;
    this.audioRequestId = requestId;
    try {
      const audioUrl = await this.resolveSentenceAudio(sentence);
      this.playAudio(audioUrl, requestId);
    } catch (err) {
      if (requestId !== this.audioRequestId) {
        return;
      }
      console.error("[library] sentence audio failed", err);
      wx.showToast({
        title: getAudioErrorMessage(err),
        icon: "none",
      });
    }
  },

  async onPlayChineseAudio(e) {
    if (!this.data.settings.speakChinese) {
      return;
    }
    if (!this.requireActionAuth()) {
      return;
    }
    const chineseText = String((e.currentTarget.dataset && e.currentTarget.dataset.text) || "").trim();
    if (!chineseText) {
      return;
    }
    const requestId = this.audioRequestId + 1;
    this.audioRequestId = requestId;
    try {
      const audioUrl = await getChineseTtsPath(chineseText);
      if (requestId !== this.audioRequestId) {
        return;
      }
      this.playAudio(audioUrl, requestId);
    } catch (err) {
      if (requestId !== this.audioRequestId) {
        return;
      }
      console.error("[library] chinese audio failed", err);
      wx.showToast({
        title: getAudioErrorMessage(err),
        icon: "none",
      });
    }
  },

  playAudio(audioUrl, requestId) {
    if (!audioUrl) {
      wx.showToast({
        title: "暂无音频",
        icon: "none",
      });
      return;
    }
    const activeRequestId = requestId || this.audioRequestId + 1;
    this.audioRequestId = activeRequestId;
    playGlobalAudio({
      src: audioUrl,
      playbackRate: Number(this.data.settings.playRate || 1),
      owner: this.audioOwner,
    });
  },

  async buildWordModalDetail(word, detail) {
    const [meta, markMap] = await Promise.all([
      getWordMarkMeta(),
      batchGetWordMarks([word], {
        forceRefresh: true,
      }),
    ]);
    const state = markMap[normalizeWordKey(word)] || {};
    return {
      detail: {
        ...detail,
        favorited: Boolean(state.favorited || detail.favorited),
        customTagged: Boolean(state.customTagged || detail.customTagged),
      },
      wordMarkMeta: {
        isVip: Boolean(meta.isVip),
        customWordTagName: meta.customWordTagName || DEFAULT_CUSTOM_WORD_TAG_NAME,
      },
    };
  },

  async onTapWord(e) {
    if (!this.requireActionAuth()) {
      return;
    }
    const { word } = e.currentTarget.dataset;
    if (!word) {
      return;
    }
    this.setData({
      wordModalVisible: true,
      wordModalLoading: true,
      wordModalError: "",
      wordDetail: null,
      wordQuery: word,
    });

    try {
      const detail = await getWordDetail(word);
      const modalData = await this.buildWordModalDetail(word, detail);
      this.setData({
        wordDetail: modalData.detail,
        wordMarkMeta: modalData.wordMarkMeta,
      });
    } catch (err) {
      this.setData({
        wordModalError: "查词失败，请稍后重试",
      });
    } finally {
      this.setData({
        wordModalLoading: false,
      });
    }
  },

  onCloseWordModal() {
    this.setData({
      wordModalVisible: false,
      wordQuery: "",
    });
  },

  onPlayWordAudio(e) {
    if (!this.requireActionAuth()) {
      return;
    }
    this.playAudio(e.detail.audio);
  },

  async onToggleWordFavorite() {
    if (!this.requireActionAuth()) {
      return;
    }
    const detail = this.data.wordDetail;
    if (!detail || !detail.word) {
      return;
    }
    const nextFavorited = !Boolean(detail.favorited);
    this.setData({
      wordDetail: {
        ...detail,
        favorited: nextFavorited,
      },
    });
    try {
      const state = await setWordMark({
        word: detail.word,
        favorited: nextFavorited,
      });
      this.setData({
        wordDetail: {
          ...this.data.wordDetail,
          favorited: Boolean(state.favorited),
          customTagged: Boolean(state.customTagged),
        },
      });
    } catch (err) {
      this.setData({
        wordDetail: detail,
      });
      wx.showToast({
        title: "更新收藏失败",
        icon: "none",
      });
    }
  },

  async onToggleWordCustomTag() {
    if (!this.requireActionAuth()) {
      return;
    }
    if (!this.data.wordMarkMeta.isVip) {
      return;
    }
    const detail = this.data.wordDetail;
    if (!detail || !detail.word) {
      return;
    }
    const nextCustomTagged = !Boolean(detail.customTagged);
    this.setData({
      wordDetail: {
        ...detail,
        customTagged: nextCustomTagged,
      },
    });
    try {
      const state = await setWordMark({
        word: detail.word,
        customTagged: nextCustomTagged,
      });
      this.setData({
        wordDetail: {
          ...this.data.wordDetail,
          favorited: Boolean(state.favorited),
          customTagged: Boolean(state.customTagged),
        },
      });
    } catch (err) {
      this.setData({
        wordDetail: detail,
      });
      wx.showToast({
        title: err.needVip ? "该功能仅限 VIP" : "更新标签失败",
        icon: "none",
      });
    }
  },

  onOpenWordCard(e) {
    if (!this.requireActionAuth()) {
      return;
    }
    const { id } = (e && e.detail) || {};
    if (!id) {
      return;
    }
    this.setData({
      wordModalVisible: false,
    });
    wx.navigateTo({
      url: `/pages/sentence-detail/index?id=${encodeURIComponent(id)}`,
    });
  },
});
