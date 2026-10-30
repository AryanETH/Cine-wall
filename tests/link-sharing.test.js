'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, randomUUID } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../public/session.js'), 'utf8');
const room = randomUUID();
const tick = () => new Promise(resolve => setImmediate(resolve));

function client(route, { restricted = false, saved, active = false, fail = false, storage = new Map() } = {}) {
  const requests = [], navigations = [], streams = [], errors = [];
  if (saved) storage.set(`cinewall-room-${room}`, JSON.stringify(saved));
  if (active) storage.set('cinewall-active-room', room);
  const location = new URL(route, 'https://cinema.test');
  location.replace = value => navigations.push(new URL(value));
  class Xhr extends EventTarget { open() {} setRequestHeader() {} send() {} }
  class Events extends EventTarget { constructor(url) { super(); streams.push(url); } close() {} }
  const listeners = {};
  const window = {
    CineWallDeviceSupport: { restricted },
    fetch: async (url, init) => {
      requests.push({ url: String(url), body: init?.body && JSON.parse(init.body) });
      const body = init?.body && JSON.parse(init.body), target = new URL(url, location);
      const mode = body?.mode || saved?.mode || 'video', pathname = target.pathname;
      const requestedRoom = body?.room || target.searchParams.get('room') || room;
      const result = pathname.endsWith('/create') || pathname.endsWith('/mode') ? { room: requestedRoom, mode, admin: true, ticket: 'host-ticket', path: mode === 'share' ? '/share.html' : mode === 'mic' ? '/mic.html' : `/admin.html?mode=${mode}` }
        : pathname.endsWith('/resume') ? JSON.parse(storage.get(`cinewall-room-${requestedRoom}`) || 'null') || saved
        : { room, mode: 'video', admin: false, screen: 2, role: 'screen', ticket: 'guest-ticket', path: '/screen.html?screen=2' };
      return { ok: !fail, json: async () => fail ? { error: 'Server unavailable' } : result };
    },
    EventSource: Events,
    addEventListener: (name, listener) => { listeners[name] = listener; },
    dispatchEvent: event => errors.push(event),
  };
  const context = vm.createContext({ window, location, URL, Headers, Request, EventTarget, Event, MessageEvent, AbortSignal,
    CustomEvent: class extends Event { constructor(type, init) { super(type); this.detail = init.detail; } },
    crypto: webcrypto, XMLHttpRequest: Xhr,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: { readyState: 'complete', addEventListener() {}, querySelectorAll: () => [] },
    setTimeout: () => 1, clearTimeout() {},
  });
  vm.runInContext(source, context);
  return { window, requests, navigations, streams, errors, storage, location };
}

test('all four modes start automatically and wait for their private URL before workspace requests', async () => {
  for (const [route, mode] of [['/admin.html?mode=video', 'video'], ['/admin.html?mode=audio', 'audio'], ['/share.html', 'share'], ['/mic.html', 'mic'], ['/connect.html?mode=audio&join=1', 'audio']]) {
    const user = client(route);
    void user.window.fetch('/api/status');
    new user.window.EventSource('/events');
    await tick();
    assert.equal(user.requests.length, 1, route);
    assert.equal(user.requests[0].url, '/api/rooms/create');
    assert.deepEqual(user.requests[0].body, { mode });
    assert.equal(user.navigations.length, 1);
    assert.equal(user.navigations[0].searchParams.get('room'), room);
    assert.equal(user.navigations[0].searchParams.has('access'), false);
    assert.equal(user.streams.length, 0, 'no unscoped event stream');
  }
});

test('the homepage and restricted phone pages do not allocate rooms', async () => {
  for (const [route, restricted] of [['/', false], ['/index.html', false], ['/admin.html', true], ['/connect.html?mode=video', true]]) {
    const user = client(route, { restricted }); await tick();
    assert.equal(user.requests.length, 0);
    assert.equal(user.navigations.length, 0);
  }
});

test('receiver pages require the full device link and never start an unrelated room', async () => {
  for (const route of ['/screen.html?screen=2', '/share.html?screen=1', '/mic.html?role=phone', '/mic.html?speaker=1', '/room.html']) {
    const user = client(route); await tick();
    assert.equal(user.requests.length, 0);
    assert.equal(user.errors[0].detail, 'Open the full device link shared by the host.');
  }
});

