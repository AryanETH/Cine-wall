'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../public/mic.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

class Element {
  constructor(tag = 'div') {
    Object.assign(this, { tag, children: [], events: {}, attributes: {}, style: {}, dataset: {}, hidden: false, textContent: '', value: '', disabled: false, scrollTop: 0, scrollHeight: 2000, clientHeight: 330, paused: true });
    const classes = new Set();
    this.classList = { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key), toggle: (key, on = !classes.has(key)) => { if (on) classes.add(key); else classes.delete(key); return on; } };
  }
  addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
  append(...children) { this.children.push(...children); for (const child of children) child.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  insertBefore(child, before) { child.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, child); child.parent = this; }
  replaceChildren(...children) { this.children = children; }
  querySelector(tag) { for (const child of this.children) { if (child.tag === tag) return child; const nested = child.querySelector(tag); if (nested) return nested; } return null; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  focus() { this.focused = true; }
  select() {}
  load() {}
  async play() { this.paused = false; await this.dispatch('play'); }
  pause() { this.paused = true; void this.dispatch('pause'); }
  async dispatch(name, details = {}) { for (const fn of this.events[name] || []) await fn({ target: this, ...details }); }
}
class Stream {
  constructor(tracks = []) { this.tracks = tracks; }
  addTrack(track) { this.tracks.push(track); }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
  getTracks() { return this.tracks; }
}
const track = () => ({ kind: 'audio', readyState: 'live', stop() { this.readyState = 'ended'; } });

