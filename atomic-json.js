'use strict';
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
module.exports=function atomicJson(file,value,io=fs){
  const temporary=file+'.tmp-'+randomUUID();
  try{
    io.writeFileSync(temporary,JSON.stringify(value),{encoding:'utf8',mode:0o600,flag:'wx'});
    io.renameSync(temporary,file);
  }catch(error){
    try{io.unlinkSync(temporary);}catch{}
    throw error;
  }
};
