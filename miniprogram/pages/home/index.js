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
const { getSentenceTtsPath } = require("../../utils/tts");

const HOME_IMAGE_HINT_DISMISSED_KEY = "home_image_hint_dismissed_v1";

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
  },

  onLoad() {
    this.audioContext = this.createAudioContext();
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
      // 解析图片URL，使用缓存
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
    const counts = buildCounts(merged);
    const previousId = this.data.currentSentence ? this.data.currentSentence._id : "";
    let currentIndex = merged.findIndex((item) => item._id === previousId);
    if (currentIndex < 0) {
      currentIndex = 0;
    }

    this.setData({
      settings,
      sentences: merged,
      counts,
      error: "",
    });
    this.setActiveIndex(currentIndex, false);
  },



  async loadPageData(options = {}) {
    const syncRemoteState = options.syncRemoteState !== false;
    
    try {
      const settings = getSettings();
      
      // 1. 先用仓库层的归一化结果快速首屏，避免直接吃旧缓存里的失效图片地址
      const bootstrapSentences = await fetchSentences({
        resolveImages: false,
      });

      if (bootstrapSentences && bootstrapSentences.length) {
        const stateMap = getLocalSentenceStateMap();
        const merged = mergeSentencesWithState(bootstrapSentences, stateMap).map((item) =>
          this.buildSentenceViewModel(item, settings)
        );
        const counts = buildCounts(merged);
        
        this.setData({
          settings,
          sentences: merged,
          counts,
          error: "",
          loading: false,
        });
        this.setActiveIndex(0, false);
      }
      
      // 2. 异步获取最新数据（包括图片URL和用户状态）
      const freshSentences = await fetchSentences({
        resolveImages: false,
      });
      
      const sentenceIds = freshSentences.map((item) => item._id);
      const stateMap = await fetchUserStateMap(sentenceIds, {
        preferLocal: !syncRemoteState,
      });
      
      const merged = mergeSentencesWithState(freshSentences, stateMap).map((item) =>
        this.buildSentenceViewModel(item, settings)
      );
      const counts = buildCounts(merged);
      const previousId = this.data.currentSentence ? this.data.currentSentence._id : "";
      let currentIndex = merged.findIndex((item) => item._id === previousId);
      if (currentIndex < 0) {
        currentIndex = 0;
      }

      // 3. 更新UI为最新数据
      this.setData({
        settings,
        sentences: merged,
        counts,
        error: "",
        loading: false,
      });
      this.setActiveIndex(currentIndex, false);
    } catch (err) {
      console.error('[home] loadPageData failed', err);
      this.setData({
        error: "加载失败，请稍后重试",
        loading: false,
      });
    }
  },

  setActiveIndex(index, syncSwiper = true) {
    const { sentences } = this.data;
    if (!sentences.length || index < 0 || index >= sentences.length) {
      this.setData({
        currentSentence: null,
      });
      return;
    }

    const nextData = {
      currentIndex: index,
      currentSentence: sentences[index],
    };
    if (syncSwiper) {
      nextData.swiperCurrent = index;
    }
    this.setData(nextData);

    // 懒加载当前及相邻卡片图片，并回写到页面数据
    this.ensureVisibleImageUrls(index);
  },

  ensureVisibleImageUrls(currentIndex) {
    const { sentences } = this.data;
    if (!sentences.length) {
      return;
    }

    const preloadIndexes = [];
    // 只预加载当前和前后 2 张，优先首屏稳定
    for (let i = currentIndex - 2; i <= currentIndex + 2; i++) {
      if (i >= 0 && i < sentences.length) {
        preloadIndexes.push(i);
      }
    }

    const cloudFileIds = preloadIndexes
      .map((index) => sentences[index].imageUrl)
      .filter((url) => url && url.startsWith("cloud://"));

    if (cloudFileIds.length) {
      preloadImageUrls(cloudFileIds);
    }

    preloadIndexes.forEach((targetIndex) => {
      const sentence = this.data.sentences[targetIndex];
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
          if (!list[targetIndex]) {
            return;
          }
          list[targetIndex] = {
            ...list[targetIndex],
            resolvedImageUrl: localPath,
          };
          const patch = {
            sentences: list,
          };
          if (this.data.currentIndex === targetIndex) {
            patch.currentSentence = list[targetIndex];
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
    const { sentences } = this.data;
    if (index < 0 || index >= sentences.length) {
      return null;
    }
    const updated = sentences.slice();
    updated[index] = {
      ...updated[index],
      ...patch,
    };
    this.setData({
      sentences: updated,
      currentSentence: updated[this.data.currentIndex],
      counts: buildCounts(updated),
    });
    return updated[index];
  },

  onSwiperChange(e) {
    const nextIndex = e.detail.current;
    const previousIndex = this.data.currentIndex;
    if (nextIndex === previousIndex) {
      return;
    }

    this.setActiveIndex(nextIndex, false);

    if (this.data.settings.autoPlayAudio) {
      this.onPlaySentenceAudio();
    }
  },

  onTapImage(e) {
    const { index } = e.currentTarget.dataset;
    const targetIndex = Number(index);
    if (Number.isNaN(targetIndex)) {
      return;
    }
    const sentence = this.data.sentences[targetIndex];
    if (!this.data.imageHintDismissed) {
      wx.setStorageSync(HOME_IMAGE_HINT_DISMISSED_KEY, true);
      this.setData({
        imageHintDismissed: true,
      });
    }
    this.updateSentenceAtIndex(targetIndex, {
      showChinese: !sentence.showChinese,
    });
  },

  noop() {},

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

  async onToggleMastered() {
    const { currentSentence, currentIndex, sentences } = this.data;
    if (!currentSentence) {
      return;
    }

    if (currentSentence.mastered) {
      this.updateSentenceAtIndex(currentIndex, {
        mastered: false,
      });
      await saveSentenceState(currentSentence._id, {
        mastered: false,
      });
      return;
    }

    this.updateSentenceAtIndex(currentIndex, {
      mastered: true,
    });
    await saveSentenceState(currentSentence._id, {
      mastered: true,
    });

    if (currentIndex < sentences.length - 1) {
      this.setData({
        swiperCurrent: currentIndex + 1,
      });
    }
  },

  async onToggleFavorited() {
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
    const targetIndex = this.data.sentences.findIndex((item) => item._id === sentenceId);
    if (targetIndex < 0) {
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
    const sentence = this.data.currentSentence;
    if (!sentence) {
      return;
    }
    try {
      const audioUrl = await this.resolveSentenceAudio(sentence);
      this.playAudio(audioUrl);
    } catch (err) {
      console.error("[home] sentence audio failed", err);
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
