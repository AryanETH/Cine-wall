'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (name) => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');

test('Play waits for readiness and never opens or navigates a copied audio link; opening Display 1 twice only focuses it', () => {
  const source = read('admin.js'), opens = [], commands = [];
  let focused = 0;
  const context = vm.createContext({ window: { CineWallSession: { deviceId: 'source', room: 'room', link: (route) => `http://hotspot${route}&room=room` }, open(url, name) { opens.push({ url, name }); return { closed: false, focus() { focused++; } }; } },
    status: { state: { ownerId: 'source', allReady: false } }, uploadBusy: false, isPreparing: () => false, positionNow: () => 4,
    command: (value) => commands.push(value), $: () => ({ addEventListener() {} }), localStorage: { setItem() {} },
  });
  vm.runInContext('let adminDisplayWindow = null, sharingMode = "instant";', context);
  vm.runInContext(source.slice(source.indexOf('function sourceLocked()'), source.indexOf('function acceptState(')), context);
  vm.runInContext(source.slice(source.indexOf('function openDisplayOne()'), source.indexOf("$('#play').addEventListener")), context);
  vm.runInContext('playOnAdminDisplay()', context); assert.equal(commands.length, 0); assert.equal(opens.length, 0);
  context.status.state.allReady = true;
  vm.runInContext('playOnAdminDisplay()', context); assert.equal(commands.length, 1); assert.equal(opens.length, 0, 'copied link already loaded: never navigate');
  vm.runInContext('openDisplayOne(); openDisplayOne(); playOnAdminDisplay()', context);
  assert.equal(opens.length, 1); assert.equal(focused, 3); assert.equal(commands.length, 2);
  context.status.state.ownerId = 'another-device';
  vm.runInContext('playOnAdminDisplay()', context); assert.equal(commands.length, 2);
  const html = read('admin.html');
  assert.match(html, /data-sharing="instant"[^>]+>Instant/); assert.match(html, /data-sharing="server"[^>]+>Upload/);
});

test('video readiness needs picture plus canplay, audio needs canplay but no picture; startup progress is bounded', () => {
  const source = read('screen.js');
  const video = { duration: 60, readyState: 1, videoWidth: 1920, videoHeight: 1080, currentTime: 0, buffered: { length: 1, start: () => 0, end: () => 1.5 } };
  const context = vm.createContext({ Number, Boolean, Math, video, currentState: { asset: { version: 'current' } }, currentAssetVersion: 'current', sessionMode: 'video', lastError: '', mediaRecoveryInFlight: '', documentReady: false, youtubeReady: false });
  vm.runInContext(source.slice(source.indexOf('function mediaIsReady()'), source.indexOf('function checkVideoFrames(')), context);
  assert.equal(vm.runInContext('mediaIsReady()', context), false);
  assert.equal(vm.runInContext('loadingStatus().loadProgress', context), 50);
  video.readyState = 3; assert.equal(vm.runInContext('mediaIsReady()', context), true);
  assert.equal(vm.runInContext('loadingStatus().loadProgress', context), 100);
  video.videoWidth = 0; video.videoHeight = 0; assert.equal(vm.runInContext('mediaIsReady()', context), false);
  context.sessionMode = 'audio'; assert.equal(vm.runInContext('mediaIsReady()', context), true);
  context.currentAssetVersion = 'stale'; assert.equal(vm.runInContext('mediaIsReady()', context), false);
  assert.equal(vm.runInContext('loadingStatus().loadProgress', context), 0);
});

