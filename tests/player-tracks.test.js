'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const createTracks = require('../player-tracks');
const captions = require('../public/captions');

test('SRT and VTT captions parse timestamps, preserve line breaks and keep text inert', () => {
  const cues = captions.parse('1\n00:00:01,500 --> 00:00:04,000\nHello <b>CineWall</b>\nSecond line\n\n2\n00:00:05,000 --> 00:00:06,500\nNext');
  assert.deepEqual(cues[0], { start:1.5,end:4,text:'Hello CineWall\nSecond line' });
  assert.equal(captions.parse('WEBVTT\n\n00:01.000 --> 00:03.000 align:start\nCaption')[0].start,1);
  assert.throws(() => captions.parse('No timestamps'));
  assert.throws(() => captions.parse('x'.repeat(2*1024*1024+1)));
});

test('real embedded language tracks and captions prepare independently and reset with the movie', { timeout:60000 }, async t => {
  try { execFileSync('ffmpeg', ['-version'], { stdio:'ignore', windowsHide:true }); }
  catch { t.skip('FFmpeg required'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'cinewall-player-tracks-'));
  const file = path.join(root,'languages.mp4'), sub = path.join(root,'captions.srt');
  let asset = { version:'movie1',kind:'video' }, changed = 0;
  const manager = createTracks({ asset:()=>asset,file:()=>({path:file,version:asset.version}),changed:()=>changed++ });
  t.after(() => {
    manager.reset();
    if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('cinewall-player-tracks-')) fs.rmSync(root,{recursive:true,force:true});
  });
  fs.writeFileSync(sub,'1\n00:00:00,000 --> 00:00:02,000\nHello CineWall\n');
  execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=s=320x180:r=24',
    '-f','lavfi','-i','sine=frequency=440','-f','lavfi','-i','sine=frequency=880','-i',sub,
    '-map','0:v','-map','1:a','-map','2:a','-map','3:s','-t','3','-c:v','libx264','-c:a','aac','-c:s','mov_text',
    '-metadata:s:a:0','language=eng','-metadata:s:a:1','language=hin','-metadata:s:s:0','language=eng',file],{windowsHide:true});
  const listing = await manager.tracks();
  assert.deepEqual(listing.audio.map(t=>t.label),['eng','hin']);
  const selected = await manager.select({version:'movie1',audio:listing.audio[1].id});
  assert.equal(selected.audio,listing.audio[1].id);
  const originalHash = execFileSync('ffmpeg',['-v','error','-i',file,'-map','0:2','-c','copy','-f','md5','-'],{windowsHide:true}).toString();
  const selectedHash = execFileSync('ffmpeg',['-v','error','-i',file+'.track-2.m4a','-map','0:a','-c','copy','-f','md5','-'],{windowsHide:true}).toString();
  assert.equal(selectedHash,originalHash,'AAC track packets stay unchanged');
  assert.match((await manager.captions(String(listing.captions[0].id)))[0].text,/Hello CineWall/);
  await manager.select({version:'movie1',captions:String(listing.captions[0].id),x:0,y:100,size:56,width:35});
  assert.equal(manager.sync().size,56);
  await assert.rejects(manager.select({version:'movie1',size:900}),{status:400});
  await assert.rejects(manager.select({version:'movie1',audio:99}),{status:400});
  const upload = Readable.from([Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nUploaded')]);
  await manager.upload(upload,'movie1');
  assert.equal(manager.sync().captions,'uploaded'); assert.equal(manager.sync().captionRevision,1);
  assert.equal((await manager.captions('uploaded'))[0].text,'Uploaded');
  asset = { version:'movie2',source:'peer',kind:'video' };
  assert.equal(manager.sync().captions,'off');
  assert.equal(manager.sync().audio,null);
  await assert.rejects(manager.tracks(),{status:409});
  await assert.rejects(manager.select({version:'movie1',audio:2}),{status:409});
  assert.ok(changed>=3);
  // Instant files have no server-side movie copy. Probe them through a private
  // loopback range reader, then extract the chosen sound and embedded captions.
  let rangeReads = 0;
  const instant = createTracks({ asset:()=>({version:'instant',source:'peer',kind:'video',name:'movie.mp4'}), file:()=>null,
    directory:root, changed:()=>{}, peerStream(req,res) {
      assert.equal(req.socket.remoteAddress,'127.0.0.1');
      assert.match(req.url,/^\/[a-f0-9]{64}$/);
      const size=fs.statSync(file).size, match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
      const start=match?Number(match[1]):0, end=match&&match[2]?Math.min(size-1,Number(match[2])):size-1;
      const headers={'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes'};
      if(match)headers['Content-Range']=`bytes ${start}-${end}/${size}`;
      res.writeHead(match?206:200,headers);
      if(req.method==='HEAD'){res.end();return;}
      rangeReads++; fs.createReadStream(file,{start,end}).pipe(res);
    } });
  t.after(()=>instant.reset());
  const discovered=await instant.tracks();
  assert.deepEqual(discovered.audio.map(t=>t.label),['eng','hin']);
  await instant.select({version:'instant',audio:discovered.audio[1].id});
  assert.match((await instant.captions(String(discovered.captions[0].id)))[0].text,/Hello CineWall/);
  assert.ok(rangeReads>=3);
  instant.reset();
});

