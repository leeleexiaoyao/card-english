const { getSettings } = require("../../utils/settings");
const { getWordDetail } = require("../../utils/dictionary");
const { createAudioOwner, playAudio: playGlobalAudio, stopAudio } = require("../../utils/audio-player");
const { tokenizeSentence } = require("../../utils/word");

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
  return tokenizeSentence(english).map((token) => ({
    text: token.text,
    highlighted: Boolean(token.isWord && targets.has(token.word)),
  }));
}

function decorateRelatedCards(detail = {}) {
  const cards = Array.isArray(detail.relatedCards) ? detail.relatedCards : [];
  const targets = buildHighlightTargets(detail);
  return cards.map((card) => ({
    ...card,
    englishSegments: buildEnglishSegments(card.english || "", targets),
  }));
}

Page({
  data: {
    loading: true,
    error: "",
    word: "",
    settings: getSettings(),
    detail: null,
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
  },

  onHide() {
    stopAudio(this.audioOwner);
  },

  onUnload() {
    stopAudio(this.audioOwner);
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
      const detail = await getWordDetail(word);
      const relatedCards = decorateRelatedCards(detail);
      this.setData({
        detail: {
          ...detail,
          relatedCards,
          hasRelatedCards: relatedCards.length > 0,
        },
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
