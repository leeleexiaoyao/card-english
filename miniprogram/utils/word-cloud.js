const { guessWordForms } = require("./word");

const WORD_PAGE_CACHE_PREFIX = "word_page_cache_v1_";
const WORD_DETAIL_CACHE_KEY = "word_detail_cache_v2";
const WORD_DEFAULT_PAGE_SIZE = 200;
const WORD_MAX_PAGE_SIZE = 200;
const WORD_FUNCTION_NAME = "quickstartFunctions";

function hasCloudEnv() {
  const app = getApp();
  return Boolean(wx.cloud && app && app.globalData && app.globalData.env);
}

function clampPageSize(size) {
  const value = Number(size) || WORD_DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(value, 1), WORD_MAX_PAGE_SIZE);
}

function getPageCacheKey(page, pageSize) {
  return `${WORD_PAGE_CACHE_PREFIX}${page}_${pageSize}`;
}

function clearWordPageCache() {
  const storageInfo = wx.getStorageInfoSync();
  (storageInfo.keys || []).forEach((key) => {
    if (key.indexOf(WORD_PAGE_CACHE_PREFIX) === 0) {
      wx.removeStorageSync(key);
    }
  });
}

function getDetailCache() {
  return wx.getStorageSync(WORD_DETAIL_CACHE_KEY) || {};
}

function setDetailCache(cache) {
  wx.setStorageSync(WORD_DETAIL_CACHE_KEY, cache);
}

function cleanText(raw = "") {
  return String(raw || "")
    .replace(/\r/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function splitLines(raw = "", limit = 0) {
  const list = cleanText(raw)
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!limit) {
    return list;
  }
  return list.slice(0, limit);
}

function summarizeMeaning(item = {}) {
  const firstLine =
    splitLines(item.translation, 1)[0] ||
    splitLines(item.definition, 1)[0] ||
    splitLines(item.detail, 1)[0] ||
    "";
  if (!firstLine) {
    return "暂无释义";
  }
  return firstLine.length > 64 ? `${firstLine.slice(0, 64)}...` : firstLine;
}

function parsePosList(raw = "") {
  return cleanText(raw)
    .split(/[;,/、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildMeanings(item = {}) {
  const translationLines = splitLines(item.translation, 4);
  const definitionLines = splitLines(item.definition, 4);
  const detailLines = splitLines(item.detail, 4);
  const lines = translationLines.length ? translationLines : definitionLines.length ? definitionLines : detailLines;
  const posList = parsePosList(item.pos);

  return lines.map((line, index) => ({
    partOfSpeech: posList[index] || posList[0] || "",
    definition: line,
  }));
}

function parseForms(exchange = "", fallbackWord = "") {
  const raw = cleanText(exchange);
  if (!raw) {
    return guessWordForms(fallbackWord);
  }

  const labelMap = {
    "0": "原形",
    "1": "扩展",
    "3": "第三人称单数",
    d: "过去式",
    i: "现在分词",
    p: "过去分词",
    r: "比较级",
    s: "复数",
    t: "最高级",
  };

  const forms = [];
  raw.split("/").forEach((part) => {
    const [key, value] = part.split(":");
    if (!key || !value || !labelMap[key]) {
      return;
    }
    forms.push({
      label: labelMap[key],
      value: value.trim(),
    });
  });

  return forms.length ? forms : guessWordForms(fallbackWord);
}

function normalizeListItem(item = {}) {
  return {
    _id: item._id || "",
    word: String(item.word || "").trim(),
    phonetic: cleanText(item.phonetic) || "暂无",
    chineseMeaning: summarizeMeaning(item),
    pos: cleanText(item.pos),
    audio: item.audio || "",
    collins: Number(item.collins || 0),
    oxford: Number(item.oxford || 0),
    bnc: Number(item.bnc || 0),
    frq: Number(item.frq || 0),
  };
}

function normalizeDetail(item = {}) {
  const word = String(item.word || "").trim();
  return {
    word,
    phonetic: cleanText(item.phonetic) || "暂无",
    audio: item.audio || "",
    chineseMeaning: summarizeMeaning(item),
    meanings: buildMeanings(item),
    englishExample: "",
    chineseExample: "",
    forms: parseForms(item.exchange, word),
    detailText: cleanText(item.detail),
    definitionText: cleanText(item.definition),
    posText: cleanText(item.pos),
    tagText: cleanText(item.tag),
    collins: Number(item.collins || 0),
    oxford: Number(item.oxford || 0),
    bnc: Number(item.bnc || 0),
    frq: Number(item.frq || 0),
  };
}

function callWordFunction(data = {}) {
  if (!hasCloudEnv()) {
    return Promise.reject(new Error("cloud env unavailable"));
  }

  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: WORD_FUNCTION_NAME,
      data,
      success: (res) => {
        resolve(res.result || {});
      },
      fail: reject,
    });
  });
}

async function fetchWordBatch(options = {}) {
  const page = Math.max(Number(options.page) || 0, 0);
  const pageSize = clampPageSize(options.pageSize);
  const forceRefresh = Boolean(options.forceRefresh);
  const cacheKey = getPageCacheKey(page, pageSize);

  if (!forceRefresh) {
    const cached = wx.getStorageSync(cacheKey);
    if (cached && Array.isArray(cached.list) && cached.list.length) {
      return cached;
    }
  }

  const result = await callWordFunction({
    type: "listWords",
    page,
    limit: pageSize,
  });

  if (!result.success) {
    throw new Error(result.errMsg || "加载单词失败");
  }

  const list = (result.list || []).map(normalizeListItem);
  const payload = {
    page,
    pageSize,
    hasMore: Boolean(result.hasMore),
    list,
  };

  wx.setStorageSync(cacheKey, payload);
  return payload;
}

async function getWordDetail(rawWord, options = {}) {
  const word = String(rawWord || "").trim();
  const forceRefresh = Boolean(options.forceRefresh);
  if (!word) {
    throw new Error("单词不能为空");
  }

  const cacheKey = word.toLowerCase();
  const cache = getDetailCache();
  if (!forceRefresh && cache[cacheKey]) {
    return cache[cacheKey];
  }

  const result = await callWordFunction({
    type: "getWordDetail",
    word,
  });

  if (!result.success || !result.item) {
    throw new Error(result.errMsg || "获取单词详情失败");
  }

  const detail = normalizeDetail(result.item);
  cache[cacheKey] = detail;
  setDetailCache(cache);
  return detail;
}

async function getWordPreview(word) {
  const detail = await getWordDetail(word);
  return {
    word: detail.word,
    phonetic: detail.phonetic,
    audio: detail.audio,
    chineseMeaning: detail.chineseMeaning,
    pos: detail.posText,
  };
}

module.exports = {
  WORD_DETAIL_CACHE_KEY,
  WORD_DEFAULT_PAGE_SIZE,
  clearWordPageCache,
  fetchWordBatch,
  getWordDetail,
  getWordPreview,
};
