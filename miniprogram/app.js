// app.js
const AUTH_ENABLED_KEY = "user_auth_enabled_v1";
const USER_CACHE_KEY = "user_profile_cloud_v1";
const SENTENCE_STATE_CACHE_KEY = "sentence_state_cache_v1";

function normalizeUser(user = {}) {
  return {
    _id: user._id || "",
    openid: user.openid || "",
    unionid: user.unionid || "",
    nickName: user.nickName || "",
    avatarUrl: user.avatarUrl || "/images/icons/avatar.png",
    profileCompleted: Boolean(user.profileCompleted),
    memberStatus: user.memberStatus || "free",
    memberPlanCode: user.memberPlanCode || "",
    memberExpireAt: user.memberExpireAt || null,
    memberActivatedAt: user.memberActivatedAt || null,
    dailyQuotaDate: user.dailyQuotaDate || "",
    dailyUnlockedSentenceIds: Array.isArray(user.dailyUnlockedSentenceIds)
      ? user.dailyUnlockedSentenceIds.filter(Boolean)
      : [],
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

App({
  async ensureOpenId(forceRefresh = false) {
    if (!this.globalData.authEnabled) {
      return "";
    }
    const cachedOpenId = !forceRefresh ? wx.getStorageSync("user_openid_v1") : "";
    if (cachedOpenId) {
      this.globalData.openid = cachedOpenId;
      return cachedOpenId;
    }
    if (!wx.cloud || !this.globalData.env) {
      return "";
    }
    try {
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getOpenId",
        },
      });
      const openid = (res.result && res.result.openid) || "";
      if (openid) {
        this.globalData.openid = openid;
        wx.setStorageSync("user_openid_v1", openid);
      }
      return openid;
    } catch (err) {
      return "";
    }
  },

  async ensureUser(forceRefresh = false) {
    if (!this.globalData.authEnabled) {
      return null;
    }
    const cachedUser = !forceRefresh ? wx.getStorageSync(USER_CACHE_KEY) : null;
    if (cachedUser && cachedUser.openid) {
      const normalizedUser = normalizeUser(cachedUser);
      this.globalData.user = normalizedUser;
      this.globalData.openid = normalizedUser.openid;
      return normalizedUser;
    }
    if (!wx.cloud || !this.globalData.env) {
      return null;
    }
    try {
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "login",
        },
      });
      const user = normalizeUser((res.result && res.result.user) || {});
      if (user.openid) {
        this.globalData.user = user;
        this.globalData.openid = user.openid;
        wx.setStorageSync(USER_CACHE_KEY, user);
        wx.setStorageSync("user_openid_v1", user.openid);
        return user;
      }
      return null;
    } catch (err) {
      return null;
    }
  },

  setCurrentUser(user = {}) {
    const normalizedUser = normalizeUser(user);
    this.globalData.user = normalizedUser;
    this.globalData.openid = normalizedUser.openid || "";
    this.globalData.authEnabled = Boolean(normalizedUser.openid);
    wx.setStorageSync(USER_CACHE_KEY, normalizedUser);
    if (normalizedUser.openid) {
      wx.setStorageSync("user_openid_v1", normalizedUser.openid);
      wx.setStorageSync(AUTH_ENABLED_KEY, true);
    }
    return normalizedUser;
  },

  getCachedUser() {
    if (this.globalData && this.globalData.user && this.globalData.user.openid) {
      return this.globalData.user;
    }
    const cachedUser = wx.getStorageSync(USER_CACHE_KEY) || null;
    return cachedUser && cachedUser.openid ? normalizeUser(cachedUser) : null;
  },

  beginLogin() {
    this.globalData.authEnabled = true;
    wx.setStorageSync(AUTH_ENABLED_KEY, true);
    return this.ensureUser(false);
  },

  async completeLoginWithUserProfile(userInfo = {}) {
    const safeUserInfo = userInfo || {};
    const user = await this.beginLogin();
    const result = await wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "updateUserProfile",
        nickName: safeUserInfo.nickName || "微信用户",
        avatarUrl: safeUserInfo.avatarUrl || "",
      },
    });
    const nextUser = (result.result && result.result.user) || user;
    if (nextUser && nextUser.openid) {
      this.setCurrentUser(nextUser);
    }
    return nextUser;
  },

  clearCurrentUser() {
    this.globalData.authEnabled = false;
    this.globalData.user = null;
    this.globalData.openid = "";
    wx.setStorageSync(AUTH_ENABLED_KEY, false);
  },

  onLaunch: function () {
    const cachedSettings = wx.getStorageSync("user_settings_v1") || {};
    const cachedUser = wx.getStorageSync(USER_CACHE_KEY) || null;
    const authEnabled = wx.getStorageSync(AUTH_ENABLED_KEY);
    const normalizedCachedUser = cachedUser && cachedUser.openid ? normalizeUser(cachedUser) : null;
    this.globalData = {
      // env 参数说明：
      // env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会请求到哪个云环境的资源
      // 此处请填入环境 ID, 环境 ID 可在微信开发者工具右上顶部工具栏点击云开发按钮打开获取
      env: "cloud1-4gsbdd828457096e",
      openid: normalizedCachedUser ? normalizedCachedUser.openid : "",
      user: normalizedCachedUser,
      authEnabled: authEnabled === "" ? Boolean(normalizedCachedUser) : Boolean(authEnabled),
      settings: {
        autoPlayAudio: false,
        defaultShowChinese: false,
        playRate: 1,
        voiceGender: "female",
        speechRate: 5,
        ...cachedSettings,
      },
    };
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }

    if (wx.setInnerAudioOption) {
      wx.setInnerAudioOption({
        obeyMuteSwitch: false,
        mixWithOther: true,
      });
    }
  },
});
