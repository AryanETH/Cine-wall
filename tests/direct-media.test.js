'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { MessageChannel } = require('node:worker_threads');
const source = (name) => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const room = '01234567-89ab-4cde-8fab-0123456789ab';
const turn = () => new Promise(setImmediate);

function sessionPage(href, savedRoom) {
  const location = new URL(href), calls = [], clicks = [], storage = new Map(savedRoom ? [['cinewall-room', savedRoom]] : []);
  class XHR { open(...args) { calls.push(args); } }
  class Events { constructor(url) { calls.push(['events', url]); } }
  const window = { fetch: async (...args) => { calls.push(['fetch', ...args]); return {}; }, EventSource: Events };
  const context = vm.createContext({ URL, Request, location, window, XMLHttpRequest: XHR, crypto: crypto.webcrypto,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    history: { replaceState(a, b, value) { calls.push(['history', String(value)]); } },
    document: { addEventListener(type, handler) { clicks.push(handler); } },
  });
  vm.runInContext(source('session.js'), context);
  return { window, context, calls, clicks, XHR };
}

test('hosted page creates private domain links, never localhost or internal Railway IP/port', async () => {
  const client = sessionPage('https://watch.aitoyz.in/admin.html?mode=video', room);
  assert.equal(client.window.CineWallSession.hosted, true);
  for (const screen of [1, 2, 3]) assert.equal(client.window.CineWallSession.link(`/screen.html?screen=${screen}`), `https://watch.aitoyz.in/screen.html?screen=${screen}&room=${room}`);
  await client.window.fetch('/api/status');
  new client.window.EventSource('/events');
  new client.XHR().open('POST', '/api/media');
  assert.ok(client.calls.filter((call) => ['fetch', 'events', 'POST'].includes(call[0])).every((call) => call[1].includes(`room=${room}`)));
  const link = { href: 'https://watch.aitoyz.in/api/youtube/downloads/id/file' };
  client.clicks[0]({ target: { closest: () => link } });
  assert.ok(link.href.includes(`room=${room}`));
  await client.window.fetch('https://www.youtube.com/');
  assert.equal(client.calls.at(-1)[1], 'https://www.youtube.com/');
});

test('an explicit private link wins over another session saved in the browser; LAN links remain LAN', () => {
  const explicit = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  assert.equal(sessionPage(`https://watch.aitoyz.in/screen.html?screen=2&room=${explicit}`, room).window.CineWallSession.room, explicit);
  const lan = sessionPage('http://192.168.137.1:4173/admin.html');
  assert.equal(lan.window.CineWallSession.room, '');
  assert.equal(lan.window.CineWallSession.link('/screen.html?screen=2'), 'http://192.168.137.1:4173/screen.html?screen=2');
});

test('dashboard renders every hosted display on the domain even when server info advertises internal addresses', () => {
  const client = sessionPage(`https://watch.aitoyz.in/admin.html?mode=video&room=${room}`), nodes = new Map(), links = { style: {}, innerHTML: '' };
  const context = vm.createContext({ window: client.window, location: new URL('https://watch.aitoyz.in/'),
    connectionInfo: { hosted: true, port: 8080, addresses: ['10.195.3.115'], networks: [] }, status: { state: { sessionMode: 'video', screenCount: 3 } },
    modeConfig: { video: { min: 2, max: 3, icon: 'screen' } }, screenLinks: links, screenRole: (number) => `Display ${number}`, escapeHtml: (value) => String(value),
    $: (selector) => { if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector); },
  });
  const code = source('admin.js'); vm.runInContext(code.slice(code.indexOf('function primaryAddress()'), code.indexOf('function renderMixer()')), context);
  vm.runInContext('renderLinks()', context);
  for (const screen of [1, 2, 3]) assert.ok(links.innerHTML.includes(`https://watch.aitoyz.in/screen.html?screen=${screen}&room=${room}`));
  assert.doesNotMatch(links.innerHTML, /localhost|10\.195\.3\.115|:8080/);
});

function virtualFile(size = 12 * 1024 ** 3, name = 'movie.mp4', type = 'video/mp4') {
  const reads = [];
  return { size, name, type, reads, slice(start = 0, end = size) {
    end = Math.min(end, size);
    return { async arrayBuffer() {
      assert.ok(end - start <= 256 * 1024, 'Should never read the complete movie'); reads.push([start, end]);
      return Uint8Array.from({ length: end - start }, (_, index) => (start + index) % 251).buffer;
    } };
  } };
}

