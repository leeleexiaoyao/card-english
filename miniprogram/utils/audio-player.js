let audioContext = null;
let currentOwner = "";
let ownerSeed = 0;
let pendingStopOwner = "";
const audioEventListeners = new Set();

function emitAudioEvent(event) {
  audioEventListeners.forEach((listener) => {
    try {
      listener(event);
    } catch (err) {
      console.error("[audio-player] listener failed", err);
    }
  });
}

function clearCurrentOwner(targetOwner) {
  if (currentOwner === targetOwner) {
    currentOwner = "";
  }
}

function ensureAudioContext() {
  if (audioContext) {
    return audioContext;
  }

  audioContext = wx.createInnerAudioContext();
  audioContext.obeyMuteSwitch = false;
  audioContext.onEnded(() => {
    const owner = currentOwner;
    currentOwner = "";
    pendingStopOwner = "";
    emitAudioEvent({
      type: "ended",
      owner,
    });
  });
  audioContext.onStop(() => {
    const owner = pendingStopOwner || currentOwner;
    pendingStopOwner = "";
    clearCurrentOwner(owner);
    emitAudioEvent({
      type: "stop",
      owner,
    });
  });
  audioContext.onError((error) => {
    const owner = pendingStopOwner || currentOwner;
    pendingStopOwner = "";
    clearCurrentOwner(owner);
    emitAudioEvent({
      type: "error",
      owner,
      error,
    });
  });

  return audioContext;
}

function createAudioOwner(prefix = "audio") {
  ownerSeed += 1;
  return `${prefix}_${Date.now()}_${ownerSeed}`;
}

function addAudioEventListener(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  audioEventListeners.add(listener);
  return () => {
    audioEventListeners.delete(listener);
  };
}

function playAudio(options = {}) {
  const src = String(options.src || "").trim();
  if (!src) {
    return false;
  }

  const context = ensureAudioContext();
  if (currentOwner || context.src) {
    pendingStopOwner = currentOwner;
    context.stop();
    context.src = "";
  }
  currentOwner = String(options.owner || "");
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

  pendingStopOwner = owner || currentOwner;
  audioContext.stop();
  audioContext.src = "";
  clearCurrentOwner(owner || currentOwner);
}

module.exports = {
  addAudioEventListener,
  createAudioOwner,
  playAudio,
  stopAudio,
};
