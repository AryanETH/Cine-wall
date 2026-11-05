'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const { createVerifier, createAccountAuth, protectedRequest } = require('../account-auth');
async function signing() {
  const jose = await import('jose'), pair = await jose.generateKeyPair('RS256');
  const now = Math.floor(Date.now() / 1000), projectId = 'test-project';
  const claims = { iss: `https://securetoken.google.com/${projectId}`, aud: projectId, sub: 'verified-user', email: 'viewer@example.test', email_verified: true, name: 'Test Viewer', exp: now + 3600, iat: now, auth_time: now };
  const token = (changes = {}, key = pair.privateKey) => new jose.SignJWT({ ...claims, ...changes }).setProtectedHeader({ alg: 'RS256', kid: 'trusted-key' }).sign(key);
  const verifyToken = createVerifier({ projectId, keyResolver: () => pair.publicKey });
  return { jose, pair, token, verifyToken, now };
}
test('Firebase verification rejects wrong audience/issuer, expired/future tokens, empty subjects and bad signatures', async () => {
  const f = await signing(); assert.equal((await f.verifyToken(await f.token())).sub, 'verified-user');
  for (const claims of [{ aud: 'other-project' }, { iss: 'https://evil.invalid' }, { exp: f.now - 1 }, { iat: f.now + 60 }, { auth_time: f.now + 60 }, { sub: '' }, { sub: 'x'.repeat(129) }]) await assert.rejects(f.verifyToken(await f.token(claims)));
  const wrong = await f.jose.generateKeyPair('RS256'); await assert.rejects(f.verifyToken(await f.token({}, wrong.privateKey)));
  await assert.rejects(f.verifyToken('eyJhbGciOiJub25lIn0.e30.'));
});
test('every workspace, room API and media route requires an account while landing media stays public', () => {
  for (const route of ['/admin.html','/screen.html','/share.html','/mic.html','/room.html','/connect.html','/profile.html','/%61dmin.html','/screen%2ehtml','/x%2f..%2fadmin.html','//admin.html','/api/rooms/create','/api/command','/api/media/stream','/events','/share-events','/mic-events','/__cinewall_peer__/123']) assert.equal(protectedRequest(route), true, route);
  for (const route of ['/','/auth.html','/assets/cinewall-demo-fast.mp4','/api/auth/config','/api/health','/api/demo-visits']) assert.equal(protectedRequest(route), false, route);
});
test('account sessions require signed tokens and same-origin requests, preserve room return links and revoke on logout', async t => {
  const f = await signing(), auth = createAccountAuth({ verifyToken: f.verifyToken });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (await auth.handle(req, res, url, async () => { let text = ''; for await (const part of req) text += part; return JSON.parse(text); })) return;
    if (url.pathname === '/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: connected\n\n'); }
    else { res.writeHead(200); res.end('Allowed'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { auth.close(); server.closeAllConnections(); server.close(); });
  const denied = await fetch(`${base}/screen.html?screen=2&room=private-room`, { redirect: 'manual' });
  assert.equal(denied.status, 302); assert.equal(new URL(denied.headers.get('location'), base).searchParams.get('next'), '/screen.html?screen=2&room=private-room');
  assert.equal((await fetch(base + '/api/rooms/create', { method: 'POST' })).status, 401);
  const post = (route, body, headers = {}) => fetch(base + route, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('/api/auth/session', { idToken: 'forged' })).status, 401);
  const unverified = await f.token({ email_verified: false });
  const blocked = await post('/api/auth/session', { idToken: unverified });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, 'EMAIL_VERIFICATION_REQUIRED');
  assert.match(blocked.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await fetch(base + '/api/rooms/create', { method: 'POST', headers: { Authorization: `Bearer ${unverified}` } })).status, 403);
  const phoneOnly = await f.token({ email: undefined, email_verified: undefined });
  assert.equal((await post('/api/auth/session', { idToken: phoneOnly })).status, 403);
  assert.equal((await post('/api/auth/session', { idToken: await f.token() }, { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await post('/api/auth/session', { idToken: await f.token() }, { Origin: base.replace('http:', 'https:') })).status, 403, 'the origin scheme must also match');
  const login = await post('/api/auth/session', { idToken: await f.token() }); assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie'); assert.match(cookie, /HttpOnly; SameSite=Lax/); assert.equal(cookie.includes('verified-user'), false);
  const headers = { Cookie: cookie.split(';')[0] };
  assert.deepEqual(await (await fetch(base + '/api/auth/session', { headers })).json(), {
    authenticated: true, account: { email: 'viewer@example.test', name: 'Test Viewer' },
  });
  assert.equal((await fetch(base + '/api/rooms/create', { method: 'POST', headers })).status, 200);
  assert.equal((await fetch(base + '/profile.html', { headers })).status, 200);
  assert.equal((await post('/api/auth/logout', {}, { ...headers, Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await fetch(base + '/profile.html', { headers })).status, 200, 'a cross-site logout does not revoke the session');
  const stream = await fetch(base + '/events', { headers }), reader = stream.body.getReader(); await reader.read();
  const loggedOut = await post('/api/auth/logout', {}, headers); assert.equal(loggedOut.status, 200); assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0/);
  await assert.rejects(reader.read());
  assert.equal((await fetch(base + '/api/status', { headers })).status, 401, 'the old cookie cannot be replayed after logout');
});
