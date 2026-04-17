const { guessWordForms, tokenizeSentence } = require("./word");

const WORD_PAGE_CACHE_PREFIX = "word_page_cache_v6_";
const WORD_DETAIL_CACHE_KEY = "word_detail_cache_v7";
const WORD_DEFAULT_PAGE_SIZE = 50;
const WORD_MAX_PAGE_SIZE = 100;
const WORD_SEARCH_LIMIT = 50;
const WORD_FUNCTION_NAME = "quickstartFunctions";
let sentenceBankCache = null;
let cardImagePoolCache = null;

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

function formatPhonetic(raw = "") {
  const cleaned = cleanText(raw);
  if (!cleaned) {
    return "";
  }
  const core = cleaned.replace(/^[/\[]+|[/\]]+$/g, "").trim();
  return core ? `/${core}/` : "";
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

function summarizeTranslation(raw = "") {
  const firstLine = splitLines(raw, 1)[0] || "";
  if (!firstLine) {
    return "暂无释义";
  }
  return firstLine.length > 96 ? `${firstLine.slice(0, 96)}...` : firstLine;
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

function formatForms(forms = []) {
  return forms
    .filter((item) => item && item.label && item.value)
    .map((item) => `${item.label}：${item.value}`)
    .join("\n");
}

function buildRelatedCards(item = {}) {
  const word = String(item.word || "").trim().toLowerCase();
  if (!word) {
    return [];
  }

  if (!sentenceBankCache) {
    sentenceBankCache = require("../data/sentenceBank").sentenceBank;
  }
  if (!cardImagePoolCache) {
    cardImagePoolCache = require("../data/cardImagePool").cardImagePool;
  }

  const forms = parseForms(item.exchange, word);
  const targets = new Set([word]);
  forms.forEach((form) => {
    const value = String((form && form.value) || "").trim().toLowerCase();
    if (value) {
      targets.add(value);
    }
  });

  return sentenceBankCache
    .map((sentence, index) => {
      const order = sentence.order || index + 1;
      const fallbackImageUrl =
        Array.isArray(cardImagePoolCache) && order > 0 && order <= cardImagePoolCache.length
          ? cardImagePoolCache[order - 1]
          : "";
      return {
        id: sentence.id || sentence._id || `sentence-${order}`,
        _id: sentence._id || sentence.id || `sentence-${order}`,
        order,
        english: sentence.english || "",
        chinese: sentence.chinese || "",
        imageUrl: sentence.imageUrl || sentence.image || fallbackImageUrl,
      };
    })
    .filter((sentence) => {
      const tokens = tokenizeSentence(sentence.english)
        .filter((token) => token.isWord)
        .map((token) => token.word);
      return tokens.some((token) => targets.has(token));
    })
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function normalizeListItem(item = {}) {
  return {
    _id: item._id || "",
    word: String(item.word || "").trim(),
    phonetic: formatPhonetic(item.phonetic),
    translationText: summarizeTranslation(item.translation || item.definition || item.detail || ""),
    tagText: cleanText(item.tag),
    chineseMeaning: summarizeMeaning(item),
    pos: cleanText(item.pos),
    favorited: Boolean(item.favorited),
    customTagged: Boolean(item.customTagged),
    audio: item.audio || "",
    collins: Number(item.collins || 0),
    oxford: Number(item.oxford || 0),
    bnc: Number(item.bnc || 0),
    frq: Number(item.frq || 0),
  };
}

function normalizeDetail(item = {}) {
  const word = String(item.word || "").trim();
  const forms = parseForms(item.exchange, word);
  return {
    word,
    phonetic: formatPhonetic(item.phonetic),
    audio: item.audio || "",
    chineseMeaning: summarizeMeaning(item),
    meanings: buildMeanings(item),
    englishExample: "",
    chineseExample: "",
    forms,
    translationText: cleanText(item.translation),
    exchangeText: cleanText(item.exchange) || formatForms(forms),
    definitionText: cleanText(item.definition),
    posText: cleanText(item.pos),
    tagText: cleanText(item.tag),
    relatedCards: buildRelatedCards(item),
    favorited: Boolean(item.favorited),
    customTagged: Boolean(item.customTagged),
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
    list: list.filter((item) => !isHiddenWordEntry(item)),
  };

  wx.setStorageSync(cacheKey, payload);
  return payload;
}

async function searchWords(keyword, options = {}) {
  const normalizedKeyword = String(keyword || "").trim();
  if (!normalizedKeyword) {
    return {
      keyword: "",
      list: [],
    };
  }

  const limit = Math.min(Math.max(Number(options.limit) || WORD_SEARCH_LIMIT, 1), WORD_SEARCH_LIMIT);
  const result = await callWordFunction({
    type: "searchWords",
    keyword: normalizedKeyword,
    limit,
  });

  if (!result.success) {
    throw new Error(result.errMsg || "搜索单词失败");
  }

  return {
    keyword: result.keyword || normalizedKeyword.toLowerCase(),
    list: (result.list || [])
      .map(normalizeListItem)
      .filter((item) => !isHiddenWordEntry(item)),
  };
}

async function listMarkedWords(options = {}) {
  const page = Math.max(Number(options.page) || 0, 0);
  const pageSize = clampPageSize(options.pageSize);
  const filter = String(options.filter || "").trim();
  if (!filter) {
    return {
      page,
      pageSize,
      hasMore: false,
      list: [],
    };
  }

  const result = await callWordFunction({
    type: "listMarkedWords",
    filter,
    page,
    limit: pageSize,
  });

  if (!result.success) {
    throw new Error(result.errMsg || "加载标记单词失败");
  }

  const list = (result.list || [])
    .map(normalizeListItem)
    .filter((item) => !isHiddenWordEntry(item));

  return {
    page,
    pageSize,
    hasMore: Boolean(result.hasMore),
    list,
  };
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

  if (isHiddenWordEntry(result.item)) {
    throw new Error("该条目已隐藏");
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
    translationText: detail.translationText || detail.chineseMeaning,
    chineseMeaning: detail.translationText || detail.chineseMeaning,
    pos: detail.posText,
    tagText: detail.tagText,
  };
}

module.exports = {
  WORD_DETAIL_CACHE_KEY,
  WORD_DEFAULT_PAGE_SIZE,
  clearWordPageCache,
  fetchWordBatch,
  getWordDetail,
  getWordPreview,
  listMarkedWords,
  searchWords,
};
