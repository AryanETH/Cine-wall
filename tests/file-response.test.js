'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {Readable}=require('node:stream');
const sendFile=require('../file-response');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('cancelled HTTP video responses close every upstream file descriptor', {timeout:20000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cinewall-cancelled-media-')),file=path.join(dir,'large.mp4'),size=64*1024*1024;
 const fd=fs.openSync(file,'w');fs.ftruncateSync(fd,size);fs.closeSync(fd);
 const streams=[],errors=[];
 const server=http.createServer((req,res)=>streams.push(sendFile(req,res,file,{start:0,end:size-1,headers:{'Content-Type':'video/mp4','Content-Length':size},onError:e=>errors.push(e.code)})));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('cinewall-cancelled-media-'))fs.rmSync(dir,{recursive:true,force:true});});
 function cancel(){return new Promise((resolve,reject)=>{const request=http.get(base,{agent:false},response=>{response.once('data',()=>{response.destroy();request.destroy();resolve();});response.on('error',()=>{});});request.on('error',e=>{if(e.code!=='ECONNRESET')reject(e);});});}
 for(let batch=0;batch<15;batch++)await Promise.all(Array.from({length:8},cancel));
 for(let i=0;i<200&&streams.some(s=>!s.closed);i++)await sleep(10);
 assert.equal(streams.length,120);assert.ok(streams.every(s=>s.closed&&s.fd===null),'cancelled ranges must not retain descriptors');assert.deepEqual(errors,[]);
 const response=await fetch(base,{headers:{Range:'bytes=0-63'}});assert.equal(response.status,200);const reader=response.body.getReader();await reader.read();await reader.cancel();
});

test('file-open exhaustion returns retryable JSON before sending video headers',async t=>{
 let captured;
 const server=http.createServer((req,res)=>sendFile(req,res,'unused',{start:0,end:63,status:206,headers:{'Content-Type':'video/mp4','Content-Length':64},createReadStream:()=>{
  const source=new Readable({read(){}});process.nextTick(()=>source.destroy(Object.assign(new Error('Exhausted'),{code:'EMFILE'})));return source;
 },onError:e=>captured=e.code}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const response=await fetch('http://127.0.0.1:'+server.address().port);
 assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'1');assert.match(response.headers.get('content-type'),/application\/json/);
 assert.equal((await response.json()).code,'MEDIA_READ_UNAVAILABLE');assert.equal(captured,'EMFILE');
});

test('missing media returns a readable 404 rather than a broken successful stream',async t=>{
 const server=http.createServer((req,res)=>sendFile(req,res,path.join(os.tmpdir(),'cinewall-no-file-'+process.pid),{headers:{'Content-Type':'video/mp4'},start:0,end:63}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const response=await fetch('http://127.0.0.1:'+server.address().port);assert.equal(response.status,404);assert.equal((await response.json()).code,'MEDIA_READ_UNAVAILABLE');
});
