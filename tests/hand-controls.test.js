'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const core = require('../public/hand-gestures');
const { CameraSession } = require('../public/hand-controls');

test('six supported gestures require one confidently detected hand', () => {
  assert.equal(core.steps.length, 6);
  for (const step of core.steps) {
    assert.equal(core.labelFromResult({ landmarks: [[]], gestures: [[{ categoryName: step.label, score: .9 }]] }), step.label);
    assert.equal(core.labelFromResult({ landmarks: [[]], gestures: [[{ categoryName: step.label, score: .6 }]] }), '');
  }
  assert.equal(core.labelFromResult({ landmarks: [[], []], gestures: [[{ categoryName: 'Open_Palm', score: .99 }]] }), '');
  assert.equal(core.labelFromResult({}), '');
});
function hold(gate, label, start) { let result; for (let t = start; t <= start + 700; t += 100) result = gate.push(label, t); return result; }
test('stable holds fire once and require a neutral interval before another action', () => {
  const gate = new core.HoldGate();
  assert.equal(hold(gate, 'Victory', 0).action, 'forward');
  assert.equal(hold(gate, 'Victory', 800).action, undefined);
  assert.equal(hold(gate, 'ILoveYou', 1600).action, undefined, 'changing poses alone cannot issue another seek');
  hold(gate, '', 2400);
  assert.equal(hold(gate, 'ILoveYou', 3200).action, 'back');
});
test('flickering labels and stale camera frames do not satisfy the hold', () => {
  const gate = new core.HoldGate();
  for (let t = 0; t < 1800; t += 100) assert.equal(gate.push(t % 200 ? 'Open_Palm' : 'Closed_Fist', t).action, undefined);
  gate.reset(); gate.push('Open_Palm', 0);
  assert.equal(gate.push('Open_Palm', 2000).progress, 0);
});
test('practice advances only on the expected gesture and completes all six', () => {
  const practice = new core.Practice();
  assert.equal(practice.match('back'), false); assert.equal(practice.index, 0);
  for (const step of core.steps) { assert.equal(practice.done, false); assert.equal(practice.match(step.id), true); }
  assert.equal(practice.done, true);
});

const stream = () => { const track = { stopped: false, stop() { this.stopped = true; }, addEventListener() {}, getSettings: () => ({ deviceId: 'camera1' }) }; return { track, getTracks: () => [track], getVideoTracks: () => [track] }; };
const cameraVideo = () => ({ srcObject: null, readyState: 2, currentTime: 1, async play() {}, pause() {} });
test('turning off while camera permission is pending stops the late stream', async () => {
  let grant; const media = stream(), video = cameraVideo();
  const session = new CameraSession({ devices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } });
  const starting = session.start('', video); session.stop(); grant(media);
  assert.equal(await starting, false); assert.equal(media.track.stopped, true); assert.equal(video.srcObject, null);
});
test('model failure releases camera and worker; audio is never requested', async () => {
  const media = stream(), video = cameraVideo(); let requested;
  const worker = { terminate() { this.stopped = true; }, postMessage() { queueMicrotask(() => this.onmessage({ data: { type: 'error' } })); } };
  const session = new CameraSession({ devices: { async getUserMedia(options) { requested = options; return media; } }, makeWorker: () => worker });
  await assert.rejects(session.start('camera1', video));
  assert.equal(requested.audio, false); assert.equal(requested.video.deviceId.exact, 'camera1');
  assert.equal(media.track.stopped, true); assert.equal(worker.stopped, true); assert.equal(video.srcObject, null);
});

