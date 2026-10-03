'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('hotspot room elects one source, blocks replacements, relays original ranges without upload, and gates play on every current display', { timeout: 30000 }, async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cinewall-source-room-'));
  const listener = net.createServer(); await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise((resolve) => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`, devices = [0, 1].map(() => ({ id: randomUUID(), key: randomUUID() }));
  const headers = (device) => ({ 'X-CineWall-Device': device.id, 'X-CineWall-Key': device.key });
  const server = spawn(process.execPath, ['server.js'], { cwd: root, windowsHide: true, env: { ...process.env, PORT: String(port), CINEWALL_CACHE_DIR: temporary }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', stream;
  server.stdout.on('data', (bytes) => { output += bytes; }); server.stderr.on('data', (bytes) => { output += bytes; });
  t.after(async () => {
    stream?.destroy(); server.kill(); await new Promise((resolve) => server.exitCode !== null ? resolve() : server.once('close', resolve));
    if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('cinewall-source-room-')) fs.rmSync(temporary, { recursive: true, force: true });
  });
  for (let retry = 0; retry < 100 && !output.includes(`http://localhost:${port}/`); retry++) await pause(50);
  assert.ok(output.includes(`http://localhost:${port}/`), output);
  async function api(route, device = devices[0], body) {
    const response = await fetch(base + route, body === undefined ? { headers: headers(device) } : { method: 'POST', headers: { ...headers(device), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await api('/api/status')).data.state.roomId, 'hotspot');
  const claims = await Promise.all(devices.map((device) => api('/api/source/claim', device, {})));
  assert.deepEqual(claims.map((claim) => claim.status).sort(), [200, 423]);
  const winnerIndex = claims.findIndex((claim) => claim.status === 200), winner = devices[winnerIndex], other = devices[1 - winnerIndex];
  assert.equal((await api('/api/status', other)).data.state.ownerId, winner.id);
  assert.equal((await api('/api/source/release', other, {})).status, 423);
  const peerId = randomUUID(), bytes = Buffer.alloc(5000000);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
  const metadata = { peerId, name: 'original.mp4', size: bytes.length, type: 'video/mp4', duration: 60, fingerprint: 'a'.repeat(64), relay: true };
  const published = await api('/api/local-source', winner, metadata);
  assert.equal(published.status, 200);
  assert.equal(published.data.state.asset.transport, 'relay');
  const assetVersion = published.data.state.asset.version;
  const single = await api('/api/command', winner, { type: 'audio-output', output: 'single' });
  assert.equal(single.status, 200); assert.equal(single.data.command.audioSettings['1'].muted, false); assert.equal(single.data.command.audioSettings['2'].muted, true);
  assert.equal((await api('/api/command', other, { type: 'audio-output', output: 'all' })).status, 423);
  const all = await api('/api/command', winner, { type: 'audio-output', output: 'all' });
  assert.equal(all.status, 200); assert.ok(Object.values(all.data.command.audioSettings).every((setting) => !setting.muted));
  assert.equal((await api('/api/local-source', other, { ...metadata, name: 'replacement.mp4' })).status, 423);
  for (const type of ['clear-asset', 'play', 'session-mode']) assert.equal((await api('/api/command', other, { type, sessionMode: 'audio' })).status, 423);
  const forbiddenUpload = await fetch(`${base}/api/media?kind=video&name=replacement.mp4`, { method: 'POST', headers: { ...headers(other), 'Content-Type': 'video/mp4' }, body: bytes.subarray(0, 64) });
  assert.equal(forbiddenUpload.status, 423);
  assert.deepEqual(fs.readdirSync(temporary).filter((name) => fs.statSync(path.join(temporary, name)).isFile()), ['session.json'], 'Instant never saves movie bytes');
  const saved = JSON.parse(fs.readFileSync(path.join(temporary, 'session.json'), 'utf8'));
  assert.ok(!JSON.stringify(published.data).includes(winner.key));
  assert.notEqual(saved.sourceOwner.hash, winner.key, 'admin secret is stored as a hash');

  const served = [], errors = []; let skipNextReply = false;
  const connectSource = () => new Promise((resolve, reject) => {
    stream = http.get(`${base}/events?peer=${peerId}`, (response) => {
      let buffered = ''; resolve();
      response.on('data', (chunk) => {
        buffered += chunk.toString();
        for (let boundary; (boundary = buffered.indexOf('\n\n')) >= 0;) {
          const frame = buffered.slice(0, boundary); buffered = buffered.slice(boundary + 2);
          if (!frame.startsWith('event: source-range\n')) continue;
          const request = JSON.parse(frame.split('\ndata: ')[1]);
          served.push(request);
          assert.ok(request.end - request.start + 1 <= 512 * 1024);
          if (skipNextReply) { skipNextReply = false; continue; }
          fetch(`${base}/api/source/range?id=${request.id}`, { method: 'POST', headers: { ...headers(winner), 'Content-Type': 'application/octet-stream' }, body: bytes.subarray(request.start, request.end + 1) })
            .then((reply) => { if (!reply.ok && reply.status !== 409) errors.push(new Error(`range response ${reply.status}`)); }).catch((error) => errors.push(error));
        }
      });
    }); stream.on('error', reject);
  });
  await connectSource();
  const ranges = await Promise.all(['bytes=0-1199999', 'bytes=-23'].map(async (range) => {
    const response = await fetch(`${base}/api/media/stream?v=${assetVersion}`, { headers: { Range: range } });
    assert.equal(response.status, 206, response.status !== 206 ? await response.text() : ''); assert.equal(response.headers.get('content-type'), 'video/mp4');
    return Buffer.from(await response.arrayBuffer());
  }));
  assert.deepEqual(ranges[0], bytes.subarray(0, 1200000)); assert.deepEqual(ranges[1], bytes.subarray(bytes.length - 23));
  assert.ok(served.length >= 4); assert.deepEqual(errors, []);
  const head = await fetch(`${base}/api/media/stream?v=${assetVersion}`, { method: 'HEAD', headers: { Range: 'bytes=10-19' } });
  assert.equal(head.status, 206); assert.equal(head.headers.get('content-length'), '10');
  assert.equal((await fetch(`${base}/api/media/stream?v=stale`)).status, 409);
  assert.equal((await fetch(`${base}/api/media/stream?v=${assetVersion}`, { headers: { Range: `bytes=${bytes.length}-` } })).status, 416);

  const bounded = await fetch(`${base}/api/media/stream?v=${assetVersion}`, { headers: { Range: 'bytes=0-' } });
  assert.equal(bounded.headers.get('content-range'), `bytes 0-2097151/${bytes.length}`);
  assert.equal(bounded.headers.get('content-length'), '2097152');
  assert.deepEqual(Buffer.from(await bounded.arrayBuffer()), bytes.subarray(0, 2097152));
  const continuation = await fetch(`${base}/api/media/stream?v=${assetVersion}`, { headers: { Range: 'bytes=2097152-' } });
  assert.deepEqual(Buffer.from(await continuation.arrayBuffer()), bytes.subarray(2097152, 4194304));
  skipNextReply = true;
  const recovered = await fetch(`${base}/api/media/stream?v=${assetVersion}`, { headers: { Range: 'bytes=20-39' } });
  assert.equal(recovered.status, 206); assert.deepEqual(Buffer.from(await recovered.arrayBuffer()), bytes.subarray(20, 40));
  assert.equal(served.at(-1).id, served.at(-2).id, 'lost source reply is retried, not truncated');
  stream.destroy(); await pause(100);
  const interrupted = fetch(`${base}/api/media/stream?v=${assetVersion}`, { headers: { Range: 'bytes=40-59' } });
  await pause(200); await connectSource();
  const reconnected = await interrupted;
  assert.equal(reconnected.status, 206); assert.deepEqual(Buffer.from(await reconnected.arrayBuffer()), bytes.subarray(40, 60));
  const icon = await fetch(`${base}/favicon.ico`);
  assert.equal(icon.status, 200); assert.equal(icon.headers.get('content-type'), 'image/svg+xml');

  const play = () => api('/api/command', winner, { type: 'play', position: 0 });
  const joined = (screen, version = assetVersion, extra = {}) => api('/api/status', other, { clientId: `display-${screen}`, screen, ready: true, mediaReady: true, assetVersion: version, loadProgress: 100, ...extra });
  assert.equal((await play()).status, 409);
  await joined(1); await joined(2, 'stale'); assert.equal((await play()).status, 409);
  await joined(2, assetVersion, { mediaReady: false, loadProgress: 57 });
  assert.equal((await api('/api/status')).data.screens.find((screen) => screen.screen === 2).loadProgress, 57);
  assert.equal((await play()).status, 409);
  await joined(2, assetVersion, { buffering: true }); assert.equal((await play()).status, 409);
  await joined(2); assert.equal((await play()).status, 200);
  assert.equal((await api('/api/status')).data.screens.find((screen) => screen.screen === 2).deviceId, other.id);
  await api('/api/command', winner, { type: 'pause' });
  await api('/api/command', winner, { type: 'layout', screenCount: 3 }); assert.equal((await play()).status, 409);
  await joined(3); assert.equal((await play()).status, 200);
  await api('/api/command', winner, { type: 'clear-asset', assetVersion });
  assert.equal((await api('/api/status')).data.state.ownerId, '');
  const nextClaim = await api('/api/source/claim', other, {}); assert.equal(nextClaim.status, 200);
  assert.equal(nextClaim.data.state.ownerId, other.id);

  // Server mode reserves the same admin role while upload progress is visible.
  await api('/api/command', other, { type: 'session-mode', sessionMode: 'audio' });
  const audio = Buffer.alloc(200000, 42); let upload;
  const completion = new Promise((resolve, reject) => {
    upload = http.request(`${base}/api/media?kind=audio&name=sound.mp3`, { method: 'POST', headers: { ...headers(other), 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length } }, (response) => {
      let body = ''; response.on('data', (chunk) => { body += chunk; }); response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(body) }));
    }); upload.on('error', reject); upload.write(audio.subarray(0, 100000));
  });
  let preparing;
  for (let retry = 0; retry < 50; retry++) { preparing = (await api('/api/status')).data.state; if (preparing.preparation?.progress === 50) break; await pause(20); }
  assert.equal(preparing.preparation.progress, 50); assert.equal(preparing.ownerId, other.id); assert.equal(preparing.allReady, false);
  assert.equal((await api('/api/source/claim', winner, {})).status, 423);
  upload.end(audio.subarray(100000));
  const loaded = await completion; assert.equal(loaded.status, 200); assert.equal(loaded.data.state.asset.type, 'audio/mpeg');
  const audioStream = await fetch(`${base}/api/media/stream?v=${loaded.data.state.asset.version}`);
  assert.deepEqual(Buffer.from(await audioStream.arrayBuffer()), audio);
});