test('audio switches prepare the current 90-second window and reuse it without changing video quality', { timeout:60000 }, async t => {
  try { execFileSync('ffmpeg',['-version'],{stdio:'ignore',windowsHide:true}); }
  catch { t.skip('FFmpeg required');return; }
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cinewall-audio-window-')), file=path.join(root,'long.mp4');
  const manager=createTracks({asset:()=>({version:'long',kind:'video'}),file:()=>({path:file,version:'long'}),changed:()=>{}});
  t.after(()=>{manager.reset();fs.rmSync(root,{recursive:true,force:true});});
  execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=s=160x90:r=1:d=180',
    '-f','lavfi','-i','sine=frequency=440:duration=90','-f','lavfi','-i','sine=frequency=880:duration=90',
    '-filter_complex','[1:a][2:a]concat=n=2:v=0:a=1[a]','-map','0:v','-map','[a]','-c:v','libx264','-preset','ultrafast','-c:a','aac',file],{windowsHide:true});
  const before=fs.statSync(file).size;
  await Promise.all([
    manager.select({version:'long',audio:1,position:100,audioWindowSeconds:3}),
    manager.select({version:'long',audio:1,position:110}),
  ]);
  assert.equal(manager.sync().audioWindowSeconds,90,'clients cannot change the preparation window');
  const part=file+'.track-1.part-90.m4a';
  assert.ok(fs.statSync(part).size<before*.8,'only the relevant section is prepared');
  const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-of','json',part],{windowsHide:true}));
  assert.ok(Number(info.format.duration)>89 && Number(info.format.duration)<91);
  const samples=execFileSync('ffmpeg',['-v','error','-i',part,'-t','0.4','-ar','16000','-ac','1','-f','s16le','-'],{windowsHide:true});
  let crosses=0;
  for(let n=2;n<samples.length;n+=2)if(samples.readInt16LE(n-2)<=0&&samples.readInt16LE(n)>0)crosses++;
  const frequency=crosses/(samples.length/2/16000);
  assert.ok(Math.abs(frequency-880)<20,'window starts at the correct soundtrack time: '+frequency);
  const modified=fs.statSync(part).mtimeMs;
  await manager.select({version:'long',audio:1,position:120});
  assert.equal(fs.statSync(part).mtimeMs,modified,'switching within a cached section does not prepare again');
  await assert.rejects(manager.select({version:'long',audio:1,position:-1}),{status:400});
  assert.equal(fs.statSync(file).size,before,'the video remains untouched');
});
