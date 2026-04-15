const {
  FREE_DAILY_SENTENCE_LIMIT,
  LIFETIME_VIP_PRICE_FEN,
  getCurrentUserMembership,
  getMembershipLabel,
  getRemainingFreeCount,
  isVipUser,
  syncAppUser,
  canUseVirtualPayment,
} = require("../../utils/membership");

const VIP_BENEFITS = [
  "无限查看全部卡片",
  "继续使用句库与单词能力",
  "无广告体验",
  "学习报告权益",
  "后续更多音色自动解锁",
];
const POLL_DELAY_MS = 1500;
const POLL_MAX_TIMES = 6;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

Page({
  data: {
    loading: true,
    paying: false,
    profile: null,
    memberLabel: "普通用户",
    remainingCount: FREE_DAILY_SENTENCE_LIMIT,
    vipBenefits: VIP_BENEFITS,
    priceText: `${LIFETIME_VIP_PRICE_FEN / 100}`,
    statusMessage: "",
  },

  onShow() {
    this.loadMembership();
  },

  async loadMembership(forceRefresh = false) {
    this.setData({
      loading: true,
    });
    try {
      const user = await getCurrentUserMembership(forceRefresh);
      this.applyMembership(user);
    } catch (err) {
      this.setData({
        statusMessage: "会员信息加载失败",
      });
    } finally {
      this.setData({
        loading: false,
      });
    }
  },

  applyMembership(user) {
    this.setData({
      profile: user || null,
      memberLabel: getMembershipLabel(user),
      remainingCount: getRemainingFreeCount(user),
    });
  },

  async onOpenVip() {
    if (this.data.paying) {
      return;
    }

    const latestUser = await getCurrentUserMembership(true);
    this.applyMembership(latestUser);
    if (isVipUser(latestUser)) {
      wx.showToast({
        title: "你已经是 VIP",
        icon: "none",
      });
      return;
    }

    if (!canUseVirtualPayment()) {
      wx.showToast({
        title: "当前客户端暂不支持虚拟支付",
        icon: "none",
      });
      return;
    }

    this.setData({
      paying: true,
      statusMessage: "",
    });

    try {
      const loginRes = await new Promise((resolve, reject) => {
        wx.login({
          success: resolve,
          fail: reject,
        });
      });

      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "createVipOrder",
          code: loginRes.code || "",
        },
      });
      const payload = res.result || {};
      if (!payload.success) {
        throw new Error(payload.errMsg || "支付准备失败");
      }

      await new Promise((resolve, reject) => {
        wx.requestVirtualPayment({
          ...(payload.paymentArgs || {}),
          success: resolve,
          fail: reject,
        });
      });

      const finalResult = await this.pollOrderStatus(payload.orderNo);
      if (!finalResult.success || !finalResult.paid) {
        throw new Error(finalResult.errMsg || "支付结果确认失败");
      }

      if (finalResult.user) {
        syncAppUser(finalResult.user);
        this.applyMembership(finalResult.user);
      } else {
        await this.loadMembership(true);
      }

      this.setData({
        statusMessage: "VIP 已开通，全部卡片已解锁",
      });
      wx.showToast({
        title: "开通成功",
        icon: "success",
      });
    } catch (err) {
      const message = String((err && err.errMsg) || (err && err.message) || err || "");
      if (message.includes("cancel") || message.includes("-2")) {
        wx.showToast({
          title: "已取消支付",
          icon: "none",
        });
      } else {
        this.setData({
          statusMessage: message || "支付失败，请稍后重试",
        });
        wx.showToast({
          title: message || "支付失败",
          icon: "none",
        });
      }
    } finally {
      this.setData({
        paying: false,
      });
    }
  },

  async pollOrderStatus(orderNo) {
    if (!orderNo) {
      return {
        success: false,
        errMsg: "订单号缺失",
      };
    }
    for (let i = 0; i < POLL_MAX_TIMES; i += 1) {
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "queryVipOrder",
          orderNo,
        },
      });
      const result = res.result || {};
      if (result.paid || result.status === "paid") {
        return result;
      }
      await wait(POLL_DELAY_MS);
    }
    return {
      success: false,
      errMsg: "支付结果确认超时，请稍后重试",
    };
  },
});