async function harness({ role = 'phone', denied = false, secure = true, noStorage = false, saved = new Map(), local = new Map() } = {}) {
  const nodes = new Map(), contexts = [], requests = [], events = [], recorders = [], captures = [], pcs = [], frames = new Map(), timers = [], urls = new Set();
  let frameId = 0, roomState = { version: 'test-version', laptops: [1], peers: [] };
  const get = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
  for (const [key, value] of Object.entries({ micBoost: '1', speakerVolume: '1', scrollSpeed: '35', fontSize: '36' })) get(`#${key}`).value = value;
  class AudioNode {
    constructor(kind, stream) { this.kind = kind; this.stream = stream; this.links = []; this.gain = { value: 1 }; this.threshold = {}; this.knee = {}; this.ratio = {}; this.fftSize = 256; }
    connect(node) { this.links.push(node); return node; }
    disconnect() { this.links = []; }
    getByteTimeDomainData(array) { array.fill(128); }
  }
  class AudioContext {
    constructor() { this.nodes = []; this.state = 'suspended'; this.destination = this.node('speaker-output'); contexts.push(this); }
    node(kind, stream) { const node = new AudioNode(kind, stream); this.nodes.push(node); return node; }
    createDynamicsCompressor() { return this.node('compressor'); }
    createMediaStreamDestination() { return this.node('destination', new Stream([track()])); }
    createMediaStreamSource(stream) { return this.node('microphone', stream); }
    createGain() { return this.node('gain'); }
    createAnalyser() { return this.node('analyser'); }
    createMediaElementSource() { return this.node('file'); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }
  class Recorder {
    static isTypeSupported(mime) { return mime.startsWith('audio/webm'); }
    constructor(stream, options) { this.stream = stream; this.mimeType = options?.mimeType || 'audio/webm'; this.state = 'inactive'; recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['voice-audio'], { type: this.mimeType }) }); void this.onstop?.(); }); }
  }
  class PC {
    constructor() { this.connectionState = 'new'; this.candidates = []; this.tracks = []; pcs.push(this); }
    addTrack(track) { this.tracks.push(track); }
    async createOffer() { return { type: 'offer', sdp: 'offer' }; }
    async createAnswer() { return { type: 'answer', sdp: 'answer' }; }
    async setLocalDescription(description) { this.localDescription = { ...description, toJSON: () => description }; }
    async setRemoteDescription(description) { this.remoteDescription = description; }
    async addIceCandidate(candidate) { this.candidates.push(candidate); }
    close() { this.connectionState = 'closed'; }
  }
  const documentEvents = {}, windowEvents = {};
  const document = { body: new Element(), visibilityState: 'visible', querySelector: get, createElement: tag => new Element(tag), getElementById: id => get('#deviceLinks').children.find(c => c.id === id), addEventListener: (key, fn) => { documentEvents[key] = fn; } };
  const location = { href: `https://test.invalid/mic.html${role === 'phone' ? '?role=phone' : role === 'speaker' ? '?speaker=1' : ''}`, origin: 'https://test.invalid', protocol: 'https:', reload() {} };
  const window = { AudioContext, MediaRecorder: Recorder, isSecureContext: secure, addEventListener: (key, fn) => { windowEvents[key] = fn; }, CineWallSession: { hosted: true, link: (suffix, origin) => new URL(suffix, origin || location.origin).href } };
  const fetch = async (url, init) => {
    const action = url.split('/').pop(), body = init?.body ? JSON.parse(init.body) : {};
    requests.push({ action, body });
    let data;
    if (action === 'info') data = { hosted: true, iceServers: [] };
    else if (action === 'join') { roomState.peers = roomState.peers.filter(p => p.peerId !== body.peerId); roomState.peers.push({ peerId: body.peerId, role: body.role, slot: body.role === 'speaker' ? body.slot : 0, online: true, live: false, status: 'waiting' }); data = { token: 'test-token', state: roomState }; }
    else if (action === 'laptops') {
      if (body.action === 'add') { const slot = [1, 2, 3].find(n => !roomState.laptops.includes(n)); if (slot) roomState.laptops.push(slot); roomState.laptops.sort(); }
      else { roomState.laptops = roomState.laptops.filter(n => n !== body.slot); roomState.peers = roomState.peers.filter(p => p.role !== 'speaker' || p.slot !== body.slot); }
      data = roomState;
    }
    else { if (action === 'live') roomState.peers.find(p => p.peerId === body.peerId).live = body.live; data = action === 'signal' ? { ok: true } : roomState; }
    return { ok: true, json: async () => structuredClone(data) };
  };
  const indexedDB = { open: () => {
    const req = {};
    queueMicrotask(() => {
      if (noStorage) { req.error = new Error('quota'); req.onerror(); return; }
      req.result = { transaction: () => {
        const tx = { objectStore: () => Object.fromEntries(['getAll', 'put', 'delete'].map(action => [action, value => {
          const operation = {};
          setImmediate(() => { if (action === 'getAll') operation.result = [...saved.values()]; if (action === 'put') saved.set(value.id, value); if (action === 'delete') saved.delete(value); tx.oncomplete?.(); });
          return operation;
        }])) }; return tx;
      } }; req.onsuccess();
    }); return req;
  } };
  class TestURL extends URL {}
  TestURL.createObjectURL = () => { const url = `blob:test-${urls.size + 1}-${Math.random()}`; urls.add(url); return url; }; TestURL.revokeObjectURL = url => urls.delete(url);
  vm.runInNewContext(source, {
    window, document, location, fetch, indexedDB, URL: TestURL, MediaStream: Stream, RTCPeerConnection: PC, MediaRecorder: Recorder, Blob, crypto: webcrypto,
    navigator: { mediaDevices: { getUserMedia: async () => { if (denied) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); const stream = new Stream([track()]); captures.push(stream); return stream; } } },
    Audio: class extends Element {},
    EventSource: class { constructor() { this.handlers = {}; events.push(this); queueMicrotask(() => this.onopen?.()); } addEventListener(key, fn) { this.handlers[key] = fn; } close() {} },
    localStorage: { getItem: key => local.get(key), setItem: (key, value) => local.set(key, value) },
    requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: key => frames.delete(key), setInterval: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearInterval() {}, setTimeout: fn => fn(),
  });
  await flush();
  return { get, contexts, requests, captures, pcs, saved, local, recorders, document, events, frames, urls,
    click: async selector => { await get(selector).dispatch('click'); await flush(); },
    input: async (selector, value) => { get(selector).value = value; await get(selector).dispatch('input'); await flush(); },
    frame: time => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(time)); },
    signal: async data => { events.at(-1).handlers['mic-signal']({ data: JSON.stringify(data) }); await flush(); },
    state: async peers => { roomState = { ...roomState, peers: [roomState.peers[0], ...peers] }; events.at(-1).handlers['mic-state']({ data: JSON.stringify(roomState) }); await flush(); },
    heartbeat: async () => { await timers.find(timer => timer.delay === 3000).fn(); await flush(); },
  };
}

