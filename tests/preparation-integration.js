'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cinewall-preparation-test-'));
const base = 'http://localhost:4199';
const converter = path.join(root, 'tools', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
let server;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function json(route, body) {
  const response = await fetch(base + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  return { status: response.status, data: await response.json() };
}
async function waitFor(predicate) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const status = (await json('/api/status')).data;
    if (predicate(status)) return status;
    await pause(100);
  }
  throw new Error('Preparation status timed out');
}
function upload(data, name, partial = false) {
  let request;
  const done = new Promise((resolve, reject) => {
    request = http.request(base + '/api/media?kind=video&reencode=1&name=' + encodeURIComponent(name), { method: 'POST', headers: { 'Content-Type': 'video/x-matroska', 'Content-Length': data.length } }, (response) => {
      let output = '';
      response.on('data', (chunk) => { output += chunk; });
      response.on('end', () => { try { resolve({ status: response.statusCode, data: JSON.parse(output) }); } catch { reject(new Error(`Upload returned ${response.statusCode}: ${output || 'empty response'}`)); } });
    });
    request.on('error', reject);
    if (partial) request.write(data.subarray(0, Math.floor(data.length / 2)));
    else request.end(data);
  });
  return { done, request };
}

(async () => {
  const clip = path.join(temporary, 'test-source.mkv');
  execFileSync(converter, ['-nostdin', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '12', '-c:v', 'mpeg4', '-q:v', '3', '-c:a', 'aac', clip], { windowsHide: true });
  const data = fs.readFileSync(clip);
  server = spawn(process.execPath, ['server.js'], { cwd: root, windowsHide: true, env: { ...process.env, PORT: '4199', CINEWALL_CACHE_DIR: path.join(temporary, 'cache') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 100 && !output.includes('http://localhost:4199/'); attempt++) await pause(100);
  assert.ok(output.includes('http://localhost:4199/'), output);
  const held = upload(data, 'cancel-test.mkv', true);
  const preparing = await waitFor((s) => s.state.preparation?.phase === 'uploading');
  const duplicate = await upload(data, 'duplicate.mkv').done;
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.preparation.version, preparing.state.preparation.version);
  assert.equal(duplicate.data.preparation.name, 'cancel-test.mkv');
  const cancelled = await json('/api/media/cancel', { version: preparing.state.preparation.version });
  assert.equal(cancelled.status, 200);
  held.request.end(data.subarray(Math.floor(data.length / 2)));
  const stopped = await held.done;
  assert.equal(stopped.data.preparation.phase, 'cancelled');
  await waitFor((s) => s.state.preparation?.phase === 'cancelled');

  const conversionToCancel = upload(data, 'cancel-conversion.mkv');
  const converting = await waitFor((s) => s.state.preparation?.phase === 'converting');
  const staleCancel = await json('/api/media/cancel', { version: 'stale-version' });
  assert.equal(staleCancel.status, 400);
  await json('/api/media/cancel', { version: converting.state.preparation.version });
  const conversionStopped = await conversionToCancel.done;
  assert.equal(conversionStopped.data.preparation.phase, 'cancelled');
  await waitFor((s) => s.state.preparation?.phase === 'cancelled');

  const started = upload(data, 'converted-test.mkv');
  let sawConversion = false;
  const watcher = setInterval(async () => {
    try { const s = (await json('/api/status')).data.state; if (s.preparation?.phase === 'converting') sawConversion = true; } catch {}
  }, 100);
  const ready = await started.done;
  clearInterval(watcher);
  assert.equal(ready.status, 200, JSON.stringify(ready));
  assert.equal(ready.data.state.preparation.phase, 'ready');
  assert.equal(ready.data.state.asset.converted, true);
  assert.equal(ready.data.state.asset.type, 'video/mp4');
  assert.ok(sawConversion, 'Conversion progress was not exposed');
  const range = await fetch(base + '/api/media/stream', { headers: { Range: 'bytes=0-1023' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 1024);
  const probe = path.join(root, 'tools', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  const wall = fs.readdirSync(path.join(temporary, 'cache')).find((name) => name.endsWith('-wall.mp4'));
  const info = JSON.parse(execFileSync(probe, ['-v', 'error', '-show_streams', '-of', 'json', path.join(temporary, 'cache', wall)], { windowsHide: true, encoding: 'utf8' }));
  assert.ok(info.streams.some((stream) => stream.codec_name === 'h264'));
  assert.ok(info.streams.some((stream) => stream.codec_name === 'aac'));
  console.log('Verified: shared status, duplicates, upload/conversion cancellation, stale cancellation guards, subsequent upload, conversion progress, H.264/AAC output and range streaming.');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (server) {
    server.kill();
    await new Promise((resolve) => { if (server.exitCode !== null) resolve(); else server.once('close', resolve); });
  }
  // This is only the exact newly generated test directory, never a user media folder.
  if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('cinewall-preparation-test-')) fs.rmSync(temporary, { recursive: true, force: true });
});
