'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const createMicRoom = require('../mic-room');

function fixture() {
  let time = 0;
  const service = createMicRoom({ identity: req => req.device, readJson: async req => req.body, json: (res, status, data) => Object.assign(res, { status, data }), now: () => time });
  const device = () => ({ id: randomUUID(), hash: randomUUID() });
  async function call(route, owner, body, method = 'POST') {
    const res = { messages: [], writeHead() {}, write(text) { this.messages.push(text); }, end() { this.destroyed = true; } };
    try { await service.handle({ device: owner, body, method, on() {} }, res, new URL(route, 'http://localhost')); }
    catch (e) { res.status = e.status || 400; res.data = { error: e.message }; }
    return res;
  }
  async function join(role, slot) {
    const owner = device(), peerId = randomUUID();
    const result = await call('/api/mic/join', owner, { peerId, role, slot });
    return { owner, peerId, result };
  }
  return { service, device, call, join, tick: n => { time += n; } };
}

test('one phone and three unique speakers; duplicate devices and forged identities cannot join', async () => {
  const f = fixture(), phone = await f.join('phone');
  assert.equal(phone.result.status, 200);
  assert.equal((await f.join('phone')).result.status, 409);
  for (const slot of [1, 2, 3]) {
    if (slot > 1) await f.call('/api/mic/laptops', phone.owner, { action: 'add' });
    assert.equal((await f.join('speaker', slot)).result.status, 200);
  }
  assert.equal((await f.join('speaker', 4)).result.status, 400);
  assert.equal((await f.join('speaker', 0)).result.status, 400);
  assert.equal((await f.join('speaker', 1)).result.status, 409);
  assert.equal((await f.call('/api/mic/join', phone.owner, { peerId: randomUUID(), role: 'speaker', slot: 1 })).status, 409);
  assert.equal((await f.call('/api/mic/join', f.device(), { peerId: phone.peerId, role: 'phone' })).status, 403);
  assert.equal((await f.call('/api/mic/state', null, null, 'GET')).data.peers.length, 4);
  await f.call('/api/mic/leave', phone.owner, { peerId: phone.peerId });
  assert.equal((await f.join('phone')).result.status, 200);
  f.service.close();
});

test('signals need event tokens, identities, opposite roles and current room generation', async () => {
  const f = fixture(), phone = await f.join('phone'), speaker = await f.join('speaker', 1);
  await f.call('/api/mic/laptops', phone.owner, { action: 'add' });
  const other = await f.join('speaker', 2);
  const eventsUrl = `/mic-events?peer=${speaker.peerId}&token=${speaker.result.data.token}`;
  assert.equal((await f.call(eventsUrl.replace(speaker.result.data.token, 'forged'), null, null, 'GET')).status, 403);
  const events = await f.call(eventsUrl, null, null, 'GET');
  const body = { peerId: phone.peerId, to: speaker.peerId, version: phone.result.data.state.version, description: { type: 'offer', sdp: 'audio-offer' } };
  assert.equal((await f.call('/api/mic/signal', phone.owner, body)).status, 200);
  assert.ok(events.messages.some(m => m.includes('mic-signal') && m.includes('audio-offer')));
  assert.equal((await f.call('/api/mic/signal', speaker.owner, body)).status, 403);
  assert.equal((await f.call('/api/mic/signal', other.owner, { ...body, peerId: other.peerId })).status, 409);
  assert.equal((await f.call('/api/mic/signal', phone.owner, { ...body, version: randomUUID() })).status, 409);
  assert.equal((await f.call('/api/mic/signal', phone.owner, { ...body, description: { type: 'bad', sdp: '' } })).status, 400);
  assert.equal((await f.call('/api/mic/signal', phone.owner, { ...body, description: null })).status, 400);
  assert.equal((await f.call('/api/mic/signal', phone.owner, { ...body, description: null, candidate: { candidate: 'host-ice' } })).status, 200);
  const snapshot = (await f.call('/api/mic/state', null, null, 'GET')).data;
  assert.equal(JSON.stringify(snapshot).includes(speaker.result.data.token), false);
  assert.equal(JSON.stringify(snapshot).includes(speaker.owner.hash), false);
  await f.call('/api/mic/leave', speaker.owner, { peerId: speaker.peerId });
  assert.equal((await f.call('/api/mic/signal', phone.owner, body)).status, 409);
  f.service.close();
});

