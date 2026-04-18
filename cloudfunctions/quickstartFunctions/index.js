const crypto = require("crypto");
const https = require("https");
const cloud = require("wx-server-sdk");
const vipPaymentConfig = require("./vipPaymentConfig");
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const WORD_COLLECTION = "words";
const WORD_STATE_COLLECTION = "user_word_state";
const USER_COLLECTION = "users";
const MEMBER_ORDER_COLLECTION = "member_orders";
const WORD_QUERY_CHUNK = 100;
const WORD_MAX_LIMIT = 200;
const WORD_SEARCH_LIMIT = 50;
const FREE_DAILY_SENTENCE_LIMIT = 2;
const DEFAULT_MEMBER_STATUS = "free";
const VIP_MEMBER_STATUS = "vip";
const LIFETIME_VIP_PRODUCT_CODE = "lifetime_vip_99";
const VIRTUAL_PAYMENT_MODE = "short_series_goods";
const DEFAULT_CUSTOM_WORD_TAG_NAME = "已学";

let accessTokenCache = {
  appId: "",
  token: "",
  expiresAt: 0,
};

let visibleWordTotalCache = {
  value: 0,
  expiresAt: 0,
};

function normalizeUserRecord(item = {}) {
  return {
    _id: item._id || "",
    openid: item.openid || "",
    unionid: item.unionid || "",
    nickName: item.nickName || "",
    avatarUrl: item.avatarUrl || "",
    profileCompleted: Boolean(item.profileCompleted),
    memberStatus: item.memberStatus || DEFAULT_MEMBER_STATUS,
    customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
    memberPlanCode: item.memberPlanCode || "",
    memberActivatedAt: item.memberActivatedAt || null,
    memberExpireAt: item.memberExpireAt || null,
    dailyQuotaDate: item.dailyQuotaDate || "",
    dailyUnlockedSentenceIds: Array.isArray(item.dailyUnlockedSentenceIds)
      ? item.dailyUnlockedSentenceIds.filter(Boolean)
      : [],
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}

function normalizeMemberOrderRecord(item = {}) {
  return {
    _id: item._id || "",
    orderNo: item.orderNo || item.order_id || "",
    openid: item.openid || "",
    productCode: item.productCode || item.product_code || "",
    amountFen: Number(item.amountFen || item.amount_fen || 0),
    status: item.status || "created",
    payChannel: item.payChannel || "virtual_payment",
    wxOrderId: item.wxOrderId || item.wx_order_id || "",
    paidAt: item.paidAt || null,
    rawNotify: item.rawNotify || null,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}

function createDefaultUserData({ openid = "", unionid = "" } = {}) {
  return {
    openid,
    unionid,
    nickName: "",
    avatarUrl: "",
    profileCompleted: false,
    memberStatus: DEFAULT_MEMBER_STATUS,
    customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
    memberPlanCode: "",
    memberActivatedAt: null,
    memberExpireAt: null,
    dailyQuotaDate: "",
    dailyUnlockedSentenceIds: [],
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
  };
}

function isVipUser(user = {}) {
  return normalizeUserRecord(user).memberStatus === VIP_MEMBER_STATUS;
}

function sanitizeDateKey(dateKey = "") {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || "").trim())
    ? String(dateKey).trim()
    : "";
}

function getDailyUnlockedSentenceIds(user = {}, dateKey = "") {
  const normalizedUser = normalizeUserRecord(user);
  if (!dateKey || normalizedUser.dailyQuotaDate !== dateKey) {
    return [];
  }
  return normalizedUser.dailyUnlockedSentenceIds.slice();
}

function generateOrderNo() {
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `vip${Date.now()}${randomPart}`;
}

function getVirtualPaymentConfig(appId = "") {
  const productCode = String(vipPaymentConfig.productCode || LIFETIME_VIP_PRODUCT_CODE);
  return {
    appId: String(vipPaymentConfig.appId || appId || ""),
    appSecret: String(vipPaymentConfig.appSecret || ""),
    offerId: String(vipPaymentConfig.offerId || ""),
    appKey: String(vipPaymentConfig.appKey || ""),
    productId: String(vipPaymentConfig.productId || productCode),
    productCode,
    priceFen: Number(vipPaymentConfig.priceFen || 9900),
    env: Number(vipPaymentConfig.env || 0),
  };
}

function validateVirtualPaymentConfig(config = {}) {
  const missing = [];
  ["appId", "appSecret", "offerId", "appKey", "productId"].forEach((field) => {
    if (!config[field]) {
      missing.push(field);
    }
  });
  if (missing.length) {
    return {
      success: false,
      needConfig: true,
      errMsg: `虚拟支付配置不完整，请先填写 ${missing.join("、")}`,
    };
  }
  return {
    success: true,
  };
}

async function ensureCollectionExists(name = "") {
  if (!name) {
    return;
  }
  try {
    await db.createCollection(name);
  } catch (err) {
    const message = String((err && err.errMsg) || err || "");
    const errCode = Number((err && err.errCode) || 0);
    const isExistingCollectionError =
      errCode === -501001 ||
      message.includes("already exists") ||
      message.includes("Table exist") ||
      message.includes("ResourceExist");
    if (!isExistingCollectionError) {
      throw err;
    }
  }
}

function hmacSha256Hex(key = "", message = "") {
  return crypto.createHmac("sha256", key).update(message).digest("hex");
}

