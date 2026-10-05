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
  class XHR { open(...args) { calls.push(args); } setRequestHeader() {} }
  class Events { constructor(url) { calls.push(['events', url]); } }
  const window = { fetch: async (...args) => { calls.push(['fetch', ...args]); return {}; }, EventSource: Events };
  const context = vm.createContext({ URL, Request, Headers, location, window, XMLHttpRequest: XHR, crypto: crypto.webcrypto,
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
  assert.equal(client.calls.at(-1)[2], undefined, 'never leak source-device credentials to an external origin');
  await client.window.fetch('/api/source/claim', { method: 'POST' });
  assert.equal(client.calls.at(-1)[2].headers.get('X-CineWall-Device'), client.window.CineWallSession.deviceId);
  assert.match(client.calls.at(-1)[2].headers.get('X-CineWall-Key'), /^[a-f0-9-]{36}$/);
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
  return { size, name, type, reads, slice(start = 0, end = size, sliceType = '') {
    end = Math.min(end, size);
    return { size: end - start, type: sliceType, async arrayBuffer() {
      assert.ok(end - start <= 256 * 1024, 'Should never read the complete movie'); reads.push([start, end]);
      return Uint8Array.from({ length: end - start }, (_, index) => (start + index) % 251).buffer;
    } };
  } };
}

function peerPage({ secure = true, worker = false } = {}) {
  const events = [], sent = [], errors = [], broadcasts = [], blobs = [], revoked = [], registrations = [], workerHandlers = [];
  class Events { constructor() { this.handlers = {}; events.push(this); } addEventListener(name, handler) { this.handlers[name] = handler; } }
  class Broadcast { constructor() { broadcasts.push(this); } postMessage(data) { queueMicrotask(() => { for (const other of broadcasts) if (other !== this) other.onmessage?.({ data }); }); } }
  const window = { isSecureContext: secure, CineWallSession: { room, link: (value) => `https://watch.aitoyz.in${value}?room=${room}` }, dispatchEvent: (event) => { if (event.type === 'cinewall-peer-error') errors.push(event.detail); } };
  const context = vm.createContext({ window, crypto: crypto.webcrypto, Uint8Array, Int32Array, DataView, TextEncoder, Map, Promise, Number, Math, JSON, Date,
    URL: { createObjectURL: (blob) => { blobs.push(blob); return 'blob:local-movie'; }, revokeObjectURL: (url) => revoked.push(url) }, BroadcastChannel: Broadcast, EventSource: Events,
    navigator: worker ? { serviceWorker: { controller: {}, ready: Promise.resolve(), async register(...args) { registrations.push(args); }, addEventListener(name, handler) { workerHandlers.push(handler); } } } : {}, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, setTimeout, clearTimeout,
    fetch: async (route, options) => {
      if (options?.body) {
        const body = JSON.parse(options.body); sent.push({ route, body });
        if (route === '/api/local-source') return { ok: true, json: async () => ({ state: { asset: { ...body, source: 'peer', version: 'movie-version' } } }) };
      }
      return { ok: true, json: async () => ({ iceServers: [] }) };
    },
  });
  vm.runInContext(source('media-peer.js'), context);
  return { api: window.CineWallFilePeer, context, events, sent, errors, window, blobs, revoked, registrations, workerHandlers };
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

test('Instant retries a failed source reply, ignores concurrent duplicates, and gives display reloads a fresh URL', async () => {
  const client = peerPage(), owner = new client.api.FilePeer(), file = virtualFile(1000000);
  const state = await owner.publish(file, 60, { relay: true });
  state.asset.transport = 'relay'; owner.asset = state.asset;
  let replies = 0;
  client.context.fetch = async (route, options) => {
    assert.match(route, /\/api\/source\/range\?id=request/);
    assert.equal(options.body.byteLength, 20);
    return { ok: ++replies > 1, status: replies > 1 ? 200 : 503 };
  };
  const event = { data: JSON.stringify({ id: 'request', version: state.asset.version, start: 100, end: 119 }) };
  const before = file.reads.length;
  const pending = client.events[0].handlers['source-range'](event);
  await client.events[0].handlers['source-range'](event); await pending;
  assert.equal(replies, 2); assert.equal(file.reads.length, before + 1);
  assert.equal(owner.sourceReplies.size, 0);
  const remote = new client.api.FilePeer(); remote.localRequest = async () => { throw new Error('Different laptop'); };
  const original = await remote.open(state.asset), retry = await remote.open(state.asset, { retry: 2 });
  assert.notEqual(original, retry); assert.match(retry, /retry=2/);
  owner.clear(); remote.clear();
});

test('MKV OS MIME associations are normalized in metadata, preview and local playback without reading 12 GB', async () => {
  const client = peerPage(), file = virtualFile(12 * 1024 ** 3, 'movie.MKV', 'video/mkv');
  const owner = new client.api.FilePeer(), state = await owner.publish(file);
  assert.equal(state.asset.type, 'video/x-matroska');
  assert.equal(client.blobs[0].type, 'video/x-matroska');
  assert.equal(client.blobs[0].size, file.size);
  assert.equal(file.reads.length, 3, 'fingerprint head/tail plus a bounded MKV header, not a complete-file read');
  const preview = client.api.mediaBlob(file);
  assert.equal(preview.type, 'video/x-matroska'); assert.equal(file.reads.length, 3);
  assert.equal(client.api.mediaType({ name: 'movie.mkv', type: 'application/octet-stream' }), 'video/x-matroska');
  owner.clear(); assert.equal(client.revoked.length, 1);
});

test('bounded MKV header inspection identifies actual HEVC and Dolby tracks, never guesses from the filename', async () => {
  const client = peerPage();
  const element = (id, data) => Buffer.concat([Buffer.from(id, 'hex'), Buffer.from([128 | data.length]), data]);
  const tracks = element('1654ae6b', Buffer.concat(['V_MPEGH/ISO/HEVC', 'A_EAC3'].map((codec) => element('ae', element('86', Buffer.from(codec))))));
  const header = Buffer.concat([element('1a45dfa3', Buffer.alloc(0)), Buffer.from('18538067ff', 'hex'), tracks]);
  assert.deepEqual(Array.from(client.api.matroskaCodecs(header)), ['V_MPEGH/ISO/HEVC', 'A_EAC3']);
  assert.deepEqual(Array.from(client.api.matroskaCodecs(Buffer.from('movie HEVC x265 A_EAC3'))), []);
  const reads = [], file = { name: 'movie.mkv', size: 12 * 1024 ** 3, slice(start, end) {
    reads.push([start, end]); return { async arrayBuffer() { return Uint8Array.from(header).buffer; } };
  } };
  const codecs = await client.api.inspectCodecs(file);
  assert.deepEqual(reads, [[0, 256 * 1024]]);
  assert.match(client.api.playbackHelp({ codecs }), /MP4 with H\.264 video and AAC audio/);
  assert.match(client.api.codecSummary({ codecs }), /HEVC\/H.265 \+ Dolby Digital Plus/);
});

test('admin range recovery reads local bytes through the source tab, never via WebRTC or upload', async () => {
  const client = peerPage({ worker: true }), owner = new client.api.FilePeer(), admin = new client.api.FilePeer();
  const file = virtualFile(), asset = (await owner.publish(file)).asset;
  assert.equal(await admin.open(asset), 'blob:local-movie');
  const url = await admin.open(asset, { ranged: true, retry: 1 });
  assert.match(url, /__cinewall_peer__\/movie-version\?attempt=1/);
  admin.connect = () => { throw new Error('Admin must not open a network peer to itself'); };
  const bytes = new Uint8Array(await admin.range(5000000000, 5000000123));
  assert.equal(bytes.length, 123);
  assert.ok(bytes.every((byte, index) => byte === (5000000000 + index) % 251));
  assert.equal(client.sent.length, 1, 'metadata only; no movie upload');
  assert.equal(client.registrations[0][1].updateViaCache, 'none');
  await admin.open(asset, { ranged: true, type: '', retry: 2 });
  assert.equal(admin.playbackType, '');
  assert.ok(client.blobs.some((blob) => blob.type === ''));
  owner.clear(); admin.clear();
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

test('insecure remote LAN displays never ask for a second copy of the admin movie', async () => {
  const client = peerPage({ secure: false }), owner = new client.api.FilePeer(), file = virtualFile(1000);
  const asset = (await owner.publish(file)).asset;
  const receiver = new client.api.FilePeer(); receiver.asset = asset;
  receiver.localRequest = async () => { throw new Error('The admin is on another Device'); };
  await assert.rejects(receiver.open(asset), /choose the file again/);
  assert.equal(receiver.file, null);
  assert.equal(owner.file, file);
  receiver.clear();
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

test('hotspot publishing requires a secure browser and sends only metadata, never enabling relay', async () => {
  const client = peerPage({ worker: true }), owner = new client.api.FilePeer();
  client.context.RTCPeerConnection = class {};
  await owner.publish(virtualFile(), 60, { localOnly: true, relay: true });
  assert.equal(client.sent[0].body.localOnly, true); assert.equal(client.sent[0].body.relay, false);
  assert.equal(client.sent.length, 1);
  owner.clear();
  const insecure = peerPage({ secure: false });
  await assert.rejects(new insecure.api.FilePeer().publish(virtualFile(), 60, { localOnly: true }), /HTTPS/);
  assert.equal(insecure.sent.length, 0);
});

test('hotspot candidates/SDP accept private IPs and mDNS, never public, STUN or TURN routes', () => {
  const { api } = peerPage();
  const line = (address, type = 'host') => `candidate:1 1 udp 2122260223 ${address} 50000 typ ${type}`;
  for (const address of ['192.168.137.2', '10.0.0.2', '172.31.4.2', '169.254.1.2', '127.0.0.1', 'fe80::1234', 'fd12::3', 'abcd-1234.local']) assert.equal(api.hotspotCandidate({ candidate: line(address) }), true, address);
  for (const address of ['8.8.8.8', '172.32.1.2', '192.168.999.1', '2001:db8::1', 'example.com']) assert.equal(api.hotspotCandidate(line(address)), false, address);
  for (const type of ['srflx', 'relay', 'prflx']) assert.equal(api.hotspotCandidate(line('192.168.137.2', type)), false);
  const description = api.hotspotDescription({ type: 'offer', sdp: `v=0\r\na=${line('192.168.137.2')}\r\na=${line('8.8.8.8', 'relay')}\r\na=${line('192.168.137.3', 'srflx')}\r\n` });
  assert.match(description.sdp, /192\.168\.137\.2/); assert.doesNotMatch(description.sdp, /8\.8\.8\.8|srflx|relay/);
});

test('hotspot negotiation ignores configured ICE servers and filters candidates both ways', async () => {
  const client = peerPage(), receiver = new client.api.FilePeer(), configurations = [], incoming = [];
  client.context.fetch = async () => { throw new Error('Hotspot must not fetch STUN/TURN configuration'); };
  receiver.request = async (route, body) => { client.sent.push({ route, body }); return {}; };
  client.context.RTCPeerConnection = class {
    constructor(configuration) { configurations.push(configuration); this.connectionState = 'new'; this.remoteDescription = null; }
    close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
    async setRemoteDescription(description) { this.remoteDescription = description; }
    async addIceCandidate(candidate) { incoming.push(candidate); }
  };
  receiver.asset = { transport: 'hotspot' };
  const peer = await receiver.getPeer(room, false);
  assert.equal(configurations[0].iceServers.length, 0);
  await receiver.onSignal({ from: room, description: { type: 'answer', sdp: 'v=0\r\n' } });
  const local = { candidate: 'candidate:1 1 udp 1 192.168.137.2 40000 typ host' };
  const relay = { candidate: 'candidate:1 1 udp 1 8.8.8.8 40000 typ relay' };
  peer.pc.onicecandidate({ candidate: relay }); peer.pc.onicecandidate({ candidate: local }); await turn();
  assert.equal(client.sent.length, 1); assert.equal(client.sent[0].body.candidate.candidate, local.candidate);
  await receiver.onSignal({ from: room, candidate: relay }); await receiver.onSignal({ from: room, candidate: local });
  assert.equal(incoming.length, 1); receiver.clear();
});

function routeStats(localType = 'host', remoteType = 'host', address = '192.168.137.2') {
  return new Map([
    ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
    ['pair', { type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'local', remoteCandidateId: 'remote' }],
    ['local', { candidateType: localType, address: '192.168.137.1' }], ['remote', { candidateType: remoteType, address }],
  ]);
}

test('hotspot validates the selected route before transferring bytes and never answers a server range', async () => {
  const client = peerPage(), owner = new client.api.FilePeer(), file = virtualFile(), packets = [];
  owner.asset = (await owner.publish(file)).asset; owner.asset.transport = 'hotspot';
  const peer = { localOnly: true, queued: 0, queue: Promise.resolve(), pc: { getStats: async () => routeStats('host', 'relay') }, channel: { readyState: 'open', send: packet => packets.push(packet) } };
  const reads = file.reads.length;
  owner.onData(peer, JSON.stringify({ type: 'range', id: 1, version: owner.asset.version, start: 0, end: 1024 }));
  await peer.queue;
  assert.equal(file.reads.length, reads, 'blocked route cannot even read movie bytes');
  assert.equal(JSON.parse(packets[0]).type, 'error'); assert.match(JSON.parse(packets[0]).error, /same hotspot/);
  await client.events[0].handlers['source-range']({ data: JSON.stringify({ id: 'test', version: owner.asset.version, start: 0, end: 1023 }) });
  assert.equal(client.sent.length, 1, 'no source-range POST');
  for (const [local, remote, address] of [['srflx', 'host', '192.168.137.2'], ['host', 'host', '8.8.8.8']]) {
    await assert.rejects(owner.checkHotspotRoute({ localOnly: true, pc: { getStats: async () => routeStats(local, remote, address) } }), /same hotspot/);
  }
  await owner.checkHotspotRoute({ localOnly: true, pc: { getStats: async () => routeStats() } });
  const hiddenAddresses = routeStats(); delete hiddenAddresses.get('local').address; delete hiddenAddresses.get('remote').address;
  await owner.checkHotspotRoute({ localOnly: true, pc: { getStats: async () => hiddenAddresses } });
  owner.clear();
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

test('Instant feedback requires an open verified local route and reflects failed/reconnecting channels', () => {
  const client = peerPage(), receiver = new client.api.FilePeer(), notices = [];
  client.window.dispatchEvent = event => { if (event.type === 'cinewall-peer-status') notices.push(event.detail); };
  receiver.asset = { source: 'peer', transport: 'hotspot', peerId: 'source', version: 'current' };
  assert.equal(receiver.connectionStatus(), 'searching');
  const peer = { pc: { connectionState: 'connected' }, channel: { readyState: 'open' }, localOnly: true, hotspotVerified: false };
  receiver.connections.set('source', peer);
  assert.equal(receiver.connectionStatus(), 'searching', 'unverified data channel must not claim a hotspot');
  peer.hotspotVerified = true;
  assert.equal(receiver.connectionStatus(), 'connected');
  receiver.notifyConnectionStatus(); receiver.notifyConnectionStatus();
  assert.equal(notices.length, 1, 'unchanged connection status does not create status loops');
  peer.pc.connectionState = 'disconnected';
  assert.equal(receiver.connectionStatus(), 'disconnected'); receiver.notifyConnectionStatus();
  assert.equal(notices.length, 2);
  peer.pc.connectionState = 'connected'; peer.channel.readyState = 'closed';
  assert.equal(receiver.connectionStatus(), 'disconnected');
  receiver.localSource = 'same-device-tab';
  assert.equal(receiver.connectionStatus(), 'local', 'same-device playback is not proof of a hotspot connection');
  receiver.connections.clear(); receiver.clear();
  assert.equal(receiver.connectionStatus(), 'idle');
});

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

test('native-sniff retry omits only the MIME hint and still returns byte-exact seekable ranges', async () => {
  const file = virtualFile(10000, 'movie.mkv', ''), response = await workerPage(file).fetch('bytes=123-246');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Type'), null);
  assert.equal(response.headers.get('Content-Range'), 'bytes 123-246/10000');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), Uint8Array.from({ length: 124 }, (_, index) => (123 + index) % 251));
});

test('admin preview stops at ten seconds, stays muted and never follows full movie playback', () => {
  const code = source('admin.js'), handlers = {}, media = { duration: 900, currentTime: 100, paused: false, muted: false,
    getAttribute: () => 'blob:movie', pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); }, addEventListener: (name, fn) => { handlers[name] = fn; },
  };
  const context = vm.createContext({ media, status: { state: { sessionMode: 'video', playing: true, position: 500 } }, Math, Number,
    $: () => ({ addEventListener() {} }), captureSourcePoster() {}, updateAudioWaves() {}, localPreview: null, loadedMediaVersion: 'asset', trailerKey: '', scrubbing: false,
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
    renderPlayer() {}, renderMixer() {}, render() {}, updateServerTime() {}, refresh: async () => {}, sourceLocked: () => false, playbackReady: () => true,
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

test('queued seeks/volume updates coalesce without dropping the latest value on another Device', async () => {
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
