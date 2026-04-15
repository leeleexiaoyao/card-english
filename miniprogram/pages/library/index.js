const {
  fetchSentences,
  fetchUserStateMap,
  getLocalSentenceStateMap,
  mergeSentencesWithState,
  buildCounts,
} = require("../../utils/sentence-repo");
const { getSettings } = require("../../utils/settings");
const { tokenizeSentence } = require("../../utils/word");
const { getWordDetail } = require("../../utils/dictionary");
const { getSentenceTtsPath } = require("../../utils/tts");

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
    this.audioContext = this.createAudioContext();
    this.loadData({
      showLoading: true,
      syncRemoteState: true,
    });
  },

  onPullDownRefresh() {
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

  onUnload() {
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

  refreshPageStateFromLocal() {
    const settings = getSettings();
    const stateMap = getLocalSentenceStateMap();
    const allSentences = mergeSentencesWithState(this.data.allSentences, stateMap);
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
      const sentences = await fetchSentences();
      const sentenceIds = sentences.map((item) => item._id);
      const stateMap = await fetchUserStateMap(sentenceIds, {
        preferLocal: !syncRemoteState,
      });
      const allSentences = mergeSentencesWithState(sentences, stateMap);
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
  },

  onChangeFilter(e) {
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
    const { id } = e.currentTarget.dataset;
    const sentence = this.data.filteredSentences.find((item) => item._id === id);
    if (!sentence) {
      return;
    }
    try {
      const audioUrl = await this.resolveSentenceAudio(sentence);
      this.playAudio(audioUrl);
    } catch (err) {
      console.error("[library] sentence audio failed", err);
      wx.showToast({
        title: getAudioErrorMessage(err),
        icon: "none",
      });
    }
  },

  playAudio(audioUrl) {
    if (!audioUrl) {
      wx.showToast({
        title: "暂无音频",
        icon: "none",
      });
      return;
    }
    if (!this.audioContext) {
      this.audioContext = this.createAudioContext();
    }
    this.audioContext.stop();
    this.audioContext.src = audioUrl;
    this.audioContext.playbackRate = Number(this.data.settings.playRate || 1);
    this.audioContext.play();
  },

  async onTapWord(e) {
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
    this.playAudio(e.detail.audio);
  },
});
