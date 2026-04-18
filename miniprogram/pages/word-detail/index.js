const { getSettings } = require("../../utils/settings");
const { getWordDetail } = require("../../utils/dictionary");
const { createAudioOwner, playAudio: playGlobalAudio, stopAudio } = require("../../utils/audio-player");
const { tokenizeSentence } = require("../../utils/word");
const {
  DEFAULT_CUSTOM_WORD_TAG_NAME,
  batchGetWordMarks,
  getWordMarkMeta,
  normalizeWordKey,
  setWordMark,
} = require("../../utils/word-mark");

function buildHighlightTargets(detail = {}) {
  const targets = new Set();
  const baseWord = String(detail.word || "").trim().toLowerCase();
  if (baseWord) {
    targets.add(baseWord);
  }
  (detail.forms || []).forEach((form) => {
    const value = String((form && form.value) || "").trim().toLowerCase();
    if (value) {
      targets.add(value);
    }
  });
  return targets;
}

function buildEnglishSegments(english = "", targets = new Set()) {
  return tokenizeSentence(english).reduce((segments, token) => {
    if (token.isWord) {
      segments.push({
        text: token.text,
        highlighted: targets.has(token.word),
      });
      return segments;
    }

    if (!segments.length) {
      segments.push({
        text: token.text,
        highlighted: false,
      });
      return segments;
    }

    segments[segments.length - 1].text += token.text;
    return segments;
  }, []);
}

function decorateRelatedCards(detail = {}) {
  const cards = Array.isArray(detail.relatedCards) ? detail.relatedCards : [];
  const targets = buildHighlightTargets(detail);
  return cards.map((card) => ({
    ...card,
    englishSegments: buildEnglishSegments(card.english || "", targets),
  }));
}

function decorateWordDetail(detail = {}, markState = {}) {
  const relatedCards = decorateRelatedCards(detail);
  return {
    ...detail,
    relatedCards,
    hasRelatedCards: relatedCards.length > 0,
    favorited: Boolean(markState.favorited || detail.favorited),
    customTagged: Boolean(markState.customTagged || detail.customTagged),
  };
}

Page({
  data: {
    loading: true,
    error: "",
    word: "",
    settings: getSettings(),
    detail: null,
    isVip: false,
    customWordTagName: DEFAULT_CUSTOM_WORD_TAG_NAME,
  },

  onLoad(options) {
    this.audioOwner = createAudioOwner("word_detail");
    const word = decodeURIComponent(options.word || "");
    this.setData({
      word,
    });
    this.loadDetail(word);
  },

  onShow() {
    this.setData({
      settings: getSettings(),
    });
    this.refreshWordMarkMeta();
  },

  onHide() {
    stopAudio(this.audioOwner);
  },

  onUnload() {
    stopAudio(this.audioOwner);
  },

  requireActionAuth() {
    const app = getApp();
    if (!app || typeof app.requireAuth !== "function") {
      return true;
    }
    return app.requireAuth({
      route: "pages/word-detail/index",
      params: {
        word: this.data.word,
      },
    });
  },

  async refreshWordMarkMeta() {
    const detail = this.data.detail;
    const word = detail && detail.word;
    const meta = await getWordMarkMeta();
    const nextData = {
      isVip: Boolean(meta.isVip),
      customWordTagName: meta.customWordTagName || DEFAULT_CUSTOM_WORD_TAG_NAME,
    };
    if (!word) {
      this.setData(nextData);
      return;
    }
    const markMap = await batchGetWordMarks([word]);
    const markState = markMap[normalizeWordKey(word)] || {};
    this.setData({
      ...nextData,
      detail: decorateWordDetail(detail, markState),
    });
  },

  async loadDetail(word) {
    if (!word) {
      this.setData({
        loading: false,
        error: "无效单词",
      });
      return;
    }
    this.setData({
      loading: true,
      error: "",
    });
    try {
      const [detail, meta, markMap] = await Promise.all([
        getWordDetail(word),
        getWordMarkMeta(),
        batchGetWordMarks([word], {
          forceRefresh: true,
        }),
      ]);
      const markState = markMap[normalizeWordKey(word)] || {};
      this.setData({
        detail: decorateWordDetail(detail, markState),
        isVip: Boolean(meta.isVip),
        customWordTagName: meta.customWordTagName || DEFAULT_CUSTOM_WORD_TAG_NAME,
      });
    } catch (err) {
      this.setData({
        error: "获取单词详情失败，请检查 words 集合数据",
      });
    } finally {
      this.setData({
        loading: false,
      });
    }
  },

  onPlayAudio() {
    const detail = this.data.detail;
    if (!detail || !detail.audio) {
      wx.showToast({
        title: "暂无音频",
        icon: "none",
      });
      return;
    }
    playGlobalAudio({
      src: detail.audio,
      playbackRate: Number(this.data.settings.playRate || 1),
      owner: this.audioOwner,
    });
  },

  async onToggleFavorite() {
    if (!this.requireActionAuth()) {
      return;
    }
    const detail = this.data.detail;
    if (!detail || !detail.word) {
      return;
    }
    const nextFavorited = !detail.favorited;
    this.setData({
      detail: {
        ...detail,
        favorited: nextFavorited,
      },
    });
    try {
      const state = await setWordMark({
        word: detail.word,
        favorited: nextFavorited,
      });
      this.setData({
        detail: {
          ...this.data.detail,
          favorited: state.favorited,
          customTagged: state.customTagged,
        },
      });
      wx.showToast({
        title: nextFavorited ? "已收藏" : "取消收藏",
        icon: "none",
      });
    } catch (err) {
      this.setData({
        detail,
      });
      wx.showToast({
        title: "更新收藏失败",
        icon: "none",
      });
    }
  },

  async onToggleCustomTag() {
    if (!this.requireActionAuth()) {
      return;
    }
    const detail = this.data.detail;
    if (!detail || !detail.word) {
      return;
    }
    const nextCustomTagged = !detail.customTagged;
    this.setData({
      detail: {
        ...detail,
        customTagged: nextCustomTagged,
      },
    });
    try {
      const state = await setWordMark({
        word: detail.word,
        customTagged: nextCustomTagged,
      });
      this.setData({
        detail: {
          ...this.data.detail,
          favorited: state.favorited,
          customTagged: state.customTagged,
        },
      });
      wx.showToast({
        title: nextCustomTagged ? `已加入${this.data.customWordTagName}` : `已移出${this.data.customWordTagName}`,
        icon: "none",
      });
    } catch (err) {
      this.setData({
        detail,
      });
      wx.showToast({
        title: "更新标签失败",
        icon: "none",
      });
    }
  },

  onTapRelatedCard(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) {
      return;
    }
    wx.navigateTo({
      url: `/pages/sentence-detail/index?id=${encodeURIComponent(id)}`,
    });
  },
});
