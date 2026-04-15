const { getSettings } = require("../../utils/settings");
const {
  clearWordPageCache,
  fetchWordBatch,
  getWordPreview,
  WORD_DEFAULT_PAGE_SIZE,
} = require("../../utils/word-cloud");

Page({
  data: {
    loading: true,
    loadingMore: false,
    error: "",
    settings: getSettings(),
    visibleWords: [],
    page: 0,
    pageSize: WORD_DEFAULT_PAGE_SIZE,
    hasMore: true,
  },

  onLoad() {
    this.audioContext = this.createAudioContext();
    this.loadWords();
  },

  onShow() {
    this.setData({
      settings: getSettings(),
    });
  },

  onPullDownRefresh() {
    this.loadWords({
      forceRefresh: true,
    }).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    this.appendMoreWords();
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
