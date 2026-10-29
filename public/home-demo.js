'use strict';

function setupHomeDemo(video, fallback, motion) {
  if (!video) return;
  const surface = video.closest('.home-preview') || video;
  for (const type of ['contextmenu', 'dblclick', 'dragstart']) {
    surface.addEventListener(type, event => {
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }
  function play() {
    // Keep the poster visible if the browser blocks this silent autoplay.
    video.play().catch(() => {});
  }
  function followMotionPreference() {
    if (motion.matches) video.pause();
    else play();
    syncScene();
  }
  function syncScene() {
    surface.classList?.toggle('is-wall', motion.matches || (video.currentTime || 0) >= 1.25);
  }
  function showFallback() {
    video.pause();
    if (fallback) fallback.hidden = false;
  }
  video.addEventListener('error', showFallback);
  video.addEventListener('timeupdate', syncScene);
  video.addEventListener('seeked', syncScene);
  video.addEventListener('loadedmetadata', syncScene);
  // Source errors do not bubble to the video in every browser.
  video.querySelector('source')?.addEventListener('error', showFallback);
  motion.addEventListener('change', followMotionPreference);
  followMotionPreference();
}

function setupDemoTheme(video, root, motion, createObserver) {
  const source = video?.querySelector('source');
  if (!source || !video.dataset.darkSrc) return;
  const lightSrc = source.getAttribute('src');
  const lightPoster = video.getAttribute('poster');
  let selected = lightSrc, pendingTime = 0, pendingPlay = false;
  function update() {
    const dark = root.dataset.theme !== 'light';
    const next = dark ? video.dataset.darkSrc : lightSrc;
    if (next === selected) { video.dataset.themeReady = 'true'; return; }
    selected = next;
    pendingTime = Number.isFinite(video.currentTime) && video.currentTime > 0 ? video.currentTime : pendingTime;
    pendingPlay = !motion.matches;
    video.classList.add('is-switching');
    video.setAttribute('poster', dark ? video.dataset.darkPoster : lightPoster);
    source.setAttribute('src', next);
    video.load();
  }
  video.addEventListener('loadedmetadata', () => {
    if (pendingTime > 0) video.currentTime = Math.min(pendingTime, Math.max(0, video.duration - .05));
    pendingTime = 0;
    if (pendingPlay && !motion.matches) video.play().catch(() => {});
    pendingPlay = false;
  });
  video.addEventListener('loadeddata', () => {
    video.classList.remove('is-switching');
    video.dataset.themeReady = 'true';
  });
  const observer = createObserver(update);
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  update();
  return { update, disconnect: () => observer.disconnect() };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { setupHomeDemo, setupDemoTheme };
if (typeof document !== 'undefined') {
  const homeVideo = document.querySelector('#homeDemoVideo');
  const homeMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  setupDemoTheme(homeVideo, document.documentElement, homeMotion, callback => new MutationObserver(callback));
  setupHomeDemo(homeVideo, document.querySelector('#homeDemoFallback'), homeMotion);
}
