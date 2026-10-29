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

test('changing camera during pending permission serializes capture and cancels intermediate choices', async () => {
  let grant; const requests = [], streams = [];
  const session = new CameraSession({ devices: { getUserMedia(options) {
    requests.push(options.video.deviceId.exact);
    if (requests.length === 1) return new Promise(resolve => { grant = resolve; });
    const media = stream(); streams.push(media); return Promise.resolve(media);
  } }, makeWorker: () => ({ terminate() {}, postMessage() { queueMicrotask(() => this.onmessage({ data: { type: 'ready' } })); } }) });
  const first = session.start('first', cameraVideo());
  const middle = session.start('middle', cameraVideo());
  const latest = session.start('latest', cameraVideo());
  assert.deepEqual(requests, ['first']);
  const old = stream(); grant(old);
  assert.equal(await first, false); assert.equal(await middle, false); assert.equal(await latest, true);
  assert.deepEqual(requests, ['first', 'latest']); assert.equal(old.track.stopped, true);
  await session.stop(); assert.equal(streams[0].track.stopped, true);
});
test('model failure releases camera and worker; audio is never requested', async () => {
  const media = stream(), video = cameraVideo(); let requested;
  const worker = { terminate() { this.stopped = true; }, postMessage() { queueMicrotask(() => this.onmessage({ data: { type: 'error' } })); } };
  const session = new CameraSession({ devices: { async getUserMedia(options) { requested = options; return media; } }, makeWorker: () => worker });
  await assert.rejects(session.start('camera1', video));
  assert.equal(requested.audio, false); assert.equal(requested.video.deviceId.exact, 'camera1');
  assert.equal(media.track.stopped, true); assert.equal(worker.stopped, true); assert.equal(video.srcObject, null);
});

function uiFixture({ complete = false, tab = null, initiallyAvailable = true, permission, onPracticeStart = () => {} } = {}) {
  const nodes = new Map(), values = new Map(), workers = [], streams = [], timers = new Map();
  let nextTimer = 0, allowed = initiallyAvailable;
  function element(id) {
    if (!nodes.has(id)) nodes.set(id, { id, hidden: true, checked: false, value: '', textContent: '', open: false, isConnected: true, events: {},
      addEventListener(name, callback) { this.events[name] = callback; }, appendChild() {}, replaceChildren(...children) { this.children = children; this.value = children.find(c => c.selected)?.value || children[0]?.value || ''; },
      showModal() { this.open = true; }, close() { this.open = false; }, focus() {}, ...cameraVideo() });
    return nodes.get(id);
  }
  const document = { hidden: false, activeElement: element('toggle'), events: {},
    hasFocus: () => false,
    getElementById: element, createElement: () => ({}), addEventListener(name, callback) { this.events[name] = callback; } };
  const window = { CineWallHandGestures: core, isSecureContext: true, Worker: true, createImageBitmap: true, events: {},
    addEventListener(name, callback) { this.events[name] = callback; if (name === 'storage') tab?.listeners.add(callback); },
    removeEventListener(name, callback) { if (name === 'storage') tab?.listeners.delete(callback); } };
  const navigator = { mediaDevices: { async getUserMedia() { if (permission) await permission(); const media = stream(); streams.push(media); return media; },
    async enumerateDevices() { return [{ kind: 'videoinput', deviceId: 'camera1', label: 'Laptop camera' }]; } } };
  if (complete) values.set('cinewall-hand-practice-v1', 'complete');
  let storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  if (tab) {
    storage = tab.storage;
    if (complete) storage.setItem('cinewall-hand-practice-v1', 'complete');
    navigator.locks = tab.locks;
    window.CineWallSession = { room: 'room-a', deviceId: 'device-a' };
    window.CineWallHandTabs = { create: options => require('../public/hand-tabs').create({ ...options, now: tab.now, every: tab.every, cancelEvery: tab.cancelEvery }) };
  }
  class Worker {
    constructor() { workers.push(this); }
    postMessage(message) { if (message.type === 'init') queueMicrotask(() => this.onmessage({ data: { type: 'ready' } })); }
    terminate() { this.stopped = true; }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/hand-controls.js'), 'utf8'), {
    window, document, navigator, Worker, createImageBitmap() {}, performance: { now: () => 0 },
    localStorage: storage,
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; }, clearTimeout: id => timers.delete(id),
    setInterval: () => 0, clearInterval() {}
  });
  const actions = [];
  const ui = window.CineWallHandControls.create({ available: () => allowed, onPracticeStart, onAction: action => { actions.push(action); return true; } });
  function send(label, start) {
    for (let t = start; t <= start + 700; t += 100) workers.at(-1).onmessage({ data: { type: 'result', timestamp: t,
      result: { landmarks: label ? [[]] : [], gestures: label ? [[{ categoryName: label, score: .95 }]] : [] } } });
  }
  return { ui, element, document, values, workers, streams, actions, send,
    focus() { document.hasFocus = () => true; window.events.focus?.(); },
    async enable() { element('handControlToggle').checked = true; await element('handControlToggle').events.change(); },
    advance() { for (const [id, timer] of timers) if (timer.delay === 900) { timers.delete(id); timer.callback(); } },
    modeOff() { allowed = false; ui.sync(); }, makeAvailable() { allowed = true; ui.sync(); } };
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

