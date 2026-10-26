'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
for (const directory of [root, path.join(root, 'public'), __dirname]) {
  for (const name of fs.readdirSync(directory)) if (/\.(?:c?js|mjs)$/.test(name)) {
    const result = spawnSync(process.execPath, ['--check', path.join(directory, name)], { windowsHide: true, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log('All first-party JavaScript syntax checks passed.');
