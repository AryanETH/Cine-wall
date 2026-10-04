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

test('screen status reflects the current movie, not stale readiness; loading and errors are visible', () => {
  const label = { textContent: '' }, notice = {}, loading = {}, toggles = {};
  const badge = { querySelector: () => label };
  const card = { querySelector: selector => selector === '[data-screen-state]' ? badge : selector === '.screen-notice' ? notice : loading, classList: { toggle: (key, value) => { toggles[key] = value; } } };
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
