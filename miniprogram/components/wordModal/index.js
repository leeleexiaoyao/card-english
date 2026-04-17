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
      value: "易错词",
    },
    queryWord: {
      type: String,
      value: "",
    },
  },
  methods: {
    noop() {},

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
