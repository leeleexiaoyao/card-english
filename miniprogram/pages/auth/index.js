Page({
  data: {
    loggingIn: false,
  },

  onShow() {
    const app = getApp();
    if (app && typeof app.isAuthenticated === "function" && app.isAuthenticated()) {
      app.returnToAuthSource();
    }
  },

  onBackTap() {
    const app = getApp();
    if (app && typeof app.returnToAuthSource === "function") {
      app.returnToAuthSource();
    }
  },

  onLoginTap() {
    if (this.data.loggingIn) {
      return;
    }
    this.setData({
      loggingIn: true,
    });
    wx.showLoading({
      title: "登录中",
      mask: true,
    });
    const app = getApp();
    const cachedUser = app && typeof app.getCachedUser === "function" ? app.getCachedUser() : null;
    if (cachedUser && cachedUser.openid) {
      Promise.resolve()
        .then(() => app.beginLogin())
        .then((user) => {
          if (user && !user.profileCompleted) {
            wx.showToast({
              title: "请在我的页完善头像昵称",
              icon: "none",
            });
          }
          app.returnToAuthSource();
        })
        .catch((err) => {
          console.error("[auth] login failed", err);
          wx.showToast({
            title: (err && err.errMsg) || "登录失败",
            icon: "none",
          });
        })
        .finally(() => {
          this.setData({
            loggingIn: false,
          });
          wx.hideLoading();
        });
      return;
    }

    wx.getUserProfile({
      desc: "用于登录并同步头像昵称",
      success: async (res) => {
        try {
          const user = await app.completeLoginWithUserProfile(res.userInfo || {});
          if (user && !user.profileCompleted) {
            wx.showToast({
              title: "请在我的页完善头像昵称",
              icon: "none",
            });
          }
          app.returnToAuthSource();
        } catch (err) {
          console.error("[auth] login failed", err);
          wx.showToast({
            title: (err && err.errMsg) || "登录失败",
            icon: "none",
          });
        } finally {
          this.setData({
            loggingIn: false,
          });
          wx.hideLoading();
        }
      },
      fail: () => {
        this.setData({
          loggingIn: false,
        });
        wx.hideLoading();
        wx.showToast({
          title: "请先完成微信登录",
          icon: "none",
        });
      },
    });
  },
});
