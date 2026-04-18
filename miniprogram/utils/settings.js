const SETTINGS_KEY = "user_settings_v1";

const DEFAULT_SETTINGS = {
  speakChinese: false,
  audioAutoPlayMode: "off",
  defaultShowChinese: false,
  playRate: 1,
  voiceGender: "female",
  speechRate: 5,
};

function normalizeAudioAutoPlayMode(mode) {
  if (mode === "single" || mode === "five" || mode === "loop" || mode === "off") {
    return mode;
  }
  return "off";
}

function normalizeSettings(rawSettings = {}) {
  const nextSettings = {
    ...rawSettings,
  };

  if (!nextSettings.audioAutoPlayMode) {
    const legacyCount = String(nextSettings.audioPlayCount || "1");
    if (legacyCount === "5") {
      nextSettings.audioAutoPlayMode = "five";
    } else if (legacyCount === "loop") {
      nextSettings.audioAutoPlayMode = "loop";
    } else if (typeof nextSettings.autoPlayAudio === "boolean" || typeof nextSettings.loopPlayback === "boolean") {
      if (nextSettings.autoPlayAudio === false) {
        nextSettings.audioAutoPlayMode = "off";
      } else if (nextSettings.loopPlayback === true) {
        nextSettings.audioAutoPlayMode = "loop";
      } else if (nextSettings.autoPlayAudio === true) {
        nextSettings.audioAutoPlayMode = "single";
      }
    }
  }

  nextSettings.audioAutoPlayMode = normalizeAudioAutoPlayMode(nextSettings.audioAutoPlayMode);
  nextSettings.autoPlayAudio = nextSettings.audioAutoPlayMode !== "off";
  nextSettings.loopPlayback = nextSettings.audioAutoPlayMode === "loop";

  delete nextSettings.audioPlayCount;

  return {
    ...DEFAULT_SETTINGS,
    ...nextSettings,
  };
}

function getSettings() {
  const local = wx.getStorageSync(SETTINGS_KEY) || {};
  return normalizeSettings(local);
}

function saveSettings(nextSettings) {
  const merged = normalizeSettings(nextSettings);
  wx.setStorageSync(SETTINGS_KEY, merged);
  const app = getApp();
  if (app && app.globalData) {
    app.globalData.settings = merged;
  }
  return merged;
}

function updateSettings(patch) {
  const current = getSettings();
  return saveSettings({
    ...current,
    ...patch,
  });
}

module.exports = {
  SETTINGS_KEY,
  DEFAULT_SETTINGS,
  normalizeSettings,
  getSettings,
  saveSettings,
  updateSettings,
};