function httpsRequest({ url, method = "GET", headers = {}, body = "" }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers,
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = raw ? JSON.parse(raw) : {};
          resolve(parsed);
        } catch (err) {
          resolve({
            raw,
          });
        }
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function getMiniProgramAccessToken(appId = "", appSecret = "") {
  if (
    accessTokenCache.token &&
    accessTokenCache.appId === appId &&
    Date.now() < accessTokenCache.expiresAt
  ) {
    return accessTokenCache.token;
  }

  const result = await httpsRequest({
    url: `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`,
  });
  if (!result || !result.access_token) {
    throw new Error(result.errmsg || "获取 access_token 失败");
  }
  accessTokenCache = {
    appId,
    token: result.access_token,
    expiresAt: Date.now() + Math.max((Number(result.expires_in || 7200) - 300) * 1000, 300000),
  };
  return result.access_token;
}

async function fetchSessionKey({ appId = "", appSecret = "", code = "" }) {
  const result = await httpsRequest({
    url: `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`,
  });
  if (!result || !result.session_key) {
    throw new Error(result.errmsg || "获取 session_key 失败");
  }
  return result.session_key;
}

function buildVipSignData({ config = {}, orderNo = "" }) {
  return {
    offerId: config.offerId,
    buyQuantity: 1,
    env: config.env,
    currencyType: "CNY",
    productId: config.productId,
    goodsPrice: config.priceFen,
    outTradeNo: orderNo,
    attach: JSON.stringify({
      orderNo,
      productCode: config.productCode,
    }),
  };
}

async function createVirtualPaymentArgs({ appId = "", code = "", orderNo = "" }) {
  const config = getVirtualPaymentConfig(appId);
  const configCheck = validateVirtualPaymentConfig(config);
  if (!configCheck.success) {
    return configCheck;
  }
  if (!code) {
    return {
      success: false,
      errMsg: "缺少登录 code",
    };
  }

  const sessionKey = await fetchSessionKey({
    appId: config.appId,
    appSecret: config.appSecret,
    code,
  });
  const signData = buildVipSignData({
    config,
    orderNo,
  });
  const serializedSignData = JSON.stringify(signData);

  return {
    success: true,
    config,
    paymentArgs: {
      signData: serializedSignData,
      paySig: hmacSha256Hex(config.appKey, `requestVirtualPayment&${serializedSignData}`),
      signature: hmacSha256Hex(sessionKey, serializedSignData),
      mode: VIRTUAL_PAYMENT_MODE,
    },
  };
}

async function callVirtualPaymentApi({ path = "", body = {}, appId = "" }) {
  const config = getVirtualPaymentConfig(appId);
  const configCheck = validateVirtualPaymentConfig(config);
  if (!configCheck.success) {
    return configCheck;
  }
  const accessToken = await getMiniProgramAccessToken(config.appId, config.appSecret);
  const serializedBody = JSON.stringify(body);
  const paySig = hmacSha256Hex(config.appKey, `${path}&${serializedBody}`);
  const result = await httpsRequest({
    url: `https://api.weixin.qq.com${path}?access_token=${encodeURIComponent(accessToken)}&pay_sig=${encodeURIComponent(paySig)}`,
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: serializedBody,
  });
  return {
    success: !result.errcode,
    config,
    data: result,
    errMsg: result.errmsg || "",
  };
}

async function notifyProvideGoods({ orderNo = "", wxOrderId = "", appId = "" }) {
  const config = getVirtualPaymentConfig(appId);
  const configCheck = validateVirtualPaymentConfig(config);
  if (!configCheck.success) {
    return configCheck;
  }
  const accessToken = await getMiniProgramAccessToken(config.appId, config.appSecret);
  const body = JSON.stringify({
    order_id: orderNo,
    wx_order_id: wxOrderId || undefined,
    env: config.env,
  });
  const result = await httpsRequest({
    url: `https://api.weixin.qq.com/xpay/notify_provide_goods?access_token=${encodeURIComponent(accessToken)}`,
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body,
  });
  return {
    success: !result.errcode,
    data: result,
    errMsg: result.errmsg || "",
  };
}

async function queryMemberOrderByOrderNo(orderNo = "") {
  if (!orderNo) {
    return null;
  }
  await ensureCollectionExists(MEMBER_ORDER_COLLECTION);
  const res = await db
    .collection(MEMBER_ORDER_COLLECTION)
    .where({
      orderNo,
    })
    .limit(1)
    .get();
  const list = res.data || [];
  return list.length ? normalizeMemberOrderRecord(list[0]) : null;
}

async function updateUserByOpenId(openid = "", patch = {}) {
  if (!openid) {
    return null;
  }
  await db.collection(USER_COLLECTION).where({ openid }).update({
    data: {
      ...patch,
      updatedAt: db.serverDate(),
    },
  });
  return await queryUserByOpenId(openid);
}

async function queryUserByOpenId(openid = "") {
  if (!openid) {
    return null;
  }
  const res = await db
    .collection(USER_COLLECTION)
    .where({
      openid,
    })
    .limit(1)
    .get();
  const list = res.data || [];
  return list.length ? normalizeUserRecord(list[0]) : null;
}

async function queryUserById(id = "") {
  if (!id) {
    return null;
  }
  const res = await db.collection(USER_COLLECTION).doc(id).get();
  return normalizeUserRecord((res && res.data) || {});
}

async function ensureUserRecord() {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || "";
  const unionid = wxContext.UNIONID || "";

  if (!openid) {
    return {
      success: false,
      errMsg: "openid missing",
    };
  }

  const existingUser = await queryUserByOpenId(openid);
  if (existingUser) {
    return {
      success: true,
      isNewUser: false,
      user: existingUser,
    };
  }

  const addRes = await db.collection(USER_COLLECTION).add({
    data: createDefaultUserData({
      openid,
      unionid,
    }),
  });

  const createdUser = await queryUserById(addRes._id);
  return {
    success: true,
    isNewUser: true,
    user: createdUser,
  };
}

