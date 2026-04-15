// app.js
App({
  async ensureOpenId(forceRefresh = false) {
    const cachedOpenId = !forceRefresh ? wx.getStorageSync("user_openid_v1") : "";
    if (cachedOpenId) {
      this.globalData.openid = cachedOpenId;
      return cachedOpenId;
    }
    if (!wx.cloud || !this.globalData.env) {
      return "";
    }
    try {
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getOpenId",
        },
      });
      const openid = (res.result && res.result.openid) || "";
      if (openid) {
        this.globalData.openid = openid;
        wx.setStorageSync("user_openid_v1", openid);
      }
      return openid;
    } catch (err) {
      return "";
    }
  },

  onLaunch: function () {
    const cachedSettings = wx.getStorageSync("user_settings_v1") || {};
    this.globalData = {
      // env 参数说明：
      // env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会请求到哪个云环境的资源
      // 此处请填入环境 ID, 环境 ID 可在微信开发者工具右上顶部工具栏点击云开发按钮打开获取
      env: "cloud1-4gsbdd828457096e",
      openid: "",
      settings: {
        autoPlayAudio: false,
        defaultShowChinese: false,
        playRate: 1,
        voiceGender: "female",
        speechRate: 5,
        ...cachedSettings,
      },
    };
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }

    if (wx.setInnerAudioOption) {
      wx.setInnerAudioOption({
        obeyMuteSwitch: false,
        mixWithOther: true,
      });
    }

    this.ensureOpenId();
  },
});
