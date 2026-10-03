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
const identityHeaders = { 'X-CineWall-Device': require('node:crypto').randomUUID(), 'X-CineWall-Key': require('node:crypto').randomUUID() };
const converter = path.join(root, 'tools', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
let server;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function json(route, body) {
  const response = await fetch(base + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...identityHeaders }, body: JSON.stringify(body) } : {});
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
    request = http.request(base + '/api/media?kind=video&reencode=1&name=' + encodeURIComponent(name), { method: 'POST', headers: { 'Content-Type': 'video/mp4', 'Content-Length': data.length, ...identityHeaders } }, (response) => {
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
  const clip = path.join(temporary, 'test-source.mp4');
  execFileSync(converter, ['-nostdin', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '1', '-c:v', 'libx264', '-c:a', 'aac', clip], { windowsHide: true });
  const data = fs.readFileSync(clip);
  server = spawn(process.execPath, ['server.js'], { cwd: root, windowsHide: true, env: { ...process.env, PORT: '4199', CINEWALL_CACHE_DIR: path.join(temporary, 'cache') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 100 && !output.includes('http://localhost:4199/'); attempt++) await pause(100);
  assert.ok(output.includes('http://localhost:4199/'), output);
  const rejected = await upload(data, 'unsupported.mkv').done;
  assert.equal(rejected.status, 415);
  assert.equal((await json('/api/status')).data.state.asset, null);
  const held = upload(data, 'cancel-test.mp4', true);
  const preparing = await waitFor((s) => s.state.preparation?.phase === 'uploading');
  const duplicate = await upload(data, 'duplicate.mp4').done;
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.preparation.version, preparing.state.preparation.version);
  assert.equal(duplicate.data.preparation.name, 'cancel-test.mp4');
  const staleCancel = await json('/api/media/cancel', { version: 'stale-version' });
  assert.equal(staleCancel.status, 400);
  const cancelled = await json('/api/media/cancel', { version: preparing.state.preparation.version });
  assert.equal(cancelled.status, 200);
  held.request.end(data.subarray(Math.floor(data.length / 2)));
  const stopped = await held.done;
  assert.equal(stopped.data.preparation.phase, 'cancelled');
  await waitFor((s) => s.state.preparation?.phase === 'cancelled');

  const started = upload(data, 'unchanged-test.mp4');
  const ready = await started.done;
  assert.equal(ready.status, 200, JSON.stringify(ready));
  assert.equal(ready.data.state.preparation.phase, 'ready');
  assert.equal(ready.data.state.asset.converted, false);
  assert.equal(ready.data.state.asset.type, 'video/mp4');
  const range = await fetch(base + '/api/media/stream', { headers: { Range: 'bytes=0-1023' } });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), data.subarray(0, 1024));
  const wall = fs.readdirSync(path.join(temporary, 'cache')).find((name) => name.endsWith('.mp4'));
  assert.deepEqual(fs.readFileSync(path.join(temporary, 'cache', wall)), data, 'server stores the original bytes without conversion');
  const badClip = path.join(temporary, 'unsupported.mp4');
  execFileSync(converter, ['-nostdin', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '0.3', '-c:v', 'mpeg4', badClip], { windowsHide: true });
  const badUpload = await upload(fs.readFileSync(badClip), 'unsupported.mp4').done;
  assert.equal(badUpload.status, 415, JSON.stringify(badUpload));
  assert.equal((await json('/api/status')).data.state.asset.version, ready.data.state.asset.version);
  const originalStream = await fetch(base + '/api/media/stream');
  assert.deepEqual(Buffer.from(await originalStream.arrayBuffer()), data);
  const mkvClip = path.join(temporary, 'compatible.mkv');
  execFileSync(converter, ['-nostdin', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '0.3', '-map', '0:v', '-map', '1:a', '-map', '1:a', '-c:v', 'libx264', '-c:a', 'aac', mkvClip], { windowsHide: true });
  const mkvData = fs.readFileSync(mkvClip), mkv = await upload(mkvData, 'compatible.mkv').done;
  assert.equal(mkv.status, 200, JSON.stringify(mkv));
  assert.equal(mkv.data.state.asset.type, 'video/x-matroska');
  assert.equal(mkv.data.state.asset.converted, false);
  const mkvStream = await fetch(base + '/api/media/stream', { headers: { Range: 'bytes=0-1023' } });
  assert.equal(mkvStream.headers.get('Content-Type'), 'video/x-matroska');
  assert.deepEqual(Buffer.from(await mkvStream.arrayBuffer()), mkvData.subarray(0, 1024));
  const storedMkv = fs.readdirSync(path.join(temporary, 'cache')).find((name) => name.endsWith('.mkv'));
  assert.deepEqual(fs.readFileSync(path.join(temporary, 'cache', storedMkv)), mkvData);
  console.log('Verified: compatible dual-audio MKV/MP4 acceptance, unsupported codec/container rejection, transfer/cancellation guards and unchanged original bytes with range streaming.');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (server) {
    server.kill();
    await new Promise((resolve) => { if (server.exitCode !== null) resolve(); else server.once('close', resolve); });
  }
  // This is only the exact newly generated test directory, never a user media folder.
  if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('cinewall-preparation-test-')) fs.rmSync(temporary, { recursive: true, force: true });
});
