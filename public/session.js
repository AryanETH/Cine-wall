'use strict';
(() => {
  const uuid = () => crypto.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  function storedIdentity(key) {
    let value;
    try { value = localStorage.getItem(key); } catch {}
    if (!/^[a-f0-9-]{36}$/.test(value || '')) {
      value = uuid(); try { localStorage.setItem(key, value); } catch {}
    }
    return value;
  }
  const deviceId = storedIdentity('cinewall-device'), deviceKey = storedIdentity('cinewall-device-key');
  const page = new URL(location.href);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(page.hostname) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(page.hostname);
  let room = page.searchParams.get('room') || '';
  if (!local && !room) {
    room = localStorage.getItem('cinewall-room') || uuid();
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
  window.fetch = (input, init) => {
    const target = scoped(input instanceof Request ? input.url : input);
    const api = new URL(target).origin === location.origin && new URL(target).pathname.startsWith('/api/');
    if (!api) return nativeFetch(input instanceof Request ? new Request(target, input) : target, init);
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-CineWall-Device', deviceId); headers.set('X-CineWall-Key', deviceKey);
    return nativeFetch(input instanceof Request ? new Request(target, input) : target, { ...init, headers });
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    const target = scoped(url), result = open.call(this, method, target, ...rest);
    if (new URL(target).origin === location.origin && new URL(target).pathname.startsWith('/api/')) {
      this.setRequestHeader('X-CineWall-Device', deviceId); this.setRequestHeader('X-CineWall-Key', deviceKey);
    }
    return result;
  };
  const NativeEvents = window.EventSource;
  window.EventSource = class extends NativeEvents { constructor(url, options) { super(scoped(url), options); } };
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[href]');
    if (!anchor || !room) return;
    const target = new URL(anchor.href, location.href);
    if (target.origin === location.origin && (target.pathname.startsWith('/api/') || target.pathname.endsWith('.html') || target.pathname === '/')) anchor.href = scoped(target);
  }, true);
  window.CineWallSession = { room, hosted: !local, link, deviceId };
})();
