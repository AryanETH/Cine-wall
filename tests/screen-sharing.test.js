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
  const changed = await call('/api/share/settings', presenter, { peerId: hostId, count: 3, layout: 'wall', flip: true, quality: '720p', pointers: false });
  assert.deepEqual(changed.data.settings, { count: 3, layout: 'wall', flip: true, quality: '720p', pointers: false });
  assert.equal((await call('/api/share/settings', presenter, { peerId: hostId, count: 4 })).status, 400);
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