const login = async () => {
  return await ensureUserRecord();
};

const updateUserProfile = async (event) => {
  const ensureRes = await ensureUserRecord();
  if (!ensureRes.success || !ensureRes.user || !ensureRes.user.openid) {
    return ensureRes;
  }

  const openid = ensureRes.user.openid;
  const nickName = String(event.nickName || "").trim();
  const avatarUrl = String(event.avatarUrl || "").trim();

  if (!nickName) {
    return {
      success: false,
      errMsg: "nickName is required",
    };
  }

  await db
    .collection(USER_COLLECTION)
    .where({ openid })
    .update({
      data: {
        nickName,
        avatarUrl,
        profileCompleted: true,
        updatedAt: db.serverDate(),
      },
    });

  const user = await queryUserByOpenId(openid);
  return {
    success: true,
    user,
  };
};

const canAccessSentence = async (event) => {
  const ensureRes = await ensureUserRecord();
  if (!ensureRes.success || !ensureRes.user) {
    return ensureRes;
  }
  const user = ensureRes.user;
  const sentenceId = String(event.sentenceId || "").trim();
  const dateKey = sanitizeDateKey(event.dateKey);

  if (!sentenceId) {
    return {
      success: false,
      errMsg: "sentenceId is required",
      user,
    };
  }

  if (isVipUser(user)) {
    return {
      success: true,
      allowed: true,
      user,
      usedCount: 0,
      remainingCount: Number.MAX_SAFE_INTEGER,
      isVip: true,
    };
  }

  const unlockedIds = getDailyUnlockedSentenceIds(user, dateKey);
  const alreadyUnlocked = unlockedIds.includes(sentenceId);
  const usedCount = unlockedIds.length;
  return {
    success: true,
    allowed: alreadyUnlocked || usedCount < FREE_DAILY_SENTENCE_LIMIT,
    user,
    usedCount,
    remainingCount: Math.max(FREE_DAILY_SENTENCE_LIMIT - usedCount, 0),
    alreadyUnlocked,
    isVip: false,
  };
};

const consumeSentenceAccess = async (event) => {
  const ensureRes = await ensureUserRecord();
  if (!ensureRes.success || !ensureRes.user) {
    return ensureRes;
  }

  const sentenceId = String(event.sentenceId || "").trim();
  const dateKey = sanitizeDateKey(event.dateKey);
  if (!sentenceId) {
    return {
      success: false,
      errMsg: "sentenceId is required",
      user: ensureRes.user,
    };
  }
  if (!dateKey) {
    return {
      success: false,
      errMsg: "dateKey is required",
      user: ensureRes.user,
    };
  }

  const currentUser = ensureRes.user;
  if (isVipUser(currentUser)) {
    return {
      success: true,
      allowed: true,
      consumed: false,
      user: currentUser,
      usedCount: 0,
      remainingCount: Number.MAX_SAFE_INTEGER,
      isVip: true,
    };
  }

  const unlockedIds = getDailyUnlockedSentenceIds(currentUser, dateKey);
  if (unlockedIds.includes(sentenceId)) {
    return {
      success: true,
      allowed: true,
      consumed: false,
      user: currentUser,
      usedCount: unlockedIds.length,
      remainingCount: Math.max(FREE_DAILY_SENTENCE_LIMIT - unlockedIds.length, 0),
      alreadyUnlocked: true,
      isVip: false,
    };
  }

  if (unlockedIds.length >= FREE_DAILY_SENTENCE_LIMIT) {
    return {
      success: true,
      allowed: false,
      consumed: false,
      user: currentUser,
      usedCount: unlockedIds.length,
      remainingCount: 0,
      alreadyUnlocked: false,
      isVip: false,
    };
  }

  const nextUnlockedIds = unlockedIds.concat(sentenceId);
  const user = await updateUserByOpenId(currentUser.openid, {
    dailyQuotaDate: dateKey,
    dailyUnlockedSentenceIds: nextUnlockedIds,
  });

  return {
    success: true,
    allowed: true,
    consumed: true,
    user,
    usedCount: nextUnlockedIds.length,
    remainingCount: Math.max(FREE_DAILY_SENTENCE_LIMIT - nextUnlockedIds.length, 0),
    alreadyUnlocked: false,
    isVip: false,
  };
};

