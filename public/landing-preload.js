'use strict';
(() => {
  if (!('serviceWorker' in navigator)) return;
  // Reuse the media worker: registering a second root worker would break
  // local movie playback. Cache only public landing assets, never room data.
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/media-worker.js', { updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      const assets = [...document.querySelectorAll('img[src],link[rel="preload"][as="image"]')].map(node => node.src || node.href);
      const warm = urls => (registration.active || navigator.serviceWorker.controller)?.postMessage({ type: 'cache-landing-assets', urls });
      warm(assets);
      // Movie responses are cached by the worker while streaming. Never fetch
      // the movie a second time just to populate Cache Storage.
    } catch { /* Native HTTP caching still works without worker storage. */ }
  }, { once: true });
})();
