'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const createSharing = require('../screen-sharing');

function fixture() {
  const service = createSharing({ identity: req => req.device, readJson: async req => req.body, json: (res, status, data) => Object.assign(res, { status, data }) });
  const device = () => ({ id: randomUUID(), hash: randomUUID() });
  function response() { return { messages: [], writeHead() {}, write(text) { this.messages.push(text); }, end() { this.destroyed = true; } }; }
  async function call(route, owner, body, method = 'POST') {
    const res = response();
    try { await service.handle({ device: owner, body, method, on() {} }, res, new URL(route, 'http://localhost')); }
    catch (error) { res.status = error.status || 400; res.data = { error: error.message }; }
    return res;
  }
  return { service, device, call };
}

test('screen sharing elects one presenter and rejects forged peers and viewer settings', async () => {
  const { service, device, call } = fixture(), presenter = device(), other = device();
  const hostId = randomUUID(), otherId = randomUUID(), viewerId = randomUUID();
  await call('/api/share/join', presenter, { peerId: hostId, screen: 0 });
  await call('/api/share/join', other, { peerId: otherId, screen: 0 });
  await call('/api/share/join', other, { peerId: viewerId, screen: 2 });
  const start = await call('/api/share/start', presenter, { peerId: hostId, name: 'Demo window' });
  assert.equal(start.status, 200); assert.equal(start.data.source.name, 'Demo window');
  assert.equal((await call('/api/share/start', other, { peerId: otherId })).status, 423);
  assert.equal((await call('/api/share/start', other, { peerId: viewerId })).status, 400);
  assert.equal((await call('/api/share/settings', other, { peerId: viewerId, layout: 'wall' })).status, 423);
  assert.equal((await call('/api/share/stop', other, { peerId: hostId })).status, 403);
  assert.equal((await call('/api/share/settings', presenter, { peerId: hostId, layout: 'wall' })).status, 400);
  const changed = await call('/api/share/settings', presenter, { peerId: hostId, count: 3, layout: 'mirror', flip: true, quality: '720p', pointers: false });
  assert.deepEqual(changed.data.settings, { count: 3, layout: 'mirror', flip: true, quality: '720p', pointers: false });
  assert.equal((await call('/api/share/settings', presenter, { peerId: hostId, count: 11 })).status, 400);
  assert.equal((await call('/api/share/stop', presenter, { peerId: hostId })).data.source, null);
  assert.equal((await call('/api/share/start', other, { peerId: otherId })).status, 200);
  service.close();
});

test('signaling is token protected, source scoped and ends for removed screens or stopped sessions', async () => {
  const { service, device, call } = fixture(), host = device(), viewer = device();
  const hostId = randomUUID(), viewId = randomUUID();
  await call('/api/share/join', host, { peerId: hostId, screen: 0 });
  const joined = await call('/api/share/join', viewer, { peerId: viewId, screen: 2 });
  assert.equal((await call(`/share-events?peer=${viewId}&token=wrong`, viewer, undefined, 'GET')).status, 403);
  const receiver = await call(`/share-events?peer=${viewId}&token=${joined.data.token}`, viewer, undefined, 'GET');
  const started = await call('/api/share/start', host, { peerId: hostId });
  const signal = { peerId: hostId, to: viewId, version: started.data.source.version, description: { type: 'offer', sdp: 'test-sdp' } };
  assert.equal((await call('/api/share/signal', host, signal)).status, 200);
  assert.ok(receiver.messages.some(message => message.includes('share-signal') && message.includes('test-sdp')));
  assert.equal((await call('/api/share/signal', host, { ...signal, version: randomUUID() })).status, 409);
  await call('/api/share/settings', host, { peerId: hostId, count: 1 });
  assert.equal((await call('/api/share/signal', host, signal)).status, 409);
  const state = (await call('/api/share/state', viewer, undefined, 'GET')).data;
  assert.equal(JSON.stringify(state).includes(joined.data.token), false, 'viewer tokens must not be broadcast');
  await call('/api/share/leave', host, { peerId: hostId });
  assert.equal((await call('/api/share/state', viewer, undefined, 'GET')).data.source, null);
  const another = fixture();
  assert.equal((await another.call('/api/share/state', viewer, undefined, 'GET')).data.peers.length, 0, 'rooms have independent sharing state');
  service.close(); another.service.close();
});

