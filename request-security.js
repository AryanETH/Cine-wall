'use strict';

const { isIP } = require('node:net');

function isLocalHost(host) {
  const hostname = String(host || '').toLowerCase().replace(/:\d+$/, '');
  return ['localhost', '[::1]'].includes(hostname) || isIP(hostname) === 4
    && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
}

function secureRequest(req) {
  return Boolean(req.socket?.encrypted) || !isLocalHost(req.headers.host);
}

function sameOrigin(req) {
  const host = req.headers.host;
  if (!req.headers.origin || typeof host !== 'string'
      || !/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d+)?$/i.test(host)) return false;
  try {
    // The HTTPS ingress must preserve Host. Never use a forwarded host to
    // authorize a write or decide whether to send a secure session cookie.
    return req.headers.origin === new URL(`${secureRequest(req) ? 'https' : 'http'}://${host}`).origin;
  } catch {
    return false;
  }
}

function clientAddress(req) {
  const trust = process.env.CINEWALL_TRUST_PROXY;
  let forwarded;
  if (trust === 'real-ip') forwarded = String(req.headers['x-real-ip'] || '').trim();
  if (trust === '1') forwarded = String(req.headers['x-forwarded-for'] || '').split(',').at(-1).trim();
  return isIP(forwarded) ? forwarded : req.socket?.remoteAddress || 'unknown';
}

function securityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // YouTube embeds and restricted Firebase API keys need an origin referrer.
  // A room URL or ticket is never part of the referrer.
  res.setHeader('Referrer-Policy', 'strict-origin');
  if (secureRequest(req) && !isLocalHost(req.headers.host)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
}

module.exports = { isLocalHost, secureRequest, sameOrigin, clientAddress, securityHeaders };
