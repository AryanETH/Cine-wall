'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const tick = () => new Promise(setImmediate);
async function fixture(enabled = true, { profile = false, next, brandedVerification = false, holdVerification } = {}) {
  const nodes = new Map(), calls = [], navigations = [];
  function node(id) { if (!nodes.has(id)) nodes.set(id, { hidden: true, value: '', dataset: {}, handlers: {}, textContent: '', addEventListener(name, fn) { this.handlers[name] = fn; }, setAttribute() {}, reportValidity: () => true, focus() {} }); return nodes.get(id); }
  const auth = {}, sdk = { getAuth: () => auth, useDeviceLanguage() {}, setPersistence: async () => {}, browserLocalPersistence: {},
    onIdTokenChanged(a, callback) { auth.changed = user => { auth.currentUser = user; callback(user); }; auth.changed(null); }, GoogleAuthProvider: class {},
    signInWithPopup: async () => { calls.push('google'); },
    createUserWithEmailAndPassword: async (a, email) => { calls.push(['signup', email]); const user = { email, getIdToken: async () => 'test-id-token' }; auth.changed(user); return { user }; },
    updateProfile: async (user, { displayName }) => { calls.push(['name', displayName]); user.displayName = displayName; },
    reload: async user => { if (user.verifiedOutOfBand) user.emailVerified = true; },
    sendEmailVerification: async () => { calls.push('verify-email'); },
    signInWithEmailAndPassword: async () => { throw Object.assign(Error(), { code: 'auth/invalid-credential' }); },
    RecaptchaVerifier: class { clear() { calls.push('clear-captcha'); } },
    signInWithPhoneNumber: async (a, phone) => { calls.push(['sms', phone]); return { confirm: async code => { calls.push(['otp', code]); } }; },
  };
  const code = fs.readFileSync(path.join(__dirname, '../public/auth.js'), 'utf8').replace(/import\('https:\/\/www.gstatic.com\/firebasejs\/[^']+firebase-app.js'\)/, 'Promise.resolve(mockAppSdk)').replace(/import\('https:\/\/www.gstatic.com\/firebasejs\/[^']+firebase-auth.js'\)/, 'Promise.resolve(mockAuthSdk)');
  const context = vm.createContext({ URL, mockAuthSdk: sdk, mockAppSdk: { initializeApp: () => ({}) }, location: { href: `https://cinewall.test/${profile ? 'profile' : 'auth'}.html${next ? '?next=' + encodeURIComponent(next) : ''}`, origin: 'https://cinewall.test', replace: value => navigations.push(value) }, document: { body: { dataset: { authPage: profile ? 'profile' : '' } }, querySelector: node, querySelectorAll: () => [] }, localStorage: { setItem() {}, removeItem() {} }, fetch: async (url, options) => {
    if (url === '/api/auth/verify-email') { calls.push(['branded-email', options.headers.Authorization]); await holdVerification; }
    return { ok: true, json: async () => ({ enabled, config: {}, brandedVerification }) };
  } });
  await vm.runInContext(code, context); return { node, calls, navigations, auth, signIn: user => auth.changed(user) };
}
test('unconfigured auth never presents working login controls', async () => {
  const f = await fixture(false); assert.match(f.node('#authStatus').textContent, /unavailable/); assert.equal(f.node('#authForms').hidden, true); assert.equal(f.node('#authRetry').hidden, false); assert.equal(f.calls.length, 0);
});
test('email signup sends verification and clears the password; invalid login is visible', async () => {
  const f = await fixture(); f.node('#email').value = 'test@example.com'; f.node('#password').value = 'test-password';
  f.node('#emailForm').handlers.submit({ preventDefault() {} }); await tick(); assert.match(f.node('#authStatus').textContent, /Check your email/);
  f.node('#toggleSignup').handlers.click();
  assert.equal(f.node('#signupNameField').hidden, false);
  f.node('#signupName').value = '   '; f.node('#emailForm').handlers.submit({ preventDefault() {} }); await tick();
  assert.match(f.node('#authStatus').textContent, /Enter your name/);
  assert.deepEqual(f.calls, []);
  f.node('#signupName').value = '  Aisha Patel  '; f.node('#emailForm').handlers.submit({ preventDefault() {} }); await tick();
  assert.deepEqual(f.calls, [['signup', 'test@example.com'], ['name', 'Aisha Patel'], 'verify-email']); assert.equal(f.node('#password').value, '');
  assert.deepEqual(f.navigations, []);
  assert.match(f.node('#verificationHelp').textContent, /spam or junk/);
});
test('SMS validates international numbers and confirms the provider code after sending', async () => {
  const f = await fixture(); f.node('#phone').value = '98765'; f.node('#phoneForm').handlers.submit({ preventDefault() {} }); await tick();
  assert.equal(f.calls.length, 0); assert.match(f.node('#authStatus').textContent, /country code/);
  f.node('#phone').value = '+91 98765 43210'; f.node('#phoneForm').handlers.submit({ preventDefault() {} }); await tick();
  assert.equal(f.node('#codeForm').hidden, false); f.node('#otp').value = '123456'; f.node('#codeForm').handlers.submit({ preventDefault() {} }); await tick();
  assert.deepEqual(f.calls, [['sms', '+919876543210'], 'clear-captcha', ['otp', '123456']]); assert.equal(f.node('#otp').value, '');
});

const signedInUser = { email: 'test@example.com', emailVerified: true, getIdToken: async () => 'test-id-token' };
test('default sign-in goes to the dashboard and rejects external return targets', async () => {
  for (const next of [undefined, 'https://untrusted.invalid/?account=open']) {
    const f = await fixture(true, { profile: false, next });
    f.signIn(signedInUser); await tick();
    assert.deepEqual(f.navigations, ['/admin.html?mode=video']);
  }
});
test('account and shared player links retain their destination after sign-in', async () => {
  for (const next of ['/?account=open', '/profile.html', '/screen.html?screen=2&room=example-room']) {
    const f = await fixture(true, { profile: false, next });
    f.signIn(signedInUser); await tick(); assert.deepEqual(f.navigations, [next]);
  }
});
test('signup waits for a verified email before entering the dashboard', async () => {
  let finish;
  const holdVerification = new Promise(resolve => { finish = resolve; });
  const f = await fixture(true, { brandedVerification: true, holdVerification });
  f.node('#email').value = 'test@example.com'; f.node('#password').value = 'test-password'; f.node('#signupName').value = 'Aisha Patel';
  f.node('#toggleSignup').handlers.click();
  f.node('#emailForm').handlers.submit({ preventDefault() {} }); await tick();
  assert.deepEqual(f.calls, [['signup', 'test@example.com'], ['name', 'Aisha Patel'], ['branded-email', 'Bearer test-id-token']]);
  assert.deepEqual(f.navigations, []);
  finish(); await tick();
  assert.deepEqual(f.navigations, []);
  f.node('#checkVerification').handlers.click(); await tick();
  assert.deepEqual(f.navigations, []);
  f.auth.currentUser.verifiedOutOfBand = true;
  f.node('#checkVerification').handlers.click(); await tick();
  assert.deepEqual(f.navigations, ['/admin.html?mode=video']);
});
