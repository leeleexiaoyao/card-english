Component({
  properties: {
    sentences: {
      type: Array,
      value: [],
    },
    currentSentence: {
      type: Object,
      value: null,
    },
    counts: {
      type: Object,
      value: null,
    },
    currentIndex: {
      type: Number,
      value: 0,
    },
    swiperCurrent: {
      type: Number,
      value: 0,
    },
    imageHintDismissed: {
      type: Boolean,
      value: false,
    },
    disableTouch: {
      type: Boolean,
      value: false,
    },
    showTopActions: {
      type: Boolean,
      value: false,
    },
    defaultShowChinese: {
      type: Boolean,
      value: false,
    },
    audioAutoPlayMode: {
      type: String,
      value: "off",
    },
  },

  methods: {
    onSwiperChange(event) {
      this.triggerEvent("swiperchange", event.detail);
    },

    onSwiperAnimationFinish(event) {
      this.triggerEvent("swiperanimationfinish", event.detail);
    },

    onTapImage(event) {
      this.triggerEvent("tapimage", event.currentTarget.dataset);
    },

    onPlaySentenceAudio() {
      this.triggerEvent("playsentenceaudio");
    },

    onImageLoad(event) {
      this.triggerEvent("imageload", event.detail);
    },

    onImageError(event) {
      this.triggerEvent("imageerror", event.detail);
    },

    onTapWord(event) {
      this.triggerEvent("tapword", event.currentTarget.dataset);
    },

    onPlayChineseAudio(event) {
      this.triggerEvent("playchineseaudio", event.currentTarget.dataset);
    },

    onToggleDefaultShowChinese() {
      this.triggerEvent("toggledefaultshowchinese");
    },

    onCopyEnglish() {
      this.triggerEvent("copyenglish");
    },

    onCycleAudioPlayMode() {
      this.triggerEvent("cycleaudioplaymode");
    },

    onGoBack() {
      this.triggerEvent("goback");
    },

    onMarkUnmastered() {
      this.triggerEvent("markunmastered");
    },

    onMarkMastered() {
      this.triggerEvent("markmastered");
    },

    onToggleFavorited() {
      this.triggerEvent("togglefavorited");
    },

    noop() {},
  },
});