function peerPage({ secure = true } = {}) {
  const events = [], sent = [], errors = [], broadcasts = [];
  class Events { constructor() { this.handlers = {}; events.push(this); } addEventListener(name, handler) { this.handlers[name] = handler; } }
  class Broadcast { constructor() { broadcasts.push(this); } postMessage(data) { queueMicrotask(() => { for (const other of broadcasts) if (other !== this) other.onmessage?.({ data }); }); } }
  const window = { isSecureContext: secure, CineWallSession: { room, link: (value) => `https://watch.aitoyz.in${value}?room=${room}` }, dispatchEvent: (event) => errors.push(event.detail) };
  const context = vm.createContext({ window, crypto: crypto.webcrypto, Uint8Array, Int32Array, DataView, TextEncoder, Map, Promise, Number, Math, JSON, Date,
    URL: { createObjectURL: () => 'blob:local-movie', revokeObjectURL() {} }, BroadcastChannel: Broadcast, EventSource: Events,
    navigator: {}, CustomEvent: class { constructor(type, options) { this.detail = options.detail; } }, setTimeout, clearTimeout,
    fetch: async (route, options) => {
      if (options?.body) {
        const body = JSON.parse(options.body); sent.push({ route, body });
        if (route === '/api/local-source') return { ok: true, json: async () => ({ state: { asset: { ...body, source: 'peer', version: 'movie-version' } } }) };
      }
      return { ok: true, json: async () => ({ iceServers: [] }) };
    },
  });
  vm.runInContext(source('media-peer.js'), context);
  return { api: window.CineWallFilePeer, context, events, sent, errors, window };
}

