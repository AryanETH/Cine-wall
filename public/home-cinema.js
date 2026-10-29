'use strict';

function stickerPosition(width, height, size, anchor, angle = 0) {
  const radians = angle * Math.PI / 180;
  const extra = size * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)) - 1) / 2;
  const inset = extra + 5;
  return {
    x: inset + Math.max(0, width - size - inset * 2) * anchor,
    y: height - size - extra + Math.min(22, size * .18)
  };
}

function setupCinemaStickers(surface, stickers, motion, observeResize, random = Math.random) {
  if (!surface || !stickers.length) return;
  const turns = [-10, 8, -6, 9, -8, 12, -9, 6];
  const animations = new Map();
  const drifts = new Map();
  function drift(i) {
    if (motion.matches) return;
    const image = stickers[i].querySelector('img');
    if (!image?.animate) return;
    const sway = (random() - .5) * 10;
    const bob = 3 + random() * 6;
    const a = image.animate([
      { transform: 'translate(0, 0) rotate(0deg)' },
      { transform: `translate(${sway}px, ${-bob}px) rotate(${(random()-.5)*5}deg)` },
      { transform: 'translate(0, 0) rotate(0deg)' }
    ], { duration: 4200 + random() * 5000, iterations: Infinity, easing: 'ease-in-out' });
    a.currentTime = random() * 3000;
    drifts.set(i, a);
  }
  function settle(i) {
    animations.get(i)?.cancel();
    animations.delete(i);
    stickers[i].dataset.motion = 'home';
  }
  function layout() {
    const rect = surface.getBoundingClientRect();
    stickers.forEach((sticker, i) => {
      settle(i);
      drifts.get(i)?.cancel();
      const point = stickerPosition(rect.width, rect.height, sticker.offsetWidth, i / Math.max(1, stickers.length - 1), turns[i % turns.length]);
      sticker.style.setProperty('--sticker-left', `${point.x}px`);
      sticker.style.setProperty('--sticker-top', `${point.y}px`);
      sticker.style.setProperty('--sticker-turn', `${turns[i % turns.length]}deg`);
      sticker.disabled = motion.matches;
      drift(i);
    });
  }
  function move(i) {
    if (motion.matches || animations.has(i)) return;
    const sticker = stickers[i], image = sticker.querySelector('img');
    if (!image?.animate) return;
    const start = typeof getComputedStyle === 'function' ? getComputedStyle(image).transform : 'none';
    drifts.get(i)?.cancel();
    drifts.delete(i);
    const rect = surface.getBoundingClientRect(), size = sticker.offsetWidth;
    const home = stickerPosition(rect.width, rect.height, size, i / Math.max(1, stickers.length - 1), turns[i % turns.length]);
    const direction = random() < .5 ? -1 : 1;
    const travel = Math.min(size * (.3 + random() * .55), 110) * direction;
    const dx = Math.max(-home.x + 12, Math.min(rect.width - home.x - size - 12, travel));
    const lift = Math.min(rect.height * .4, size * (.65 + random() * .7));
    const rotation = direction * (10 + random() * 20);
    const animation = image.animate([
      { transform: start === 'none' ? 'translate(0, 0) rotate(0deg)' : start, offset: 0 },
      { transform: `translate(${dx}px, ${-lift}px) rotate(${rotation}deg)`, offset: .36 },
      { transform: `translate(${dx * -.18}px, ${-lift * .2}px) rotate(${direction * -9}deg)`, offset: .75 },
      { transform: 'translate(0, 0) rotate(0deg)', offset: 1 }
    ], { duration: 1800 + random() * 900, easing: 'cubic-bezier(.25,.65,.35,1)' });
    animations.set(i, animation);
    sticker.dataset.motion = 'floating';
    animation.onfinish = () => { settle(i); drift(i); };
  }
  stickers.forEach((sticker, i) => {
    sticker.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') move(i); });
    sticker.addEventListener('click', () => move(i));
  });
  motion.addEventListener('change', layout);
  observeResize(layout).observe(surface);
  layout();
  return { layout, move };
}

function setupCinemaLights(bulbs, motion, random = Math.random) {
  const animations = new Map();
  const baselines = bulbs.map(() => .38 + random() * .35);
  function glow(bulb, i, firstCycle) {
    if (motion.matches || !bulb.animate) return;
    const baseline = baselines[i];
    const duration = 6500 + random() * 7000;
    const animation = bulb.animate([
      { opacity: baseline, offset: 0 },
      { opacity: .12 + random() * .2, offset: .25 + random() * .12 },
      { opacity: .74 + random() * .26, offset: .6 + random() * .15 },
      { opacity: baseline, offset: 1 }
    ], { duration, easing: 'ease-in-out' });
    animations.set(bulb, animation);
    if (firstCycle) animation.currentTime = random() * duration;
    animation.onfinish = () => { animation.cancel(); glow(bulb, i, false); };
  }
  function update() {
    animations.forEach(animation => animation.cancel());
    animations.clear();
    bulbs.forEach((bulb, i) => glow(bulb, i, true));
  }
  motion.addEventListener('change', update);
  update();
  return { update };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { stickerPosition, setupCinemaStickers, setupCinemaLights };
if (typeof document !== 'undefined') {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  setupCinemaStickers(document.querySelector('#demo'), Array.from(document.querySelectorAll('.cinema-sticker')),
    motion, callback => new ResizeObserver(callback));
  setupCinemaLights(Array.from(document.querySelectorAll('.cinema-bulb')), motion);
}