test('dashboard shortcuts use the same gated Play action and seek controls, including focused player buttons', () => {
  const handlers = {}, actions = [], source = read('admin.js');
  const context = vm.createContext({ document: { addEventListener: (name, handler) => { handlers[name] = handler; } },
    status: { state: { sessionMode: 'audio', asset: {}, playing: false } }, playOnAdminDisplay: () => actions.push('play'),
    command: (value) => actions.push(value.type), seekRelative: (value) => actions.push(value), $: () => ({}),
  });
  vm.runInContext(source.slice(source.indexOf("document.addEventListener('keydown'"), source.indexOf('async function refresh()')), context);
  const key = (code, id, repeat = false, typing = false) => handlers.keydown({ code, key: code === 'Space' ? ' ' : code, repeat,
    target: { matches: () => typing, closest: () => id ? { id } : null }, preventDefault() {} });
  key('Space', 'play'); key('Space', 'play', true);
  context.status.state.playing = true; key('Space', 'pause');
  key('ArrowLeft', 'back'); key('ArrowRight', 'forward');
  key('Space', 'chooseFile'); key('Space', '', false, true);
  assert.deepEqual(actions, ['play', 'pause', -10, 10]);
  context.status.state.sessionMode = 'presentation'; key('ArrowLeft', 'previousPage'); key('ArrowRight', 'nextPage');
  assert.deepEqual(actions.slice(-2), ['previous-page', 'next-page']);
});

test('format help is a keyboard-accessible info toggle next to upload, uses simple copy, and drop icons stay centred', () => {
  const html = read('admin.html'), css = read('styles.css'), source = read('admin.js');
  const row = html.slice(html.indexOf('<div class="source-upload-row">'), html.indexOf('<section id="youtubeDownloadPanel"'));
  assert.match(row, /<details id="videoFormatInfo"/);
  assert.match(row, /<summary aria-label="Supported video formats"/);
  assert.match(row, /MP4 \/ M4V:.*H\.264.*AAC.*VP9.*AV1/);
  assert.match(row, /MKV:.*H\.264.*AAC/);
  assert.match(source, /videoFormatInfo'\)\.hidden = state\.sessionMode !== 'video' \|\| downloadingYouTube/);
  assert.match(css, /\.drop-zone-icon\s*\{[^}]*display: flex;[^}]*align-items: center;[^}]*justify-content: center;[^}]*width: 2rem;[^}]*margin: 0 auto 12px;/);
});

test('another laptop sees only its screen opener; the whole source editor stays disabled until removal', () => {
  const nodes = new Map(), opens = [];
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { hidden: false, disabled: false, value: '', open: true, innerHTML: '',
      querySelector: (value) => node(`${selector} ${value}`) });
    return nodes.get(selector);
  };
  const context = vm.createContext({ $: node, status: { state: { ownerId: 'admin', screenCount: 3, sessionMode: 'video' },
    screens: [{ screen: 2, deviceId: 'another-viewer', ready: true }, { screen: 3, deviceId: 'this-viewer', ready: true }] },
    window: { CineWallSession: { deviceId: 'this-viewer', room: 'private', link: (route) => `https://watch.aitoyz.in${route}&room=private` }, open: (url, name) => { opens.push({ url, name }); return { focus() {} }; } } });
  const source = read('admin.js');
  vm.runInContext(source.slice(source.indexOf('function sourceLocked()'), source.indexOf('function acceptState(')), context);
  vm.runInContext('renderViewerSource(); openViewerScreen()', context);
  assert.equal(node('#sourceEditor').hidden, true); assert.equal(node('#sourceEditor').disabled, true);
  assert.equal(node('#viewerSource').hidden, false); assert.equal(node('#videoFormatInfo').open, false);
  assert.equal(node('#viewerScreenSelect').value, '3');
  assert.equal(opens[0].url, 'https://watch.aitoyz.in/screen.html?screen=3&room=private');
  context.status.state.ownerId = '';
  vm.runInContext('renderViewerSource(); openViewerScreen()', context);
  assert.equal(node('#sourceEditor').disabled, false); assert.equal(node('#sourceEditor').hidden, false);
  assert.equal(node('#viewerSource').hidden, true); assert.equal(opens.length, 1);
  context.status.state.ownerId = 'admin'; context.status.state.screenCount = 1;
  vm.runInContext('renderViewerSource()', context); assert.equal(node('#openViewerScreen').disabled, true);
});

test('landing page removes room buttons and their handlers, without removing session-scoped links', () => {
  assert.doesNotMatch(read('index.html'), /Copy room link|Join room|copyRoomLink|joinRoomForm/);
  assert.doesNotMatch(read('launcher.js'), /copyRoomLink|joinRoomForm|roomMessage/);
  assert.match(read('launcher.js'), /CineWallSession.*link/);
});
