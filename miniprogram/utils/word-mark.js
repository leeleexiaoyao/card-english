const WORD_FUNCTION_NAME = "quickstartFunctions";
const WORD_MARK_META_CACHE_KEY = "word_mark_meta_v1";
const WORD_MARK_STATE_CACHE_KEY = "word_mark_state_v1";
const WORD_MARK_META_TTL = 60 * 1000;
const WORD_MARK_STATE_TTL = 5 * 60 * 1000;
const DEFAULT_CUSTOM_WORD_TAG_NAME = "已学";

function hasCloudEnv() {
  const app = getApp();
  return Boolean(wx.cloud && app && app.globalData && app.globalData.env);
}

function normalizeWordKey(word = "") {
  return String(word || "").trim().toLowerCase();
}

function getCurrentOpenId() {
  const app = getApp();
  if (app && app.globalData) {
    if (!app.globalData.authEnabled) {
      return "";
    }
    if (app.globalData.openid) {
      return app.globalData.openid;
    }
  }
  return wx.getStorageSync("user_openid_v1") || "";
}

function buildDefaultMeta() {
  return {
    isVip: false,
    customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
    counts: {
      total: 0,
      favorited: 0,
      customTagged: 0,
    },
  };
}

function readMetaCache() {
  return wx.getStorageSync(WORD_MARK_META_CACHE_KEY) || null;
}

function writeMetaCache(payload) {
  wx.setStorageSync(WORD_MARK_META_CACHE_KEY, payload);
}

function clearMetaCache() {
  wx.removeStorageSync(WORD_MARK_META_CACHE_KEY);
}

function readStateCache() {
  return wx.getStorageSync(WORD_MARK_STATE_CACHE_KEY) || null;
}

function writeStateCache(payload) {
  wx.setStorageSync(WORD_MARK_STATE_CACHE_KEY, payload);
}

function clearStateCache() {
  wx.removeStorageSync(WORD_MARK_STATE_CACHE_KEY);
}

function clearWordMarkCache() {
  clearMetaCache();
  clearStateCache();
}

function callWordFunction(data = {}) {
  if (!hasCloudEnv()) {
    return Promise.reject(new Error("cloud env unavailable"));
  }
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: WORD_FUNCTION_NAME,
      data,
      success: (res) => resolve(res.result || {}),
      fail: reject,
    });
  });
}

function normalizeMarkState(state = {}) {
  return {
    favorited: Boolean(state.favorited),
    customTagged: Boolean(state.customTagged),
  };
}

function mergeMarkMap(target = {}, incoming = {}) {
  const next = {
    ...target,
  };
  Object.keys(incoming || {}).forEach((key) => {
    const wordKey = normalizeWordKey(key);
    if (!wordKey) {
      return;
    }
    next[wordKey] = normalizeMarkState(incoming[key]);
  });
  return next;
}

function normalizeMeta(raw = {}) {
  const counts = raw.counts || {};
  return {
    isVip: Boolean(raw.isVip),
    customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
    counts: {
      total: Number(counts.total || 0),
      favorited: Number(counts.favorited || 0),
      customTagged: Number(counts.customTagged || 0),
    },
  };
}

function syncAppCustomWordTagName(customWordTagName = DEFAULT_CUSTOM_WORD_TAG_NAME) {
  const app = getApp();
  if (!app || !app.globalData || !app.globalData.user) {
    return;
  }
  app.globalData.user = {
    ...app.globalData.user,
    customWordTagName,
  };
}

async function getWordMarkMeta(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const openid = getCurrentOpenId();
  const fallback = buildDefaultMeta();

  if (!openid) {
    clearWordMarkCache();
    return fallback;
  }

  const cached = readMetaCache();
  const now = Date.now();
  if (
    !forceRefresh &&
    cached &&
    cached.openid === openid &&
    now - Number(cached.timestamp || 0) < WORD_MARK_META_TTL &&
    cached.meta
  ) {
    return normalizeMeta(cached.meta);
  }

  try {
    const result = await callWordFunction({
      type: "getWordMarkMeta",
    });
    if (!result.success) {
      throw new Error(result.errMsg || "获取单词标记元信息失败");
    }
    const meta = normalizeMeta(result);
    writeMetaCache({
      openid,
      timestamp: now,
      meta,
    });
    syncAppCustomWordTagName(meta.customWordTagName);
    return meta;
  } catch (err) {
    if (cached && cached.openid === openid && cached.meta) {
      return normalizeMeta(cached.meta);
    }
    return fallback;
  }
}

