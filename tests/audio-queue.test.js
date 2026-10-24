'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AudioQueue } = require('../public/audio-queue.js');

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('audio queue numbers and reorders ten songs, rejects an eleventh, and advances only when the current source ends', async () => {
  const state = { sessionMode: 'audio', asset: null, allReady: false, loop: false };
  const loaded = [], played = [], warnings = [];
  const queue = new AudioQueue({
    blocked: () => false,
    validate: async file => { if (!file.name.endsWith('.mp3')) throw Error('Unsupported'); },
    load: async file => {
      loaded.push(file.name); state.asset = { version: `version-${file.name}` };
      return { ...state };
    },
    removeCurrent: async () => { state.asset = null; return true; },
    play: async version => { played.push(version); return true; },
    error: message => warnings.push(message),
  });
  const files = Array.from({ length: 10 }, (_, index) => ({ name: `${index + 1}.mp3` }));
  await queue.add(files);
  assert.deepEqual(queue.items.map(item => item.file.name), files.map(file => file.name));
  assert.equal(queue.currentId, queue.items[0].id);
  assert.deepEqual(loaded, ['1.mp3']);
  await queue.add([{ name: '11.mp3' }]);
  assert.equal(queue.items.length, 10);
  assert.match(warnings.at(-1), /up to 10/);

  queue.move(queue.items[2].id, 1);
  assert.equal(queue.items[1].file.name, '3.mp3');
  queue.observe(state, [{ screen: 2, assetVersion: queue.version, ready: true, ended: true }]);
  assert.equal(loaded.length, 1, 'a receiver ending early cannot advance the room');
  queue.observe(state, [{ screen: 1, assetVersion: 'older-version', ready: true, ended: true }]);
  assert.equal(loaded.length, 1, 'an old song cannot advance the new song');
  queue.observe(state, [{ screen: 1, assetVersion: queue.version, ready: true, ended: true }]);
  await nextTurn();
  assert.deepEqual(loaded, ['1.mp3', '3.mp3']);
  assert.equal(queue.pendingPlay, 'version-3.mp3');
  queue.observe(state, [{ screen: 1, assetVersion: queue.version, ready: true, ended: false }]);
  assert.deepEqual(played, [], 'the next song waits for all screens');
  state.allReady = true;
  queue.observe(state, [{ screen: 1, assetVersion: queue.version, ready: true, ended: false }]);
  queue.observe(state, [{ screen: 1, assetVersion: queue.version, ready: true, ended: false }]);
  await nextTurn();
  assert.deepEqual(played, ['version-3.mp3'], 'the next song starts once across the room');
});

test('removing the playing song selects the next song while retaining the queue', async () => {
  const state = { sessionMode: 'audio', asset: null, allReady: false };
  let clears = 0;
  const queue = new AudioQueue({
    blocked: () => false, validate: async () => {},
    load: async file => { state.asset = { version: file.name }; return { ...state }; },
    removeCurrent: async () => { clears++; state.asset = null; return true; },
    play: async () => true, error: () => {},
  });
  await queue.add([{ name: 'first.mp3' }, { name: 'second.mp3' }]);
  await queue.remove(queue.currentId, true);
  assert.equal(clears, 1);
  assert.deepEqual(queue.items.map(item => item.file.name), ['second.mp3']);
  assert.equal(queue.version, 'second.mp3');
  assert.equal(queue.pendingPlay, 'second.mp3');
});

test('readiness received during loading starts the next song without needing another status message', async () => {
  let state = { sessionMode: 'audio', asset: null, allReady: false };
  let finishLoading;
  const played = [];
  const queue = new AudioQueue({ blocked: () => false, state: () => state, screens: () => [], validate: async () => {},
    load: async file => {
      if (file.name === 'second.mp3') await new Promise(resolve => { finishLoading = resolve; });
      state = { ...state, asset: { version: file.name }, allReady: true };
      queue.observe(state, []);
      return state;
    }, play: async version => { played.push(version); return true; }, error: message => assert.fail(message),
  });
  await queue.add([{ name: 'first.mp3' }, { name: 'second.mp3' }, { name: 'third.mp3' }]);
  const ended = [{ screen: 1, ready: true, ended: true, assetVersion: 'first.mp3' }];
  queue.observe(state, ended); queue.observe(state, ended);
  finishLoading(); await nextTurn();
  assert.equal(queue.items.length, 3);
  assert.equal(queue.currentId, queue.items[1].id);
  assert.deepEqual(played, ['second.mp3']);
  assert.equal(queue.pendingPlay, '');
});

