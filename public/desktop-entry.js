'use strict';
(() => {
  if (window.CineWallDeviceSupport?.restricted) return;
  const entry = document.createElement('script');
  entry.src = document.currentScript.dataset.src;
  entry.async = false;
  document.body.append(entry);
})();
