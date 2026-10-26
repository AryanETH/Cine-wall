'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const device = headers => ({ id: headers['X-CineWall-Device'], hash: createHash('sha256').update(headers['X-CineWall-Key']).digest('hex') });
// Persist real room records for transport tests that need stable UUID fixtures.
exports.seedRoom = (root, id, headers, mode = 'video', guests = []) => {
  const directory = path.join(root, 'room-records'); fs.mkdirSync(directory, { recursive: true });
  const record = { id, code: id.replace(/-/g, '').slice(0, 8).toUpperCase().replace(/[01]/g, 'A'), mode, admin: device(headers), recoveryHash: createHash('sha256').update('test-recovery-key').digest('hex'), members: [{ device: device(headers), ticket: 'a'.repeat(48), role: 'admin', screen: ['video', 'audio'].includes(mode) ? 1 : 0 }, ...guests.map((h, i) => ({ device: device(h), ticket: 'b'.repeat(48), role: 'screen', screen: i + (mode === 'video' || mode === 'audio' ? 2 : 1) }))], created: Date.now(), lastUsed: Date.now() };
  fs.writeFileSync(path.join(directory, `${id}.json`), JSON.stringify(record)); return record;
};
