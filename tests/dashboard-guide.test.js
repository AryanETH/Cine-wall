'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function guide(mode, viewing = false) {
  const nodes = new Map();
  const body = { dataset: { sessionMode: mode }, classList: { add() {}, remove() {} } };
  const document = { body, activeElement: null, querySelector: selector => nodes.get(selector), addEventListener() {} };
  for (const id of ['openDashboardGuide','guideBackdrop','dashboardGuide','guideTitle','guideCopy','guideProgress','guideBack','guideNext','guideSkip','screens','viewerSource','fileSourceButton','sharingPanel','audioQueue','player','settings','video3dToggle','try3d']) {
    const node = { textContent: '', hidden: id === 'dashboardGuide' || id === 'guideBackdrop' || (id === 'viewerSource' && !viewing), disabled: false, style: {}, isConnected: true,
      events: {}, classList: { add() {}, remove() {} }, addEventListener(name,fn) { this.events[name] = fn; },
      closest() { return this.hidden ? this : null; }, getClientRects() { return this.hidden ? [] : [{}]; },
      getBoundingClientRect() { return { left: 10, top: 20, bottom: 100 }; }, offsetWidth: 360, offsetHeight: 180,
      scrollIntoView() {}, focus() { document.activeElement = this; } };
    nodes.set('#'+id,node);
  }
  const window = { innerWidth: 1440, innerHeight: 1000, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/dashboard-guide.js'),'utf8'),
    { document, window, localStorage: { setItem() {}, getItem() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout() {} });
  window.CineWallGuide.start();
  const steps=[];
  while(window.CineWallGuide.isOpen()) {
    steps.push({ title: nodes.get('#guideTitle').textContent, copy: nodes.get('#guideCopy').textContent });
    if(steps.length > 10) throw Error('Guide did not finish');
    nodes.get('#guideNext').events.click();
  }
  return steps;
}

test('video guide explains Add screen, 3D view glasses and 3D sound without changing playback settings', () => {
  const steps = guide('video');
  assert.match(steps[0].copy,/Add screen/);
  assert.match(steps.find(s=>s.title==='Try 3D view').copy,/red\/cyan glasses/);
  assert.match(steps.find(s=>s.title==='Try 3D view').copy,/simulated filter/);
  assert.match(steps.find(s=>s.title==='Try 3D sound').copy,/Settings.*two or more laptops/);
});

test('audio guide includes playlist order and its direct 3D sound control; viewers get no admin 3D steps', () => {
  const steps = guide('audio');
  assert.ok(steps.some(s=>s.title==='Set the song order'));
  assert.match(steps.find(s=>s.title==='Try 3D sound').copy,/Try in 3D/);
  assert.ok(!steps.some(s=>s.title==='Try 3D view'));
  assert.ok(!guide('video',true).some(s=>s.title.startsWith('Try 3D')));
});
