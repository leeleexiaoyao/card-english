const {
  fetchSentences,
  fetchUserStateMap,
  getLocalSentenceStateMap,
  mergeSentencesWithState,
  saveSentenceState,
  lazyLoadImageUrl,
  preloadImageUrls,
  resolveImageUrl,
} = require("../../utils/sentence-repo");
const { getSettings, updateSettings } = require("../../utils/settings");
const { extractWordsFromSentence, tokenizeSentence } = require("../../utils/word");
const { getWordDetail } = require("../../utils/dictionary");
const {
  batchSetWordCustomTagged,
  DEFAULT_CUSTOM_WORD_TAG_NAME,
  batchGetWordMarks,
  getWordMarkMeta,
  normalizeWordKey,
  setWordMark,
} = require("../../utils/word-mark");
const { getSentenceTtsPath, getChineseTtsPath } = require("../../utils/tts");
const { consumeSentenceAccess } = require("../../utils/membership");
const {
  addAudioEventListener,
  createAudioOwner,
  playAudio: playGlobalAudio,
  stopAudio,
} = require("../../utils/audio-player");

const SENTENCE_DETAIL_CONTEXT_KEY = "sentence_detail_context_v1";
const HOME_IMAGE_HINT_DISMISSED_KEY = "home_image_hint_dismissed_v1";
const AUDIO_AUTO_PLAY_MODE_ORDER = ["off", "single", "five", "loop"];
const AUDIO_AUTO_PLAY_CONFIG = {
  off: {
    enabled: false,
    maxRounds: 0,
  },
  single: {
    enabled: true,
    maxRounds: 1,
  },
  five: {
    enabled: true,
    maxRounds: 5,
  },
  loop: {
    enabled: true,
    maxRounds: Infinity,
  },
};

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

function getEventDataset(event) {
  const detail = (event && event.detail && typeof event.detail === "object") ? event.detail : {};
  const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
  return {
    ...detail,
    ...dataset,
  };
}

function normalizeAudioAutoPlayMode(mode) {
  if (mode === "single" || mode === "five" || mode === "loop" || mode === "off") {
    return mode;
  }
  return "off";
}

function getAudioAutoPlayMode(settings = {}) {
  return normalizeAudioAutoPlayMode(settings.audioAutoPlayMode);
}

function isAutoPlayEnabled(settings = {}) {
  return getAudioAutoPlayMode(settings) !== "off";
}

function getAudioAutoPlayConfig(settings = {}) {
  return AUDIO_AUTO_PLAY_CONFIG[getAudioAutoPlayMode(settings)] || AUDIO_AUTO_PLAY_CONFIG.off;
}

function getNextAudioAutoPlayMode(mode) {
  const currentMode = normalizeAudioAutoPlayMode(mode);
  const currentIndex = AUDIO_AUTO_PLAY_MODE_ORDER.indexOf(currentMode);
  return AUDIO_AUTO_PLAY_MODE_ORDER[(currentIndex + 1) % AUDIO_AUTO_PLAY_MODE_ORDER.length];
}

function getAudioAutoPlayToast(mode) {
  switch (normalizeAudioAutoPlayMode(mode)) {
    case "single":
      return "已开启自动播报";
    case "five":
      return "5次播报";
    case "loop":
      return "循环播报";
    case "off":
    default:
      return "已关闭自动播报";
  }
}

