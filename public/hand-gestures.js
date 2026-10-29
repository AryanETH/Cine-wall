'use strict';
(() => {
  const steps = [
    { id: 'play', label: 'Open_Palm', icon: '✋', title: 'Play', pose: 'Open palm', instruction: 'Face an open palm toward the camera.' },
    { id: 'pause', label: 'Closed_Fist', icon: '✊', title: 'Pause', pose: 'Closed fist', instruction: 'Close your hand into a fist.' },
    { id: 'volume-up', label: 'Thumb_Up', icon: '👍', title: 'Volume up', pose: 'Thumbs up', instruction: 'Point your thumb up. Volume changes by 10%.' },
    { id: 'volume-down', label: 'Thumb_Down', icon: '👎', title: 'Volume down', pose: 'Thumbs down', instruction: 'Point your thumb down. Volume changes by 10%.' },
    { id: 'forward', label: 'Victory', icon: '✌️', title: 'Forward 10 seconds', pose: 'Victory sign', instruction: 'Raise your index and middle fingers in a V.' },
    { id: 'back', label: 'ILoveYou', icon: '🤟', title: 'Back 10 seconds', pose: 'Three-finger sign', instruction: 'Raise your thumb, index and little finger. Fold the other two.' }
  ];
  function labelFromResult(result) {
    if (result?.landmarks?.length !== 1 || result?.gestures?.length !== 1) return '';
    const best = result.gestures[0]?.[0];
    return best?.score >= .7 && steps.some(step => step.label === best.categoryName) ? best.categoryName : '';
  }
  // A gesture must stay stable; each action needs a neutral interval before re-arming.
  class HoldGate {
    constructor() { this.reset(); }
    reset() { this.label = ''; this.since = 0; this.last = -Infinity; this.armed = true; this.neutral = null; }
    push(label, now) {
      if (now - this.last > 350) { this.label = ''; this.since = now; this.neutral = null; }
      this.last = now;
      if (!label) {
        this.label = ''; this.since = now;
        if (this.neutral === null) this.neutral = now;
        if (now - this.neutral >= 400) this.armed = true;
        return { progress: 0, release: !this.armed };
      }
      this.neutral = null;
      if (!this.armed) return { progress: 0, release: true };
      if (this.label !== label) { this.label = label; this.since = now; }
      const progress = Math.min(1, (now - this.since) / 650);
      if (progress < 1) return { progress, release: false };
      this.armed = false;
      return { progress: 1, action: steps.find(step => step.label === label)?.id, release: true };
    }
  }
  class Practice {
    constructor() { this.index = 0; }
    get step() { return steps[this.index]; }
    match(action) {
      if (this.step?.id !== action) return false;
      this.index++;
      return true;
    }
    get done() { return this.index === steps.length; }
  }
  const api = { steps, labelFromResult, HoldGate, Practice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CineWallHandGestures = api;
})();
