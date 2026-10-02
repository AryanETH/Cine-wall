'use strict';
(() => {
  const page = new URL(location.href);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(page.hostname) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(page.hostname);
  let room = page.searchParams.get('room') || '';
  if (!local && !room) {
    room = localStorage.getItem('cinewall-room') || crypto.randomUUID();
    localStorage.setItem('cinewall-room', room);
    page.searchParams.set('room', room);
    history.replaceState(null, '', page);
  }
  function link(value, origin = location.origin) {
    const url = new URL(value, origin);
    if (room) url.searchParams.set('room', room);
    return url.href;
  }
  function scoped(value) {
    const url = new URL(value, location.origin);
    if (room && /^https?:$/.test(url.protocol) && url.origin === location.origin) url.searchParams.set('room', room);
    return url.href;
  }
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => nativeFetch(input instanceof Request ? new Request(scoped(input.url), input) : scoped(input), init);
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) { return open.call(this, method, scoped(url), ...rest); };
  const NativeEvents = window.EventSource;
  window.EventSource = class extends NativeEvents { constructor(url, options) { super(scoped(url), options); } };
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[href]');
    if (!anchor || !room) return;
    const target = new URL(anchor.href, location.href);
    if (target.origin === location.origin && (target.pathname.startsWith('/api/') || target.pathname.endsWith('.html') || target.pathname === '/')) anchor.href = scoped(target);
  }, true);
  window.CineWallSession = { room, hosted: !local, link };
})();
