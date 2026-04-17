const { sentenceBank } = require("../data/sentenceBank");
const { cardImagePool } = require("../data/cardImagePool");

const SENTENCE_COLLECTION = "sentences";
const SENTENCE_STATE_COLLECTION = "user_sentence_state";
const WORD_COLLECTION = "words";

const SENTENCE_CACHE_KEY = "sentence_cache_v3";
const SENTENCE_STATE_CACHE_KEY = "sentence_state_cache_v1";

function hasCloudEnv() {
  const app = getApp();
  return Boolean(wx.cloud && app && app.globalData && app.globalData.env);
}

async function ensureOpenId() {
  const app = getApp();
  if (!app) {
    return wx.getStorageSync("user_openid_v1") || "";
  }
  if (app.globalData && app.globalData.openid) {
    return app.globalData.openid;
  }
  if (typeof app.ensureOpenId === "function") {
    const openid = await app.ensureOpenId();
    return openid || "";
  }
  return wx.getStorageSync("user_openid_v1") || "";
}


function normalizeSentence(item, fallbackOrder) {
  const order = item.order || fallbackOrder;
  const imagePool = Array.isArray(cardImagePool) ? cardImagePool : [];
  const fallbackImageUrl = imagePool.length
    && Math.max(1, Number(order) || fallbackOrder) <= imagePool.length
    ? imagePool[Math.max(1, Number(order) || fallbackOrder) - 1]
    : "";
  return {
    _id: item._id || item.id || `local-${fallbackOrder}`,
    id: item.id || item._id || `local-${fallbackOrder}`,
    order,
    english: item.english || "",
    chinese: item.chinese || "",
    imageUrl: fallbackImageUrl || item.imageUrl || item.image || "",
    audioUrl: item.audioUrl || item.audio || "",
    audioMode: item.audioMode || "",
  };
}

const IMAGE_FILE_CACHE_KEY = "image_file_cache_v1";
const USER_STATE_QUERY_LIMIT = 100;
const imageLoadPromiseMap = {};

function getImageFileCache() {
  return wx.getStorageSync(IMAGE_FILE_CACHE_KEY) || {};
}

function setImageFileCache(cache) {
  wx.setStorageSync(IMAGE_FILE_CACHE_KEY, cache);
}

function getCachedLocalImagePath(cache, fileId) {
  const value = cache[fileId];
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return value.localPath || "";
}

function setCachedLocalImagePath(cache, fileId, localPath) {
  return {
    ...cache,
    [fileId]: {
      localPath,
      updatedAt: Date.now(),
    },
  };
}

function saveFileToLocal(tempFilePath) {
  return new Promise((resolve, reject) => {
    wx.saveFile({
      tempFilePath,
      success: (res) => resolve(res.savedFilePath || tempFilePath),
      fail: reject,
    });
  });
}

async function lazyLoadImageUrl(cloudFileId) {
  if (!cloudFileId || !cloudFileId.startsWith("cloud://")) {
    return "";
  }
  if (!hasCloudEnv()) {
    return "";
  }

  const imageFileCache = getImageFileCache();
  const cachedLocalPath = getCachedLocalImagePath(imageFileCache, cloudFileId);
  if (cachedLocalPath) {
    return cachedLocalPath;
  }

  if (imageLoadPromiseMap[cloudFileId]) {
    return imageLoadPromiseMap[cloudFileId];
  }

  imageLoadPromiseMap[cloudFileId] = (async () => {
    try {
      const res = await wx.cloud.downloadFile({
        fileID: cloudFileId,
      });
      const tempFilePath = res.tempFilePath || "";
      if (tempFilePath) {
        let localPath = tempFilePath;
        try {
          localPath = await saveFileToLocal(tempFilePath);
        } catch (saveErr) {
          localPath = tempFilePath;
        }
        const nextCache = setCachedLocalImagePath(getImageFileCache(), cloudFileId, localPath);
        setImageFileCache(nextCache);
        return localPath;
      }
    } catch (err) {
      console.error("[sentence-repo] lazyLoadImageUrl failed", err);
    }

    return "";
  })();

  try {
    return await imageLoadPromiseMap[cloudFileId];
  } finally {
    delete imageLoadPromiseMap[cloudFileId];
  }
}

