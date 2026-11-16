'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = readFileSync(path.join(__dirname, '../public/home-frog.js'), 'utf8');

function interaction({ wrapped = false } = {}) {
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const target = bounds => ({ getBoundingClientRect: () => bounds });
  const frog = target(rect(100, 90, 40, 32));
  const button = target(rect(100, 120, 110, 40));
  const more = target(wrapped ? rect(100, 172, 152, 40) : rect(222, 120, 152, 40));
  const tongue = { setAttribute: (name, value) => { tongue[name] = value; } };
  const base = { setAttribute: (name, value) => { base[name] = value; } };
  const glint = { setAttribute: () => {} };
  const fly = { style: {} };
  const perched = new Set();
  const flight = { hidden: true, classList: { toggle: (name, on) => on ? perched.add(name) : perched.delete(name) }, querySelector: selector => ({
    '.home-frog-tongue-color': tongue, '.home-frog-tongue-base': base, '.home-frog-tongue-glint': glint, '.home-frog-fly': fly,
  })[selector] };
  const listeners = {};
  const classes = new Set();
  const features = new Map();
  let nextFrame;
  let nextTimer;
  vm.runInNewContext(script, {
    document: {
      querySelector: selector => ({
        '.home-frog': frog, '.home-frog-cta > a': button, '.home-hero-actions > a': more, '.home-frog-flight': flight,
      })[selector],
      documentElement: { classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } },
      addEventListener: (name, callback) => { listeners[name] = callback; },
    },
    window: { addEventListener: (name, callback) => { listeners[name] = callback; } },
    matchMedia(query) {
      const feature = { matches: query.includes('any-pointer'), addEventListener: (_, callback) => { feature.changed = callback; } };
      features.set(query, feature);
      return feature;
    },
    requestAnimationFrame: callback => { nextFrame = callback; return 1; },
    cancelAnimationFrame: () => { nextFrame = undefined; },
    setTimeout: callback => { nextTimer = callback; return 1; },
    clearTimeout: () => { nextTimer = undefined; },
  });
  function advance(now) {
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
  const rest = () => nextTimer?.();
  return { move, advance, rest, flight, tongue, base, fly, flyX, flyY, perched, classes, listeners, features };
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