test('a shared numbered link joins directly and scopes API access without sharing admin credentials', async () => {
  const user = client(`/screen.html?screen=2&room=${room}`);
  const info = await user.window.CineWallSession.ready;
  assert.equal(user.requests[0].url, '/api/rooms/join');
  assert.equal(user.requests[0].body.screen, 2);
  assert.equal(info.admin, false);
  assert.equal(user.navigations.length, 0);
  await user.window.fetch('/api/status');
  assert.equal(new URL(user.requests[1].url).searchParams.get('ticket'), 'guest-ticket');
  const invite = new URL(user.window.CineWallSession.link('/screen.html?screen=3'));
  assert.equal(invite.searchParams.get('room'), room);
  assert.equal(invite.searchParams.has('ticket'), false);
  assert.equal(invite.searchParams.has('access'), false);
});

test('reopening the host dashboard resumes saved admin membership without creating another room', async () => {
  const saved = { room, mode: 'audio', admin: true, ticket: 'host-ticket', path: '/admin.html?mode=audio' };
  const user = client(`/admin.html?mode=audio&room=${room}`, { saved });
  const info = await user.window.CineWallSession.ready;
  assert.equal(info.admin, true);
  assert.equal(user.requests.length, 1);
  assert.equal(user.requests[0].url, '/api/rooms/resume');
  assert.equal(user.navigations.length, 0);
});

test('opening another tool from the landing page switches the existing host room across all four modes', async () => {
  const saved = { room, mode: 'video', admin: true, ticket: 'host-ticket', recoveryKey: 'host-recovery', path: '/admin.html?mode=video' };
  const storage = new Map([['cinewall-active-room', room], [`cinewall-room-${room}`, JSON.stringify(saved)]]);
  const home = client('/', { storage });
  await home.window.CineWallSession.ready;
  assert.equal(home.requests.length, 0, 'opening the homepage does not change the live room');

  for (const [route, mode] of [['/admin.html?mode=audio', 'audio'], ['/share.html', 'share'], ['/mic.html', 'mic'], ['/admin.html?mode=video', 'video']]) {
    const current = JSON.parse(storage.get(`cinewall-room-${room}`));
    const user = client(route, { saved: current, storage });
    void user.window.fetch('/api/status');
    new user.window.EventSource('/events');
    await tick();
    assert.deepEqual(user.requests.map(request => new URL(request.url, 'https://cinema.test').pathname), ['/api/rooms/resume', '/api/rooms/mode'], route);
    assert.deepEqual(user.requests[0].body, { room, ticket: 'host-ticket' });
    assert.deepEqual(user.requests[1].body, { mode });
    assert.equal(new URL(user.requests[1].url, 'https://cinema.test').searchParams.get('room'), room);
    assert.equal(user.navigations.length, 1);
    assert.equal(user.navigations[0].searchParams.get('room'), room);
    assert.equal(user.navigations[0].searchParams.has('access'), false, 'the host recovery key and ticket stay out of ordinary links');
    assert.equal(user.streams.length, 0, 'workspace streams wait for the updated room URL');
    assert.equal(storage.get('cinewall-active-room'), room);
    assert.equal(JSON.parse(storage.get(`cinewall-room-${room}`)).recoveryKey, 'host-recovery');
  }
});

test('the legacy tool entry reuses active admin membership and same-mode reopening never allocates another room', async () => {
  const saved = { room, mode: 'audio', admin: true, ticket: 'host-ticket', path: '/admin.html?mode=audio' };
  for (const route of ['/connect.html?mode=audio', '/admin.html?mode=audio']) {
    const user = client(route, { saved, active: true });
    await tick();
    assert.deepEqual(user.requests.map(request => new URL(request.url, 'https://cinema.test').pathname), ['/api/rooms/resume'], route);
    assert.equal(user.navigations.length, 1);
    assert.equal(user.navigations[0].searchParams.get('room'), room);
    assert.equal(user.navigations[0].searchParams.get('mode'), 'audio');
  }
});

test('an explicit new-workspace request still creates a room instead of changing the existing session', async () => {
  const saved = { room, mode: 'video', admin: true, ticket: 'host-ticket', path: '/admin.html?mode=video' };
  const user = client('/admin.html?mode=audio&new=1', { saved, active: true });
  await tick();
  assert.deepEqual(user.requests.map(request => new URL(request.url, 'https://cinema.test').pathname), ['/api/rooms/create']);
  assert.deepEqual(user.requests[0].body, { mode: 'audio' });
});