async function preloadImageUrls(cloudFileIds = []) {
  if (!cloudFileIds.length) {
    return;
  }

  const imageFileCache = getImageFileCache();
  const dedupedIds = Array.from(new Set(cloudFileIds));
  const needPreload = dedupedIds.filter((id) => !getCachedLocalImagePath(imageFileCache, id));

  if (!needPreload.length) {
    return;
  }

  for (let i = 0; i < needPreload.length; i += 1) {
    await lazyLoadImageUrl(needPreload[i]);
  }
}

function resolveImageUrl(sentence) {
  const imageFileCache = getImageFileCache();
  return getCachedLocalImagePath(imageFileCache, sentence.imageUrl) || "";
}

async function resolveCloudImageUrls(sentences = []) {
  if (!Array.isArray(sentences) || !sentences.length) {
    return [];
  }

  try {
    const cloudFileIds = sentences
      .map((item) => item.imageUrl)
      .filter((url) => typeof url === "string" && url.startsWith("cloud://"));

    if (cloudFileIds.length) {
      await preloadImageUrls(cloudFileIds);
    }

    return sentences.map((sentence) => ({
      ...sentence,
      imageUrl: resolveImageUrl(sentence),
    }));
  } catch (err) {
    console.error("[sentence-repo] resolveCloudImageUrls failed", err);
    return sentences.map((sentence) => ({
      ...sentence,
      imageUrl: resolveImageUrl(sentence),
    }));
  }
}

async function fetchCollectionAll(collection, orderField) {
  const list = [];
  let skip = 0;
  const limit = 100;

  while (true) {
    const query = collection.orderBy(orderField, "asc").skip(skip).limit(limit);
    const res = await query.get();
    const current = res.data || [];
    list.push(...current);
    if (current.length < limit) {
      break;
    }
    skip += limit;
  }

  return list;
}

async function fetchSentences(options = {}) {
  const resolveImages = options.resolveImages !== false;
  try {
    const cached = wx.getStorageSync(SENTENCE_CACHE_KEY);
    if (cached && cached.length) {
      const normalized = cached.map((item, index) => normalizeSentence(item, index + 1));
      if (!resolveImages) {
        return normalized;
      }
      return await resolveCloudImageUrls(normalized);
    }

    const normalized = sentenceBank.map((item, index) => normalizeSentence(item, index + 1));
    wx.setStorageSync(SENTENCE_CACHE_KEY, normalized);
    if (!resolveImages) {
      return normalized;
    }
    return await resolveCloudImageUrls(normalized);
  } catch (err) {
    console.error("[sentence-repo] fetchSentences failed", err);
    // 即使出错也返回默认的句子数据
    const normalized = sentenceBank.map((item, index) => normalizeSentence(item, index + 1));
    return normalized;
  }
}

// 用户状态缓存时间（毫秒）
const STATE_CACHE_EXPIRY = 5 * 60 * 1000; // 5分钟

// 获取带过期时间的用户状态缓存
function getLocalStatesWithExpiry() {
  const cached = wx.getStorageSync(SENTENCE_STATE_CACHE_KEY);
  if (!cached) {
    return { states: {}, timestamp: 0 };
  }
  return cached;
}

// 设置带过期时间的用户状态缓存
function setLocalStatesWithExpiry(states) {
  wx.setStorageSync(SENTENCE_STATE_CACHE_KEY, {
    states,
    timestamp: Date.now(),
  });
}

// 获取本地用户状态
function getLocalStates() {
  const cached = getLocalStatesWithExpiry();
  return cached.states || {};
}

// 设置本地用户状态
function setLocalStates(states) {
  setLocalStatesWithExpiry(states);
}

async function fetchUserStateMap(sentenceIds = [], options = {}) {
  const cached = getLocalStatesWithExpiry();
  const localStates = cached.states || {};
  const cacheTimestamp = cached.timestamp || 0;
  const now = Date.now();

  if (!sentenceIds.length) {
    return {};
  }

  // 如果有本地缓存且未过期，直接返回本地状态
  if (options.preferLocal || !hasCloudEnv() || (now - cacheTimestamp < STATE_CACHE_EXPIRY)) {
    return localStates;
  }

  try {
    const openid = await ensureOpenId();
    if (!openid) {
      return localStates;
    }
    const db = wx.cloud.database();
    const mergedMap = {};
    let skip = 0;

    while (true) {
      const res = await db
        .collection(SENTENCE_STATE_COLLECTION)
        .where({
          openid,
        })
        .field({
          sentenceId: true,
          mastered: true,
          favorited: true,
        })
        .skip(skip)
        .limit(USER_STATE_QUERY_LIMIT)
        .get();
      const list = res.data || [];
      for (let j = 0; j < list.length; j += 1) {
        const state = list[j];
        const mastered = Object.prototype.hasOwnProperty.call(state, "mastered")
          ? state.mastered
          : null;
        mergedMap[state.sentenceId] = {
          mastered: mastered === null ? null : Boolean(mastered),
          favorited: Boolean(state.favorited),
        };
      }
      if (list.length < USER_STATE_QUERY_LIMIT) {
        break;
      }
      skip += USER_STATE_QUERY_LIMIT;
    }

    const nextLocal = {
      ...localStates,
      ...mergedMap,
    };
    setLocalStates(nextLocal);
    return nextLocal;
  } catch (err) {
    return localStates;
  }
}

