'use strict';
const { randomBytes } = require('node:crypto');
const { isIP } = require('node:net');
const path = require('node:path');
const firebaseConfig = require('./firebase-config');
const COOKIE = 'cinewall_account';
function localHost(host) {
  const hostname = String(host).replace(/:\d+$/, '').toLowerCase();
  return ['localhost','127.0.0.1','[::1]'].includes(hostname) || Boolean(isIP(hostname) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname));
}
// Static files decode URL escapes and resolve separators. Apply that same
// normalization before authorization, including encoded dots and slashes.
function canonicalPath(pathname) {
  try { return path.posix.normalize(decodeURIComponent(pathname).replace(/\\/g, '/')); }
  catch { return pathname; }
}
const protectedPage = pathname => /^\/(?:admin|screen|share|mic|room|connect|profile)\.html$/i.test(canonicalPath(pathname));
const protectedRequest = pathname => protectedPage(pathname) || pathname.startsWith('/api/') && !['/api/health','/api/demo-visits','/api/auth/config'].includes(pathname) || ['/events','/share-events','/mic-events'].includes(pathname) || pathname.startsWith('/__cinewall_peer__/');
const verifiedEmail = user => user.email_verified === true && typeof user.email === 'string' && Boolean(user.email.trim());
function createVerifier({ projectId, fetchCertificates = fetch, keyResolver, now = Date.now } = {}) {
  let certificates = {}, expires = 0, pending, lastFetch = 0;
  const keys = new Map();
  async function resolve(header) {
    if (!header.kid || header.alg !== 'RS256') throw Error('Invalid signing key');
    if (keyResolver) return keyResolver(header);
    if (now() >= expires || !certificates[header.kid] && now() - lastFetch > 30000) {
      pending ||= (async () => {
        const response = await fetchCertificates('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw Error('Sign-in verification is unavailable');
        const next = await response.json();
        if (!next || typeof next !== 'object' || Array.isArray(next)) throw Error('Invalid signing keys');
        certificates = next; keys.clear(); lastFetch = now();
        const ttl = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') || '')?.[1] || 300);
        expires = now() + Math.min(21600, Math.max(30, ttl)) * 1000;
      })().finally(() => { pending = null; });
      await pending;
    }
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
  let verificationWindowEnd = 0, verificationCount = 0;
  const cookieId = req => /(?:^|;\s*)cinewall_account=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  function revoke(id) { const session = sessions.get(id); if (session) { sessions.delete(id); for (const response of session.responses) response.destroy(); } }
  function current(req) { const id = cookieId(req), session = sessions.get(id); if (session && session.expires > now()) return session; if (session) revoke(id); return null; }
  function sameOrigin(req) {
    try {
      const origin = new URL(req.headers.origin), host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
      return origin.host === host && origin.protocol === (req.socket?.encrypted || !localHost(host) ? 'https:' : 'http:');
    } catch { return false; }
  }
  function cookie(req, value, maxAge) {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${req.socket?.encrypted || !localHost(host) ? '; Secure' : ''}`;
  }
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  async function handle(req, res, url, bodyJson) {
    if (url.pathname === '/api/auth/verify-email') {
      if (req.method !== 'POST' || !sameOrigin(req)) { json(res, 403, { error: 'Open CineWall directly to verify your email.' }); return true; }
      if (!sendVerification) { json(res, 503, { error: 'Branded verification is unavailable.' }); return true; }
      const token = /^Bearer ([A-Za-z0-9._-]+)$/.exec(req.headers.authorization || '')?.[1];
      let user;
      try { if (token) user = await verifyToken(token); } catch {}
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
      try {
        const { idToken } = await bodyJson(req), user = await verifyToken(idToken);
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
          previous.expires = user.exp * 1000;
          previous.account = account;
          res.setHeader('Set-Cookie', cookie(req, previousId, Math.max(0, Math.floor((previous.expires - now()) / 1000))));
        } else {
          if (sessions.size >= maxSessions) { json(res, 503, { error: 'Sign-in is busy. Try again shortly.' }); return true; }
          revoke(previousId); const id = randomBytes(32).toString('base64url');
          sessions.set(id, { user: { sub: user.sub }, account, expires: user.exp * 1000, responses: new Set() });
          res.setHeader('Set-Cookie', cookie(req, id, Math.max(0, Math.floor(user.exp - now() / 1000))));
        }
        json(res, 200, { authenticated: true, account });
      } catch { json(res, 401, { error: 'Your sign-in could not be verified. Please sign in again.' }); }
      return true;
    }
    if (url.pathname === '/api/auth/logout') {
      if (req.method !== 'POST' || !sameOrigin(req)) { json(res, 403, { error: 'Open CineWall directly to sign out.' }); return true; }
      revoke(cookieId(req)); res.setHeader('Set-Cookie', cookie(req, '', 0)); json(res, 200, { authenticated: false }); return true;
    }
    if (!protectedRequest(url.pathname)) return false;
    let session = current(req);
    if (!session && /^Bearer [A-Za-z0-9._-]+$/.test(req.headers.authorization || '')) {
      try {
        const user = await verifyToken(req.headers.authorization.slice(7));
        if (!verifiedEmail(user)) {
          json(res, 403, { code: 'EMAIL_VERIFICATION_REQUIRED', error: 'Verify your email to continue.' });
          return true;
        }
        session = { user: { sub: user.sub }, expires: user.exp * 1000, responses: new Set() };
      } catch {}
    }
    if (!session) {
      if (protectedPage(url.pathname) && ['GET','HEAD'].includes(req.method)) {
        res.writeHead(302, { Location: `/auth.html?next=${encodeURIComponent(url.pathname + url.search)}`, 'Cache-Control': 'no-store' }); res.end();
      } else json(res, 401, { error: 'Sign in to continue.', code: 'SIGN_IN_REQUIRED' });
      return true;
    }
    req.cinewallAccount = session.user;
    res.setHeader('Cache-Control', 'no-store');
    session.responses.add(res);
    const timer = setTimeout(() => res.destroy(), Math.max(1, session.expires - now())); timer.unref?.();
    const cleanup = () => { clearTimeout(timer); session.responses.delete(res); };
    res.once('close', cleanup); res.once('finish', cleanup);
    return false;
  }
  return { handle, current, close: () => { for (const id of sessions.keys()) revoke(id); } };
}
module.exports = { createVerifier, createAccountAuth, protectedPage, protectedRequest };
