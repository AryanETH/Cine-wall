'use strict';

const { STATUS_CODES } = require('node:http');

const pages = {
  400: ['That link looks incomplete', 'Check the address or ask the host to send you a fresh room link.'],
  401: ['Sign in to continue', 'This page needs a CineWall account or an active session.', '/auth.html', 'Sign in'],
  403: ['This page is restricted', 'Ask the host for the correct link or return to CineWall.'],
  404: ['This page is missing', 'The link may be out of date, or the page may have moved.'],
  405: ['That action is unavailable', 'Return to CineWall and try opening the page again.'],
  408: ['The request timed out', 'Check your connection, then try again.', '', 'Retry'],
  409: ['Something changed', 'Open the page again to get the latest room or session state.', '', 'Retry'],
  410: ['This link has expired', 'Ask the host for a fresh link or return to CineWall.'],
  413: ['This file is too large', 'Choose a smaller file and try again.'],
  415: ['This file type is unsupported', 'Go back and choose a file in a supported format.'],
  422: ['This request needs a change', 'Check the information you entered and try again.'],
  429: ['Too many attempts', 'Wait a moment before trying again.', '', 'Retry'],
  500: ['Something went wrong', 'CineWall could not load this page. Give it a moment and try again.', '', 'Retry'],
  502: ['CineWall could not connect', 'Try again in a moment.', '', 'Retry'],
  503: ['CineWall is temporarily unavailable', 'Please try again in a moment.', '', 'Retry'],
  504: ['CineWall took too long to respond', 'Check your connection and try again.', '', 'Retry'],
};

function pagePath(req) {
  const destination = req.headers['sec-fetch-dest'];
  if (destination && destination !== 'document') return null;
  let pathname = '';
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
    pathname = new URL(decodeURIComponent(pathname).replace(/\\/g, '/').replace(/\/+/g, '/'), 'http://localhost').pathname;
  } catch {}
  if (/^\/(?:api(?:\/|$)|advt\/api(?:\/|$)|__cinewall_peer__(?:\/|$)|(?:events|share-events|mic-events)\/?$)/i.test(pathname)) return null;
  const acceptsHtml = String(req.headers.accept || '').split(',').some(part => {
    const [media, ...parameters] = part.toLowerCase().split(';').map(value => value.trim());
    return media === 'text/html' && !parameters.some(value => /^q\s*=\s*0(?:\.0*)?$/.test(value));
  });
  return acceptsHtml ? pathname : null;
}

function sendPageError(req, res, status) {
  const pathname = pagePath(req);
  if (pathname === null) return false;
  if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
  const copyForPage = status === 401 && /^\/advt(?:\/|$)/.test(pathname)
    ? ['Unlock the ads dashboard', 'Open the ads login and enter the dashboard password.', '/advt', 'Open ads login']
    : pages[status] || [STATUS_CODES[status] || 'Page unavailable', 'Return to CineWall and try again from there.'];
  const [heading, copy, href = '/', action = 'Go home'] = copyForPage;
  // Only this catalog and the built-in HTTP status names enter the markup.
  const body = Buffer.from([
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    '<title>' + status + ' · ' + heading + ' | CineWall</title>',
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="stylesheet" href="/page-error.css">',
    '<script src="/theme.js"></script></head>',
    '<body class="error-body"><main class="error-card">',
    '<a class="error-brand" href="/">CineWall</a>',
    '<div class="error-content"><section aria-labelledby="errorTitle">',
    '<p class="error-status">Error ' + status + '</p><h1 id="errorTitle">' + heading + '</h1>',
    '<p class="error-copy">' + copy + '</p><div class="error-actions">',
    '<a class="error-primary" href="' + href + '">' + action + '</a>',
    href !== '/' ? '<a class="error-home" href="/">Go home</a>' : '',
    '</div></section><img class="error-frog" src="/assets/cinewall-error-frog.png?v=1" alt="" width="640" height="616">',
    '</div></main></body></html>',
  ].join('\n'));
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Vary': 'Accept, Sec-Fetch-Dest',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

module.exports = { sendPageError };

