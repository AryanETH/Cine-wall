'use strict';
const { randomUUID, randomBytes } = require('node:crypto');

// Room-scoped signaling only; audio stays on direct WebRTC connections.
module.exports = function createMicRoom({ identity, readJson, json, now = Date.now }) {
  const peers = new Map();
  const version = randomUUID();
  const laptops = new Set([1]), removed = new Set();
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  const emit = (peer, event, value) => {
    try { if (peer.response && !peer.response.destroyed) peer.response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`); } catch { peer.response = null; }
  };
  const snapshot = () => ({ version, laptops: [...laptops].sort(), peers: [...peers.values()].map(p => ({ peerId: p.id, role: p.role, slot: p.slot, live: p.live, status: p.status, online: Boolean(p.response && !p.response.destroyed) })) });
  function broadcast() { const state = snapshot(); for (const p of peers.values()) emit(p, 'mic-state', state); }
  function remove(peer) { peers.delete(peer.id); peer.response?.end(); }
  function prune() {
    let changed = false;
    for (const peer of peers.values()) if (now() - peer.lastSeen > 30000) { remove(peer); changed = true; }
    if (changed) broadcast();
  }
  function own(req, id) {
    const peer = peers.get(id), device = identity(req);
    if (!peer || peer.device.id !== device.id || peer.device.hash !== device.hash) fail('Reload to reconnect this device.', 403);
    peer.lastSeen = now(); return peer;
  }
  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/mic/') && url.pathname !== '/mic-events') return false;
    prune();
    if (req.method === 'GET' && url.pathname === '/api/mic/state') { json(res, 200, snapshot()); return true; }
    if (req.method === 'GET' && url.pathname === '/mic-events') {
      const peer = peers.get(url.searchParams.get('peer'));
      if (!peer || peer.token !== url.searchParams.get('token')) fail('Reconnect this device.', 403);
      peer.response?.end();
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': connected\n\n'); peer.response = res; peer.lastSeen = now(); broadcast();
      req.on('close', () => { if (peer.response === res) { peer.response = null; broadcast(); } });
      return true;
    }
    if (req.method !== 'POST') fail('Method not allowed.', 405);
    const body = await readJson(req);
    if (url.pathname === '/api/mic/laptops') {
      identity(req);
      if (body.action === 'add') {
        const slot = [1, 2, 3].find(n => !laptops.has(n));
        if (!slot) fail('Maximum 3 laptops.', 409);
        laptops.add(slot);
      } else if (body.action === 'remove' && Number.isInteger(body.slot) && laptops.has(body.slot)) {
        laptops.delete(body.slot);
        for (const peer of [...peers.values()]) if (peer.role === 'speaker' && peer.slot === body.slot) {
          removed.add(peer.id);
          if (removed.size > 256) removed.delete(removed.values().next().value);
          emit(peer, 'mic-removed', { slot: body.slot }); remove(peer);
        }
      } else fail('Choose a laptop to remove.');
      broadcast(); json(res, 200, snapshot()); return true;
    }
    if (!/^[a-f0-9-]{36}$/.test(body.peerId || '')) fail('Invalid device identity.');
    if (url.pathname === '/api/mic/join') {
      const device = identity(req), role = body.role, slot = role === 'speaker' ? body.slot : 0;
      if (!['phone', 'speaker'].includes(role) || (role === 'speaker' && (!Number.isInteger(slot) || slot < 1 || slot > 3))) fail('Choose one phone or speaker 1–3.');
      if (removed.has(body.peerId) || (role === 'speaker' && !laptops.has(slot))) fail('Laptop removed. Open a new laptop link to rejoin.', 410);
      const existing = peers.get(body.peerId);
      if (existing && (existing.device.id !== device.id || existing.device.hash !== device.hash)) fail('This device identity is already in use.', 403);
      if (existing && (existing.role !== role || existing.slot !== slot)) fail('Leave your current role first.', 409);
      for (const p of peers.values()) if (p.id !== body.peerId) {
        if (p.device.id === device.id && p.device.hash === device.hash) fail('This device already joined in another tab. Leave that tab first.', 409);
        if (p.role === role && p.slot === slot) fail(role === 'phone' ? 'One phone is already connected. Disconnect it first.' : `Speaker ${slot} is in use. Choose another speaker link.`, 409);
      }
      const peer = existing || { id: body.peerId, device, role, slot, token: randomBytes(24).toString('hex'), live: false, status: 'waiting', response: null };
      peer.lastSeen = now(); peers.set(peer.id, peer); broadcast(); json(res, 200, { token: peer.token, state: snapshot() }); return true;
    }
    const peer = own(req, body.peerId);
    if (url.pathname === '/api/mic/ping') {
      if (['waiting', 'connecting', 'connected', 'tap', 'disconnected'].includes(body.status)) peer.status = body.status;
      json(res, 200, snapshot()); return true;
    }
    if (url.pathname === '/api/mic/live') {
      if (peer.role !== 'phone') fail('Use the phone to control the microphone.', 403);
      if (typeof body.live !== 'boolean') fail('Choose whether the microphone is live.');
      peer.live = body.live; broadcast(); json(res, 200, snapshot()); return true;
    }
    if (url.pathname === '/api/mic/signal') {
      const target = peers.get(body.to);
      if (body.version !== version || !target || target.role === peer.role || !target.response || target.response.destroyed) fail('The other device is reconnecting.', 409);
      if (body.description && (!['offer', 'answer'].includes(body.description.type) || typeof body.description.sdp !== 'string' || body.description.sdp.length > 64000)) fail('Invalid connection message.');
      if (body.candidate && (typeof body.candidate.candidate !== 'string' || body.candidate.candidate.length > 2048)) fail('Invalid connection address.');
      if (!body.description && !body.candidate) fail('Empty connection message.');
      emit(target, 'mic-signal', { from: peer.id, version, description: body.description, candidate: body.candidate });
      json(res, 200, { ok: true }); return true;
    }
    if (url.pathname === '/api/mic/leave') { remove(peer); broadcast(); json(res, 200, { ok: true }); return true; }
    fail('Not found.', 404);
  }
  return { handle, pulse() { prune(); broadcast(); }, idle: () => peers.size === 0, close() { for (const p of [...peers.values()]) remove(p); } };
};
