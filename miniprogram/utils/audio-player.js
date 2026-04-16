let audioContext = null;
let currentOwner = "";
let ownerSeed = 0;

function ensureAudioContext() {
  if (audioContext) {
    return audioContext;
  }

  audioContext = wx.createInnerAudioContext();
  audioContext.obeyMuteSwitch = false;
  audioContext.onEnded(() => {
    currentOwner = "";
  });
  audioContext.onError(() => {
    currentOwner = "";
  });

  return audioContext;
}

function createAudioOwner(prefix = "audio") {
  ownerSeed += 1;
  return `${prefix}_${Date.now()}_${ownerSeed}`;
}

function playAudio(options = {}) {
  const src = String(options.src || "").trim();
  if (!src) {
    return false;
  }

  const context = ensureAudioContext();
  currentOwner = String(options.owner || "");
  context.stop();
  context.src = "";
  context.src = src;
  context.playbackRate = Number(options.playbackRate || 1);
  context.play();
  return true;
}

function stopAudio(owner = "") {
  if (!audioContext) {
    return;
  }
  if (owner && currentOwner && currentOwner !== owner) {
    return;
  }

  audioContext.stop();
  audioContext.src = "";
  currentOwner = "";
}

module.exports = {
  createAudioOwner,
  playAudio,
  stopAudio,
};