test('room call starts with devices off, authenticates participants and blocks duplicate laptop tabs', async () => {
  const { service, device, call } = fixture(), first = device(), second = device();
  const firstId = randomUUID(), secondId = randomUUID(), duplicateId = randomUUID();
  await call('/api/share/join', first, { peerId: firstId, screen: 0 });
  await call('/api/share/join', first, { peerId: duplicateId, screen: 1 });
  await call('/api/share/join', second, { peerId: secondId, screen: 2 });
  const joined = await call('/api/share/call-media', first, { peerId: firstId, joined: true, mic: false, camera: false });
  assert.equal(joined.status, 200);
  assert.equal(joined.data.participants.length, 1);
  assert.equal(joined.data.participants[0].mic, false);
  assert.equal(joined.data.participants[0].camera, false);
  assert.equal((await call('/api/share/call-media', second, { peerId: firstId, joined: true, mic: true, camera: true })).status, 403);
  assert.equal((await call('/api/share/call-media', first, { peerId: duplicateId, joined: true, mic: true, camera: true })).status, 409);
  assert.equal((await call('/api/share/call-media', second, { peerId: secondId, joined: true, mic: 'true', camera: false })).status, 400);
  await call('/api/share/call-media', first, { peerId: firstId, joined: false, mic: true, camera: true });
  assert.equal((await call('/api/share/call-media', first, { peerId: duplicateId, joined: true, mic: false, camera: true })).status, 200);
  service.close();
});

test('two-way call signaling works without screen capture, survives stop and ends on removal or leave', async () => {
  const { service, device, call } = fixture(), host = device(), guest = device();
  const hostId = randomUUID(), guestId = randomUUID();
  const hostJoin = await call('/api/share/join', host, { peerId: hostId, screen: 0 });
  const guestJoin = await call('/api/share/join', guest, { peerId: guestId, screen: 2 });
  const hostEvents = await call(`/share-events?peer=${hostId}&token=${hostJoin.data.token}`, host, undefined, 'GET');
  const guestEvents = await call(`/share-events?peer=${guestId}&token=${guestJoin.data.token}`, guest, undefined, 'GET');
  await call('/api/share/call-media', host, { peerId: hostId, joined: true, mic: true, camera: true });
  const joined = await call('/api/share/call-media', guest, { peerId: guestId, joined: true, mic: true, camera: false });
  const signal = { peerId: hostId, to: guestId, version: joined.data.callVersion, description: { type: 'offer', sdp: 'call-sdp' } };
  assert.equal((await call('/api/share/call-signal', host, signal)).status, 200);
  assert.ok(guestEvents.messages.some(message => message.includes('call-signal') && message.includes('call-sdp')));
  assert.equal((await call('/api/share/call-signal', guest, { ...signal, peerId: guestId, to: hostId, description: { type: 'answer', sdp: 'answer-sdp' } })).status, 200);
  assert.ok(hostEvents.messages.some(message => message.includes('answer-sdp')));
  assert.equal((await call('/api/share/call-signal', host, { ...signal, version: randomUUID() })).status, 409);
  assert.equal((await call('/api/share/call-signal', host, { ...signal, description: { type: 'offer', sdp: 'x'.repeat(64001) } })).status, 400);
  const otherRoom = fixture();
  assert.equal((await otherRoom.call('/api/share/call-signal', host, signal)).status, 403);
  await call('/api/share/start', host, { peerId: hostId });
  await call('/api/share/stop', host, { peerId: hostId });
  assert.equal((await call('/api/share/call-signal', host, signal)).status, 200, 'screen stop must not stop the call');
  await call('/api/share/settings', host, { peerId: hostId, count: 1 });
  assert.equal((await call('/api/share/call-signal', host, signal)).status, 409);
  assert.equal((await call('/api/share/call-media', guest, { peerId: guestId, joined: true, mic: true, camera: false })).status, 409);
  const state = (await call('/api/share/state', host, undefined, 'GET')).data;
  assert.deepEqual(state.participants.map(peer => peer.peerId), [hostId]);
  assert.equal(JSON.stringify(state).includes(hostJoin.data.token), false);
  await call('/api/share/leave', host, { peerId: hostId });
  assert.equal((await call('/api/share/state', guest, undefined, 'GET')).data.participants.length, 0);
  service.close(); otherRoom.service.close();
});