test('only the phone controls live state; dropped devices expire and isolated rooms stay separate', async () => {
  const f = fixture(), phone = await f.join('phone'), speaker = await f.join('speaker', 1);
  assert.equal((await f.call('/api/mic/live', speaker.owner, { peerId: speaker.peerId, live: true })).status, 403);
  assert.equal((await f.call('/api/mic/live', phone.owner, { peerId: phone.peerId, live: 'true' })).status, 400);
  const live = await f.call('/api/mic/live', phone.owner, { peerId: phone.peerId, live: true });
  assert.equal(live.data.peers.find(p => p.role === 'phone').live, true);
  const another = fixture();
  assert.equal((await another.call('/api/mic/state', null, null, 'GET')).data.peers.length, 0);
  f.tick(20000); await f.call('/api/mic/ping', speaker.owner, { peerId: speaker.peerId, status: 'connected' });
  f.tick(11000); f.service.pulse();
  assert.equal((await f.call('/api/mic/state', null, null, 'GET')).data.peers.length, 1);
  assert.equal((await f.join('phone')).result.status, 200);
  f.tick(31000); f.service.pulse(); assert.equal(f.service.idle(), true);
  f.service.close(); another.service.close();
});

test('laptop slots add up to three, remove connected speakers, block automatic rejoin and preserve other devices', async () => {
  const f = fixture(), phone = await f.join('phone'), one = await f.join('speaker', 1);
  assert.deepEqual(phone.result.data.state.laptops, [1]);
  assert.equal((await f.join('speaker', 2)).result.status, 410);
  assert.deepEqual((await f.call('/api/mic/laptops', phone.owner, { action: 'add' })).data.laptops, [1, 2]);
  const two = await f.join('speaker', 2);
  assert.deepEqual((await f.call('/api/mic/laptops', phone.owner, { action: 'add' })).data.laptops, [1, 2, 3]);
  assert.equal((await f.call('/api/mic/laptops', phone.owner, { action: 'add' })).status, 409);
  const events = await f.call(`/mic-events?peer=${two.peerId}&token=${two.result.data.token}`, null, null, 'GET');
  const removed = await f.call('/api/mic/laptops', phone.owner, { action: 'remove', slot: 2 });
  assert.deepEqual(removed.data.laptops, [1, 3]);
  assert.equal(removed.data.peers.some(p => p.peerId === two.peerId), false);
  assert.ok(removed.data.peers.some(p => p.peerId === one.peerId));
  assert.ok(events.messages.some(m => m.includes('mic-removed'))); assert.equal(events.destroyed, true);
  await f.call('/api/mic/laptops', phone.owner, { action: 'add' });
  assert.equal((await f.call('/api/mic/join', two.owner, { peerId: two.peerId, role: 'speaker', slot: 2 })).status, 410);
  assert.equal((await f.join('speaker', 2)).result.status, 200, 'a fresh tab may explicitly rejoin a restored slot');
  assert.equal((await f.call('/api/mic/laptops', phone.owner, { action: 'remove', slot: 4 })).status, 400);
  for (const slot of [1, 2, 3]) await f.call('/api/mic/laptops', phone.owner, { action: 'remove', slot });
  const empty = (await f.call('/api/mic/state', null, null, 'GET')).data;
  assert.deepEqual(empty.laptops, []); assert.equal(empty.peers.length, 1);
  assert.deepEqual((await f.call('/api/mic/laptops', phone.owner, { action: 'add' })).data.laptops, [1]);
  f.service.close();
});
