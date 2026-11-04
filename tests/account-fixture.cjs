'use strict';
const crypto = require('node:crypto'), child = require('node:child_process'), nativeHttp = require('node:http');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const parts = [encode({ alg: 'RS256', kid: 'test-key' }), encode({ iss: 'https://securetoken.google.com/cinewall-test', aud: 'cinewall-test', sub: 'test-account', iat: now, auth_time: now, exp: now + 3600 })].join('.');
const token = `${parts}.${crypto.sign('RSA-SHA256', Buffer.from(parts), privateKey).toString('base64url')}`;
const headers = supplied => ({ ...supplied, Authorization: `Bearer ${token}` });
module.exports.spawn = (command, args, options) => child.spawn(command, args?.[0] === 'server.js' ? ['tests/account-server.cjs', ...args.slice(1)] : args, { ...options, env: { ...options?.env, CINEWALL_TEST_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }) } });
module.exports.execFileSync = child.execFileSync;
module.exports.fetch = (input, init = {}) => fetch(input, { ...init, headers: headers(init.headers instanceof Headers ? Object.fromEntries(init.headers) : init.headers) });
module.exports.http = { ...nativeHttp };
for (const method of ['get','request']) module.exports.http[method] = (input, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {}; }
  if (typeof input === 'string' || input instanceof URL) return nativeHttp[method](input, { ...options, headers: headers(options?.headers) }, callback);
  return nativeHttp[method]({ ...input, ...options, headers: headers({ ...input.headers, ...options?.headers }) }, callback);
};
