'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../public/share-call.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.events = {}; this.attributes = {}; this.hidden = false; this.textContent = '';
    const classes = new Set(); this.classList = { toggle: (key, on) => on ? classes.add(key) : classes.delete(key) };
  }
  append(...items) { this.children.push(...items); items.forEach(item => { item.parent = this; }); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  addEventListener(name, fn) { this.events[name] = fn; }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector() { return this.span ||= new Element('span'); }
  async play() { this.played = true; if (this.blocked) throw new Error('Autoplay blocked'); }
}
class Stream {
  constructor(tracks = []) { this.tracks = [...tracks]; }
  getTracks() { return [...this.tracks]; }
  addTrack(track) { this.tracks.push(track); }
  removeTrack(track) { this.tracks = this.tracks.filter(item => item !== track); }
}
function track(kind) { return { id: `test-${kind}`, kind, readyState: 'live', events: {}, stop() { this.readyState = 'ended'; }, addEventListener(name, fn) { this.events[name] = fn; } }; }
function harness({ viewer = false, denied = false, waitForCapture = null } = {}) {
  const elements = new Map(), captures = [], pcs = [], requests = [], clipboard = [];
  const id = '00000000-0000-4000-8000-000000000001', remoteId = '00000000-0000-4000-8000-000000000002';
  let state = { settings: { count: 2 }, revision: 1, callVersion: 'room-call', participants: [{ peerId: remoteId, screen: 1, mic: true, camera: true, online: true }] };
  const get = selector => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); };
  class PC {
    constructor() { this.connectionState = 'new'; this.signalingState = 'stable'; this.senders = []; this.addedCandidates = []; pcs.push(this); }
    addTransceiver(kind) { const sender = { kind, track: null, async replaceTrack(next) { this.track = next; } }; this.senders.push(sender); return { sender }; }
    close() { this.connectionState = 'closed'; }
    async setLocalDescription() {
      const type = this.signalingState === 'have-remote-offer' ? 'answer' : 'offer';
      this.localDescription = { type, sdp: `${type}-sdp`, toJSON() { return { type: this.type, sdp: this.sdp }; } };
      this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable';
    }
    async setRemoteDescription(description) { this.remoteDescription = description; this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable'; }
    async addIceCandidate(candidate) { this.addedCandidates.push(candidate); }
  }
  const api = async (action, body) => {
    requests.push({ action, body });
    if (action === 'call-media') {
      state = { ...state, revision: state.revision + 1, participants: state.participants.filter(peer => peer.peerId !== id) };
      if (body.joined) state.participants.push({ peerId: id, screen: viewer ? 2 : 0, online: true, mic: body.mic, camera: body.camera });
      return state;
    }
    return { ok: true };
  };
  const context = {
    window: {}, URL, location: { href: `https://watch.aitoyz.in/share.html${viewer ? '?screen=2' : ''}` },
    document: { querySelector: get, createElement: tag => new Element(tag) },
    navigator: { mediaDevices: { getUserMedia: async constraints => {
      if (denied) { const error = new Error('Permission denied'); error.name = 'NotAllowedError'; throw error; }
      const kind = constraints.audio ? 'audio' : 'video', captured = track(kind);
      captures.push({ constraints, track: captured });
      if (waitForCapture) await waitForCapture;
      return new Stream([captured]);
    } }, clipboard: { writeText: async value => clipboard.push(value) } },
    MediaStream: Stream, RTCPeerConnection: PC,
  };
  vm.runInNewContext(code, context);
  const call = context.window.CineWallCall({ id, api, getInviteLink: () => 'https://watch.aitoyz.in/share.html?room=shared-test' });
  call.updateState(state);
  return { call, id, remoteId, get, captures, pcs, requests, clipboard, state: () => state, click: async selector => { await get(selector).events.click(); await flush(); await flush(); } };
}

test('call join requests no camera or microphone; local preview is muted and remote media is audible', async () => {
  const h = harness();
  assert.equal(h.captures.length, 0);
  await h.click('#callJoin');
  assert.equal(h.captures.length, 0);
  assert.equal(h.pcs.length, 1);
  const videos = h.get('#callTiles').children.map(tile => tile.children[0]);
  assert.equal(videos.filter(video => video.muted).length, 1);
  const remoteVideo = videos.find(video => !video.muted);
  h.pcs[0].ontrack({ track: track('audio') });
  await flush();
  assert.equal(remoteVideo.played, true);
  assert.equal(remoteVideo.srcObject.getTracks().length, 1);
  await h.click('#callJoin');
  assert.equal(h.pcs[0].connectionState, 'closed');
  assert.equal(h.get('#callTiles').children.length, 0);
});

