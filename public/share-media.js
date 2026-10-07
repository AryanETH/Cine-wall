'use strict';
(() => {
  function qualityProfile(quality = 'auto', screens = 1) {
    const count = Math.max(1, Math.min(10, Number(screens) || 1));
    const height = quality === '720p' || quality === 'auto' && count >= 4 ? 720 : 1080;
    const fps = quality === 'auto' && count >= 6 ? 20 : 30;
    // Keep Auto's total video traffic within a modest Wi-Fi budget as viewers join.
    const bitrate = quality === '720p' ? 2000000 : quality === '1080p' ? 5000000 : Math.min(3500000, Math.floor(12000000 / count));
    return { height, fps, bitrate };
  }
  function tuneReceiver(receiver) {
    if (!receiver) return;
    // The same small target on audio and video preserves their browser-managed sync.
    try { if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = 60; } catch {}
    try { if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = .06; } catch {}
  }
  async function tuneSender(sender, { bitrate = 128000, fps } = {}) {
    try {
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) return;
      let changed = false;
      for (const encoding of parameters.encodings) {
        if (encoding.maxBitrate !== bitrate) { encoding.maxBitrate = bitrate; changed = true; }
        if (fps && encoding.maxFramerate !== fps) { encoding.maxFramerate = fps; changed = true; }
        if (sender.track?.kind === 'audio' && 'priority' in encoding && encoding.priority !== 'high') { encoding.priority = 'high'; changed = true; }
      }
      if (changed) await sender.setParameters(parameters);
    } catch { /* Older browsers retain their safe built-in settings. */ }
  }
  const helpers = { qualityProfile, tuneReceiver, tuneSender };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  else window.CineWallShareMedia = helpers;
})();
