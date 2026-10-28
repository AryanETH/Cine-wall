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
  assert.equal(rooms.join(request(), { code: first.code, mode: 'audio' }).screen, 3, 'a room code joins the active mode from any option');
  assert.throws(() => rooms.join(request(), { code: first.code }), { status: 409 });
});
test('one room keeps its ID, tickets and admin across every mode, including overflow and phones', t => {
  const { rooms, root } = fixture(t), admin = request(), created = rooms.create(admin, 'audio'), guests = [];
  for (let n = 0; n < 4; n++) { const req = request(); guests.push({ req, joined: rooms.join(req, { code: created.code }) }); }
  const record = rooms.lookup(created.room);
  assert.throws(() => rooms.switchMode(record, guests[0].req, 'video'), { status: 403 });
  for (const mode of ['video', 'share', 'mic', 'audio']) {
    rooms.switchMode(record, admin, mode);
    assert.equal(rooms.result(record, record.members[0]).code, created.code);
    for (const { req, joined } of guests) {
      const resumed = rooms.resume(req, { room: created.room, ticket: joined.ticket });
      assert.equal(resumed.mode, mode); assert.equal(resumed.ticket, joined.ticket); assert.equal(resumed.admin, false);
      if (mode === 'video' && joined.screen > 3 || mode === 'mic' && joined.screen > 4) { assert.equal(resumed.waiting, true); assert.equal(resumed.path, '/room.html'); }
    }
  }
  assert.equal(rooms.resume(guests[3].req, { room: created.room, ticket: guests[3].joined.ticket }).waiting, false);
  rooms.switchMode(record, admin, 'mic');
  const phone = request(), joinedPhone = rooms.join(phone, { code: created.code, role: 'phone', deviceKind: 'phone' });
  rooms.switchMode(record, admin, 'video'); assert.equal(rooms.resume(phone, { room: created.room, ticket: joinedPhone.ticket }).waiting, true);
  rooms.switchMode(record, admin, 'mic'); assert.match(rooms.resume(phone, { room: created.room, ticket: joinedPhone.ticket }).path, /role=phone/);
  const persisted = createRooms(root), restored = persisted.resume(phone, { room: created.room, ticket: joinedPhone.ticket });
  assert.equal(restored.code, created.code); assert.equal(restored.mode, 'mic'); assert.equal(restored.waiting, false);
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
test('unknown IDs never allocate rooms; creation and guessing are bounded while issued links remain durable', t => {
  let now = 1000; const { rooms } = fixture(t, { now: () => now, limit: 2 });
  for (let i=0;i<100;i++) assert.throws(() => rooms.lookup(randomUUID()), { status: 404 });
  assert.equal(rooms.records.size, 0);
  const admin = request(), first = rooms.create(admin, 'video'); rooms.create(request(), 'audio');
  assert.throws(() => rooms.create(request(), 'video'), { status: 503 });
  const guessing = request(); for (let i=0;i<30;i++) assert.throws(() => rooms.join(guessing, { code: 'WRONG-ID' }), { status: 404 });
  assert.throws(() => rooms.join(guessing, { code: first.code }), { status: 429 });
  now += 365*24*60*60*1000; assert.equal(rooms.prune().length, 0); assert.equal(rooms.records.size, 2);
  assert.equal(rooms.lookup(first.room).id, first.room);
});

test('admin and guest memberships survive a year idle, pruning and a registry restart', t => {
  let now = Date.now(); const { root, rooms } = fixture(t, { now: () => now });
  const admin = request(), guest = request(), created = rooms.create(admin, 'video');
  const joined = rooms.join(guest, { room: created.room, screen: 2 });
  now += 365*24*60*60*1000; rooms.prune();
  const restored = createRooms(root, { now: () => now });
  assert.equal(restored.resume(admin, { room: created.room, ticket: 'stale' }).admin, true);
  assert.equal(restored.resume(guest, { room: created.room, ticket: joined.ticket }).screen, 2);
  assert.equal(restored.lookup(created.code).id, created.room);
  assert.throws(() => restored.resume(request(), { room: created.room, ticket: 'stale' }), { status: 403 });
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
