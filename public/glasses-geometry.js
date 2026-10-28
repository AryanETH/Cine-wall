'use strict';
(() => {
  function rotate([x,y,z],angle) {
    z+=.5;
    const rx=x*Math.cos(angle)+z*Math.sin(angle),rz=-x*Math.sin(angle)+z*Math.cos(angle),tilt=-.18;
    return [rx,y*Math.cos(tilt)-rz*Math.sin(tilt),y*Math.sin(tilt)+rz*Math.cos(tilt)];
  }
  function project([x,y,z]) { const perspective=5/(5-z);return [x*perspective,y*perspective]; }
  function rotationBounds(faces) {
    let x=0,y=0;
    for(let step=0;step<360;step++) for(const face of faces) for(const point of face.points) {
      const [px,py]=project(rotate(point,step*Math.PI/180));x=Math.max(x,Math.abs(px));y=Math.max(y,Math.abs(py));
    }
    return {x:x*1.08,y:y*1.08};
  }
  function fitScale(width,height,bounds) { return Math.min(width*.88/(bounds.x*2),height*.88/(bounds.y*2)); }
  function surfaces(faces) {
    const groups=new Map();
    for(const face of faces){
      const [a,b,c]=face.points,u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);
      let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
      const length=Math.hypot(...n);if(length<1e-10)continue;
      n=n.map(x=>x/length);const flipped=n.find(x=>Math.abs(x)>.0001)<0;if(flipped)n=n.map(x=>-x);
      const plane=n.reduce((sum,x,i)=>sum+x*a[i],0),key=[...n,plane,...face.color].map(x=>Math.round(x*10000)).join(':');
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(flipped?{...face,points:[a,c,b]}:face);
    }
    return [...groups.values()];
  }
  const api={rotate,project,rotationBounds,fitScale,surfaces};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.CineWallGlassesGeometry=api;
})();
