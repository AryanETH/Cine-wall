'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const createRooms = require('../rooms');
const request = () => ({ headers: { 'x-cinewall-device': randomUUID(), 'x-cinewall-key': randomUUID() }, socket: { remoteAddress: randomUUID() } });
function fixture(t, options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cinewall-registry-test-'));
  t.after(() => { if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('cinewall-registry-test-')) fs.rmSync(root, { recursive: true, force: true }); });
  return { root, rooms: createRooms(root, options) };
}
test('short IDs are unique, persistent and case insensitive; screens are assigned without granting admin', t => {
  const { root, rooms } = fixture(t), admin = request();
  const first = rooms.create(admin, 'video'), second = rooms.create(admin, 'audio');
  assert.match(first.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/); assert.notEqual(first.code, second.code);
  const guest = request(), joined = rooms.join(guest, { code: first.code.toLowerCase().replace('-', ''), mode: 'video' });
  assert.equal(joined.screen, 2); assert.equal(joined.admin, false); assert.match(joined.path, /screen=2/);
  assert.equal(rooms.join(guest, { code: first.code }).screen, 2, 'joining again keeps the same slot');
  assert.throws(() => rooms.requireAdmin(rooms.lookup(first.room), guest), { status: 403 });
  assert.equal(createRooms(root).lookup(first.code).id, first.room);
  assert.throws(() => rooms.join(request(), { code: first.code, mode: 'audio' }), { status: 409 });
  assert.equal(rooms.join(request(), { code: first.code }).screen, 3);
  assert.throws(() => rooms.join(request(), { code: first.code }), { status: 409 });
});
test('room recovery requires the separate key, revokes the previous admin and preserves the ID', t => {
  const { rooms } = fixture(t), original = request(), created = rooms.create(original, 'audio'), replacement = request();
  assert.throws(() => rooms.recover(replacement, { code: created.code, recoveryKey: 'wrong' }), { status: 403 });
  const recovered = rooms.recover(replacement, { code: created.code, recoveryKey: created.recoveryKey });
  assert.equal(recovered.room, created.room); assert.equal(recovered.admin, true); assert.equal(recovered.screen, 1);
  assert.throws(() => rooms.authorize(original, new URL('http://local/api/status'), rooms.lookup(created.room)), { status: 403 });
  assert.equal(rooms.requireAdmin(rooms.lookup(created.room), replacement).id, replacement.headers['x-cinewall-device']);
  const stranger = request(); stranger.headers = {};
  assert.throws(() => rooms.authorize(stranger, new URL('http://local/api/status?ticket=wrong'), rooms.lookup(created.room)), { status: 403 });
});
test('microphone and sharing joins allocate proper roles and bounded receiver slots', t => {
  const { rooms } = fixture(t), admin = request(), mic = rooms.create(admin, 'mic'), share = rooms.create(admin, 'share');
  assert.match(rooms.join(request(), { code: mic.code, role: 'phone' }).path, /role=phone/);
  assert.throws(() => rooms.join(request(), { code: mic.code, role: 'phone' }), { status: 409 });
  for (const n of [1,2,3]) assert.equal(rooms.join(request(), { code: mic.code }).screen, n);
  assert.throws(() => rooms.join(request(), { code: mic.code }), { status: 409 });
  for (let n=1;n<=10;n++) assert.equal(rooms.join(request(), { code: share.code }).screen, n);
  assert.throws(() => rooms.join(request(), { code: share.code }), { status: 409 });
});
test('unknown IDs never allocate rooms; creation, guessing, capacity and expiry are bounded', t => {
  let now = 1000; const { rooms } = fixture(t, { now: () => now, limit: 2 });
  for (let i=0;i<100;i++) assert.throws(() => rooms.lookup(randomUUID()), { status: 404 });
  assert.equal(rooms.records.size, 0);
  const admin = request(), first = rooms.create(admin, 'video'); rooms.create(request(), 'audio');
  assert.throws(() => rooms.create(request(), 'video'), { status: 503 });
  const guessing = request(); for (let i=0;i<30;i++) assert.throws(() => rooms.join(guessing, { code: 'WRONG-ID' }), { status: 404 });
  assert.throws(() => rooms.join(guessing, { code: first.code }), { status: 429 });
  now += 24*60*60*1000+1; assert.equal(rooms.prune().length, 2); assert.equal(rooms.records.size, 0);
});

test('fake edge and IP headers do not bypass limits when proxy trust is disabled', t => {
  const oldTrust = process.env.CINEWALL_TRUST_PROXY;
  process.env.CINEWALL_TRUST_PROXY = '0';
  t.after(() => { if (oldTrust === undefined) delete process.env.CINEWALL_TRUST_PROXY; else process.env.CINEWALL_TRUST_PROXY = oldTrust; });
  const { rooms } = fixture(t);
  for (let n=1;n<=12;n++) { const req = request(); req.socket.remoteAddress = '10.0.0.2'; req.headers['x-real-ip'] = `198.51.100.${n}`; req.headers['x-railway-edge'] = 'fake-edge'; rooms.create(req, 'video'); }
  const forged = request(); forged.socket.remoteAddress = '10.0.0.2'; forged.headers['x-real-ip'] = '198.51.100.99'; forged.headers['x-railway-edge'] = 'fake-edge';
  assert.throws(() => rooms.create(forged, 'video'), { status: 429 });
});