test('microphone requests permission only on demand, broadcasts with boost, and stops its captured track', async () => {
  const h = await harness(); assert.equal(h.captures.length, 0);
  await h.click('#toggleMic'); assert.equal(h.captures.length, 1); assert.match(h.get('#phoneState').textContent, /live/);
  assert.ok(h.requests.some(r => r.action === 'live' && r.body.live));
  await h.input('#micBoost', '2'); assert.equal(h.contexts[0].nodes.find(n => n.kind === 'gain').gain.value, 2);
  await h.click('#muteMic'); assert.match(h.get('#phoneState').textContent, /muted/); assert.equal(h.captures[0].getTracks()[0].readyState, 'live');
  await h.click('#toggleMic'); assert.equal(h.captures[0].getTracks()[0].readyState, 'ended'); assert.equal(h.get('#phoneState').textContent, 'Mic off');
});

test('record without broadcasting; stop exposes playable download, reload persists and delete removes a take', async () => {
  const saved = new Map(), h = await harness({ saved });
  await h.click('#startRecord'); assert.equal(h.recorders[0].state, 'recording'); assert.match(h.get('#phoneState').textContent, /muted/);
  assert.equal(h.requests.some(r => r.action === 'live' && r.body.live), false);
  const destinations = h.contexts[0].nodes.filter(n => n.kind === 'destination');
  assert.equal(h.recorders[0].stream, destinations[1].stream, 'record the separate voice path');
  assert.deepEqual(h.contexts[0].nodes.find(n => n.kind === 'file').links.map(n => n.kind), ['compressor'], 'file audio goes only to the broadcast bus');
  await h.click('#stopRecord'); assert.equal(saved.size, 1); assert.equal(h.get('#recordings').children.length, 1);
  const take = h.get('#recordings').children[0]; assert.match(take.querySelector('audio').src, /^blob:/); assert.match(take.querySelector('a').download, /\.webm$/);
  const reload = await harness({ saved }); assert.equal(reload.get('#recordings').children.length, 1);
  await reload.get('#recordings').children[0].querySelector('button').dispatch('click'); await flush(); assert.equal(saved.size, 0); assert.equal(reload.get('#recordings').children.length, 0);
});

test('storage failure leaves a take available for preview/download and guards it against disconnect', async () => {
  const h = await harness({ noStorage: true }); await h.click('#startRecord'); await h.click('#stopRecord');
  assert.equal(h.get('#recordings').children.length, 1); assert.match(h.get('#recordings').children[0].querySelector('small').textContent, /Download before leaving/);
  await h.click('#leaveRoom'); assert.match(h.get('#micError').textContent, /unsaved takes/);
});

test('denied permission and insecure HTTP show actionable errors without capture or recording', async () => {
  for (const config of [{ denied: true }, { secure: false }]) {
    const h = await harness(config); await h.click('#toggleMic'); assert.equal(h.captures.length, 0); assert.equal(h.get('#micError').hidden, false);
    assert.match(h.get('#micError').textContent, config.denied ? /permission was denied/ : /trusted HTTPS/);
    await h.click('#startRecord'); assert.equal(h.recorders.length, 0); assert.equal(h.get('#startRecord').disabled, false);
  }
});

test('teleprompter stores pasted text, adjusts type and scroll speed, pauses, resets and focuses', async () => {
  const h = await harness(); await h.input('#scriptText', 'Hello room.\nRead this script.');
  assert.equal(h.get('#prompterText').textContent, 'Hello room.\nRead this script.');
  assert.equal(h.local.get('cinewall-mic-script'), h.get('#prompterText').textContent);
  await h.input('#fontSize', '52'); assert.equal(h.get('#prompterText').style.fontSize, '52px');
  await h.input('#scrollSpeed', '60'); await h.click('#scrollToggle'); h.frame(100); h.frame(200);
  assert.equal(h.get('#prompterViewport').scrollTop, 6);
  await h.click('#scrollToggle'); assert.equal(h.get('#scrollToggle').textContent, 'Start');
  await h.click('#resetScroll'); assert.equal(h.get('#prompterViewport').scrollTop, 0);
  await h.click('#focusPrompter'); assert.equal(h.get('#prompterPanel').classList.contains('focused'), true);
  await h.click('#focusPrompter'); assert.equal(h.document.body.style.overflow, '');
  await h.click('#mirrorScript'); assert.equal(h.get('#mirrorScript').attributes['aria-pressed'], 'true');
});