Page({
  data: {
    loading: true,
    error: "",
    sentenceId: "",
    source: "",
    settings: getSettings(),
    sentences: [],
    counts: {
      total: 0,
    },
    currentIndex: 0,
    swiperCurrent: 0,
    currentSentence: null,
    imageHintDismissed: Boolean(wx.getStorageSync(HOME_IMAGE_HINT_DISMISSED_KEY)),
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

  onLoad(options) {
    this.audioOwner = createAudioOwner("sentence_detail");
    this.audioRequestId = 0;
    this.autoPlaySequenceId = 0;
    this.autoPlaySequence = null;
    this.autoPlayChineseTimer = null;
    this.removeAudioEventListener = addAudioEventListener((event) => {
      this.handleAutoPlayAudioEvent(event);
    });
    this.swiperGuarding = false;
    this.setData({
      sentenceId: options.id || "",
      source: options.source || "",
    });
    this.loadPageData({
      showLoading: true,
      syncRemoteState: true,
    });
  },

  onHide() {
    this.clearPendingAutoPlaySequence();
    this.audioRequestId += 1;
    stopAudio(this.audioOwner);
  },

  onUnload() {
    this.clearPendingAutoPlaySequence();
    this.audioRequestId += 1;
    stopAudio(this.audioOwner);
    if (this.removeAudioEventListener) {
      this.removeAudioEventListener();
      this.removeAudioEventListener = null;
    }
  },

  requireActionAuth() {
    const app = getApp();
    if (!app || typeof app.requireAuth !== "function") {
      return true;
    }
    return app.requireAuth({
      route: "pages/sentence-detail/index",
      params: {
        id: this.data.sentenceId,
        source: this.data.source,
      },
    });
  },

  clearPendingAutoPlaySequence() {
    this.autoPlaySequenceId += 1;
    this.autoPlaySequence = null;
    if (!this.autoPlayChineseTimer) {
      return;
    }
    clearTimeout(this.autoPlayChineseTimer);
    this.autoPlayChineseTimer = null;
  },

  isAutoPlaySequenceActive(sequenceId) {
    return Boolean(
      this.autoPlaySequence &&
      this.autoPlaySequence.id === sequenceId &&
      this.autoPlaySequenceId === sequenceId
    );
  },

  isCurrentAutoPlaySentence(sequence) {
    const currentSentence = this.data.currentSentence;
    return Boolean(sequence && currentSentence && currentSentence._id === sequence.sentenceId);
  },

  buildAutoPlaySequence(sentence) {
    const config = getAudioAutoPlayConfig(this.data.settings);
    return {
      id: this.autoPlaySequenceId,
      sentenceId: sentence._id,
      englishText: String(sentence.english || ""),
      audioMode: sentence.audioMode,
      audioUrl: sentence.audioUrl || "",
      round: 1,
      maxRounds: config.maxRounds,
      phase: "english",
    };
  },

  async resolveAutoPlaySentenceAudio(sequence) {
    if (!sequence) {
      return "";
    }
    if (sequence.audioUrl) {
      return sequence.audioUrl;
    }
    const cachedSentence = (this.data.sentences || []).find((item) => item._id === sequence.sentenceId);
    if (cachedSentence && cachedSentence.audioUrl) {
      sequence.audioUrl = cachedSentence.audioUrl;
      return cachedSentence.audioUrl;
    }
    if (sequence.audioMode !== "tts") {
      return "";
    }
    const audioUrl = await getSentenceTtsPath(sequence.englishText);
    this.patchSentenceAudio(sequence.sentenceId, audioUrl);
    if (this.autoPlaySequence && this.autoPlaySequence.id === sequence.id) {
      this.autoPlaySequence.audioUrl = audioUrl;
    }
    return audioUrl;
  },

  async playAutoPlayEnglish(sequence) {
    if (!sequence || !this.isAutoPlaySequenceActive(sequence.id) || !this.isCurrentAutoPlaySentence(sequence)) {
      return;
    }
    this.autoPlaySequence = {
      ...sequence,
      phase: "english",
    };
    const requestId = this.audioRequestId + 1;
    this.audioRequestId = requestId;
    try {
      const audioUrl = await this.resolveAutoPlaySentenceAudio(sequence);
      if (!this.isAutoPlaySequenceActive(sequence.id) || !this.isCurrentAutoPlaySentence(sequence)) {
        return;
      }
      if (!this.playAudio(audioUrl, requestId)) {
        this.clearPendingAutoPlaySequence();
      }
    } catch (err) {
      if (!this.isAutoPlaySequenceActive(sequence.id)) {
        return;
      }
      console.error("[sentence-detail] auto sentence audio failed", err);
      this.clearPendingAutoPlaySequence();
      wx.showToast({
        title: getAudioErrorMessage(err),
        icon: "none",
      });
    }
  },

  async replayAutoPlaySequence(sequenceId) {
    if (!this.isAutoPlaySequenceActive(sequenceId)) {
      return;
    }
    const sequence = this.autoPlaySequence;
    if (!sequence || !this.isCurrentAutoPlaySentence(sequence)) {
      return;
    }
    if (sequence.round >= sequence.maxRounds) {
      this.clearPendingAutoPlaySequence();
      return;
    }
    await this.playAutoPlayEnglish({
      ...sequence,
      round: sequence.round + 1,
      phase: "english",
    });
  },

  handleAutoPlayAudioEvent(event) {
    const sequence = this.autoPlaySequence;
    if (!sequence || !event || event.owner !== this.audioOwner) {
      return;
    }
    if (!this.isAutoPlaySequenceActive(sequence.id) || !this.isCurrentAutoPlaySentence(sequence)) {
      return;
    }
    if (event.type === "error") {
      this.clearPendingAutoPlaySequence();
      return;
    }
    if (event.type !== "ended") {
      return;
    }

    if (sequence.phase === "english") {
      this.replayAutoPlaySequence(sequence.id);
    }
  },

  buildSentenceViewModel(sentence, settings) {
    const showChineseOverride =
      typeof sentence.showChineseOverride === "boolean"
        ? sentence.showChineseOverride
        : null;
    return {
      ...sentence,
      globalIndex: Number(sentence.globalIndex),
      englishTokens: tokenizeSentence(sentence.english),
      showChineseOverride,
      showChinese:
        typeof showChineseOverride === "boolean"
          ? showChineseOverride
          : Boolean(settings.defaultShowChinese),
      resolvedImageUrl: resolveImageUrl(sentence),
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
      counts: {
        total: merged.length,
      },
      sentenceId: sentence ? sentence._id : this.data.sentenceId,
      currentIndex: index,
      swiperCurrent: index,
      currentSentence: sentence,
      error: "",
    }, () => {
      this.ensureVisibleImageUrls(index);
    });
  },

  applyGlobalChineseVisibility(settings) {
    const merged = this.data.sentences.map((item, index) =>
      this.buildSentenceViewModel(
        {
          ...item,
          showChineseOverride: null,
          globalIndex: Number(item.globalIndex >= 0 ? item.globalIndex : index),
        },
        settings
      )
    );
    const sentence = merged[this.data.currentIndex] || null;
    this.setData({
      settings,
      sentences: merged,
      currentSentence: sentence,
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
      const rawSentences = this.resolveScopedSentences(
        await fetchSentences({
          resolveImages: false,
        })
      );
      const stateMap = await fetchUserStateMap(
        rawSentences.map((item) => item._id),
        {
          preferLocal: !syncRemoteState,
        }
      );
      const settings = getSettings();
      const merged = mergeSentencesWithState(rawSentences, stateMap).map((item, index) =>
        this.buildSentenceViewModel(
          {
            ...item,
            globalIndex: index,
          },
          settings
        )
      );
      let index = merged.findIndex((item) => item._id === this.data.sentenceId);
      if (index < 0) {
        index = 0;
      }
      this.setData({
        sentences: merged,
        counts: {
          total: merged.length,
        },
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
    }, () => {
      this.ensureVisibleImageUrls(index);
    });
  },

  ensureVisibleImageUrls(activeIndex = this.data.currentIndex) {
    const { sentences } = this.data;
    if (!sentences.length) {
      return;
    }

    const targetIndexes = Array.from(
      new Set([activeIndex - 1, activeIndex, activeIndex + 1].filter((index) => index >= 0 && index < sentences.length))
    );
    const targetSentences = targetIndexes.map((index) => sentences[index]).filter(Boolean);
    const cloudFileIds = targetSentences
      .map((item) => item.imageUrl)
      .filter((url) => url && url.startsWith("cloud://"));

    if (cloudFileIds.length) {
      preloadImageUrls(cloudFileIds);
    }

    targetSentences.forEach((sentence, targetIndex) => {
      if (!sentence || !sentence.imageUrl || !sentence.imageUrl.startsWith("cloud://")) {
        return;
      }
      const resolved = sentence.resolvedImageUrl || "";
      if (resolved && !resolved.startsWith("cloud://")) {
        return;
      }
      lazyLoadImageUrl(sentence.imageUrl)
        .then((localPath) => {
          if (!localPath || localPath === sentence.resolvedImageUrl) {
            return;
          }
          const list = this.data.sentences.slice();
          const actualIndex = targetIndexes[targetIndex];
          if (!list[actualIndex]) {
            return;
          }
          list[actualIndex] = {
            ...list[actualIndex],
            resolvedImageUrl: localPath,
          };
          const patch = {
            sentences: list,
          };
          if (this.data.currentSentence && this.data.currentSentence._id === sentence._id) {
            patch.currentSentence = list[actualIndex];
          }
          this.setData(patch);
        })
        .catch(() => {});
    });
  },

  onTapImage() {
    const { currentSentence, currentIndex } = this.data;
    if (!currentSentence) {
      return;
    }
    if (!this.data.imageHintDismissed) {
      wx.setStorageSync(HOME_IMAGE_HINT_DISMISSED_KEY, true);
      this.setData({
        imageHintDismissed: true,
      });
    }
    const settings = this.data.settings || getSettings();
    const sentences = this.data.sentences.slice();
    sentences[currentIndex] = this.buildSentenceViewModel(
      {
        ...sentences[currentIndex],
        globalIndex: Number(
          sentences[currentIndex].globalIndex >= 0 ? sentences[currentIndex].globalIndex : currentIndex
        ),
        showChineseOverride: !sentences[currentIndex].showChinese,
      },
      settings
    );
    this.setData({
      sentences,
      currentSentence: sentences[currentIndex],
    });
  },

  noop() {},

  onSwiperChange(e) {
    const nextIndex = e.detail.current;
    const previousIndex = this.data.currentIndex;
    if (nextIndex === previousIndex) {
      return;
    }
    this.handleSwipeToIndex(nextIndex, previousIndex);
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

  async goNext() {
    const nextIndex = this.data.currentIndex + 1;
    if (nextIndex >= this.data.sentences.length) {
      wx.showToast({
        title: "已经是最后一条",
        icon: "none",
      });
      return;
    }
    const allowed = await this.ensureSentenceAccess(nextIndex);
    if (!allowed) {
      return;
    }
    this.setData({
      swiperCurrent: nextIndex,
    });
  },

  async handleSwipeToIndex(nextIndex, previousIndex) {
    if (this.swiperGuarding) {
      return;
    }
    if (nextIndex > previousIndex) {
      const allowed = await this.ensureSentenceAccess(nextIndex);
      if (!allowed) {
        this.swiperGuarding = true;
        this.setData({
          swiperCurrent: previousIndex,
        });
        setTimeout(() => {
          this.swiperGuarding = false;
        }, 0);
        return;
      }
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
    this.ensureVisibleImageUrls(nextIndex);
    if (isAutoPlayEnabled(this.data.settings)) {
      this.startAutoPlaySequence();
    }
  },

  onGoBack() {
    this.goPrev();
  },

  async ensureSentenceAccess(targetIndex) {
    const sentence = this.data.sentences[targetIndex];
    if (!sentence) {
      return false;
    }
    const result = await consumeSentenceAccess(sentence._id);
    if (result && result.success && result.allowed) {
      return true;
    }
    if (!result || !result.success) {
      wx.showToast({
        title: (result && result.errMsg) || "权限校验失败",
        icon: "none",
      });
      return false;
    }
    this.showVipUpgradeDialog();
    return false;
  },

  showVipUpgradeDialog() {
    wx.showModal({
      title: "今日免费卡片已用完",
      content: "开通 VIP，立即解锁全部卡片、无广告体验和学习报告权益",
      confirmText: "立即开通 VIP",
      cancelText: "稍后再说",
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        wx.navigateTo({
          url: "/pages/member-center/index",
        });
      },
    });
  },

  patchCurrentSentence(patch) {
    const { currentIndex, sentences } = this.data;
    if (currentIndex < 0 || currentIndex >= sentences.length) {
      return;
    }
    const settings = this.data.settings || getSettings();
    const list = sentences.slice();
    list[currentIndex] = this.buildSentenceViewModel(
      {
        ...list[currentIndex],
        ...patch,
        globalIndex: Number(list[currentIndex].globalIndex >= 0 ? list[currentIndex].globalIndex : currentIndex),
      },
      settings
    );
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

  async onMarkMastered() {
    const sentence = this.data.currentSentence;
    if (!sentence) {
      return;
    }
    this.patchCurrentSentence({
      mastered: true,
    });
    await saveSentenceState(sentence._id, {
      mastered: true,
    });
    this.syncSentenceWordsAsLearned(sentence);
    if (this.data.currentIndex < this.data.sentences.length - 1) {
      const allowed = await this.ensureSentenceAccess(this.data.currentIndex + 1);
      if (!allowed) {
        return;
      }
      this.setData({
        swiperCurrent: this.data.currentIndex + 1,
      });
    }
  },

  async onMarkUnmastered() {
    const sentence = this.data.currentSentence;
    if (!sentence) {
      return;
    }
    this.patchCurrentSentence({
      mastered: false,
    });
    await saveSentenceState(sentence._id, {
      mastered: false,
    });
    if (this.data.currentIndex < this.data.sentences.length - 1) {
      const allowed = await this.ensureSentenceAccess(this.data.currentIndex + 1);
      if (!allowed) {
        return;
      }
      this.setData({
        swiperCurrent: this.data.currentIndex + 1,
      });
    }
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

  async syncSentenceWordsAsLearned(sentence) {
    const words = Array.from(new Set(extractWordsFromSentence((sentence && sentence.english) || "")));
    if (!words.length) {
      return;
    }
    try {
      const result = await batchSetWordCustomTagged(words, true);
      if (result.failureCount > 0) {
        wx.showToast({
          title: "部分单词已学状态同步失败",
          icon: "none",
        });
      }
    } catch (err) {
      console.error("[sentence-detail] sync sentence words as learned failed", err);
      wx.showToast({
        title: "部分单词已学状态同步失败",
        icon: "none",
      });
    }
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
    this.clearPendingAutoPlaySequence();
    const requestId = this.audioRequestId + 1;
    this.audioRequestId = requestId;
    try {
      const audioUrl = await this.resolveSentenceAudio(sentence);
      this.playAudio(audioUrl, requestId);
    } catch (err) {
      if (requestId !== this.audioRequestId) {
        return;
      }
      console.error("[sentence-detail] sentence audio failed", err);
      wx.showToast({
        title: getAudioErrorMessage(err),
        icon: "none",
      });
    }
  },

  async startAutoPlaySequence() {
    const sentence = this.data.currentSentence;
    if (!sentence || !isAutoPlayEnabled(this.data.settings)) {
      return;
    }

    this.clearPendingAutoPlaySequence();
    const sequence = this.buildAutoPlaySequence(sentence);
    this.autoPlaySequence = sequence;
    await this.playAutoPlayEnglish(sequence);
  },

  async onPlayChineseAudio(e) {
    const { text } = getEventDataset(e);
    const chineseText = String(text || "").trim();
    if (!chineseText) {
      return;
    }
    this.clearPendingAutoPlaySequence();
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
      console.error("[sentence-detail] chinese audio failed", err);
      wx.showToast({
        title: getAudioErrorMessage(err),
        icon: "none",
      });
    }
  },

  onToggleDefaultShowChinese() {
    if (!this.requireActionAuth()) {
      this.setData({
        settings: getSettings(),
      });
      return;
    }
    const nextValue = !Boolean(this.data.settings && this.data.settings.defaultShowChinese);
    const settings = updateSettings({
      defaultShowChinese: nextValue,
    });
    this.applyGlobalChineseVisibility(settings);
    wx.showToast({
      title: nextValue ? "已显示中文" : "已隐藏中文",
      icon: "none",
    });
  },

  onCopyEnglish() {
    if (!this.requireActionAuth()) {
      return;
    }
    const sentence = this.data.currentSentence;
    const english = String((sentence && sentence.english) || "").trim();
    if (!english) {
      wx.showToast({
        title: "复制失败",
        icon: "none",
      });
      return;
    }
    wx.setClipboardData({
      data: english,
      success: () => {
        wx.showToast({
          title: "已复制英文",
          icon: "none",
        });
      },
      fail: () => {
        wx.showToast({
          title: "复制失败",
          icon: "none",
        });
      },
    });
  },

  onCycleAudioPlayMode() {
    if (!this.requireActionAuth()) {
      this.setData({
        settings: getSettings(),
      });
      return;
    }
    const nextMode = getNextAudioAutoPlayMode(this.data.settings && this.data.settings.audioAutoPlayMode);
    const settings = updateSettings({
      audioAutoPlayMode: nextMode,
    });
    this.setData({
      settings,
    });
    this.clearPendingAutoPlaySequence();
    stopAudio(this.audioOwner);
    wx.showToast({
      title: getAudioAutoPlayToast(nextMode),
      icon: "none",
    });
    if (isAutoPlayEnabled(settings)) {
      this.startAutoPlaySequence();
    }
  },

  playAudio(audioUrl, requestId) {
    if (!audioUrl) {
      wx.showToast({
        title: "暂无音频",
        icon: "none",
      });
      return false;
    }
    const activeRequestId = requestId || this.audioRequestId + 1;
    this.audioRequestId = activeRequestId;
    playGlobalAudio({
      src: audioUrl,
      playbackRate: Number(this.data.settings.playRate || 1),
      owner: this.audioOwner,
    });
    return true;
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
    const { word } = getEventDataset(e);
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
    this.clearPendingAutoPlaySequence();
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
      wx.showToast({
        title: nextFavorited ? "已收藏" : "取消收藏",
        icon: "none",
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
      wx.showToast({
        title: nextCustomTagged ? `已加入${this.data.wordMarkMeta.customWordTagName}` : `已移出${this.data.wordMarkMeta.customWordTagName}`,
        icon: "none",
      });
    } catch (err) {
      this.setData({
        wordDetail: detail,
      });
      wx.showToast({
        title: "更新标签失败",
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
