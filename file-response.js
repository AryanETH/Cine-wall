'use strict';
const fs=require('node:fs');

// Own the upstream stream for the entire HTTP response, including cancelled
// ranges and disconnects. pipe() alone only unpipes a cancelled destination.
module.exports=function fileResponse(req,res,file,{start,end,status=200,headers,createReadStream=fs.createReadStream,onError=()=>{}}){
  let stream;
  const cancel=()=>stream?.destroy();
  const cleanup=()=>res.removeListener('close',cancel);
  const failed=error=>{
    onError(error);
    if(res.destroyed)return;
    if(res.headersSent){res.destroy();return;}
    const missing=error.code==='ENOENT',code=missing?404:503;
    const body=JSON.stringify({error:missing?'The uploaded video is unavailable. Choose the file again.':'The server could not read the video. Please retry shortly.',code:'MEDIA_READ_UNAVAILABLE'});
    res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store',...(missing?{}:{'Retry-After':'1'})});
    res.end(body);
  };
  res.once('close',cancel);
  try{
    stream=createReadStream(file,{start,end});
    stream.once('close',cleanup);
    stream.once('error',failed);
    stream.once('open',()=>{
      if(res.destroyed){stream.destroy();return;}
      res.writeHead(status,headers);stream.pipe(res);
    });
    if(res.destroyed)stream.destroy();
  }catch(error){cleanup();failed(error);}
  return stream;
};
