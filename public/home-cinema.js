'use strict';

function stickerPosition(width, height, size, anchor, angle = 0) {
  const radians = angle * Math.PI / 180;
  const extra = size * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)) - 1) / 2;
  // Reduce inset to allow more overlapping with container edges
  const inset = Math.max(0, extra - size * 0.15);
  // Allow stickers to overflow container edges by extending the range
  const xRange = width + size * 0.3;
  return {
    x: -size * 0.15 + xRange * anchor,
    y: height - size * 0.7 - extra
  };
}

function setupCinemaStickers(surface, stickers, motion, observeResize, random = Math.random) {
  if (!surface || !stickers.length) return;
  const turns = [-15, 12, -8, 14, -11, 16, -13, 9];
  const animations = new Map();
  const drifts = new Map();
  const dragStates = new Map();
  const physics = new Map();
  
  // Physics constants
  const GRAVITY = 0.6;
  const BOUNCE_DAMPING = 0.65;
  const FRICTION = 0.98;
  const MIN_VELOCITY = 0.3;
  
  function drift(i) {
    if (motion.matches || dragStates.get(i)?.dragging) return;
    const image = stickers[i].querySelector('img');
    if (!image?.animate) return;
    const sway = (random() - .5) * 15;
    const bob = 5 + random() * 10;
    const rotate = (random() - .5) * 8;
    const a = image.animate([
      { transform: 'translate(0, 0) rotate(0deg)' },
      { transform: `translate(${sway}px, ${-bob}px) rotate(${rotate}deg)`, offset: 0.5 },
      { transform: 'translate(0, 0) rotate(0deg)' }
    ], { duration: 3500 + random() * 4500, iterations: Infinity, easing: 'ease-in-out' });
    a.currentTime = random() * 3000;
    drifts.set(i, a);
  }
  
  function settle(i) {
    animations.get(i)?.cancel();
    animations.delete(i);
    
    // Cancel any running physics animation
    if (physics.has(i)) {
      const p = physics.get(i);
      if (p.frame) cancelAnimationFrame(p.frame);
      physics.delete(i);
    }
    
    // Reset image transform
    const image = stickers[i].querySelector('img');
    if (image) {
      image.style.transform = '';
      image.style.transition = '';
    }
    
    stickers[i].dataset.motion = 'home';
  }
  
  function layout() {
    const rect = surface.getBoundingClientRect();
    stickers.forEach((sticker, i) => {
      if (dragStates.get(i)?.dragging) return;
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
  
  function animateWithPhysics(i, initialVx = 0, initialVy = 0, initialRotation = 0) {
    if (motion.matches) return;
    const sticker = stickers[i];
    const image = sticker.querySelector('img');
    if (!image) return;
    
    drifts.get(i)?.cancel();
    drifts.delete(i);
    animations.get(i)?.cancel();
    
    const rect = surface.getBoundingClientRect();
    const size = sticker.offsetWidth;
    const home = stickerPosition(rect.width, rect.height, size, i / Math.max(1, stickers.length - 1), turns[i % turns.length]);
    
    let x = 0, y = 0, vx = initialVx, vy = initialVy;
    let rotation = initialRotation;
    let bounceCount = 0;
    const maxBounces = 2 + Math.floor(random() * 2);
    
    sticker.dataset.motion = 'floating';
    
    const animate = () => {
      // Apply gravity
      vy += GRAVITY;
      
      // Apply friction
      vx *= FRICTION;
      vy *= FRICTION;
      
      // Update position
      x += vx;
      y += vy;
      
      // Rotation based on horizontal velocity
      rotation += vx * 0.5;
      
      // Bounce detection
      const groundY = 0;
      if (y > groundY && vy > 0) {
        y = groundY;
        vy *= -BOUNCE_DAMPING;
        vx *= 0.9; // Reduce horizontal velocity on bounce
        bounceCount++;
        
        // Add slight random direction change on bounce
        vx += (random() - 0.5) * 2;
      }
      
      // Side boundaries with bounce
      const leftBound = -home.x + 12;
      const rightBound = rect.width - home.x - size - 12;
      if (x < leftBound && vx < 0) {
        x = leftBound;
        vx *= -0.7;
      } else if (x > rightBound && vx > 0) {
        x = rightBound;
        vx *= -0.7;
      }
      
      // Apply transform
      image.style.transform = `translate(${x}px, ${y}px) rotate(${rotation}deg)`;
      
      // Continue animation or settle
      if (bounceCount < maxBounces || Math.abs(vx) > MIN_VELOCITY || Math.abs(vy) > MIN_VELOCITY || y < groundY) {
        const frame = requestAnimationFrame(animate);
        physics.set(i, { frame, x, y, vx, vy, rotation });
      } else {
        // Return to home with smooth animation
        returnToHome(i);
      }
    };
    
    const frame = requestAnimationFrame(animate);
    physics.set(i, { frame, x, y, vx, vy, rotation });
  }
  
  function returnToHome(i) {
    const image = stickers[i].querySelector('img');
    if (!image) return;
    
    // Get current transform state
    const currentTransform = getComputedStyle(image).transform;
    
    // Cancel any existing physics animation
    if (physics.has(i)) {
      const p = physics.get(i);
      if (p.frame) cancelAnimationFrame(p.frame);
      physics.delete(i);
    }
    
    // Animate back to home position
    const animation = image.animate([
      { transform: currentTransform === 'none' ? 'translate(0, 0) rotate(0deg)' : currentTransform },
      { transform: 'translate(0, 0) rotate(0deg)' }
    ], { 
      duration: 800, 
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      fill: 'forwards'
    });
    
    animations.set(i, animation);
    animation.onfinish = () => { 
      settle(i); 
      drift(i); 
    };
  }
  
  function move(i) {
    if (motion.matches || dragStates.get(i)?.dragging) return;
    
    // Cancel any existing animations first
    animations.get(i)?.cancel();
    animations.delete(i);
    drifts.get(i)?.cancel();
    drifts.delete(i);
    
    if (physics.has(i)) {
      const p = physics.get(i);
      if (p.frame) cancelAnimationFrame(p.frame);
      physics.delete(i);
    }
    
    // Random trajectory parameters
    const direction = random() < .5 ? -1 : 1;
    const vx = direction * (8 + random() * 15);
    const vy = -(12 + random() * 18); // Initial upward velocity
    const initialRotation = (random() - 0.5) * 360;
    
    animateWithPhysics(i, vx, vy, initialRotation);
  }
  
  // Drag and drop functionality
  stickers.forEach((sticker, i) => {
    const image = sticker.querySelector('img');
    if (!image) return;
    
    let dragState = { dragging: false, startX: 0, startY: 0, lastX: 0, lastY: 0, velocityX: 0, velocityY: 0 };
    dragStates.set(i, dragState);
    
    const onPointerDown = (e) => {
      if (motion.matches) return;
      e.preventDefault();
      
      drifts.get(i)?.cancel();
      animations.get(i)?.cancel();
      if (physics.has(i)) {
        const p = physics.get(i);
        cancelAnimationFrame(p.frame);
        physics.delete(i);
      }
      
      dragState.dragging = true;
      dragState.startX = e.clientX;
      dragState.startY = e.clientY;
      dragState.lastX = e.clientX;
      dragState.lastY = e.clientY;
      dragState.lastTime = Date.now();
      sticker.dataset.motion = 'dragging';
      sticker.style.cursor = 'grabbing';
      image.style.transition = 'none';
      
      sticker.setPointerCapture(e.pointerId);
    };
    
    const onPointerMove = (e) => {
      if (!dragState.dragging) return;
      
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      
      const now = Date.now();
      const dt = now - dragState.lastTime;
      if (dt > 0) {
        dragState.velocityX = (e.clientX - dragState.lastX) / dt * 16;
        dragState.velocityY = (e.clientY - dragState.lastY) / dt * 16;
      }
      
      dragState.lastX = e.clientX;
      dragState.lastY = e.clientY;
      dragState.lastTime = now;
      
      // Full 360-degree rotation based on drag distance
      const distance = Math.sqrt(dx * dx + dy * dy);
      const rotation = (distance * 0.5) % 360;
      
      image.style.transform = `translate(${dx}px, ${dy}px) rotate(${rotation}deg)`;
    };
    
    const onPointerUp = (e) => {
      if (!dragState.dragging) return;
      
      dragState.dragging = false;
      sticker.dataset.motion = 'floating';
      sticker.style.cursor = '';
      
      // Launch with velocity
      animateWithPhysics(i, dragState.velocityX, dragState.velocityY, parseFloat(image.style.transform.match(/rotate\(([^)]+)\)/)?.[1] || 0));
    };
    
    sticker.addEventListener('pointerdown', onPointerDown);
    sticker.addEventListener('pointermove', onPointerMove);
    sticker.addEventListener('pointerup', onPointerUp);
    sticker.addEventListener('pointercancel', onPointerUp);
    
    // Hover animation
    sticker.addEventListener('pointerenter', event => { 
      if (event.pointerType !== 'touch' && !dragState.dragging) move(i); 
    });
    sticker.addEventListener('click', (e) => {
      if (!dragState.dragging) move(i);
    });
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
