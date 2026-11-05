'use strict';
(() => {
  if (!('serviceWorker' in navigator)) return;
  // Reuse the media worker: registering a second root worker would break
  // local movie playback. Cache only public landing assets, never room data.
  const registrationReady = navigator.serviceWorker.register('/media-worker.js', { updateViaCache: 'none' }).then(() => navigator.serviceWorker.ready).catch(() => null);
  async function warmAssets() {
    try {
      const registration = await registrationReady;
      if (!registration) return;
      const assets = [...document.querySelectorAll('img[src],link[rel="preload"][as="image"],link[rel="preload"][as="font"]')].map(node => node.src || node.href);
      const warm = urls => (registration.active || navigator.serviceWorker.controller)?.postMessage({ type: 'cache-landing-assets', urls });
      warm(assets);
      // Movie responses are cached by the worker while streaming. Never fetch
      // the movie a second time just to populate Cache Storage.
    } catch { /* Native HTTP caching still works without worker storage. */ }
  }
  if (document.readyState === 'complete') void warmAssets();
  else window.addEventListener('load', warmAssets, { once: true });
})();
