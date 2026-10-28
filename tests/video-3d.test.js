'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rectangle, aspectFor, create } = require('../public/video-3d');

test('stereo framing uses the same full-wall coordinates for every laptop', () => {
  const fit = rectangle(3840,1080,16/9,'fit');
  assert.deepEqual(fit,{x:960,y:0,width:1920,height:1080});
  assert.deepEqual(rectangle(3840,1080,16/9,'crop'),{x:0,y:-540,width:3840,height:2160});
  assert.deepEqual(rectangle(3840,1080,16/9,'stretch'),{x:0,y:0,width:3840,height:1080});
  const at = (screen, local) => ((screen-1)*1920+local-fit.x)/fit.width;
  assert.equal(at(1,1920),at(2,0),'adjacent screens meet at exactly the same source position');
  assert.equal(aspectFor(1920,1080,'sbs'),16/9,'half-width SBS restores the original aspect');
  assert.equal(aspectFor(3840,1080,'sbs-full'),16/9);
});

test('unavailable WebGL preserves native video and reports a Normal fallback without stopping playback', () => {
  const previous = {document:global.document,window:global.window};
  global.document={hidden:false,addEventListener(){},removeEventListener(){}};
  global.window={devicePixelRatio:1};
  try {
    const errors=[], listeners={};
    const video={readyState:2,videoWidth:1920,videoHeight:1080,paused:true,style:{},addEventListener(e,fn){listeners[e]=fn;},removeEventListener(){}};
    const canvas={hidden:false,getContext(){return null;},addEventListener(){},removeEventListener(){}};
    const render=create(video,canvas,{onError:text=>errors.push(text)});
    render.set({active:true,source:'2d',fit:'fit'});
    assert.equal(canvas.hidden,true); assert.equal(video.style.visibility,''); assert.equal(errors.length,1);
    render.set({active:true,source:'2d',fit:'fit'}); assert.equal(errors.length,1,'do not retry an unsupported renderer on every state update');
    render.set({active:false}); render.dispose();
    assert.equal(video.style.visibility,'');
  } finally { global.document=previous.document; global.window=previous.window; }
});
