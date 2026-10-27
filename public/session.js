'use strict';
(() => {
  const uuid = () => crypto.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  const memory = new Map();
  const storage = { get(key) { try { return localStorage.getItem(key) ?? memory.get(key) ?? null; } catch { return memory.get(key) ?? null; } }, set(key, value) { memory.set(key, String(value)); try { localStorage.setItem(key, String(value)); } catch {} }, remove(key) { memory.delete(key); try { localStorage.removeItem(key); } catch {} } };
  function storedIdentity(key) {
    let value;
    value = storage.get(key);
    if (!/^[a-f0-9-]{36}$/.test(value || '')) {
      value = uuid(); storage.set(key, value);
    }
    return value;
  }
  let deviceId = storedIdentity('cinewall-device');
  const deviceKey = storedIdentity('cinewall-device-key');
  const page = new URL(location.href);
  const peerId = uuid();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(page.hostname) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(page.hostname);
  const explicitRoom = page.searchParams.get('room') || '';
  let room = explicitRoom || (page.pathname === '/' && !page.searchParams.has('new') ? storage.get('cinewall-active-room') || '' : '');
  const nativeFetch = window.fetch.bind(window);
  const identityHeaders = { 'X-CineWall-Device': deviceId, 'X-CineWall-Key': deviceKey };
  let membership = null;
  function remember(data) {
    const recoveryKey = membership?.recoveryKey;
    membership = { ...data, ...(recoveryKey ? { recoveryKey } : {}) };
    if (data.deviceId) { deviceId = data.deviceId; identityHeaders['X-CineWall-Device'] = deviceId; }
    storage.set(`cinewall-room-${data.room}`, JSON.stringify(membership));
    storage.set('cinewall-active-room', data.room);
    return membership;
  }
  function navigate(data, replace = false) {
    const target = new URL(data.path, location.origin); target.searchParams.set('room', data.room);
    try { if (!localStorage.getItem('cinewall-device')) target.searchParams.set('access', data.ticket); }
    catch { target.searchParams.set('access', data.ticket); }
    if (replace) location.replace(target.href); else location.href = target.href;
  }
  function followsPath(data) {
    if (!/\/(admin|screen|share|mic|room)\.html$/.test(page.pathname)) return true;
    // The creator's numbered player shares its device identity with the
    // dashboard. Keep that player open instead of turning it into a dashboard.
    const playerNumber = Number(new URL(location.href).searchParams.get('screen'));
    if (data.admin && !data.waiting && location.pathname === '/screen.html' && ['video', 'audio'].includes(data.mode)
      && Number.isInteger(playerNumber) && playerNumber >= 1 && playerNumber <= (data.mode === 'audio' ? 5 : 3)) return true;
    const target = new URL(data.path, location.origin);
    if (target.pathname !== location.pathname) return false;
    if (target.pathname === '/admin.html') return new URL(location.href).searchParams.get('mode') === data.mode;
    if (!data.admin && !data.waiting) {
      const actual = new URL(location.href).searchParams;
      if (data.role === 'phone') return actual.get('role') === 'phone';
      return Number(actual.get(data.mode === 'mic' ? 'speaker' : 'screen')) === data.screen;
    }
    return true;
  }
  async function roomRequest(action, body) {
    const response = await nativeFetch(`/api/rooms/${action}`, { method: 'POST', headers: { ...identityHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...(typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(10000) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not connect to this room.');
    return remember(data);
  }
  const ready = room ? (async () => {
    let saved; try { saved = JSON.parse(storage.get(`cinewall-room-${room}`) || 'null'); } catch {}
    let inherited; try { if (window.opener?.location.origin === location.origin && window.opener.CineWallSession?.room === room) inherited = window.opener.CineWallSession.membership?.ticket; } catch {}
    const ticket = page.searchParams.get('access') || saved?.ticket || inherited;
    const data = ticket ? await roomRequest('resume', { room, ticket }) : await roomRequest('join', { room, screen: Number(page.searchParams.get('screen') || page.searchParams.get('speaker')) || undefined, role: page.searchParams.get('role') });
    if (saved?.recoveryKey) { data.recoveryKey = saved.recoveryKey; storage.set(`cinewall-room-${room}`, JSON.stringify(data)); }
    if (!followsPath(data)) { navigate(data, true); return new Promise(() => {}); }
    return data;
  })().catch(error => {
    if (!explicitRoom && page.pathname === '/') { storage.remove('cinewall-active-room'); room = ''; membership = null; return null; }
    throw error;
  }) : Promise.resolve(null);
  ready.catch(error => { const show = () => window.dispatchEvent(new CustomEvent('cinewall-room-error', { detail: error.message })); if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true }); else show(); });
  function link(value, origin = location.origin) {
    const url = new URL(value, origin);
    if (room && url.origin === new URL(origin).origin) { url.searchParams.set('room', room); if (url.origin === location.origin && url.pathname.startsWith('/api/') && membership?.ticket) url.searchParams.set('ticket', membership.ticket); }
    return url.href;
  }
  function scoped(value, ticket = false) {
    const url = new URL(value, location.origin);
    if (room && /^https?:$/.test(url.protocol) && url.origin === location.origin) { url.searchParams.set('room', room); if (ticket && membership?.ticket) url.searchParams.set('ticket', membership.ticket); }
    return url.href;
  }
  window.fetch = (input, init) => {
    const target = scoped(input instanceof Request ? input.url : input);
    const api = new URL(target).origin === location.origin && new URL(target).pathname.startsWith('/api/');
    if (!api) return nativeFetch(input instanceof Request ? new Request(target, input) : target, init);
    const send = () => {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      for (const [key, value] of Object.entries(identityHeaders)) headers.set(key, value);
      const destination = new URL(target).pathname.startsWith('/api/rooms/') ? new URL(input instanceof Request ? input.url : input, location.origin).href : scoped(target, true);
      return nativeFetch(input instanceof Request ? new Request(destination, input) : destination, { ...init, headers });
    };
    return !room || new URL(target).pathname.startsWith('/api/rooms/') ? send() : ready.then(send);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    const target = scoped(url, true), result = open.call(this, method, target, ...rest);
    this.cinewallApi = new URL(target).origin === location.origin && new URL(target).pathname.startsWith('/api/');
    if (this.cinewallApi) {
      this.setRequestHeader('X-CineWall-Device', deviceId); this.setRequestHeader('X-CineWall-Key', deviceKey);
    }
    return result;
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(body) { if (room && this.cinewallApi) ready.then(() => { if (membership?.ticket) this.setRequestHeader('X-CineWall-Ticket', membership.ticket); send.call(this, body); }).catch(() => this.dispatchEvent(new Event('error'))); else send.call(this, body); };
  const NativeEvents = window.EventSource;
  const connections = new Map();
  window.EventSource = class RoomEvents extends EventTarget {
    constructor(value, options) {
      super(); this.closed = false; this.readyState = 0; this.bindings = []; this.onopen = null; this.onerror = null;
      const target = new URL(value, location.origin);
      if (target.pathname === '/events') target.searchParams.set('peer', peerId);
      const attach = () => {
        if (this.closed) return;
        const url = scoped(target.href, true); let shared = connections.get(url);
        if (!shared) { shared = { source: new NativeEvents(url, options), users: new Set() }; connections.set(url, shared); }
        this.shared = shared; this.url = url; shared.users.add(this);
        for (const type of ['open','error','message','state','command','screens','pulse','peer-signal','source-range','share-state','share-signal','call-signal','mic-state','mic-signal','mic-removed']) {
          const listener = event => { if (this.closed) return; this.readyState = shared.source.readyState; const next = typeof MessageEvent === 'function' && 'data' in event ? new MessageEvent(type, { data: event.data }) : new Event(type); this.dispatchEvent(next); this[`on${type}`]?.(next); if (type === 'error' && this.readyState === 2 && room && !shared.reported) { shared.reported = true; window.dispatchEvent(new CustomEvent('cinewall-room-error', { detail: 'This room connection ended. Join again with the room ID.' })); } };
          shared.source.addEventListener(type, listener); this.bindings.push([type, listener]);
        }
      };
      (room ? ready : Promise.resolve()).then(attach).catch(() => { if (!this.closed) { const event = new Event('error'); this.dispatchEvent(event); this.onerror?.(event); } });
    }
    close() { this.closed = true; this.readyState = 2; if (!this.shared) return; for (const [type, listener] of this.bindings) this.shared.source.removeEventListener(type, listener); this.shared.users.delete(this); if (!this.shared.users.size) { this.shared.source.close(); connections.delete(this.url); } }
  };
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[href]');
    if (!anchor || !room) return;
    const target = new URL(anchor.href, location.href);
    if (!target.searchParams.has('new') && target.origin === location.origin && (target.pathname === '/' || target.pathname.startsWith('/api/') || target.pathname.endsWith('.html'))) anchor.href = scoped(target, target.pathname.startsWith('/api/'));
  }, true);
  let refreshPending = false, refreshTimer, ended = false;
  async function refreshRoom() {
    if (!room || !membership || refreshPending || ended) return;
    refreshPending = true;
    try {
      const response = await nativeFetch(scoped('/api/rooms/current', true), { headers: identityHeaders, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        if ([403, 404].includes(response.status)) { ended = true; window.dispatchEvent(new CustomEvent('cinewall-room-error', { detail: data.error })); }
        return;
      }
      const previous = membership; remember(data);
      if (!followsPath(data)) { ended = true; for (const media of document.querySelectorAll('video,audio')) media.pause(); navigate(data, true); return; }
      if (previous.mode !== data.mode || previous.revision !== data.revision) window.dispatchEvent(new CustomEvent('cinewall-room-updated', { detail: membership }));
    } catch { /* Retry a dropped connection without asking for the room ID again. */ }
    finally { refreshPending = false; if (!ended) refreshTimer = setTimeout(refreshRoom, 1500); }
  }
  async function switchMode(mode) {
    await ready;
    const response = await nativeFetch(scoped('/api/rooms/mode', true), { method: 'POST', headers: { ...identityHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not switch modes.');
    remember(data); navigate(data);
  }
  if (room) ready.then(() => { refreshTimer = setTimeout(refreshRoom, 1500); }).catch(() => {});
  window.addEventListener('pagehide', () => { ended = true; clearTimeout(refreshTimer); });
  window.addEventListener('pageshow', event => { if (event.persisted && room) location.reload(); });
  window.CineWallSession = { get room() { return room; }, hosted: !local, link, navigate, switchMode, get deviceId() { return deviceId; }, peerId, ready, storage, roomRequest, get membership() { return membership; }, mediaLink: value => scoped(value, true) };
})();