async function createMemberOrderRecord({ openid = "", orderNo = "", productCode = "", amountFen = 0 } = {}) {
  await ensureCollectionExists(MEMBER_ORDER_COLLECTION);
  await db.collection(MEMBER_ORDER_COLLECTION).add({
    data: {
      orderNo,
      openid,
      productCode,
      amountFen,
      status: "created",
      payChannel: "virtual_payment",
      wxOrderId: "",
      paidAt: null,
      rawNotify: null,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });
  return await queryMemberOrderByOrderNo(orderNo);
}

async function updateMemberOrder(orderNo = "", patch = {}) {
  await ensureCollectionExists(MEMBER_ORDER_COLLECTION);
  await db.collection(MEMBER_ORDER_COLLECTION).where({ orderNo }).update({
    data: {
      ...patch,
      updatedAt: db.serverDate(),
    },
  });
  return await queryMemberOrderByOrderNo(orderNo);
}

function mapVirtualOrderStatus(status = 0) {
  if ([2, 3, 4].includes(Number(status))) {
    return "paid";
  }
  if ([5, 7, 8].includes(Number(status))) {
    return "refunded";
  }
  if (Number(status) === 6) {
    return "closed";
  }
  return "created";
}

async function applyVipEntitlementForOrder({ orderNo = "", wxOrderId = "", paidAt = null, rawNotify = null, skipRemoteDeliver = false, appId = "" } = {}) {
  const order = await queryMemberOrderByOrderNo(orderNo);
  if (!order) {
    return {
      success: false,
      errMsg: "order not found",
    };
  }

  if (!skipRemoteDeliver) {
    const deliverRes = await notifyProvideGoods({
      orderNo,
      wxOrderId,
      appId,
    });
    if (!deliverRes.success) {
      console.error("[vip] notifyProvideGoods failed", deliverRes);
    }
  }

  const nextOrder = await updateMemberOrder(orderNo, {
    status: "paid",
    wxOrderId: wxOrderId || order.wxOrderId || "",
    paidAt: paidAt || order.paidAt || db.serverDate(),
    rawNotify: rawNotify || order.rawNotify || null,
  });

  const user = await updateUserByOpenId(order.openid, {
    memberStatus: VIP_MEMBER_STATUS,
    memberPlanCode: LIFETIME_VIP_PRODUCT_CODE,
    memberActivatedAt: db.serverDate(),
  });

  return {
    success: true,
    paid: true,
    status: "paid",
    order: nextOrder,
    user,
  };
}

const createVipOrder = async (event) => {
  const ensureRes = await ensureUserRecord();
  if (!ensureRes.success || !ensureRes.user) {
    return ensureRes;
  }
  if (isVipUser(ensureRes.user)) {
    return {
      success: true,
      alreadyVip: true,
      user: ensureRes.user,
    };
  }

  const wxContext = cloud.getWXContext();
  const paymentArgsRes = await createVirtualPaymentArgs({
    appId: wxContext.APPID || "",
    code: String(event.code || "").trim(),
    orderNo: generateOrderNo(),
  });
  if (!paymentArgsRes.success) {
    return paymentArgsRes;
  }

  const orderNo = JSON.parse(paymentArgsRes.paymentArgs.signData).outTradeNo;
  const order = await createMemberOrderRecord({
    openid: ensureRes.user.openid,
    orderNo,
    productCode: paymentArgsRes.config.productCode,
    amountFen: paymentArgsRes.config.priceFen,
  });

  return {
    success: true,
    orderNo,
    order,
    paymentArgs: paymentArgsRes.paymentArgs,
  };
};

const queryVipOrder = async (event) => {
  const ensureRes = await ensureUserRecord();
  if (!ensureRes.success || !ensureRes.user) {
    return ensureRes;
  }
  const orderNo = String(event.orderNo || event.order_id || "").trim();
  if (!orderNo) {
    return {
      success: false,
      errMsg: "orderNo is required",
      user: ensureRes.user,
    };
  }

  const localOrder = await queryMemberOrderByOrderNo(orderNo);
  if (!localOrder || localOrder.openid !== ensureRes.user.openid) {
    return {
      success: false,
      errMsg: "order not found",
      user: ensureRes.user,
    };
  }

  if (localOrder.status === "paid") {
    return {
      success: true,
      paid: true,
      status: "paid",
      order: localOrder,
      user: await queryUserByOpenId(localOrder.openid),
    };
  }

  const wxContext = cloud.getWXContext();
  const remoteRes = await callVirtualPaymentApi({
    path: "/xpay/query_order",
    body: {
      openid: ensureRes.user.openid,
      env: getVirtualPaymentConfig(wxContext.APPID || "").env,
      order_id: orderNo,
    },
    appId: wxContext.APPID || "",
  });
  if (!remoteRes.success) {
    return {
      success: false,
      errMsg: remoteRes.errMsg || "查单失败",
      needConfig: Boolean(remoteRes.needConfig),
      order: localOrder,
      user: ensureRes.user,
    };
  }

  const remoteOrder = (remoteRes.data && remoteRes.data.order) || {};
  const mappedStatus = mapVirtualOrderStatus(remoteOrder.status);
  if (mappedStatus === "paid") {
    return await applyVipEntitlementForOrder({
      orderNo,
      wxOrderId: remoteOrder.wx_order_id || "",
      paidAt: remoteOrder.paid_time || null,
      rawNotify: remoteRes.data,
      appId: wxContext.APPID || "",
    });
  }

  if (mappedStatus !== localOrder.status) {
    const updatedOrder = await updateMemberOrder(orderNo, {
      status: mappedStatus,
      wxOrderId: remoteOrder.wx_order_id || localOrder.wxOrderId || "",
    });
    return {
      success: true,
      paid: false,
      status: mappedStatus,
      order: updatedOrder,
      user: ensureRes.user,
    };
  }

  return {
    success: true,
    paid: false,
    status: localOrder.status,
    order: localOrder,
    user: ensureRes.user,
  };
};

const markVipDelivered = async (event) => {
  const orderNo = String(event.orderNo || event.order_id || event.mchOrderId || "").trim();
  if (!orderNo) {
    return {
      success: false,
      errMsg: "orderNo is required",
    };
  }
  const wxContext = cloud.getWXContext();
  return await applyVipEntitlementForOrder({
    orderNo,
    wxOrderId: String(event.wxOrderId || event.wx_order_id || event.WxOrderId || "").trim(),
    paidAt: event.paidAt || null,
    rawNotify: event.rawNotify || null,
    skipRemoteDeliver: Boolean(event.skipRemoteDeliver),
    appId: wxContext.APPID || "",
  });
};

function parseNotifyPayload(raw = "") {
  const payload = {};
  String(raw || "").replace(/<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>|<(\w+)>(.*?)<\/\3>/g, (_, key1, value1, key2, value2) => {
    const key = key1 || key2;
    const value = value1 || value2 || "";
    if (key && key !== "xml") {
      payload[key] = value;
    }
    return "";
  });
  return payload;
}

const handleVirtualPaymentNotify = async (event) => {
  const payload = event.notifyData || parseNotifyPayload(event.rawBody || event.xml || "");
  const notifyResult = await markVipDelivered({
    orderNo: payload.MchOrderId || payload.order_id || event.orderNo || "",
    wxOrderId: payload.WxOrderId || payload.wx_order_id || "",
    rawNotify: payload,
    skipRemoteDeliver: true,
  });
  if (!notifyResult.success) {
    return {
      ErrCode: 1,
      ErrMsg: notifyResult.errMsg || "failed",
    };
  }
  return {
    ErrCode: 0,
    ErrMsg: "success",
    ...notifyResult,
  };
};

function normalizeWordRecord(item = {}) {
  return {
    _id: item._id || "",
    word: String(item.word || "").trim(),
    phonetic: item.phonetic || "",
    translation: item.translation || "",
    definition: item.definition || "",
    detail: item.detail || "",
    pos: item.pos || "",
    exchange: item.exchange || "",
    audio: item.audio || "",
    collins: Number(item.collins || 0),
    oxford: Number(item.oxford || 0),
    tag: item.tag || "",
    bnc: Number(item.bnc || 0),
    frq: Number(item.frq || 0),
  };
}

function isAffixWordEntry(item = {}) {
  const word = String(item.word || "").trim();
  const text = [
    item.translation || "",
    item.definition || "",
    item.pos || "",
  ].join(" ");

  if (/^-[A-Za-z]+$/.test(word) || /^[A-Za-z]+-$/.test(word)) {
    return true;
  }

  return /(suf\.|pref\.|suffix|prefix|后缀|前缀|词缀)/i.test(text);
}

function isHiddenWordEntry(item = {}) {
  const word = String(item.word || "").trim();
  if (!word) {
    return true;
  }
  if (!/^[A-Za-z]/.test(word)) {
    return true;
  }
  return isAffixWordEntry(item);
}

function normalizeWordKey(word = "") {
  return String(word || "").trim().toLowerCase();
}

function normalizeWordStateRecord(item = {}) {
  const word = String(item.word || "").trim();
  const wordKey = normalizeWordKey(item.wordKey || word);
  return {
    _id: item._id || "",
    openid: item.openid || "",
    word,
    wordKey,
    favorited: Boolean(item.favorited),
    customTagged: Boolean(item.customTagged),
    updatedAt: item.updatedAt || null,
  };
}

function sanitizeCustomWordTagName(raw = "") {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length > 12) {
    return "";
  }
  return trimmed;
}

