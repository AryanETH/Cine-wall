'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {stickerPosition,setupCinemaStickers,setupCinemaLights}=require('../public/home-cinema.js');
const {setupDemoTheme}=require('../public/home-demo.js');

test('cinema stickers are real transparent PNG assets sized for the landing page',()=>{
 for(const name of ['popcorn','glasses','clapper','reel','headphones','camera','drink','tickets']){
  const png=fs.readFileSync(path.join(__dirname,`../public/assets/cinema-stickers/${name}.png`));
  assert.equal(png.subarray(1,4).toString(),'PNG');
  assert.equal(png.readUInt32BE(16),512);assert.equal(png.readUInt32BE(20),512);
  assert.equal(png[25],6,'RGBA preserves the transparent cutout');assert.ok(png.length<600000);
 }
});

test('sticker homes fit the container width and overlap only the lower frame',()=>{
 for(const [w,h,size] of [[1080,607.5,205],[320,180,70],[250,140,65]]){
  for(const anchor of [0,.25,.5,.75,1]) for(const angle of [-12,0,12]) {
   const p=stickerPosition(w,h,size,anchor,angle);
   const radians=angle*Math.PI/180,extra=size*(Math.abs(Math.sin(radians))+Math.abs(Math.cos(radians))-1)/2;
   assert.ok(p.x-extra>=0&&p.x+size+extra<=w);
   assert.ok(p.y-extra>=0&&p.y+size+extra<=h+22.001);
   assert.ok(p.y+size+extra>h,'the lower cutout is clipped by the container');
  }
 }
});

test('hover floats a sticker and returns it home; reduced motion cancels movement',()=>{
 const flights=[];
 const stickers=Array.from({length:8},()=>({dataset:{},offsetWidth:168,style:{setProperty(){}},events:{},addEventListener(n,fn){this.events[n]=fn;},
  querySelector(){return {animate(frames,options){const a={frames,options,cancel(){this.cancelled=true;}};flights.push(a);return a;}};}}));
 const motion={matches:false,addEventListener(){}};
 const decor=setupCinemaStickers({getBoundingClientRect:()=>({width:1080,height:607.5})},stickers,motion,()=>({observe(){}}));
 stickers[0].events.pointerenter({pointerType:'mouse'});
 assert.equal(stickers[0].dataset.motion,'floating');
 const flight=flights.at(-1);assert.deepEqual(flight.frames[0].transform,flight.frames.at(-1).transform);
 assert.match(flight.frames[1].transform,/-\d+.*px/);assert.ok(flight.options.duration>=1800&&flight.options.duration<=2700);
 const count=flights.length;decor.move(0);assert.equal(flights.length,count,'one active flight at a time');
 flight.onfinish();assert.equal(stickers[0].dataset.motion,'home');assert.ok(flight.cancelled);
 stickers[4].events.click();assert.equal(stickers[4].dataset.motion,'floating');
 motion.matches=true;decor.layout();
 assert.ok(stickers.every(s=>s.disabled&&s.dataset.motion==='home'));
 assert.ok(flights.every(a=>a.cancelled));const stopped=flights.length;decor.move(0);assert.equal(flights.length,stopped);
});

test('each light fades independently with fresh random timing and respects reduced motion',()=>{
 const animations=[];let seed=0;
 const bulbs=Array.from({length:4},()=>({animate(frames,options){const a={frames,options,cancel(){this.cancelled=true;}};animations.push(a);return a;}}));
 const motion={matches:false,addEventListener(){}};
 const lights=setupCinemaLights(bulbs,motion,()=>((seed++*13)%97)/97);
 assert.equal(animations.length,4);assert.equal(new Set(animations.map(a=>a.options.duration)).size,4);
 for(const a of animations){assert.ok(a.options.duration>=6500);assert.equal(a.frames[0].opacity,a.frames.at(-1).opacity);assert.ok(a.frames[1].opacity<a.frames[2].opacity);}
 animations[0].onfinish();assert.equal(animations.length,5);assert.notEqual(animations[4].options.duration,animations[0].options.duration);
 motion.matches=true;lights.update();assert.ok(animations.every(a=>a.cancelled));assert.equal(animations.length,5);
});

test('theme switching uses a matching video and preserves movie position without repeated loads',()=>{
 const events={},attrs={poster:'light.jpg'},sourceAttrs={src:'light.mp4'};
 const source={getAttribute:n=>sourceAttrs[n],setAttribute:(n,v)=>sourceAttrs[n]=v};
 const video={dataset:{darkSrc:'dark.mp4',darkPoster:'dark.jpg'},currentTime:18,duration:44.75,paused:false,loads:0,plays:0,
 querySelector:()=>source,getAttribute:n=>attrs[n],setAttribute:(n,v)=>attrs[n]=v,
 classList:{add(){},remove(){}},addEventListener(n,fn){events[n]=fn;},load(){this.loads++;this.currentTime=0;},play(){this.plays++;return Promise.resolve();}};
 const root={dataset:{theme:'dark'}},motion={matches:false};
 const theme=setupDemoTheme(video,root,motion,()=>({observe(){},disconnect(){}}));
 assert.equal(sourceAttrs.src,'dark.mp4');assert.equal(attrs.poster,'dark.jpg');assert.equal(video.loads,1);
 events.loadedmetadata();events.loadeddata();assert.equal(video.currentTime,18);assert.equal(video.dataset.themeReady,'true');
 theme.update();assert.equal(video.loads,1);
 video.currentTime=26;root.dataset.theme='light';theme.update();events.loadedmetadata();events.loadeddata();
 assert.equal(sourceAttrs.src,'light.mp4');assert.equal(video.currentTime,26);assert.equal(attrs.poster,'light.jpg');
});