test('a saved guest room cannot be switched through host tool entry links', async () => {
  const saved = { room, mode: 'video', admin: false, ticket: 'guest-ticket', screen: 2, path: '/screen.html?screen=2' };
  const user = client('/admin.html?mode=audio', { saved, active: true });
  await tick();
  assert.equal(user.requests.some(request => new URL(request.url, 'https://cinema.test').pathname.endsWith('/mode')), false);
  assert.equal(user.requests.some(request => new URL(request.url, 'https://cinema.test').pathname.endsWith('/create')), true);
});

test('the homepage switch action resumes the active host without allocating a room', async () => {
  const saved = { room, mode: 'video', admin: true, ticket: 'host-ticket', path: '/admin.html?mode=video' };
  const user = client('/', { saved, active: true });
  await user.window.CineWallSession.ready;
  assert.equal(user.requests.length, 0);
  await user.window.CineWallSession.switchMode('share');
  assert.deepEqual(user.requests.map(request => new URL(request.url, 'https://cinema.test').pathname), ['/api/rooms/resume', '/api/rooms/mode']);
  const target = new URL(user.location.href);
  assert.equal(target.pathname, '/share.html');
  assert.equal(target.searchParams.get('room'), room);
});

test('a room explicitly selected on the homepage wins over another active host session', async () => {
  const otherRoom = randomUUID();
  const saved = { room, mode: 'video', admin: true, ticket: 'host-ticket', path: '/admin.html?mode=video' };
  const storage = new Map([[`cinewall-room-${otherRoom}`, JSON.stringify({ ...saved, room: otherRoom })]]);
  const user = client(`/?room=${otherRoom}`, { saved, active: true, storage });
  await user.window.CineWallSession.ready;
  assert.equal(user.requests.length, 0);
  await user.window.CineWallSession.switchMode('mic');
  assert.equal(user.requests[0].body.room, otherRoom);
  assert.equal(new URL(user.requests[1].url, 'https://cinema.test').searchParams.get('room'), otherRoom);
  assert.equal(new URL(user.location.href).searchParams.get('room'), otherRoom);
});

test('a failed homepage mode switch reports the error without silently replacing the shared room', async () => {
  const saved = { room, mode: 'video', admin: true, ticket: 'host-ticket', path: '/admin.html?mode=video' };
  const user = client('/', { saved, active: true, fail: true });
  await assert.rejects(user.window.CineWallSession.switchMode('audio'), /Server unavailable/);
  assert.equal(user.requests.some(request => new URL(request.url, 'https://cinema.test').pathname.endsWith('/create')), false);
  assert.equal(user.navigations.length, 0);
  assert.equal(user.storage.get('cinewall-active-room'), room);
});

test('an old dashboard URL follows the current room mode instead of switching it back', async () => {
  const saved = { room, mode: 'video', admin: true, ticket: 'host-ticket', path: '/admin.html?mode=video' };
  const user = client(`/admin.html?mode=audio&room=${room}`, { saved, active: true });
  await tick();
  assert.deepEqual(user.requests.map(request => new URL(request.url, 'https://cinema.test').pathname), ['/api/rooms/resume']);
  assert.equal(user.navigations.length, 1);
  assert.equal(user.navigations[0].searchParams.get('room'), room);
  assert.equal(user.navigations[0].searchParams.get('mode'), 'video');
});

test('a concurrent switch in another tab cannot make cached same-mode selection skip the server update', async () => {
  const saved = { room, mode: 'video', admin: true, ticket: 'host-ticket', path: '/admin.html?mode=video' };
  const user = client(`/admin.html?mode=video&room=${room}`, { saved, active: true });
  await user.window.CineWallSession.ready;
  // Another tab has changed the room; this page has not received its next update.
  user.storage.set(`cinewall-room-${room}`, JSON.stringify({ ...saved, mode: 'audio', path: '/admin.html?mode=audio' }));
  assert.equal(user.window.CineWallSession.membership.mode, 'video');
  await user.window.CineWallSession.switchMode('video');
  assert.deepEqual(user.requests.map(request => new URL(request.url, 'https://cinema.test').pathname), ['/api/rooms/resume', '/api/rooms/mode']);
  assert.deepEqual(user.requests[1].body, { mode: 'video' });
  assert.equal(new URL(user.requests[1].url, 'https://cinema.test').searchParams.get('room'), room);
  assert.equal(new URL(user.location.href).searchParams.get('room'), room);
});

test('connection failure raises a visible-error event without falling back to an unscoped workspace', async () => {
  const user = client('/admin.html?mode=video', { fail: true }); await tick();
  assert.equal(user.errors[0].detail, 'Server unavailable');
  assert.equal(user.navigations.length, 0);
  assert.equal(user.requests.length, 1);
});
