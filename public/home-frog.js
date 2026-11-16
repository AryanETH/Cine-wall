'use strict';
(() => {
  const frog = document.querySelector('.home-frog');
  const button = document.querySelector('.home-frog-cta > a');
  const more = document.querySelector('.home-hero-actions > a');
  const flight = document.querySelector('.home-frog-flight');
  if (!frog || !button || !flight) return;

  const tongue = flight.querySelector('.home-frog-tongue-color');
  const base = flight.querySelector('.home-frog-tongue-base');
  const glint = flight.querySelector('.home-frog-tongue-glint');
  const fly = flight.querySelector('.home-frog-fly');
  const root = document.documentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const mouse = matchMedia('(any-hover: hover) and (any-pointer: fine)');
  const radius = 36 * 1.3;
  const catchDelay = 210;
  const perchDelay = 540;
  let position;
  let chase;
  let frame = 0;
  let perchTimer;
  let wantsPerch = false;

  function near(rect, x, y, margin = radius) {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return rect.width > 0 && rect.height > 0 && Math.hypot(dx, dy) <= margin;
  }

  function display(active) {
    if (flight.hidden === !active) return;
    flight.hidden = !active;
    root.classList.toggle('frog-hunting', active);
  }

  function paint(now) {
    frame = 0;
    if (!position) return;
    const bounds = button.getBoundingClientRect();
    const frogRect = frog.getBoundingClientRect();
    const moreRect = more?.getBoundingClientRect();
    const nextToMore = moreRect && moreRect.left >= bounds.right && moreRect.top < bounds.bottom;
    const rightEdge = Math.min(bounds.right + bounds.width * .3, nextToMore ? moreRect.left - 6 : Infinity);
    const { x: pointerX, y: pointerY } = position;
    if (pointerX > rightEdge ||
      (moreRect && near(moreRect, pointerX, pointerY, 0)) ||
      (!near(frogRect, pointerX, pointerY) && !near(bounds, pointerX, pointerY))) {
      chase = undefined;
      clearPerch();
      display(false);
      return;
    }

    if (!wantsPerch && perchTimer === undefined) {
      perchTimer = setTimeout(() => {
        perchTimer = undefined;
        wantsPerch = true;
        requestPaint();
      }, perchDelay);
    }
    chase ??= { ...position, started: now, lastFrame: now };
    const perchX = Math.min(bounds.right - 15, Math.max(bounds.left + 15, frogRect.right + 15));
    const targetX = wantsPerch ? perchX : pointerX;
    const targetY = wantsPerch ? bounds.top - 10 : pointerY;
    const elapsed = Math.min(20, Math.max(0, now - chase.lastFrame));
    const halfLife = wantsPerch ? 57 : now - chase.started < catchDelay ? 70 : 50;
    const step = 1 - Math.pow(.5, elapsed / halfLife);
    chase.lastFrame = now;
    chase.x = Math.min(rightEdge, chase.x + (targetX - chase.x) * step);
    chase.y += (targetY - chase.y) * step;
    const following = Math.hypot(targetX - chase.x, targetY - chase.y) > .45;
    if (!following) { chase.x = targetX; chase.y = targetY; }
    const { x, y } = chase;
    const startX = frogRect.left + frogRect.width * .5;
    const startY = frogRect.top + frogRect.height * .493;
    const dx = x - startX;
    const dy = y - startY;
    const length = Math.hypot(dx, dy);
    const facing = dx < 0 ? -1 : 1;
    const firstX = startX + facing * Math.min(27, length * .45);
    const secondX = x - dx * .23;
    const secondY = y - dy * .35 + Math.min(9, length * .09);
    const tipX = x - secondX, tipY = y - secondY;
    const tipLength = Math.max(1, Math.hypot(tipX, tipY));
    const nx = -tipY / tipLength, ny = tipX / tipLength;
    const edge = (px, py, width) => `${px + nx * width} ${py + ny * width}`;
    const upper = startY - facing * 2;
    const lower = startY + facing * 2;
    tongue.setAttribute('d', `M ${startX} ${upper}
      C ${firstX} ${upper} ${edge(secondX, secondY, -2.4)} ${edge(x, y, -3)}
      Q ${x + tipX / tipLength * 4} ${y + tipY / tipLength * 4} ${edge(x, y, 3)}
      C ${edge(secondX, secondY, 2.4)} ${firstX} ${lower} ${startX} ${lower} Z`);
    base.setAttribute('cx', startX);
    base.setAttribute('cy', startY);
    glint.setAttribute('d', `M ${startX} ${startY - facing * .8}
      C ${firstX} ${startY - facing * .8} ${edge(secondX, secondY, -1.1)} ${edge(x, y, -1.1)}`);
    fly.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    flight.classList.toggle('is-perched', wantsPerch && !following);
    display(true);
    if (following) requestPaint();
  }

  function requestPaint() {
    if (position && !frame) frame = requestAnimationFrame(paint);
  }

  function clearPerch() {
    clearTimeout(perchTimer);
    perchTimer = undefined;
    wantsPerch = false;
  }

  function reset() {
    position = undefined;
    chase = undefined;
    clearPerch();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    display(false);
  }

  document.addEventListener('pointermove', event => {
    if (motion.matches || !mouse.matches || event.pointerType !== 'mouse' || event.target.closest?.('dialog')) {
      reset();
      return;
    }
    if (position?.x === event.clientX && position.y === event.clientY) return;
    clearPerch();
    position = { x: event.clientX, y: event.clientY };
    requestPaint();
  }, { passive: true });
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) reset(); }, { passive: true });
  document.addEventListener('pointercancel', reset, { passive: true });
  document.addEventListener('visibilitychange', reset);
  window.addEventListener('resize', requestPaint);
  window.addEventListener('scroll', requestPaint, { passive: true });
  window.addEventListener('blur', reset);
  motion.addEventListener('change', reset);
  mouse.addEventListener('change', reset);
})();
