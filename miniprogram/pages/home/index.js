const {
  fetchSentences,
  fetchUserStateMap,
  getLocalSentenceStateMap,
  mergeSentencesWithState,
  saveSentenceState,
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
const { consumeSentenceAccess } = require("../../utils/membership");
const { createAudioOwner, playAudio: playGlobalAudio, stopAudio } = require("../../utils/audio-player");

const HOME_IMAGE_HINT_DISMISSED_KEY = "home_image_hint_dismissed_v1";
const AUTO_PLAY_CHINESE_DELAY_MS = 1000;
const HOME_WINDOW_SIZE = 5;

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
    sentences: [],
    counts: {
      total: 0,
      mastered: 0,
      unmastered: 0,
      unlearned: 0,
      favorited: 0,
    },
    currentIndex: 0,
    swiperCurrent: 0,
    currentSentence: null,
    imageHintDismissed: Boolean(wx.getStorageSync(HOME_IMAGE_HINT_DISMISSED_KEY)),
    settings: getSettings(),
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
    this.audioOwner = createAudioOwner("home");
    this.audioRequestId = 0;
    this.autoPlaySequenceId = 0;
    this.autoPlayChineseTimer = null;
    this.initialSentenceAccessDone = false;
    this.initialSentenceAccessPromise = null;
    this.fullSentences = [];
    this.sentenceIndexMap = {};
    this.windowStart = 0;
    // 立即显示加载状态
    this.setData({
      loading: true,
      error: "",
    });
    // 异步加载数据，避免阻塞UI
    setTimeout(() => {
      this.loadPageData({
        showLoading: false, // 已经显示了加载状态
        syncRemoteState: true,
      });
    }, 0);
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
  },

  clearPendingAutoPlaySequence() {
    this.autoPlaySequenceId += 1;
    if (!this.autoPlayChineseTimer) {
      return;
    }
    clearTimeout(this.autoPlayChineseTimer);
    this.autoPlayChineseTimer = null;
  },

  buildSentenceViewModel(sentence, settings) {
    return {
      ...sentence,
      globalIndex: Number(sentence.globalIndex),
      englishTokens: tokenizeSentence(sentence.english),
      showChinese:
        typeof sentence.showChinese === "boolean"
          ? sentence.showChinese
          : Boolean(settings.defaultShowChinese),
      // 解析图片URL，使用缓存
      resolvedImageUrl: resolveImageUrl(sentence),
    };
  },

  onShow() {
    if (!this.fullSentences.length) {
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
      route: "pages/home/index",
      isTab: true,
    });
  },

  refreshPageStateFromLocal() {
    const settings = getSettings();
    const stateMap = getLocalSentenceStateMap();
    this.fullSentences = mergeSentencesWithState(this.fullSentences, stateMap).map((item, index) =>
      this.buildSentenceViewModel(
        {
          ...item,
          globalIndex: index,
        },
        settings
      )
    );
    this.rebuildSentenceIndexMap();
    this.renderVisibleSentenceWindow(this.data.currentIndex, {
      extraData: {
        settings,
        counts: buildCounts(this.fullSentences),
        error: "",
      },
    });
  },

  async loadPageData(options = {}) {
    const syncRemoteState = options.syncRemoteState !== false;

    try {
      const settings = getSettings();
      const rawSentences = await fetchSentences({
        resolveImages: false,
      });
      const stateMap = getLocalSentenceStateMap();
      this.fullSentences = mergeSentencesWithState(rawSentences, stateMap).map((item, index) =>
        this.buildSentenceViewModel(
          {
            ...item,
            globalIndex: index,
          },
          settings
        )
      );
      this.rebuildSentenceIndexMap();
      this.renderVisibleSentenceWindow(this.data.currentIndex, {
        extraData: {
          settings,
          counts: buildCounts(this.fullSentences),
          error: "",
          loading: false,
        },
      });
      this.consumeInitialSentenceAccess();
      if (syncRemoteState) {
        this.syncSentenceStatesFromRemote(rawSentences.map((item) => item._id));
      }
    } catch (err) {
      console.error("[home] loadPageData failed", err);
      this.setData({
        error: "加载失败，请稍后重试",
        loading: false,
      });
    }
  },

  rebuildSentenceIndexMap() {
    this.sentenceIndexMap = this.fullSentences.reduce((map, item, index) => {
      map[item._id] = index;
      return map;
    }, {});
  },

  getSafeActiveIndex(index) {
    if (!this.fullSentences.length) {
      return 0;
    }
    const value = Number(index);
    if (Number.isNaN(value)) {
      return 0;
    }
    return Math.max(0, Math.min(value, this.fullSentences.length - 1));
  },

  buildWindowMeta(centerIndex) {
    const total = this.fullSentences.length;
    const size = Math.min(HOME_WINDOW_SIZE, total);
    const safeIndex = this.getSafeActiveIndex(centerIndex);
    let start = Math.max(0, safeIndex - Math.floor(size / 2));
    const maxStart = Math.max(0, total - size);
    start = Math.min(start, maxStart);
    return {
      start,
      end: start + size,
      current: safeIndex - start,
      safeIndex,
    };
  },

  renderVisibleSentenceWindow(index, options = {}) {
    if (!this.fullSentences.length) {
      this.setData({
        sentences: [],
        currentSentence: null,
        currentIndex: 0,
        swiperCurrent: 0,
        ...(options.extraData || {}),
      });
      return;
    }

    const meta = this.buildWindowMeta(index);
    this.windowStart = meta.start;
    const sentences = this.fullSentences.slice(meta.start, meta.end);
    this.setData({
      sentences,
      currentSentence: sentences[meta.current] || null,
      currentIndex: meta.safeIndex,
      swiperCurrent: meta.current,
      ...(options.extraData || {}),
    }, () => {
      this.ensureVisibleImageUrls();
      if (options.autoPlayAfterRender) {
        this.startAutoPlaySequence();
      }
    });
  },

  setActiveIndex(index, options = {}) {
    if (!this.fullSentences.length) {
      return;
    }
    this.renderVisibleSentenceWindow(index, options);
  },

  async syncSentenceStatesFromRemote(sentenceIds = []) {
    if (!sentenceIds.length || !this.fullSentences.length) {
      return;
    }
    try {
      const stateMap = await fetchUserStateMap(sentenceIds, {
        preferLocal: false,
      });
      const settings = this.data.settings || getSettings();
      this.fullSentences = mergeSentencesWithState(this.fullSentences, stateMap).map((item, index) =>
        this.buildSentenceViewModel(
          {
            ...item,
            globalIndex: index,
          },
          settings
        )
      );
      this.rebuildSentenceIndexMap();
      this.renderVisibleSentenceWindow(this.data.currentIndex, {
        extraData: {
          counts: buildCounts(this.fullSentences),
        },
      });
    } catch (err) {
      console.error("[home] syncSentenceStatesFromRemote failed", err);
    }
  },

  ensureVisibleImageUrls() {
    const { sentences } = this.data;
    if (!sentences.length) {
      return;
    }

    const cloudFileIds = sentences
      .map((item) => item.imageUrl)
      .filter((url) => url && url.startsWith("cloud://"));

    if (cloudFileIds.length) {
      preloadImageUrls(cloudFileIds);
    }

    sentences.forEach((sentence, localIndex) => {
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
          const globalIndex = Number(sentence.globalIndex);
          if (Number.isNaN(globalIndex) || !this.fullSentences[globalIndex]) {
            return;
          }
          this.fullSentences[globalIndex] = {
            ...this.fullSentences[globalIndex],
            resolvedImageUrl: localPath,
          };
          const list = this.data.sentences.slice();
          if (!list[localIndex]) {
            return;
          }
          list[localIndex] = {
            ...list[localIndex],
            resolvedImageUrl: localPath,
          };
          const patch = {
            sentences: list,
          };
          if (this.data.currentSentence && this.data.currentSentence._id === sentence._id) {
            patch.currentSentence = list[localIndex];
          }
          this.setData(patch);
        })
        .catch(() => {});
    });
  },

  // 图片加载完成回调
  onImageLoad(e) {
    // 图片加载完成，可以在这里添加一些优化逻辑
    console.log('Image loaded:', e.detail);
  },

  // 图片加载失败回调
  onImageError(e) {
    console.error('Image load failed:', e.detail);
  },

  updateSentenceAtIndex(index, patch) {
    if (index < 0 || index >= this.fullSentences.length) {
      return null;
    }
    this.fullSentences[index] = {
      ...this.fullSentences[index],
      ...patch,
    };
    this.renderVisibleSentenceWindow(this.data.currentIndex, {
      extraData: {
        counts: buildCounts(this.fullSentences),
      },
    });
    return this.fullSentences[index];
  },

  onSwiperChange(e) {
    const meta = this.buildWindowMeta(this.data.currentIndex);
    if (e.detail.current !== meta.current) {
      this.setData({
        swiperCurrent: meta.current,
      });
    }
  },

  onTapImage(e) {
    if (!this.requireActionAuth()) {
      return;
    }
    const { index } = e.currentTarget.dataset;
    const targetIndex = Number(index);
    if (Number.isNaN(targetIndex)) {
      return;
    }
    const sentence = this.data.sentences[targetIndex];
    if (!sentence) {
      return;
    }
    if (!this.data.imageHintDismissed) {
      wx.setStorageSync(HOME_IMAGE_HINT_DISMISSED_KEY, true);
      this.setData({
        imageHintDismissed: true,
      });
    }
    this.updateSentenceAtIndex(sentence.globalIndex, {
      showChinese: !sentence.showChinese,
    });
  },

  noop() {},

  async ensureSentenceAccess(targetIndex) {
    await this.ensureInitialSentenceAccessReady();
    const sentence = this.fullSentences[targetIndex];
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

  async ensureInitialSentenceAccessReady() {
    if (!this.initialSentenceAccessPromise) {
      return;
    }
    await this.initialSentenceAccessPromise;
  },

  async consumeInitialSentenceAccess() {
    if (this.initialSentenceAccessDone) {
      return;
    }
    if (this.initialSentenceAccessPromise) {
      return this.initialSentenceAccessPromise;
    }
    const app = getApp();
    if (!app || typeof app.isAuthenticated !== "function" || !app.isAuthenticated()) {
      this.initialSentenceAccessDone = true;
      return;
    }
    const firstSentence = this.fullSentences[0];
    if (!firstSentence || !firstSentence._id) {
      this.initialSentenceAccessDone = true;
      return;
    }

    this.initialSentenceAccessPromise = consumeSentenceAccess(firstSentence._id)
      .catch((err) => {
        console.error("[home] consume initial sentence access failed", err);
      })
      .finally(() => {
        this.initialSentenceAccessDone = true;
        this.initialSentenceAccessPromise = null;
      });
    return this.initialSentenceAccessPromise;
  },

  showVipUpgradeDialog() {
    wx.showModal({
      title: "升级 VIP",
      content: "今日免费卡片已用完，升级 VIP 继续查看全部卡片",
      confirmText: "升级 VIP",
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

  onGoBack() {
    if (!this.requireActionAuth()) {
      return;
    }
    const nextIndex = this.data.currentIndex - 1;
    if (nextIndex < 0) {
      wx.showToast({
        title: "已经是第一条",
        icon: "none",
      });
      return;
    }
    this.setActiveIndex(nextIndex, {
      autoPlayAfterRender: this.data.settings.autoPlayAudio,
    });
  },

  async markCurrentSentenceAndAdvance(mastered) {
    if (!this.requireActionAuth()) {
      return;
    }
    const { currentSentence, currentIndex } = this.data;
    if (!currentSentence) {
      return;
    }

    this.updateSentenceAtIndex(currentIndex, {
      mastered,
    });
    await saveSentenceState(currentSentence._id, {
      mastered,
    });

    const nextIndex = currentIndex + 1;
    if (nextIndex >= this.fullSentences.length) {
      wx.showToast({
        title: "已完成全部标记",
        icon: "none",
      });
      return;
    }
    const allowed = await this.ensureSentenceAccess(nextIndex);
    if (!allowed) {
      return;
    }
    this.setActiveIndex(nextIndex, {
      autoPlayAfterRender: this.data.settings.autoPlayAudio,
    });
  },

  async onMarkMastered() {
    await this.markCurrentSentenceAndAdvance(true);
  },

  async onMarkUnmastered() {
    await this.markCurrentSentenceAndAdvance(false);
  },

  async onToggleFavorited() {
    if (!this.requireActionAuth()) {
      return;
    }
    const { currentSentence, currentIndex } = this.data;
    if (!currentSentence) {
      return;
    }
    const nextFavorited = !currentSentence.favorited;
    this.updateSentenceAtIndex(currentIndex, {
      favorited: nextFavorited,
    });
    await saveSentenceState(currentSentence._id, {
      favorited: nextFavorited,
    });
  },

  patchSentenceAudio(sentenceId, audioUrl) {
    if (!sentenceId || !audioUrl) {
      return;
    }
    const targetIndex = this.sentenceIndexMap[sentenceId];
    if (!Number.isInteger(targetIndex) || targetIndex < 0) {
      return;
    }
    this.updateSentenceAtIndex(targetIndex, {
      audioUrl,
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
    if (!this.requireActionAuth()) {
      return;
    }
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
      console.error("[home] sentence audio failed", err);
      wx.showToast({
        title: getAudioErrorMessage(err),
        icon: "none",
      });
    }
  },

  async startAutoPlaySequence() {
    const sentence = this.data.currentSentence;
    if (!sentence) {
      return;
    }

    this.clearPendingAutoPlaySequence();
    const sequenceId = this.autoPlaySequenceId;
    const requestId = this.audioRequestId + 1;
    this.audioRequestId = requestId;

    try {
      const audioUrl = await this.resolveSentenceAudio(sentence);
      if (sequenceId !== this.autoPlaySequenceId || requestId !== this.audioRequestId) {
        return;
      }
      this.playAudio(audioUrl, requestId);
    } catch (err) {
      if (sequenceId !== this.autoPlaySequenceId || requestId !== this.audioRequestId) {
        return;
      }
      console.error("[home] auto sentence audio failed", err);
      wx.showToast({
        title: getAudioErrorMessage(err),
        icon: "none",
      });
      return;
    }

    const chineseText = String(sentence.chinese || "").trim();
    if (!this.data.settings.speakChinese || !chineseText) {
      return;
    }

    this.autoPlayChineseTimer = setTimeout(async () => {
      this.autoPlayChineseTimer = null;
      if (sequenceId !== this.autoPlaySequenceId) {
        return;
      }

      const chineseRequestId = this.audioRequestId + 1;
      this.audioRequestId = chineseRequestId;

      try {
        const chineseAudioUrl = await getChineseTtsPath(chineseText);
        if (sequenceId !== this.autoPlaySequenceId || chineseRequestId !== this.audioRequestId) {
          return;
        }
        this.playAudio(chineseAudioUrl, chineseRequestId);
      } catch (err) {
        if (sequenceId !== this.autoPlaySequenceId || chineseRequestId !== this.audioRequestId) {
          return;
        }
        console.error("[home] auto chinese audio failed", err);
        wx.showToast({
          title: getAudioErrorMessage(err),
          icon: "none",
        });
      }
    }, AUTO_PLAY_CHINESE_DELAY_MS);
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
      console.error("[home] chinese audio failed", err);
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
    const wordKey = normalizeWordKey(word);
    const state = markMap[wordKey] || {};
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
