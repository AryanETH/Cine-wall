'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mixForScreen, roleForScreen, createRouter } = require('../public/audio-layout.js');

test('3D mode assigns left-to-right roles and balanced channel weights for 2–5 laptops', () => {
  const expected = {
    2: ['Left', 'Right'],
    3: ['Left', 'Centre', 'Right'],
    4: ['Left', 'Centre-left', 'Centre-right', 'Right'],
    5: ['Left', 'Centre-left', 'Centre', 'Centre-right', 'Right'],
  };
  for (const [countText, roles] of Object.entries(expected)) {
    const count = Number(countText);
    assert.deepEqual(Array.from({ length: count }, (_, index) => roleForScreen(count, index + 1)), roles);
    const mixes = Array.from({ length: count }, (_, index) => mixForScreen(count, index + 1));
    assert.equal(mixes[0].left, 1);
    assert.equal(mixes[0].right, 0);
    assert.equal(mixes.at(-1).left, 0);
    assert.equal(mixes.at(-1).right, 1);
    for (let index = 0; index < mixes.length; index++) {
      assert.ok(Math.abs(mixes[index].left + mixes[index].right - 1) < 1e-10);
      assert.ok(Math.abs(mixes[index].gain - Math.sqrt(2 / count)) < 1e-10);
      if (index) assert.ok(mixes[index].right > mixes[index - 1].right);
    }
  }
});

test('the router can switch from 3D back to full personal stereo without creating a second source', async () => {
  const original = global.AudioContext;
  const contexts = [];
  class FakeNode { connect() { return this; } }
  class FakeGain extends FakeNode {
    gain = { value: 0, setTargetAtTime(value) { this.value = value; } };
  }
  class FakeContext {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = new FakeNode(); this.gains = []; this.sources = 0; contexts.push(this); }
    createMediaElementSource() { this.sources++; return new FakeNode(); }
    createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain; }
    createAnalyser() { return Object.assign(new FakeNode(), { fftSize: 512, getFloatTimeDomainData(data) { data.fill(0.1); } }); }
    createChannelSplitter() { return new FakeNode(); }
    async resume() { this.state = 'running'; }
  }
  global.AudioContext = FakeContext;
  try {
    const router = createRouter({ paused: true, ended: false });
    assert.equal(router.set('personal', 3, 1, 'song-a'), true);
    assert.equal(contexts.length, 0, 'personal mode should use the native player until routing is needed');
    assert.equal(router.set('3d', 3, 1, 'song-a'), true);
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].sources, 1);
    assert.equal(contexts[0].gains[0].gain.value, 0, 'native stereo route is off in 3D mode');
    assert.equal(await router.resume(), true);
    assert.equal(router.set('personal', 3, 1, 'song-a'), true);
    assert.equal(contexts[0].gains[0].gain.value, 1, 'personal mode restores the full stereo route');
    assert.equal(contexts[0].gains[1].gain.value, 0);
    assert.equal(contexts[0].gains[2].gain.value, 0);
    assert.equal(contexts[0].sources, 1);
  } finally {
    if (original === undefined) delete global.AudioContext;
    else global.AudioContext = original;
  }
});
