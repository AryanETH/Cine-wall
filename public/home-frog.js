'use strict';
(() => {
  const frog = document.querySelector('.home-frog');
  const button = document.querySelector('.home-frog-cta > a');
  const more = document.querySelector('.home-hero-actions > a');
  const flight = document.querySelector('.home-frog-flight');
  if (!frog || !button || !flight) return;

  const frogCta = frog.parentElement;
  const frogStyle = frogCta.style;
  const waveArm = frogCta.querySelector('.home-frog-wave-arm');
  const pointArm = frogCta.querySelector('.home-frog-point-arm');
  const demo = document.querySelector('#demo');
  const pupils = [...frog.querySelectorAll('.home-frog-pupil')].map(pupil => ({
    node: pupil,
    x: Number(pupil.dataset.eyeX) / 384,
  }));
  const tongue = flight.querySelector('.home-frog-tongue-color');
  const base = flight.querySelector('.home-frog-tongue-base');
  const glint = flight.querySelector('.home-frog-tongue-glint');
  const fly = flight.querySelector('.home-frog-fly');
  const root = document.documentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const mouse = matchMedia('(any-hover: hover) and (any-pointer: fine)');
  const radius = 36 * 1.3;
  const catchDelay = 210;
  const strikeDuration = 95;
  const perchDelay = 540;
  const pointInterval = 5000;
  const glanceLead = 180;
  const releaseDuration = 350;
  let position;
  let chase;
  let frame = 0;
  let perchTimer;
  let wantsPerch = false;
  let isPerched = false;
  let pointTimer;
  let glancingAtButton = false;
  let frogShift = 0;
  let frogDip = 0;
  let leftPawShift = 0;
  let rightPawShift = 0;
  let recoil;
  let waveSide;
  let wavePending = false;

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

  function canPoint() {
    return isPerched && !flight.hidden && !motion.matches;
  }

  function stopPointing() {
    const wasGlancing = glancingAtButton;
    glancingAtButton = false;
    frogCta.classList.remove('is-pointing');
    if (wasGlancing) requestPaint();
  }

  function cuePoint() {
    if (!canPoint()) return;
    if (!frogCta.classList.contains('is-waving')) {
      glancingAtButton = true;
      requestPaint();
    }
    pointTimer = setTimeout(pointAtButton, glanceLead);
  }

  function pointAtButton() {
    if (!canPoint()) return;
    if (!frogCta.classList.contains('is-waving')) {
      glancingAtButton = true;
      frogCta.classList.add('is-pointing');
      requestPaint();
    }
    pointTimer = setTimeout(cuePoint, pointInterval - glanceLead);
  }

  function setPerched(perched) {
    if (perched === isPerched) return;
    isPerched = perched;
    flight.classList.toggle('is-perched', perched);
    frogCta.classList.toggle('is-perched', perched);
    if (perched && pointArm) pointTimer = setTimeout(cuePoint, pointInterval - glanceLead);
    else {
      clearTimeout(pointTimer);
      pointTimer = undefined;
      stopPointing();
    }
  }

  function placeFrog(x, dip, left = x * .64, right = x) {
    if (frogShift !== x) {
      frogShift = x;
      frogStyle.setProperty('--frog-pull', `${x}px`);
    }
    if (frogDip !== dip) {
      frogDip = dip;
      frogStyle.setProperty('--frog-dip', `${dip}px`);
    }
    if (leftPawShift !== left) {
      leftPawShift = left;
      frogStyle.setProperty('--frog-left-paw-x', `${left}px`);
    }
    if (rightPawShift !== right) {
      rightPawShift = right;
      frogStyle.setProperty('--frog-right-paw-x', `${right}px`);
    }
  }

  function lookAt(x, y, restBounds) {
    for (const pupil of pupils) {
      const dx = x - (restBounds.left + frogShift + restBounds.width * pupil.x);
      const dy = y - (restBounds.top + frogDip + restBounds.height * 87 / 304);
      const distance = Math.max(1, restBounds.width * .85, Math.hypot(dx, dy));
      pupil.node.setAttribute('transform', `translate(${dx / distance * 17} ${dy / distance * 12})`);
    }
  }

  function releaseFrog(now) {
    if (!recoil && (frogShift || frogDip || leftPawShift || rightPawShift)) {
      recoil = { x: frogShift, dip: frogDip, left: leftPawShift, right: rightPawShift, started: now };
    }
    if (!recoil) return false;
    const elapsed = now - recoil.started;
    const remaining = duration => Math.max(0, 1 - elapsed / duration);
    // The left paw settles first. The right paw carries the end of the recoil.
    const spring = duration => {
      const rest = remaining(duration);
      return rest ** 2 * (2.6 * rest - 1.6);
    };
    placeFrog(recoil.x * spring(releaseDuration), recoil.dip * remaining(releaseDuration) ** 2,
      recoil.left * spring(releaseDuration - 50), recoil.right * spring(releaseDuration + 70));
    if (elapsed >= releaseDuration && !leftPawShift && !rightPawShift) {
      recoil = undefined;
      return false;
    }
    return true;
  }

  function trackWave(play) {
    if (!waveArm || !demo) return;
    const frogRect = frog.getBoundingClientRect();
    const demoTop = demo.getBoundingClientRect().top;
    const height = window.innerHeight;
    // Match the demo near the top of the viewport, with room for the frog
    // even when the action buttons wrap on a narrow screen.
    const waveAt = Math.max(height * .2, demoTop - frogRect.top + 28);
    const offset = demoTop - waveAt;
    const side = offset < 0 ? -1 : 1;
    if (!play || waveSide === undefined) {
      waveSide = side;
      return;
    }
    if (side === waveSide || Math.abs(offset) < 8) return;
    waveSide = side;
    if (!motion.matches && frogRect.width > 0 && frogRect.top >= 4 && frogRect.bottom < height
        && Math.abs(offset) <= Math.min(96, height * .17)) {
      stopPointing();
      frogCta.classList.add('is-waving');
    }
  }

  function paint(now) {
    frame = 0;
    if (wavePending) {
      wavePending = false;
      trackWave(true);
    }
    if (!position) return;
    const bounds = button.getBoundingClientRect();
    const frogRect = frog.getBoundingClientRect();
    // Keep the capture radius fixed through the crouch and pull.
    const restLeft = frogRect.left - frogShift;
    const restRight = restLeft + frogRect.width;
    const restBounds = { left: restLeft, right: restRight, width: frogRect.width,
      top: frogRect.top - frogDip, bottom: frogRect.bottom - frogDip, height: frogRect.height };
    const moreRect = more?.getBoundingClientRect();
    const nextToMore = moreRect && moreRect.left >= bounds.right && moreRect.top < bounds.bottom;
    const rightEdge = Math.min(bounds.right + bounds.width * .3, nextToMore ? moreRect.left - 6 : Infinity);
    const { x: pointerX, y: pointerY } = position;
    if (pointerX > rightEdge ||
      (moreRect && near(moreRect, pointerX, pointerY, 0)) ||
      (!near(restBounds, pointerX, pointerY) && !near(bounds, pointerX, pointerY))) {
      chase = undefined;
      clearPerch();
      display(false);
      const returning = releaseFrog(now);
      lookAt(pointerX, pointerY, restBounds);
      if (returning) requestPaint();
      return;
    }

    recoil = undefined;
    if (!wantsPerch && perchTimer === undefined) {
      perchTimer = setTimeout(() => {
        perchTimer = undefined;
        wantsPerch = true;
        requestPaint();
      }, perchDelay);
    }
    chase ??= { ...position, started: now, lastFrame: now };
    const perchX = Math.min(bounds.right - 15, Math.max(bounds.left + 15, restRight + 15));
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
    // Follow the visible fly, including its trip back to the resting spot.
    // A small dead zone keeps the pose steady near the button's midpoint.
    const middle = bounds.left + bounds.width * .5;
    if (wantsPerch && !following) flight.classList.toggle('faces-right', x > middle);
    else if (x > middle + 4) flight.classList.add('faces-right');
    else if (x < middle - 4) flight.classList.remove('faces-right');
    const restMouth = restLeft + frogRect.width * .5;
    const reach = (x - restMouth) / Math.max(1, rightEdge - restMouth);
    const pullStrength = Math.max(0, Math.min(1, (reach - .8) / .2));
    const age = now - chase.started;
    const aim = Math.min(1, age / catchDelay);
    const strikeProgress = Math.max(0, Math.min(1, (age - catchDelay) / strikeDuration));
    const strike = 1 - (1 - strikeProgress) ** 3;
    const caught = strikeProgress === 1;
    const maxPull = Math.max(0, Math.min(14, bounds.right - restRight - 4));
    const pullTarget = caught ? pullStrength * maxPull : 0;
    const sliding = Math.abs(pullTarget - frogShift) > .04;
    placeFrog(sliding ? pullTarget + (frogShift - pullTarget) * Math.pow(.5, elapsed / 32) : pullTarget,
      2.6 * aim ** 2 * (1 - strike));
    setPerched(caught && wantsPerch && !following);
    flight.classList.toggle('is-aiming', strike === 0);
    if (glancingAtButton) lookAt(bounds.left + bounds.width * .24, bounds.top + bounds.height * .72, restBounds);
    else lookAt(x, y, restBounds);
    const startX = restMouth + frogShift;
    const startY = restBounds.top + frogDip + restBounds.height * .50;
    drawTongue(startX, startY, startX + (x - startX) * strike, startY + (y - startY) * strike);
    fly.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    display(true);
    if (following || sliding || !caught) requestPaint();
  }

  function drawTongue(startX, startY, x, y) {
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
  }

  function requestPaint() {
    if ((position || wavePending) && !frame) frame = requestAnimationFrame(paint);
  }

  function clearPerch() {
    clearTimeout(perchTimer);
    perchTimer = undefined;
    wantsPerch = false;
    setPerched(false);
  }

  function reset() {
    position = undefined;
    chase = undefined;
    clearPerch();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    display(false);
    recoil = undefined;
    placeFrog(0, 0);
    for (const pupil of pupils) pupil.node.removeAttribute('transform');
    requestPaint();
  }

  function stopWave() { frogCta.classList.remove('is-waving'); }
  waveArm?.addEventListener('animationend', event => {
    if (event.animationName === 'home-frog-wave') stopWave();
  });
  pointArm?.addEventListener('animationend', event => {
    if (event.animationName === 'home-frog-point') stopPointing();
  });
  trackWave(false);

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
  window.addEventListener('resize', () => { trackWave(false); requestPaint(); });
  window.addEventListener('scroll', () => {
    wavePending = Boolean(demo && waveArm && !motion.matches);
    requestPaint();
  }, { passive: true });
  window.addEventListener('blur', reset);
  motion.addEventListener('change', () => { stopWave(); trackWave(false); reset(); });
  mouse.addEventListener('change', reset);
})();
