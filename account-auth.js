'use strict';
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const firebaseConfig = require('./firebase-config');
const { clientAddress, sameOrigin, secureRequest } = require('./request-security');
const COOKIE = 'cinewall_account';
// Static files decode URL escapes and resolve separators. Apply that same
// normalization before authorization, including encoded dots and slashes.
function canonicalPath(pathname) {
  try { return path.posix.normalize(decodeURIComponent(pathname).replace(/\\/g, '/')); }
  catch { return pathname; }
}
const protectedPage = pathname => /^\/(?:admin|screen|share|mic|remote|room|connect|profile)\.html$/i.test(canonicalPath(pathname));
function protectedRequest(pathname) {
  const route = canonicalPath(pathname);
  return protectedPage(pathname)
    || route.startsWith('/api/') && !['/api/health', '/api/demo-visits', '/api/auth/config'].includes(pathname)
    || ['/events', '/share-events', '/mic-events'].includes(route)
    || route.startsWith('/__cinewall_peer__/');
}
const verifiedEmail = user => user.email_verified === true && typeof user.email === 'string' && Boolean(user.email.trim());
function createVerifier({ projectId, fetchCertificates = fetch, keyResolver, now = Date.now } = {}) {
  let certificates = {}, expires = 0, pending, lastFetchAttempt = -Infinity;
  const keys = new Map();
  async function resolve(header) {
    if (typeof header.kid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(header.kid) || header.alg !== 'RS256') throw Error('Invalid signing key');
    if (keyResolver) return keyResolver(header);
    const expired = now() >= expires;
    if (expired || !Object.hasOwn(certificates, header.kid)) {
      pending ||= (async () => {
        if (now() - lastFetchAttempt < (expired ? 5000 : 30000)) return;
        lastFetchAttempt = now();
        const response = await fetchCertificates('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw Error('Sign-in verification is unavailable');
        const next = await response.json();
        if (!next || typeof next !== 'object' || Array.isArray(next)) throw Error('Invalid signing keys');
        certificates = next; keys.clear();
        const ttl = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') || '')?.[1] || 300);
        expires = now() + Math.min(21600, Math.max(30, ttl)) * 1000;
      })().finally(() => { pending = null; });
      await pending;
    }
    if (now() >= expires) throw Error('Sign-in verification is unavailable');
    if (!Object.hasOwn(certificates, header.kid) || typeof certificates[header.kid] !== 'string') throw Error('Unknown signing key');
    if (!keys.has(header.kid)) keys.set(header.kid, await (await import('jose')).importX509(certificates[header.kid], 'RS256'));
    return keys.get(header.kid);
  }
  return async token => {
    if (!projectId || typeof token !== 'string' || token.length > 16384) throw Error('Sign in required');
    const { payload } = await (await import('jose')).jwtVerify(token, resolve, {
      issuer: `https://securetoken.google.com/${projectId}`, audience: projectId, algorithms: ['RS256'],
      requiredClaims: ['exp','iat','sub','auth_time'], currentDate: new Date(now()),
    });
    const seconds = Math.floor(now() / 1000);
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128 || !Number.isFinite(payload.auth_time) || payload.auth_time > seconds || payload.auth_time < 0 || payload.iat > seconds) throw Error('Invalid sign-in');
    return payload;
  };
}
function createAccountAuth({ verifyToken = createVerifier({ projectId: firebaseConfig().config?.projectId }), sendVerification, now = Date.now, maxSessions = 10000 } = {}) {
  const sessions = new Map();
  const verificationAttempts = new Map();
  const signInAttempts = new Map();
  const activeByAccount = new Map();
  let verificationWindowEnd = 0, verificationCount = 0;
  let signInWindowEnd = 0, signInCount = 0, activeResponses = 0, pendingChecks = 0;
  const cookieId = req => (secureRequest(req)
    ? /(?:^|;\s*)__Host-cinewall_account=([A-Za-z0-9_-]{43})(?:;|$)/
    : /(?:^|;\s*)cinewall_account=([A-Za-z0-9_-]{43})(?:;|$)/).exec(req.headers.cookie || '')?.[1];
  function revoke(id) { const session = sessions.get(id); if (session) { sessions.delete(id); for (const response of session.responses) response.destroy(); } }
  function current(req) { const id = cookieId(req), session = sessions.get(id); if (session && session.expires > now()) return session; if (session) revoke(id); return null; }
  function cookie(req, value, maxAge) {
    const secure = secureRequest(req);
    return `${secure ? '__Host-' : ''}${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  function mayAttemptSignIn(req, res) {
    const time = now();
    if (time >= signInWindowEnd) {
      signInWindowEnd = time + 60000;
      signInCount = 0;
      signInAttempts.clear();
    }
    const address = clientAddress(req);
    const count = signInAttempts.get(address) || 0;
    if (count >= 90 || signInCount >= 600) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((signInWindowEnd - time) / 1000))));
      json(res, 429, { error: 'Too many sign-in requests. Try again shortly.' });
      return false;
    }
    signInAttempts.set(address, count + 1);
    signInCount++;
    return true;
  }
  async function checkToken(token) {
    if (pendingChecks >= 32) throw Object.assign(Error('Sign-in verification is busy.'), { status: 503 });
    pendingChecks++;
    try { return await verifyToken(token); }
    finally { pendingChecks--; }
  }
  function trackResponse(session, res) {
    const uid = session.user.sub;
    const active = activeByAccount.get(uid) || 0;
    if (active >= 64 || activeResponses >= 2048) {
      res.setHeader('Retry-After', '2');
      json(res, 429, { error: 'Too many active connections. Close unused CineWall tabs and try again.' });
      return false;
    }
    activeByAccount.set(uid, active + 1);
    activeResponses++;
    session.responses.add(res);
    let timer;
    function checkExpiry() {
      const remaining = session.expires - now();
      if (remaining <= 0) res.destroy();
      else {
        timer = setTimeout(checkExpiry, remaining);
        timer.unref();
      }
    }
    function cleanup() {
      res.off('close', cleanup);
      res.off('finish', cleanup);
      clearTimeout(timer);
      session.responses.delete(res);
      activeResponses--;
      const remaining = activeByAccount.get(uid) - 1;
      if (remaining) activeByAccount.set(uid, remaining);
      else activeByAccount.delete(uid);
    }
    res.once('close', cleanup);
    res.once('finish', cleanup);
    checkExpiry();
    return !res.destroyed;
  }
  async function handle(req, res, url, bodyJson) {
    if (url.pathname === '/api/auth/verify-email') {
      if (req.method !== 'POST' || !sameOrigin(req)) { json(res, 403, { error: 'Open CineWall directly to verify your email.' }); return true; }
      if (!sendVerification) { json(res, 503, { error: 'Branded verification is unavailable.' }); return true; }
      if (!mayAttemptSignIn(req, res)) return true;
      const token = /^Bearer ([A-Za-z0-9._-]+)$/.exec(req.headers.authorization || '')?.[1];
      let user;
      try { if (token) user = await checkToken(token); } catch {}
      if (!user) { json(res, 401, { error: 'Sign in to verify your email.' }); return true; }
      if (user.email_verified === true) { json(res, 200, { verified: true }); return true; }
      const email = user.email;
      if (typeof email !== 'string' || email.length > 254 || !/^[^\s,;<>@]+@[^\s,;<>@]+$/.test(email)) {
        json(res, 400, { error: 'This account does not have an email address.' }); return true;
      }
      const time = now(), recipient = email.toLowerCase();
      if (time >= verificationWindowEnd) {
        verificationWindowEnd = time + 24 * 60 * 60 * 1000;
        verificationCount = 0;
      }
      for (const [address, retryAt] of verificationAttempts) if (retryAt <= time) verificationAttempts.delete(address);
      if (verificationAttempts.has(recipient) || verificationCount >= 100) {
        json(res, 429, { error: 'Too many verification requests. Try again later.' }); return true;
      }
      verificationAttempts.set(recipient, time + 60000);
      verificationCount += 1;
      try { await sendVerification({ email, name: user.name }); json(res, 200, { sent: true }); }
      catch { json(res, 502, { error: 'The verification email could not be sent.' }); }
      return true;
    }
    if (url.pathname === '/api/auth/session') {
      if (req.method === 'GET') {
        const session = current(req);
        json(res, 200, { authenticated: Boolean(session), ...(session && { account: session.account }) });
        return true;
      }
      if (req.method !== 'POST' || !sameOrigin(req)) { json(res, 403, { error: 'Open CineWall directly to sign in.' }); return true; }
      if (!mayAttemptSignIn(req, res)) return true;
      try {
        const { idToken } = await bodyJson(req), user = await checkToken(idToken);
        if (res.destroyed) return true;
        if (!verifiedEmail(user)) {
          revoke(cookieId(req));
          res.setHeader('Set-Cookie', cookie(req, '', 0));
          json(res, 403, { code: 'EMAIL_VERIFICATION_REQUIRED', error: 'Verify your email to continue.' });
          return true;
        }
        const account = { email: user.email, name: typeof user.name === 'string' ? user.name.trim().slice(0, 80) : '' };
        for (const [id, session] of sessions) if (session.expires <= now()) revoke(id);
        const previousId = cookieId(req), previous = current(req);
        if (previous && previous.user.sub === user.sub) {
          previous.expires = Math.max(previous.expires, user.exp * 1000);
          previous.account = account;
          res.setHeader('Set-Cookie', cookie(req, previousId, Math.max(0, Math.floor((previous.expires - now()) / 1000))));
        } else {
          if (sessions.size >= maxSessions) { json(res, 503, { error: 'Sign-in is busy. Try again shortly.' }); return true; }
          revoke(previousId); const id = randomBytes(32).toString('base64url');
          sessions.set(id, { user: { sub: user.sub }, account, expires: user.exp * 1000, responses: new Set() });
          res.setHeader('Set-Cookie', cookie(req, id, Math.max(0, Math.floor(user.exp - now() / 1000))));
        }
        json(res, 200, { authenticated: true, account });
      } catch (error) {
        if (!res.destroyed) json(res, error.status || 401, { error: error.status ? error.message : 'Your sign-in could not be verified. Please sign in again.' });
      }
      return true;
    }
    if (url.pathname === '/api/auth/logout') {
      if (req.method !== 'POST' || !sameOrigin(req)) { json(res, 403, { error: 'Open CineWall directly to sign out.' }); return true; }
      revoke(cookieId(req)); res.setHeader('Set-Cookie', cookie(req, '', 0)); json(res, 200, { authenticated: false }); return true;
    }
    if (!protectedRequest(url.pathname)) return false;
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    let session = current(req);
    // Browsers send Origin on same-origin writes. A client using an explicit
    // bearer token need not send Origin, but an origin it supplies must match.
    if (unsafe && (session || req.headers.origin !== undefined) && !sameOrigin(req)) {
      json(res, 403, { error: 'Open CineWall directly to use this room.' });
      return true;
    }
    if (!session && /^Bearer [A-Za-z0-9._-]+$/.test(req.headers.authorization || '')) {
      try {
        const user = await checkToken(req.headers.authorization.slice(7));
        if (res.destroyed) return true;
        if (!verifiedEmail(user)) {
          json(res, 403, { code: 'EMAIL_VERIFICATION_REQUIRED', error: 'Verify your email to continue.' });
          return true;
        }
        session = { user: { sub: user.sub }, expires: user.exp * 1000, responses: new Set() };
      } catch (error) {
        if (error.status === 503) { json(res, 503, { error: error.message }); return true; }
      }
    }
    if (!session) {
      if (protectedPage(url.pathname) && ['GET','HEAD'].includes(req.method)) {
        res.writeHead(302, { Location: `/auth.html?next=${encodeURIComponent(url.pathname + url.search)}`, 'Cache-Control': 'no-store' }); res.end();
      } else json(res, 401, { error: 'Sign in to continue.', code: 'SIGN_IN_REQUIRED' });
      return true;
    }
    if (res.destroyed || !trackResponse(session, res)) return true;
    req.cinewallAccount = session.user;
    res.setHeader('Cache-Control', 'no-store');
    return false;
  }
  return { handle, current, close: () => { for (const id of sessions.keys()) revoke(id); } };
}
module.exports = { createVerifier, createAccountAuth, protectedPage, protectedRequest };
