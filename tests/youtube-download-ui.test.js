'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const turn = () => new Promise(resolve => setImmediate(resolve));
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const gateway = (status = 502) => ({ ok: status < 400, status, json: async () => { throw SyntaxError('Unexpected token <'); } });
const inspection = { id: 'inspection', title: 'Sample video', formats: [{ id: 'option', kind: 'video', container: 'mp4', label: '360p' }] };
function panel(handler, { storageBlocked = false, saved = null } = {}) {
  const nodes = new Map(), calls = [], timers = new Map(); let sequence = 0;
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: false, disabled: false, textContent: '', children: [], events: {},
      classList: { toggle() {} }, setAttribute() {}, focus() {}, addEventListener(type, fn) { this.events[type] = fn; },
      replaceChildren(...children) { this.children = children; this.value = children[0]?.value || ''; } });
    return nodes.get(id);
  }
  const values = new Map();
  if (saved) values.set('cinewall-download-job', saved);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/youtube-download.js'), 'utf8'), {
    document: { getElementById: node, body: { dataset: { sessionMode: 'video' } } }, window: {}, AbortController,
    Option: function(text, value) { this.text = text; this.value = value; },
    sessionStorage: { getItem: key => values.get(key), setItem(key, value) { if (storageBlocked) throw Error('Blocked'); values.set(key, value); }, removeItem: key => values.delete(key) },
    setTimeout(fn, ms) { timers.set(++sequence, { fn, ms }); return sequence; }, clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => { const call = { url, body: options?.body ? JSON.parse(options.body) : null, signal: options?.signal }; calls.push(call); return handler(call, calls); }
  });
  return { node, calls, values,
    submit: () => node('youtubeDownloadForm').events.submit({ preventDefault() {} }),
    async fireDelay(ms) { const entry = [...timers].find(([, timer]) => timer.ms === ms); assert.ok(entry, `No ${ms}ms timer`); timers.delete(entry[0]); entry[1].fn(); await turn(); },
    async firePoll() { const entry = [...timers].find(([, timer]) => timer.ms >= 1200 && timer.ms <= 15000); assert.ok(entry, 'No progress retry timer'); timers.delete(entry[0]); entry[1].fn(); await turn(); }
  };
}

test('one transient HTML gateway response recovers a metadata check without exposing a JSON parse error', async () => {
  for (const status of [200, 502]) {
    let tools = 0;
    const ui = panel(({ url }) => url.endsWith('/tools') ? ++tools === 1 ? gateway(status) : response({ ready: true }) : response(inspection));
    const checking = ui.submit(); await turn(); await ui.fireDelay(600); await checking;
    assert.equal(tools, 2); assert.equal(ui.node('downloadSelection').hidden, false);
    assert.equal(ui.node('downloadVideoTitle').textContent, 'Sample video');
    assert.doesNotMatch(ui.node('youtubeDownloadStatus').textContent, /Unexpected token/);
  }
});

test('editing a checked link aborts and ignores an obsolete response', async () => {
  let finish;
  const ui = panel(({ url }) => url.endsWith('/tools') ? response({ ready: true }) : new Promise(resolve => { finish = resolve; }));
  const checking = ui.submit(); await turn();
  const pending = ui.calls.find(call => call.url.endsWith('/formats'));
  ui.node('downloadYoutubeUrl').value = 'https://youtu.be/aqz-KE-bpKQ'; ui.node('downloadYoutubeUrl').events.input();
  assert.equal(pending.signal.aborted, true);
  finish(response(inspection)); await checking;
  assert.equal(ui.node('downloadSelection').hidden, true); assert.equal(ui.node('downloadVideoTitle').textContent, '');
  assert.equal(ui.node('checkYoutubeFormats').disabled, false);
});

