'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = readFileSync(path.join(__dirname, '../public/home-frog.js'), 'utf8');

function interaction({ wrapped = false, withDemo = false, withPointing = false } = {}) {
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const target = bounds => ({ getBoundingClientRect: () => bounds });
  const pose = new Map();
  const offset = name => Number.parseFloat(pose.get(name)) || 0;
  let scrollY = 0;
  let waveEnd;
  let pointEnd;
  const gestureStyles = new Set();
  const waveArm = withDemo ? { addEventListener: (_, listener) => { waveEnd = listener; } } : null;
  const pointArm = withPointing ? { addEventListener: (_, listener) => { pointEnd = listener; } } : null;
  const eyes = [88, 294].map(x => ({
    dataset: { eyeX: String(x) },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
  }));
  const frog = {
    getBoundingClientRect: () => rect(100 + offset('--frog-pull'),
      (withDemo ? 260 : 90) - scrollY + offset('--frog-dip'), 40, 32),
    querySelectorAll: () => eyes,
    parentElement: {
      querySelector: selector => selector === '.home-frog-point-arm' ? pointArm : waveArm,
      style: { setProperty: (name, value) => pose.set(name, value) },
      classList: {
        add: name => gestureStyles.add(name),
        remove: name => gestureStyles.delete(name),
        contains: name => gestureStyles.has(name),
        toggle: (name, active) => active ? gestureStyles.add(name) : gestureStyles.delete(name),
      },
    },
  };
  const button = target(rect(100, 120, 110, 40));
  const more = target(wrapped ? rect(100, 172, 152, 40) : rect(222, 120, 152, 40));
  const tongue = { setAttribute: (name, value) => { tongue[name] = value; } };
  const base = { setAttribute: (name, value) => { base[name] = value; } };
  const glint = { setAttribute: () => {} };
  const fly = { style: {} };
  const perched = new Set();
  const flight = { hidden: true, classList: {
    toggle: (name, on) => on ? perched.add(name) : perched.delete(name),
    add: name => perched.add(name),
    remove: name => perched.delete(name),
  }, querySelector: selector => ({
    '.home-frog-tongue-color': tongue, '.home-frog-tongue-base': base, '.home-frog-tongue-glint': glint, '.home-frog-fly': fly,
  })[selector] };
  const listeners = {};
  const classes = new Set();
  const features = new Map();
  let nextFrame;
  let nextTimer;
  let time = 0;
  vm.runInNewContext(script, {
    document: {
      querySelector: selector => ({
        '.home-frog': frog, '.home-frog-cta > a': button, '.home-hero-actions > a': more, '.home-frog-flight': flight,
        '#demo': withDemo ? { getBoundingClientRect: () => rect(0, 375 - scrollY, 1000, 560) } : null,
      })[selector],
      documentElement: { classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } },
      addEventListener: (name, callback) => { listeners[name] = callback; },
    },
    window: { innerHeight: 760, addEventListener: (name, callback) => { listeners[name] = callback; } },
    matchMedia(query) {
      const feature = { matches: query.includes('any-pointer'), addEventListener: (_, callback) => { feature.changed = callback; } };
      features.set(query, feature);
      return feature;
    },
    requestAnimationFrame: callback => { nextFrame = callback; return 1; },
    cancelAnimationFrame: () => { nextFrame = undefined; },
    setTimeout: (callback, delay) => { nextTimer = { callback, due: time + delay }; return nextTimer; },
    clearTimeout: timer => { if (timer === nextTimer) nextTimer = undefined; },
  });
  function advance(now) {
    time = now;
    const update = nextFrame;
    nextFrame = undefined;
    update?.(now);
  }
  function move(x, y, pointerType = 'mouse', now = 0) {
    listeners.pointermove({ clientX: x, clientY: y, pointerType, target: {} });
    advance(now);
  }
  const flyX = () => Number(/^translate3d\(([^p]+)px/.exec(fly.style.transform)[1]);
  const flyY = () => Number(/, ([^p]+)px/.exec(fly.style.transform)[1]);
  const rest = () => {
    const pending = nextTimer;
    nextTimer = undefined;
    pending?.callback();
  };
  const tick = now => {
    while (nextTimer?.due <= now) {
      time = nextTimer.due;
      rest();
    }
    advance(now);
  };
  const gaze = eye => eyes[eye].transform.slice(10, -1).split(' ').map(Number);
  const scroll = (offset, now = 0) => { scrollY = offset; listeners.scroll(); advance(now); };
  const isWaving = () => gestureStyles.has('is-waving');
  const finishWave = () => waveEnd({ animationName: 'home-frog-wave' });
  const isPointing = () => gestureStyles.has('is-pointing');
  const finishPointing = () => pointEnd({ animationName: 'home-frog-point' });
  const shift = () => offset('--frog-pull');
  const crouch = () => offset('--frog-dip');
  const paws = () => [offset('--frog-left-paw-x'), offset('--frog-right-paw-x')];
  return { move, advance, rest, tick, flight, tongue, base, fly, flyX, flyY, gaze, shift, crouch, paws, perched, classes, listeners, features, scroll, isWaving, finishWave, isPointing, finishPointing };
}

