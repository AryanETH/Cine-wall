'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));
function mixer(mode = 'video') {
  const node = () => ({ value: 1, textContent: '', innerHTML: '', dataset: {}, attributes: {},
    classList: { toggle() {}, add() {}, remove() {} }, setAttribute(key, value) { this.attributes[key] = value; } });
  const nodes = new Map(), get = key => { if (!nodes.has(key)) nodes.set(key, node()); return nodes.get(key); };
  const cards = [1, 2, 3].map(number => {
    const input = node(), button = node(), output = node();
    return { input, button, output, dataset: { speaker: String(number) }, classList: { toggle() {} },
      querySelector: selector => selector === 'input' ? input : selector === 'output' ? output : button };
  });
  const requests = [], timers = new Map(); let timerId = 0;
  let server = { serverId: 'test-server', commandId: 1, sessionMode: mode, screenCount: 3, asset: { version: 'test' }, audioSettings: {
    1: { volume: .65, muted: false }, 2: { volume: .3, muted: false }, 3: { volume: 0, muted: false }
  } };
  const context = vm.createContext({ $, Number, String, Map, Promise, Date, JSON, Math,
    document: { activeElement: null }, screenLinks: { querySelectorAll: () => cards }, warning: node(),
    screenRole: number => `Screen ${number}`, sourceLocked: () => false, playbackReady: () => true,
    renderPlayer() {}, updateServerTime() {}, refresh: async () => {},
    render: () => vm.runInContext('renderMixer()', context),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    fetch: (url, init) => new Promise(resolve => requests.push({ payload: JSON.parse(init.body), resolve }))
  });
  function $(key) { return get(key); }
  context.initial = structuredClone(server);
  vm.runInContext('let status = {state: initial}, controlSequence = 0, serverOffset = 0; const volumeTimers = new Map(), controlsQueues = new Map(), pendingControls = new Map(), queuedRevisions = new Map();', context);
  for (const [start, end] of [
    ['function audioSetting(', 'function updateServerTime('], ['function acceptState(', 'function isPreparing('],
    ['async function command(', 'function renderModeShell('], ['function renderMixer(', 'function presentationUrl('],
    ['function queueVolume(', "screenLinks.addEventListener('input'"]
  ]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), context);
  const run = text => vm.runInContext(text, context);
  run('renderMixer()');
  return { cards, get, context, requests, timers, run,
    reply(index) {
      const { payload, resolve } = requests[index];
      server = { ...server, audioSettings: structuredClone(server.audioSettings), commandId: server.commandId + 1 };
      if (payload.type === 'screen-audio') {
        const setting = server.audioSettings[payload.screen];
        if ('volume' in payload) setting.volume = payload.volume;
        if ('muted' in payload) setting.muted = payload.muted;
      } else if (payload.type === 'mute-all') for (const setting of Object.values(server.audioSettings)) setting.muted = payload.muted;
      resolve({ ok: true, json: async () => ({ command: structuredClone(server) }) });
    }
  };
}

test('all dashboard sliders show muted zero and restore each stored level, including explicit zero', () => {
  for (const mode of ['video', 'audio', 'youtube']) {
    const m = mixer(mode);
    m.context.document.activeElement = m.get('#adminVolume');
    m.run('for (const setting of Object.values(status.state.audioSettings)) setting.muted = true; renderMixer()');
    assert.deepEqual(m.cards.map(card => Number(card.input.value)), [0, 0, 0]);
    assert.equal(Number(m.get('#adminVolume').value), 0); assert.equal(m.get('#adminVolumeValue').textContent, '0%');
    assert.equal(m.run('audioSetting(1).volume'), .65);
    m.run('for (const setting of Object.values(status.state.audioSettings)) setting.muted = false; renderMixer()');
    assert.deepEqual(m.cards.map(card => Number(card.input.value)), [.65, .3, 0]);
    assert.equal(Number(m.get('#adminVolume').value), .65, 'unmute restores the thumb even when the slider retains focus');
  }
});

test('muting while a slider debounce is pending keeps the selected volume and cancels stale unmute', async () => {
  const m = mixer(); m.run('queueVolume(1, .4)');
  assert.equal(m.timers.size, 1);
  const muting = m.run("command({type:'screen-audio',screen:1,muted:true})");
  assert.equal(m.timers.size, 0); assert.equal(Number(m.get('#adminVolume').value), 0);
  await turn(); assert.equal(m.requests.length, 1);
  assert.equal(m.requests[0].payload.volume, .4); assert.equal(m.requests[0].payload.muted, true);
  m.reply(0); await muting;
  const unmuting = m.run("command({type:'screen-audio',screen:1,muted:false})"); await turn();
  assert.equal(Number(m.get('#adminVolume').value), .4);
  m.reply(1); await unmuting; assert.equal(m.run('audioSetting(1).volume'), .4);
  m.run('queueVolume(1, .2)'); assert.equal(m.run('audioSetting(1).muted'), false);
});

test('mute-all preserves pending slider levels and a later individual unmute wins in network order', async () => {
  const m = mixer(); m.run('queueVolume(1, .4); queueVolume(2, .2)');
  const all = m.run("command({type:'mute-all',muted:true})");
  assert.deepEqual(m.cards.map(card => Number(card.input.value)), [0, 0, 0]);
  assert.equal(m.timers.size, 0); await turn(); assert.equal(m.requests.length, 2);
  m.reply(0); m.reply(1); await turn(); assert.equal(m.requests[2].payload.type, 'mute-all');
  const one = m.run("command({type:'screen-audio',screen:1,muted:false})");
  await turn(); assert.equal(m.requests.length, 3, 'the later unmute waits for mute-all');
  m.reply(2); await all; await turn(); assert.equal(m.requests[3].payload.muted, false);
  m.reply(3); await one;
  assert.deepEqual(m.cards.map(card => Number(card.input.value)), [.4, 0, 0]);
  assert.equal(m.run('audioSetting(2).volume'), .2);
});
