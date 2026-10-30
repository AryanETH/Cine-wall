'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function switcher({ hostRoom = 'shared-room', isPhone = false, changeMode = async () => {} } = {}) {
  const handlers = new Map(), changes = [], errors = [], location = new URL('https://cinema.test/');
  const document = { addEventListener(name, handler) { handlers.set(name, handler); } };
  const window = {
    CineWallSession: { hostRoom, async switchMode(mode) { changes.push(mode); await changeMode(mode); } },
    CineWallDeviceSupport: { isPhone },
    dispatchEvent: event => errors.push(event),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/mode-switcher.js'), 'utf8'), {
    window, document, location, URL,
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
  });
  handlers.get('DOMContentLoaded')();
  function click(mode, options = {}) {
    const attributes = new Map();
    const href = options.href || (mode === 'share' ? '/share.html' : mode === 'mic' ? '/mic.html' : `/admin.html?mode=${mode}`);
    const card = { href, dataset: { sessionMode: mode }, setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name) };
    const event = { target: { closest: () => card }, button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...options };
    const pending = handlers.get('click')(event);
    return { event, attributes, pending };
  }
  return { click, changes, errors, location };
}

test('all four homepage tools opt into switching the shared room', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const cards = [...html.matchAll(/<a\b[^>]*class="[^"]*\bmode-card\b[^>]*>/g)].map(match => match[0]);
  assert.equal(cards.length, 4);
  for (const [mode, href] of [['video', '/admin.html?mode=video'], ['audio', '/admin.html?mode=audio'], ['share', '/share.html'], ['mic', '/mic.html']]) {
    const card = cards.find(tag => tag.includes(`href="${href}"`));
    assert.ok(card, `${mode} has a tool card`);
    assert.ok(card.includes(`data-session-mode="${mode}"`), `${mode} participates in the same-room switch flow`);
  }
});

test('each homepage tool calls the existing-room switch action and clears its busy state', async () => {
  const ui = switcher();
  for (const mode of ['video', 'audio', 'share', 'mic']) {
    const click = ui.click(mode);
    assert.equal(click.event.defaultPrevented, true);
    assert.equal(click.attributes.get('aria-busy'), 'true');
    await click.pending;
    assert.equal(click.attributes.has('aria-busy'), false);
  }
  assert.deepEqual(ui.changes, ['video', 'audio', 'share', 'mic']);
  assert.equal(ui.errors.length, 0);
});

test('a switch error stays visible and never redirects to an unrelated new room', async () => {
  const ui = switcher({ changeMode: async () => { throw new Error('Connection lost'); } });
  const click = ui.click('audio');
  await click.pending;
  assert.equal(click.event.defaultPrevented, true);
  assert.equal(ui.location.href, 'https://cinema.test/');
  assert.equal(click.attributes.has('aria-busy'), false);
  assert.equal(ui.errors[0].type, 'cinewall-room-error');
  assert.equal(ui.errors[0].detail, 'Connection lost');
});

test('rapid tool clicks cannot race two mode changes', async () => {
  let finish;
  const ui = switcher({ changeMode: () => new Promise(resolve => { finish = resolve; }) });
  const first = ui.click('audio'), second = ui.click('mic');
  await second.pending;
  assert.equal(second.event.defaultPrevented, true);
  assert.deepEqual(ui.changes, ['audio']);
  finish();
  await first.pending;
  const third = ui.click('share');
  finish();
  await third.pending;
  assert.deepEqual(ui.changes, ['audio', 'share']);
});

test('modified clicks, guest sessions and restricted phone tools keep their normal navigation', async () => {
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }, { href: '/admin.html?mode=audio&new=1' }, { href: 'https://external.invalid/admin.html?mode=audio' }]) {
    const ui = switcher(), click = ui.click('audio', options);
    await click.pending;
    assert.equal(ui.changes.length, 0);
  }
  const guest = switcher({ hostRoom: '' });
  const guestClick = guest.click('video'); await guestClick.pending;
  assert.equal(guestClick.event.defaultPrevented, false);
  assert.equal(guest.changes.length, 0);
  const phone = switcher({ isPhone: true });
  const videoClick = phone.click('video'); await videoClick.pending;
  assert.equal(videoClick.event.defaultPrevented, false);
  await phone.click('mic').pending;
  assert.deepEqual(phone.changes, ['mic']);
});
