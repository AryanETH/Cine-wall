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
