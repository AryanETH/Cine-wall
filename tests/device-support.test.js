'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
function device({ agent = '', platform = '', width = 390, height = 844, touch = 5, coarse = true, mobile, pathname = '/' } = {}) {
  const classes = [], listeners = {};
  const context = vm.createContext({
    navigator: { userAgent: agent, platform, userAgentData: { mobile }, maxTouchPoints: touch },
    screen: { width, height }, matchMedia: () => ({ matches: coarse }), location: new URL('https://watch.aitoyz.in' + pathname), URL, window: {},
    document: { documentElement: { classList: { add: name => classes.push(name) } }, addEventListener: (name, fn) => { listeners[name] = fn; } },
  });
  vm.runInContext(source('device-support.js'), context);
  return { context, policy: context.window.CineWallDeviceSupport, classes, listeners };
}
test('phones cannot start restricted modes in portrait or landscape, including direct links', () => {
  for (const agent of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/130 Mobile Safari/537.36']) {
    for (const [width, height] of [[390, 844], [844, 390]]) {
      for (const pathname of ['/admin.html', '/screen.html', '/share.html', '/remote.html']) {
        const client = device({ agent, width, height, pathname });
        assert.equal(client.policy.isPhone, true);
        assert.equal(client.policy.restricted, true);
        assert.deepEqual(client.classes, ['device-mobile', 'device-phone', 'device-restricted']);
      }
    }
  }
});
test('portrait phone microphone and speaker pages remain available', () => {
  for (const pathname of ['/mic.html', '/mic-setup.html', '/', '/connect.html?mode=mic']) {
    const client = device({ mobile: true, pathname });
    assert.equal(client.policy.isPhone, true);
    assert.equal(client.policy.restricted, false);
    assert.deepEqual(client.classes, ['device-mobile', 'device-phone']);
  }
});
test('Remote Control is hidden from mobile visitors and direct links are restricted on tablets', () => {
  for (const options of [
    { mobile: true },
    { agent: 'iPad', width: 768, height: 1024 },
    { agent: 'Android 14; Tablet', width: 800, height: 1280 },
    { agent: 'Macintosh', platform: 'MacIntel', width: 820, height: 1180 },
  ]) {
    assert.ok(device(options).classes.includes('device-mobile'));
    assert.equal(device({ ...options, pathname: '/remote.html' }).policy.restricted, true);
  }
  assert.equal(device({ touch: 0, coarse: false, pathname: '/remote.html' }).policy.restricted, false);
  assert.match(source('device-support.css'), /\.device-mobile\s+\.mode-card\[data-bg="remote"\]\s*\{\s*display:\s*none/);
  const remote = source('remote.html');
  assert.ok(remote.indexOf('device-support.js') < remote.indexOf('account-guard.js'));
});
test('phone entry screens cannot create or join laptop-only modes', () => {
  for (const mode of ['video','audio','share']) assert.equal(device({ mobile:true, pathname:'/connect.html?mode='+mode }).policy.restricted,true);
});
test('narrow desktop windows, touch laptops and tablets are not mistaken for smartphones', () => {
  for (const options of [
    { width: 390, height: 844, touch: 0, coarse: false },
    { width: 1280, height: 800, touch: 10, coarse: true },
    { agent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Mobile', width: 768, height: 1024 },
    { agent: 'Mozilla/5.0 (Linux; Android 14; Tablet) Chrome/130 Safari', width: 800, height: 1280 },
  ]) {
    const client = device({ ...options, pathname: '/share.html' });
    assert.equal(client.policy.isPhone, false);
    assert.equal(client.classes.includes('device-phone'), false);
  }
});
test('restricted pages do not load or run their desktop session entry script', () => {
  const context = { window: { CineWallDeviceSupport: { restricted: true } }, document: { createElement() { throw new Error('Desktop session started on a phone'); } } };
  assert.doesNotThrow(() => vm.runInNewContext(source('desktop-entry.js'), context));
  for (const page of ['admin', 'screen', 'share']) {
    const html = source(page + '.html');
    assert.ok(html.indexOf('device-support.js') < html.indexOf('desktop-entry.js'));
    assert.match(html, new RegExp(`data-src="${page}\\.js`));
    assert.doesNotMatch(html, new RegExp(`<script src="${page}\\.js`));
  }
});
