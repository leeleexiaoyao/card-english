const { getSettings } = require("./settings");

const TTS_CACHE_KEY = "sentence_tts_cache_v2";
const TTS_TOKEN_CACHE_KEY = "sentence_tts_token_v1";
const BAIDU_TTS_FUNCTION_NAME = "baiduTts";
const BAIDU_TTS_URL = "https://tsn.baidu.com/text2audio";

function getTtsCache() {
  return wx.getStorageSync(TTS_CACHE_KEY) || {};
}

function setTtsCache(cache) {
  wx.setStorageSync(TTS_CACHE_KEY, cache);
}

function getTokenCache() {
  return wx.getStorageSync(TTS_TOKEN_CACHE_KEY) || {};
}

function setTokenCache(cache) {
  wx.setStorageSync(TTS_TOKEN_CACHE_KEY, cache);
}

function hashText(text = "") {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return `tts_${Math.abs(hash)}`;
}

function buildCacheKey(text, voiceGender, speechRate) {
  return `${hashText(text)}_${voiceGender}_${speechRate}`;
}

function canUseSavedFile(path) {
  if (!path) {
    return false;
  }
  try {
    wx.getFileSystemManager().accessSync(path);
    return true;
  } catch (err) {
    return false;
  }
}

function saveTempFile(tempFilePath, key) {
  return new Promise((resolve, reject) => {
    if (!tempFilePath) {
      reject(new Error("empty temp file"));
      return;
    }
    const targetPath = `${wx.env.USER_DATA_PATH}/${key}.mp3`;
    if (canUseSavedFile(targetPath)) {
      resolve(targetPath);
      return;
    }
    wx.saveFile({
      tempFilePath,
      filePath: targetPath,
      success: (res) => resolve(res.savedFilePath || targetPath || tempFilePath),
      fail: (err) => {
        if (canUseSavedFile(targetPath)) {
          resolve(targetPath);
          return;
        }
        reject(err);
      },
    });
  });
}

function writeBase64AudioFile(base64Data, key) {
  return new Promise((resolve, reject) => {
    if (!base64Data) {
      reject(new Error("empty audio base64"));
      return;
    }
    const targetPath = `${wx.env.USER_DATA_PATH}/${key}.mp3`;
    if (canUseSavedFile(targetPath)) {
      resolve(targetPath);
      return;
    }
    wx.getFileSystemManager().writeFile({
      filePath: targetPath,
      data: base64Data,
      encoding: "base64",
      success: () => resolve(targetPath),
      fail: reject,
    });
  });
}

function writeArrayBufferAudioFile(arrayBuffer, key) {
  return new Promise((resolve, reject) => {
    if (!arrayBuffer || !arrayBuffer.byteLength) {
      reject(new Error("empty audio buffer"));
      return;
    }
    const targetPath = `${wx.env.USER_DATA_PATH}/${key}.mp3`;
    if (canUseSavedFile(targetPath)) {
      resolve(targetPath);
      return;
    }
    wx.getFileSystemManager().writeFile({
      filePath: targetPath,
      data: arrayBuffer,
      success: () => resolve(targetPath),
      fail: reject,
    });
  });
}

function buildFormBody(data = {}) {
  return Object.keys(data)
    .map((key) => `${key}=${encodeURIComponent(data[key])}`)
    .join("&");
}

function arrayBufferToString(arrayBuffer) {
  if (!arrayBuffer) {
    return "";
  }
  const uint8Array = new Uint8Array(arrayBuffer);
  let result = "";
  for (let i = 0; i < uint8Array.length; i += 1) {
    result += String.fromCharCode(uint8Array[i]);
  }
  try {
    return decodeURIComponent(escape(result));
  } catch (err) {
    return result;
  }
}

function getAudioContentType(header = {}) {
  return String(
    header["content-type"] || header["Content-Type"] || header.contentType || ""
  ).toLowerCase();
}

function callBaiduTtsCloudFunction(data) {
  return new Promise((resolve, reject) => {
    const app = getApp();
    if (!wx.cloud || !app || !app.globalData || !app.globalData.env) {
      reject(new Error("cloud env not configured"));
      return;
    }
    console.log("Calling cloud function with data:", data);
    wx.cloud.callFunction({
      name: BAIDU_TTS_FUNCTION_NAME,
      data,
      success: (res) => {
        console.log("Cloud function response:", res);
        const result = res.result || {};
        if (!result.success) {
          reject(new Error(result.error || "baidu tts failed"));
          return;
        }
        resolve(result);
      },
      fail: (err) => {
        console.error("Cloud function call failed:", err);
        reject(err);
      },
    });
  });
}

async function getSentenceTtsPath(text, options = {}) {
  const content = String(text || "").trim();
  if (!content) {
    throw new Error("empty text");
  }

  const settings = getSettings();
  const voiceGender = options.voiceGender || settings.voiceGender || "female";
  const speechRate = Number(options.speechRate || settings.speechRate || 5);
  const cacheKey = buildCacheKey(content, voiceGender, speechRate);
  const cache = getTtsCache();
  const cachedPath = cache[cacheKey];
  if (canUseSavedFile(cachedPath)) {
    return cachedPath;
  }

  async function resolveFromCloud() {
    const result = await callBaiduTtsCloudFunction({
      type: "synthesize",
      text: content,
      voiceGender,
      speed: speechRate
    });
    const finalPath = await writeBase64AudioFile(result.audioBase64, cacheKey);
    cache[cacheKey] = finalPath;
    setTtsCache(cache);
    return finalPath;
  }

  try {
    return await resolveFromCloud();
  } catch (err) {
    console.error("[tts] getSentenceTtsPath failed", {
      text: content,
      voiceGender,
      speechRate,
      err,
    });
    throw err;
  }
}

function clearTtsCache() {
  const cache = getTtsCache();
  const fs = wx.getFileSystemManager();
  Object.keys(cache).forEach((key) => {
    const path = cache[key];
    if (!path || !path.startsWith(wx.env.USER_DATA_PATH)) {
      return;
    }
    fs.unlink({
      filePath: path,
      fail: () => {},
    });
  });
  wx.removeStorageSync(TTS_CACHE_KEY);
  wx.removeStorageSync(TTS_TOKEN_CACHE_KEY);
}

module.exports = {
  TTS_CACHE_KEY,
  getSentenceTtsPath,
  clearTtsCache,
};
