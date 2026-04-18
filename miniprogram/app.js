// app.js
const AUTH_ENABLED_KEY = "user_auth_enabled_v1";
const AUTH_SOURCE_KEY = "user_auth_source_v1";
const USER_CACHE_KEY = "user_profile_cloud_v1";
const SENTENCE_STATE_CACHE_KEY = "sentence_state_cache_v1";
const TAB_BAR_ROUTES = ["pages/home/index", "pages/library/index", "pages/word/index", "pages/profile/index"];

function normalizeRoute(route = "") {
  return String(route || "").replace(/^\/+/, "");
}

function normalizeAuthSource(source = {}) {
  const route = normalizeRoute(source.route || source.page || "");
  const params = source.params && typeof source.params === "object" ? source.params : {};
  return {
    route,
    isTab: route ? (typeof source.isTab === "boolean" ? source.isTab : TAB_BAR_ROUTES.includes(route)) : false,
    params,
  };
}

function buildPageUrl(source = {}) {
  const normalized = normalizeAuthSource(source);
  if (!normalized.route) {
    return "/pages/home/index";
  }
  const query = Object.keys(normalized.params).reduce((list, key) => {
    const value = normalized.params[key];
    if (value === undefined || value === null || value === "") {
      return list;
    }
    list.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    return list;
  }, []);
  return `/${normalized.route}${query.length ? `?${query.join("&")}` : ""}`;
}

function sanitizeNickName(value = "") {
  const nickName = String(value || "").trim();
  if (!nickName || nickName === "微信用户") {
    return "";
  }
  return nickName;
}

function sanitizeAvatarUrl(value = "") {
  return String(value || "").trim();
}

function hasCompleteProfile(user = {}) {
  return Boolean(sanitizeNickName(user.nickName) && sanitizeAvatarUrl(user.avatarUrl));
}

function normalizeUser(user = {}) {
  const nickName = sanitizeNickName(user.nickName);
  const avatarUrl = sanitizeAvatarUrl(user.avatarUrl);
  return {
    _id: user._id || "",
    openid: user.openid || "",
    unionid: user.unionid || "",
    nickName,
    avatarUrl: avatarUrl || "/images/icons/avatar.png",
    profileCompleted: hasCompleteProfile({
      nickName,
      avatarUrl,
    }),
    memberStatus: user.memberStatus || "free",
    customWordTagName: "已学",
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

const { normalizeSettings } = require("./utils/settings");

App({
  isAuthenticated() {
    return Boolean(
      this.globalData &&
        this.globalData.authEnabled &&
        this.globalData.user &&
        this.globalData.user.openid
    );
  },

  setAuthSource(source = {}) {
    const normalizedSource = normalizeAuthSource(source);
    if (!normalizedSource.route) {
      return null;
    }
    this.globalData.authSource = normalizedSource;
    wx.setStorageSync(AUTH_SOURCE_KEY, normalizedSource);
    return normalizedSource;
  },

  getAuthSource() {
    if (this.globalData && this.globalData.authSource && this.globalData.authSource.route) {
      return normalizeAuthSource(this.globalData.authSource);
    }
    const cachedSource = wx.getStorageSync(AUTH_SOURCE_KEY) || null;
    return cachedSource && cachedSource.route ? normalizeAuthSource(cachedSource) : null;
  },

  clearAuthSource() {
    if (this.globalData) {
      this.globalData.authSource = null;
    }
    wx.removeStorageSync(AUTH_SOURCE_KEY);
  },

  openPageBySource(source = {}) {
    const normalizedSource = normalizeAuthSource(source);
    const target = normalizedSource.route ? normalizedSource : { route: "pages/home/index", isTab: true, params: {} };
    const url = buildPageUrl(target);
    if (target.isTab) {
      wx.switchTab({
        url,
        fail: (err) => {
          console.error("[app] switchTab target failed", err);
          wx.reLaunch({
            url,
          });
        },
      });
      return;
    }
    wx.redirectTo({
      url,
      fail: (err) => {
        console.error("[app] redirectTo target failed", err);
        wx.reLaunch({
          url,
        });
      },
    });
  },

  returnToAuthSource() {
    const source = this.getAuthSource();
    this.clearAuthSource();
    this.openPageBySource(source || { route: "pages/home/index", isTab: true });
  },

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
    const nickName = sanitizeNickName(safeUserInfo.nickName);
    const avatarUrl = sanitizeAvatarUrl(safeUserInfo.avatarUrl);
    let nextUser = user;
    if (nickName || avatarUrl) {
      const result = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "updateUserProfile",
          nickName,
          avatarUrl,
        },
      });
      nextUser = (result.result && result.result.user) || user;
    }
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

  requireAuth(source = {}) {
    if (this.isAuthenticated()) {
      return true;
    }
    const pages = getCurrentPages();
    const current = pages.length ? pages[pages.length - 1] : null;
    const normalizedSource = normalizeAuthSource({
      route: source.route || source.page || (current && current.route) || "pages/home/index",
      isTab: typeof source.isTab === "boolean" ? source.isTab : undefined,
      params: source.params || {},
    });
    this.redirectToAuthPage(normalizedSource);
    return false;
  },

  redirectToAuthPage(source = {}) {
    const normalizedSource = normalizeAuthSource(source);
    if (normalizedSource.route) {
      this.setAuthSource(normalizedSource);
    }
    const pages = getCurrentPages();
    const current = pages.length ? pages[pages.length - 1] : null;
    if (current && current.route === "pages/auth/index") {
      return;
    }
    if (this.globalData && this.globalData.authPageOpening) {
      return;
    }
    this.globalData.authPageOpening = true;
    wx.navigateTo({
      url: "/pages/auth/index",
      complete: () => {
        this.globalData.authPageOpening = false;
      },
      fail: (err) => {
        console.error("[app] redirectTo auth failed", err);
        wx.redirectTo({
          url: "/pages/auth/index",
          complete: () => {
            this.globalData.authPageOpening = false;
          },
          fail: (redirectErr) => {
            console.error("[app] redirectTo auth fallback failed", redirectErr);
            wx.reLaunch({
              url: "/pages/auth/index",
              complete: () => {
                this.globalData.authPageOpening = false;
              },
              fail: (relaunchErr) => {
                console.error("[app] reLaunch auth failed", relaunchErr);
              },
            });
          },
        });
      },
    });
  },

  onLaunch: function () {
    const cachedSettings = wx.getStorageSync("user_settings_v1") || {};
    const cachedUser = wx.getStorageSync(USER_CACHE_KEY) || null;
    const cachedAuthSource = wx.getStorageSync(AUTH_SOURCE_KEY) || null;
    const authEnabled = wx.getStorageSync(AUTH_ENABLED_KEY);
    const normalizedCachedUser = cachedUser && cachedUser.openid ? normalizeUser(cachedUser) : null;
    this.globalData = {
      // env 参数说明：
      // env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会请求到哪个云环境的资源
      // 此处请填入环境 ID, 环境 ID 可在微信开发者工具右上顶部工具栏点击云开发按钮打开获取
      env: "cloud1-4gsbdd828457096e",
      openid: normalizedCachedUser ? normalizedCachedUser.openid : "",
      user: normalizedCachedUser,
      authSource: cachedAuthSource && cachedAuthSource.route ? normalizeAuthSource(cachedAuthSource) : null,
      authPageOpening: false,
      authEnabled: authEnabled === "" ? Boolean(normalizedCachedUser) : Boolean(authEnabled),
      settings: normalizeSettings(cachedSettings),
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
