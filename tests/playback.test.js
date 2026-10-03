'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { downloadChoices, downloadError, common } = require('../youtube-downloads');

function player(screen, mode = 'video', peer = null, fullscreen = async () => {}) {
  const nodes = new Map();
  const node = (selector) => {
    if (nodes.has(selector)) return nodes.get(selector);
    const classes = new Set();
    const item = { hidden: false, value: 0, innerHTML: '', textContent: '', duration: 300, videoWidth: 1280, videoHeight: 720, currentTime: 0, paused: true, readyState: 4, muted: false, ended: false,
      style: { setProperty() {} }, dataset: {}, handlers: {},
      classList: { add: (...names) => names.forEach((name) => classes.add(name)), remove: (...names) => names.forEach((name) => classes.delete(name)), contains: (name) => classes.has(name), toggle(name, flag) { if (flag) classes.add(name); else classes.delete(name); } },
      addEventListener(name, callback) { this.handlers[name] = callback; },
      querySelector: (name) => node(`${selector} ${name}`), querySelectorAll: () => [],
      getAttribute(name) { return this[name]; }, removeAttribute(name) { delete this[name]; },
      load() { delete this.error; }, pause() { this.paused = true; }, async play() { if (!this.muted) throw Object.assign(new Error('User gesture required'), { name: 'NotAllowedError' }); this.paused = false; },
    };
    nodes.set(selector, item);
    return item;
  };
  const state = { serverId: 'server-1', sessionMode: mode, allReady: true, screenCount: 3, playing: true, position: 12, anchorTime: Date.now(), serverTime: Date.now(), notBefore: 0, commandId: 7, mode: 'stretch',
    audioSettings: { 1: { volume: 1, muted: false }, 2: { volume: 1, muted: false }, 3: { volume: 1, muted: false } },
    asset: mode === 'youtube' ? { videoId: 'YE7VzlLtp-4', version: 'yt-test' } : { name: peer ? 'test.mkv' : 'test.mp4', version: 'movie-test', source: peer ? 'peer' : undefined } };
  const statuses = [], documentHandlers = {}, timers = [];
  const storage = () => ({ getItem: () => null, setItem() {}, removeItem() {} });
  const context = vm.createContext({ console, URLSearchParams, Math, Number, String, Boolean, Date, JSON, Promise, performance,
    location: { search: `?screen=${screen}`, origin: 'http://192.168.137.1:4173', href: `http://192.168.137.1:4173/screen.html?screen=${screen}` },
    innerWidth: 1280, innerHeight: 720, localStorage: storage(), sessionStorage: storage(),
    document: { querySelector: node, addEventListener(name, handler) { documentHandlers[name] = handler; }, body: { dataset: {} }, documentElement: { requestFullscreen: fullscreen } },
    window: { addEventListener() {}, CineWallFilePeer: peer ? { FilePeer: class { constructor() { return peer; } } } : undefined },
    EventSource: class { addEventListener() {} },
    setTimeout: (handler, delay) => { timers.push({ handler, delay }); return timers.length; }, clearTimeout() {}, setInterval() {},
    fetch: async (url, init) => {
      if (url.startsWith('/api/time')) return { ok: true, json: async () => ({ serverTime: Date.now() }) };
      if (init?.body) statuses.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ state, screens: [] }) };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/screen.js'), 'utf8'), context);
  return { context, state, nodes, statuses, documentHandlers, timers, evaluate: (code) => vm.runInContext(code, context) };
}

test('every mode attempts fullscreen once on join, allows one-tap retry, and respects exiting fullscreen', async () => {
  for (const mode of ['video', 'audio', 'presentation', 'youtube']) {
    let calls = 0;
    const client = player(2, mode, null, async (options) => { calls++; assert.equal(options.navigationUI, 'hide'); throw new Error('User gesture required'); });
    await new Promise(setImmediate);
    assert.equal(calls, 1);
    const prompt = client.nodes.get('#enterPlayerFullscreen');
    assert.equal(prompt.hidden, false, `${mode}: blocked automatic entry exposes one-tap fallback`);
    client.evaluate('updateLabels(); updateLabels()'); assert.equal(calls, 1, 'no repeated fullscreen requests during sync');
    client.context.document.documentElement.requestFullscreen = async () => { calls++; client.context.document.fullscreenElement = client.context.document.documentElement; };
    await prompt.handlers.click(); assert.equal(calls, 2); assert.equal(prompt.hidden, true);
    client.context.document.fullscreenElement = null;
    client.documentHandlers.fullscreenchange(); client.evaluate('updateLabels()');
    assert.equal(prompt.hidden, false); assert.equal(calls, 2, 'Escape is respected; fullscreen does not immediately reopen');
  }
});

