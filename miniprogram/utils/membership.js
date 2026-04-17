const FREE_DAILY_SENTENCE_LIMIT = 2;
const LIFETIME_VIP_PRODUCT_CODE = "lifetime_vip_99";
const LIFETIME_VIP_PRICE_FEN = 9900;

function normalizeMembershipUser(user = {}) {
  return {
    _id: user._id || "",
    openid: user.openid || "",
    nickName: user.nickName || "",
    avatarUrl: user.avatarUrl || "/images/icons/avatar.png",
    profileCompleted: Boolean(user.profileCompleted),
    memberStatus: user.memberStatus || "free",
    customWordTagName: String(user.customWordTagName || "易错词").trim() || "易错词",
    memberPlanCode: user.memberPlanCode || "",
    memberActivatedAt: user.memberActivatedAt || null,
    memberExpireAt: user.memberExpireAt || null,
    dailyQuotaDate: user.dailyQuotaDate || "",
    dailyUnlockedSentenceIds: Array.isArray(user.dailyUnlockedSentenceIds)
      ? user.dailyUnlockedSentenceIds.filter(Boolean)
      : [],
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

function getCurrentDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getAppUser() {
  const app = getApp();
  const user = app && app.globalData ? app.globalData.user : null;
  return normalizeMembershipUser(user || {});
}

function syncAppUser(user = {}) {
  const normalizedUser = normalizeMembershipUser(user);
  const app = getApp();
  if (app && typeof app.setCurrentUser === "function") {
    return app.setCurrentUser(normalizedUser);
  }
  if (app && app.globalData) {
    app.globalData.user = normalizedUser;
  }
  return normalizedUser;
}

function isVipUser(user = {}) {
  return normalizeMembershipUser(user).memberStatus === "vip";
}

async function getCurrentUserMembership(forceRefresh = false) {
  const app = getApp();
  if (app && typeof app.ensureUser === "function") {
    const user = await app.ensureUser(forceRefresh);
    return normalizeMembershipUser(user || {});
  }
  return getAppUser();
}

function getUnlockedSentenceIds(user = {}, dateKey = getCurrentDateKey()) {
  const normalizedUser = normalizeMembershipUser(user);
  if (normalizedUser.dailyQuotaDate !== dateKey) {
    return [];
  }
  return normalizedUser.dailyUnlockedSentenceIds.slice();
}

function getRemainingFreeCount(user = {}, dateKey = getCurrentDateKey()) {
  if (isVipUser(user)) {
    return Number.POSITIVE_INFINITY;
  }
  const unlockedIds = getUnlockedSentenceIds(user, dateKey);
  return Math.max(FREE_DAILY_SENTENCE_LIMIT - unlockedIds.length, 0);
}

async function callMembershipCloud(type, data = {}) {
  try {
    const res = await wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type,
        ...data,
      },
    });
    const result = res.result || {};
    if (result.user) {
      syncAppUser(result.user);
    }
    return result;
  } catch (err) {
    console.error("[membership] cloud call failed", {
      type,
      data,
      err,
    });
    return {
      success: false,
      errMsg: "会员状态校验失败，请稍后重试",
    };
  }
}

async function canAccessSentence(sentenceId, dateKey = getCurrentDateKey()) {
  return await callMembershipCloud("canAccessSentence", {
    sentenceId,
    dateKey,
  });
}

async function consumeSentenceAccess(sentenceId, dateKey = getCurrentDateKey()) {
  return await callMembershipCloud("consumeSentenceAccess", {
    sentenceId,
    dateKey,
  });
}

function compareVersion(v1 = "", v2 = "") {
  const list1 = String(v1).split(".");
  const list2 = String(v2).split(".");
  const maxLength = Math.max(list1.length, list2.length);
  while (list1.length < maxLength) {
    list1.push("0");
  }
  while (list2.length < maxLength) {
    list2.push("0");
  }
  for (let i = 0; i < maxLength; i += 1) {
    const n1 = Number(list1[i]);
    const n2 = Number(list2[i]);
    if (n1 > n2) {
      return 1;
    }
    if (n1 < n2) {
      return -1;
    }
  }
  return 0;
}

function canUseVirtualPayment() {
  if (typeof wx.requestVirtualPayment !== "function") {
    return false;
  }
  const sdkVersion = wx.getSystemInfoSync().SDKVersion || "";
  return compareVersion(sdkVersion, "2.19.2") >= 0 || wx.canIUse("requestVirtualPayment");
}

function getMembershipLabel(user = {}) {
  return isVipUser(user) ? "VIP会员" : "普通用户";
}

module.exports = {
  FREE_DAILY_SENTENCE_LIMIT,
  LIFETIME_VIP_PRODUCT_CODE,
  LIFETIME_VIP_PRICE_FEN,
  normalizeMembershipUser,
  getCurrentDateKey,
  getCurrentUserMembership,
  getUnlockedSentenceIds,
  getRemainingFreeCount,
  syncAppUser,
  isVipUser,
  canAccessSentence,
  consumeSentenceAccess,
  canUseVirtualPayment,
  getMembershipLabel,
};
