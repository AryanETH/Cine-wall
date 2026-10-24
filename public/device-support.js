'use strict';
(() => {
  const agent = navigator.userAgent || '';
  const tablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(agent);
  const smallTouchScreen = Math.min(screen.width, screen.height) <= 600
    && navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches;
  // Screen size is orientation-independent; a narrow desktop window is still supported.
  const isPhone = !tablet && (navigator.userAgentData?.mobile === true
    || /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(agent) || smallTouchScreen);
  const restricted = isPhone && /\/(admin|screen|share)\.html$/.test(location.pathname);
  window.CineWallDeviceSupport = { isPhone, restricted };
  if (!isPhone) return;
  if (restricted) document.documentElement.classList.add('device-restricted');

  document.addEventListener('DOMContentLoaded', () => {
    const dialog = document.createElement('dialog');
    dialog.className = 'device-warning';
    dialog.setAttribute('aria-labelledby', 'deviceWarningTitle');
    dialog.setAttribute('aria-describedby', 'deviceWarningCopy');
    dialog.innerHTML = `<span class="device-warning-label">LAPTOP OR PC REQUIRED</span>
      <h2 id="deviceWarningTitle">A bigger screen for this experience</h2>
      <p id="deviceWarningCopy">Video streaming, audio streaming and screen sharing are designed for laptops and PCs only.</p>
      <p>On your phone, use <strong>Mic and Speaker</strong>. It works in portrait mode.</p>
      <div class="device-warning-actions"><a class="button accent" data-device-mic href="/mic.html">Open Mic and Speaker</a>
      ${restricted ? '<a class="button subtle" href="/">Back to home</a>' : '<button class="button subtle" type="button" data-device-close>Back to browsing</button>'}</div>`;
    dialog.querySelector('[data-device-mic]').href = window.CineWallSession?.link('/mic.html') || '/mic.html';
    document.body.append(dialog);
    dialog.querySelector('[data-device-close]')?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { if (restricted) event.preventDefault(); });
    if (restricted) {
      dialog.showModal();
      return;
    }
    const grid = document.querySelector('.mode-grid');
    if (!grid) return;
    const notice = document.createElement('section');
    notice.className = 'device-notice';
    notice.setAttribute('role', 'note');
    notice.setAttribute('data-nosnippet', '');
    notice.innerHTML = '<strong>Browsing on a phone?</strong><p>Video, audio streaming and screen sharing are for laptops and PCs. Use Mic and Speaker on your phone in portrait mode.</p>';
    grid.before(notice);
    document.addEventListener('click', event => {
      const target = event.target.closest('a[href], [data-session-mode]');
      if (!target) return;
      const url = target.href ? new URL(target.href, location.href) : null;
      if (target.dataset.sessionMode || (url?.origin === location.origin && /\/(admin|screen|share)\.html$/.test(url.pathname))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dialog.showModal();
      }
    }, true);
  });
})();
