'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
test('cache quota reserves concurrent writes and cleanup preserves active directories', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cinewall-budget-test-'));
  t.after(() => { if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('cinewall-budget-test-')) fs.rmSync(root, { recursive: true, force: true }); });
  const result = spawnSync(process.execPath, ['-e', `
    const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
    const budget=require('./cache-budget'); const root=process.env.CINEWALL_CACHE_DIR;
    const release=budget.reserve('one',6000);
    assert.throws(()=>budget.reserve('two',6000),{status:507});
    budget.reserve('one',8000); assert.throws(()=>budget.reserve('two',3000),{status:507});
    release(); budget.reserve('two',6000)();
    const downloads=path.join(root,'downloads'); fs.mkdirSync(downloads);
    const active=path.join(downloads,'active'),old=path.join(downloads,'old');fs.mkdirSync(active);fs.mkdirSync(old);
    for(const dir of [active,old])fs.utimesSync(dir,new Date(0),new Date(0));
    budget.removeExpired(downloads,1000,new Set([active]));assert(fs.existsSync(active));assert(!fs.existsSync(old));
    assert.throws(()=>budget.removeExpired(path.dirname(root),0),/inside the media cache/);
  `], { cwd: path.resolve(__dirname,'..'), windowsHide: true, env: { ...process.env, CINEWALL_CACHE_DIR: root, CINEWALL_CACHE_LIMIT_GB: String(10000/1024**3) }, encoding: 'utf8' });
  assert.equal(result.status,0,result.stderr);
});
