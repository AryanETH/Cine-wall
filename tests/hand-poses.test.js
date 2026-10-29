'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { geometryGesture, labelFromResult, unrotateResult, HoldGate } = require('../public/hand-gestures');
function hand(open = [true, true, true, true], { spread = 1, bend = 0, thumb = false } = {}) {
  const p = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const point = (x, y, z = 0) => ({ x, y, z });
  p[0] = point(0, 0);
  p[1] = point(-.025, .025); p[2] = point(-.045, .045);
  p[3] = thumb ? point(-.06, .08) : point(-.03, .065);
  p[4] = thumb ? point(-.075, .115) : point(-.02, .078);
  for (let i = 0; i < 4; i++) {
    const base = 5 + i * 4, x = (i - 1.5) * .02, y = .075 - Math.abs(i - 1) * .007;
    const splay = (i - 1.5) * spread * .007;
    const a = (open[i] ? bend : 100) * Math.PI / 180, b = (open[i] ? bend + 15 : 190) * Math.PI / 180;
    p[base] = point(x, y); p[base + 1] = point(x + splay, y + .03);
    p[base + 2] = point(x + splay * 1.5, y + .03 + .022 * Math.cos(a), .022 * Math.sin(a));
    p[base + 3] = point(x + splay * 2, p[base + 2].y + .017 * Math.cos(b), p[base + 2].z + .017 * Math.sin(b));
  }
  return p;
}
function transform(points, { x = 0, y = 0, z = 0, mirror = false, scale = 1 } = {}) {
  return points.map(p => {
    let a = p.x * (mirror ? -1 : 1), b = p.y, c = p.z;
    [b, c] = [b * Math.cos(x) - c * Math.sin(x), b * Math.sin(x) + c * Math.cos(x)];
    [a, c] = [a * Math.cos(y) + c * Math.sin(y), -a * Math.sin(y) + c * Math.cos(y)];
    [a, b] = [a * Math.cos(z) - b * Math.sin(z), a * Math.sin(z) + b * Math.cos(z)];
    return { x: a * scale + .2, y: b * scale + .1, z: c * scale - .1 };
  });
}
function result(world, label = 'None', score = .2) {
  return { landmarks: [world.map(p => ({ x: .5 + p.x, y: .5 - p.y, z: p.z }))], worldLandmarks: [world],
    gestures: [[{ categoryName: label, score }]], imageAspect: .75 };
}
test('finger-shape recognition accepts left/right, palm/back, tilted and upside-down variants', () => {
  const poses = [
    ['Open_Palm', [true, true, true, true]], ['Closed_Fist', [false, false, false, false]],
    ['Victory', [true, true, false, false]], ['ILoveYou', [true, false, false, true]]
  ];
  for (const [label, pattern] of poses) for (const spread of [0, .5, 1.4]) for (const bend of [0, 25, 40]) {
    for (const mirror of [false, true]) for (const z of [0, .6, 1.6, Math.PI]) for (const y of [0, .9, 2.3]) {
      const world = transform(hand(pattern, { spread, bend }), { mirror, z, y, x: .5, scale: 1.5 });
      assert.equal(labelFromResult(result(world)), label, JSON.stringify({ label, spread, bend, mirror, z, y }));
    }
  }
});
test('thumb direction accepts either hand and diagonal tilts, but does not guess a horizontal volume command', () => {
  for (const mirror of [false, true]) for (const z of [-.6, 0, .6]) {
    const world = transform(hand([false, false, false, false], { thumb: true, spread: 0 }), { mirror, z });
    assert.equal(labelFromResult(result(world)), 'Thumb_Up');
    const down = world.map(p => ({ ...p, y: -p.y }));
    assert.equal(labelFromResult(result(down)), 'Thumb_Down');
  }
  const world = transform(hand([false, false, false, false], { thumb: true, spread: 0 }));
  const sample = result(world); sample.landmarks[0][4].y = sample.landmarks[0][2].y;
  assert.equal(labelFromResult(sample), '');
});
test('relaxed thumbs are accepted for two-finger and horns gestures; incomplete poses stay unassigned', () => {
  assert.equal(labelFromResult(result(hand([true, true, false, false], { spread: 0, bend: 35 }))), 'Victory');
  assert.equal(labelFromResult(result(hand([true, false, false, true], { bend: 35 }))), 'ILoveYou');
  assert.equal(labelFromResult(result(hand([true, false, false, false]))), '');
});
test('landmark validation rejects corrupt geometry; confident model remains a fallback', () => {
  assert.equal(geometryGesture([], []).usable, false);
  const sample = result(hand()); sample.landmarks.push([]);
  assert.equal(labelFromResult(sample), '');
  assert.equal(labelFromResult({ landmarks: [[]], gestures: [[{ categoryName: 'Victory', score: .85 }]] }), 'Victory');
  assert.equal(labelFromResult({ landmarks: [[]], gestures: [[{ categoryName: 'Victory', score: .4 }]] }), '');
});
test('short recognition dropouts preserve the hold while sustained neutral still rearms it', () => {
  const gate = new HoldGate(); let fired = [];
  for (let t = 0; t <= 800; t += 100) {
    const step = gate.push(t === 300 ? '' : 'Open_Palm', t); if (step.action) fired.push(step.action);
  }
  assert.deepEqual(fired, ['play']);
  for (let t = 900; t <= 1500; t += 100) assert.equal(gate.push('Open_Palm', t).action, undefined);
  for (let t = 1600; t <= 2100; t += 100) gate.push('', t);
  let action; for (let t = 2200; t <= 2900; t += 100) action = gate.push('Closed_Fist', t).action || action;
  assert.equal(action, 'pause');
});
test('a smaller resting hand is tolerated but conflicting equally prominent gestures are ignored', () => {
  const prominent = result(hand()), resting = result(transform(hand([false, false, false, false]), { scale: .45 }));
  const combine = (a, b) => ({ landmarks: [...a.landmarks, ...b.landmarks], worldLandmarks: [...a.worldLandmarks, ...b.worldLandmarks], gestures: [...a.gestures, ...b.gestures] });
  assert.equal(labelFromResult(combine(prominent, resting)), 'Open_Palm');
  assert.equal(labelFromResult(combine(prominent, result(hand([false, false, false, false])))), '');
  assert.equal(labelFromResult(combine(prominent, prominent)), 'Open_Palm');
});
test('rotated detector coordinates return to camera orientation without reversing volume commands', () => {
  const original = result(hand([false, false, false, false], { thumb: true, spread: 0 }), 'Thumb_Up', .9);
  for (const turns of [1, 2, 3]) {
    const rotated = structuredClone(original); rotated.imageAspect = .75;
    rotated.landmarks[0] = original.landmarks[0].map(p => {
      let { x, y } = p; for (let i = 0; i < turns; i++) [x, y] = [1 - y, x];
      return { ...p, x, y, z: p.z / (turns % 2 ? .75 : 1) };
    });
    rotated.worldLandmarks[0] = original.worldLandmarks[0].map(p => {
      let { x, y } = p; for (let i = 0; i < turns; i++) [x, y] = [-y, x]; return { ...p, x, y };
    });
    const restored = unrotateResult(rotated, turns);
    assert.equal(labelFromResult(restored), 'Thumb_Up');
    for (let i = 0; i < 21; i++) for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(restored.landmarks[0][i][axis] - original.landmarks[0][i][axis]) < 1e-10);
  }
});