async function getVisibleWordTotal() {
  const now = Date.now();
  if (visibleWordTotalCache.expiresAt > now && visibleWordTotalCache.value > 0) {
    return visibleWordTotalCache.value;
  }
  let total = 0;
  try {
    const res = await db.collection(WORD_COLLECTION).where({
      word: db.RegExp({
        regexp: "^[A-Za-z]",
        options: "",
      }),
    }).count();
    total = Number(res.total || 0);
  } catch (err) {
    const fallback = await db.collection(WORD_COLLECTION).count();
    total = Number((fallback && fallback.total) || 0);
  }
  visibleWordTotalCache = {
    value: total,
    expiresAt: now + 5 * 60 * 1000,
  };
  return total;
}

async function queryWordStateByWordKeys(openid = "", wordKeys = []) {
  if (!openid || !wordKeys.length) {
    return {};
  }
  await ensureCollectionExists(WORD_STATE_COLLECTION);
  const _ = db.command;
  const map = {};
  const chunkSize = 50;
  for (let i = 0; i < wordKeys.length; i += chunkSize) {
    const chunk = wordKeys.slice(i, i + chunkSize);
    const res = await db
      .collection(WORD_STATE_COLLECTION)
      .where({
        openid,
        wordKey: _.in(chunk),
      })
      .get();
    const list = (res.data || []).map(normalizeWordStateRecord);
    list.forEach((item) => {
      if (!item.wordKey) {
        return;
      }
      map[item.wordKey] = {
        favorited: Boolean(item.favorited),
        customTagged: Boolean(item.customTagged),
      };
    });
  }
  return map;
}

async function queryWordRecordsByWordValues(words = []) {
  if (!words.length) {
    return {};
  }
  const _ = db.command;
  const map = {};
  const chunkSize = 30;
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    const res = await db
      .collection(WORD_COLLECTION)
      .where({
        word: _.in(chunk),
      })
      .field({
        word: true,
        phonetic: true,
        translation: true,
        definition: true,
        detail: true,
        pos: true,
        exchange: true,
        audio: true,
        collins: true,
        oxford: true,
        tag: true,
        bnc: true,
        frq: true,
      })
      .get();
    const list = (res.data || []).map(normalizeWordRecord);
    list.forEach((item) => {
      if (isHiddenWordEntry(item)) {
        return;
      }
      const wordKey = normalizeWordKey(item.word);
      if (!wordKey || map[wordKey]) {
        return;
      }
      map[wordKey] = item;
    });
  }
  return map;
}

const getWordMarkMeta = async () => {
  const ensureRes = await ensureUserRecord();
  if (!ensureRes.success || !ensureRes.user) {
    return {
      success: false,
      errMsg: ensureRes.errMsg || "user unavailable",
    };
  }
  const user = normalizeUserRecord(ensureRes.user);
  const openid = user.openid;
  await ensureCollectionExists(WORD_STATE_COLLECTION);
  const [total, favoritedRes, customTaggedRes] = await Promise.all([
    getVisibleWordTotal(),
    db.collection(WORD_STATE_COLLECTION).where({ openid, favorited: true }).count(),
    db.collection(WORD_STATE_COLLECTION).where({ openid, customTagged: true }).count(),
  ]);
  return {
    success: true,
    isVip: isVipUser(user),
    customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
    counts: {
      total: Number(total || 0),
      favorited: Number((favoritedRes && favoritedRes.total) || 0),
      customTagged: Number((customTaggedRes && customTaggedRes.total) || 0),
    },
  };
};

