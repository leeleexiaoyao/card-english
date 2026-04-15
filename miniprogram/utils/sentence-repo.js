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
    ? imagePool[(Math.max(1, Number(order) || fallbackOrder) - 1) % imagePool.length]
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

// 图片URL缓存
const IMAGE_URL_CACHE_KEY = "image_url_cache_v2";
const IMAGE_URL_TTL = 6 * 60 * 60 * 1000;

function getImageUrlCache() {
  return wx.getStorageSync(IMAGE_URL_CACHE_KEY) || {};
}

function setImageUrlCache(cache) {
  wx.setStorageSync(IMAGE_URL_CACHE_KEY, cache);
}

function getCachedImageUrl(cache, fileId) {
  const value = cache[fileId];
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (!value.url) {
    return "";
  }
  if (value.expiresAt && value.expiresAt < Date.now()) {
    return "";
  }
  return value.url;
}

function setCachedImageUrl(cache, fileId, url) {
  if (!fileId || !url) {
    return cache;
  }
  return {
    ...cache,
    [fileId]: {
      url,
      expiresAt: Date.now() + IMAGE_URL_TTL,
    },
  };
}

// 批量获取图片临时URL的最大数量
const MAX_BATCH_SIZE = 50;

// 预加载图片的数量
// 懒加载图片URL
async function lazyLoadImageUrl(cloudFileId) {
  if (!cloudFileId || !cloudFileId.startsWith("cloud://")) {
    return cloudFileId;
  }

  // 检查缓存
  const imageUrlCache = getImageUrlCache();
  const cachedUrl = getCachedImageUrl(imageUrlCache, cloudFileId);
  if (cachedUrl) {
    return cachedUrl;
  }

  // 获取临时URL
  try {
    const res = await wx.cloud.getTempFileURL({
      fileList: [cloudFileId],
    });
    const list = res.fileList || [];
    if (list.length > 0 && list[0].tempFileURL) {
      const tempUrl = list[0].tempFileURL;
      // 更新缓存
      const newCache = setCachedImageUrl(imageUrlCache, cloudFileId, tempUrl);
      setImageUrlCache(newCache);
      return tempUrl;
    }
  } catch (err) {
    console.error("[sentence-repo] lazyLoadImageUrl failed", err);
  }

  return cloudFileId;
}

// 预加载图片URL
async function preloadImageUrls(cloudFileIds = []) {
  if (!cloudFileIds.length) {
    return;
  }

  // 检查缓存，只预加载未缓存的
  const imageUrlCache = getImageUrlCache();
  const needPreload = cloudFileIds.filter((id) => !getCachedImageUrl(imageUrlCache, id));

  if (!needPreload.length) {
    return;
  }

  // 分块预加载
  const chunkSize = MAX_BATCH_SIZE;
  for (let i = 0; i < needPreload.length; i += chunkSize) {
    const chunk = needPreload.slice(i, i + chunkSize);
    try {
      const res = await wx.cloud.getTempFileURL({
        fileList: chunk,
      });
      const list = res.fileList || [];
      let newCache = { ...imageUrlCache };
      for (const item of list) {
        if (item.fileID && item.tempFileURL) {
          newCache = setCachedImageUrl(newCache, item.fileID, item.tempFileURL);
        }
      }
      setImageUrlCache(newCache);
    } catch (err) {
      console.error("[sentence-repo] preloadImageUrls failed", err);
    }
  }
}

// 解析图片URL（支持懒加载）
function resolveImageUrl(sentence) {
  const imageUrlCache = getImageUrlCache();
  return getCachedImageUrl(imageUrlCache, sentence.imageUrl) || sentence.imageUrl;
}

