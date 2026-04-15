const SETTINGS_KEY = "user_settings_v1";

const DEFAULT_SETTINGS = {
  autoPlayAudio: false,
  defaultShowChinese: false,
  playRate: 1,
  voiceGender: "female",
  speechRate: 5,
};

function getSettings() {
  const local = wx.getStorageSync(SETTINGS_KEY) || {};
  return {
    ...DEFAULT_SETTINGS,
    ...local,
  };
}

function saveSettings(nextSettings) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...nextSettings,
  };
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
  getSettings,
  saveSettings,
  updateSettings,
};
