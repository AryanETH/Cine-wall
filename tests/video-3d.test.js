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

test('3D shader reuses texture storage and paused frames without repeated layout reads',()=>{
  const previous={document:global.document,window:global.window};
  global.document={hidden:false,addEventListener(){},removeEventListener(){}};global.window={devicePixelRatio:2};
  try{
    let allocations=0,uploads=0,layouts=0;
    const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,texImage2D:()=>allocations++,texSubImage2D:()=>uploads++},{get:(o,k)=>o[k]||(()=>({}))});
    const video={currentTime:0,readyState:4,videoWidth:1920,videoHeight:1080,paused:true,style:{visibility:'hidden'},addEventListener(){},removeEventListener(){}};
    const canvas={hidden:true,width:0,height:0,getContext:()=>gl,parentElement:{getBoundingClientRect(){layouts++;return {width:1920,height:1080};}},addEventListener(){},removeEventListener(){}};
    const render=create(video,canvas),config={active:true,source:'2d',depth:50,screens:1};
    render.set(config);render.set({...config,depth:70});
    assert.equal(video.style.visibility,'','source stays in the compositor pipeline so frame callbacks are not throttled');
    assert.equal(allocations,1);assert.equal(uploads,1,'slider redraw reuses the existing decoded frame');assert.equal(layouts,1);assert.equal(canvas.width,1920,'DPR does not upscale the video buffer');
    video.currentTime=1;render.set({...config,depth:80});assert.equal(allocations,1);assert.equal(uploads,2);
    global.document.hidden=true;video.currentTime=2;render.set({...config,depth:90});assert.equal(uploads,2,'hidden guests do no GPU work');
    render.dispose();
  }finally{global.document=previous.document;global.window=previous.window;}
});

test('frame polling redraws only when the native decoded-frame counter advances',()=>{
  const previous={document:global.document,window:global.window,requestAnimationFrame:global.requestAnimationFrame,cancelAnimationFrame:global.cancelAnimationFrame};
  let next,draws=0;global.requestAnimationFrame=callback=>{next=callback;return 1;};global.cancelAnimationFrame=()=>{};
  global.document={hidden:false,addEventListener(){},removeEventListener(){}};global.window={devicePixelRatio:1};
  try{
    const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,drawArrays:()=>draws++},{get:(o,k)=>o[k]||(()=>({}))});
    const video={webkitDecodedFrameCount:1,currentTime:0,readyState:4,videoWidth:1920,videoHeight:1080,paused:false,style:{},addEventListener(){},removeEventListener(){}};
    const canvas={hidden:true,width:0,height:0,style:{setProperty(){}},getContext:()=>gl,parentElement:{getBoundingClientRect:()=>({width:1280,height:720})},addEventListener(){},removeEventListener(){}};
    const renderer=create(video,canvas);renderer.set({active:true,source:'2d'});assert.equal(draws,1);
    next();assert.equal(draws,1,'no duplicate draw at monitor refresh rate');
    video.webkitDecodedFrameCount=2;next();assert.equal(draws,2);assert.equal(renderer.stats.uploads,2);
    global.document.hidden=true;video.webkitDecodedFrameCount=3;next();assert.equal(draws,2);renderer.dispose();
  }finally{Object.assign(global,previous);}
});
