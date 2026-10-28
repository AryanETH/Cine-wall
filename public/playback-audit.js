'use strict';
// Explicit local-only diagnostic run; no reporting, storage or remote telemetry.
if (['localhost','127.0.0.1','[::1]'].includes(location.hostname) && new URLSearchParams(location.search).has('playbackAudit')) {
  const video=document.querySelector('#video'),report=document.createElement('output');
  report.id='playbackAudit';report.hidden=true;document.body.appendChild(report);
  const began=performance.now(),events={},samples=[];let started=false;
  const names=['playing','waiting','stalled','seeking','seeked','pause','ended','error'];
  function sample(){
    if(video.currentTime>.1&&!video.paused)started=true;
    const q=video.getVideoPlaybackQuality?.()||{};
    let renderer;try{renderer=video3d?.stats;}catch{}
    const item={wallSeconds:Math.round((performance.now()-began)/1000),time:video.currentTime,paused:video.paused,ended:video.ended,ready:video.readyState,seeking:video.seeking,frames:q.totalVideoFrames,dropped:q.droppedVideoFrames,hidden:document.hidden,error:video.error?.message||'',renderer};
    samples.push(item);if(samples.length>650)samples.shift();
    report.value=JSON.stringify({started,duration:video.duration,events,samples});
  }
  for(const name of names)video.addEventListener(name,()=>{events[name]=(events[name]||0)+1;sample();});
  const timer=setInterval(sample,1000);sample();addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
