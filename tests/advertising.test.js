
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { fetch: authorizedFetch, spawn, execFileSync } = require('./account-fixture.cjs');
const { formLink } = require('../advertising');

test('advertising accepts Google Forms respondent URLs only', () => {
  assert.equal(formLink('https://forms.gle/example'), 'https://forms.gle/example');
  assert.equal(formLink('https://docs.google.com/forms/d/e/example/viewform'), 'https://docs.google.com/forms/d/e/example/viewform');
  for (const url of ['https://forms.gle.evil.test/example','https://docs.google.com/forms/d/example/edit','https://user:pass@forms.gle/example']) assert.throws(() => formLink(url), { status: 400 });
});

test('ad player renders distinct slices and uses the shared five-second skip clock', () => {
  let now = 0;
  const ad = { id: 'sponsor', title: 'Sponsor', startedAt: 1400, position: 0, duration: 12, skipAfter: 5, number: 1, total: 1 };
  const code = fs.readFileSync(path.join(__dirname,'../public/wall-ads.js'), 'utf8');
  for (const screen of [1,2]) {
    const elements = new Map(), requests = [];
    let tick;
    const get = selector => {
      if (!elements.has(selector)) elements.set(selector, { hidden: true, paused: true, currentTime: 0, duration: 12, readyState: 3,
        events: {}, style: new Map(), classList: { toggle() {} }, addEventListener(name, fn) { this.events[name] = fn; },
        pause() { this.paused = true; }, play: async () => {}, load() {}, removeAttribute(attr) { delete this[attr]; } });
      const node = elements.get(selector); node.style.setProperty = (key, value) => node.style.set(key, value); return node;
    };
    const window = {};
    vm.runInNewContext(code,{window,document:{querySelector:get},setInterval(fn){tick=fn;return 1;},clearInterval(){}});
    const controller = window.CineWallAds.create({now:()=>now,link:value=>value,request:async value=>requests.push(value),togglePlayback(){}});
    const display = {screen,total:2,ready:true,fit:'stretch',volume:1,muted:false};
    now=0; controller.update(ad,display);
    assert.equal(get('#wallAdStage').style.get('--screen-index'),screen-1);
    assert.equal(get('#wallAdStage').style.get('--wall-screens'),2);
    assert.equal(get('#wallAdVideo').muted, screen!==1);
    assert.equal(get('#wallAdSkip').hidden,true);
    now=6400; tick();
    assert.equal(get('#wallAdVideo').currentTime,5);
    assert.equal(get('#wallAdSkip').hidden,false);
    void get('#wallAdSkip').events.click();
    assert.deepEqual(requests,['/api/ad-break/skip?ad=sponsor']);
    controller.update({...ad,id:'bumper',skipAfter:null},display);
    assert.equal(get('#wallAdSkip').hidden,true);
    controller.update(null,display);
    assert.equal(get('#wallAd').hidden,true);
    assert.equal(get('#wallAdVideo').src,undefined);
  }
});