test('join requests fullscreen before awaiting media playback', async () => {
  const actions = [], client = player(1); await new Promise(setImmediate);
  client.context.document.documentElement.requestFullscreen = async () => { actions.push('fullscreen'); };
  client.nodes.get('#video').play = async () => { actions.push('play'); };
  await client.nodes.get('#readyButton').handlers.click();
  assert.equal(actions[0], 'fullscreen'); assert.ok(actions.includes('play'));
});

test('Display 1 updates Play instantly but does not start audio before the shared server start', async () => {
  const client = player(1, 'audio'); await new Promise(setImmediate);
  const video = client.nodes.get('#video');
  client.evaluate('currentState.playing = false'); video.paused = true;
  let starts = 0, reply;
  video.play = async () => { starts++; video.paused = false; };
  client.context.fetch = async (route) => route === '/api/command' ? new Promise((resolve) => { reply = resolve; }) : { ok: true, json: async () => ({ state: client.state }) };
  const pending = client.evaluate("command({type:'play', position:12})"); await new Promise(setImmediate);
  assert.equal(client.evaluate('currentState.playing'), true);
  client.evaluate('correctDrift(currentState, false)'); assert.equal(starts, 0);
  const command = { ...client.state, playing: true, type: 'play', commandId: 8, notBefore: Date.now() + 350, executeAt: Date.now() + 350, anchorTime: Date.now() + 350 };
  reply({ ok: true, json: async () => ({ command }) }); await pending;
  assert.equal(starts, 0); assert.ok(client.timers.at(-1).delay > 200);
  client.context.sharedStart = { ...command, executeAt: Date.now() - 1, notBefore: 0, anchorTime: Date.now(), serverTime: Date.now() };
  await client.evaluate('execute(sharedStart)'); assert.equal(starts, 1);
});

test('native speaker drift uses small speed corrections without repeatedly seeking', async () => {
  const client = player(2, 'audio'); await new Promise(setImmediate);
  const video = client.nodes.get('#video'); video.paused = false;
  client.evaluate('currentState.playing = true; currentState.position = 20; currentState.anchorTime = serverNow()');
  video.currentTime = 19.95;
  client.evaluate('correctDrift(currentState, false)');
  assert.equal(video.currentTime, 19.95); assert.ok(video.playbackRate > 1 && video.playbackRate <= 1.015);
  video.currentTime = client.evaluate('targetPosition(currentState)') + .05;
  client.evaluate('correctDrift(currentState, false)'); assert.ok(video.playbackRate < 1 && video.playbackRate >= .985);
});

test('a relay interruption after successful playback reconnects without blaming codecs, and successful recovery resets retries', async () => {
  const opened = [];
  const client = player(2, 'video', { clear() {}, open(asset, options) { opened.push(options); return Promise.resolve(`/api/media/stream?v=${asset.version}&retry=${options?.retry || 0}`); } });
  await new Promise(setImmediate);
  client.evaluate("currentState.asset.transport = 'relay'");
  const video = client.nodes.get('#video'); video.handlers.playing();
  for (const code of [2, 3, 4]) {
    video.error = { code }; await video.handlers.error();
    assert.match(client.evaluate('lastError'), /Connection interrupted/);
    assert.doesNotMatch(client.evaluate('lastError'), /H.264|unsupported|cannot play/);
    const timer = client.timers.at(-1); assert.equal(timer.delay, 1000);
    timer.handler(); await new Promise(setImmediate);
    assert.ok(opened.at(-1).retry > 0);
    video.handlers.loadedmetadata(); video.handlers.playing();
    assert.equal(client.evaluate('transferRecoveryAttempts'), 0);
    assert.equal(client.evaluate('lastError'), '');
    assert.ok(video.currentTime >= 12, 'rejoins the shared timeline instead of restarting');
  }
});

test('Space and arrow keys match the player controls, work after focusing controls, and ignore typing or held Space', async () => {
  const client = player(1); await new Promise(setImmediate);
  const key = (code, id = 'screenPlay', repeat = false, typing = false) => {
    let prevented = false;
    client.documentHandlers.keydown({ code, key: code === 'Space' ? ' ' : code, repeat, target: { matches: () => typing, closest: () => id ? { id } : null }, preventDefault() { prevented = true; } });
    return prevented;
  };
  assert.equal(key('Space'), true); await new Promise(setImmediate);
  assert.ok(client.statuses.some((payload) => payload.type === 'pause'));
  const before = client.statuses.length;
  key('Space', 'screenPlay', true); assert.equal(client.statuses.length, before);
  const position = client.evaluate('targetPosition(currentState)');
  key('ArrowRight', 'screenForward'); await new Promise(setImmediate);
  const forward = client.statuses.filter((payload) => payload.type === 'seek').at(-1); assert.ok(Math.abs(forward.position - position - 10) < .1);
  const afterForward = client.evaluate('targetPosition(currentState)');
  key('ArrowLeft', 'screenBack'); await new Promise(setImmediate);
  const back = client.statuses.filter((payload) => payload.type === 'seek').at(-1); assert.ok(Math.abs(back.position - afterForward + 10) < .1);
  assert.equal(key('Space', '', false, true), false);
  assert.equal(key('Space', 'readyButton'), false);
});

