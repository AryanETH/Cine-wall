'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { getDemoVisitCount, getDemoVisitSnapshot } = require('../public/home-footer.js');

test('demo count starts at 5,000 and increases exactly once every 45 seconds', () => {
  assert.equal(getDemoVisitCount(new Date('2026-10-08T00:00:00Z')), 5000);
  assert.equal(getDemoVisitCount(new Date('2026-10-08T00:00:44.999Z')), 5000);
  assert.equal(getDemoVisitCount(new Date('2026-10-08T00:00:45Z')), 5001);
  assert.equal(getDemoVisitCount(new Date('2026-10-08T00:01:30Z')), 5002);
});

test('demo count increases without needing local storage or mutable server state', () => {
  let previous = 4999;
  for (let day = 0; day < 400; day++) {
    const count = getDemoVisitCount(new Date(Date.UTC(2026, 9, 8 + day)));
    assert.ok(count > previous);
    previous = count;
  }
});

test('server snapshots give every visitor the same count and next update time', () => {
  const now = Date.parse('2026-10-08T00:00:30Z');
  const first = getDemoVisitSnapshot(now);
  assert.deepEqual(first, getDemoVisitSnapshot(now));
  assert.deepEqual(first, { count: 5000, serverNow: now, nextUpdateAt: now + 15000, demo: true });
});

test('public server route shares a non-cached demo count across rooms before session checks', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const handlerCode = source.match(/const server = http\.createServer\(async \(req, res\) => \{[\s\S]*?\n\}\);/)?.[0];
  assert.ok(handlerCode);
  let handler;
  vm.runInNewContext(handlerCode, { URL, http: { createServer: callback => { handler = callback; } }, getDemoVisitSnapshot: () => getDemoVisitSnapshot(Date.parse('2026-10-08T00:00:30Z')) });
  const responses = [];
  for (const url of ['/api/demo-visits', '/api/demo-visits?room=00000000-0000-0000-0000-000000000000']) {
    const result = {};
    await handler({ method: 'GET', url }, { writeHead: (status, headers) => Object.assign(result, { status, headers }), end: body => { result.data = JSON.parse(body); } });
    assert.equal(result.status, 200);
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.equal(result.data.demo, true);
    responses.push(result.data);
  }
  assert.deepEqual(responses[0], responses[1]);
});

test('footer labels the count as demo data and opens GitHub safely in a new tab', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /Realtime traffic/);
  assert.doesNotMatch(html, /Back to setup guide/);
  assert.match(html, /class="home-github-link" href="https:\/\/github.com\/AryanETH\/Cine-wall" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /home-footer\.js\?v=/);
  assert.match(html, /home-live-dot/);
});

test('browser uses the server count instead of its own clock and reconnects on failure', async () => {
  const counter = { textContent: '—' }, status = { textContent: 'Connecting' };
  const classes = new Set(), scheduled = [];
  const indicator = { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
  let online = true;
  const context = {
    document: { querySelector: selector => ({ '#demoVisitCount': counter, '#demoVisitLive': indicator, '#demoVisitStatus': status })[selector], addEventListener() {} },
    window: { addEventListener() {} },
    performance: { now: () => 100 },
    AbortSignal: { timeout: () => undefined },
    clearTimeout() {}, setTimeout: (callback, delay) => scheduled.push({ callback, delay }),
    fetch: async () => ({ ok: online, json: async () => ({ count: 5432, serverNow: 1000, nextUpdateAt: 16000, demo: true }) }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/home-footer.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(counter.textContent, '5,432');
  assert.equal(status.textContent, 'Live');
  assert.ok(classes.has('is-live'));
  assert.equal(scheduled[0].delay, 15025);
  online = false;
  await scheduled[0].callback();
  assert.equal(counter.textContent, '5,432');
  assert.equal(status.textContent, 'Reconnecting');
  assert.ok(!classes.has('is-live'));
  assert.equal(scheduled[1].delay, 10000);
});
