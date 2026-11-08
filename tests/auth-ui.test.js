'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const tick = () => new Promise(setImmediate);
async function fixture(enabled = true, {
  profile = false, next, intent, returning = false, brandedVerification = false, holdVerification,
  initialUser = null, cookieAccount, customize, onSession = () => ({ ok: true }),
} = {}) {
  const nodes = new Map(), calls = [], navigations = [];
  const browserEvents = {};
  const storage = new Map(returning ? [['cinewall-account-returning', '1']] : []);
  function node(id) { if (!nodes.has(id)) nodes.set(id, { hidden: true, value: '', dataset: {}, handlers: {}, textContent: '', addEventListener(name, fn) { this.handlers[name] = fn; }, setAttribute() {}, reportValidity: () => true, focus() {} }); return nodes.get(id); }
  const auth = {}, sdk = { getAuth: () => auth, useDeviceLanguage() {}, setPersistence: async () => {}, browserLocalPersistence: {},
    onIdTokenChanged(a, callback) { auth.changed = user => { auth.currentUser = user; callback(user); }; auth.changed(initialUser); }, GoogleAuthProvider: class {},
    signInWithPopup: async () => { calls.push('google'); },
    createUserWithEmailAndPassword: async (a, email) => { calls.push(['signup', email]); const user = { email, getIdToken: async () => 'test-id-token' }; auth.changed(user); return { user }; },
    updateProfile: async (user, { displayName }) => { calls.push(['name', displayName]); user.displayName = displayName; },
    reload: async user => { if (user.verifiedOutOfBand) user.emailVerified = true; },
    sendEmailVerification: async () => { calls.push('verify-email'); },
    signInWithEmailAndPassword: async () => { throw Object.assign(Error(), { code: 'auth/invalid-credential' }); },
    RecaptchaVerifier: class { clear() { calls.push('clear-captcha'); } },
    signInWithPhoneNumber: async (a, phone) => { calls.push(['sms', phone]); return { confirm: async code => { calls.push(['otp', code]); } }; },
    signOut: async () => { calls.push('firebase-logout'); auth.changed(null); },
  };
  customize?.({ sdk, auth, calls });
  const emailTab = node('emailTab'), phoneTab = node('phoneTab');
  emailTab.dataset.authTab = 'email'; phoneTab.dataset.authTab = 'phone';
  const params = new URLSearchParams();
  if (next) params.set('next', next);
  if (intent) params.set('intent', intent);
  const code = fs.readFileSync(path.join(__dirname, '../public/auth.js'), 'utf8').replace(/import\('https:\/\/www.gstatic.com\/firebasejs\/[^']+firebase-app.js'\)/, 'Promise.resolve(mockAppSdk)').replace(/import\('https:\/\/www.gstatic.com\/firebasejs\/[^']+firebase-auth.js'\)/, 'Promise.resolve(mockAuthSdk)');
  const context = vm.createContext({ URL, mockAuthSdk: sdk, mockAppSdk: { initializeApp: () => ({}) }, location: { href: `https://cinewall.test/${profile ? 'profile' : 'auth'}.html?${params}`, origin: 'https://cinewall.test', replace: value => navigations.push(value) }, document: { body: { dataset: { authPage: profile ? 'profile' : '' } }, querySelector: node, querySelectorAll: selector => selector === '[data-auth-tab]' ? [emailTab, phoneTab] : [] }, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, fetch: async (url, options) => {
    if (url === '/api/auth/verify-email') { calls.push(['branded-email', options.headers.Authorization]); await holdVerification; }
    if (url === '/api/auth/session') {
      if (options?.method === 'POST') return onSession(JSON.parse(options.body).idToken);
      return { ok: true, json: async () => ({ authenticated: Boolean(cookieAccount), account: cookieAccount }) };
    }
    if (url === '/api/auth/logout') calls.push('server-logout');
    return { ok: true, json: async () => ({ enabled, config: {}, brandedVerification }) };
  } });
  context.window = { addEventListener: (name, listener) => { browserEvents[name] = listener; } };
  await vm.runInContext(code, context); await tick();
  return { node, calls, navigations, auth, storage, browserEvents, signIn: user => auth.changed(user) };
}
test('unconfigured auth never presents working login controls', async () => {
  const f = await fixture(false); assert.match(f.node('#authStatus').textContent, /unavailable/); assert.equal(f.node('#authForms').hidden, true); assert.equal(f.node('#authRetry').hidden, false); assert.equal(f.calls.length, 0);
});
test('email signup sends verification and clears the password; invalid login is visible', async () => {
  const f = await fixture(); f.node('#toggleSignup').handlers.click();
  f.node('#email').value = 'test@example.com'; f.node('#password').value = 'test-password';
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

const providerError = code => Object.assign(Error(code), { code });
const submit = { preventDefault() {} };

test('first-time visitors see signup; returning visitors and explicit sign-in see login', async () => {
  for (const [options, shouldSignUp] of [[{}, true], [{ returning: true }, false], [{ intent: 'signin' }, false], [{ returning: true, intent: 'signup' }, true]]) {
    const f = await fixture(true, options);
    assert.equal(f.node('#authTitle').textContent, shouldSignUp ? 'Create your account.' : 'Welcome back.');
    assert.equal(f.node('#signupName').required, shouldSignUp);
    assert.equal(f.node('#resetPassword').hidden, shouldSignUp);
    assert.equal(f.node('#password').autocomplete, shouldSignUp ? 'new-password' : 'current-password');
    f.node('#password').value = 'entered-password'; f.node('#password').type = 'text';
    f.node('#toggleSignup').handlers.click();
    assert.equal(f.node('#password').value, '');
    assert.equal(f.node('#password').type, 'password');
  }
});

test('duplicate email can switch to sign-in and password reset does not reveal account existence', async () => {
  const f = await fixture(true, { customize: ({ sdk, calls }) => {
    sdk.createUserWithEmailAndPassword = async () => { throw providerError('auth/email-already-in-use'); };
    sdk.sendPasswordResetEmail = async (_, email) => { calls.push(['reset', email]); throw providerError('auth/user-not-found'); };
  } });
  f.node('#signupName').value = 'Test Viewer'; f.node('#email').value = 'test@example.com'; f.node('#password').value = 'test-password';
  f.node('#emailForm').handlers.submit(submit); await tick();
  assert.match(f.node('#authStatus').textContent, /already uses this email/);
  f.node('#toggleSignup').handlers.click();
  f.node('#resetPassword').handlers.click(); await tick();
  assert.deepEqual(f.calls, [['reset', 'test@example.com']]);
  assert.equal(f.node('#authStatus').dataset.state, 'status');
  assert.match(f.node('#authStatus').textContent, /If an account exists/);
});

test('verification delivery can be retried without creating a second account or entering the dashboard', async () => {
  let deliveries = 0;
  const f = await fixture(true, { customize: ({ sdk }) => {
    sdk.sendEmailVerification = async () => { if (++deliveries === 1) throw providerError('auth/network-request-failed'); };
  } });
  f.node('#signupName').value = 'Test Viewer'; f.node('#email').value = 'test@example.com'; f.node('#password').value = 'test-password';
  f.node('#emailForm').handlers.submit(submit); await tick();
  assert.equal(f.node('#verificationPanel').hidden, false);
  assert.equal(f.node('#authStatus').dataset.state, 'error');
  f.node('#resendVerification').handlers.click(); await tick();
  assert.match(f.node('#authStatus').textContent, /email sent/);
  f.node('#resendVerification').handlers.click(); await tick();
  assert.equal(deliveries, 2);
  assert.deepEqual(f.navigations, []);
});

test('Google cancellation stays on the form, and successful retry preserves the requested tool', async () => {
  let attempts = 0;
  const f = await fixture(true, { next: '/share.html?room=demo', customize: ({ sdk, auth }) => {
    sdk.signInWithPopup = async () => {
      if (++attempts === 1) throw providerError('auth/popup-closed-by-user');
      auth.changed(signedInUser);
    };
  } });
  f.node('#googleSignIn').handlers.click(); await tick();
  assert.equal(f.node('#authForms').hidden, false);
  assert.match(f.node('#authStatus').textContent, /closed/);
  f.node('#googleSignIn').handlers.click(); await tick();
  assert.deepEqual(f.navigations, ['/share.html?room=demo']);
});

test('an expired SMS code returns to the number form and SMS-only accounts must add an email', async () => {
  let attempts = 0;
  const f = await fixture(true, { customize: ({ sdk, auth }) => {
    sdk.signInWithPhoneNumber = async () => ({ confirm: async () => {
      if (++attempts === 1) throw providerError('auth/session-expired');
      auth.changed({ phoneNumber: '+919876543210', getIdToken: async () => 'sms-only' });
    } });
    sdk.EmailAuthProvider = { credential: (email, password) => ({ email, password }) };
    sdk.linkWithCredential = async (user, credential) => ({ user: Object.assign(user, { email: credential.email }) });
  } });
  f.node('phoneTab').handlers.click();
  f.node('#phone').value = '+919876543210';
  f.node('#phoneForm').handlers.submit(submit); await tick();
  f.node('#otp').value = '123456';
  f.node('#codeForm').handlers.submit(submit); await tick();
  assert.equal(f.node('#phoneForm').hidden, false);
  assert.match(f.node('#authStatus').textContent, /expired/);
  f.node('#phoneForm').handlers.submit(submit); await tick();
  f.node('#otp').value = '987654';
  f.node('#codeForm').handlers.submit(submit); await tick();
  assert.equal(f.node('#authTitle').textContent, 'Add your email.');
  assert.equal(f.node('#linkEmailForm').hidden, false);
  assert.deepEqual(f.navigations, []);
  f.node('#linkEmail').value = 'test@example.com'; f.node('#linkPassword').value = 'test-password';
  f.node('#linkEmailForm').handlers.submit(submit); await tick();
  assert.equal(f.node('#authTitle').textContent, 'Verify your email.');
  assert.equal(f.node('#linkEmailForm').hidden, true);
  assert.equal(f.node('#linkPassword').value, '');
  assert.deepEqual(f.navigations, []);
});

test('verified provider accounts can retry a failed session without signing in again', async () => {
  const tokens = [];
  const f = await fixture(true, {
    onSession: token => { tokens.push(token); return tokens.length === 1 ? { ok: false, status: 503 } : { ok: true }; },
  });
  f.signIn({ ...signedInUser, getIdToken: async force => force ? 'fresh' : 'cached' }); await tick();
  assert.equal(f.node('#authRetry').hidden, false);
  assert.equal(f.node('#authSwitchAccount').hidden, false);
  assert.equal(f.node('#authForms').hidden, true);
  assert.deepEqual(f.navigations, []);
  f.node('#authRetry').handlers.click(); await tick();
  assert.deepEqual(tokens, ['cached', 'fresh']);
  assert.deepEqual(f.navigations, ['/admin.html?mode=video']);
});

test('a stale token event cannot start a session after the provider user has changed', async () => {
  const tokens = [];
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const f = await fixture(true, { onSession: token => { tokens.push(token); return { ok: true }; } });
  f.signIn({ ...signedInUser, getIdToken: () => delayed }); await tick();
  f.signIn(null); release('stale'); await tick();
  assert.deepEqual(tokens, []);
  assert.deepEqual(f.navigations, []);
  assert.equal(f.node('#authForms').hidden, false);
});

test('profile shows verified identity with either provider or server session and logs out of both', async () => {
  for (const options of [
    { initialUser: { ...signedInUser, displayName: 'Test Viewer', phoneNumber: '+919876543210' } },
    { cookieAccount: { name: 'Test Viewer', email: signedInUser.email } },
  ]) {
    const f = await fixture(true, { profile: true, ...options });
    assert.equal(f.node('#profileName').textContent, 'Test Viewer');
    assert.equal(f.node('#profileEmail').textContent, 'test@example.com');
    assert.equal(f.node('#profilePhone').textContent, options.initialUser?.phoneNumber || 'Not added');
    assert.equal(f.node('#accountPanel').hidden, false);
    assert.deepEqual(f.navigations, []);
    f.node('#signOut').handlers.click(); await tick();
    assert.deepEqual(f.calls, ['server-logout', 'firebase-logout']);
    assert.equal(f.storage.has('cinewall-account-used'), false);
    assert.equal(f.storage.get('cinewall-account-returning'), '1');
    assert.deepEqual(f.navigations, ['/auth.html?intent=signin']);
  }
});

test('anonymous profile keeps its return destination; switching an unverified account keeps its room link', async () => {
  const profile = await fixture(true, { profile: true });
  assert.deepEqual(profile.navigations, ['/auth.html?next=%2Fprofile.html']);
  const next = '/screen.html?screen=2&room=demo';
  const f = await fixture(true, { next, initialUser: { ...signedInUser, emailVerified: false } });
  f.node('#changeAccount').handlers.click(); await tick();
  assert.deepEqual(f.navigations, [`/auth.html?intent=signin&next=${encodeURIComponent(next)}`]);
});

test('a profile tab hides its identity when another tab logs out', async () => {
  const f = await fixture(true, { profile: true, initialUser: signedInUser });
  f.browserEvents.storage({ key: 'cinewall-account-logout', newValue: '1' });
  f.signIn(signedInUser); await tick();
  assert.equal(f.node('#accountPanel').hidden, true);
  assert.deepEqual(f.navigations, ['/auth.html?intent=signin&next=%2Fprofile.html']);
});
