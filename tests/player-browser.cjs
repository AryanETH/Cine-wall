'use strict';
// Run manually: node tests/player-browser.cjs [--mkv] [--long]. Requires Chrome and FFmpeg.

'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const testRoot = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), 'cinewall-player-check-')));
const artifacts = path.resolve('.cinema-cache');
fs.mkdirSync(artifacts, {recursive:true});
const mkv = process.argv.includes('--mkv');
const long = process.argv.includes('--long');
const remote = process.argv.includes('--remote');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function waitFor(probe, name, timeout = 5000) {
  const until = Date.now() + timeout;
  do {
    try {
      const result = await probe();
      if (result) return result;
    } catch (error) {
      if (Date.now() >= until) throw error;
    }
    await delay(16);
  } while (Date.now() < until);
  throw new Error('Timed out waiting for ' + name);
}

const testKeys=require('node:crypto').generateKeyPairSync('rsa',{modulusLength:2048});
let browser, receiverBrowser, site, socket;
async function verify() {
  const reserved = net.createServer();
  await new Promise(resolve => reserved.listen(0, '127.0.0.1', resolve));
  const port = reserved.address().port;
  await new Promise(resolve => reserved.close(resolve));
  site = spawn(process.execPath, ['tests/account-server.cjs'], {
    windowsHide: true,
    env: { ...process.env, PORT: String(port), CINEWALL_TEST_PUBLIC_KEY: testKeys.publicKey.export({type:'spki',format:'pem'}), CINEWALL_CACHE_DIR: path.join(testRoot, 'media'), CINEWALL_ROOM_STORE_DIR: path.join(testRoot, 'rooms'), CINEWALL_ADS_STORE_DIR: path.join(testRoot, 'ads'), CINEWALL_ADS_PASSWORD: '' },
    stdio: 'ignore',
  });
  const base = 'http://127.0.0.1:' + port;
  await waitFor(async () => (await fetch(base + '/health', { signal: AbortSignal.timeout(500) })).ok, 'CineWall');
  const profile = path.join(testRoot, 'chrome');
  browser = spawn(chrome, ['--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run',
    '--no-default-browser-check', '--disable-features=WebRtcHideLocalIpsWithMdns', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });
  const debugPort = await waitFor(() => fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0], 'browser');
  const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const messages = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const resolve = messages.get(message.id);
    if (resolve) { messages.delete(message.id); resolve(message); }
  });
  async function send(method, params = {}) {
    const current = ++id;
    const incoming = new Promise(resolve => messages.set(current, resolve));
    socket.send(JSON.stringify({ id: current, method, params }));
    const result = await incoming;
    if (result.error) throw Error(result.error.message);
    return result.result;
  }
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  }

  const crypto = require('node:crypto');
  const now = Math.floor(Date.now()/1000), encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const jwtParts = [encode({alg:'RS256',kid:'test-key'}),encode({iss:'https://securetoken.google.com/cinewall-test',aud:'cinewall-test',sub:'test-account',email:'viewer@example.test',email_verified:true,iat:now,auth_time:now,exp:now+3600})].join('.');
  const token = jwtParts+'.'+crypto.sign('RSA-SHA256',Buffer.from(jwtParts),testKeys.privateKey).toString('base64url');
  const identity = {'X-CineWall-Device':crypto.randomUUID(),'X-CineWall-Key':crypto.randomUUID(),Authorization:'Bearer '+token};
  async function api(route, body, headers={}) {
    const response=await fetch(base+route,{headers:{...identity,Origin:base,'Content-Type':'application/json',...headers},...(body!==undefined?{method:'POST',body:typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body)}:{})});
    const value=await response.json(); assert.ok(response.ok,route+' '+JSON.stringify(value)); return value;
  }
  const login=await fetch(base+'/api/auth/session',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({idToken:token})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0].split('=');
  await send('Network.setCookie',{name:cookie[0],value:cookie[1],url:base,path:'/'});
  const room=await api('/api/rooms/create',{mode:'video'});
  const fixture=path.join(testRoot,mkv?'sample.mkv':'sample.mp4'), subtitles=path.join(testRoot,'sub.srt');
  fs.writeFileSync(subtitles,'1\n00:00:00,000 --> 00:00:19,000\nHello CineWall');
  require('node:child_process').execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=24','-f','lavfi','-i','sine=frequency=440','-f','lavfi','-i','sine=frequency=880','-i',subtitles,'-map','0:v','-map','1:a','-map','2:a','-map','3:s','-t',long?'110':'20','-c:v','libx264','-preset','ultrafast','-c:a',mkv?'ac3':'aac','-c:s',mkv?'srt':'mov_text','-metadata:s:a:0','language=eng','-metadata:s:a:1','language=hin',fixture],{windowsHide:true});
  await api('/api/command?room='+room.room,{type:'layout',screenCount:1});
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('cinewall-device',"+JSON.stringify(identity['X-CineWall-Device'])+");localStorage.setItem('cinewall-device-key',"+JSON.stringify(identity['X-CineWall-Key'])+");"});
  await send('Page.navigate',{url:base+'/admin.html?mode=video&room='+room.room});
  await waitFor(()=>evaluate("document.readyState==='complete' && typeof filePeer==='object' && window.CineWallSession?.membership?.admin && !document.querySelector('#adminAssetFile').disabled"),'source dashboard',15000);
  if(remote)await evaluate("Object.defineProperty(window.CineWallSession,'hosted',{value:true})");
  const doc=await send('DOM.getDocument');
  const input=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#adminAssetFile'});
  await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[fixture]});
  await waitFor(async()=>{const result=await api('/api/status?room='+room.room);return result.state.asset?.source==='peer';},'Instant movie published',15000);
  const sourceSocket=socket;
  let pageSocket;
  if(remote){
    const receiverProfile=path.join(testRoot,'receiver-chrome');
    receiverBrowser=spawn(chrome,['--headless','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--disable-features=WebRtcHideLocalIpsWithMdns','--remote-debugging-port=0','--user-data-dir='+receiverProfile,'about:blank'],{windowsHide:true,stdio:'ignore'});
    const receiverPort=await waitFor(()=>fs.readFileSync(path.join(receiverProfile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0],'receiver browser');
    const pages=await(await fetch('http://127.0.0.1:'+receiverPort+'/json/list')).json();
    pageSocket=pages.find(page=>page.type==='page').webSocketDebuggerUrl;
  }else{
    const target=await send('Target.createTarget',{url:'about:blank'});
    const pages=await (await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();
    pageSocket=pages.find(page=>page.id===target.targetId).webSocketDebuggerUrl;
  }
  socket=new WebSocket(pageSocket);
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data),resolve=messages.get(message.id);if(resolve){messages.delete(message.id);resolve(message);}});
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  if(remote){
    await send('Network.setCookie',{name:cookie[0],value:cookie[1],url:base,path:'/'});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('cinewall-device',"+JSON.stringify(identity['X-CineWall-Device'])+");localStorage.setItem('cinewall-device-key',"+JSON.stringify(identity['X-CineWall-Key'])+");"});
  }
  await send('Page.navigate',{url:base+'/screen.html?screen=1&room='+room.room});
  try { await waitFor(()=>evaluate("document.readyState==='complete' && window.CineWallSession?.membership?.admin && document.querySelector('#video').readyState>=2"),'signed-in player',25000); }
  catch(error){console.log(await evaluate("({url:location.pathname,copy:document.querySelector('#waitingCopy')?.textContent,setup:document.querySelector('#setup')?.textContent?.slice(0,120),video:document.querySelector('#video')?.error?.message,peer:typeof filePeer!=='undefined'?filePeer?.connectionStatus():null,peerError:typeof filePeer!=='undefined'?filePeer?.lastConnectionError:null})"));throw error;}
  await evaluate("document.querySelector('#readyButton').click()");
  await waitFor(()=>evaluate("!document.querySelector('#playerFeatureMenu').hidden"),'top feature strip');
  if(remote){
    assert.equal(await evaluate('filePeer.connectionStatus()'),'connected');
    await evaluate("for(const [id,peer]of filePeer.connections)filePeer.dropPeer(id,peer)");
    const received=await evaluate("filePeer.range(0,1024).then(bytes=>bytes.byteLength)");
    assert.equal(received,1024,'real data-channel reconnect returns the requested movie range');
  }
  for(const [id,value,key] of [['playerPictureFit','stretch','mode'],['playerPictureFit','crop','mode'],['playerVideoView','anaglyph','videoView'],['playerVideoView','normal','videoView'],['playerSoundMode','3d','audioMode'],['playerSoundMode','personal','audioMode']]) {
    await evaluate('(()=>{const el=document.getElementById('+JSON.stringify(id)+');el.value='+JSON.stringify(value)+';el.dispatchEvent(new Event("change",{bubbles:true}))})()');
    await waitFor(async()=>{const result=await api('/api/status?room='+room.room);return result.state[key]===value;},'player setting '+id+' '+value);
  }
  assert.ok(await evaluate("document.querySelector('#screenHud').contains(document.querySelector('#playerHandSettings'))"));
  await evaluate("document.querySelector('#playerAudioMenu').open=true");
  await waitFor(()=>evaluate("Array.from(document.querySelector('#playerAudioTrack').options).some(o=>o.textContent.startsWith('Hindi'))"),'language choices');
  await evaluate("const a=document.querySelector('#playerAudioTrack');a.value='2';a.dispatchEvent(new Event('change',{bubbles:true}));");
  await waitFor(()=>evaluate("document.querySelector('#playerAlternateAudio').readyState>=2 && document.querySelector('#playerAlternateAudio').src.includes('track=2')"),'selected Hindi stream',12000);
  assert.ok(await evaluate("document.querySelector('#video').muted"));
  await evaluate("document.querySelector('#playerCaptionsMenu').open=true");
  await waitFor(()=>evaluate('!playerAudioMenu.open'),'CC closes audio menu');
  await evaluate('playerAudioMenu.open=true');
  await waitFor(()=>evaluate('!playerCaptionsMenu.open'),'audio closes CC menu');
  await evaluate('playerCaptionsMenu.open=true');
  await waitFor(()=>evaluate('!playerAudioMenu.open'),'only CC remains open');
  await waitFor(()=>evaluate("document.querySelector('#playerCaptionTrack').options.length>1"),'caption tracks');
  await evaluate("const s=document.querySelector('#playerCaptionTrack');s.value='3';s.dispatchEvent(new Event('change',{bubbles:true}));");
  await waitFor(()=>evaluate("document.querySelector('#playerCaptionText').textContent.includes('Hello CineWall')"),'embedded caption displayed');
  await evaluate("const size=document.querySelector('#playerCaptionSize');size.value=54;size.dispatchEvent(new Event('input',{bubbles:true}));size.dispatchEvent(new Event('change',{bubbles:true}));");
  await waitFor(()=>evaluate("getComputedStyle(document.querySelector('#playerCaptionText')).fontSize==='54px'"),'caption resized');
  await evaluate("document.querySelector('#playerCaptionMove').click();document.querySelector('#playerCaptionsMenu').open=false;document.querySelector('#playerAudioMenu').open=false");
  const rect=await evaluate("document.querySelector('#playerCaptionText').getBoundingClientRect().toJSON()");
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.left+rect.width*.5,y:rect.top+rect.height*.5,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:880,y:330,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:880,y:330,button:'left',clickCount:1});
  await waitFor(async()=>{const status=await api('/api/status?room='+room.room);return status.state.playerOptions.y<50;},'caption placement shared');
  await evaluate("document.querySelector('#playerCaptionMove').click();document.activeElement.blur()");
  await delay(4500);
  assert.ok(await evaluate("document.querySelector('#screenHud').classList.contains('fade') && !document.querySelector('#screenControls').classList.contains('visible')"));
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:530,y:400});
  assert.ok(await evaluate("!document.querySelector('#screenHud').classList.contains('fade') && document.querySelector('#screenControls').classList.contains('visible')"));
  await delay(450);
  const chromeLayout=await evaluate("({top:screenHud.getBoundingClientRect().height,bottom:screenControls.getBoundingClientRect().height,logo:screenBrandIcon.tagName==='IMG' && screenBrandIcon.naturalWidth>0,duplicate:!!document.querySelector('#enterPlayerFullscreen'),shortcuts:!!document.querySelector('#screenShortcuts'),theme:!!document.querySelector('.screen-theme-toggle')})");
  assert.ok(chromeLayout.top<=32 && chromeLayout.bottom<=48,'player strips stay compact: '+JSON.stringify(chromeLayout));
  assert.equal(chromeLayout.logo,true);assert.equal(chromeLayout.duplicate,false);assert.equal(chromeLayout.shortcuts,false);assert.equal(chromeLayout.theme,false);
  for(const theme of ['light','dark']) {
    await evaluate('CineWallTheme.set('+JSON.stringify(theme)+')');
    const colours=await evaluate('({top:getComputedStyle(screenHud).backgroundColor,bottom:getComputedStyle(screenControls).backgroundColor})');
    const expected=theme==='light'?'rgb(255, 255, 255)':'rgb(0, 0, 0)';
    assert.equal(colours.top,expected);assert.equal(colours.bottom,expected);
  }
  const shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(artifacts,'player-strips-preview.png'),Buffer.from(shot.data,'base64'));
  await evaluate("window.__volumeEvents=0;video.addEventListener('volumechange',()=>window.__volumeEvents++);" );
  await evaluate("window.__meterContext=new AudioContext();window.__meter=__meterContext.createAnalyser();window.__audioSource=__meterContext.createMediaStreamSource(playerAlternateAudio.captureStream());__audioSource.connect(__meter);window.__silentMeterGain=__meterContext.createGain();__silentMeterGain.gain.value=0;__meter.connect(__silentMeterGain).connect(__meterContext.destination);__meterContext.resume()");
  await waitFor(async()=>{const result=await api('/api/status?room='+room.room);return result.state.allReady;},'all displays ready');
  async function clickControl(selector) {
    await send('Page.bringToFront');
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:530,y:400});
    const rect=await evaluate('document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect().toJSON()');
    const x=rect.left+rect.width/2,y=rect.top+rect.height/2;
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
  }
  await clickControl('#screenPlay');
  await waitFor(()=>evaluate("!document.querySelector('#video').paused && !document.querySelector('#playerAlternateAudio').paused"),'movie and alternate audio playing',7000);
  const before=await evaluate("({t:video.currentTime,a:playerAlternateAudio.currentTime,paused:playerAlternateAudio.paused,muted:playerAlternateAudio.muted,vol:playerAlternateAudio.volume,mainMuted:video.muted,events:window.__volumeEvents})" );
  await delay(4000);
  const after=await evaluate("({t:video.currentTime,a:playerAlternateAudio.currentTime,paused:playerAlternateAudio.paused,muted:playerAlternateAudio.muted,vol:playerAlternateAudio.volume,mainMuted:video.muted,events:window.__volumeEvents,error:playerFeatureStatus.textContent})");
  assert.ok(after.t-before.t>3.5 && after.a-before.a>3.5,'sound and picture must keep playing');
  assert.equal(after.muted,false);assert.equal(after.vol,1);assert.equal(after.mainMuted,true);
  assert.ok(after.events<8,'stable playback must not repeatedly toggle the movie mute flag');
  const drift=await evaluate("Math.abs(document.querySelector('#video').currentTime-document.querySelector('#playerAlternateAudio').currentTime)");
  assert.ok(drift<.3,drift);
  const signal=await evaluate("(()=>{const data=new Float32Array(__meter.fftSize);__meter.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((sum,x)=>sum+x*x,0)/data.length)})()");
  assert.ok(signal>.01,'selected language must have a non-silent audio signal: '+signal);
  const frequency=await evaluate("(()=>{const data=new Float32Array(__meter.frequencyBinCount);__meter.getFloatFrequencyData(data);let peak=0;for(let i=1;i<data.length;i++)if(data[i]>data[peak])peak=i;return peak*__meterContext.sampleRate/__meter.fftSize})()");
  assert.ok(Math.abs(frequency-880)<40,'selected Hindi soundtrack must be the 880 Hz signal: '+frequency);
  if(long) {
    await api('/api/command?room='+room.room,{type:'seek',position:87});
    await waitFor(()=>evaluate('video.currentTime>=87 && !video.paused'),'seek near next audio section',12000);
    await waitFor(()=>evaluate('video.currentTime>91 && playerAlternateAudio.src.includes("start=90") && playerAlternateAudio.currentTime>0 && !playerAlternateAudio.paused'),'playback crosses into cached next section',15000);
    const sectionDrift=await evaluate('Math.abs(video.currentTime-playerAlternateAudio.currentTime-90)');
    assert.ok(sectionDrift<.3,'section sound remains synchronized: '+sectionDrift);
    await api('/api/command?room='+room.room,{type:'pause'});
    await waitFor(()=>evaluate('video.paused'),'pause before deep-position track change');
    await evaluate('playerAudioTrack.value="1";playerAudioTrack.dispatchEvent(new Event("change",{bubbles:true}))');
    await waitFor(()=>evaluate('playerAlternateAudio.src.includes("track=1") && playerAlternateAudio.src.includes("start=90") && playerAlternateAudio.readyState>=2'),'language switch at deep movie position',12000);
    await clickControl('#screenPlay');
    await waitFor(()=>evaluate('!video.paused && !playerAlternateAudio.paused'),'new language resumes at same position');
  }
  await api('/api/command?room='+room.room,{type:'screen-audio',screen:1,volume:.1,muted:false});
  await waitFor(()=>evaluate('screenVolume.value==="0.1"'),'low volume colour');
  assert.equal(await evaluate('getComputedStyle(screenMute).color'),'rgb(44, 130, 236)');
  await api('/api/command?room='+room.room,{type:'screen-audio',screen:1,volume:1,muted:false});
  await waitFor(()=>evaluate('screenVolume.value==="1"'),'high volume colour');
  assert.equal(await evaluate('getComputedStyle(screenMute).color'),'rgb(239, 68, 68)');
  await api('/api/command?room='+room.room,{type:'screen-audio',screen:1,muted:true});
  await waitFor(()=>evaluate("video.muted && playerAlternateAudio.muted && screenVolume.value==='0'"),'mute applies to selected sound');
  await api('/api/command?room='+room.room,{type:'screen-audio',screen:1,muted:false});
  await waitFor(()=>evaluate("!playerAlternateAudio.muted && screenVolume.value==='1'"),'unmute restores sound and slider');
  await evaluate("playerAudioTrack.value='';playerAudioTrack.dispatchEvent(new Event('change',{bubbles:true}))");
  await waitFor(()=>evaluate("!video.muted && playerAlternateAudio.paused && !playerAlternateAudio.getAttribute('src')"),'original audio restored');
  const time=await evaluate('video.currentTime');await delay(700);
  assert.ok(await evaluate('video.currentTime')>time+.4,'original movie keeps progressing');
  await clickControl('#screenPlay');
  await waitFor(()=>evaluate("document.querySelector('#video').paused && document.querySelector('#playerAlternateAudio').paused"),'both pause');
  await clickControl('#screenFullscreen');
  await waitFor(()=>evaluate('Boolean(document.fullscreenElement)'),'one-click fullscreen');
  await clickControl('#screenFullscreen');
  await waitFor(()=>evaluate('!document.fullscreenElement'),'one-click exit fullscreen');
  await api('/api/rooms/mode?room='+room.room,{mode:'audio'});
  const song=path.join(testRoot,'song.m4a');
  require('node:child_process').execFileSync('ffmpeg',['-nostdin','-v','error','-i',fixture,'-map','0:1','-vn','-c:a','aac',song],{windowsHide:true});
  await api('/api/media?room='+room.room+'&kind=audio&name=song.m4a',fs.readFileSync(song),{'Content-Type':'audio/mp4'});
  await waitFor(()=>evaluate('document.body.dataset.sessionMode==="audio" && !playerFeatureMenu.hidden && video.readyState>=2'),'audio mode top strip',12000);
  assert.equal(await evaluate('getComputedStyle(speakerStage).backgroundColor'),'rgb(0, 0, 0)');
  assert.ok(await evaluate('playerCaptionsMenu.hidden && playerFitMenu.hidden && playerVideoViewMenu.hidden && !playerSoundModeMenu.hidden'));
  await evaluate('playerSoundMode.value="3d";playerSoundMode.dispatchEvent(new Event("change",{bubbles:true}))');
  await waitFor(async()=>{const result=await api('/api/status?room='+room.room);return result.state.audioMode==='3d';},'audio player 3D sound');
  sourceSocket.close();
  console.log(JSON.stringify({instantSource:true,remoteWebRtcAndRecovery:remote,audioBlackAnd3DSound:true,playerFitAnd3DControls:true,nonSilentAudioRms:signal,originalSoundRestored:true,container:mkv?'MKV / AC3':'MP4 / AAC',selectedAudioFrequency:frequency,muteAndRestore:true,exclusiveMenus:true,themedStrips:true,volumeColours:true,sectionBoundaryAndDeepSwitch:long,languageSwitch:true,embeddedCaptions:true,captionResize:true,captionDragShared:true,hideAfter4s:true,cameraOnTop:true,realTransportClicks:true,fullscreenToggle:true,audioVideoDrift:+drift.toFixed(3)}));

}
verify().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  socket?.close();
  browser?.kill();
  receiverBrowser?.kill();
  site?.kill();
  await delay(350);
  if (path.dirname(testRoot).toLowerCase() === path.resolve(os.tmpdir()).toLowerCase() && /^cinewall-player-check-/.test(path.basename(testRoot))) {
    fs.rmSync(testRoot, { recursive:true, force:true, maxRetries:6, retryDelay:150 });
  }
});
