'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const turn = () => new Promise(setImmediate);
const root = path.resolve(__dirname, '..');

function audioDownloads() {
  const nodes = new Map(), requests = [];
  const node = (id) => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { hidden: false, disabled: false, value: '', handlers: {}, children: [], attributes: {},
        classList: { toggle(name, flag) { if (flag) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name) },
        addEventListener(name, fn) { this.handlers[name] = fn; }, focus() {}, setAttribute(name, value) { this.attributes[name] = value; },
        replaceChildren(...children) { this.children = children; this.value = children[0]?.value || ''; },
      });
    }
    return nodes.get(id);
  };
  const formats = [
    { id: 'video', kind: 'video', container: 'mp4', label: '1080p' },
    { id: 'mp3', kind: 'audio', container: 'mp3', label: '192 kbps' },
    { id: 'aac', kind: 'audio', container: 'aac', label: 'Best available AAC' },
    { id: 'm4a', kind: 'audio', container: 'm4a', label: 'Original audio' },
  ];
  const job = { id: 'audio-job', state: 'ready', kind: 'audio', container: 'aac', fileName: 'test.aac', downloadUrl: '/api/youtube/downloads/audio-job/file' };
  const context = vm.createContext({ document: { getElementById: node, body: { dataset: { sessionMode: 'audio' } } }, window: {},
    Option: function(label, value) { this.label = label; this.value = value; },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options) => {
      requests.push([url, options?.body ? JSON.parse(options.body) : null]);
      const data = url.endsWith('/tools') ? { ready: true } : url.endsWith('/formats') ? { id: 'inspection', title: 'Audio source', formats } : url.endsWith('/saved-videos') ? { videos: [] } : url.endsWith('/load') ? { state: { sessionMode: 'audio' } } : job;
      return { ok: true, json: async () => data };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'public/youtube-download.js'), 'utf8'), context);
  return { node, context, requests, formats };
}

test('audio source tab stays open, offers audio-only formats and loads AAC into the speaker room', async () => {
  const ui = audioDownloads(); await turn();
  ui.node('downloadYoutubeToggle').handlers.click();
  assert.equal(ui.node('youtubeDownloadPanel').hidden, false);
  assert.equal(ui.node('localVideoSource').textContent, 'Local file');
  assert.equal(ui.node('fileSourceButton').hidden, true);
  assert.equal(ui.node('playlistButton').hidden, true);
  ui.node('downloadYoutubeUrl').value = 'https://youtu.be/YE7VzlLtp-4';
  await ui.node('youtubeDownloadForm').handlers.submit({ preventDefault() {} });
  assert.deepEqual(ui.node('downloadContainer').children.map((option) => option.value), ['mp3', 'aac', 'm4a']);
  ui.node('downloadContainer').value = 'aac'; ui.node('downloadContainer').handlers.change();
  await ui.node('prepareYoutubeDownload').handlers.click();
  assert.deepEqual(ui.requests.find(([url]) => url === '/api/youtube/downloads')[1], { inspectionId: 'inspection', optionId: 'aac' });
  assert.equal(ui.node('loadYoutubeDownload').hidden, false);
  assert.equal(ui.node('loadYoutubeDownload').textContent, 'Use in speaker room');
  await ui.node('loadYoutubeDownload').handlers.click();
  assert.ok(ui.requests.some(([url]) => url.endsWith('/audio-job/load')));
  assert.equal(ui.node('youtubeDownloadStatus').textContent, 'Audio loaded');
  ui.node('localVideoSource').handlers.click();
  assert.equal(ui.node('dropZone').hidden, false);
  assert.equal(ui.node('playlistButton').hidden, true, 'unfinished playlist action stays hidden');
  ui.context.window.CineWallDownloadPanel.syncMode('video');
  assert.ok(ui.node('downloadContainer').children.some((option) => option.value === 'mp4'));
  assert.equal(ui.node('loadYoutubeDownload').hidden, true, 'audio must not load into a video session');
});