// 批量解析图片URL（用于初始加载）
async function resolveCloudImageUrls(sentences = []) {
  if (!hasCloudEnv() || !Array.isArray(sentences) || !sentences.length) {
    return sentences;
  }

  try {
    // 获取现有缓存
    const imageUrlCache = getImageUrlCache();
    const cloudFileIds = [];
    const fileUrlMap = {};

    // 收集需要获取临时URL的cloudFileID
    sentences.forEach((item) => {
      const url = item.imageUrl;
      const cachedUrl = getCachedImageUrl(imageUrlCache, url);
      if (cachedUrl) {
        fileUrlMap[url] = cachedUrl;
        return;
      }
      if (typeof url === "string" && url.startsWith("cloud://") && !fileUrlMap[url]) {
        cloudFileIds.push(url);
      }
    });

    const toResolvedSentences = () => {
      const fallbackPool = Array.from(
        new Set(
          Object.values(fileUrlMap).filter(
            (url) => typeof url === "string" && url && !url.startsWith("cloud://")
          )
        )
      );
      return sentences.map((sentence, index) => {
        const directUrl = fileUrlMap[sentence.imageUrl];
        if (directUrl) {
          return {
            ...sentence,
            imageUrl: directUrl,
          };
        }
        if (fallbackPool.length) {
          const order = Number(sentence.order) || index + 1;
          const fallbackUrl = fallbackPool[(Math.max(1, order) - 1) % fallbackPool.length];
          return {
            ...sentence,
            imageUrl: fallbackUrl,
          };
        }
        return sentence;
      });
    };

    if (!cloudFileIds.length) {
      // 所有图片URL都已缓存，直接返回（并对缺失项做兜底）
      return toResolvedSentences();
    }

    // 分块获取临时URL；单批失败不回滚整页图片解析
    for (let i = 0; i < cloudFileIds.length; i += MAX_BATCH_SIZE) {
      const chunk = cloudFileIds.slice(i, i + MAX_BATCH_SIZE);
      try {
        const res = await wx.cloud.getTempFileURL({
          fileList: chunk,
        });
        const list = res.fileList || [];
        for (let j = 0; j < list.length; j += 1) {
          const item = list[j];
          if (item.fileID && item.tempFileURL) {
            fileUrlMap[item.fileID] = item.tempFileURL;
          }
        }
      } catch (err) {
        console.error("[sentence-repo] resolve chunk failed", err);
      }
    }

    // 更新缓存
    let nextCache = { ...imageUrlCache };
    Object.keys(fileUrlMap).forEach((fileId) => {
      nextCache = setCachedImageUrl(nextCache, fileId, fileUrlMap[fileId]);
    });
    setImageUrlCache(nextCache);

    return toResolvedSentences();
  } catch (err) {
    console.error("[sentence-repo] resolveCloudImageUrls failed", err);
    return sentences;
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
    const _ = db.command;
    const mergedMap = {};
    const chunkSize = 20;

    // 只获取本地缓存中没有的状态
    const missingIds = sentenceIds.filter(id => !localStates[id]);
    if (!missingIds.length) {
      return localStates;
    }

    for (let i = 0; i < missingIds.length; i += chunkSize) {
      const chunk = missingIds.slice(i, i + chunkSize);
      const res = await db
        .collection(SENTENCE_STATE_COLLECTION)
        .where({
          openid,
          sentenceId: _.in(chunk),
        })
        .get();
      const list = res.data || [];
      for (let j = 0; j < list.length; j += 1) {
        const state = list[j];
        mergedMap[state.sentenceId] = {
          mastered: Boolean(state.mastered),
          favorited: Boolean(state.favorited),
        };
      }
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
    return {
      ...sentence,
      order: sentence.order || index + 1,
      mastered: Boolean(state.mastered),
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
    mastered: false,
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
  const mastered = sentences.filter((item) => item.mastered).length;
  const favorited = sentences.filter((item) => item.favorited).length;
  return {
    total,
    mastered,
    unmastered: total - mastered,
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
  wx.removeStorageSync(SENTENCE_CACHE_KEY);
  wx.removeStorageSync(IMAGE_URL_CACHE_KEY);
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
