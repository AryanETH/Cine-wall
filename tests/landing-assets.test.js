'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http'), vm = require('node:vm');
test('public assets stream ranges, validate caches and preserve HEAD semantics', async t => {
  const file = path.join(__dirname, '../public/assets/cinewall-demo-fast.mp4'), bytes = fs.readFileSync(file);
  const server = http.createServer((req, res) => require('../static-assets')(req, res, file, 'video/mp4', true));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const head = await fetch(url, { method: 'HEAD' }); assert.equal(head.headers.get('content-length'), String(bytes.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.match(head.headers.get('cache-control'), /immutable/);
  const partial = await fetch(url, { headers: { Range: 'bytes=10-29' } }); assert.equal(partial.status, 206); assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(10, 30));
  assert.equal((await fetch(url, { headers: { Range: 'bytes=-0' } })).status, 416);
  assert.equal((await fetch(url, { headers: { 'If-None-Match': head.headers.get('etag') } })).status, 304);
  const suffix = await fetch(url, { headers: { Range: 'bytes=-5' } }); assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(-5));
});
test('Firebase config is disabled until complete and exposes only public web fields', () => {
  const config = require('../firebase-config'); assert.equal(config({}).enabled, false);
  const result = config({ CINEWALL_FIREBASE_API_KEY: 'public-key', CINEWALL_FIREBASE_AUTH_DOMAIN: 'demo.firebaseapp.com', CINEWALL_FIREBASE_PROJECT_ID: 'demo', CINEWALL_FIREBASE_APP_ID: 'web-app', PRIVATE_KEY: 'secret' });
  assert.equal(result.enabled, true); assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(config({ CINEWALL_FIREBASE_API_KEY: 'key', CINEWALL_FIREBASE_AUTH_DOMAIN: 'bad.example/evil', CINEWALL_FIREBASE_PROJECT_ID: 'demo', CINEWALL_FIREBASE_APP_ID: 'web-app' }).enabled, false);
});
test('cached landing video ranges work without network and room APIs are never intercepted', async () => {
  const handlers = new Map(), bytes = new Uint8Array([0,1,2,3,4,5]); let network = 0;
  const context = vm.createContext({ URL, Response, Request, Uint8Array, Map, Set, Promise, Number,
    self: { location: { origin: 'https://test.invalid' }, addEventListener: (name, fn) => handlers.set(name, fn) },
    caches: { open: async () => ({ match: async () => new Response(bytes, { headers: { 'content-type': 'video/mp4' } }) }) }, fetch: async () => { network++; throw Error('Offline'); } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/media-worker.js'), 'utf8'), context);
  let pending; handlers.get('fetch')({ request: new Request('https://test.invalid/assets/demo.mp4', { headers: { Range: 'bytes=2-4' } }), respondWith: p => { pending = p; } });
  const response = await pending; assert.equal(response.status, 206); assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [2,3,4]); assert.equal(network, 0);
  pending = null; handlers.get('fetch')({ request: new Request('https://test.invalid/api/auth/config'), respondWith: p => { pending = p; } }); assert.equal(pending, null);
});
test('a complete streamed video range populates the cache without a second download', async () => {
  const handlers = new Map(); let calls = 0, stored, cacheWork, pending;
  const context = vm.createContext({ URL, Response, Request, Headers, Uint8Array, Map, Set, Promise, Number,
    self: { location: { origin: 'https://test.invalid' }, addEventListener: (name, fn) => handlers.set(name, fn) },
    caches: { open: async () => ({ match: async () => null, put: async (key, response) => { stored = { key, status: response.status, bytes: [...new Uint8Array(await response.arrayBuffer())] }; } }) },
    fetch: async () => { calls++; return new Response(new Uint8Array([1,2,3]), { status: 206, headers: { 'Content-Length': '3', 'Content-Range': 'bytes 0-2/3' } }); } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/media-worker.js'), 'utf8'), context);
  handlers.get('fetch')({ request: new Request('https://test.invalid/assets/demo.mp4'), respondWith: p => { pending = p; }, waitUntil: p => { cacheWork = p; } });
  const response = await pending; assert.equal(response.status, 206); await response.arrayBuffer(); await cacheWork;
  assert.equal(calls, 1); assert.equal(stored.status, 200); assert.deepEqual(stored.bytes, [1,2,3]);
});