async function batchGetWordMarks(words = [], options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const openid = getCurrentOpenId();
  const wordKeys = Array.from(new Set((Array.isArray(words) ? words : []).map(normalizeWordKey).filter(Boolean)));
  if (!wordKeys.length || !openid) {
    return {};
  }

  const cache = readStateCache() || {};
  const now = Date.now();
  const cacheValid =
    cache.openid === openid &&
    now - Number(cache.timestamp || 0) < WORD_MARK_STATE_TTL &&
    cache.markMap &&
    typeof cache.markMap === "object";
  const cachedMap = cacheValid ? cache.markMap : {};
  const missingWordKeys = forceRefresh
    ? wordKeys
    : wordKeys.filter((wordKey) => !Object.prototype.hasOwnProperty.call(cachedMap, wordKey));

  if (!missingWordKeys.length) {
    const result = {};
    wordKeys.forEach((wordKey) => {
      result[wordKey] = normalizeMarkState(cachedMap[wordKey]);
    });
    return result;
  }

  try {
    const result = await callWordFunction({
      type: "batchGetWordMarks",
      words: missingWordKeys,
    });
    if (!result.success) {
      throw new Error(result.errMsg || "获取单词标记失败");
    }
    const mergedMarkMap = mergeMarkMap(cachedMap, result.markMap || {});
    writeStateCache({
      openid,
      timestamp: now,
      markMap: mergedMarkMap,
    });
    const output = {};
    wordKeys.forEach((wordKey) => {
      output[wordKey] = normalizeMarkState(mergedMarkMap[wordKey]);
    });
    return output;
  } catch (err) {
    const output = {};
    wordKeys.forEach((wordKey) => {
      output[wordKey] = normalizeMarkState(cachedMap[wordKey]);
    });
    return output;
  }
}

async function setWordMark(payload = {}) {
  const word = String(payload.word || "").trim();
  if (!word) {
    throw new Error("单词不能为空");
  }
  const requestPayload = {
    type: "setWordMark",
    word,
  };
  if (Object.prototype.hasOwnProperty.call(payload, "favorited")) {
    requestPayload.favorited = Boolean(payload.favorited);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "customTagged")) {
    requestPayload.customTagged = Boolean(payload.customTagged);
  }
  const result = await callWordFunction(requestPayload);
  if (!result.success) {
    const error = new Error(result.errMsg || "更新单词标记失败");
    error.needVip = Boolean(result.needVip);
    throw error;
  }
  const openid = getCurrentOpenId();
  if (openid) {
    const cache = readStateCache() || {};
    const currentMap =
      cache.openid === openid && cache.markMap && typeof cache.markMap === "object"
        ? cache.markMap
        : {};
    const wordKey = normalizeWordKey(result.word || word);
    const nextMap = {
      ...currentMap,
      [wordKey]: {
        favorited: Boolean(result.favorited),
        customTagged: Boolean(result.customTagged),
      },
    };
    writeStateCache({
      openid,
      timestamp: Date.now(),
      markMap: nextMap,
    });
  }
  clearMetaCache();
  return {
    word: result.word || word,
    wordKey: normalizeWordKey(result.word || word),
    favorited: Boolean(result.favorited),
    customTagged: Boolean(result.customTagged),
  };
}

async function batchSetWordCustomTagged(words = [], customTagged = true) {
  const wordKeys = Array.from(new Set((Array.isArray(words) ? words : []).map(normalizeWordKey).filter(Boolean)));
  if (!wordKeys.length) {
    return {
      successCount: 0,
      failureCount: 0,
      failedWords: [],
      results: [],
    };
  }

  const settledResults = await Promise.allSettled(
    wordKeys.map((word) =>
      setWordMark({
        word,
        customTagged,
      })
    )
  );

  const results = [];
  const failedWords = [];
  settledResults.forEach((item, index) => {
    if (item.status === "fulfilled") {
      results.push(item.value);
      return;
    }
    failedWords.push(wordKeys[index]);
  });

  return {
    successCount: results.length,
    failureCount: failedWords.length,
    failedWords,
    results,
  };
}

module.exports = {
  batchSetWordCustomTagged,
  DEFAULT_CUSTOM_WORD_TAG_NAME,
  batchGetWordMarks,
  clearWordMarkCache,
  getWordMarkMeta,
  normalizeWordKey,
  setWordMark,
};
