'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const root = path.resolve(__dirname, '..');

test('mic pages, scoped APIs, live event signaling and room isolation work through the actual server', { timeout: 20000 }, async t => {
  const reservation = net.createServer(); await new Promise(r => reservation.listen(0, '127.0.0.1', r));
  const port = reservation.address().port; await new Promise(r => reservation.close(r));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cinewall-mic-test-'));
  const base = `http://127.0.0.1:${port}`, room = randomUUID(), otherRoom = randomUUID();
  const phone = { id: randomUUID(), key: randomUUID(), peerId: randomUUID() }, speaker = { id: randomUUID(), key: randomUUID(), peerId: randomUUID() };
  const identityHeaders = { 'X-CineWall-Device': phone.id, 'X-CineWall-Key': phone.key };
  const speakerHeaders = { 'X-CineWall-Device': speaker.id, 'X-CineWall-Key': speaker.key };
  require('./room-fixture').seedRoom(temporary, room, identityHeaders, 'mic', [speakerHeaders]);
  require('./room-fixture').seedRoom(temporary, otherRoom, identityHeaders, 'mic');
  const proc = spawn(process.execPath, ['server.js'], { cwd: root, windowsHide: true, env: { ...process.env, PORT: String(port), CINEWALL_HOSTED: '1', CINEWALL_CACHE_DIR: temporary }, stdio: ['ignore', 'pipe', 'pipe'] });
  const requests = []; let output = ''; proc.stdout.on('data', d => { output += d; }); proc.stderr.on('data', d => { output += d; });
  t.after(async () => { requests.forEach(r => r.destroy()); proc.kill(); await new Promise(r => proc.exitCode !== null ? r() : proc.once('close', r)); if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('cinewall-mic-test-')) fs.rmSync(temporary, { recursive: true, force: true }); });
  for (let i = 0; i < 100 && !output.includes('Start:'); i++) await new Promise(r => setTimeout(r, 50));
  assert.match(output, /Start:/);

  async function api(route, device, body, roomId = room) {
    const response = await fetch(`${base}${route}?room=${roomId}`, { headers: { 'Content-Type': 'application/json', 'X-CineWall-Device': device.id, 'X-CineWall-Key': device.key }, ...(body ? { method: 'POST', body: JSON.stringify({ peerId: device.peerId, ...body }) } : {}) });
    return { status: response.status, data: await response.json() };
  }
  for (const route of ['/mic.html', '/mic.js', '/mic.css', '/mic-setup.html', '/assets/mic-speakers.svg']) assert.equal((await fetch(base + route)).status, 200);
  const home = await (await fetch(base)).text(); assert.match(home, /href="\/connect.html\?mode=mic"/); assert.doesNotMatch(home, /Stream YouTube/);
  assert.equal((await fetch(base + '/mic-events')).status, 400, 'hosted event streams require a room');
  assert.equal((await api('/api/mic/join', phone, { role: 'phone' })).status, 200);
  const joined = await api('/api/mic/join', speaker, { role: 'speaker', slot: 1 }); assert.equal(joined.status, 200);
  let messages = '';
  await new Promise((resolve, reject) => {
    const request = http.get(`${base}/mic-events?room=${room}&peer=${speaker.peerId}&token=${joined.data.token}&ticket=${'b'.repeat(48)}`, res => { assert.equal(res.statusCode, 200); res.on('data', d => { messages += d; resolve(); }); });
    request.on('error', reject); requests.push(request);
  });
  assert.equal((await api('/api/mic/live', phone, { live: true })).status, 200);
  assert.equal((await api('/api/mic/signal', phone, { to: speaker.peerId, version: joined.data.state.version, description: { type: 'offer', sdp: 'test-audio-offer' } })).status, 200);
  for (let i = 0; i < 30 && !messages.includes('test-audio-offer'); i++) await new Promise(r => setTimeout(r, 20));
  assert.match(messages, /test-audio-offer/);
  assert.equal((await api('/api/mic/state', phone)).data.peers.length, 2);
  assert.equal((await api('/api/mic/state', phone, undefined, otherRoom)).data.peers.length, 0);
  assert.equal((await api('/api/mic/signal', phone, { to: speaker.peerId, version: joined.data.state.version, candidate: { candidate: 'test' } }, otherRoom)).status, 403);
  assert.equal((await fetch(`${base}/api/mic/laptops?room=${room}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"add"}' })).status, 403);
  assert.deepEqual((await api('/api/mic/laptops', phone, { action: 'add' })).data.laptops, [1, 2]);
  assert.deepEqual((await api('/api/mic/laptops', phone, { action: 'add' })).data.laptops, [1, 2, 3]);
  assert.equal((await api('/api/mic/laptops', phone, { action: 'add' })).status, 409);
  const removed = await api('/api/mic/laptops', phone, { action: 'remove', slot: 1 });
  assert.equal(removed.data.peers.some(p => p.peerId === speaker.peerId), false);
  assert.equal((await api('/api/mic/join', speaker, { role: 'speaker', slot: 1 })).status, 403, 'removed room membership is revoked');
  assert.deepEqual((await api('/api/mic/laptops', phone, { action: 'add' })).data.laptops, [1, 2, 3]);
  assert.equal((await api('/api/mic/join', speaker, { role: 'speaker', slot: 1 })).status, 403, 'removed peer cannot automatically rejoin after a slot is restored');
  const rejoin = await fetch(base + '/api/rooms/join', { method: 'POST', headers: { ...speakerHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ room, screen: 1 }) });
  assert.equal(rejoin.status, 200, 'an explicit room join can obtain a new membership');
  speaker.peerId = randomUUID();
  assert.equal((await api('/api/mic/join', speaker, { role: 'speaker', slot: 1 })).status, 200);
  assert.equal((await api('/api/mic/leave', phone, {})).status, 200);
  assert.equal((await api('/api/mic/state', speaker)).data.peers.length, 1);
});