test('ads unlock, validate MP4 and coordinate three slots across a two-screen room', {timeout:30000}, async t => {
  try { execFileSync('ffmpeg',['-version'],{stdio:'ignore',windowsHide:true}); }
  catch { t.skip('FFmpeg is required for a real MP4 upload'); return; }
  const root = path.resolve(__dirname,'..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'cinewall-ads-test-'));
  const listener = net.createServer();
  await new Promise((resolve,reject)=>{listener.once('error',reject); listener.listen(0,'127.0.0.1',resolve);});
  const port = listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  const password = randomUUID();
  const server=spawn(process.execPath,['server.js'],{cwd:root,windowsHide:true,env:{...process.env,PORT:String(port),
    CINEWALL_HOSTED:'1',CINEWALL_CACHE_DIR:temporary,CINEWALL_ADS_STORE_DIR:temporary,CINEWALL_ADS_PASSWORD:password,
    CINEWALL_ADS_FORM_URL:''}});
  let output='';
  server.stdout.on('data',chunk=>output+=chunk); server.stderr.on('data',chunk=>output+=chunk);
  t.after(async()=>{
    server.kill();
    if (server.exitCode===null && server.signalCode===null) await new Promise(resolve=>server.once('close',resolve));
    if(path.dirname(temporary)===os.tmpdir()&&path.basename(temporary).startsWith('cinewall-ads-test-')) fs.rmSync(temporary,{recursive:true,force:true});
  });
  for(let i=0;i<120&&!output.includes('Start:');i++) await delay(25);
  assert.match(output,/Start:/);
  const base='http://127.0.0.1:'+port;
  const plain=(route,opts)=>fetch(base+route,opts);
  const post=(route,body,headers={},send=plain)=>send(route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const defaultRedirect=await plain('/advertise',{redirect:'manual'});
  assert.equal(defaultRedirect.status,302);
  assert.equal(defaultRedirect.headers.get('location'),'https://forms.gle/x32An3oiyoXfxjiT7');
  assert.match(await (await plain('/advt')).text(),/Unlock the ads dashboard/);
  assert.equal((await plain('/advt/api/settings')).status,401);
  assert.equal((await plain('/advt/dashboard.html')).status,401);
  assert.equal((await plain('/dashboard.html')).status,404);
  assert.equal((await post('/advt/api/login',{password},{Origin:'https://evil.test'})).status,403);
  assert.equal((await post('/advt/api/login',{password:'wrong'})).status,401);
  const login=await post('/advt/api/login',{password});
  assert.equal(login.status,200);
  assert.match(login.headers.get('set-cookie'),/Path=\/advt; HttpOnly; SameSite=Strict/);
  const staff={Cookie:login.headers.get('set-cookie').split(';')[0]};
  assert.match(await (await plain('/advt',{headers:staff})).text(),/Video library/);

  const upload=(title,bytes)=>plain('/advt/api/creative?title='+title,{method:'POST',headers:{...staff,Origin:base,'Content-Type':'video/mp4'},body:bytes});
  assert.equal((await upload('broken',Buffer.from('not a video'))).status,400);
  function sample(name,seconds){
    const file=path.join(temporary,name+'.mp4');
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=navy:s=96x54:r=12','-t',seconds,
      '-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-an',file],{windowsHide:true});
    return fs.readFileSync(file);
  }
  const bumperBytes=sample('bumper','0.75'), longBytes=sample('long','8');
  assert.equal((await upload('bumper',bumperBytes)).status,201);
  const uploaded=await upload('main',longBytes);
  assert.equal(uploaded.status,201);
  const [short,long]=(await uploaded.json()).creatives;
  const bumper={creativeId:short.id,format:'bumper'}, skippable={creativeId:long.id,format:'skippable'};
  const form='https://forms.gle/AdRequests';
  const save=slots=>post('/advt/api/settings',{enabled:true,formUrl:form,slots},staff);
  assert.equal((await save([bumper,bumper,bumper,bumper])).status,400);
  assert.equal((await save([{creativeId:long.id,format:'bumper'}])).status,400);
  assert.equal((await save([{creativeId:short.id,format:'skippable'}])).status,400);
  assert.equal((await save([bumper,skippable,bumper])).status,200);
  const redirect=await plain('/advertise',{redirect:'manual'});
  assert.equal(redirect.status,302);
  assert.equal(redirect.headers.get('location'),form);

  const device=()=>({'X-CineWall-Device':randomUUID(),'X-CineWall-Key':randomUUID()});
  const admin=device(),guest=device(),outsider=device();
  const signed=(route,opts)=>authorizedFetch(base+route,opts);
  const send=(route,body,who=admin)=>post(route,body,who,signed);
  const {room,code}=await (await send('/api/rooms/create',{mode:'video'})).json();
  assert.equal((await (await send('/api/rooms/join',{code},guest)).json()).screen,2);
  const roomPath=(route,extra='')=>route+'?room='+room+extra;
  const state=async()=> (await (await signed(roomPath('/api/status'),{headers:guest})).json()).state;
  const movie=await (await send(roomPath('/api/local-source'),{peerId:randomUUID(),name:'movie.mp4',size:1000000,type:'video/mp4',
    duration:120,fingerprint:'a'.repeat(64),relay:true})).json();
  const version=movie.state.asset.version;
  const clientIds=[randomUUID(),randomUUID()];
  async function ready(){
    await Promise.all([admin,guest].map(async(who,index)=>{
      const res=await send(roomPath('/api/status'),{clientId:clientIds[index],screen:index+1,ready:true,mediaReady:true,duration:120,assetVersion:version},who);
      assert.equal(res.status,200);
    }));
  }
  const command=(type,extra={})=>send(roomPath('/api/command'),{type,assetVersion:version,...extra});
  const until=async check=>{
    for(let i=0;i<160;i++){
      const next=await state();
      if(check(next)) return next;
      if(i%15===0) await ready();
      await delay(55);
    }
    assert.fail('Room did not reach the expected ad state');
  };
  await ready();
  const {command:start}=await (await command('play',{position:18})).json();
  const first=start.adBreak;
  assert.deepEqual([first.number,first.total,start.playing,start.position],[1,3,false,18]);
  assert.equal((await state()).adBreak.id,first.id);
  const adPath=(route,id)=>roomPath('/api/ad-break/'+route,'&ad='+id);
  assert.equal((await signed(adPath('media',first.id),{headers:outsider})).status,403);
  const range=await signed(adPath('media',first.id),{headers:{...guest,Range:'bytes=0-23'}});
  assert.equal(range.status,206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()),bumperBytes.subarray(0,24));
  assert.equal((await send(adPath('skip',first.id),{},guest)).status,409);
  assert.equal((await send(adPath('unavailable',first.id),{},guest)).status,403);
  assert.equal((await command('seek',{position:80})).status,409);
  assert.equal((await command('pause')).status,200);
  assert.equal((await state()).adBreak.startedAt,null);
  assert.equal((await command('play')).status,200);
  const second=(await until(s=>s.adBreak?.number===2)).adBreak;
  assert.equal((await send(adPath('skip',second.id),{},guest)).status,409);
  await until(s=>s.adBreak?.id===second.id&&s.serverTime>=s.adBreak.startedAt+5000);
  const skip=await send(adPath('skip',second.id),{},guest);
  assert.equal(skip.status,200);
  const third=(await skip.json()).state.adBreak;
  assert.deepEqual([third.number,third.title],[3,first.title]);
  assert.notEqual(third.id,first.id);
  assert.equal((await send(adPath('skip',second.id),{},guest)).status,404);
  const resumed=await until(s=>!s.adBreak&&s.playing);
  assert.deepEqual([resumed.position,resumed.asset.version],[18,version]);
  await command('pause');
  assert.equal((await (await command('play')).json()).command.adBreak,undefined);
  assert.equal((await post('/advt/api/logout',{},staff)).status,200);
  assert.equal((await plain('/advt/api/settings',{headers:staff})).status,401);
  for(let i=0;i<4;i++) assert.equal((await post('/advt/api/login',{password:'wrong'})).status,401);
  assert.equal((await post('/advt/api/login',{password})).status,429);
});