test('failed download creation is not blindly retried', async () => {
  const ui = panel(({ url }) => url.endsWith('/tools') ? response({ ready: true }) : url.endsWith('/formats') ? response(inspection) : gateway());
  await ui.submit(); await ui.node('prepareYoutubeDownload').events.click();
  assert.equal(ui.calls.filter(call => call.url === '/api/youtube/downloads').length, 1);
  assert.equal(ui.node('prepareYoutubeDownload').disabled, false);
  assert.match(ui.node('youtubeDownloadStatus').textContent, /temporarily unavailable/);
});

test('progress failures back off, offer Reconnect and reuse the same download without another creation', async () => {
  let online = false;
  const job = { id: 'same-job', state: 'downloading', progress: 0, kind: 'video', container: 'mp4' };
  const ui = panel(({ url }) => url.endsWith('/tools') ? response({ ready: true }) : url.endsWith('/formats') ? response(inspection)
    : url === '/api/youtube/downloads' ? response(job, 202) : online ? response({ ...job, state: 'ready', progress: 100, downloadUrl: '/file' }) : Promise.reject(TypeError('Offline')),
    { storageBlocked: true });
  await ui.submit(); await ui.node('prepareYoutubeDownload').events.click(); await turn();
  for (let i = 0; i < 4; i++) await ui.firePoll();
  assert.equal(ui.node('checkYoutubeFormats').textContent, 'Reconnect'); assert.equal(ui.node('checkYoutubeFormats').disabled, false);
  online = true; await ui.submit();
  assert.equal(ui.node('saveYoutubeDownload').hidden, false);
  assert.equal(ui.calls.filter(call => call.url === '/api/youtube/downloads').length, 1);
});

test('a permanent missing-job response stops polling and returns actionable controls', async () => {
  const job = { id: 'missing-job', state: 'downloading', progress: 0, kind: 'video', container: 'mp4' };
  const ui = panel(({ url }) => url.endsWith('/tools') ? response({ ready: true }) : url.endsWith('/formats') ? response(inspection)
    : url === '/api/youtube/downloads' ? response(job, 202) : response({ error: 'Download not found.' }, 404));
  await ui.submit(); await ui.node('prepareYoutubeDownload').events.click(); await turn();
  assert.equal(ui.node('checkYoutubeFormats').disabled, false); assert.equal(ui.node('prepareYoutubeDownload').disabled, false);
  assert.equal(ui.node('youtubeDownloadStatus').textContent, 'Download not found.');
});

test('an obsolete restored job cannot overwrite a newer search', async () => {
  let finish;
  const saved = '11111111-1111-4111-8111-111111111111';
  const ui = panel(({ url }) => url.endsWith(saved) ? new Promise(resolve => { finish = resolve; })
    : url.endsWith('/tools') ? response({ ready: true }) : response(inspection), { saved });
  await ui.submit();
  finish(response({ id: saved, state: 'ready', container: 'mp4', kind: 'video', downloadUrl: '/old-file' })); await turn();
  assert.equal(ui.node('downloadVideoTitle').textContent, 'Sample video');
  assert.equal(ui.node('saveYoutubeDownload').hidden, true);
});

test('polling rate limits retain the active download and recover without creating another job', async () => {
  let checks = 0;
  const job = { id: 'rate-limited-job', state: 'downloading', progress: 0, kind: 'video', container: 'mp4' };
  const ui = panel(({ url }) => url.endsWith('/tools') ? response({ ready: true }) : url.endsWith('/formats') ? response(inspection)
    : url === '/api/youtube/downloads' ? response(job, 202) : ++checks === 1 ? response({ error: 'Wait before checking again.' }, 429)
      : response({ ...job, state: 'ready', progress: 100, downloadUrl: '/file' }));
  await ui.submit(); await ui.node('prepareYoutubeDownload').events.click(); await turn();
  assert.equal(ui.node('cancelYoutubeDownload').hidden, false);
  await ui.fireDelay(15000);
  assert.equal(ui.node('saveYoutubeDownload').hidden, false);
  assert.equal(ui.calls.filter(call => call.url === '/api/youtube/downloads').length, 1);
});
