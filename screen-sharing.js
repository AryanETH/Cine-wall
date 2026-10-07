'use strict';

const { randomBytes, randomUUID } = require('node:crypto');
const MAX_SCREENS = 10;

// This service exchanges connection messages only. Captured audio/video travels
// over WebRTC between browsers, never through an upload or server media route.
module.exports = function createScreenSharing({ identity, readJson, json }) {
  const peers = new Map();
  const callVersion = randomUUID();
  let source = null;
  let revision = 0;
  let settings = { count: 2, layout: 'mirror', flip: false, quality: 'auto', pointers: true };
  const uuid = /^[a-f0-9-]{36}$/;
  function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
  function emit(peer, event, data) {
    try { if (peer.response && !peer.response.destroyed) peer.response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { peer.response = null; }
  }
  function snapshot() {
    return { source, settings, revision, callVersion,
      participants: [...peers.values()].filter(peer => peer.joined && eligible(peer)).map(peer => ({ peerId: peer.id, screen: peer.screen, mic: peer.mic, camera: peer.camera, online: Boolean(peer.response && !peer.response.destroyed) })),
      receivers: [...peers.values()].filter(peer => peer.id !== source?.peerId && eligible(peer)).map(peer => ({ peerId: peer.id, screen: peer.screen, status: peer.status })),
      peers: [...peers.values()].filter(peer => peer.screen > 0).map(peer => ({ peerId: peer.id, screen: peer.screen, status: peer.status })) };
  }
  function eligible(peer) { return peer.screen === 0 || peer.screen <= settings.count; }
  function validateSignal(body) {
    if (body.description && (!['offer', 'answer'].includes(body.description.type) || typeof body.description.sdp !== 'string' || body.description.sdp.length > 64000)) fail('Invalid connection message.');
    if (body.candidate && (typeof body.candidate.candidate !== 'string' || body.candidate.candidate.length > 2048)) fail('Invalid connection address.');
    if (!body.description && !body.candidate) fail('Empty connection message.');
  }
  function broadcast() { revision++; const state = snapshot(); for (const peer of peers.values()) emit(peer, 'share-state', state); }
  function endShare() { source = null; for (const peer of peers.values()) peer.status = 'waiting'; broadcast(); }
  function prune() {
    const now = Date.now();
    let changed = false;
    for (const peer of peers.values()) if (now - peer.lastSeen > 45000) {
      peers.delete(peer.id); peer.response?.end(); changed = true;
      if (source?.peerId === peer.id) source = null;
    }
    if (changed) broadcast();
  }
  function ownPeer(req, id) {
    const device = identity(req), peer = peers.get(id);
    if (!peer || peer.device.id !== device.id || peer.device.hash !== device.hash) fail('Reload this screen to reconnect.', 403);
    peer.lastSeen = Date.now();
    return peer;
  }
  function host(req, id) {
    const peer = ownPeer(req, id);
    if (source?.peerId !== peer.id) fail('Only the sharing laptop can change this.', 423);
    return peer;
  }
  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/share/') && url.pathname !== '/share-events') return false;
    prune();
    if (req.method === 'GET' && url.pathname === '/api/share/state') { json(res, 200, snapshot()); return true; }
    if (req.method === 'GET' && url.pathname === '/share-events') {
      const peer = peers.get(url.searchParams.get('peer'));
      if (!peer || url.searchParams.get('token') !== peer.token) fail('Reconnect this screen.', 403);
      peer.response?.end();
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': connected\n\n'); peer.response = res; peer.lastSeen = Date.now();
      broadcast();
      req.on('close', () => { if (peer.response === res) peer.response = null; });
      return true;
    }
    if (req.method !== 'POST') fail('Method not allowed', 405);
    const body = await readJson(req);
    if (!uuid.test(body.peerId || '')) fail('Invalid screen identity.');
    if (url.pathname === '/api/share/join') {
      const device = identity(req), screen = Number(body.screen);
      if (!Number.isInteger(screen) || screen < 0 || screen > MAX_SCREENS) fail('Choose a screen from 1 to 10.');
      const existing = peers.get(body.peerId);
      if (existing && (existing.device.id !== device.id || existing.device.hash !== device.hash)) fail('This screen belongs to another laptop.', 403);
      if (!existing && peers.size >= 20) fail('Too many open sharing tabs. Close an unused tab.', 429);
      const peer = existing || { id: body.peerId, device, token: randomBytes(24).toString('hex'), response: null, joined: false, mic: false, camera: false };
      Object.assign(peer, { screen, status: 'waiting', lastSeen: Date.now() }); peers.set(peer.id, peer); broadcast();
      json(res, 200, { token: peer.token, state: snapshot() }); return true;
    }
    const peer = ownPeer(req, body.peerId);
    if (url.pathname === '/api/share/call-media') {
      if (![body.joined, body.mic, body.camera].every(value => typeof value === 'boolean')) fail('Choose your microphone and camera settings.');
      if (body.joined && !eligible(peer)) fail('This screen was removed. Ask the presenter to add it again.', 409);
      if (body.joined && [...peers.values()].some(other => other.id !== peer.id && other.joined && other.device.id === peer.device.id && other.device.hash === peer.device.hash)) fail('This laptop is already in the call in another tab. Leave that call first.', 409);
      if (body.joined && !peer.joined && [...peers.values()].filter(other => other.joined).length >= 4) fail('This room call supports up to 4 devices.', 409);
      Object.assign(peer, { joined: body.joined, mic: body.joined && body.mic, camera: body.joined && body.camera });
      broadcast(); json(res, 200, snapshot()); return true;
    }
    if (url.pathname === '/api/share/call-signal') {
      const target = peers.get(body.to);
      if (body.version !== callVersion || !peer.joined || !eligible(peer) || !target?.joined || !eligible(target) || peer.id === target.id) fail('This call connection has ended.', 409);
      if (!target.response || target.response.destroyed) fail('The other person is reconnecting.', 409);
      validateSignal(body);
      emit(target, 'call-signal', { from: peer.id, version: callVersion, description: body.description, candidate: body.candidate });
      json(res, 200, { ok: true }); return true;
    }
    if (url.pathname === '/api/share/ping') {
      const status = ['waiting', 'connecting', 'connected', 'disconnected', 'tap'].includes(body.status) ? body.status : 'waiting';
      if (peer.status !== status) { peer.status = status; broadcast(); }
      json(res, 200, snapshot()); return true;
    }
    if (url.pathname === '/api/share/start') {
      if (peer.screen !== 0) fail('Open the sharing dashboard to start.');
      if (source && source.peerId !== peer.id) fail('Another laptop is sharing. Wait for it to stop.', 423);
      source = { peerId: peer.id, deviceId: peer.device.id, version: randomUUID(), name: String(body.name || 'Shared screen').slice(0, 160), audio: body.audio === true };
      broadcast(); json(res, 200, snapshot()); return true;
    }
    if (url.pathname === '/api/share/stop') { host(req, peer.id); endShare(); json(res, 200, snapshot()); return true; }
    if (url.pathname === '/api/share/settings') {
      if (source) host(req, peer.id);
      else if (peer.screen !== 0) fail('Change settings on the sharing dashboard.', 403);
      if (body.count !== undefined && (!Number.isInteger(body.count) || body.count < 1 || body.count > MAX_SCREENS)) fail('Use up to 10 screens.');
      if (body.layout !== undefined && body.layout !== 'mirror') fail('Screen sharing uses the full view.');
      if (body.quality !== undefined && !['auto', '720p', '1080p'].includes(body.quality)) fail('Choose Auto, 720p or 1080p.');
      settings = { ...settings, ...Object.fromEntries(['count', 'layout', 'quality'].filter(key => body[key] !== undefined).map(key => [key, body[key]])) };
      for (const key of ['flip', 'pointers']) if (typeof body[key] === 'boolean') settings[key] = body[key];
      for (const other of peers.values()) if (!eligible(other)) Object.assign(other, { joined: false, mic: false, camera: false });
      broadcast(); json(res, 200, snapshot()); return true;
    }
    if (url.pathname === '/api/share/signal') {
      const target = peers.get(body.to);
      if (!target || !target.response || target.response.destroyed) fail('The other screen is reconnecting.', 409);
      if (!source || body.version !== source.version || peer.id === target.id || !((peer.id === source.peerId && eligible(target)) || (target.id === source.peerId && eligible(peer)))) fail('This sharing session has ended.', 409);
      validateSignal(body);
      emit(target, 'share-signal', { from: peer.id, version: source.version, description: body.description, candidate: body.candidate });
      json(res, 200, { ok: true }); return true;
    }
    if (url.pathname === '/api/share/leave') {
      peers.delete(peer.id); peer.response?.end();
      if (source?.peerId === peer.id) source = null;
      broadcast(); json(res, 200, { ok: true }); return true;
    }
    fail('Not found', 404);
  }
  return { handle, pulse() { prune(); for (const peer of peers.values()) emit(peer, 'share-state', snapshot()); }, idle: () => peers.size === 0, close() { for (const peer of peers.values()) peer.response?.end(); peers.clear(); } };
};