function uiFixture({ complete = false } = {}) {
  const nodes = new Map(), values = new Map(), workers = [], streams = [], timers = new Map();
  let nextTimer = 0, allowed = true;
  function element(id) {
    if (!nodes.has(id)) nodes.set(id, { id, hidden: true, checked: false, value: '', textContent: '', open: false, isConnected: true, events: {},
      addEventListener(name, callback) { this.events[name] = callback; }, appendChild() {}, replaceChildren(...children) { this.children = children; this.value = children.find(c => c.selected)?.value || children[0]?.value || ''; },
      showModal() { this.open = true; }, close() { this.open = false; }, focus() {}, ...cameraVideo() });
    return nodes.get(id);
  }
  const document = { hidden: false, activeElement: element('toggle'), events: {},
    getElementById: element, createElement: () => ({}), addEventListener(name, callback) { this.events[name] = callback; } };
  const window = { CineWallHandGestures: core, isSecureContext: true, Worker: true, createImageBitmap: true, addEventListener() {} };
  const navigator = { mediaDevices: { async getUserMedia() { const media = stream(); streams.push(media); return media; },
    async enumerateDevices() { return [{ kind: 'videoinput', deviceId: 'camera1', label: 'Laptop camera' }]; } } };
  if (complete) values.set('cinewall-hand-practice-v1', 'complete');
  class Worker {
    constructor() { workers.push(this); }
    postMessage(message) { if (message.type === 'init') queueMicrotask(() => this.onmessage({ data: { type: 'ready' } })); }
    terminate() { this.stopped = true; }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/hand-controls.js'), 'utf8'), {
    window, document, navigator, Worker, createImageBitmap() {}, performance: { now: () => 0 },
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; }, clearTimeout: id => timers.delete(id),
    setInterval: () => 0, clearInterval() {}
  });
  const actions = [];
  const ui = window.CineWallHandControls.create({ available: () => allowed, onAction: action => { actions.push(action); return true; } });
  function send(label, start) {
    for (let t = start; t <= start + 700; t += 100) workers.at(-1).onmessage({ data: { type: 'result', timestamp: t,
      result: { landmarks: label ? [[]] : [], gestures: label ? [[{ categoryName: label, score: .95 }]] : [] } } });
  }
  return { ui, element, document, values, workers, streams, actions, send,
    async enable() { element('handControlToggle').checked = true; await element('handControlToggle').events.change(); },
    advance() { for (const [id, timer] of timers) if (timer.delay === 900) { timers.delete(id); timer.callback(); } },
    modeOff() { allowed = false; ui.sync(); } };
}
test('first-use live practice matches each pose, saves completion, and never controls playback', async () => {
  const f = uiFixture(); await f.enable(); assert.equal(f.element('handPractice').open, true);
  let time = 0;
  for (const step of core.steps) {
    f.send('', time); time += 800; f.send(step.label, time); time += 800; f.advance();
  }
  assert.equal(f.element('handPractice').open, false);
  assert.equal(f.values.get('cinewall-hand-practice-v1'), 'complete'); assert.deepEqual(f.actions, []);
  f.send('ILoveYou', time); assert.deepEqual(f.actions, [], 'last practice pose is not a live seek');
  f.send('', time + 800); f.send('Victory', time + 1600); assert.deepEqual(f.actions, ['forward']);
  f.ui.stop();
});
test('off, mode changes, hidden tabs and cancelling practice stop the camera immediately', async () => {
  for (const reason of ['off', 'mode', 'hidden', 'cancel']) {
    const f = uiFixture(); await f.enable();
    if (reason === 'mode') f.modeOff();
    else if (reason === 'hidden') { f.document.hidden = true; f.document.events.visibilitychange(); }
    else if (reason === 'cancel') f.element('handPractice').events.cancel({ preventDefault() {} });
    else f.ui.stop();
    assert.equal(f.ui.enabled, false); assert.equal(f.streams[0].track.stopped, true); assert.equal(f.workers[0].stopped, true);
    assert.equal(f.element('handPractice').open, false); assert.equal(f.values.has('cinewall-hand-practice-v1'), false);
    f.send('Open_Palm', 1000); assert.deepEqual(f.actions, []);
  }
});
test('completed practice is remembered while camera always starts off', async () => {
  const f = uiFixture({ complete: true }); assert.equal(f.ui.enabled, false); assert.equal(f.streams.length, 0);
  await f.enable(); assert.equal(f.element('handPractice').open, false);
  f.send('Open_Palm', 0); assert.deepEqual(f.actions, ['play']);
  f.element('handPracticeAgain').events.click(); assert.equal(f.element('handPractice').open, true); f.ui.stop();
});
test('a camera can be changed during first-use practice without leaving the old camera open', async () => {
  const f = uiFixture(); await f.enable();
  f.element('handPracticeCameraSelect').value = 'camera2';
  await f.element('handPracticeCameraSelect').events.change();
  // The change event starts asynchronously, so drain its startup promises.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.streams[0].track.stopped, true); assert.equal(f.workers[0].stopped, true);
  assert.equal(f.streams.length, 2); assert.equal(f.element('handPractice').open, true);
  assert.equal(f.element('handPracticeProgress').textContent, '1 / 6'); f.ui.stop();
});

test('video gestures reuse synchronized transport, clamp volume and reject other modes or locked sources', () => {
  let config, locked = false, ready = true;
  const commands = [], seeks = [], volumes = [], nodes = new Map();
  const context = { handControls: null, status: { state: { sessionMode: 'video', asset: { version: 'v1' } } },
    window: { CineWallHandControls: { create(options) { config = options; } } },
    sourceLocked: () => locked, uploadBusy: false, removeBusy: false, isPreparing: () => false, playbackReady: () => ready,
    playOnAdminDisplay: () => commands.push('play'), command: value => commands.push(value.type), seekRelative: value => seeks.push(value),
    audioQueue: { queue: { cancelAutoplay() {} } }, audioSetting: () => ({ volume: .95 }), media: { volume: .95 }, queueVolume: (screen, volume) => volumes.push([screen, volume]),
    $: selector => { if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector); }
  };
  const source = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
  vm.runInNewContext(source.slice(source.lastIndexOf('handControls = window.'), source.lastIndexOf('bootstrap();')), context);
  for (const action of ['play', 'pause', 'forward', 'back', 'volume-up', 'volume-down']) assert.equal(config.onAction(action), true);
  assert.deepEqual(commands, ['play', 'pause']); assert.deepEqual(seeks, [10, -10]);
  assert.equal(volumes[0][1], 1); assert.equal(volumes[1][1], .85);
  ready = false; assert.notEqual(config.onAction('play'), true);
  locked = true; assert.equal(config.available(), false); assert.notEqual(config.onAction('forward'), true);
  locked = false; context.status.state.sessionMode = 'audio'; assert.equal(config.available(), false); assert.notEqual(config.onAction('pause'), true);
  context.status.state.sessionMode = 'video'; context.status.state.asset = null; assert.notEqual(config.onAction('back'), true);
  assert.deepEqual(seeks, [10, -10]);
});
