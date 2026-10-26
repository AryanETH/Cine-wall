'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { isIP } = require('node:net');
const { randomUUID, randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function identity(req) {
  if (req.cinewallDevice) return req.cinewallDevice;
  const id = String(req.headers['x-cinewall-device'] || ''), key = String(req.headers['x-cinewall-key'] || '');
  if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9-]{36}$/.test(key)) fail('Reload CineWall to connect this device.', 401);
  return { id, hash: hash(key) };
}
const same = (a, b) => Boolean(a && b && a.id === b.id && a.hash === b.hash);
module.exports = function createRooms(root, { now = Date.now, limit = 64 } = {}) {
  const directory = path.join(root, 'room-records');
  fs.mkdirSync(directory, { recursive: true });
  const records = new Map(), codes = new Map(), rates = new Map();
  const lifetime = 24 * 60 * 60 * 1000;
  function save(record) {
    record.savedAt = now();
    const file = path.join(directory, `${record.id}.json`), temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(record)); fs.renameSync(temporary, file);
  }
  for (const file of fs.readdirSync(directory)) if (/^[a-f0-9-]{36}\.json$/.test(file)) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
      if (record.id + '.json' !== file || !/^[A-Z2-9]{8}$/.test(record.code) || !Array.isArray(record.members) || record.members.length > 20 || !record.admin || !record.recoveryHash || record.lastUsed < now() - lifetime) continue;
      records.set(record.id, record); codes.set(record.code, record.id);
    } catch { /* Ignore incomplete records; never guess an owner. */ }
  }
  const format = code => `${code.slice(0, 4)}-${code.slice(4)}`;
  function throttle(req, action) {
    // Forwarded addresses are used only after an administrator explicitly
    // configures a trusted ingress; a caller-supplied edge marker is never trust.
    const forwarded = process.env.CINEWALL_TRUST_PROXY === 'real-ip' ? String(req.headers['x-real-ip'] || '').trim() : process.env.CINEWALL_TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || '').split(',').at(-1).trim() : '';
    const address = isIP(forwarded) ? forwarded : req.socket.remoteAddress || 'local', key = `${action}:${address.slice(0, 100)}`;
    const window = action === 'create' ? 60 * 60 * 1000 : 60 * 1000, maximum = action === 'create' ? 12 : 30;
    const previous = rates.get(key), entry = previous && previous.until > now() ? previous : { count: 0, until: now() + window };
    if (++entry.count > maximum) fail('Too many attempts. Please wait and try again.', 429);
    rates.set(key, entry);
    if (rates.size > 2048) for (const [id, value] of rates) if (value.until < now()) rates.delete(id);
    if (rates.size > 4096) fail('Please try again in a moment.', 429);
  }
  function lookup(value) {
    const input = String(value || '').trim(), clean = input.toUpperCase().replace(/[\s-]/g, '');
    const record = records.get(input) || records.get(codes.get(clean));
    if (!record || record.lastUsed < now() - lifetime) fail('Room not found or expired. Check the room ID.', 404);
    return record;
  }
  function member(record, device) { return record.members.find(item => same(item.device, device)); }
  function isAdmin(record, device) { return same(record.admin, device); }
  function route(record, item) {
    if (isAdmin(record, item.device)) return record.mode === 'share' ? '/share.html' : record.mode === 'mic' ? '/mic.html' : `/admin.html?mode=${record.mode}`;
    return record.mode === 'share' ? `/share.html?screen=${item.screen}` : record.mode === 'mic' ? item.role === 'phone' ? '/mic.html?role=phone' : `/mic.html?speaker=${item.screen}` : `/screen.html?screen=${item.screen}`;
  }
  function result(record, item) {
    return { room: record.id, code: format(record.code), mode: record.mode, deviceId: item.device.id, admin: isAdmin(record, item.device), screen: item.screen, role: item.role, ticket: item.ticket, path: route(record, item) };
  }
  function create(req, mode) {
    throttle(req, 'create');
    if (!['video', 'audio', 'share', 'mic'].includes(mode)) fail('Choose Video, Audio, Screen sharing or Mic and Speaker.');
    if (records.size >= limit) fail('The server is busy. Please try again later.', 503);
    const device = identity(req), alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code; do { code = [...randomBytes(8)].map(n => alphabet[n % alphabet.length]).join(''); } while (codes.has(code));
    const recoveryKey = randomBytes(12).toString('base64url');
    const item = { device, ticket: randomBytes(24).toString('hex'), screen: ['video', 'audio'].includes(mode) ? 1 : 0, role: 'admin' };
    const record = { id: randomUUID(), code, mode, admin: device, recoveryHash: hash(recoveryKey), members: [item], created: now(), lastUsed: now() };
    records.set(record.id, record); codes.set(code, record.id);
    try { save(record); } catch (error) { records.delete(record.id); codes.delete(code); throw error; }
    return { ...result(record, item), recoveryKey };
  }
  function join(req, body) {
    throttle(req, 'join');
    const record = lookup(body.code || body.room), device = identity(req);
    if (body.mode && body.mode !== record.mode) fail(`This is a ${record.mode === 'share' ? 'screen sharing' : record.mode === 'mic' ? 'Mic and Speaker' : record.mode} room. Choose that mode to join.`, 409);
    let item = member(record, device);
    if (!item) {
      if (record.members.length >= 16) fail('This room is full.', 409);
      const role = record.mode === 'mic' && body.role === 'phone' ? 'phone' : 'screen';
      const maximum = record.mode === 'audio' ? 5 : record.mode === 'share' ? 10 : 3;
      let screen = role === 'phone' ? 0 : Number(body.screen) || 0;
      if (role === 'phone' && record.members.some(m => m.role === 'phone')) fail('A phone is already assigned to this room.', 409);
      const used = n => record.members.some(m => m.screen === n && m.role !== 'phone');
      if (role !== 'phone') {
        if (!screen) screen = Array.from({ length: maximum }, (_, i) => i + 1).find(n => !used(n));
        if (!Number.isInteger(screen) || screen < 1 || screen > maximum || used(screen)) fail('That screen is already assigned or the room is full.', 409);
      }
      item = { device, ticket: randomBytes(24).toString('hex'), screen, role }; record.members.push(item);
    }
    record.lastUsed = now(); save(record); return result(record, item);
  }
  function authorize(req, url, record) {
    let device;
    if (req.headers['x-cinewall-device']) device = identity(req);
    else {
      const ticket = url.searchParams.get('ticket');
      const found = ticket && record.members.find(m => m.ticket === ticket);
      if (found) device = found.device;
    }
    let item = device && member(record, device);
    const suppliedTicket = req.headers['x-cinewall-ticket'] || url.searchParams.get('ticket');
    if (!item && suppliedTicket) { item = record.members.find(m => m.ticket === suppliedTicket); if (item) device = item.device; }
    if (!item) fail('Join this room first using its room ID.', 403);
    req.cinewallDevice = device; req.cinewallMember = item;
    record.lastUsed = now();
    if (now() - (record.savedAt || 0) > 60000) save(record);
    return item;
  }
  function requireAdmin(record, req) { const device = identity(req); if (!isAdmin(record, device)) fail('Only the room admin can do this.', 403); return device; }
  function removeMembers(record, predicate) { const removed = record.members.filter(m => !isAdmin(record, m.device) && predicate(m)); record.members = record.members.filter(m => !removed.includes(m)); save(record); return removed; }
  function resume(req, body) {
    throttle(req, 'resume'); const record = lookup(body.room), item = record.members.find(m => m.ticket === body.ticket);
    if (!item) fail('This room connection expired. Join again with the room ID.', 403);
    record.lastUsed = now(); return result(record, item);
  }
  function recover(req, body) {
    throttle(req, 'recover'); const record = lookup(body.code), actual = Buffer.from(hash(body.recoveryKey || '')), expected = Buffer.from(record.recoveryHash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail('The recovery key is incorrect.', 403);
    const device = identity(req), old = record.admin;
    record.members = record.members.filter(m => !same(m.device, old) && !same(m.device, device));
    record.admin = device;
    const item = { device, ticket: randomBytes(24).toString('hex'), screen: ['video', 'audio'].includes(record.mode) ? 1 : 0, role: 'admin' };
    record.members.push(item); record.lastUsed = now(); save(record);
    return result(record, item);
  }
  function prune() {
    const expired = [];
    for (const [id, record] of records) if (record.lastUsed < now() - lifetime) { records.delete(id); codes.delete(record.code); expired.push(id); fs.rmSync(path.join(directory, `${id}.json`), { force: true }); }
    for (const [key, entry] of rates) if (entry.until < now()) rates.delete(key);
    return expired;
  }
  return { create, join, resume, recover, lookup, authorize, requireAdmin, isAdmin, member, removeMembers, result, prune, identity, records };
};
module.exports.identity = identity;
