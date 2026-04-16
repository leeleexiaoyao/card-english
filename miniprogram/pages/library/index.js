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
const { getSentenceTtsPath, getChineseTtsPath } = require("../../utils/tts");
const { createAudioOwner, playAudio: playGlobalAudio, stopAudio } = require("../../utils/audio-player");

const SENTENCE_DETAIL_CONTEXT_KEY = "sentence_detail_context_v1";

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
    allSentences: [],
    filteredSentences: [],
    counts: {
      total: 0,
      mastered: 0,
      unmastered: 0,
      favorited: 0,
    },
    activeFilter: "all",
    displayOptions: {
      image: true,
      english: true,
      chinese: true,
    },
    wordModalVisible: false,
    wordModalLoading: false,
    wordModalError: "",
    wordDetail: null,
  },

  onLoad() {
    this.audioOwner = createAudioOwner("library");
    this.audioRequestId = 0;
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
    if (!this.data.allSentences.length) {
      return;
    }
    this.refreshPageStateFromLocal();
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

  buildSentenceViewModel(sentence) {
    return {
      ...sentence,
      resolvedImageUrl: resolveImageUrl(sentence),
    };
  },

  refreshPageStateFromLocal() {
    const settings = getSettings();
    const stateMap = getLocalSentenceStateMap();
    const allSentences = mergeSentencesWithState(this.data.allSentences, stateMap).map((item) =>
      this.buildSentenceViewModel(item)
    );
    this.setData({
      settings,
      allSentences,
      counts: buildCounts(allSentences),
      error: "",
    });
    this.applyFilter();
  },

  async loadData(options = {}) {
    const showLoading = options.showLoading !== false;
    const syncRemoteState = options.syncRemoteState !== false;
    this.setData({
      loading: showLoading,
      error: "",
      settings: getSettings(),
    });
    try {
      const sentences = await fetchSentences({
        resolveImages: false,
      });
      const sentenceIds = sentences.map((item) => item._id);
      const stateMap = await fetchUserStateMap(sentenceIds, {
        preferLocal: !syncRemoteState,
      });
      const allSentences = mergeSentencesWithState(sentences, stateMap).map((item) =>
        this.buildSentenceViewModel(item)
      );
      this.setData({
        allSentences,
        counts: buildCounts(allSentences),
      });
      this.applyFilter();
    } catch (err) {
      this.setData({
        error: "加载句库失败，请稍后重试",
      });
    } finally {
      if (showLoading) {
        this.setData({
          loading: false,
        });
      }
    }
  },

  applyFilter() {
    const { allSentences, activeFilter } = this.data;
    let list = allSentences.slice();
    if (activeFilter === "mastered") {
      list = list.filter((item) => item.mastered);
    } else if (activeFilter === "unmastered") {
      list = list.filter((item) => !item.mastered);
    } else if (activeFilter === "favorited") {
      list = list.filter((item) => item.favorited);
    }

    this.setData({
      filteredSentences: list.map((item) => ({
        ...item,
        englishTokens: tokenizeSentence(item.english),
      })),
    });
    this.ensurePreviewImageUrls();
  },

  ensurePreviewImageUrls() {
    const previewList = this.data.filteredSentences.slice(0, 12);
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

    const updateList = (list) =>
      list.map((item) => {
        if (item._id !== sentenceId) {
          return item;
        }
        return {
          ...item,
          resolvedImageUrl,
        };
      });

    this.setData({
      allSentences: updateList(this.data.allSentences),
      filteredSentences: updateList(this.data.filteredSentences),
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
    this.applyFilter();
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
      ids: this.data.filteredSentences.map((item) => item._id),
      updatedAt: Date.now(),
    });
    wx.navigateTo({
      url: `/pages/sentence-detail/index?id=${id}&source=library`,
    });
  },

  patchSentenceAudio(sentenceId, audioUrl) {
    if (!sentenceId || !audioUrl) {
      return;
    }
    const updateList = (list) =>
      list.map((item) => {
        if (item._id !== sentenceId) {
          return item;
        }
        return {
          ...item,
          audioUrl,
        };
      });

    this.setData({
      allSentences: updateList(this.data.allSentences),
      filteredSentences: updateList(this.data.filteredSentences),
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
    const sentence = this.data.filteredSentences.find((item) => item._id === id);
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
    });

    try {
      const detail = await getWordDetail(word);
      this.setData({
        wordDetail: detail,
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
    });
  },

  onPlayWordAudio(e) {
    if (!this.requireActionAuth()) {
      return;
    }
    this.playAudio(e.detail.audio);
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
