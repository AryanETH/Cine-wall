'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const publicDir = path.resolve(__dirname, '../public');

function client(initial = []) {
  let notify, observed;
  const document = { documentElement: {}, querySelectorAll: () => initial };
  const context = { document, window: {}, MutationObserver: class {
    constructor(callback) { notify = callback; }
    observe(root, options) { observed = { root, options }; }
  } };
  vm.runInNewContext(fs.readFileSync(path.join(publicDir, 'icons.js'), 'utf8'), context);
  return { api: context.window.CineWallIcons, notify: (records) => notify(records), observed };
}

function icon(code) {
  const attributes = {};
  let text = String.fromCodePoint(parseInt(code, 16)), markup = '';
  return { nodeType: 1, attributes, matches: (selector) => selector === '.fi', querySelectorAll: () => [],
    get textContent() { return text; }, set textContent(value) { text = value; markup = ''; },
    get innerHTML() { return markup; }, set innerHTML(value) { markup = value; text = ''; },
    setAttribute: (key, value) => { attributes[key] = value; },
  };
}

test('every icon used in pages and dynamic controls has a local SVG, with no Windows font dependency', () => {
  const { api } = client();
  const codes = new Set();
  for (const file of fs.readdirSync(publicDir).filter((name) => /\.(html|js)$/.test(name))) {
    const source = fs.readFileSync(path.join(publicDir, file), 'utf8');
    for (const match of source.matchAll(/&#x([EF][\dA-F]{3});/gi)) codes.add(match[1].toUpperCase());
    for (const character of source) if (/^[\uE000-\uF8FF]$/.test(character)) codes.add(character.codePointAt(0).toString(16).toUpperCase());
  }
  assert.ok(codes.size >= 33);
  for (const code of codes) {
    assert.match(api.svg(code), /^<svg .*viewBox="0 0 24 24"/, code);
    assert.match(api.svg(code), /stroke="currentColor"/);
    assert.match(api.svg(code), /aria-hidden="true" focusable="false"/);
    assert.doesNotMatch(api.svg(code), /https?:|<script|[\uE000-\uF8FF]/);
  }
  assert.equal(api.svg('untrusted'), '');
  const styles = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
  assert.doesNotMatch(styles, /Segoe Fluent Icons|Segoe MDL2 Assets/);
  assert.match(styles, /\.cw-icon[^}]+pointer-events: none/);
  for (const page of ['index.html', 'admin.html', 'screen.html']) {
    const html = fs.readFileSync(path.join(publicDir, page), 'utf8');
    assert.match(html, /<script src="icons\.js\?v=20261002-icons-18"><\/script>/);
    const styleVersions = { 'index.html': '20261005-feedback-28', 'admin.html': '20261005-feedback-28', 'screen.html': '20261005-feedback-28' };
    assert.ok(html.includes(`styles.css?v=${styleVersions[page]}`));
    assert.ok(html.indexOf('icons.js') < html.indexOf('theme.js'));
  }
});

test('icons render on initial load, dynamic screen lists, text changes and play/mute/theme updates without an observer loop', () => {
  const play = icon('E768'), c = client([play]);
  assert.match(play.innerHTML, /data-cw-icon="E768"/);
  assert.equal(play.attributes['aria-hidden'], 'true');
  assert.equal(c.observed.options.subtree, true);
  const pause = icon('E769');
  const wrapper = { nodeType: 1, matches: () => false, querySelectorAll: () => [pause] };
  c.notify([{ type: 'childList', target: wrapper, addedNodes: [wrapper] }]);
  assert.match(pause.innerHTML, /data-cw-icon="E769"/);
  play.textContent = '\uE74F';
  c.notify([{ type: 'childList', target: play, addedNodes: [] }]);
  assert.match(play.innerHTML, /data-cw-icon="E74F"/);
  play.textContent = '\uE706';
  c.notify([{ type: 'characterData', target: { nodeType: 3, parentElement: play } }]);
  assert.match(play.innerHTML, /data-cw-icon="E706"/);
  const before = play.innerHTML;
  c.notify([{ type: 'childList', target: play, addedNodes: [] }]);
  assert.equal(play.innerHTML, before);
});
