'use strict';
(() => {
  const steps = [
    { id: 'play', label: 'Open_Palm', icon: '✋', title: 'Play', pose: 'Open hand', instruction: 'Open your fingers. Either hand, palm or back, together or spread.' },
    { id: 'pause', label: 'Closed_Fist', icon: '✊', title: 'Pause', pose: 'Closed fist', instruction: 'Close your fingers into a fist. A comfortable tilt is fine.' },
    { id: 'volume-up', label: 'Thumb_Up', icon: '👍', title: 'Volume up', pose: 'Thumbs up', instruction: 'Point your thumb up. Volume changes by 10%.' },
    { id: 'volume-down', label: 'Thumb_Down', icon: '👎', title: 'Volume down', pose: 'Thumbs down', instruction: 'Point your thumb down. Volume changes by 10%.' },
    { id: 'forward', label: 'Victory', icon: '✌️', title: 'Forward 10 seconds', pose: 'Two fingers', instruction: 'Raise index and middle fingers. Together or in a V; either side of your hand.' },
    { id: 'back', label: 'ILoveYou', icon: '🤟', title: 'Back 10 seconds', pose: 'Index + little finger', instruction: 'Raise index and little finger. Fold middle and ring. Your thumb can relax.' }
  ];
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  function angle(a, b, c) {
    const u = [a.x - b.x, a.y - b.y, a.z - b.z], v = [c.x - b.x, c.y - b.y, c.z - b.z];
    const length = Math.hypot(...u) * Math.hypot(...v);
    return length < 1e-12 ? 0 : Math.acos(Math.max(-1, Math.min(1, u.reduce((sum, n, i) => sum + n * v[i], 0) / length))) * 180 / Math.PI;
  }
  function validHand(points) {
    return points?.length === 21 && points.every(point => ['x', 'y', 'z'].every(axis => Number.isFinite(point?.[axis])))
      && distance(points[0], points[9]) > 1e-6 && distance(points[5], points[17]) > 1e-6;
  }
  function fingerState(hand, base) {
    const [mcp, pip, dip, tip] = hand.slice(base, base + 4);
    const path = distance(mcp, pip) + distance(pip, dip) + distance(dip, tip);
    if (path < 1e-6) return 'unclear';
    const reach = distance(mcp, tip) / path, bend = angle(mcp, pip, dip);
    const radial = distance(hand[0], tip) / Math.max(1e-6, distance(hand[0], pip));
    if (reach >= .7 && bend >= 125 && angle(pip, dip, tip) >= 115 && radial >= 1.04) return 'open';
    if ((bend < 115 || reach < .55) && radial < 1.15) return 'folded';
    return 'unclear';
  }
  function geometryGesture(image, world, imageAspect = 1) {
    if (!validHand(image)) return { label: '', usable: false };
    // World joints preserve finger bend through camera rotation and foreshortening.
    const hand = validHand(world) ? world : image.map(p => ({ x: p.x, y: p.y * imageAspect, z: p.z }));
    const fingers = [5, 9, 13, 17].map(base => fingerState(hand, base));
    const is = pattern => pattern.every((state, i) => state === fingers[i]);
    const thumbOut = angle(hand[2], hand[3], hand[4]) >= 135
      && distance(hand[0], hand[4]) / distance(hand[0], hand[9]) > 1.2
      && distance(hand[4], hand[5]) / distance(hand[5], hand[17]) > .5;
    if (is(['folded', 'folded', 'folded', 'folded'])) {
      if (!thumbOut) return { label: 'Closed_Fist', usable: true };
      const dy = image[4].y - image[2].y;
      const length = Math.hypot(image[4].x - image[2].x, dy);
      if (length > 1e-6 && Math.abs(dy) / length >= .32) return { label: dy < 0 ? 'Thumb_Up' : 'Thumb_Down', usable: true };
      return { label: '', usable: true, sidewaysThumb: true };
    }
    if (is(['open', 'open', 'folded', 'folded'])) return { label: 'Victory', usable: true };
    if (is(['open', 'folded', 'folded', 'open'])) return { label: 'ILoveYou', usable: true };
    if (fingers.filter(state => state === 'open').length >= 3 && !fingers.includes('folded')) return { label: 'Open_Palm', usable: true };
    return { label: '', usable: true };
  }
  function singleLabel(result, index) {
    const pose = geometryGesture(result.landmarks[index], result.worldLandmarks?.[index], result.imageAspect || 1);
    if (pose.label) return pose.label;
    const best = result.gestures?.[index]?.[0];
    if (pose.sidewaysThumb && !['Thumb_Up', 'Thumb_Down'].includes(best?.categoryName)) return '';
    return best?.score >= .7 && steps.some(step => step.label === best.categoryName) ? best.categoryName : '';
  }
  function labelFromResult(result) {
    const hands = result?.landmarks;
    if (hands?.length === 1) return singleLabel(result, 0);
    if (hands?.length !== 2 || !hands.every(validHand)) return '';
    const candidates = hands.map((points, index) => ({ label: singleLabel(result, index),
      size: distance(points[0], points[9]) ** 2 + distance(points[5], points[17]) ** 2 })).sort((a, b) => b.size - a.size);
    if (candidates[0].label && candidates[0].label === candidates[1].label) return candidates[0].label;
    // A resting hand can remain in view, but similarly prominent conflicting poses are ignored.
    return candidates[0].size >= candidates[1].size * 2 ? candidates[0].label : '';
  }
  function unrotateResult(result, turns) {
    turns = (turns % 4 + 4) % 4;
    if (!turns) return result;
    const landmarks = result.landmarks.map(hand => hand.map(point => {
      let { x, y } = point;
      for (let i = 0; i < turns; i++) [x, y] = [y, 1 - x];
      return { ...point, x, y, z: point.z * (turns % 2 ? result.imageAspect : 1) };
    }));
    const worldLandmarks = result.worldLandmarks?.map(hand => hand.map(point => {
      let { x, y } = point;
      for (let i = 0; i < turns; i++) [x, y] = [y, -x];
      return { ...point, x, y };
    }));
    const gestures = result.gestures.map((categories, index) => categories.map(category => {
      if (!['Thumb_Up', 'Thumb_Down'].includes(category.categoryName)) return category;
      const hand = landmarks[index], dy = hand[4].y - hand[2].y, length = Math.hypot(hand[4].x - hand[2].x, dy);
      if (length < 1e-6 || Math.abs(dy) / length < .32) return { ...category, categoryName: 'None', score: 0 };
      return { ...category, categoryName: dy < 0 ? 'Thumb_Up' : 'Thumb_Down' };
    }));
    return { ...result, landmarks, worldLandmarks, gestures };
  }
  // A gesture must stay stable; each action needs a neutral interval before re-arming.
  class HoldGate {
    constructor() { this.reset(); }
    reset() { this.label = ''; this.since = 0; this.last = -Infinity; this.armed = true; this.neutral = null; this.samples = 0; }
    push(label, now) {
      if (now - this.last > 350) { this.label = ''; this.since = now; this.neutral = null; this.samples = 0; }
      this.last = now;
      if (!label) {
        if (this.neutral === null) this.neutral = now;
        if (now - this.neutral > 180) { this.label = ''; this.since = now; this.samples = 0; }
        if (now - this.neutral >= 400) this.armed = true;
        return { progress: 0, release: !this.armed };
      }
      if (this.neutral !== null && now - this.neutral > 180) { this.label = ''; this.samples = 0; }
      this.neutral = null;
      if (!this.armed) return { progress: 0, release: true };
      if (this.label !== label) { this.label = label; this.since = now; this.samples = 0; }
      this.samples++;
      const progress = Math.min(1, (now - this.since) / 650);
      if (progress < 1 || this.samples < 4) return { progress, release: false };
      this.armed = false;
      return { progress: 1, action: steps.find(step => step.label === label)?.id, release: true };
    }
  }
  class Practice {
    constructor() { this.index = 0; }
    get step() { return steps[this.index]; }
    match(action) {
      if (this.step?.id !== action) return false;
      this.index++;
      return true;
    }
    get done() { return this.index === steps.length; }
  }
  const api = { steps, labelFromResult, geometryGesture, unrotateResult, HoldGate, Practice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof self !== 'undefined') self.CineWallHandGestures = api;
  else if (typeof window !== 'undefined') window.CineWallHandGestures = api;
})();