test('audio YouTube tab survives dashboard refreshes without video conversion controls', () => {
  const code = fs.readFileSync(path.join(root, 'public/admin.js'), 'utf8'), nodes = new Map();
  const $ = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { hidden: true, value: '', dataset: {}, classList: { toggle() {} }, setAttribute() {}, querySelectorAll: () => [] });
    return nodes.get(selector);
  };
  $('#youtubeDownloadPanel').hidden = false;
  const context = vm.createContext({ $, window: {}, status: { state: { sessionMode: 'audio', asset: null } }, document: { body: { dataset: {} } },
    uploadBusy: false, removeBusy: false, isPreparing: () => false, sourceLocked: () => false, modeConfig: { audio: { label: 'Audio' }, video: { label: 'Video' }, presentation: { label: 'Presentation' } },
  });
  vm.runInContext(code.slice(code.indexOf('function renderModeShell('), code.indexOf('function renderScreens(')), context);
  vm.runInContext('renderModeShell(); renderModeShell()', context);
  assert.equal($('#youtubeDownloadPanel').hidden, false);
  assert.equal($('#videoSourceSelector').hidden, false);
  assert.equal($('#fileSourceButton').hidden, true);
  context.status.state.sessionMode = 'video'; vm.runInContext('renderModeShell()', context);
  assert.equal($('#youtubeDownloadPanel').hidden, false);
  context.status.state.sessionMode = 'presentation'; vm.runInContext('renderModeShell()', context);
  assert.equal($('#youtubeDownloadPanel').hidden, true);
  assert.equal($('#videoSourceSelector').hidden, true);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8'), /id="(?:advancedSharing|compatibilityMethod|allowReencode)"/);
});

test('audio file and YouTube link drops handle missing MIME and mixed-case extensions without navigation', () => {
  const code = fs.readFileSync(path.join(root, 'public/admin.js'), 'utf8'), handlers = {}, loaded = [], sources = [], nodes = new Map();
  const $ = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', classList: { add() {}, remove() {} }, addEventListener(name, fn) { handlers[name] = fn; }, contains: () => false });
    return nodes.get(selector);
  };
  const context = vm.createContext({ $, warning: $('#fileWarning'), status: { state: { sessionMode: 'audio' } }, uploadBusy: false, isPreparing: () => false, sourceLocked: () => false,
    document: { body: { addEventListener() {} } }, uploadFile: (file) => loaded.push(file.name), URL,
    audioQueue: { queue: { add: (files) => loaded.push(...Array.from(files).filter(file => /\.(mp3|aac|wav|m4a|flac|oga)$/i.test(file.name)).map(file => file.name)) } },
    window: { CineWallDownloadPanel: { chooseSource: (open) => sources.push(open) } },
  });
  vm.runInContext(code.slice(code.indexOf('// Drag and Drop functionality'), code.indexOf("$('#youtubeSourceForm').addEventListener")), context);
  for (const name of ['TRACK.MP3', 'song.AAC', 'track.WAV', 'album.M4A', 'lossless.FLAC', 'sound.OGA']) handlers.drop({ dataTransfer: { files: [{ name, type: '' }] } });
  assert.equal(loaded.length, 6);
  handlers.drop({ dataTransfer: { files: [{ name: 'notes.PDF', type: '' }] } });
  assert.equal(loaded.length, 6);
  handlers.drop({ dataTransfer: { files: [], getData: () => 'https://music.youtube.com/watch?v=YE7VzlLtp-4' } });
  assert.equal(sources.at(-1), true);
  assert.equal($('#downloadYoutubeUrl').value, 'https://music.youtube.com/watch?v=YE7VzlLtp-4');
  handlers.drop({ dataTransfer: { files: [], getData: () => 'https://youtube.com.evil.example/watch' } });
  assert.equal(sources.at(-1), true); assert.equal(loaded.length, 6);
  context.sourceLocked = () => true;
  handlers.drop({ dataTransfer: { files: [{ name: 'new.mp3', type: '' }] } });
  assert.equal(loaded.length, 6, 'another laptop cannot replace the source by dropping a file');
});
