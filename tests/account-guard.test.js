'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const tick = () => new Promise(setImmediate);
const account = { name: 'Test Viewer', email: 'viewer@example.test' };

async function runGuard({ home = false, session }) {
  const code = fs.readFileSync(path.join(__dirname, '../public/account-guard.js'), 'utf8')
    .replace(/import\('[^']+firebase-app.js'\)/, 'Promise.resolve(mockAppSdk)')
    .replace(/import\('[^']+firebase-auth.js'\)/, 'Promise.resolve(mockAuthSdk)');
  const nodes = new Map(), events = {}, navigations = [], auth = { currentUser: null };
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      hidden: true, handlers: {}, attrs: {}, focus() {},
      addEventListener(name, fn) { this.handlers[name] = fn; },
      setAttribute(name, value) { this.attrs[name] = value; },
      querySelector: node, querySelectorAll: selector => [node(selector)],
    });
    return nodes.get(selector);
  }
  const pathname = home ? '/' : '/screen.html', search = home ? '' : '?screen=2&room=demo';
  const context = {
    URL, setInterval: () => 0, clearInterval() {},
    location: { href: 'https://cinewall.test' + pathname + search, pathname, search, replace: value => navigations.push(value) },
    document: { querySelector: () => home ? node('#homeAccount') : null, querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener: (name, fn) => { events[name] = fn; } },
    localStorage: { getItem: () => null, setItem() {} },
    mockAppSdk: { initializeApp: () => ({}) },
    mockAuthSdk: { getAuth: () => auth, onIdTokenChanged(_, listener) { listener(auth.currentUser); } },
    fetch: async (url, options) => {
      if (url === '/api/auth/config') return { ok: true, json: async () => ({ enabled: true }) };
      if (url === '/api/auth/session' && options?.method !== 'POST') return { ok: true, json: session };
      throw Error('Unexpected request: ' + url);
    },
  };
  await vm.runInNewContext(code, context); await tick();
  return { node, events, navigations };
}

test('profile button opens the landing card and a late response cannot reopen it after cross-tab logout', async () => {
  let reads = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = await runGuard({ home: true, session: () => ++reads === 1 ? { authenticated: true, account } : pending });
  const trigger = f.node('#accountTrigger'), card = f.node('#accountPopover');
  assert.equal(trigger.hidden, false);
  trigger.handlers.click();
  assert.equal(card.hidden, false);
  assert.deepEqual(f.navigations, []);
  void f.events.focus(); await tick();
  assert.equal(reads, 2);
  f.events.storage({ key: 'cinewall-account-logout', newValue: '1' });
  release({ authenticated: true, account }); await tick();
  assert.equal(card.hidden, true);
  assert.equal(trigger.hidden, true);
  assert.equal(f.node('#accountLink').hidden, false);
});

test('without Firebase browser storage, a valid server session still keeps a protected screen open', async () => {
  const f = await runGuard({ session: () => ({ authenticated: true, account }) });
  assert.deepEqual(f.navigations, []);
  const expired = await runGuard({ session: () => ({ authenticated: false }) });
  assert.deepEqual(expired.navigations, ['/auth.html?next=%2Fscreen.html%3Fscreen%3D2%26room%3Ddemo']);
});