const batchGetWordMarks = async (event) => {
  const ensureRes = await ensureUserRecord();
  if (!ensureRes.success || !ensureRes.user) {
    return {
      success: false,
      errMsg: ensureRes.errMsg || "user unavailable",
    };
  }
  const words = Array.isArray(event.words) ? event.words : [];
  const wordKeys = Array.from(new Set(words.map((item) => normalizeWordKey(item)).filter(Boolean)));
  if (!wordKeys.length) {
    return {
      success: true,
      markMap: {},
    };
  }
  const map = await queryWordStateByWordKeys(ensureRes.user.openid, wordKeys);
  const markMap = {};
  wordKeys.forEach((wordKey) => {
    const state = map[wordKey] || {};
    markMap[wordKey] = {
      favorited: Boolean(state.favorited),
      customTagged: Boolean(state.customTagged),
    };
  });
  return {
    success: true,
    markMap,
  };
};

const setWordMark = async (event) => {
  const rawWord = String(event.word || "").trim();
  if (!rawWord) {
    return {
      success: false,
      errMsg: "word is required",
    };
  }
  const ensureRes = await ensureUserRecord();
  if (!ensureRes.success || !ensureRes.user) {
    return {
      success: false,
      errMsg: ensureRes.errMsg || "user unavailable",
    };
  }
  const user = normalizeUserRecord(ensureRes.user);
  const hasFavorited = Object.prototype.hasOwnProperty.call(event, "favorited");
  const hasCustomTagged = Object.prototype.hasOwnProperty.call(event, "customTagged");
  if (!hasFavorited && !hasCustomTagged) {
    return {
      success: false,
      errMsg: "no mark field provided",
    };
  }
  const openid = user.openid;
  const wordKey = normalizeWordKey(rawWord);
  const currentMap = await queryWordStateByWordKeys(openid, [wordKey]);
  const current = currentMap[wordKey] || {
    favorited: false,
    customTagged: false,
  };
  const nextState = {
    favorited: hasFavorited ? Boolean(event.favorited) : Boolean(current.favorited),
    customTagged: hasCustomTagged ? Boolean(event.customTagged) : Boolean(current.customTagged),
  };

  await ensureCollectionExists(WORD_STATE_COLLECTION);
  const collection = db.collection(WORD_STATE_COLLECTION);
  const where = {
    openid,
    wordKey,
  };

  if (!nextState.favorited && !nextState.customTagged) {
    await collection.where(where).remove();
  } else {
    const queryRes = await collection.where(where).limit(1).get();
    const list = queryRes.data || [];
    if (list.length) {
      await collection.where(where).update({
        data: {
          word: rawWord,
          favorited: nextState.favorited,
          customTagged: nextState.customTagged,
          updatedAt: db.serverDate(),
        },
      });
    } else {
      await collection.add({
        data: {
          openid,
          word: rawWord,
          wordKey,
          favorited: nextState.favorited,
          customTagged: nextState.customTagged,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
    }
  }

  return {
    success: true,
    word: rawWord,
    wordKey,
    favorited: nextState.favorited,
    customTagged: nextState.customTagged,
  };
};

const listMarkedWords = async (event) => {
  const filter = String(event.filter || "").trim();
  if (!["favorited", "customTagged"].includes(filter)) {
    return {
      success: false,
      errMsg: "invalid filter",
    };
  }
  const ensureRes = await ensureUserRecord();
  if (!ensureRes.success || !ensureRes.user) {
    return {
      success: false,
      errMsg: ensureRes.errMsg || "user unavailable",
    };
  }
  const user = normalizeUserRecord(ensureRes.user);

  const page = Math.max(Number(event.page) || 0, 0);
  const limit = Math.min(Math.max(Number(event.limit) || WORD_MAX_LIMIT, 1), WORD_MAX_LIMIT);
  const openid = user.openid;
  const visibleSkip = page * limit;
  const targetSize = limit + 1;
  const list = [];
  let skippedVisible = 0;
  let scanned = 0;
  const chunkSize = 100;

  await ensureCollectionExists(WORD_STATE_COLLECTION);
  const collection = db.collection(WORD_STATE_COLLECTION);
  const where = {
    openid,
    [filter]: true,
  };

  while (list.length < targetSize) {
    const stateRes = await collection
      .where(where)
      .orderBy("updatedAt", "desc")
      .skip(scanned)
      .limit(chunkSize)
      .get();
    const states = (stateRes.data || []).map(normalizeWordStateRecord);
    if (!states.length) {
      break;
    }
    scanned += states.length;
    const words = Array.from(new Set(states.map((item) => item.word).filter(Boolean)));
    const wordRecordMap = await queryWordRecordsByWordValues(words);
    for (let i = 0; i < states.length; i += 1) {
      const state = states[i];
      const record = wordRecordMap[state.wordKey];
      if (!record) {
        continue;
      }
      if (skippedVisible < visibleSkip) {
        skippedVisible += 1;
        continue;
      }
      list.push({
        ...record,
        favorited: Boolean(state.favorited),
        customTagged: Boolean(state.customTagged),
      });
      if (list.length >= targetSize) {
        break;
      }
    }
    if (states.length < chunkSize) {
      break;
    }
  }

  return {
    success: true,
    page,
    limit,
    hasMore: list.length > limit,
    list: list.slice(0, limit),
  };
};

const updateCustomWordTagName = async (event) => {
  return {
    success: false,
    errMsg: "标签名称已固定为已学",
  };
};

async function fetchWordListChunk({ skip = 0, limit = WORD_QUERY_CHUNK }) {
  const safeLimit = Math.min(Math.max(Number(limit) || WORD_QUERY_CHUNK, 1), WORD_QUERY_CHUNK);
  const res = await db
    .collection(WORD_COLLECTION)
    .orderBy("word", "asc")
    .skip(Math.max(Number(skip) || 0, 0))
    .limit(safeLimit)
    .field({
      word: true,
      phonetic: true,
      translation: true,
      pos: true,
      tag: true,
      audio: true,
      collins: true,
      oxford: true,
      bnc: true,
      frq: true,
    })
    .get();
  const rawList = (res.data || []).map(normalizeWordRecord);
  return {
    list: rawList.filter((item) => !isHiddenWordEntry(item)),
    scanned: rawList.length,
  };
}

function escapeRegExp(source = "") {
  return String(source || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSearchKeyword(keyword = "") {
  return String(keyword || "").trim().toLowerCase();
}

function isAsciiKeyword(keyword = "") {
  return /[a-z]/i.test(keyword) && !/[\u4e00-\u9fa5]/.test(keyword);
}

function scoreWordMatch(item = {}, keyword = "") {
  const word = String(item.word || "").toLowerCase();
  const phonetic = String(item.phonetic || "").toLowerCase();
  const translation = String(item.translation || "").toLowerCase();

  if (word === keyword) {
    return 4000;
  }
  if (word.indexOf(keyword) === 0) {
    return 3000;
  }
  if (phonetic.indexOf(keyword) >= 0) {
    return 2000;
  }
  if (word.indexOf(keyword) >= 0) {
    return 1000;
  }
  if (translation.indexOf(keyword) >= 0) {
    return 500;
  }
  return 0;
}

function sortWordMatches(list = [], keyword = "") {
  return list.sort((a, b) => {
    const scoreDiff = scoreWordMatch(b, keyword) - scoreWordMatch(a, keyword);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    const frqDiff = Number(b.frq || 0) - Number(a.frq || 0);
    if (frqDiff !== 0) {
      return frqDiff;
    }
    const bncDiff = Number(b.bnc || 0) - Number(a.bnc || 0);
    if (bncDiff !== 0) {
      return bncDiff;
    }
    const collinsDiff = Number(b.collins || 0) - Number(a.collins || 0);
    if (collinsDiff !== 0) {
      return collinsDiff;
    }
    return String(a.word || "").localeCompare(String(b.word || ""));
  });
}

async function queryWordSearch(where, limit = WORD_SEARCH_LIMIT) {
  const safeLimit = Math.min(Math.max(Number(limit) || WORD_SEARCH_LIMIT, 1), WORD_SEARCH_LIMIT);
  const res = await db
    .collection(WORD_COLLECTION)
    .where(where)
    .limit(safeLimit)
    .field({
      word: true,
      phonetic: true,
      translation: true,
      pos: true,
      tag: true,
      audio: true,
      collins: true,
      oxford: true,
      bnc: true,
      frq: true,
    })
    .get();
  return (res.data || [])
    .map(normalizeWordRecord)
    .filter((item) => !isHiddenWordEntry(item));
}

const listWords = async (event) => {
  const page = Math.max(Number(event.page) || 0, 0);
  const limit = Math.min(Math.max(Number(event.limit) || WORD_MAX_LIMIT, 1), WORD_MAX_LIMIT);
  const visibleSkip = page * limit;
  const targetSize = limit + 1;
  const list = [];
  let skippedVisible = 0;
  let scanned = 0;

  while (list.length < targetSize) {
    const currentLimit = WORD_QUERY_CHUNK;
    const currentChunk = await fetchWordListChunk({
      skip: scanned,
      limit: currentLimit,
    });
    const currentList = currentChunk.list || [];
    if (skippedVisible < visibleSkip) {
      const remainingSkip = visibleSkip - skippedVisible;
      if (currentList.length <= remainingSkip) {
        skippedVisible += currentList.length;
      } else {
        skippedVisible = visibleSkip;
        list.push(...currentList.slice(remainingSkip));
      }
    } else {
      list.push(...currentList);
    }
    scanned += currentChunk.scanned;
    if (currentChunk.scanned < currentLimit) {
      break;
    }
  }

  return {
    success: true,
    page,
    limit,
    hasMore: list.length > limit,
    list: list.slice(0, limit),
  };
};

const searchWords = async (event) => {
  const keyword = normalizeSearchKeyword(event.keyword);
  const limit = Math.min(Math.max(Number(event.limit) || WORD_SEARCH_LIMIT, 1), WORD_SEARCH_LIMIT);

  if (!keyword) {
    return {
      success: true,
      keyword,
      list: [],
    };
  }

  const escapedKeyword = escapeRegExp(keyword);
  const results = [];
  const seen = new Set();
  const pushUnique = (items = []) => {
    items.forEach((item) => {
      if (!item || !item._id || seen.has(item._id)) {
        return;
      }
      seen.add(item._id);
      results.push(item);
    });
  };

  if (isAsciiKeyword(keyword)) {
    const [prefixMatches, phoneticMatches, containsMatches] = await Promise.all([
      queryWordSearch({
        word: db.RegExp({
          regexp: `^${escapedKeyword}`,
          options: "i",
        }),
      }, limit),
      queryWordSearch({
        phonetic: db.RegExp({
          regexp: escapedKeyword,
          options: "i",
        }),
      }, Math.min(limit, 20)),
      queryWordSearch({
        word: db.RegExp({
          regexp: escapedKeyword,
          options: "i",
        }),
      }, limit),
    ]);
    pushUnique(prefixMatches);
    pushUnique(phoneticMatches);
    pushUnique(containsMatches);
  } else {
    const translationMatches = await queryWordSearch({
      translation: db.RegExp({
        regexp: escapedKeyword,
        options: "i",
      }),
    }, limit);
    pushUnique(translationMatches);
  }

  return {
    success: true,
    keyword,
    list: sortWordMatches(results.filter((item) => !isHiddenWordEntry(item)), keyword).slice(0, limit),
  };
};

async function queryWordByExactValue(word) {
  if (!word) {
    return null;
  }
  const res = await db
    .collection(WORD_COLLECTION)
    .where({
      word,
    })
    .limit(1)
    .get();
  const list = res.data || [];
  return list.length ? normalizeWordRecord(list[0]) : null;
}

const getWordDetail = async (event) => {
  const rawWord = String(event.word || "").trim();
  if (!rawWord) {
    return {
      success: false,
      errMsg: "word is required",
    };
  }

  const lowerWord = rawWord.toLowerCase();
  const candidates = [];
  [rawWord, lowerWord].forEach((item) => {
    if (item && !candidates.includes(item)) {
      candidates.push(item);
    }
  });

  for (let i = 0; i < candidates.length; i += 1) {
    const record = await queryWordByExactValue(candidates[i]);
    if (record && !isHiddenWordEntry(record)) {
      return {
        success: true,
        item: record,
      };
    }
  }

  return {
    success: false,
    errMsg: `word not found: ${rawWord}`,
  };
};
// 获取openid
const getOpenId = async () => {
  // 获取基础信息
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  };
};

// 获取小程序二维码
const getMiniProgramCode = async () => {
  // 获取小程序二维码的buffer
  const resp = await cloud.openapi.wxacode.get({
    path: "pages/index/index",
  });
  const { buffer } = resp;
  // 将图片上传云存储空间
  const upload = await cloud.uploadFile({
    cloudPath: "code.png",
    fileContent: buffer,
  });
  return upload.fileID;
};

// 创建集合
const createCollection = async () => {
  try {
    // 创建集合
    await db.createCollection("sales");
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华东",
        city: "上海",
        sales: 11,
      },
    });
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华东",
        city: "南京",
        sales: 11,
      },
    });
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华南",
        city: "广州",
        sales: 22,
      },
    });
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华南",
        city: "深圳",
        sales: 22,
      },
    });
    return {
      success: true,
    };
  } catch (e) {
    // 这里catch到的是该collection已经存在，从业务逻辑上来说是运行成功的，所以catch返回success给前端，避免工具在前端抛出异常
    return {
      success: true,
      data: "create collection success",
    };
  }
};

