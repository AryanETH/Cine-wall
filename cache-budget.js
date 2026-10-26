'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.env.CINEWALL_CACHE_DIR || path.join(__dirname, '.cinema-cache'));
const maximum = Number(process.env.CINEWALL_CACHE_LIMIT_GB || 100) * 1024 ** 3;
if (!Number.isFinite(maximum) || maximum <= 0) throw new Error('CINEWALL_CACHE_LIMIT_GB must be a positive number.');
const reservations = new Map();
let measured = 0, measuredAt = 0;
function usage(directory) {
  let total = 0;
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink()) continue;
    const file = path.join(directory, item.name);
    try { total += item.isDirectory() ? usage(file) : fs.statSync(file).size; } catch {}
  }
  return total;
}
function reserve(key, bytes) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('Invalid cache reservation.');
  fs.mkdirSync(root, { recursive: true });
  if (Date.now() - measuredAt > 10000) { measured = usage(root); measuredAt = Date.now(); }
  const held = [...reservations].reduce((total, [id, size]) => total + (id === key ? 0 : size), 0);
  const available = fs.statfsSync(root);
  if (measured + held + bytes > maximum || available.bavail * available.bsize < held + bytes + 256 * 1024 ** 2) throw Object.assign(new Error('Server storage is nearly full. Use Instant sharing or try again after old files expire.'), { status: 507 });
  reservations.set(key, bytes);
  return () => { reservations.delete(key); measuredAt = 0; };
}
function removeExpired(directory, age, protectedPaths = new Set()) {
  if (!fs.existsSync(directory)) return;
  const base = path.resolve(directory);
  if (!base.startsWith(root + path.sep)) throw new Error('Cleanup must stay inside the media cache.');
  for (const item of fs.readdirSync(base, { withFileTypes: true })) {
    if (item.isSymbolicLink()) continue;
    const target = path.join(base, item.name);
    if (protectedPaths.has(target)) continue;
    try { if (Date.now() - fs.statSync(target).mtimeMs > age) fs.rmSync(target, { recursive: true, force: true }); } catch {}
  }
  measuredAt = 0;
}
module.exports = { reserve, removeExpired };
