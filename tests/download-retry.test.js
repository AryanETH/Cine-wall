'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const turn = () => new Promise(setImmediate);

function info(videoId = 'YE7VzlLtp-4', fresh = false) {
  return { title: 'Test video', id: videoId, duration: 60, formats: [
    { format_id: fresh ? '237' : '137', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 1080, fps: 30, url: 'video' },
    { format_id: fresh ? '238' : '138', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 1080, fps: 30, url: 'alternate-video' },
    { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a', abr: 128, url: 'audio' },
    { format_id: '18', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a', height: 360, fps: 30, url: 'lower-quality' },
  ] };
}

function downloader({ freshInfo = info(undefined, true), holdRefresh = false, outputFile = 'media.mp4', inspectionErrors = [] } = {}) {
  const children = [], extractions = [], writes = [];
  const child = () => { const value = new EventEmitter(); value.stdout = new EventEmitter(); value.stderr = new EventEmitter(); value.kill = () => {}; return value; };
  const module = { exports: {} };
  const fileSystem = {
    mkdirSync() {}, existsSync: () => false, readdirSync: (directory, options) => options ? [] : [outputFile],
    statSync: () => ({ size: 1024 }), writeFileSync: (...args) => writes.push(args),
  };
  const processes = {
    execFile(file, args, options, callback) {
      const value = child(); extractions.push(args);
      const failure = inspectionErrors[extractions.length - 1];
      if (failure) {
        queueMicrotask(() => callback(new Error('Connection failed'), '', failure));
      } else if (holdRefresh && extractions.length > 1) {
        options.signal.addEventListener('abort', () => callback(Object.assign(new Error('Cancelled'), { code: 'ABORT_ERR' }), '', 'Cancelled'), { once: true });
      } else queueMicrotask(() => callback(null, JSON.stringify(extractions.length === 1 ? info() : freshInfo), ''));
      return value;
    },
    spawn(file, args) { const value = child(); value.args = args; children.push(value); return value; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../youtube-downloads.js'), 'utf8'), {
    require(name) { return name === 'node:fs' ? fileSystem : name === 'node:child_process' ? processes : name === 'node:crypto' ? { randomUUID } : require(name); },
    module, process: { platform: 'linux', execPath: process.execPath, env: { CINEWALL_CACHE_DIR: path.join(__dirname, 'virtual-cache') } }, __dirname: path.join(__dirname, '..'),
    setTimeout, clearTimeout, AbortController,
  });
  return { api: module.exports, children, extractions, writes, fail(index, error) { children[index].stderr.emit('data', Buffer.from(error)); children[index].emit('close', 1); } };
}

async function startVideo(client) {
  const inspection = await client.api.inspect('YE7VzlLtp-4');
  return client.api.start(inspection.id, inspection.formats.find((format) => format.height === 1080).id, 'test-room');
}

test('video 403 refreshes formats once, retries equivalent quality and stops after available same-quality streams', async () => {
  const client = downloader(), job = await startVideo(client);
  assert.equal(client.children[0].args[client.children[0].args.indexOf('-f') + 1], '137+140');
  client.fail(0, 'ERROR: HTTP Error 403: Forbidden'); await turn();
  assert.equal(client.extractions.length, 2);
  assert.equal(client.children[1].args[client.children[1].args.indexOf('-f') + 1], '237+140');
  assert.ok(client.children[1].args.includes('--no-cache-dir'));
  client.fail(1, 'ERROR: HTTP Error 403: Forbidden'); await turn();
  assert.equal(client.children[2].args[client.children[2].args.indexOf('-f') + 1], '238+140');
  client.fail(2, 'ERROR: HTTP Error 403: Forbidden'); await turn();
  assert.equal(client.children.length, 3);
  assert.equal(client.api.get(job.id).state, 'error');
  assert.match(client.api.get(job.id).error, /403/);
});

test('a vanished quality is reported rather than silently downloading a lower-resolution video', async () => {
  const lower = info(undefined, true); lower.formats = lower.formats.filter((format) => format.height !== 1080);
  const client = downloader({ freshInfo: lower }), job = await startVideo(client);
  client.fail(0, 'ERROR: Requested format is not available'); await turn();
  assert.equal(client.children.length, 1);
  assert.match(client.api.get(job.id).error, /will not silently lower/);
});

test('YouTube rate limits, sign-in gates and playback authorization do not trigger repeated metadata refreshes', async () => {
  for (const error of ['ERROR: HTTP Error 429: Too Many Requests', "ERROR: Sign in to confirm you're not a bot; HTTP Error 403", 'ERROR: PO Token required; HTTP Error 403']) {
    const client = downloader(), job = await startVideo(client);
    client.fail(0, error); await turn();
    assert.equal(client.extractions.length, 1);
    assert.equal(client.children.length, 1);
    assert.equal(client.api.get(job.id).state, 'error');
  }
});

test('cancelling a format refresh aborts it and cannot resurrect the download', async () => {
  const client = downloader({ holdRefresh: true }), job = await startVideo(client);
  client.fail(0, 'ERROR: HTTP Error 403: Forbidden'); await turn();
  client.api.cancel(job.id); await turn();
  assert.equal(client.api.get(job.id).state, 'cancelled');
  assert.equal(client.children.length, 1);
  assert.equal(client.api.get(job.id).refreshAbort, null);
});

test('a refreshed video download becomes ready only when the requested output exists', async () => {
  const client = downloader(), job = await startVideo(client);
  client.fail(0, 'ERROR: HTTP Error 503: Service Unavailable'); await turn();
  client.children[1].emit('close', 0);
  assert.equal(client.api.get(job.id).state, 'ready');
  assert.equal(client.api.get(job.id).progress, 100);
  assert.equal(client.api.get(job.id).option.height, 1080);
  assert.equal(client.writes.length, 1);
});

test('AAC downloads use audio extraction, retry refreshed streams and persist only the requested AAC output', async () => {
  const client = downloader({ outputFile: 'media.aac' }), inspection = await client.api.inspect('YE7VzlLtp-4');
  const format = inspection.formats.find((option) => option.container === 'aac');
  assert.equal(format.kind, 'audio');
  const job = client.api.start(inspection.id, format.id, 'audio-room');
  assert.ok(client.children[0].args.includes('-x'));
  assert.equal(client.children[0].args[client.children[0].args.indexOf('--audio-format') + 1], 'aac');
  client.fail(0, 'ERROR: HTTP Error 403: Forbidden'); await turn();
  assert.equal(client.children.length, 2);
  client.children[1].emit('close', 0);
  assert.equal(client.api.get(job.id).state, 'ready');
  assert.equal(client.api.publicJob(client.api.get(job.id)).container, 'aac');
  assert.match(client.api.get(job.id).fileName, /\.aac$/);
  assert.equal(client.writes.length, 1);
});

test('metadata connection failures try an alternate official API and IPv6, then stop with a readable Windows error', async () => {
  const blocked = "ERROR: HTTPSConnection: Failed to establish a new connection: [WinError 10013] socket forbidden by its access permissions";
  const client = downloader({ inspectionErrors: [blocked, blocked, 'ERROR: Network is unreachable'] });
  await assert.rejects(client.api.inspect('YE7VzlLtp-4'), /Windows blocked the YouTube connection/);
  assert.equal(client.extractions.length, 3);
  assert.ok(!client.extractions[0].includes('--force-ipv4'));
  assert.ok(client.extractions[1].some((arg) => arg.includes('innertube_host=youtubei.googleapis.com')));
  assert.ok(client.extractions[2].includes('--force-ipv6'));
  const retry = downloader({ inspectionErrors: [blocked] });
  const result = await retry.api.inspect('YE7VzlLtp-4');
  assert.ok(result.formats.length);
  const job = retry.api.start(result.id, result.formats.find((format) => format.height === 1080).id);
  assert.ok(retry.children[0].args.some((arg) => arg.includes('innertube_host=')), 'download must keep the route that succeeded');
  retry.api.cancel(job.id);
  retry.children[0].emit('close', 1);
});

test('download socket failures use bounded connection routes without changing quality or repeatedly refreshing formats', async () => {
  const client = downloader(), job = await startVideo(client);
  for (let index = 0; index < 3; index++) { client.fail(index, 'ERROR: [WinError 10013] socket forbidden by its access permissions'); await turn(); }
  assert.equal(client.children.length, 3);
  assert.equal(client.extractions.length, 1);
  assert.equal(client.api.get(job.id).state, 'error');
  assert.match(client.api.get(job.id).error, /Windows blocked/);
  assert.ok(client.children.every((child) => child.args[child.args.indexOf('-f') + 1] === '137+140'));
});
