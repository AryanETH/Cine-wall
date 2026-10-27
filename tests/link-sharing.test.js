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

function client(route, { restricted = false, saved, fail = false } = {}) {
  const requests = [], navigations = [], streams = [], errors = [], storage = new Map();
  if (saved) storage.set(`cinewall-room-${room}`, JSON.stringify(saved));
  const location = new URL(route, 'https://cinema.test');
  location.replace = value => navigations.push(new URL(value));
  class Xhr extends EventTarget { open() {} setRequestHeader() {} send() {} }
  class Events extends EventTarget { constructor(url) { super(); streams.push(url); } close() {} }
  const listeners = {};
  const window = {
    CineWallDeviceSupport: { restricted },
    fetch: async (url, init) => {
      requests.push({ url: String(url), body: init?.body && JSON.parse(init.body) });
      const mode = init?.body && JSON.parse(init.body).mode || 'video';
      const pathname = new URL(url, location).pathname;
      const result = pathname.endsWith('/create') ? { room, mode, admin: true, ticket: 'host-ticket', path: mode === 'share' ? '/share.html' : mode === 'mic' ? '/mic.html' : `/admin.html?mode=${mode}` }
        : pathname.endsWith('/resume') ? saved
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
  return { window, requests, navigations, streams, errors };
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

test('connection failure raises a visible-error event without falling back to an unscoped workspace', async () => {
  const user = client('/admin.html?mode=video', { fail: true }); await tick();
  assert.equal(user.errors[0].detail, 'Server unavailable');
  assert.equal(user.navigations.length, 0);
  assert.equal(user.requests.length, 1);
});