test('all three numbered links automatically join and play despite blocked sound', async () => {
  for (const screen of [1, 2, 3]) {
    const client = player(screen);
    await new Promise(setImmediate);
    assert.equal(client.evaluate('ready'), true);
    assert.equal(client.evaluate('screenNumber'), screen);
    assert.equal(client.nodes.get('#setup').classList.contains('hidden'), true);
    assert.equal(client.nodes.get('#video').paused, false);
    assert.equal(client.nodes.get('#video').muted, true);
    assert.equal(client.evaluate('localAutoplayMuted'), true);
    assert.equal(client.nodes.get('#playBlocked').classList.contains('show'), true);
    assert.ok(client.nodes.get('#video').currentTime >= 12);
    assert.equal(client.evaluate('mediaIsReady()'), true);
    await client.evaluate('postStatus()');
    assert.ok(client.statuses.some((status) => status.ready && !status.paused));
  }
});

test('a third display is restored when the admin adds the third link', async () => {
  const client = player(3);
  await new Promise(setImmediate);
  client.evaluate('setLayout(2)');
  assert.equal(client.evaluate('screenNumber'), 0);
  client.evaluate('setLayout(3)');
  assert.equal(client.evaluate('screenNumber'), 3);
  assert.equal(client.evaluate('ready'), true);
});

test('screen 1 performs synchronized movie looping, independent of the ten-second dashboard preview', async () => {
  const client = player(1);
  await new Promise(setImmediate);
  client.evaluate('currentState.loop = true');
  client.nodes.get('#video').handlers.ended();
  await new Promise(setImmediate);
  assert.ok(client.statuses.some((payload) => payload.type === 'play' && payload.position === 0));
});

test('old commands cannot undo newer playback; a new server can recover', async () => {
  const client = player(2);
  await new Promise(setImmediate);
  client.evaluate("applyStateAppearance({ ...currentState, playing: false, commandId: 6 })");
  assert.equal(client.evaluate('currentState.playing'), true);
  client.evaluate("applyStateAppearance({ ...currentState, playing: false, commandId: 0, serverId: 'server-2' })");
  assert.equal(client.evaluate('currentState.playing'), false);
  assert.equal(client.evaluate('currentState.serverId'), 'server-2');
});

test('admin MKV retries ranges then native sniffing, stops after two retries and does not request another identical file', async () => {
  const opens = [], client = player(1, 'video', { async open(asset, options) { opens.push({ asset, options }); return `blob:attempt-${opens.length}`; } });
  await new Promise(setImmediate);
  const video = client.nodes.get('#video');
  for (const code of [4, 3, 4]) { video.error = { code }; await video.handlers.error(); }
  assert.equal(opens.length, 3, 'one normal load and exactly two recovery loads');
  assert.equal(opens[1].options.ranged, true);
  assert.equal(opens[1].options.retry, 1);
  assert.equal(opens[2].options.type, '');
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../public/screen.html'), 'utf8'), /localPeerFile|Select the same local/);
  assert.match(client.evaluate('lastError'), /MP4 with H\.264 video and AAC audio/);
  assert.equal(client.evaluate('mediaIsReady()'), false);
  await client.evaluate('postStatus()');
  assert.equal(client.statuses.at(-1).mediaReady, false);
});