test('fingerprint is SHA-256 compatible and only reads 128 KiB of a virtual 12 GB movie', async () => {
  const client = peerPage(), file = virtualFile();
  const hash = await client.api.fingerprint(file);
  const head = await file.slice(0, 65536).arrayBuffer(), tail = await file.slice(file.size - 65536).arrayBuffer();
  assert.equal(hash, crypto.createHash('sha256').update(Buffer.from(head)).update(Buffer.from(tail)).update(String(file.size)).digest('hex'));
  assert.equal(file.reads.slice(0, 2).reduce((total, [start, end]) => total + end - start, 0), 128 * 1024);
  for (const bytes of [new Uint8Array(), new TextEncoder().encode('abc'), crypto.randomBytes(130007)]) assert.equal(client.api.sha256(bytes), crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('direct publish sends metadata only, with correct audio MIME fallback and original file size', async () => {
  const client = peerPage(), owner = new client.api.FilePeer(), file = virtualFile(12 * 1024 ** 3, 'sound.mp3', '');
  const state = await owner.publish(file);
  assert.equal(state.asset.size, file.size);
  assert.equal(state.asset.type, 'audio/mpeg');
  assert.equal(client.sent.length, 1);
  assert.ok(JSON.stringify(client.sent[0].body).length < 1000);
  assert.equal(file.reads.length, 2);
  owner.clear();
});

test('byte-exact remote ranges are split into bounded packets and never copy the full movie', async () => {
  const client = peerPage(), owner = new client.api.FilePeer(), receiver = new client.api.FilePeer(), file = virtualFile();
  const state = await owner.publish(file); receiver.asset = state.asset;
  const packets = [];
  const sender = { queued: 0, queue: Promise.resolve(), channel: { readyState: 'open', bufferedAmount: 0, send(packet) {
    if (typeof packet !== 'string') { packets.push(packet.byteLength); packet = packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength); }
    receiver.onData({}, packet);
  } } };
  receiver.connect = async () => ({ channel: { send: (data) => owner.onData(sender, data) } });
  for (const [start, end] of [[0, 256 * 1024], [file.size - 9000, file.size], [5 * 1024 ** 3, 5 * 1024 ** 3 + 1024]]) {
    const data = new Uint8Array(await receiver.range(start, end));
    assert.equal(data.length, end - start);
    assert.ok(data.every((value, index) => value === (start + index) % 251));
  }
  assert.ok(packets.every((size) => size <= 16 * 1024 + 4));
  assert.equal(receiver.waiting.size, 0);
  await assert.rejects(receiver.range(0, 256 * 1024 + 1), /Invalid movie range/);
  await assert.rejects(receiver.range(-1, 10), /Invalid movie range/);
  owner.clear(); receiver.clear();
});

test('matching local file bypasses network transfers; wrong or stale files are rejected', async () => {
  const client = peerPage({ secure: false }), owner = new client.api.FilePeer(), file = virtualFile(1000);
  const asset = (await owner.publish(file)).asset;
  const receiver = new client.api.FilePeer(); receiver.asset = asset;
  assert.equal(await receiver.selectSameFile(file, asset), 'blob:local-movie');
  assert.equal(await receiver.open(asset), 'blob:local-movie');
  await assert.rejects(receiver.selectSameFile(virtualFile(1001), asset), /same movie/);
  receiver.clear();
  await assert.rejects(receiver.selectSameFile(file, asset), /changed/);
  owner.clear();
});

test('parallel signaling creates one peer; intentional source cleanup does not report disconnection', async () => {
  const client = peerPage(), receiver = new client.api.FilePeer();
  let made = 0;
  client.context.RTCPeerConnection = class {
    constructor() { made++; this.connectionState = 'new'; }
    close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
  };
  const [a, b] = await Promise.all([receiver.getPeer(room, false), receiver.getPeer(room, false)]);
  assert.equal(a, b); assert.equal(made, 1);
  receiver.clear(); assert.equal(client.errors.length, 0);
  assert.equal(receiver.connectionTasks.size, 0);
});

function workerPage(file) {
  const handlers = {}, requests = [];
  const self = { addEventListener: (name, callback) => { handlers[name] = callback; }, clients: { async get(id) {
    assert.equal(id, 'requesting-display');
    return { postMessage(data, [port]) {
      requests.push(data);
      Promise.resolve().then(async () => data.type === 'media-meta' ? { size: file.size, type: file.type } : { buffer: await file.slice(data.start, data.end).arrayBuffer() })
        .then((answer) => { port.postMessage(answer); port.close(); });
    } };
  } } };
  vm.runInNewContext(source('media-worker.js'), { self, URL, Response, ReadableStream, MessageChannel, Uint8Array, Number, Math, setTimeout, clearTimeout });
  return { requests, async fetch(range, method = 'GET') {
    let response;
    handlers.fetch({ clientId: 'requesting-display', request: new Request('https://watch.aitoyz.in/__cinewall_peer__/version', { method, headers: range ? { Range: range } : {} }), respondWith(value) { response = value; } });
    return response;
  } };
}

test('service worker serves bounded seek/suffix ranges for a 12 GB source and handles HEAD', async () => {
  const file = virtualFile(), worker = workerPage(file);
  for (const range of ['bytes=5000000000-5000000122', 'bytes=-123']) {
    const response = await worker.fetch(range);
    assert.equal(response.status, 206);
    const bytes = new Uint8Array(await response.arrayBuffer()); assert.equal(bytes.length, 123);
    const start = range.startsWith('bytes=-') ? file.size - 123 : 5000000000;
    assert.ok(bytes.every((byte, index) => byte === (start + index) % 251));
  }
  const before = file.reads.length, head = await worker.fetch('bytes=0-99', 'HEAD');
  assert.equal(head.status, 206); assert.equal(head.headers.get('Content-Length'), '100'); assert.equal(file.reads.length, before);
  for (const range of ['bytes=-0', 'bytes=999-998', `bytes=${file.size}-`, 'bytes=0-2,4-5', 'bytes=9007199254740992-']) {
    const response = await worker.fetch(range); assert.equal(response.status, 416, range);
  }
});

test('cancelled full-file response stops additional reads instead of buffering 12 GB', async () => {
  const file = virtualFile(), worker = workerPage(file), response = await worker.fetch();
  const reader = response.body.getReader(); await reader.read(); await reader.cancel(); await turn();
  const count = file.reads.length; await turn(); assert.equal(file.reads.length, count);
  assert.ok(count <= 2); assert.ok(file.reads.every(([start, end]) => end - start <= 256 * 1024));
});

test('admin preview stops at ten seconds, stays muted and never follows full movie playback', () => {
  const code = source('admin.js'), handlers = {}, media = { duration: 900, currentTime: 100, paused: false, muted: false,
    getAttribute: () => 'blob:movie', pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); }, addEventListener: (name, fn) => { handlers[name] = fn; },
  };
  const context = vm.createContext({ media, status: { state: { sessionMode: 'video', playing: true, position: 500 } }, Math, Number,
    $: () => ({ addEventListener() {} }), localPreview: null, loadedMediaVersion: 'asset', trailerKey: '', scrubbing: false,
  });
  vm.runInContext(code.slice(code.indexOf("media.addEventListener('timeupdate'"), code.indexOf("media.addEventListener('error'")), context);
  handlers.timeupdate(); assert.equal(media.paused, true); assert.equal(media.currentTime, 10);
  vm.runInContext(code.slice(code.indexOf('function startTrailer()'), code.indexOf("document.addEventListener('keydown'")), context);
  media.loop = true;
  vm.runInContext('startTrailer()', context); assert.equal(media.currentTime, 0); assert.equal(media.muted, true); assert.equal(media.paused, false); assert.equal(media.loop, false);
  vm.runInContext(code.slice(code.indexOf('function syncPreview()'), code.indexOf('function render()')), context);
  media.currentTime = 4; vm.runInContext('syncPreview()', context); assert.equal(media.currentTime, 4);
});

