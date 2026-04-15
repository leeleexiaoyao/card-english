const { getSettings } = require("../../utils/settings");
const { getWordDetail } = require("../../utils/dictionary");

Page({
  data: {
    loading: true,
    error: "",
    word: "",
    settings: getSettings(),
    detail: null,
  },

  onLoad(options) {
    this.audioContext = this.createAudioContext();
    const word = decodeURIComponent(options.word || "");
    this.setData({
      word,
    });
    this.loadDetail(word);
  },

  onShow() {
    this.setData({
      settings: getSettings(),
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

  async loadDetail(word) {
    if (!word) {
      this.setData({
        loading: false,
        error: "无效单词",
      });
      return;
    }
    this.setData({
      loading: true,
      error: "",
    });
    try {
      const detail = await getWordDetail(word);
      this.setData({
        detail,
      });
    } catch (err) {
      this.setData({
        error: "获取单词详情失败，请检查 words 集合数据",
      });
    } finally {
      this.setData({
        loading: false,
      });
    }
  },

  onPlayAudio() {
    const detail = this.data.detail;
    if (!detail || !detail.audio) {
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
    this.audioContext.src = detail.audio;
    this.audioContext.playbackRate = Number(this.data.settings.playRate || 1);
    this.audioContext.play();
  },

  onTapRelatedCard(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) {
      return;
    }
    wx.navigateTo({
      url: `/pages/sentence-detail/index?id=${encodeURIComponent(id)}`,
    });
  },
});
