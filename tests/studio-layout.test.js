'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');

test('Quiet Studio combines links, status and sound without duplicate dashboard blocks', () => {
  const html = read('admin.html'), source = read('admin.js'), css = read('studio.css');
  assert.match(html, /studio\.css\?v=/);
  assert.match(css, /grid-template-areas: 'player source'/);
  assert.match(css, /grid-template-areas: 'player' 'source'/);
  for (const id of ['screenGrid', 'speakerGrid', 'trackTitle', 'previewFullscreen', 'readyCount']) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`));
    assert.doesNotMatch(source, new RegExp(`\\$\\('#${id}'\\)`));
  }
  assert.match(html, /<details id="settings"/);
  assert.match(html, /id="dropZone"[^>]*role="button"[^>]*tabindex="0"/);
  assert.match(source, /if \(screenLinks\.cinewallLinksKey === key\) return/);
  assert.match(source, /screenLinks\.addEventListener\('input'/);
});

test('Sound output switch is removed without removing per-screen volume or mute', () => {
  const html = read('admin.html'), source = read('admin.js');
  assert.doesNotMatch(html, /audioMixerPanel|youtubeAudioMode|data-youtube-audio/);
  assert.doesNotMatch(source, /\$\('#(?:audioMixerPanel|youtubeAudioMode)'\)/);
  assert.match(source, /data-volume-screen/); assert.match(source, /data-mute-screen/);
  assert.match(html, /id="muteAll"/);
});

test('screen status reflects the current movie, not stale readiness; loading and errors are visible', () => {
  const label = { textContent: '' }, notice = {}, loading = {}, toggles = {};
  const badge = { querySelector: () => label };
  const card = { querySelector: selector => selector === '[data-screen-state]' ? badge : selector === '.screen-notice' ? notice : selector === '[data-instant-state]' ? null : loading, classList: { toggle: (key, value) => { toggles[key] = value; } } };
  const screen = { screen: 2, ready: true, mediaReady: true, assetVersion: 'old', loadProgress: 65 };
  const context = vm.createContext({ status: { state: { asset: { version: 'current' } } }, logicalScreens: () => [screen], screenLinks: { querySelector: () => card }, isPreparing: () => false,
    isFullyReady: value => value.assetVersion === 'current' && value.mediaReady && !value.error, Math, Boolean });
  const source = read('admin.js');
  vm.runInContext(source.slice(source.indexOf('function renderScreens()'), source.indexOf('function primaryAddress()')), context);
  vm.runInContext('renderScreens()', context);
  assert.equal(label.textContent, 'Loading 65%'); assert.equal(loading.hidden, false); assert.equal(toggles.ready, false);
  screen.assetVersion = 'current'; vm.runInContext('renderScreens()', context);
  assert.equal(label.textContent, 'Ready'); assert.equal(loading.hidden, true);
  screen.error = 'Connection lost'; vm.runInContext('renderScreens()', context);
  assert.equal(label.textContent, 'Needs attention'); assert.equal(notice.textContent, 'Connection lost'); assert.equal(notice.hidden, false);
});

test('poster ignores an unpainted black frame, captures the actual preview, then caches it', () => {
  const poster = { dataset: {} }, sourceIcon = {}, pixels = new Uint8ClampedArray(160 * 90 * 4);
  let draws = 0;
  const context = vm.createContext({ $: selector => selector === '#sourcePoster' ? poster : sourceIcon,
    status: { state: { sessionMode: 'video' } }, loadedMediaVersion: 'movie', media: { videoWidth: 1920, videoHeight: 1080 },
    document: { createElement: () => ({ getContext: () => ({ drawImage: () => draws++, getImageData: () => ({ data: pixels }) }), toDataURL: () => 'data:image/jpeg;base64,real-frame' }) }, Boolean });
  const source = read('admin.js');
  vm.runInContext(source.slice(source.indexOf('function renderSourcePoster()'), source.indexOf('function applyPreviewVolume()')), context);
  vm.runInContext('captureSourcePoster()', context); assert.equal(poster.dataset.version, undefined);
  pixels[0] = 100; vm.runInContext('captureSourcePoster()', context);
  assert.equal(poster.dataset.version, 'movie'); assert.equal(poster.hidden, false); assert.equal(sourceIcon.hidden, true);
  vm.runInContext('captureSourcePoster()', context); assert.equal(draws, 2, 'status updates never recapture a loaded poster');
});

test('Instant card feedback is separate from movie readiness, hidden for Upload, and never guesses a hotspot before sharing', () => {
  const status = { state: { sessionMode: 'audio', asset: null } }, source = read('admin.js');
  const context = vm.createContext({ status, sharingMode: 'instant' });
  vm.runInContext(source.slice(source.indexOf('function instantFeedback('), source.indexOf('function renderScreens(')), context);
  const feedback = screen => { context.screen = screen; return vm.runInContext('instantFeedback(screen)', context); };
  assert.equal(feedback({ ready: false }).text, 'Open screen to connect');
  assert.equal(feedback({ ready: true }).text, 'Choose a file to check');
  status.state.asset = { source: 'peer', version: 'current', transport: 'hotspot' };
  const joined = { ready: true, assetVersion: 'current', instantConnection: 'searching' };
  assert.equal(feedback(joined).kind, 'searching');
  joined.instantConnection = 'connected';
  assert.equal(feedback(joined).text, 'Hotspot / Wi-Fi connected');
  assert.equal(feedback({ ...joined, assetVersion: 'old' }).kind, 'searching');
  joined.instantConnection = 'local'; assert.equal(feedback(joined).text, 'On this laptop');
  joined.instantConnection = 'disconnected'; assert.equal(feedback(joined).kind, 'disconnected');
  status.state.asset.source = 'server'; assert.equal(feedback(joined).hidden, true);
  status.state.asset = null; context.sharingMode = 'server'; assert.equal(feedback(joined).hidden, true);
  context.sharingMode = 'instant'; status.state.sessionMode = 'presentation'; assert.equal(feedback(joined).hidden, true);
});

test('dashboard audio waves run only while the current file is actually playing on a ready screen', () => {
  const flags = {}, screens = [{ ready: true, mediaReady: true, assetVersion: 'current', paused: false }];
  const status = { state: { sessionMode: 'audio', asset: { version: 'current' }, playing: true, notBefore: 0 } };
  const context = vm.createContext({ status, serverOffset: 0, Date, Number, Boolean, logicalScreens: () => screens,
    isFullyReady: screen => screen.ready && screen.mediaReady && screen.assetVersion === status.state.asset?.version && !screen.error && !screen.buffering,
    $: () => ({ classList: { toggle: (name, value) => { flags[name] = value; } } }),
  });
  const source = read('admin.js');
  vm.runInContext(source.slice(source.indexOf('function updateAudioWaves('), source.indexOf('function syncPreview(')), context);
  const update = () => vm.runInContext('updateAudioWaves()', context);
  update(); assert.equal(flags.playing, true);
  status.state.playing = false; update(); assert.equal(flags.playing, false);
  status.state.playing = true; screens[0].paused = true; update(); assert.equal(flags.playing, false);
  screens[0].paused = false; screens[0].buffering = true; update(); assert.equal(flags.playing, false);
  screens[0].buffering = false; screens[0].assetVersion = 'old'; update(); assert.equal(flags.playing, false);
  screens[0].assetVersion = 'current'; status.state.notBefore = Infinity; update(); assert.equal(flags.playing, false);
  status.state.notBefore = 0; status.state.asset = null; update(); assert.equal(flags.playing, false);
});

test('wave animations pause rather than reset and respect reduced motion', () => {
  const css = read('styles.css');
  for (const animation of ['audioBar', 'speakerBar', 'speakerPulse']) assert.match(css, new RegExp(`animation: ${animation}[^;]+paused`));
  assert.match(css, /\.audio-visual\.playing \.audio-bars i \{ animation-play-state: running/);
  assert.match(css, /\.speaker-stage\.playing \.speaker-bars i \{ animation-play-state: running/);
  assert.match(css, /prefers-reduced-motion: reduce[^}]+speaker-bars[^}]+animation: none !important/);
});
