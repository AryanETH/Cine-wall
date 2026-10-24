'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function scene(reduced = false) {
  const frames = new Map(), style = {}, events = {}, documentEvents = {};
  let id = 0, time = 0, writes = 0;
  const signal = { level: 0.6, position: 0 };
  const element = { hidden:true, style:{setProperty(key,value){style[key]=Number.parseFloat(value);if(key==='--sound-level')writes++;}} };
  const window = { document:{hidden:false,addEventListener(name,fn){documentEvents[name]=fn;}},
    matchMedia:()=>({matches:reduced}), addEventListener(name,fn){events[name]=fn;},
    requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame(key){frames.delete(key);},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/audio-gradient.js'),'utf8'),{window});
  const gradient = window.CineWallAudioGradient.create(element,{levels:()=>signal});
  return { gradient, signal, style, frames, events, documentEvents, window,
    writes:()=>writes, run(milliseconds, fps=60){for(let n=0;n<Math.ceil(milliseconds/(1000/fps));n++){time+=1000/fps;const pending=[...frames.values()];frames.clear();for(const draw of pending)draw(time);}},
  };
}

test('3D glow draws at display cadence and eases stereo jumps rather than snapping between laptops',()=>{
  const s=scene();s.gradient.set(true,2,1);s.run(1000);
  assert.ok(s.writes()>=55,'normal motion should use every display frame');
  assert.ok(s.style['--sound-level']>.59);
  s.signal.position=1;s.run(16);
  assert.ok(s.style['--sound-x']<40,'a stereo jump should begin a smooth move');
  s.run(1000);assert.ok(s.style['--sound-x']>195);
  s.gradient.set(false,2,1);s.run(1800);
  assert.equal(s.style['--sound-level'],0);assert.equal(s.frames.size,0);
});

test('envelopes behave consistently across display rates and stay dark during silence',()=>{
  const a=scene(),b=scene();a.gradient.set(true,3,2);b.gradient.set(true,3,2);
  a.run(500,60);b.run(500,30);
  assert.ok(Math.abs(a.style['--sound-level']-b.style['--sound-level'])<.02);
  a.signal.level=0;a.run(2400);assert.equal(a.style['--sound-level'],0);
});

test('reduced-motion mode avoids horizontal travel and still updates signal strength',()=>{
  const s=scene(true);s.gradient.set(true,2,1);s.run(1000);
  assert.ok(s.style['--sound-level']>.5);
  assert.equal(s.style['--sound-x'],100);
  assert.ok(s.writes()<12);
  s.events.pagehide();assert.equal(s.frames.size,0);
});