test('the fly lags behind the pointer before and during the catch, then settles when the pointer stops', () => {
  const state = interaction();
  state.move(100, 130);
  assert.equal(state.flight.hidden, false);
  assert.equal(state.classes.has('frog-hunting'), true);
  state.move(180, 140, 'mouse', 100);
  assert.ok(state.flyX() > 100 && state.flyX() < 140);
  assert.match(state.fly.style.transform, /translate\(-50%, -50%\)$/);
  assert.match(state.tongue.d, /^M [\s\S]+ Z$/);
  assert.equal(state.base.cx, 120);
  const [, startY, controlY] = /M \S+ (\S+)\s+C \S+ (\S+)/.exec(state.tongue.d);
  assert.equal(startY, controlY, 'the tongue starts horizontally at the mouth');
  for (let now = 120; now <= 620; now += 20) state.advance(now);
  assert.equal(state.flyX(), 180);
  state.move(210, 130, 'mouse', 640);
  assert.ok(state.flyX() > 180 && state.flyX() < 195, 'the caught fly keeps moving more slowly than the pointer');
  for (let now = 660; now <= 1100; now += 20) state.advance(now);
  assert.equal(state.flyX(), 210);
});

test('the larger interaction area ends before More from CineWall', () => {
  const state = interaction();
  state.move(214, 130);
  assert.equal(state.flight.hidden, false);
  state.move(221, 130);
  assert.equal(state.flight.hidden, true);
  assert.equal(state.classes.has('frog-hunting'), false);
  state.move(246, 130);
  assert.equal(state.flight.hidden, true);
  state.move(150, 204);
  assert.equal(state.flight.hidden, false);
  state.move(150, 209);
  assert.equal(state.flight.hidden, true);

  const narrow = interaction({ wrapped: true });
  narrow.move(150, 145);
  assert.equal(narrow.flight.hidden, false);
  narrow.move(150, 179);
  assert.equal(narrow.flight.hidden, true);
});

test('Flai turns with its actual side of the button and stays steady around the midpoint', () => {
  const state = interaction();
  state.move(135, 130);
  assert.equal(state.perched.has('faces-right'), false);
  state.move(190, 130, 'mouse', 20);
  assert.equal(state.perched.has('faces-right'), false, 'turn waits for the trailing fly to cross');
  for (let now = 40; now <= 620; now += 20) state.advance(now);
  assert.equal(state.perched.has('faces-right'), true);
  state.move(155, 130, 'mouse', 640);
  for (let now = 660; now <= 1200; now += 20) state.advance(now);
  assert.equal(state.perched.has('faces-right'), true, 'the midpoint keeps the previous pose');
  state.move(130, 130, 'mouse', 1220);
  for (let now = 1240; now <= 1800; now += 20) state.advance(now);
  assert.equal(state.perched.has('faces-right'), false);
});

test('Flai faces left when resting after flying on the right', () => {
  const state = interaction();
  state.move(190, 130);
  for (let now = 20; now <= 400; now += 20) state.advance(now);
  assert.equal(state.perched.has('faces-right'), true);
  state.rest();
  for (let now = 540; now <= 1500; now += 20) state.advance(now);
  assert.ok(state.perched.has('is-perched'));
  assert.equal(state.perched.has('faces-right'), false);
  state.move(195, 130, 'mouse', 1520);
  for (let now = 1540; now <= 2100; now += 20) state.advance(now);
  assert.equal(state.perched.has('faces-right'), true, 'flying on the right still faces right');
});

test('the frog crouches to aim before the tongue flicks out', () => {
  const state = interaction();
  state.move(175, 130);
  assert.ok(state.perched.has('is-aiming'));
  state.advance(190);
  const dip = state.crouch();
  assert.ok(dip > 1.5);
  assert.ok(state.perched.has('is-aiming'));
  assert.deepEqual(state.paws(), [0, 0]);
  state.advance(245);
  assert.equal(state.perched.has('is-aiming'), false);
  assert.ok(state.crouch() < dip);
  state.advance(310);
  assert.equal(state.crouch(), 0);
});

test('touch, blur, and reduced motion restore the normal cursor', () => {
  const state = interaction();
  state.move(120, 135);
  state.move(120, 135, 'touch');
  assert.equal(state.flight.hidden, true);
  state.move(120, 135);
  state.listeners.blur();
  assert.equal(state.flight.hidden, true);
  state.move(120, 135);
  const reduced = state.features.get('(prefers-reduced-motion: reduce)');
  reduced.matches = true;
  reduced.changed();
  state.move(120, 135);
  assert.equal(state.classes.has('frog-hunting'), false);
});