test('invited room dashboard can receive the whole shared screen without becoming its owner', async () => {
  const { service, device, call } = fixture(), presenter = device(), guest = device();
  const hostId = randomUUID(), guestId = randomUUID();
  await call('/api/share/join', presenter, { peerId: hostId, screen: 0 });
  const joined = await call('/api/share/join', guest, { peerId: guestId, screen: 0 });
  const events = await call(`/share-events?peer=${guestId}&token=${joined.data.token}`, guest, undefined, 'GET');
  const started = await call('/api/share/start', presenter, { peerId: hostId });
  assert.ok(started.data.receivers.some(peer => peer.peerId === guestId));
  assert.ok(!started.data.receivers.some(peer => peer.peerId === hostId));
  assert.equal((await call('/api/share/signal', presenter, { peerId: hostId, to: guestId, version: started.data.source.version, description: { type: 'offer', sdp: 'mirror-offer' } })).status, 200);
  assert.ok(events.messages.some(message => message.includes('mirror-offer')));
  assert.equal((await call('/api/share/stop', guest, { peerId: guestId })).status, 423);
  service.close();
});

test('small room call is capped at four devices', async () => {
  const { service, device, call } = fixture();
  for (let number = 0; number < 5; number++) {
    const person = device(), peerId = randomUUID();
    await call('/api/share/join', person, { peerId, screen: 0 });
    const result = await call('/api/share/call-media', person, { peerId, joined: true, mic: false, camera: false });
    assert.equal(result.status, number < 4 ? 200 : 409);
  }
  service.close();
});

test('ten numbered screens receive one source and reject screen eleven', async () => {
  const { service, device, call } = fixture(), presenter = device(), hostId = randomUUID();
  const hostJoined = await call('/api/share/join', presenter, { peerId: hostId, screen: 0 });
  const hostEvents = await call(`/share-events?peer=${hostId}&token=${hostJoined.data.token}`, presenter, undefined, 'GET');
  await call('/api/share/settings', presenter, { peerId: hostId, count: 10 });
  const receivers = [];
  for (let number = 1; number <= 10; number++) {
    const person = device(), peerId = randomUUID();
    const joined = await call('/api/share/join', person, { peerId, screen: number });
    assert.equal(joined.status, 200);
    const events = await call(`/share-events?peer=${peerId}&token=${joined.data.token}`, person, undefined, 'GET');
    receivers.push({ person, peerId, events });
  }
  assert.equal((await call('/api/share/join', device(), { peerId: randomUUID(), screen: 11 })).status, 400);
  const started = await call('/api/share/start', presenter, { peerId: hostId, name: 'Ten-screen demo', audio: true });
  assert.equal(started.data.receivers.length, 10);
  for (const receiver of receivers) {
    assert.equal((await call('/api/share/signal', presenter, { peerId: hostId, to: receiver.peerId, version: started.data.source.version, description: { type: 'offer', sdp: 'same-source' } })).status, 200);
    assert.ok(receiver.events.messages.some(message => message.includes('share-signal') && message.includes('same-source')));
    assert.equal((await call('/api/share/signal', receiver.person, { peerId: receiver.peerId, to: hostId, version: started.data.source.version, description: { type: 'answer', sdp: receiver.peerId } })).status, 200);
  }
  assert.equal(hostEvents.messages.filter(message => message.includes('share-signal')).length, 10);
  await call('/api/share/settings', presenter, { peerId: hostId, count: 9 });
  assert.equal((await call('/api/share/signal', presenter, { peerId: hostId, to: receivers[9].peerId, version: started.data.source.version, description: { type: 'offer', sdp: 'removed' } })).status, 409);
  service.close();
});