function controller() {
  const code = source('admin.js'), requests = [];
  const node = { textContent: '', classList: { add() {}, remove() {} } };
  const context = vm.createContext({ Map, Promise, Date, Number, String, Math, JSON, warning: node,
    renderPlayer() {}, renderMixer() {}, render() {}, updateServerTime() {}, refresh: async () => {},
    fetch: async (route, init) => new Promise((resolve) => requests.push({ payload: JSON.parse(init.body), resolve })),
  });
  vm.runInContext(`let controlsQueue = Promise.resolve(), controlSequence = 0, serverOffset = 0; const pendingControls = new Map(), queuedRevisions = new Map(); let status = { state: { sessionMode: 'video', serverId: 's', commandId: 1, asset: { version: 'movie' }, playing: false, position: 0, anchorTime: Date.now(), audioSettings: {1:{volume:1,muted:false}} } }; function positionNow() { return status.state.position; } function audioSetting(screen) { return status.state.audioSettings[screen] || {volume:1,muted:false}; }`, context);
  vm.runInContext(code.slice(code.indexOf('function acceptState('), code.indexOf('function isPreparing()')), context);
  vm.runInContext(code.slice(code.indexOf('async function command('), code.indexOf('function renderModeShell()')), context);
  return { context, requests, run: (js) => vm.runInContext(js, context), reply(index, state) { requests[index].resolve({ ok: true, json: async () => ({ command: state }) }); } };
}

test('optimistic play/pause stays instant while stale server events cannot roll it back', async () => {
  const c = controller(), actual = c.run('status.state');
  const play = c.run("command({type:'play',position:12})"); await turn();
  assert.equal(c.run('status.state.playing'), true);
  c.context.actual = actual; c.run('acceptState(actual)'); assert.equal(c.run('status.state.playing'), true);
  const pause = c.run("command({type:'pause'})"); assert.equal(c.run('status.state.playing'), false);
  c.reply(0, { ...actual, playing: true, position: 12, commandId: 2 }); await play; await turn();
  assert.equal(c.run('status.state.playing'), false);
  c.reply(1, { ...actual, playing: false, position: 12, commandId: 3 }); await pause;
  assert.equal(c.run('pendingControls.size'), 0);
});

test('queued seeks/volume updates coalesce without dropping the latest value on another laptop', async () => {
  const c = controller(), actual = c.run('status.state');
  const first = c.run("command({type:'seek',position:10})"); await turn();
  const updates = [20, 30, 40].map((position) => c.run(`command({type:'seek',position:${position}})`));
  updates.push(c.run("command({type:'screen-audio',screen:2,volume:.2})"), c.run("command({type:'screen-audio',screen:3,volume:.7})"));
  assert.equal(c.run('status.state.position'), 40);
  c.reply(0, { ...actual, position: 10, commandId: 2 }); await first; await turn();
  assert.equal(c.requests[1].payload.position, 40); assert.equal(c.run('status.state.position'), 40);
  c.reply(1, { ...actual, position: 40, commandId: 3 }); await turn();
  assert.equal(c.requests[2].payload.screen, 2);
  c.reply(2, { ...actual, position: 40, commandId: 4, audioSettings: { 2: { volume: .2, muted: false } } }); await turn();
  assert.equal(c.requests[3].payload.screen, 3);
  c.reply(3, { ...actual, position: 40, commandId: 5, audioSettings: { 2: { volume: .2, muted: false }, 3: { volume: .7, muted: false } } });
  await Promise.all(updates); assert.equal(c.requests.length, 4); assert.equal(c.run('status.state.audioSettings[3].volume'), .7);
});
