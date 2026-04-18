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

function decorateDetail(detail = null) {
  if (!detail) {
    return null;
  }
  const targets = buildHighlightTargets(detail);
  const relatedCards = Array.isArray(detail.relatedCards) ? detail.relatedCards : [];
  return {
    ...detail,
    relatedCards: relatedCards.map((card) => ({
      ...card,
      englishSegments: buildEnglishSegments(card.english || "", targets),
    })),
  };
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    loading: {
      type: Boolean,
      value: false,
    },
    error: {
      type: String,
      value: "",
    },
    detail: {
      type: Object,
      value: null,
    },
    isVip: {
      type: Boolean,
      value: false,
    },
    customWordTagName: {
      type: String,
      value: "已学",
    },
    queryWord: {
      type: String,
      value: "",
    },
    showRelatedCards: {
      type: Boolean,
      value: false,
    },
  },
  data: {
    displayDetail: null,
    rendered: false,
    closing: false,
  },
  observers: {
    detail(detail) {
      this.setData({
        displayDetail: decorateDetail(detail),
      });
    },
    visible(visible) {
      if (visible) {
        this.openModal();
        return;
      }
      this.closeModal();
    },
  },
  lifetimes: {
    attached() {
      if (this.data.visible) {
        this.setData({
          rendered: true,
          closing: false,
        });
      }
    },
    detached() {
      if (this.closeTimer) {
        clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }
    },
  },
  methods: {
    noop() {},

    openModal() {
      if (this.closeTimer) {
        clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }
      this.setData({
        rendered: true,
        closing: false,
      });
    },

    closeModal() {
      if (!this.data.rendered) {
        return;
      }
      if (this.closeTimer) {
        clearTimeout(this.closeTimer);
      }
      this.setData({
        closing: true,
      });
      this.closeTimer = setTimeout(() => {
        this.closeTimer = null;
        this.setData({
          rendered: false,
          closing: false,
        });
      }, 260);
    },

    onClose() {
      this.triggerEvent("close");
    },
    onPlayAudio() {
      const detail = this.data.detail || {};
      this.triggerEvent("playaudio", {
        audio: detail.audio || "",
      });
    },
    onToggleFavorite() {
      const detail = this.data.detail || {};
      this.triggerEvent("togglefavorite", {
        word: detail.word || "",
        favorited: Boolean(detail.favorited),
      });
    },
    onToggleCustomTag() {
      const detail = this.data.detail || {};
      this.triggerEvent("togglecustomtag", {
        word: detail.word || "",
        customTagged: Boolean(detail.customTagged),
      });
    },
    onOpenCard(e) {
      const { id } = (e && e.currentTarget && e.currentTarget.dataset) || {};
      if (!id) {
        return;
      }
      this.triggerEvent("opencard", {
        id,
      });
    },
  },
});
