'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), net=require('node:net');
const {execFileSync}=require('node:child_process');
const {fetch,http,spawn}=require('./account-fixture.cjs');
const {randomUUID}=require('node:crypto');

test('hosted Instant extracts embedded tracks and captions without relaying the movie stream', {timeout:45000}, async t=>{
  try{execFileSync('ffmpeg',['-version'],{stdio:'ignore',windowsHide:true});}catch{t.skip('FFmpeg required');return;}
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cinewall-hosted-tracks-'));
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),windowsHide:true,stdio:'ignore',env:{...process.env,PORT:String(port),CINEWALL_HOSTED:'1',CINEWALL_CACHE_DIR:directory,CINEWALL_ROOM_STORE_DIR:path.join(directory,'rooms'),CINEWALL_ADS_STORE_DIR:path.join(directory,'ads')}});
  let stream;
  t.after(async()=>{stream?.destroy();child.kill();await new Promise(r=>setTimeout(r,350));if(path.dirname(directory)===os.tmpdir()&&path.basename(directory).startsWith('cinewall-hosted-tracks-'))fs.rmSync(directory,{recursive:true,force:true,maxRetries:4,retryDelay:100});});
  const base='http://127.0.0.1:'+port, device={'X-CineWall-Device':randomUUID(),'X-CineWall-Key':randomUUID(),Host:'watch.aitoyz.in',Origin:'https://watch.aitoyz.in'};
  for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,30));}
  async function request(route,body,extra={}){
    const payload=body===undefined?undefined:Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
    return new Promise((resolve,reject)=>{const req=http.request(base+route,{method:payload?'POST':'GET',headers:{...device,...extra,...(payload?{'Content-Length':payload.length}:{})}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
    });req.on('error',reject);req.end(payload);});
  }
  async function api(route,body){const r=await request(route,body,{'Content-Type':'application/json'}),data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
  const room=(await api('/api/rooms/create',{mode:'video'})).room, peer=randomUUID();
  const movie=path.join(directory,'movie.mp4'),sub=path.join(directory,'sub.srt');fs.writeFileSync(sub,'1\n00:00:00,000 --> 00:00:03,000\nHosted captions');
  execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=s=160x90:r=1','-f','lavfi','-i','sine=frequency=440','-f','lavfi','-i','sine=frequency=880','-i',sub,'-map','0:v','-map','1:a','-map','2:a','-map','3:s','-t','4','-c:v','libx264','-c:a','aac','-c:s','mov_text','-metadata:s:a:0','language=eng','-metadata:s:a:1','language=hin',movie],{windowsHide:true});
  const bytes=fs.readFileSync(movie);let trackRequests=0;
  await new Promise((resolve,reject)=>{stream=http.get(base+'/events?room='+room+'&peer='+peer,{headers:device},res=>{
    let pending='';res.on('error',()=>{});res.on('data',chunk=>{pending+=chunk;let end;while((end=pending.indexOf('\n\n'))>=0){const event=pending.slice(0,end);pending=pending.slice(end+2);if(!event.includes('event: source-range'))continue;const range=JSON.parse(event.split('\n').find(line=>line.startsWith('data:')).slice(5));assert.equal(range.purpose,'tracks');trackRequests++;void request('/api/source/range?room='+room+'&id='+range.id,bytes.subarray(range.start,range.end+1),{'Content-Type':'application/octet-stream'}).then(r=>r.arrayBuffer());}});resolve();});stream.on('error',reject);});
  const asset=(await api('/api/local-source?room='+room,{peerId:peer,publicationId:randomUUID(),name:'movie.mp4',type:'video/mp4',size:bytes.length,duration:4,fingerprint:'a'.repeat(64),localOnly:true})).state.asset;
  assert.equal(asset.transport,'hotspot');const scope='?room='+room+'&v='+asset.version;
  const tracks=await api('/api/player/tracks'+scope);assert.deepEqual(tracks.audio.map(a=>a.label),['eng','hin']);
  await api('/api/player/options'+scope,{audio:tracks.audio[1].id,captions:String(tracks.captions[0].id)});
  const cues=await api('/api/player/captions'+scope+'&track='+tracks.captions[0].id);assert.equal(cues[0].text,'Hosted captions');
  const audio=await request('/api/player/audio'+scope+'&track='+tracks.audio[1].id,undefined,{Range:'bytes=0-1023'});assert.equal(audio.status,206);assert.equal((await audio.arrayBuffer()).byteLength,1024);
  assert.equal((await request('/api/media/stream'+scope)).status,409,'hotspot movie delivery still uses the direct connection');
  assert.ok(trackRequests>0,'the hosted extraction bridge reads authenticated source ranges');
});
