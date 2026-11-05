'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountAuth } = require('../account-auth');
const { createVerificationSender, verificationMessage } = require('../verification-email');

const link = 'https://project.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=test-code';
test('verification email escapes the greeting and includes clickable and copyable links', () => {
  const { html, text } = verificationMessage({ name: 'Aisha <Patel>', link });
  const escaped = link.replace('&', '&amp;');
  assert.ok(html.includes('Hello Aisha &lt;Patel&gt;,'));
  assert.ok(html.includes(`href="${escaped}" style="color:#ceff51;font-weight:bold;text-decoration:underline">Click here</a>`));
  assert.ok(html.includes(`>${escaped}</a>`));
  assert.ok(text.includes(`\n${link}\n`));
  assert.match(text, /ignore this email\.\n\nThanks,\nTeam CineWall/);
  assert.match(html, /linkedin\.com/);
});

test('branded sender generates a Firebase action link before sending the formatted email', async () => {
  const { generateKeyPair, exportPKCS8 } = await import('jose');
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const calls = [];
  const send = createVerificationSender({
    projectId: 'project',
    env: {
      CINEWALL_FIREBASE_MAIL_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'project', client_email: 'service@example.test', private_key: await exportPKCS8(privateKey) }),
      CINEWALL_RESEND_API_KEY: 'test-key', CINEWALL_VERIFICATION_FROM: 'CineWall <verify@example.test>',
    },
    request: async (url, options) => {
      calls.push({ url, ...options });
      const json = url.includes('oauth2') ? { access_token: 'test-google-token', expires_in: 3600 }
        : url.includes('identitytoolkit') ? { oobLink: link } : { id: 'test-email' };
      return { ok: true, json: async () => json };
    },
  });
  await send({ email: 'viewer@example.test', name: 'Aisha Patel' });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, 'https://identitytoolkit.googleapis.com/v1/projects/project/accounts:sendOobCode');
  assert.deepEqual(JSON.parse(calls[1].body), { requestType: 'VERIFY_EMAIL', email: 'viewer@example.test', returnOobLink: true });
  assert.equal(calls[2].url, 'https://api.resend.com/emails');
  const email = JSON.parse(calls[2].body);
  assert.deepEqual(email.to, ['viewer@example.test']);
  assert.ok(email.text.includes(link));
  assert.match(email.html, /Hello Aisha Patel,/);
});

test('verification only sends to the signed-in user and throttles resends', async () => {
  const deliveries = [];
  const auth = createAccountAuth({
    verifyToken: async token => {
      if (token !== 'signed-token') throw Error('Invalid token');
      return { sub: 'viewer', email: 'viewer@example.test', name: 'Aisha Patel' };
    },
    sendVerification: async user => { deliveries.push(user); },
  });
  async function post({ origin = 'https://cinewall.test', authorization } = {}) {
    let status;
    const req = { method: 'POST', headers: { origin, authorization, host: 'cinewall.test' } };
    const res = { writeHead(code) { status = code; }, end() {} };
    await auth.handle(req, res, new URL('/api/auth/verify-email', origin), async () => ({ email: 'untrusted@example.test' }));
    return status;
  }
  assert.equal(await post(), 401);
  assert.equal(await post({ origin: 'https://untrusted.test', authorization: 'Bearer signed-token' }), 403);
  assert.equal(await post({ authorization: 'Bearer signed-token' }), 200);
  assert.equal(await post({ authorization: 'Bearer signed-token' }), 429);
  assert.deepEqual(deliveries, [{ email: 'viewer@example.test', name: 'Aisha Patel' }]);
});
