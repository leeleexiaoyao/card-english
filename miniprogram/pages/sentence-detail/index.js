const {
  fetchSentences,
  fetchUserStateMap,
  getLocalSentenceStateMap,
  mergeSentencesWithState,
  saveSentenceState,
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
    sentenceId: "",
    source: "",
    settings: getSettings(),
    sentences: [],
    currentIndex: 0,
    swiperCurrent: 0,
    currentSentence: null,
    wordModalVisible: false,
    wordModalLoading: false,
    wordModalError: "",
    wordDetail: null,
  },

  onLoad(options) {
    this.audioContext = this.createAudioContext();
    this.setData({
      sentenceId: options.id || "",
      source: options.source || "",
    });
    this.loadPageData({
      showLoading: true,
      syncRemoteState: true,
    });
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

  buildSentenceViewModel(sentence, settings) {
    return {
      ...sentence,
      englishTokens: tokenizeSentence(sentence.english),
      showChinese:
        typeof sentence.showChinese === "boolean"
          ? sentence.showChinese
          : Boolean(settings.defaultShowChinese),
    };
  },

  onShow() {
    if (!this.data.sentences.length) {
      return;
    }
    this.refreshPageStateFromLocal();
  },

  refreshPageStateFromLocal() {
    const settings = getSettings();
    const stateMap = getLocalSentenceStateMap();
    const merged = mergeSentencesWithState(this.data.sentences, stateMap).map((item) =>
      this.buildSentenceViewModel(item, settings)
    );
    let index = merged.findIndex((item) => item._id === this.data.sentenceId);
    if (index < 0) {
      index = this.data.currentIndex;
    }
    if (index < 0) {
      index = 0;
    }
    const sentence = merged[index] || null;

    this.setData({
      settings,
      sentences: merged,
      sentenceId: sentence ? sentence._id : this.data.sentenceId,
      currentIndex: index,
      swiperCurrent: index,
      currentSentence: sentence,
      error: "",
    });
  },

  resolveScopedSentences(sentences = []) {
    if (this.data.source !== "library") {
      return sentences;
    }
    const context = wx.getStorageSync(SENTENCE_DETAIL_CONTEXT_KEY) || {};
    const ids = Array.isArray(context.ids) ? context.ids : [];
    if (!ids.length) {
      return sentences;
    }
    const sentenceMap = {};
    sentences.forEach((item) => {
      sentenceMap[item._id] = item;
    });
    return ids.map((id) => sentenceMap[id]).filter(Boolean);
  },

  async loadPageData(options = {}) {
    const showLoading = options.showLoading !== false;
    const syncRemoteState = options.syncRemoteState !== false;
    this.setData({
      loading: showLoading,
      error: "",
      settings: getSettings(),
    });
    try {
      const sentences = this.resolveScopedSentences(await fetchSentences());
      const stateMap = await fetchUserStateMap(
        sentences.map((item) => item._id),
        {
          preferLocal: !syncRemoteState,
        }
      );
      const settings = getSettings();
      const merged = mergeSentencesWithState(sentences, stateMap).map((item) =>
        this.buildSentenceViewModel(item, settings)
      );
      let index = merged.findIndex((item) => item._id === this.data.sentenceId);
      if (index < 0) {
        index = 0;
      }
      this.setData({
        sentences: merged,
      });
      this.setCurrentSentence(index);
    } catch (err) {
      this.setData({
        error: "加载失败，请稍后重试",
      });
    } finally {
      if (showLoading) {
        this.setData({
          loading: false,
        });
      }
    }
  },

  setCurrentSentence(index) {
    const { sentences } = this.data;
    if (!sentences.length || index < 0 || index >= sentences.length) {
      this.setData({
        currentSentence: null,
      });
      return;
    }
    const sentence = sentences[index];
    this.setData({
      sentenceId: sentence._id,
      currentIndex: index,
      swiperCurrent: index,
      currentSentence: sentence,
    });
  },

  onTapImage() {
    const { currentSentence, currentIndex } = this.data;
    if (!currentSentence) {
      return;
    }
    const sentences = this.data.sentences.slice();
    sentences[currentIndex] = {
      ...sentences[currentIndex],
      showChinese: !sentences[currentIndex].showChinese,
    };
    this.setData({
      sentences,
      currentSentence: sentences[currentIndex],
    });
  },

  noop() {},

  onSwiperChange(e) {
    const nextIndex = e.detail.current;
    if (nextIndex === this.data.currentIndex) {
      return;
    }
    const sentence = this.data.sentences[nextIndex];
    if (!sentence) {
      return;
    }
    this.setData({
      sentenceId: sentence._id,
      currentIndex: nextIndex,
      currentSentence: sentence,
    });
    if (this.data.settings.autoPlayAudio) {
      this.onPlaySentenceAudio();
    }
  },

  goPrev() {
    const nextIndex = this.data.currentIndex - 1;
    if (nextIndex < 0) {
      wx.showToast({
        title: "已经是第一条",
        icon: "none",
      });
      return;
    }
    this.setData({
      swiperCurrent: nextIndex,
    });
  },

  goNext() {
    const nextIndex = this.data.currentIndex + 1;
    if (nextIndex >= this.data.sentences.length) {
      wx.showToast({
        title: "已经是最后一条",
        icon: "none",
      });
      return;
    }
    this.setData({
      swiperCurrent: nextIndex,
    });
  },

  patchCurrentSentence(patch) {
    const { currentIndex, sentences } = this.data;
    if (currentIndex < 0 || currentIndex >= sentences.length) {
      return;
    }
    const list = sentences.slice();
    list[currentIndex] = {
      ...list[currentIndex],
      ...patch,
    };
    this.setData({
      sentences: list,
      currentSentence: list[currentIndex],
    });
  },

  async onToggleMastered() {
    const sentence = this.data.currentSentence;
    if (!sentence) {
      return;
    }
    const mastered = !sentence.mastered;
    this.patchCurrentSentence({
      mastered,
    });
    await saveSentenceState(sentence._id, {
      mastered,
    });
  },

  async onToggleFavorited() {
    const sentence = this.data.currentSentence;
    if (!sentence) {
      return;
    }
    const favorited = !sentence.favorited;
    this.patchCurrentSentence({
      favorited,
    });
    await saveSentenceState(sentence._id, {
      favorited,
    });
  },

  patchSentenceAudio(sentenceId, audioUrl) {
    if (!sentenceId || !audioUrl) {
      return;
    }
    const updated = this.data.sentences.map((item) => {
      if (item._id !== sentenceId) {
        return item;
      }
      return {
        ...item,
        audioUrl,
      };
    });
    const currentSentence =
      this.data.currentSentence && this.data.currentSentence._id === sentenceId
        ? {
            ...this.data.currentSentence,
            audioUrl,
          }
        : this.data.currentSentence;

    this.setData({
      sentences: updated,
      currentSentence,
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

  async onPlaySentenceAudio() {
    const sentence = this.data.currentSentence;
    if (!sentence) {
      return;
    }
    try {
      const audioUrl = await this.resolveSentenceAudio(sentence);
      this.playAudio(audioUrl);
    } catch (err) {
      console.error("[sentence-detail] sentence audio failed", err);
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