// 查询数据
const selectRecord = async () => {
  // 返回数据库查询结果
  return await db.collection("sales").get();
};

// 更新数据
const updateRecord = async (event) => {
  try {
    // 遍历修改数据库信息
    for (let i = 0; i < event.data.length; i++) {
      await db
        .collection("sales")
        .where({
          _id: event.data[i]._id,
        })
        .update({
          data: {
            sales: event.data[i].sales,
          },
        });
    }
    return {
      success: true,
      data: event.data,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// 新增数据
const insertRecord = async (event) => {
  try {
    const insertRecord = event.data;
    // 插入数据
    await db.collection("sales").add({
      data: {
        region: insertRecord.region,
        city: insertRecord.city,
        sales: Number(insertRecord.sales),
      },
    });
    return {
      success: true,
      data: event.data,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// 删除数据
const deleteRecord = async (event) => {
  try {
    await db
      .collection("sales")
      .where({
        _id: event.data._id,
      })
      .remove();
    return {
      success: true,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// const getOpenId = require('./getOpenId/index');
// const getMiniProgramCode = require('./getMiniProgramCode/index');
// const createCollection = require('./createCollection/index');
// const selectRecord = require('./selectRecord/index');
// const updateRecord = require('./updateRecord/index');
// const fetchGoodsList = require('./fetchGoodsList/index');
// const genMpQrcode = require('./genMpQrcode/index');
// 云函数入口函数
exports.main = async (event, context) => {
  switch (event.type) {
    case "login":
      return await login();
    case "updateUserProfile":
      return await updateUserProfile(event);
    case "canAccessSentence":
      return await canAccessSentence(event);
    case "consumeSentenceAccess":
      return await consumeSentenceAccess(event);
    case "createVipOrder":
      return await createVipOrder(event);
    case "queryVipOrder":
      return await queryVipOrder(event);
    case "markVipDelivered":
      return await markVipDelivered(event);
    case "handleVirtualPaymentNotify":
      return await handleVirtualPaymentNotify(event);
    case "getOpenId":
      return await getOpenId();
    case "listWords":
      return await listWords(event);
    case "searchWords":
      return await searchWords(event);
    case "getWordDetail":
      return await getWordDetail(event);
    case "getWordMarkMeta":
      return await getWordMarkMeta();
    case "batchGetWordMarks":
      return await batchGetWordMarks(event);
    case "setWordMark":
      return await setWordMark(event);
    case "listMarkedWords":
      return await listMarkedWords(event);
    case "updateCustomWordTagName":
      return await updateCustomWordTagName(event);
    case "getMiniProgramCode":
      return await getMiniProgramCode();
    case "createCollection":
      return await createCollection();
    case "selectRecord":
      return await selectRecord();
    case "updateRecord":
      return await updateRecord(event);
    case "insertRecord":
      return await insertRecord(event);
    case "deleteRecord":
      return await deleteRecord(event);
    default:
      return {
        success: false,
        errMsg: "unknown type",
      };
  }
};
