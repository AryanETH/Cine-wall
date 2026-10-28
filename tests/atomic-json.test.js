'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const save=require('../atomic-json');
test('session save replaces complete JSON and leaves no temporary files',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cinewall-atomic-')),file=path.join(dir,'session.json');
 try{save(file,{version:1});save(file,{version:2,asset:'movie'});assert.deepEqual(JSON.parse(fs.readFileSync(file)),{version:2,asset:'movie'});assert.deepEqual(fs.readdirSync(dir),['session.json']);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
for(const failure of ['write','rename'])test('failed '+failure+' retains the previous complete session',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cinewall-atomic-')),file=path.join(dir,'session.json');
 try{
  save(file,{preserved:true});const io={...fs};
  if(failure==='write')io.writeFileSync=(target)=>{fs.writeFileSync(target,'{');throw Object.assign(new Error('Exhausted'),{code:'EMFILE'});};
  else io.renameSync=()=>{throw Object.assign(new Error('Unavailable'),{code:'EACCES'});};
  assert.throws(()=>save(file,{preserved:false},io));assert.deepEqual(JSON.parse(fs.readFileSync(file)),{preserved:true});assert.deepEqual(fs.readdirSync(dir),['session.json']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
