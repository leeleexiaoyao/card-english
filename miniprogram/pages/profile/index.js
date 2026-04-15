const { getSettings, updateSettings } = require("../../utils/settings");
const { clearSentenceCache } = require("../../utils/sentence-repo");
const { WORD_DETAIL_CACHE_KEY } = require("../../utils/dictionary");
const { clearTtsCache } = require("../../utils/tts");

const USER_PROFILE_KEY = "user_profile_v1";
const USER_ROLE_KEY = "user_role_v1";
const RATE_OPTIONS = [0.5, 1, 2];
const SPEECH_RATE_OPTIONS = [
  { label: "慢", value: 3 },
  { label: "标准", value: 5 },
  { label: "稍快", value: 7 },
  { label: "快", value: 9 },
];
const VOICE_GENDER_OPTIONS = [
  { label: "女声", value: "female" },
  { label: "男声", value: "male" },
];

Page({
  data: {
    profile: {
      loggedIn: false,
      nickName: "未登录",
      avatarUrl: "/images/icons/avatar.png",
    },
    userRole: "普通用户",
    settings: getSettings(),
    rateOptions: RATE_OPTIONS,
    playRateLabels: RATE_OPTIONS.map((item) => `${item}x`),
    playRateIndex: 1,
    playRateLabel: "1x",
    speechRateOptions: SPEECH_RATE_OPTIONS,
    speechRateLabels: SPEECH_RATE_OPTIONS.map((item) => item.label),
    speechRateIndex: 1,
    speechRateLabel: "标准",
    voiceGenderOptions: VOICE_GENDER_OPTIONS,
    voiceGenderLabels: VOICE_GENDER_OPTIONS.map((item) => item.label),
    voiceGenderIndex: 0,
    voiceGenderLabel: "女声",
  },

  onShow() {
    this.loadProfile();
    this.loadUserRole();
    const settings = getSettings();
    this.setData({
      settings,
      playRateIndex: this.getPlayRateIndex(settings.playRate),
      playRateLabel: this.getPlayRateLabel(settings.playRate),
      speechRateIndex: this.getSpeechRateIndex(settings.speechRate),
      speechRateLabel: this.getSpeechRateLabel(settings.speechRate),
      voiceGenderIndex: this.getVoiceGenderIndex(settings.voiceGender),
      voiceGenderLabel: this.getVoiceGenderLabel(settings.voiceGender),
    });
  },

  getPlayRateIndex(rate) {
    const index = RATE_OPTIONS.findIndex((item) => item === rate);
    return index >= 0 ? index : 1;
  },

  getPlayRateLabel(rate) {
    const index = this.getPlayRateIndex(rate);
    return this.data.playRateLabels[index];
  },

  getSpeechRateIndex(rate) {
    const index = SPEECH_RATE_OPTIONS.findIndex((item) => item.value === rate);
    return index >= 0 ? index : 1;
  },

  getSpeechRateLabel(rate) {
    const index = this.getSpeechRateIndex(rate);
    return this.data.speechRateLabels[index];
  },

  getVoiceGenderIndex(value) {
    const index = VOICE_GENDER_OPTIONS.findIndex((item) => item.value === value);
    return index >= 0 ? index : 0;
  },

  getVoiceGenderLabel(value) {
    const index = this.getVoiceGenderIndex(value);
    return this.data.voiceGenderLabels[index];
  },

  loadUserRole() {
    this.setData({
      userRole: wx.getStorageSync(USER_ROLE_KEY) || "普通用户",
    });
  },

  loadProfile() {
    const profile = wx.getStorageSync(USER_PROFILE_KEY);
    if (profile && profile.loggedIn) {
      this.setData({
        profile,
      });
      return;
    }
    this.setData({
      profile: {
        loggedIn: false,
        nickName: "未登录",
        avatarUrl: "/images/icons/avatar.png",
      },
    });
  },

  onLoginTap() {
    wx.getUserProfile({
      desc: "用于展示头像和昵称",
      success: (res) => {
        const profile = {
          loggedIn: true,
          nickName: res.userInfo.nickName || "微信用户",
          avatarUrl: res.userInfo.avatarUrl || "/images/icons/avatar.png",
        };
        wx.setStorageSync(USER_PROFILE_KEY, profile);
        this.setData({
          profile,
        });
      },
      fail: () => {
        wx.showToast({
          title: "未授权登录",
          icon: "none",
        });
      },
    });
  },

  onRoleChange(e) {
    const value = e.detail.value === "1" ? "vip" : "普通用户";
    wx.setStorageSync(USER_ROLE_KEY, value);
    this.setData({
      userRole: value,
    });
  },

  onToggleAutoPlay(e) {
    const settings = updateSettings({
      autoPlayAudio: Boolean(e.detail.value),
    });
    this.setData({
      settings,
    });
  },

  onToggleDefaultChinese(e) {
    const settings = updateSettings({
      defaultShowChinese: Boolean(e.detail.value),
    });
    this.setData({
      settings,
    });
  },

  onSelectPlayRate(e) {
    const rate = Number(e.currentTarget.dataset.rate);
    if (!rate) {
      return;
    }
    const settings = updateSettings({
      playRate: rate,
    });
    this.setData({
      settings,
    });
  },

  onPlayRatePickerChange(e) {
    const index = Number(e.detail.value);
    const rate = RATE_OPTIONS[index];
    if (!rate) {
      return;
    }
    const settings = updateSettings({
      playRate: rate,
    });
    this.setData({
      settings,
      playRateIndex: index,
      playRateLabel: this.data.playRateLabels[index],
    });
  },

  onSelectSpeechRate(e) {
    const rate = Number(e.currentTarget.dataset.rate);
    if (!rate) {
      return;
    }
    const settings = updateSettings({
      speechRate: rate,
    });
    this.setData({
      settings,
    });
  },

  onSpeechRatePickerChange(e) {
    const index = Number(e.detail.value);
    const target = SPEECH_RATE_OPTIONS[index];
    if (!target) {
      return;
    }
    const settings = updateSettings({
      speechRate: target.value,
    });
    this.setData({
      settings,
      speechRateIndex: index,
      speechRateLabel: target.label,
    });
  },

  onVoiceGenderPickerChange(e) {
    const index = Number(e.detail.value);
    const target = VOICE_GENDER_OPTIONS[index];
    if (!target) {
      return;
    }
    const settings = updateSettings({
      voiceGender: target.value,
    });
    this.setData({
      settings,
      voiceGenderIndex: index,
      voiceGenderLabel: target.label,
    });
  },

  onClearCache() {
    wx.showModal({
      title: "清除缓存",
      content: "将清理句库缓存、词典缓存和句子 TTS 缓存，但保留学习状态与设置。",
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        clearSentenceCache();
        wx.removeStorageSync(WORD_DETAIL_CACHE_KEY);
        clearTtsCache();
        wx.showToast({
          title: "缓存已清除",
          icon: "success",
        });
      },
    });
  },

  onAboutUs() {
    wx.navigateTo({
      url: "/pages/about/index",
    });
  },
});