test('the frog pulls the fly to the button when the pointer rests and releases it when movement resumes', () => {
  const state = interaction();
  state.move(183, 140);
  state.rest();
  for (let now = 540; now <= 1060; now += 20) state.advance(now);
  assert.equal(state.flyX(), 155);
  assert.equal(state.flyY(), 110);
  assert.ok(state.perched.has('is-perched'));
  state.move(125, 130, 'mouse', 1080);
  assert.equal(state.perched.has('is-perched'), false);
  for (let now = 1100; now <= 1540; now += 20) state.advance(now);
  assert.equal(state.flyX(), 125);
  state.move(260, 130, 'mouse', 1560);
  state.rest();
  state.advance(2200);
  assert.equal(state.flight.hidden, true);
});

test('both eyes track the visible fly as it trails the mouse and the pointer after it is freed', () => {
  const state = interaction();
  state.move(100, 100);
  assert.ok(state.gaze(0)[0] < 0 && state.gaze(1)[0] < 0);
  state.move(180, 140, 'mouse', 20);
  assert.ok(state.gaze(1)[0] < 0, 'the right eye follows the trailing fly');
  for (let now = 40; now <= 600; now += 20) state.advance(now);
  assert.ok([0, 1].every(eye => state.gaze(eye).every(offset => offset > 0)), 'both eyes follow the fly down and right');
  state.move(230, 80, 'mouse', 620);
  assert.equal(state.flight.hidden, true);
  assert.ok([0, 1].every(eye => state.gaze(eye)[1] < 0), 'the eyes follow the arrow upward after release');
});

test('the caught fly pulls the frog only at the far right, then the frog rebounds to rest', () => {
  const state = interaction();
  state.move(194, 130);
  state.advance(400);
  assert.equal(state.shift(), 0);
  state.move(215, 130, 'mouse', 420);
  for (let now = 440; now <= 1000; now += 20) state.advance(now);
  const pulled = state.shift();
  assert.ok(pulled > 8 && pulled <= 14);
  assert.ok(state.paws()[0] < state.paws()[1], 'the left paw braces against the pull');
  assert.equal(state.base.cx, 120 + pulled, 'the tongue starts at the moving mouth');
  state.move(217, 130, 'mouse', 1020);
  assert.equal(state.flight.hidden, true, 'sliding does not extend the capture radius');
  assert.equal(state.shift(), pulled);
  state.advance(1240);
  assert.ok(state.shift() < 0 && state.shift() > -2, 'the frog travels briefly to the left of its resting point');
  state.advance(1370);
  assert.equal(state.shift(), 0);
  assert.equal(state.paws()[0], 0);
  assert.notEqual(state.paws()[1], 0, 'the right paw is still settling');
  state.advance(1440);
  assert.deepEqual(state.paws(), [0, 0]);
});

test('the frog waves once as the demo crosses the scroll point in either direction', () => {
  const state = interaction({ withDemo: true });
  state.scroll(225);
  assert.equal(state.isWaving(), false, 'small movement at the boundary does not trigger a wave');
  state.scroll(235, 16);
  assert.equal(state.isWaving(), true);
  state.finishWave();
  assert.equal(state.isWaving(), false);
  state.scroll(246, 1300);
  assert.equal(state.isWaving(), false, 'scrolling farther down does not repeat the wave');
  state.scroll(203, 1320);
  assert.equal(state.isWaving(), true, 'the return past the same point waves again');
  const reduced = state.features.get('(prefers-reduced-motion: reduce)');
  reduced.matches = true;
  reduced.changed();
  assert.equal(state.isWaving(), false);
  state.scroll(235, 1340);
  assert.equal(state.isWaving(), false);
});

test('the frog points every five seconds after the fly lands and stops on takeoff', () => {
  const state = interaction({ withPointing: true });
  state.move(183, 140);
  state.rest();
  let landed = 540;
  for (; landed <= 1300; landed += 20) {
    state.advance(landed);
    if (state.perched.has('is-perched')) break;
  }
  assert.ok(state.perched.has('is-perched'));
  const eyesOnFly = state.gaze(0)[1];
  state.tick(landed + 4999);
  assert.equal(state.isPointing(), false);
  assert.ok(state.gaze(0)[1] > eyesOnFly, 'the frog glances down before it points');
  state.tick(landed + 5000);
  assert.equal(state.isPointing(), true);
  state.finishPointing();
  assert.equal(state.isPointing(), false);
  state.tick(landed + 9999);
  assert.equal(state.isPointing(), false);
  state.tick(landed + 10000);
  assert.equal(state.isPointing(), true);
  state.move(230, 130, 'mouse', landed + 10100);
  assert.equal(state.isPointing(), false);
  state.tick(landed + 15000);
  assert.equal(state.isPointing(), false);
});
