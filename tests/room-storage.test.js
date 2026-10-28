'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {spawn}=require('node:child_process'), {randomUUID}=require('node:crypto');
const net=require('node:net');

test('a separate durable room store survives loss of the entire disposable media cache', {timeout:30000}, async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cinewall-durable-'));
  const cache=path.join(root,'cache'), store=path.join(root,'persistent'); let proc;
  const listener=net.createServer(); await new Promise(r=>listener.listen(0,'127.0.0.1',r));
  const port=listener.address().port; await new Promise(r=>listener.close(r));
  const identity=()=>({'X-CineWall-Device':randomUUID(),'X-CineWall-Key':randomUUID(),'Content-Type':'application/json'});
  const admin=identity(), guest=identity();
  async function stop(){ if(!proc)return; const child=proc;proc=null;child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('close',r)); }
  t.after(async()=>{await stop();if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('cinewall-durable-'))fs.rmSync(root,{recursive:true,force:true});});
  async function start(){
    proc=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),windowsHide:true,env:{...process.env,PORT:String(port),CINEWALL_HOSTED:'1',CINEWALL_CACHE_DIR:cache,CINEWALL_ROOM_STORE_DIR:store}});
    let output='';proc.stdout.on('data',x=>output+=x);proc.stderr.on('data',x=>output+=x);
    for(let n=0;n<150&&!output.includes('Start:');n++)await new Promise(r=>setTimeout(r,30));
    assert.match(output,/Start:/);
  }
  async function api(action,body,headers){const r=await fetch(`http://127.0.0.1:${port}/api/rooms/${action}`,{method:'POST',headers,body:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
  await start(); const created=(await api('create',{mode:'video'},admin)).data;
  const joined=(await api('join',{room:created.room,screen:2},guest)).data;
  await stop(); fs.rmSync(cache,{recursive:true,force:true}); await start();
  const resumedAdmin=await api('resume',{room:created.room,ticket:'stale'},admin);
  const resumedGuest=await api('resume',{room:created.room,ticket:joined.ticket},guest);
  assert.equal(resumedAdmin.status,200); assert.equal(resumedAdmin.data.admin,true);
  assert.equal(resumedGuest.status,200); assert.equal(resumedGuest.data.screen,2);
  assert.equal(resumedGuest.data.code,created.code);
  assert.equal((await api('resume',{room:randomUUID(),ticket:joined.ticket},guest)).status,404,'unknown links cannot invent rooms');
});