test('practice pauses through the player hook before opening; X closes it, stops capture and never resumes playback', async () => {
  const calls = [];
  const f = uiFixture({ complete: true, onPracticeStart: () => { calls.push('pause'); assert.equal(f.element('handPractice').open, false); } });
  await f.enable(); assert.deepEqual(calls, []);
  f.element('handPracticeAgain').events.click();
  assert.deepEqual(calls, ['pause']); assert.equal(f.element('handPractice').open, true);
  f.element('handPracticeClose').events.click();
  assert.equal(f.element('handPractice').open, false); assert.equal(f.ui.enabled, false);
  assert.equal(f.streams[0].track.stopped, true); assert.equal(f.workers[0].stopped, true);
  assert.deepEqual(f.actions, []); assert.deepEqual(calls, ['pause']);
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
test('real UI camera sessions hand off to the player on tab switches and turn off together', async () => {
  const shared = require('./hand-tabs-fixture.cjs').sharedTabs();
  const admin = uiFixture({ complete: true, tab: shared.tab('admin') });
  await admin.enable(); await shared.flush();
  assert.equal(admin.streams.length, 1);
  const player = uiFixture({ complete: true, tab: shared.tab('player'), initiallyAvailable: false });
  await shared.flush(); assert.equal(player.streams.length, 0, 'player waits until admin releases camera');
  assert.equal(admin.ui.enabled, true, 'loading a player must not clear shared ON intent');
  player.makeAvailable();
  admin.document.hidden = true; admin.document.events.visibilitychange(); await shared.flush();
  assert.equal(admin.ui.enabled, true, 'tab switch preserves the ON setting');
  assert.equal(admin.streams[0].track.stopped, true); assert.equal(admin.workers[0].stopped, true);
  assert.equal(player.streams.length, 1); player.send('Open_Palm', 0); assert.deepEqual(player.actions, ['play']);
  admin.send('Victory', 1000); assert.deepEqual(admin.actions, [], 'old worker cannot control playback');
  player.document.hidden = true; player.document.events.visibilitychange();
  admin.document.hidden = false; admin.document.events.visibilitychange(); await shared.flush();
  assert.equal(player.streams[0].track.stopped, true); assert.equal(admin.streams.length, 2);
  admin.send('Closed_Fist', 2000); assert.deepEqual(admin.actions, ['pause']);
  player.ui.stop(); await shared.flush();
  assert.equal(admin.ui.enabled, false); assert.equal(admin.streams[1].track.stopped, true); assert.equal(player.ui.enabled, false);
  assert.equal(admin.streams.length, 2, 'OFF must not start an extra camera request');
  assert.equal(player.streams.length, 1, 'OFF must not restart the other tab camera');
});
test('Display 1 gestures use the player transport and never enable on guest screens or other modes', () => {
  let config;
  const source = fs.readFileSync(path.join(__dirname, '../public/screen.js'), 'utf8');
  const nodes = new Map(), commands = [], seeks = [];
  const context = { handControls: null, sessionMode: 'video', screenNumber: 1, ready: true, removedScreenNumber: 0,
    currentState: { asset: { version: 'v1' }, allReady: true },
    window: { CineWallSession: { membership: { admin: true }, deviceId: 'device-a' }, CineWallHandControls: { create(options) { config = options; } } },
    video: { currentTime: 30 }, videoFinished: () => false, targetPosition: () => 30, audioSetting: () => ({ volume: .95 }),
    command: payload => commands.push(payload), seekRelative: value => seeks.push(value), showControls() {},
    $: selector => { if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector); }
  };
  const start = source.indexOf('function playerHandAvailable()'), end = source.indexOf('\nsyncClock();', start);
  vm.runInNewContext(source.slice(start, end), context);
  config.onPracticeStart();
  assert.deepEqual(commands.map(item => item.type), ['pause'], 'practice pauses through the synchronized player command');
  for (const action of ['play', 'pause', 'forward', 'back', 'volume-up', 'volume-down']) assert.equal(config.onAction(action), true);
  assert.deepEqual(commands.map(item => item.type), ['pause', 'play', 'pause', 'screen-audio', 'screen-audio']); assert.deepEqual(seeks, [10, -10]);
  context.screenNumber = 2; assert.equal(config.available(), false); assert.notEqual(config.onAction('play'), true);
  config.onPracticeStart(); assert.equal(commands.length, 5, 'other displays cannot pause from practice');
  context.screenNumber = 1; context.window.CineWallSession.membership.admin = false; assert.equal(config.available(), false);
  context.window.CineWallSession.membership.admin = true; context.sessionMode = 'audio'; assert.equal(config.available(), false);
  const html = fs.readFileSync(path.join(__dirname, '../public/screen.html'), 'utf8');
  assert.match(html, /hand-tabs\.js/); assert.match(html, /hand-controls\.js/); assert.match(html, /id="handPractice"/);
});

test('visible admin/player focus changes hand off one camera; stale camera changes cannot start a second', async () => {
  const shared = require('./hand-tabs-fixture.cjs').sharedTabs();
  const admin = uiFixture({ complete: true, tab: shared.tab('admin') });
  const player = uiFixture({ complete: true, tab: shared.tab('player') });
  await admin.enable(); await shared.flush();
  assert.equal(admin.streams.length, 1); assert.equal(player.streams.length, 0);
  player.focus(); await shared.flush();
  assert.equal(admin.streams[0].track.stopped, true); assert.equal(player.streams.length, 1);
  admin.element('handCameraSelect').value = 'stale-camera';
  await admin.element('handCameraSelect').events.change(); await shared.flush();
  assert.equal(admin.streams.length, 1, 'background camera selector cannot bypass ownership');
  for (let i = 0; i < 8; i++) { admin.ui.sync(); player.ui.sync(); player.focus(); }
  await shared.flush(); assert.equal(player.streams.length, 1, 'polling and repeated focus must not restart capture');
  admin.focus(); await shared.flush();
  assert.equal(player.streams[0].track.stopped, true); assert.equal(admin.streams.length, 2);
  player.ui.stop(); await shared.flush(); assert.equal(admin.streams[1].track.stopped, true);
});

test('handoff waits for late camera permission to finish and stop before opening the next tab camera', async () => {
  for (const finish of ['player', 'admin', 'off']) {
    let grant, requests = 0;
    const shared = require('./hand-tabs-fixture.cjs').sharedTabs();
    const admin = uiFixture({ complete: true, tab: shared.tab('admin'), permission: () => ++requests === 1 ? new Promise(resolve => { grant = resolve; }) : Promise.resolve() });
    const player = uiFixture({ complete: true, tab: shared.tab('player') });
    await admin.enable(); await shared.flush(); assert.equal(requests, 1);
    player.focus(); await shared.flush();
    assert.equal(player.streams.length, 0, 'pending capture must retain the lock until it is stopped');
    if (finish === 'admin') admin.focus();
    if (finish === 'off') player.ui.stop();
    await shared.flush(); grant(); await shared.flush();
    assert.equal(admin.streams[0].track.stopped, true, 'the late old stream is stopped before the handoff');
    assert.equal(player.streams.length, finish === 'player' ? 1 : 0);
    assert.equal(admin.streams.length, finish === 'admin' ? 2 : 1);
    admin.ui.stop(); await shared.flush();
    assert.ok([...admin.streams, ...player.streams].every(media => media.track.stopped));
  }
});

test('a focused player claims capture when its video becomes ready after the focus event', async () => {
  const shared = require('./hand-tabs-fixture.cjs').sharedTabs();
  const admin = uiFixture({ complete: true, tab: shared.tab('admin') });
  const player = uiFixture({ complete: true, tab: shared.tab('player'), initiallyAvailable: false });
  await admin.enable(); await shared.flush();
  player.focus(); await shared.flush(); assert.equal(player.streams.length, 0);
  player.makeAvailable(); await shared.flush();
  assert.equal(player.streams.length, 1); assert.equal(admin.streams[0].track.stopped, true);
  player.ui.stop(); await shared.flush();
});
