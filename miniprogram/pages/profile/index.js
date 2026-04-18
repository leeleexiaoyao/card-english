const { getSettings, updateSettings } = require("../../utils/settings");
const { clearSentenceCache } = require("../../utils/sentence-repo");
const { WORD_DETAIL_CACHE_KEY } = require("../../utils/dictionary");
const { clearTtsCache } = require("../../utils/tts");
const { DEFAULT_CUSTOM_WORD_TAG_NAME } = require("../../utils/word-mark");
const {
  getMembershipLabel,
  getRemainingFreeCount,
  getCurrentDateKey,
} = require("../../utils/membership");

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
      profileCompleted: false,
      memberStatus: "free",
    },
    profileLoading: false,
    showProfileEditor: false,
    editNickName: "",
    editAvatarUrl: "/images/icons/avatar.png",
    savingProfile: false,
    memberLabel: "普通用户",
    freeRemainingCount: 2,
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
    customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
  },

  onShow() {
    this.loadProfile();
    const settings = getSettings();
    this.setData({
      settings,
      memberLabel: getMembershipLabel(this.data.profile),
      freeRemainingCount: getRemainingFreeCount(this.data.profile, getCurrentDateKey()),
      customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
      playRateIndex: this.getPlayRateIndex(settings.playRate),
      playRateLabel: this.getPlayRateLabel(settings.playRate),
      speechRateIndex: this.getSpeechRateIndex(settings.speechRate),
      speechRateLabel: this.getSpeechRateLabel(settings.speechRate),
      voiceGenderIndex: this.getVoiceGenderIndex(settings.voiceGender),
      voiceGenderLabel: this.getVoiceGenderLabel(settings.voiceGender),
    });
  },

  requireProfileAction() {
    const app = getApp();
    if (!app || typeof app.requireAuth !== "function") {
      return true;
    }
    return app.requireAuth({
      route: "pages/profile/index",
      isTab: true,
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

  buildLoggedOutProfile() {
    return {
      loggedIn: false,
      nickName: "未登录",
      avatarUrl: "/images/icons/avatar.png",
      profileCompleted: false,
      memberStatus: "free",
      customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
      dailyQuotaDate: "",
      dailyUnlockedSentenceIds: [],
    };
  },

  buildProfile(user) {
    const normalizedUser = user || {};
    return {
      loggedIn: Boolean(normalizedUser.openid),
      nickName: normalizedUser.nickName || "微信用户",
      avatarUrl: normalizedUser.avatarUrl || "/images/icons/avatar.png",
      profileCompleted: Boolean(normalizedUser.profileCompleted),
      memberStatus: normalizedUser.memberStatus || "free",
      customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
      dailyQuotaDate: normalizedUser.dailyQuotaDate || "",
      dailyUnlockedSentenceIds: Array.isArray(normalizedUser.dailyUnlockedSentenceIds)
        ? normalizedUser.dailyUnlockedSentenceIds
        : [],
    };
  },

  async resolveAvatarUrl(avatarUrl = "") {
    if (!avatarUrl || !avatarUrl.startsWith("cloud://")) {
      return avatarUrl || "/images/icons/avatar.png";
    }
    try {
      const res = await wx.cloud.getTempFileURL({
        fileList: [avatarUrl],
      });
      const file = (res.fileList || [])[0] || {};
      return file.tempFileURL || "/images/icons/avatar.png";
    } catch (err) {
      return "/images/icons/avatar.png";
    }
  },

  async decorateUser(user) {
    if (!user) {
      return null;
    }
    return {
      ...user,
      avatarUrl: await this.resolveAvatarUrl(user.avatarUrl || ""),
    };
  },

  async loadProfile() {
    this.setData({
      profileLoading: true,
    });
    const app = getApp();
    const authEnabled = Boolean(app && app.globalData && app.globalData.authEnabled);
    if (!authEnabled) {
      this.setData({
        profile: this.buildLoggedOutProfile(),
        memberLabel: getMembershipLabel(null),
        freeRemainingCount: getRemainingFreeCount(null, getCurrentDateKey()),
        showProfileEditor: false,
        editNickName: "",
        editAvatarUrl: "/images/icons/avatar.png",
        customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
        profileLoading: false,
      });
      return;
    }

    try {
      const cachedUser = app && app.globalData ? app.globalData.user : null;
      const user = cachedUser && cachedUser.openid
        ? cachedUser
        : await app.ensureUser();
      const decoratedUser = await this.decorateUser(user);
      this.setData({
        profile: this.buildProfile(decoratedUser),
        memberLabel: getMembershipLabel(decoratedUser),
        freeRemainingCount: getRemainingFreeCount(decoratedUser, getCurrentDateKey()),
        showProfileEditor: Boolean(decoratedUser && !decoratedUser.profileCompleted),
        editNickName: decoratedUser ? decoratedUser.nickName || "" : "",
        editAvatarUrl: decoratedUser ? decoratedUser.avatarUrl || "/images/icons/avatar.png" : "/images/icons/avatar.png",
        customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
      });
    } catch (err) {
      this.setData({
        profile: this.buildLoggedOutProfile(),
        memberLabel: getMembershipLabel(null),
        freeRemainingCount: getRemainingFreeCount(null, getCurrentDateKey()),
        showProfileEditor: false,
        editNickName: "",
        editAvatarUrl: "/images/icons/avatar.png",
        customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
      });
    }

    this.setData({
      profileLoading: false,
    });
  },

  onLoginTap() {
    const app = getApp();
    if (app && typeof app.redirectToAuthPage === "function") {
      app.redirectToAuthPage({
        route: "pages/profile/index",
        isTab: true,
      });
    }
  },

  onChooseAvatar(e) {
    const avatarUrl = (e.detail && e.detail.avatarUrl) || "";
    if (!avatarUrl) {
      return;
    }
    this.setData({
      editAvatarUrl: avatarUrl,
    });
  },

  onNickNameInput(e) {
    this.setData({
      editNickName: String((e.detail && e.detail.value) || ""),
    });
  },

  async onSaveProfile() {
    if (!this.requireProfileAction()) {
      return;
    }
    const app = getApp();
    const currentUser = app && app.globalData ? app.globalData.user : null;
    if (!currentUser || !currentUser.openid) {
      wx.showToast({
        title: "请先登录",
        icon: "none",
      });
      return;
    }

    const nickName = String(this.data.editNickName || "").trim();
    if (!nickName) {
      wx.showToast({
        title: "请输入昵称",
        icon: "none",
      });
      return;
    }

    this.setData({
      savingProfile: true,
    });
    wx.showLoading({
      title: "保存中",
      mask: true,
    });

    try {
      let avatarUrl = this.data.editAvatarUrl || "/images/icons/avatar.png";
      if (avatarUrl.indexOf("/images/") === 0) {
        avatarUrl = "";
      } else if (avatarUrl && !avatarUrl.startsWith("cloud://") && !avatarUrl.startsWith("http")) {
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `avatars/${currentUser.openid}-${Date.now()}.png`,
          filePath: avatarUrl,
        });
        avatarUrl = uploadRes.fileID || avatarUrl;
      }

      const result = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "updateUserProfile",
          nickName,
          avatarUrl,
        },
      });
      const user = (result.result && result.result.user) || null;
      if (app && typeof app.setCurrentUser === "function" && user) {
        app.setCurrentUser(user);
      }
      const decoratedUser = await this.decorateUser(user);
      this.setData({
        profile: this.buildProfile(decoratedUser),
        memberLabel: getMembershipLabel(decoratedUser),
        freeRemainingCount: getRemainingFreeCount(decoratedUser, getCurrentDateKey()),
        showProfileEditor: false,
        editNickName: decoratedUser ? decoratedUser.nickName || "" : "",
        editAvatarUrl: decoratedUser ? decoratedUser.avatarUrl || "/images/icons/avatar.png" : "/images/icons/avatar.png",
        customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
      });
      wx.showToast({
        title: "资料已保存",
        icon: "success",
      });
    } catch (err) {
      wx.showToast({
        title: "保存失败",
        icon: "none",
      });
    } finally {
      this.setData({
        savingProfile: false,
      });
      wx.hideLoading();
    }
  },

  onLogoutTap() {
    wx.showModal({
      title: "退出登录",
      content: "",
      confirmText: "退出",
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        const app = getApp();
        app.clearCurrentUser();
        this.setData({
          profile: this.buildLoggedOutProfile(),
          memberLabel: getMembershipLabel(null),
          freeRemainingCount: getRemainingFreeCount(null, getCurrentDateKey()),
          showProfileEditor: false,
          editNickName: "",
          editAvatarUrl: "/images/icons/avatar.png",
          customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
        });
      },
    });
  },

  onToggleAutoPlay(e) {
    if (!this.requireProfileAction()) {
      return;
    }
    const settings = updateSettings({
      autoPlayAudio: Boolean(e.detail.value),
    });
    this.setData({
      settings,
    });
  },

  onToggleSpeakChinese(e) {
    if (!this.requireProfileAction()) {
      return;
    }
    const settings = updateSettings({
      speakChinese: Boolean(e.detail.value),
    });
    this.setData({
      settings,
    });
  },

  onToggleDefaultChinese(e) {
    if (!this.requireProfileAction()) {
      return;
    }
    const settings = updateSettings({
      defaultShowChinese: Boolean(e.detail.value),
    });
    this.setData({
      settings,
    });
  },

  onSelectPlayRate(e) {
    if (!this.requireProfileAction()) {
      return;
    }
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
    if (!this.requireProfileAction()) {
      return;
    }
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
    if (!this.requireProfileAction()) {
      return;
    }
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
    if (!this.requireProfileAction()) {
      return;
    }
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
    if (!this.requireProfileAction()) {
      return;
    }
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
    if (!this.requireProfileAction()) {
      return;
    }
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
    if (!this.requireProfileAction()) {
      return;
    }
    wx.navigateTo({
      url: "/pages/about/index",
    });
  },

  onOpenMemberCenter() {
    if (!this.requireProfileAction()) {
      return;
    }
    wx.navigateTo({
      url: "/pages/member-center/index",
    });
  },
});
