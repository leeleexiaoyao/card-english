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