test('mic and camera switch independently, publish state, replace outgoing tracks and stop on leave', async () => {
  const h = harness();
  await h.click('#callMic');
  assert.equal(h.captures[0].constraints.audio.echoCancellation, true);
  assert.equal(h.captures[0].constraints.audio.noiseSuppression, true);
  assert.equal(h.get('#callMic').attributes['aria-pressed'], 'true');
  assert.equal(h.pcs[0].senders[0].track, h.captures[0].track);
  await h.click('#callCamera');
  assert.equal(h.captures[1].constraints.audio, false);
  assert.equal(h.get('#callCamera').attributes['aria-pressed'], 'true');
  assert.equal(h.pcs[0].senders[1].track, h.captures[1].track);
  await h.click('#callMic');
  assert.equal(h.captures[0].track.readyState, 'ended');
  assert.equal(h.pcs[0].senders[0].track, null);
  assert.equal(h.captures[1].track.readyState, 'live');
  await h.click('#callJoin');
  assert.equal(h.captures[1].track.readyState, 'ended');
  assert.equal(h.state().participants.some(peer => peer.peerId === h.id), false);
});

test('denied device permission leaves camera and mic off and shows a clear message', async () => {
  const h = harness({ denied: true });
  await h.click('#callCamera');
  assert.equal(h.get('#callCamera').attributes['aria-pressed'], 'false');
  assert.match(h.get('#callError').textContent, /Access was blocked/);
  assert.equal(h.get('#callError').hidden, false);
});

test('removing a viewer stops its captured tracks and stale state cannot rejoin the call', async () => {
  const h = harness({ viewer: true });
  await h.click('#callCamera');
  const old = h.state();
  h.call.updateState({ ...old, revision: old.revision + 1, settings: { count: 1 }, participants: old.participants.filter(peer => peer.peerId !== h.id) });
  assert.equal(h.captures[0].track.readyState, 'ended');
  assert.equal(h.get('#callJoin').disabled, true);
  h.call.updateState(old);
  assert.equal(h.get('#callJoin').disabled, true);
});

test('call answers offers and flushes early ICE candidates; invite preserves the room', async () => {
  const h = harness();
  await h.click('#callJoin');
  await h.call.onSignal({ from: h.remoteId, version: 'room-call', candidate: { candidate: 'test-ice' } });
  assert.equal(h.pcs[0].addedCandidates.length, 0);
  await h.call.onSignal({ from: h.remoteId, version: 'room-call', description: { type: 'offer', sdp: 'remote-offer' } });
  assert.equal(h.pcs[0].addedCandidates.length, 1);
  assert.ok(h.requests.some(request => request.action === 'call-signal' && request.body.description?.type === 'answer'));
  await h.click('#callCopy');
  assert.deepEqual(h.clipboard, ['https://watch.aitoyz.in/share.html?room=shared-test']);
});

test('leaving while camera permission is pending immediately discards the eventual capture', async () => {
  let release;
  const h = harness({ waitForCapture: new Promise(resolve => { release = resolve; }) });
  await h.click('#callCamera');
  assert.equal(h.captures.length, 1);
  await h.click('#callJoin');
  release(); await flush(); await flush();
  assert.equal(h.captures[0].track.readyState, 'ended');
  assert.equal(h.get('#callTiles').children.length, 0);
  assert.equal(h.get('#callCamera').attributes['aria-pressed'], 'false');
});

test('hardware track ending updates mic state and releases the outgoing track', async () => {
  const h = harness();
  await h.click('#callMic');
  h.captures[0].track.readyState = 'ended';
  h.captures[0].track.events.ended(); await flush(); await flush();
  assert.equal(h.get('#callMic').attributes['aria-pressed'], 'false');
  assert.equal(h.pcs[0].senders[0].track, null);
  assert.equal(h.state().participants.find(peer => peer.peerId === h.id).mic, false);
});

test('screen-sharing UI is mirror-only and homepage section links are inside the brand header', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/share.html'), 'utf8');
  const home = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.doesNotMatch(html, /Split wall|data-layout="wall"|id="shareLayout"/);
  assert.match(html, /share-call\.js/);
  const header = home.match(/<header class="mode-nav">[\s\S]*?<\/header>/)?.[0];
  for (const target of ['how-it-works', 'demo', 'use-cases', 'about', 'faq']) assert.ok(header.includes(`href="#${target}"`));
});