test('songs advance in order, wait for reconnecting speakers and repeat the final song without reloading it', async () => {
  const state = { sessionMode: 'audio', asset: null, allReady: false, loop: false };
  const loaded = [], played = [];
  const queue = new AudioQueue({ blocked: () => false, validate: async () => {},
    load: async file => { loaded.push(file.name); state.allReady = false; state.asset = { version: file.name }; return state; },
    play: async version => { played.push(version); return true; }, error: message => assert.fail(message),
  });
  await queue.add(['one', 'two', 'three'].map(name => ({ name })));
  queue.move(queue.items[2].id, 1);
  for (const name of ['one', 'three', 'two']) {
    state.allReady = true;
    queue.observe(state, []); await nextTurn();
    const ended = [{ screen: 1, assetVersion: name, ready: true, ended: true }];
    queue.observe(state, ended); queue.observe(state, ended); await nextTurn();
    if (name !== 'two') assert.equal(queue.pendingPlay, state.asset.version);
  }
  assert.deepEqual(loaded, ['one', 'three', 'two']);
  state.allReady = true; queue.observe(state, []); await nextTurn();
  assert.deepEqual(played, ['three', 'two', 'two']);
  assert.equal(queue.currentId, queue.items.at(-1).id);
});

test('a single song repeats on each new end event, ignores duplicates, and waits for the end pause to complete', async () => {
  const state = { sessionMode:'audio', asset:null, allReady:true, playing:false };
  const played = [], loaded = [];
  const queue = new AudioQueue({ blocked:()=>false, state:()=>state, validate:async()=>{},
    load:async file=>{loaded.push(file.name);state.asset={version:file.name};return state;},
    play:async version=>{played.push(version);return true;}, error:message=>assert.fail(message),
  });
  await queue.add([{name:'only-song'}]);
  const source = {screen:1,ready:true,ended:true,assetVersion:'only-song',endId:'end-1'};
  state.playing = true; queue.observe(state,[source]); await nextTurn();
  assert.deepEqual(played,[], 'the previous end pause must settle before restarting the same asset');
  state.playing = false; queue.observe(state,[source]); queue.observe(state,[source]); await nextTurn();
  assert.deepEqual(played,['only-song']);
  queue.observe(state,[source]); await nextTurn(); assert.equal(played.length,1);
  source.endId='end-2'; queue.observe(state,[source]); await nextTurn();
  assert.deepEqual(played,['only-song','only-song']);
  assert.deepEqual(loaded,['only-song']);
});

test('cancel, clear and repeated end reports cannot restart a stale song', async () => {
  const state = { sessionMode: 'audio', asset: null, allReady: false };
  const played = [];
  const queue = new AudioQueue({ blocked: () => false, validate: async () => {},
    load: async file => { state.asset = { version: file.name }; return state; },
    play: async version => { played.push(version); return true; }, error: message => assert.fail(message),
  });
  await queue.add([{ name: 'one' }, { name: 'two' }]);
  await queue.select(queue.items[1].id);
  state.allReady = true;
  queue.observe(state, []); queue.cancelAutoplay(); await nextTurn();
  assert.deepEqual(played, []);
  state.allReady = false;
  await queue.select(queue.items[0].id);
  state.allReady = true; queue.observe(state, []); queue.clear(); await nextTurn();
  assert.deepEqual(played, []);
  assert.deepEqual(queue.items, []);
});

test('a stale Display 1 tab cannot finish the current song ahead of the latest tab, and repeat holds the song', async () => {
  const state = { sessionMode: 'audio', asset: null, allReady: false, loop: true };
  const loaded = [];
  const queue = new AudioQueue({ blocked: () => false, validate: async () => {},
    load: async file => { loaded.push(file.name); state.asset = { version: file.name }; return state; },
    play: async () => true, error: message => assert.fail(message),
  });
  await queue.add([{ name: 'one' }, { name: 'two' }]);
  const reports = [
    { screen: 1, assetVersion: 'one', ready: true, ended: true, lastSeen: 1 },
    { screen: 1, assetVersion: 'one', ready: true, ended: false, lastSeen: 2 },
  ];
  state.loop = false; queue.observe(state, reports); await nextTurn();
  assert.deepEqual(loaded, ['one']);
  state.loop = true; reports[1].ended = true; queue.observe(state, reports); await nextTurn();
  assert.deepEqual(loaded, ['one']);
  state.loop = false; reports[1].error = 'Reconnecting'; queue.observe(state, reports); await nextTurn();
  assert.deepEqual(loaded, ['one']);
});

test('pausing while the next file loads cancels its automatic start', async () => {
  const state = { sessionMode: 'audio', asset: null, allReady: true };
  let finish;
  const played = [];
  const queue = new AudioQueue({ blocked: () => false, state: () => state, validate: async () => {},
    load: async file => { if (file.name === 'two') await new Promise(resolve => { finish = resolve; }); state.asset = {version:file.name}; return state; },
    play: async version => { played.push(version); return true; }, error: message => assert.fail(message),
  });
  await queue.add([{name:'one'}, {name:'two'}]);
  const loading = queue.select(queue.items[1].id);
  queue.cancelAutoplay(); finish(); await loading; await nextTurn();
  assert.equal(queue.version, 'two'); assert.equal(queue.pendingPlay, ''); assert.deepEqual(played, []);
});