test('speaker buffers ICE arriving before an offer, answers it and enables output only after a tap', async () => {
  const h = await harness({ role: 'speaker' }), phoneId = '00000000-0000-4000-8000-000000000010';
  await h.state([{ peerId: phoneId, role: 'phone', slot: 0, online: true, live: true }]);
  await h.signal({ from: phoneId, version: 'test-version', candidate: { candidate: 'early-host' } });
  await h.signal({ from: phoneId, version: 'test-version', description: { type: 'offer', sdp: 'audio-offer' } });
  assert.equal(h.pcs.length, 1); assert.equal(h.pcs[0].candidates.length, 1); assert.ok(h.requests.some(r => r.action === 'signal' && r.body.description?.type === 'answer'));
  h.pcs[0].ontrack({ track: track(), receiver: {} }); await flush(); assert.equal(h.contexts.length, 0);
  await h.click('#enableSpeaker'); assert.equal(h.contexts.length, 1); assert.equal(h.contexts[0].state, 'running');
  await h.input('#speakerVolume', '.4'); assert.equal(h.contexts[0].nodes.find(n => n.kind === 'gain').gain.value, .4);
  await h.click('#muteSpeaker'); assert.equal(h.contexts[0].nodes.find(n => n.kind === 'gain').gain.value, 0);
  assert.equal(Number(h.get('#speakerVolume').value), 0); assert.equal(h.get('#volumeValue').textContent, '0%');
  await h.click('#muteSpeaker');
  assert.equal(Number(h.get('#speakerVolume').value), .4); assert.equal(h.get('#volumeValue').textContent, '40%');
  assert.equal(h.contexts[0].nodes.find(n => n.kind === 'gain').gain.value, .4);
  await h.click('#muteSpeaker'); await h.input('#speakerVolume', '.25');
  assert.equal(h.get('#muteSpeaker').textContent, 'Mute'); assert.equal(h.contexts[0].nodes.find(n => n.kind === 'gain').gain.value, .25);
  await h.input('#speakerVolume', '0'); await h.click('#muteSpeaker'); await h.click('#muteSpeaker');
  assert.equal(Number(h.get('#speakerVolume').value), 0, 'an explicitly selected zero level is restored as zero');
});

test('device controls start with one laptop, cap at three, remove a slot and reuse its number', async () => {
  const h = await harness({ role: '' });
  const laptops = () => h.get('#deviceLinks').children.filter(c => c.id.startsWith('speaker-'));
  assert.equal(laptops().length, 1);
  await h.click('#addLaptop'); await h.click('#addLaptop');
  assert.equal(laptops().length, 3); assert.equal(h.get('#addLaptop').disabled, true);
  const two = laptops().find(c => c.id === 'speaker-2');
  await two.laptopRemoveButton.dispatch('click'); await flush();
  assert.equal(laptops().length, 2); assert.equal(h.get('#addLaptop').disabled, false);
  await h.click('#addLaptop'); assert.equal(laptops().filter(c => c.id === 'speaker-2').length, 1);
  assert.deepEqual(laptops().map(c => c.id), ['speaker-1', 'speaker-2', 'speaker-3']);
});

test('removing this laptop silences playback and stops automatic reconnects', async () => {
  const h = await harness({ role: 'speaker' }), phoneId = '00000000-0000-4000-8000-000000000010';
  await h.state([{ peerId: phoneId, role: 'phone', slot: 0, online: true, live: true }]);
  await h.signal({ from: phoneId, version: 'test-version', description: { type: 'offer', sdp: 'audio-offer' } });
  h.pcs[0].ontrack({ track: track(), receiver: {} }); await flush(); await h.click('#enableSpeaker');
  h.events.at(-1).handlers['mic-removed']({ data: '{"slot":1}' }); await flush();
  assert.equal(h.pcs[0].connectionState, 'closed');
  assert.equal(h.contexts[0].nodes.find(n => n.kind === 'microphone').links.length, 0);
  assert.equal(h.get('#speakerTitle').textContent, 'Laptop removed');
  const count = h.requests.filter(r => r.action === 'join').length;
  await h.heartbeat(); assert.equal(h.requests.filter(r => r.action === 'join').length, count);
});
