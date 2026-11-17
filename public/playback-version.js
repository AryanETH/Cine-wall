'use strict';
// The dashboard and numbered players must compare the same shipped build.
(function (root) {
  const version = { build: '2026.11.17-playback-recovery' };
  if (typeof module !== 'undefined' && module.exports) module.exports = version;
  else root.CineWallPlayback = version;
})(typeof window !== 'undefined' ? window : globalThis);
