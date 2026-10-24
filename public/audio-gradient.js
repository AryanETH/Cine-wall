'use strict';

// Meter the existing playback graph; this never creates another audio player.
(function (root) {
  function create(element, router) {
    if (!element || !router || typeof root.requestAnimationFrame !== 'function') return { set() {} };
    const reducedMotion = root.matchMedia?.('(prefers-reduced-motion: reduce)');
    let active = false, frame = null, previous = 0, level = 0, height = 0.18, position = 0.5;
    let count = 1, screen = 1;
    function draw(now) {
      frame = null;
      const elapsed = previous ? Math.min(reducedMotion?.matches ? 150 : 100, now - previous) : 16;
      if (previous && reducedMotion?.matches && elapsed < 120) { frame = root.requestAnimationFrame(draw); return; }
      previous = now;
      const measured = active && !root.document.hidden ? router.levels() : { level: 0, position };
      const target = measured.level < 0.004 ? 0 : measured.level;
      // Frame-rate-independent envelopes soften peaks and stereo jumps while
      // keeping every movement tied to the signal, with no automatic sweep.
      level += (target - level) * (1 - Math.exp(-elapsed / (target > level ? 100 : active ? 300 : 180)));
      if (target > 0) position += (measured.position - position) * (1 - Math.exp(-elapsed / 230));
      if (level < 0.001) level = 0;
      height += (0.18 + Math.sqrt(level) * 0.82 - height) * (1 - Math.exp(-elapsed / 150));
      element.style.setProperty('--sound-level', level.toFixed(4));
      element.style.setProperty('--sound-height', height.toFixed(4));
      element.style.setProperty('--sound-x', `${((reducedMotion?.matches ? 0.5 : position) * count - screen + 1) * 100}%`);
      element.style.setProperty('--sound-span', String(count));
      if (active && !root.document.hidden || level > 0) frame = root.requestAnimationFrame(draw);
      else previous = 0;
    }
    function wake() { if (frame === null) frame = root.requestAnimationFrame(draw); }
    function set(playing, nextCount, nextScreen) {
      active = Boolean(playing);
      count = Math.max(1, Number(nextCount) || 1);
      screen = Math.max(1, Number(nextScreen) || 1);
      element.hidden = !active && level === 0;
      if (active || level > 0) wake();
    }
    root.document.addEventListener('visibilitychange', wake);
    root.addEventListener('pagehide', () => { active = false; if (frame !== null) root.cancelAnimationFrame(frame); frame = null; });
    return { set };
  }
  root.CineWallAudioGradient = { create };
})(typeof window !== 'undefined' ? window : globalThis);
