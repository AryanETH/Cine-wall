'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}

test('hosted server separates sessions, signals only within a room, and stores no movie bytes for direct source', { timeout: 30000 }, async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cinewall-hosting-test-'));
  const port = await freePort(), base = `http://127.0.0.1:${port}`, roomA = randomUUID(), roomB = randomUUID(), peerA = randomUUID(), peerB = randomUUID();
  const server = spawn(process.execPath, ['server.js'], { cwd: root, windowsHide: true, env: { ...process.env, PORT: String(port), CINEWALL_HOSTED: '1', CINEWALL_CACHE_DIR: temporary }, stdio: ['ignore', 'pipe', 'pipe'] });
  const streams = []; let output = '';
  server.stdout.on('data', (data) => { output += data; }); server.stderr.on('data', (data) => { output += data; });
  t.after(async () => {
    for (const stream of streams) stream.destroy();
    server.kill(); await new Promise((resolve) => server.exitCode !== null ? resolve() : server.once('close', resolve));
    if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('cinewall-hosting-test-')) fs.rmSync(temporary, { recursive: true, force: true });
  });
  for (let attempt = 0; attempt < 100 && !output.includes(`http://localhost:${port}/`); attempt++) await pause(50);
  assert.ok(output.includes(`http://localhost:${port}/`), output);
  async function api(route, room, body, headers = {}) {
    const url = new URL(base + route); if (room) url.searchParams.set('room', room);
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await api('/api/status', '', null, { 'X-Forwarded-Host': 'localhost:8080' })).status, 400, 'Public mode cannot be bypassed with an internal Host');
  assert.equal((await api('/api/status', '../bad')).status, 400);
  const info = await api('/api/info', roomA);
  assert.equal(info.status, 200); assert.equal(info.data.hosted, true); assert.equal(info.data.addresses.length, 0); assert.equal(info.data.room, roomA);

  async function events(room, peer) {
    let request;
    const messages = [];
    await new Promise((resolve, reject) => {
      request = http.get(`${base}/events?room=${room}&peer=${peer}`, (response) => {
        assert.equal(response.statusCode, 200);
        let data = ''; response.on('data', (chunk) => {
          data += chunk;
          let separator;
          while ((separator = data.indexOf('\n\n')) !== -1) {
            const frame = data.slice(0, separator); data = data.slice(separator + 2);
            const type = /^event: (.+)$/m.exec(frame)?.[1], payload = /^data: (.+)$/m.exec(frame)?.[1];
            if (type && payload) messages.push({ type, data: JSON.parse(payload) });
          }
          resolve();
        });
      }); request.on('error', reject); streams.push(request);
    });
    return messages;
  }
  const viewerA = await events(roomA, peerA), viewerB = await events(roomA, peerB);
  const signal = await api('/api/peer-signal', roomA, { from: peerA, to: peerB, description: { type: 'offer', sdp: 'test-offer' } });
  assert.equal(signal.status, 200);
  for (let retry = 0; retry < 20 && !viewerB.some((event) => event.type === 'peer-signal'); retry++) await pause(10);
  assert.ok(viewerB.some((event) => event.type === 'peer-signal' && event.data.from === peerA));
  assert.ok(!viewerA.some((event) => event.type === 'peer-signal'));
  assert.equal((await api('/api/peer-signal', roomB, { from: peerA, to: peerB, candidate: {} })).status, 403);
  const metadata = { peerId: peerA, name: '12gb-original.mkv', size: 12 * 1024 ** 3, type: 'video/x-matroska', fingerprint: 'a'.repeat(64), duration: 7200 };
  const published = await api('/api/local-source', roomA, metadata);
  assert.equal(published.status, 200); assert.equal(published.data.state.asset.source, 'peer'); assert.equal(published.data.state.asset.size, metadata.size);
  const listing = fs.readdirSync(path.join(temporary, 'rooms', roomA));
  assert.deepEqual(listing, ['session.json']);
  assert.ok(fs.statSync(path.join(temporary, 'rooms', roomA, 'session.json')).size < 10000);
  assert.equal((await api('/api/status', roomB)).data.state.asset, null);
  const play = await api('/api/command', roomA, { type: 'play', position: 0 });
  assert.equal(play.status, 200); assert.ok(play.data.command.executeAt - play.data.command.serverTime <= 100);
  const audio = await api('/api/command', roomA, { type: 'screen-audio', screen: 2, volume: .37 });
  assert.equal(audio.data.command.audioSettings['2'].volume, .37); assert.ok(audio.data.command.executeAt - audio.data.command.serverTime <= 5);
  assert.equal((await api('/api/status', roomB)).data.state.playing, false);
  console.log('Hosted isolation and signaling verified using HTTP clients; no display/browser testing or user movie mutation.');
});
