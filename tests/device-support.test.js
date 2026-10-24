'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
function device({ agent = '', width = 390, height = 844, touch = 5, coarse = true, mobile, pathname = '/' } = {}) {
  const classes = [], listeners = {};
  const context = vm.createContext({
    navigator: { userAgent: agent, userAgentData: { mobile }, maxTouchPoints: touch },
    screen: { width, height }, matchMedia: () => ({ matches: coarse }), location: { pathname }, window: {},
    document: { documentElement: { classList: { add: name => classes.push(name) } }, addEventListener: (name, fn) => { listeners[name] = fn; } },
  });
  vm.runInContext(source('device-support.js'), context);
  return { context, policy: context.window.CineWallDeviceSupport, classes, listeners };
}
test('phones cannot start restricted modes in portrait or landscape, including direct links', () => {
  for (const agent of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/130 Mobile Safari/537.36']) {
    for (const [width, height] of [[390, 844], [844, 390]]) {
      for (const pathname of ['/admin.html', '/screen.html', '/share.html']) {
        const client = device({ agent, width, height, pathname });
        assert.equal(client.policy.isPhone, true);
        assert.equal(client.policy.restricted, true);
        assert.deepEqual(client.classes, ['device-restricted']);
      }
    }
  }
});
test('portrait phone microphone and speaker pages remain available', () => {
  for (const pathname of ['/mic.html', '/mic-setup.html', '/']) {
    const client = device({ mobile: true, pathname });
    assert.equal(client.policy.isPhone, true);
    assert.equal(client.policy.restricted, false);
    assert.deepEqual(client.classes, []);
  }
});
test('narrow desktop windows, touch laptops and tablets are not mistaken for smartphones', () => {
  for (const options of [
    { width: 390, height: 844, touch: 0, coarse: false },
    { width: 1280, height: 800, touch: 10, coarse: true },
    { agent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Mobile', width: 768, height: 1024 },
    { agent: 'Mozilla/5.0 (Linux; Android 14; Tablet) Chrome/130 Safari', width: 800, height: 1280 },
  ]) assert.equal(device({ ...options, pathname: '/share.html' }).policy.isPhone, false);
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