test('audio progressing without decoded video frames reports a picture failure, then clears when video decodes', async () => {
  const client = player(2);
  await new Promise(setImmediate);
  const video = client.nodes.get('#video');
  video.getVideoPlaybackQuality = () => ({ totalVideoFrames: 0 });
  video.paused = false;
  video.currentTime = 12;
  client.evaluate("currentState.asset.codecs = ['V_MPEGH/ISO/HEVC']");
  assert.equal(client.evaluate('checkVideoFrames(1000)'), false);
  video.currentTime = 15;
  assert.equal(client.evaluate('checkVideoFrames(6000)'), true);
  assert.match(client.evaluate('lastError'), /decoded no HEVC video frames/);
  assert.equal(client.evaluate('mediaIsReady()'), false);
  assert.equal(client.statuses.at(-1).mediaReady, false);
  assert.match(client.statuses.at(-1).error, /file stays on the admin Device/);
  assert.equal(client.nodes.get('#decoderHelpLink').hidden, false);
  video.getVideoPlaybackQuality = () => ({ totalVideoFrames: 1 });
  assert.equal(client.evaluate('checkVideoFrames(6500)'), false);
  assert.equal(client.evaluate('lastError'), '');
  assert.equal(client.nodes.get('#decoderHelpLink').hidden, true);
  assert.equal(client.evaluate('mediaIsReady()'), true);
});

test('recovery cannot replace a new movie after its asynchronous local-source lookup', async () => {
  let resolveRecovery;
  const client = player(1, 'video', { clear() {}, open(asset, options) { return options ? new Promise((resolve) => { resolveRecovery = resolve; }) : Promise.resolve('blob:original'); } });
  await new Promise(setImmediate);
  const video = client.nodes.get('#video');
  video.error = { code: 4 };
  const pending = video.handlers.error();
  client.evaluate("applyStateAppearance({ ...currentState, asset: null, playing: false, commandId: 8 })");
  resolveRecovery('blob:stale-retry'); await pending;
  assert.equal(video.getAttribute('src'), undefined);
  assert.equal(client.evaluate('mediaRecoveryInFlight'), '');
});

test('YouTube readiness and status reflect the actual player error, not a synthetic clock', async () => {
  const client = player(2, 'youtube');
  await new Promise(setImmediate);
  client.evaluate('youtubeReady = true; youtubePlayer = { lastError: 150, getDuration: () => 0, getCurrentTime: () => 0, getState: () => -1, getVideoData: () => ({}), setMuted() {}, setVolume() {}, play() {}, seek() {} }');
  assert.equal(client.evaluate('mediaIsReady()'), false);
  client.evaluate('postStatus()');
  await new Promise(setImmediate);
  const status = client.statuses.at(-1);
  assert.equal(status.paused, true);
  assert.equal(status.mediaReady, false);
  assert.equal(status.playerState, -1);
});

