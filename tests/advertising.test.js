
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
const createAdAnalytics = require('../ad-analytics');

test('advertising accepts HTTP links without credentials', () => {
  assert.equal(formLink('https://forms.gle/example'), 'https://forms.gle/example');
  assert.equal(formLink('https://docs.google.com/forms/d/e/example/viewform'), 'https://docs.google.com/forms/d/e/example/viewform');
  assert.equal(formLink('https://example.com/contact'), 'https://example.com/contact');
  for (const url of ['javascript:alert(1)', 'https://user:pass@forms.gle/example']) assert.throws(() => formLink(url), { status: 400 });
});

test('both movie timelines display scheduled breaks and clear them when the campaign is paused', () => {
  for (const [page, id] of [['admin.html', 'timelineMarkers'], ['screen.html', 'screenTimelineMarkers']]) {
    const html = fs.readFileSync(path.join(__dirname, '../public', page), 'utf8');
    assert.match(html, new RegExp('id="' + id + '"'));
    assert.match(html, /src="ad-timeline\.js\?v=1"/);
  }
  const window = {};
  const document = { createElement: () => ({
    style: {},
    classList: { toggle(_class, shown) { this.shown = shown; } },
  }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/ad-timeline.js'), 'utf8'), { window, document });
  const attrs = new Map();
  const input = { setAttribute: (...args) => attrs.set(...args), removeAttribute: name => attrs.delete(name) };
  const overlay = { replaceChildren(...markers) { this.markers = markers; } };
  const render = window.CineWallAdTimeline(input, overlay, position => position + 's');
  const state = { sessionMode: 'video', adScheduleEnabled: true, adBreaks: [
    { position: 25, shown: true }, { position: 50, shown: false }, { position: 75, shown: false },
  ] };
  render(state, 100);
  assert.deepEqual(overlay.markers.map(marker => marker.style.left), ['25%', '50%', '75%']);
  assert.equal(overlay.markers[0].classList.shown, true);
  assert.equal(attrs.get('aria-description'), 'Upcoming ads at 50s, 75s');
  render({ ...state, adScheduleEnabled: false }, 100);
  assert.equal(overlay.markers.length, 0);
  assert.equal(attrs.has('aria-description'), false);
});

test('ad player renders distinct slices and uses the shared five-second skip clock', () => {
  let now = 0;
  const ad = { id: 'sponsor', title: 'Sponsor', startedAt: 1400, position: 0, duration: 12, skipAfter: 5,
    number: 1, total: 1, logo: '/api/ad-break/logo?ad=sponsor' };
  const code = fs.readFileSync(path.join(__dirname,'../public/wall-ads.js'), 'utf8');
  for (const screen of [1,2]) {
    const elements = new Map(), requests = [], reports = [];
    let tick;
    const get = selector => {
      if (!elements.has(selector)) elements.set(selector, { hidden: true, paused: true, currentTime: 0, duration: 12, readyState: 3,
        events: {}, style: new Map(), classList: { toggle() {} }, addEventListener(name, fn) { this.events[name] = fn; },
        pause() { this.paused = true; }, play: async () => {}, load() {}, removeAttribute(attr) { delete this[attr]; } });
      const node = elements.get(selector); node.style.setProperty = (key, value) => node.style.set(key, value); return node;
    };
    const window = {};
    const document = { querySelector:get, visibilityState:'hidden' };
    vm.runInNewContext(code,{window,document,setInterval(fn){tick=fn;return 1;},clearInterval(){}});
    const controller = window.CineWallAds.create({now:()=>now,link:value=>value,request:async value=>requests.push(value),
      report:async value=>reports.push(value),togglePlayback(){}});
    const display = {screen,total:2,ready:true,fit:'stretch',volume:1,muted:false};
    now=0; controller.update({...ad,clickUrl:'https://example.com/sponsor'},display);
    assert.equal(get('#wallAdStage').style.get('--screen-index'),screen-1);
    assert.equal(get('#wallAdStage').style.get('--wall-screens'),2);
    assert.equal(get('#wallAdVideo').muted, screen!==1);
    assert.equal(get('#wallAdSkip').hidden,true);
    assert.equal(get('#wallAdLogo').src, ad.logo);
    assert.equal(get('#wallAdProgressFill').style.transform, 'scaleX(0)');
    const video = get('#wallAdVideo');
    video.currentTime = 1;
    video.played = {length:1,end:()=>video.currentTime};
    now=2400;
    video.events.timeupdate();
    assert.deepEqual(reports,[]);
    document.visibilityState='visible';
    video.events.timeupdate();
    video.events.timeupdate();
    const visit = get('#wallAdVisit');
    assert.equal(visit.hidden,false);
    assert.equal(visit.href,'https://example.com/sponsor');
    visit.events.click();
    visit.events.click();
    assert.deepEqual(reports,['/api/ad-break/event?ad=sponsor&event=impression','/api/ad-break/event?ad=sponsor&event=click']);
    now=6400; tick();
    assert.equal(get('#wallAdVideo').currentTime,5);
    assert.equal(get('#wallAdSkip').hidden,false);
    assert.equal(get('#wallAdProgressFill').style.transform, 'scaleX(' + 5/12 + ')');
    void get('#wallAdSkip').events.click();
    assert.deepEqual(requests,['/api/ad-break/skip?ad=sponsor']);
    controller.update({...ad,id:'bumper',skipAfter:null,logo:null},display);
    assert.equal(get('#wallAdSkip').hidden,true);
    assert.equal(get('#wallAdLogo').hidden,true);
    assert.equal(visit.hidden,true);
    controller.update(null,display);
    assert.equal(get('#wallAd').hidden,true);
    assert.equal(get('#wallAdVideo').src,undefined);
  }
});

test('ads unlock, publish clips and links, and count shared breaks across two screens', {timeout:45000}, async t => {
  try { execFileSync('ffmpeg',['-version'],{stdio:'ignore',windowsHide:true}); }
  catch { t.skip('FFmpeg is required for a real MP4 upload'); return; }
  const root = path.resolve(__dirname,'..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'cinewall-ads-test-'));
  const listener = net.createServer();
  await new Promise((resolve,reject)=>{listener.once('error',reject); listener.listen(0,'127.0.0.1',resolve);});
  const port = listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  const password = process.env.CINEWALL_ADS_PASSWORD || randomUUID();
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
  assert.equal((await plain('/advt/api/analytics')).status,401);
  assert.equal((await plain('/advt/dashboard.html')).status,401);
  assert.equal((await plain('/dashboard.html')).status,404);
  assert.equal((await post('/advt/api/login',{password},{Origin:'https://evil.test'})).status,403);
  assert.equal((await post('/advt/api/login',{password:'wrong'})).status,401);
  const login=await post('/advt/api/login',{password});
  assert.equal(login.status,200);
  assert.match(login.headers.get('set-cookie'),/Path=\/advt; HttpOnly; SameSite=Strict/);
  const staff={Cookie:login.headers.get('set-cookie').split(';')[0]};
  assert.match(await (await plain('/advt',{headers:staff})).text(),/Video library/);
  assert.match(await (await plain('/advt',{headers:staff})).text(),/data-duration="60"/);

  const upload=(title,bytes)=>plain('/advt/api/creative?title='+title,{method:'POST',headers:{...staff,Origin:base,'Content-Type':'video/mp4'},body:bytes});
  assert.equal((await upload('broken',Buffer.from('not a video'))).status,400);
  function sample(name,seconds){
    const file=path.join(temporary,name+'.mp4');
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=96x54:r=12','-t',seconds,
      '-c:v','libx264','-g','120','-pix_fmt','yuv420p','-movflags','+faststart','-an',file],{windowsHide:true});
    return fs.readFileSync(file);
  }
  const bumperBytes=sample('bumper','0.75'), longBytes=sample('long','75');
  assert.equal((await upload('bumper',bumperBytes)).status,201);
  const uploaded=await upload('main',longBytes);
  assert.equal(uploaded.status,201);
  const [short,long]=(await uploaded.json()).creatives;
  const bumper={creativeId:short.id,format:'bumper'}, skippable={creativeId:long.id,format:'skippable'};
  const mediaPath = '/advt/api/media/' + long.id;
  const setLink = clickUrl => post('/advt/api/creative/' + long.id + '/link', {clickUrl}, staff);
  assert.equal((await setLink('javascript:alert(1)')).status,400);
  const clickUrl = 'https://example.com/sponsor';
  assert.equal((await setLink(clickUrl)).status,200);
  const trim = (duration,startTime) => post('/advt/api/creative/' + long.id + '/trim',{duration,startTime},staff);
  assert.equal((await trim(60,20)).status,400);
  for (const [duration,start] of [[6,2.5],[15,17],[30,9],[60,4],[7.5,40]]) {
    const result=await trim(duration,start);
    assert.equal(result.status,200, await result.clone().text());
    const clip=(await result.json()).creatives.find(item=>item.id===long.id);
    assert.deepEqual([clip.originalDuration,clip.duration,clip.trimStart,clip.trimEnd],[75,duration,start,start+duration]);
    const preview=await plain(mediaPath,{headers:staff});
    assert.equal(preview.status,200);
    const probeFile=path.join(temporary,'trim-probe.mp4');
    fs.writeFileSync(probeFile,Buffer.from(await preview.arrayBuffer()));
    const measured=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',probeFile],{encoding:'utf8'}));
    assert.ok(Math.abs(measured-duration)<.1,`Expected ${duration}s, got ${measured}s`);
  }
  assert.deepEqual(Buffer.from(await (await plain(mediaPath+'?original=1',{headers:staff})).arrayBuffer()),longBytes);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lNcAAAAASUVORK5CYII=','base64');
  const putLogo = bytes => plain('/advt/api/logo',{method:'POST',headers:{...staff,Origin:base,'Content-Type':'image/png'},body:bytes});
  assert.equal((await putLogo(Buffer.from('not a PNG'))).status,400);
  assert.equal((await putLogo(png)).status,200);
  assert.deepEqual(Buffer.from(await (await plain('/advt/api/logo',{headers:staff})).arrayBuffer()),png);
  assert.equal((await plain('/advt/api/logo')).status,401);
  const form='https://forms.gle/AdRequests';
  const save=slots=>post('/advt/api/publish',{formUrl:form,slots},staff);
  assert.equal((await save([])).status,400);
  assert.equal((await save([bumper,bumper,bumper,bumper])).status,400);
  assert.equal((await save([{creativeId:long.id,format:'bumper'}])).status,400);
  assert.equal((await save([{creativeId:short.id,format:'skippable'}])).status,400);
  const pushed=await save([skippable]);
  assert.equal(pushed.status,200);
  const {published, enabled}=await pushed.json();
  assert.equal(enabled,true);
  assert.ok(published.id && published.at);
  assert.equal(published.slots[0].clickUrl,clickUrl);
  assert.equal(published.slots[0].duration,7.5);
  const pushedMedia=Buffer.from(await (await plain(mediaPath,{headers:staff})).arrayBuffer());
  assert.equal((await trim(5,0)).status,200);
  assert.equal((await setLink('https://example.com/draft')).status,200);
  assert.equal((await save([skippable])).status,400);
  assert.equal((await (await plain('/advt/api/settings',{headers:staff})).json()).published.id,published.id);
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
  const publish=async duration=>(await (await send(roomPath('/api/local-source'),{peerId:randomUUID(),name:'movie.mp4',size:1000000,type:'video/mp4',
    duration,fingerprint:'a'.repeat(64),relay:true})).json()).state;
  for (const [duration,positions] of [[59.99,[]],[60,[30]],[599,[299.5]],[600,[200,400]],[2999,[2999/3,5998/3]],[3000,[750,1500,2250]]]) {
    const readyToPlay=await publish(duration);
    assert.deepEqual(readyToPlay.adBreaks.map(item=>item.position),positions);
  }
  const {asset:{version},adBreaks}=await publish(10800);
  assert.deepEqual(adBreaks.map(item=>item.position),[2700,5400,8100]);
  const clientIds=[randomUUID(),randomUUID()];
  async function ready(){
    await Promise.all([admin,guest].map(async(who,index)=>{
      const res=await send(roomPath('/api/status'),{clientId:clientIds[index],screen:index+1,ready:true,mediaReady:true,duration:10800,assetVersion:version},who);
      assert.equal(res.status,200);
    }));
  }
  const command=(type,extra={})=>send(roomPath('/api/command'),{type,assetVersion:version,...extra});
  const until=async check=>{
    for(let i=0;i<240;i++){
      const next=await state();
      if(check(next)) return next;
      if(i%15===0) await ready();
      await delay(55);
    }
    assert.fail('Room did not reach the expected ad state');
  };
  await ready();
  const {command:start}=await (await command('play',{position:2699.7})).json();
  assert.equal(start.adBreak,undefined);
  const firstState=await until(s=>s.adBreak?.number===1);
  const first=firstState.adBreak;
  assert.deepEqual([first.number,first.total,firstState.playing],[1,3,false]);
  assert.equal(first.clickUrl,clickUrl);
  assert.equal(first.duration,7.5);
  assert.ok(firstState.position>=2700 && firstState.position<2701);
  assert.equal((await state()).adBreak.id,first.id);
  const adPath=(route,id)=>roomPath('/api/ad-break/'+route,'&ad='+id);
  const track=(ad,event,who=guest)=>send(adPath('event',ad.id)+'&event='+event,{},who);
  assert.equal((await track(first,'impression',outsider)).status,403);
  assert.equal((await track(first,'q75')).status,409);
  assert.equal((await signed(adPath('media',first.id),{headers:outsider})).status,403);
  const range=await signed(adPath('media',first.id),{headers:{...guest,Range:'bytes=0-23'}});
  assert.equal(range.status,206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()),pushedMedia.subarray(0,24));
  assert.equal((await signed(adPath('logo',first.id),{headers:outsider})).status,403);
  assert.equal(first.logo,'/api/ad-break/logo?ad='+first.id);
  const wallLogo=await signed(adPath('logo',first.id),{headers:guest});
  assert.equal(wallLogo.status,200);
  assert.deepEqual(Buffer.from(await wallLogo.arrayBuffer()),png);
  assert.equal((await send(adPath('skip',first.id),{},guest)).status,409);
  assert.equal((await send(adPath('unavailable',first.id),{},guest)).status,403);
  assert.equal((await command('seek',{position:80})).status,409);
  assert.equal((await command('pause')).status,200);
  assert.equal((await state()).adBreak.startedAt,null);
  assert.equal((await command('play')).status,200);
  await until(s=>s.adBreak?.id===first.id&&s.serverTime>=s.adBreak.startedAt+5000);
  for (const who of [admin, guest]) {
    assert.equal((await track(first,'impression',who)).status,204);
    assert.equal((await track(first,'click',who)).status,204);
    assert.equal((await track(first,'q50',who)).status,204);
  }
  assert.equal((await send(adPath('skip',first.id),{},guest)).status,200);
  const resumed=await state();
  assert.deepEqual([resumed.adBreak,resumed.playing,resumed.position,resumed.asset.version],[undefined,true,firstState.position,version]);
  for (const [number,position] of [[2,5400],[3,8100]]) {
    await command('pause');
    const {command:playingAd}=await (await command('play',{position})).json();
    const ad=playingAd.adBreak;
    assert.deepEqual([ad.number,ad.total,ad.title],[number,3,first.title]);
    assert.notEqual(ad.id,first.id);
    if (number === 3) {
      // Exercise the admin fallback for a display that cannot decode an ad.
      assert.equal((await send(adPath('unavailable',ad.id))).status,200);
    }
    const resumed=await until(s=>!s.adBreak && s.playing);
    if (number === 2) assert.equal((await track(ad,'completed')).status,204);
    assert.equal(resumed.playing,true);
    assert.equal(resumed.position,position);
    assert.equal(resumed.adBreaks.filter(item=>item.shown).length,number);
  }
  await command('pause');
  assert.equal((await (await command('play')).json()).command.adBreak,undefined);
  const analytics = await (await plain('/advt/api/analytics?days=7',{headers:staff})).json();
  assert.equal(analytics.days,7);
  assert.deepEqual(analytics.totals,{served:3,impressions:2,clicks:1,q25:2,q50:2,q75:1,completed:1,skipped:1,failed:1});
  assert.equal(analytics.creatives[0].id,long.id);
  assert.deepEqual(createAdAnalytics(path.join(temporary,'advertising')).report(7),analytics);
  const paused=await post('/advt/api/pause',{},staff);
  assert.equal((await paused.json()).enabled,false);
  assert.equal((await post('/advt/api/logout',{},staff)).status,200);
  assert.equal((await plain('/advt/api/settings',{headers:staff})).status,401);
  for(let i=0;i<4;i++) assert.equal((await post('/advt/api/login',{password:'wrong'})).status,401);
  assert.equal((await post('/advt/api/login',{password})).status,429);
});