function mergeSentencesWithState(sentences = [], stateMap = {}) {
  return sentences.map((sentence, index) => {
    const state = stateMap[sentence._id] || {};
    const mastered = Object.prototype.hasOwnProperty.call(state, "mastered")
      ? state.mastered
      : null;
    return {
      ...sentence,
      order: sentence.order || index + 1,
      mastered: mastered === null ? null : Boolean(mastered),
      favorited: Boolean(state.favorited),
    };
  });
}

async function saveSentenceState(sentenceId, patch = {}) {
  if (!sentenceId) {
    return;
  }
  const localStates = getLocalStates();
  const current = localStates[sentenceId] || {
    mastered: null,
    favorited: false,
  };
  const nextState = {
    ...current,
    ...patch,
  };
  localStates[sentenceId] = nextState;
  setLocalStates(localStates);

  if (!hasCloudEnv()) {
    return nextState;
  }

  try {
    const openid = await ensureOpenId();
    if (!openid) {
      return nextState;
    }
    const db = wx.cloud.database();
    const collection = db.collection(SENTENCE_STATE_COLLECTION);
    const queryRes = await collection.where({ sentenceId, openid }).get();
    const list = queryRes.data || [];
    if (list.length) {
      await collection
        .where({ sentenceId, openid })
        .update({
          data: {
            ...nextState,
            updatedAt: db.serverDate(),
          },
        });
    } else {
      await collection.add({
        data: {
          openid,
          sentenceId,
          ...nextState,
          updatedAt: db.serverDate(),
        },
      });
    }
  } catch (err) {
    return nextState;
  }

  return nextState;
}

function buildCounts(sentences = []) {
  const total = sentences.length;
  const mastered = sentences.filter((item) => item.mastered === true).length;
  const unmastered = sentences.filter((item) => item.mastered === false).length;
  const unlearned = sentences.filter((item) => item.mastered == null).length;
  const favorited = sentences.filter((item) => item.favorited).length;
  return {
    total,
    mastered,
    unmastered,
    unlearned,
    favorited,
  };
}

async function fetchWordsFromCloud() {
  if (!hasCloudEnv()) {
    return [];
  }
  try {
    const db = wx.cloud.database();
    const list = await fetchCollectionAll(db.collection(WORD_COLLECTION), "word");
    return list
      .filter((item) => item.word)
      .map((item) => ({
        word: String(item.word).toLowerCase(),
        phonetic: item.phonetic || "暂无",
        audio: item.audio || "",
      }));
  } catch (err) {
    return [];
  }
}

function clearSentenceCache() {
  const imageFileCache = getImageFileCache();
  Object.keys(imageFileCache).forEach((fileId) => {
    const localPath = getCachedLocalImagePath(imageFileCache, fileId);
    if (!localPath) {
      return;
    }
    wx.removeSavedFile({
      filePath: localPath,
      fail: () => {},
    });
  });
  wx.removeStorageSync(SENTENCE_CACHE_KEY);
  wx.removeStorageSync(IMAGE_FILE_CACHE_KEY);
  wx.removeStorageSync("image_url_cache_v2");
}

module.exports = {
  SENTENCE_CACHE_KEY,
  SENTENCE_STATE_CACHE_KEY,
  fetchSentences,
  fetchUserStateMap,
  getLocalSentenceStateMap: getLocalStates,
  mergeSentencesWithState,
  saveSentenceState,
  buildCounts,
  fetchWordsFromCloud,
  clearSentenceCache,
  lazyLoadImageUrl,
  preloadImageUrls,
  resolveImageUrl,
};
