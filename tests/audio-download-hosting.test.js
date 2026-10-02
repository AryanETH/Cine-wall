'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('ready audio downloads load into private audio sessions, retain bytes/MIME and reject other rooms or video mode', { timeout: 30000 }, async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cinewall-audio-download-test-'));
  const room = randomUUID(), otherRoom = randomUUID(), jobs = [], bytes = Buffer.from('synthetic audio transport fixture');
  for (const [container, type] of [['mp3', 'audio/mpeg'], ['aac', 'audio/aac'], ['m4a', 'audio/mp4'], ['wav', 'audio/wav']]) {
    const id = randomUUID(), directory = path.join(temporary, 'downloads', id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `media.${container}`), bytes);
    fs.writeFileSync(path.join(directory, 'job.json'), JSON.stringify({ id, room, title: 'Test audio', fileName: `test.${container}`, option: { kind: 'audio', container } }));
    jobs.push({ id, container, type, directory });
  }
  const listener = net.createServer(); await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise((resolve) => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], { cwd: root, windowsHide: true, env: { ...process.env, PORT: String(port), CINEWALL_HOSTED: '1', CINEWALL_CACHE_DIR: temporary }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; server.stdout.on('data', (data) => { output += data; }); server.stderr.on('data', (data) => { output += data; });
  t.after(async () => {
    server.kill(); await new Promise((resolve) => server.exitCode !== null ? resolve() : server.once('close', resolve));
    if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('cinewall-audio-download-test-')) fs.rmSync(temporary, { recursive: true, force: true });
  });
  for (let i = 0; i < 100 && !output.includes(`http://localhost:${port}/`); i++) await pause(50);
  assert.ok(output.includes(`http://localhost:${port}/`), output);
  async function api(route, body, session = room) {
    const response = await fetch(`${base}${route}${route.includes('?') ? '&' : '?'}room=${session}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await api(`/api/youtube/downloads/${jobs[0].id}/load`, {})).status, 409, 'audio cannot load into the initial video session');
  await api('/api/command', { type: 'session-mode', sessionMode: 'audio' });
  for (const job of jobs) {
    assert.equal((await api(`/api/youtube/downloads/${job.id}/load`, {}, otherRoom)).status, 400);
    const loaded = await api(`/api/youtube/downloads/${job.id}/load`, {});
    assert.equal(loaded.status, 200);
    assert.equal(loaded.data.state.asset.kind, 'audio');
    assert.equal(loaded.data.state.asset.type, job.type);
    assert.equal(loaded.data.state.asset.name, `test.${job.container}`);
    const stream = await fetch(`${base}/api/media/stream?room=${room}&v=${loaded.data.state.asset.version}`);
    assert.equal(stream.status, 200); assert.equal(stream.headers.get('content-type'), job.type);
    assert.deepEqual(Buffer.from(await stream.arrayBuffer()), bytes);
    const download = await fetch(`${base}/api/youtube/downloads/${job.id}/file?room=${room}`);
    assert.equal(download.headers.get('content-type'), job.type);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.ok(fs.existsSync(path.join(job.directory, `media.${job.container}`)), 'original saved audio survives loading/replacing the current track');
  }
  const playing = await api('/api/command', { type: 'play', position: 0 });
  assert.equal(playing.status, 200); assert.equal(playing.data.command.playing, true);
  assert.equal((await api('/api/status', undefined, otherRoom)).data.state.asset, null);
  const upload = await fetch(`${base}/api/media?kind=audio&name=dropped.AAC&room=${room}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
  assert.equal(upload.status, 200);
  assert.equal((await upload.json()).state.asset.type, 'audio/aac', 'missing MIME on a dropped audio file is normalized by extension');
});
