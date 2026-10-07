'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { qualityProfile, tuneReceiver, tuneSender } = require('../public/share-media.js');

test('Auto limits total video traffic and reduces capture load for ten receivers', () => {
  assert.deepEqual(qualityProfile('auto', 1), { height: 1080, fps: 30, bitrate: 3500000 });
  assert.deepEqual(qualityProfile('auto', 10), { height: 720, fps: 20, bitrate: 1200000 });
  for (let count = 1; count <= 10; count++) assert.ok(qualityProfile('auto', count).bitrate * count <= 12000000);
  assert.equal(qualityProfile('720p', 10).height, 720);
  assert.deepEqual(qualityProfile('1080p', 10), { height: 1080, fps: 30, bitrate: 5000000 });
});

test('audio and video use equal small receiver buffers, without requiring modern browser support', () => {
  for (const kind of ['audio', 'video']) {
    const receiver = { track: { kind }, jitterBufferTarget: null, playoutDelayHint: null };
    tuneReceiver(receiver);
    assert.equal(receiver.jitterBufferTarget, 60);
    assert.equal(receiver.playoutDelayHint, .06);
  }
  assert.doesNotThrow(() => tuneReceiver({}));
  assert.doesNotThrow(() => tuneReceiver(null));
  assert.doesNotThrow(() => tuneReceiver({ get jitterBufferTarget() { return null; }, set jitterBufferTarget(_) { throw new Error('Unsupported'); } }));
});

test('sender tuning prioritizes audio and limits traffic; unsupported settings never break playback', async () => {
  let saved;
  const sender = { track: { kind: 'audio' }, getParameters: () => ({ encodings: [{ priority: 'low' }] }), setParameters: async parameters => { saved = parameters; } };
  await tuneSender(sender, { bitrate: 128000 });
  assert.equal(saved.encodings[0].priority, 'high');
  assert.equal(saved.encodings[0].maxBitrate, 128000);
  sender.track.kind = 'video';
  await tuneSender(sender, { bitrate: 1200000, fps: 20 });
  assert.equal(saved.encodings[0].maxFramerate, 20);
  assert.equal(saved.encodings[0].maxBitrate, 1200000);
  await assert.doesNotReject(() => tuneSender({ getParameters() { throw new Error('Older browser'); } }));
});

test('homepage enables Screen sharing with its optimized image while YouTube stays Coming soon', () => {
  const home = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const card = home.match(/<a class="mode-card" data-bg="screen-sharing"[\s\S]*?<\/a>/)?.[0];
  assert.ok(card);
  assert.match(card, /href="\/share.html"/);
  assert.match(card, /Up to 10 screens/);
  assert.doesNotMatch(card, /coming-soon|data-session-mode/);
  assert.doesNotMatch(home, /data-bg="presentation"/);
  assert.doesNotMatch(home, /class="home-share-banner"/);
  assert.match(home, /youtube-mode-card coming-soon/);
  assert.ok(fs.statSync(path.join(__dirname, '../public/assets/screen-sharing-team.webp')).size < 150000);
  const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
  assert.match(css, /screen-sharing-team\.webp/);
  assert.match(css, /data-bg="screen-sharing"\] \.mode-card-art\s*\{[^}]*background-size: cover/);
  assert.match(css, /data-bg="screen-sharing"\] \.mode-card-art\s*\{[^}]*background-position: center 15%/);
  const share = fs.readFileSync(path.join(__dirname, '../public/share.html'), 'utf8');
  assert.ok(share.indexOf('src="share-media.js') < share.indexOf('src="share-call.js'));
  const script = fs.readFileSync(path.join(__dirname, '../public/share.js'), 'utf8');
  assert.match(script, /screen <= 10/);
  assert.match(script, /settings\.count >= 10/);
});
