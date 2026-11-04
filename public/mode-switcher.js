'use strict';
(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const session = window.CineWallSession;
    if (!session) return;
    let switching = false;
    document.addEventListener('click', async event => {
      const card = event.target.closest('a[data-session-mode]');
      if (!card || event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = new URL(card.href, location.href);
      if (target.origin !== location.origin || target.searchParams.has('new') || !session.hostRoom) return;
      const mode = card.dataset.sessionMode;
      if (!['video', 'audio', 'share', 'mic'].includes(mode)) return;
      // Phone restrictions are handled by device-support.js before this listener.
      if (window.CineWallDeviceSupport?.isPhone && mode !== 'mic') return;
      event.preventDefault();
      if (switching) return;
      switching = true;
      card.setAttribute('aria-busy', 'true');
      try {
        await session.switchMode(mode);
      } catch (error) {
        if (error.status === 401) {
          const next = new URL('/connect.html', location.origin);
          next.searchParams.set('mode', mode); next.searchParams.set('room', session.hostRoom);
          location.href = new URL(`/auth.html?next=${encodeURIComponent(next.pathname + next.search)}`, location.origin).href;
          return;
        }
        window.dispatchEvent(new CustomEvent('cinewall-room-error', { detail: error.message }));
      } finally {
        switching = false;
        card.removeAttribute('aria-busy');
      }
    }, true);
  });
})();