test('quality choices include audio, separate streams, and high resolution without duplicates', () => {
  const formats = [
    { format_id: '137', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 1080, fps: 30, url: 'video', filesize: 100 },
    { format_id: '160', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 144, fps: 15, url: 'video' },
    { format_id: '597', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 144, fps: 12, url: 'video' },
    { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a', abr: 128, url: 'audio', filesize: 50 },
    { format_id: '313', ext: 'webm', vcodec: 'vp9', acodec: 'none', height: 2160, fps: 60, url: 'video' },
    { format_id: '251', ext: 'webm', vcodec: 'none', acodec: 'opus', abr: 160, url: 'audio' },
    { format_id: '999', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 4320, has_drm: true, url: 'restricted' },
  ];
  const choices = downloadChoices({ duration: 10, formats });
  assert.equal(choices.find((option) => option.height === 1080).selector, '137+140');
  assert.equal(choices.filter((option) => option.container === 'mp4' && option.height === 144).length, 1);
  assert.equal(choices.find((option) => option.height === 2160).label, '2160p · 60 fps');
  assert.equal(choices.filter((option) => option.container === 'mp3').length, 5);
  assert.equal(choices.find((option) => option.container === 'mp3').selector, '140');
  assert.deepEqual(choices.find((option) => option.container === 'mp3').fallbackSelectors, ['251']);
  assert.ok(!choices.some((option) => option.height === 4320));
});

test('yt-dlp uses a writable project cache and allows the system to select a network family', () => {
  const args = common();
  const cache = args[args.indexOf('--cache-dir') + 1];
  assert.equal(cache, path.join(__dirname, '..', '.cinema-cache', 'yt-dlp-cache'));
  assert.ok(fs.existsSync(cache));
  assert.ok(!args.includes('--force-ipv4'));
});

test('403 messages are readable even when preceded by a cache traceback', () => {
  const error = downloadError("WARNING: Writing cache failed: PermissionError: Access is denied\nERROR: unable to download video data: HTTP Error 403: Forbidden");
  assert.match(error, /403/);
  assert.ok(!error.includes('Traceback'));
  assert.ok(!error.includes('PermissionError'));
});

test('MP3 can fall back to a combined video/audio stream', () => {
  const choices = downloadChoices({ duration: 30, formats: [
    { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a', url: 'audio' },
    { format_id: '18', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a', height: 360, url: 'combined' },
  ] });
  const mp3 = choices.find((choice) => choice.container === 'mp3');
  assert.equal(mp3.selector, '140');
  assert.deepEqual(mp3.fallbackSelectors, ['18']);
});

test('rate limits and sign-in checks remain separate from cache permissions', () => {
  assert.match(downloadError('ERROR: HTTP Error 429: Too Many Requests'), /temporarily limiting/);
  assert.match(downloadError("ERROR: Sign in to confirm you're not a bot"), /sign-in check/);
  assert.match(downloadError('PermissionError: Access is denied'), /folder is writable/);
});

test('removing video or audio unloads every joined numbered screen', async () => {
  for (const mode of ['video', 'audio']) for (const screen of [1, 2, 3]) {
    const client = player(screen, mode);
    await new Promise(setImmediate);
    client.evaluate('applyStateAppearance({ ...currentState, asset: null, playing: false, position: 0, commandId: 8 })');
    assert.equal(client.nodes.get('#video').paused, true);
    assert.equal(client.nodes.get('#video').getAttribute('src'), undefined);
    assert.equal(client.evaluate('currentAssetVersion'), '');
    assert.equal(client.evaluate('mediaIsReady()'), false);
    assert.equal(client.evaluate('ready'), true);
    assert.equal(client.nodes.get('#playBlocked').classList.contains('show'), false);
    assert.equal(client.nodes.get('#waitingAsset').classList.contains('show'), true);
  }
});

test('removing YouTube destroys its player and clears stale errors', async () => {
  const client = player(2, 'youtube');
  await new Promise(setImmediate);
  client.evaluate("let wasDestroyed = false; youtubePlayer = { destroy() { wasDestroyed = true; }, setVolume() {}, setMuted() {} }; youtubeReady = true; lastError = 'Old error'; applyStateAppearance({ ...currentState, asset: null, playing: false, commandId: 8 })");
  assert.equal(client.evaluate('wasDestroyed'), true);
  assert.equal(client.evaluate('youtubePlayer'), null);
  assert.equal(client.evaluate('youtubeReady'), false);
  assert.equal(client.evaluate('lastError'), '');
});

test('clear-asset resets and broadcasts playback without removing joined Devices or saved downloads', () => {
  const code = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const slice = code.slice(code.indexOf('function removeCurrentAsset()'), code.indexOf('function networkDetails()'));
  const deleted = [];
  const events = [];
  let persisted = false;
  const context = vm.createContext({ Date, String, Number, Object, Error,
    fs: { unlink(file) { deleted.push(file); } }, SERVER_ID: 'test-server',
    assetFile: { path: 'session-wall-copy.mp4' }, uploadInProgress: false, commandSequence: 0, relayRequests: new Map(), sourceOwner: null,
    state: { sessionMode: 'video', asset: { version: 'loaded-1' }, playing: true, position: 50, page: 2, screenCount: 3, audioSettings: { 1: { muted: false } } },
    screens: new Map([[1, { ready: true, mediaReady: true, paused: false, playbackTime: 50, fileName: 'movie.mp4' }]]),
    currentPosition: () => 50, broadcast: (event, payload) => events.push({ event, payload }),
    snapshot: () => context.state, saveSession() { persisted = true; },
  });
  vm.runInContext(slice, context);
  assert.throws(() => vm.runInContext("applyCommand({type:'clear-asset',assetVersion:'stale'})", context), /loaded file changed/);
  assert.equal(deleted.length, 0);
  context.uploadInProgress = true;
  assert.throws(() => vm.runInContext("applyCommand({type:'clear-asset',assetVersion:'loaded-1'})", context), /finish preparing/);
  context.uploadInProgress = false;
  vm.runInContext("applyCommand({type:'clear-asset',assetVersion:'loaded-1'})", context);
  assert.equal(context.state.asset, null);
  assert.equal(context.state.playing, false);
  assert.equal(context.state.position, 0);
  assert.equal(context.state.page, 1);
  assert.equal(context.state.screenCount, 3);
  assert.equal(context.screens.get(1).ready, true);
  assert.equal(context.screens.get(1).mediaReady, false);
  assert.equal(context.screens.get(1).fileName, '');
  assert.deepEqual(deleted, ['session-wall-copy.mp4']);
  assert.deepEqual(events.map((event) => event.event), ['command', 'state']);
  assert.equal(persisted, true);
});

test('YouTube source tab opens downloads without navigating to stream mode', async () => {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { hidden: true, value: '', handlers: {}, attributes: {},
        classList: { toggle(name, flag) { if (flag) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name) },
        addEventListener(name, fn) { this.handlers[name] = fn; },
        setAttribute(name, value) { this.attributes[name] = value; }, focus() {}, replaceChildren() {},
      });
    }
    return nodes.get(id);
  };
  const context = vm.createContext({ document: { getElementById: get }, window: {}, console,
    sessionStorage: { getItem: () => null }, fetch: async () => ({ ok: true, json: async () => ({ videos: [] }) }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/youtube-download.js'), 'utf8'), context);
  await new Promise(setImmediate);
  get('downloadYoutubeToggle').handlers.click();
  assert.equal(get('youtubeDownloadPanel').hidden, false);
  assert.equal(get('fileSourceButton').hidden, true);
  assert.equal(get('downloadYoutubeToggle').classList.contains('active'), true);
  assert.equal(get('downloadYoutubeToggle').attributes['aria-expanded'], 'true');
  get('localVideoSource').handlers.click();
  assert.equal(get('youtubeDownloadPanel').hidden, true);
  assert.equal(get('fileSourceButton').hidden, false);
  assert.equal(get('localVideoSource').classList.contains('active'), true);
  const html = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
  assert.equal((html.match(/id="downloadYoutubeToggle"/g) || []).length, 1);
  assert.match(html, /aria-controls="youtubeDownloadPanel">YouTube<\/button>/);
});

function uploadDashboard() {
  const code = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
  const helpers = code.slice(code.indexOf('function isPreparing()'), code.indexOf('function escapeHtml('));
  const upload = code.slice(code.indexOf('async function uploadFile('), code.indexOf('// Drag and Drop functionality'));
  const preview = code.slice(code.indexOf('function setPreviewKind()'), code.indexOf('function renderPlayer()'));
  const nodes = new Map();
  const revoked = [];
  const actions = [];
  const requests = [];
  const node = (selector) => {
    if (!nodes.has(selector)) {
      const classes = new Set();
      nodes.set(selector, { hidden: false, value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
        classList: { add: (value) => classes.add(value), remove: (value) => classes.delete(value), contains: (value) => classes.has(value), toggle(value, flag) { if (flag) classes.add(value); else classes.delete(value); } },
        pause() { this.paused = true; }, load() { actions.push('preview-load'); }, removeAttribute(name) { delete this[name]; },
      });
    }
    return nodes.get(selector);
  };
  const context = vm.createContext({ console: { log() {} }, Number, String, Boolean, Math, JSON, encodeURIComponent,
    $: node, window: { CineWallVideoFile: { validate: async () => {} } }, location: { protocol: 'http:' }, media: node('#mediaPreview'), timeline: node('#timeline'), warning: node('#fileWarning'), filePeer: null,
    VIDEO_FORMAT_HELP: 'This format is not supported. Use MP4 with H.264 video and AAC audio.',
    URL: { createObjectURL: () => 'blob:selected-file', revokeObjectURL: (url) => revoked.push(url) },
    setTimeout: () => 1, clearTimeout() {},
    render() { vm.runInContext('setPreviewKind()', context); },
    updateServerTime() {}, formatBytes: (size) => `${size} bytes`, sourceLocked: () => false, sharingMode: 'server',
    XMLHttpRequest: class {
      constructor() {
        this.handlers = {};
        this.upload = { handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } };
        requests.push(this);
      }
      open() {} setRequestHeader() {} addEventListener(name, fn) { this.handlers[name] = fn; }
      send(file) { actions.push('upload-send'); this.file = file; }
    },
  });
  vm.runInContext("let localPreview = null, uploadHideTimer = null, loadedMediaVersion = '', duration = 0, uploadBusy = false, removeBusy = false, scrubbing = false, presentationKey = '', cancelBusy = false, previewRecoveryAttempts = 0, previewRecoveryVersion = '', previewRecoveryInFlight = ''; let status = {state:{sessionMode:'video',asset:null}}; const modeConfig = {video:{icon:'video',label:'Video'}};", context);
  vm.runInContext(helpers + preview + upload, context);
  return { context, requests, revoked, actions, nodes, evaluate: (input) => vm.runInContext(input, context) };
}

test('a local preview that failed before direct publishing completes is released for native recovery', async () => {
  const dashboard = uploadDashboard();
  dashboard.context.filePeer = {
    async publish(file) {
      dashboard.evaluate('localPreview.failed = true');
      this.asset = { name: file.name, version: 'direct-ready', source: 'peer' };
      return { sessionMode: 'video', asset: this.asset };
    },
    async open() { return 'blob:direct-ready'; },
  };
  const code = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
  vm.runInContext(code.slice(code.indexOf('async function shareLocalFile('), code.indexOf('// Shared upload function')), dashboard.context);
  await dashboard.evaluate("shareLocalFile({name:'movie.mkv',size:1000,type:'video/mkv'})");
  assert.equal(dashboard.evaluate('localPreview'), null);
  assert.equal(dashboard.evaluate('loadedMediaVersion'), 'direct-ready');
  assert.equal(dashboard.nodes.get('#mediaPreview').src, 'blob:direct-ready');
  assert.equal(dashboard.requests.length, 0);
});

test('dashboard MKV retries preserve the direct asset and are bounded just like Display 1', async () => {
  const code = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8'), nodes = new Map(), opens = [], handlers = {};
  const node = (selector) => { if (!nodes.has(selector)) nodes.set(selector, { classList: { add() {} } }); return nodes.get(selector); };
  const media = { error: { code: 4 }, addEventListener(name, handler) { handlers[name] = handler; }, load() { this.error = null; } };
  const context = vm.createContext({ media, window: {}, $: node, warning: node('#warning'), status: { state: { asset: { source: 'peer', version: 'original-mkv' } } },
    filePeer: { async open(asset, options) { opens.push(options); return `blob:preview-${opens.length}`; } },
    localPreview: null, loadedMediaVersion: 'original-mkv', previewRecoveryVersion: '', previewRecoveryAttempts: 0, previewRecoveryInFlight: '',
    VIDEO_FORMAT_HELP: 'This format is not supported. Use MP4 with H.264 video and AAC audio.',
  });
  vm.runInContext(code.slice(code.indexOf("media.addEventListener('error'"), code.indexOf("window.addEventListener('pagehide'")), context);
  for (let attempt = 0; attempt < 3; attempt++) { media.error = { code: 4 }; await handlers.error(); }
  assert.equal(opens.length, 2);
  assert.equal(opens[0].ranged, true);
  assert.equal(opens[1].type, '');
  assert.equal(context.status.state.asset.version, 'original-mkv');
  assert.match(node('#warning').textContent, /MP4 with H\.264 video and AAC audio/);
});

test('a validated video loads a silent local preview before its LAN transfer, surviving state refreshes', async () => {
  const dashboard = uploadDashboard();
  await dashboard.evaluate("uploadFile({name:'movie.mp4',size:1000,type:'video/mp4'})");
  assert.deepEqual(dashboard.actions, ['preview-load', 'upload-send']);
  assert.equal(dashboard.nodes.get('#mediaPreview').src, 'blob:selected-file');
  assert.equal(dashboard.nodes.get('#mediaPreview').muted, true);
  assert.equal(dashboard.nodes.get('#mediaPreview').paused, true);
  assert.equal(dashboard.nodes.get('#previewEmpty').hidden, true);
  dashboard.evaluate('setPreviewKind(); setPreviewKind()');
  assert.equal(dashboard.nodes.get('#mediaPreview').src, 'blob:selected-file');
  assert.equal(dashboard.revoked.length, 0);
});

test('rejected files never upload or replace the existing movie, and the chooser works again afterward', async () => {
  const dashboard = uploadDashboard();
  dashboard.evaluate("status.state.asset = {version:'existing',name:'existing.mp4'}");
  dashboard.context.window.CineWallVideoFile.validate = async () => { throw new Error('This format is not supported. Convert it to .mp4 first.'); };
  await dashboard.evaluate("uploadFile({name:'movie.mkv',size:12000000000,type:'video/x-matroska'})");
  assert.equal(dashboard.requests.length, 0);
  assert.equal(dashboard.evaluate('status.state.asset.version'), 'existing');
  assert.equal(dashboard.evaluate('localPreview'), null);
  assert.equal(dashboard.evaluate('uploadBusy'), false);
  assert.equal(dashboard.nodes.get('#adminAssetFile').disabled, false);
  assert.match(dashboard.nodes.get('#fileWarning').textContent, /Convert it to \.mp4 first/);
  dashboard.context.window.CineWallVideoFile.validate = async () => {};
  await dashboard.evaluate("uploadFile({name:'movie.mp4',size:1000,type:'video/mp4'})");
  assert.equal(dashboard.requests.length, 1);
});

test('upload 100 percent becomes checking, and response state becomes ready without an extra fetch', async () => {
  const dashboard = uploadDashboard();
  await dashboard.evaluate("uploadFile({name:'movie.mp4',size:1000,type:'video/mp4'})");
  const request = dashboard.requests[0];
  request.upload.handlers.progress({ lengthComputable: true, loaded: 1000, total: 1000 });
  request.upload.handlers.load();
  assert.equal(dashboard.nodes.get('#uploadProgressText').textContent, 'Preparing…');
  assert.equal(dashboard.nodes.get('#uploadProgressWrap').classList.contains('preparing'), true);
  request.status = 200;
  request.responseText = JSON.stringify({ state: { sessionMode: 'video', asset: { version: 'ready-1', name: 'movie.mp4' } } });
  request.handlers.load();
  assert.equal(dashboard.evaluate('uploadBusy'), false);
  assert.equal(dashboard.evaluate('status.state.asset.version'), 'ready-1');
  assert.equal(dashboard.evaluate('localPreview.pending'), false);
  assert.equal(dashboard.nodes.get('#uploadProgressText').textContent, 'Ready');
  assert.equal(dashboard.nodes.get('#uploadProgressWrap').classList.contains('preparing'), false);
  dashboard.evaluate('status.state.asset = null; setPreviewKind()');
  assert.deepEqual(dashboard.revoked, ['blob:selected-file']);
});

test('upload failures clear the stalled progress and release local preview resources', async () => {
  for (const event of ['error', 'abort', 'load']) {
    const dashboard = uploadDashboard();
    await dashboard.evaluate("uploadFile({name:'movie.mp4',size:1000,type:'video/mp4'})");
    const request = dashboard.requests[0];
    request.status = 500;
    request.responseText = JSON.stringify({ error: 'File transfer failed' });
    request.handlers[event]();
    assert.equal(dashboard.evaluate('uploadBusy'), false);
    assert.equal(dashboard.evaluate('localPreview'), null);
    assert.equal(dashboard.nodes.get('#uploadProgressWrap').hidden, true);
    assert.equal(dashboard.nodes.get('#fileWarning').classList.contains('show'), true);
    assert.deepEqual(dashboard.revoked, ['blob:selected-file']);
  }
});

test('refresh recovers transfer progress and blocks duplicate uploads', async () => {
  const dashboard = uploadDashboard();
  await dashboard.evaluate("status.state.preparation = {phase:'uploading',kind:'video',name:'movie.mp4',size:1000,progress:42}; renderPreparation(); uploadFile({name:'movie.mp4',size:1000,type:'video/mp4'})");
  assert.equal(dashboard.requests.length, 0);
  assert.equal(dashboard.nodes.get('#uploadProgressText').textContent, '42%');
  assert.equal(dashboard.nodes.get('#cancelPreparation').hidden, false);
  assert.equal(dashboard.nodes.get('#adminAssetFile').disabled, true);
});

test('409 preserves the same-file local preview and recovers the already running transfer', async () => {
  const dashboard = uploadDashboard();
  await dashboard.evaluate("uploadFile({name:'movie.mp4',size:1000,type:'video/mp4'})");
  const request = dashboard.requests[0];
  request.status = 409;
  request.responseText = JSON.stringify({ preparation: { phase: 'uploading', kind: 'video', name: 'movie.mp4', size: 1000, progress: 50 } });
  request.handlers.load();
  assert.equal(dashboard.evaluate('uploadBusy'), false);
  assert.equal(dashboard.evaluate('localPreview.pending'), true);
  assert.equal(dashboard.nodes.get('#uploadProgressText').textContent, '50%');
  assert.equal(dashboard.revoked.length, 0);
  dashboard.evaluate("status.state.preparation.phase = 'ready'; status.state.asset = {version:'prepared-1',name:'movie.mp4',originalSize:1000}; setPreviewKind(); renderPreparation()");
  assert.equal(dashboard.evaluate('localPreview.pending'), false);
  assert.equal(dashboard.nodes.get('#adminAssetFile').disabled, false);
  assert.equal(dashboard.nodes.get('#cancelPreparation').hidden, true);
});

test('a periodic update restores the ready player if its completion event was missed', () => {
  const code = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
  const pulse = code.slice(code.indexOf("events.addEventListener('pulse'"), code.indexOf('function tickTimeline()'));
  let handler;
  let renders = 0;
  let progressUpdates = 0;
  const context = vm.createContext({ JSON,
    status: { state: { commandId: 1, asset: null, preparation: { phase: 'converting' }, serverId: 'same-server' } },
    events: { addEventListener(name, callback) { handler = callback; } },
    render: () => { renders++; }, renderPreparation: () => { progressUpdates++; }, syncPreview() {}, updateServerTime() {}, acceptState(next) { context.status.state = next; },
  });
  vm.runInContext(pulse, context);
  handler({ data: JSON.stringify({ commandId: 2, asset: { version: 'ready-1' }, preparation: { phase: 'ready' }, serverId: 'same-server' }) });
  assert.equal(renders, 1);
  handler({ data: JSON.stringify(context.status.state) });
  assert.equal(renders, 1);
  assert.equal(progressUpdates, 1);
});
