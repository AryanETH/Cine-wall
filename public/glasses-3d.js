'use strict';
// Tiny renderer for the credited untextured, triangle-only glasses GLB.
(() => {
  let faces, iconFaces, faceSurfaces, iconSurfaces, flying, vignette, animationFrame, generation = 0;
  let rotationBounds;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const iconsReady = fetch('/models/anaglyph-icon.gltf').then(r => { if (!r.ok) throw Error('Icon unavailable'); return r.json(); }).then(model => {
    const bytes = Uint8Array.from(atob(model.buffers[0].uri.split(',')[1]), c => c.charCodeAt(0));
    iconFaces = model.meshes[0].primitives.flatMap(primitive => {
      const accessor=model.accessors[primitive.attributes.POSITION], view=model.bufferViews[accessor.bufferView];
      const vertices=new Float32Array(bytes.buffer,view.byteOffset||0,accessor.count*3);
      const color=model.materials[primitive.material].pbrMetallicRoughness.baseColorFactor;
      return Array.from({length:accessor.count/3},(_,i)=>({points:Array.from({length:3},(_,j)=>Array.from(vertices.slice(i*9+j*3,i*9+j*3+3))),color}));
    });
    iconSurfaces=window.CineWallGlassesGeometry.surfaces(iconFaces);redrawIcons();
  }).catch(() => {});
  const ready = fetch('/models/anaglyph-glasses.glb').then(r => { if (!r.ok) throw Error('Model unavailable'); return r.arrayBuffer(); }).then(data => {
    const header = new DataView(data), jsonLength = header.getUint32(12,true);
    const model = JSON.parse(new TextDecoder().decode(new Uint8Array(data,20,jsonLength)));
    const binaryOffset = 20 + jsonLength + 8;
    faces = model.meshes[0].primitives.flatMap(primitive => {
      const accessor = model.accessors[primitive.attributes.POSITION], view = model.bufferViews[accessor.bufferView];
      const vertices = new Float32Array(data, binaryOffset + (view.byteOffset || 0), accessor.count * 3);
      const indexAccessor = model.accessors[primitive.indices], indexView = model.bufferViews[indexAccessor.bufferView];
      const indices = new Uint16Array(data,binaryOffset+(indexView.byteOffset||0),indexAccessor.count);
      const color = model.materials[primitive.material].pbrMetallicRoughness.baseColorFactor;
      return Array.from({ length: indices.length / 3 }, (_, i) => ({ points: Array.from({ length: 3 }, (_, j) => {
        const at=indices[i*3+j]*3;
        // Centre/scale in the viewer and face the red lens to the viewer's left.
        return [-vertices[at]*21.4,(vertices[at+1]-.0175)*21.4,(vertices[at+2]+.04)*21.4-.5];
      }), color }));
    });
    rotationBounds = window.CineWallGlassesGeometry.rotationBounds(faces);
    faceSurfaces=window.CineWallGlassesGeometry.surfaces(faces);
  }).catch(() => {});
  function redrawIcons() { document.querySelectorAll('[data-glasses]').forEach(canvas => {if(canvas.getBoundingClientRect().width)draw(canvas,-.28,true);}); }
  function draw(canvas, angle, icon = false) {
    const mesh = icon ? iconFaces : faces;
    if (!mesh) return;
    const bounds = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1,bounds.width), height = Math.max(1,bounds.height);
    canvas.width = Math.round(width*ratio); canvas.height = Math.round(height*ratio);
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.scale(ratio,ratio); ctx.clearRect(0,0,width,height);
    const geometry=window.CineWallGlassesGeometry;
    // Fill coplanar triangles in one path so antialiasing cannot expose dark
    // cracks along the internal triangulation of a white cardboard face.
    const polygons = (icon?iconSurfaces:faceSurfaces).map(group => {
      const triangles=group.map(face=>face.points.map(point=>geometry.rotate(point,angle)));
      return {color:group[0].color,triangles,z:triangles.flat().reduce((n,p)=>n+p[2],0)/(triangles.length*3)};
    }).sort((a,b)=>a.z-b.z);
    for (const face of polygons) {
      const p=face.triangles[0], u=p[1].map((n,i)=>n-p[0][i]),v=p[2].map((n,i)=>n-p[0][i]);
      const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]], len=Math.hypot(...normal)||1;
      const light=.7+.3*Math.abs((normal[0]*.2+normal[1]*.4+normal[2]*.8)/len);
      ctx.fillStyle='rgb('+face.color.slice(0,3).map(c=>Math.round(c*255*light)).join(',')+')';
      ctx.beginPath();
      const fit=icon?Math.min(width/3.8,height/1.65):geometry.fitScale(width,height,rotationBounds);
      for(const triangle of face.triangles){triangle.forEach((point,i)=>{ const [x,y]=geometry.project(point);const px=width/2+x*fit,py=height/2-y*fit;if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py); });ctx.closePath();}
      ctx.fill();
    }
  }
  function cancel() { generation++; cancelAnimationFrame(animationFrame); flying?.remove(); vignette?.remove(); flying = vignette = null; }
  async function activate(origin) {
    cancel(); if (reduced.matches || document.hidden) return;
    const ticket=generation; await ready;
    if (ticket!==generation || !faces || !origin?.isConnected || document.hidden) return;
    const icon=origin.querySelector('[data-glasses]') || origin, start=icon.getBoundingClientRect();
    const node=document.createElement('canvas'); node.className='glasses-flight';node.setAttribute('aria-hidden','true');
    const backdrop=document.createElement('div');backdrop.className='glasses-vignette';backdrop.setAttribute('aria-hidden','true');
    document.body.appendChild(backdrop);vignette=backdrop;
    document.body.appendChild(node); flying=node;
    const began=performance.now(), from={x:start.left+start.width/2,y:start.top+start.height/2};
    function frame(now) {
      const t=Math.min(1,(now-began)/1900), travel=t<.26?t/.26:t>.7?(1-t)/.3:1;
      const ease=travel*travel*(3-2*travel);
      const maxWidth=Math.min(620,innerWidth*.9),maxHeight=Math.min(440,innerHeight*.8);
      node.style.width=(70+(maxWidth-70)*ease)+'px';node.style.height=(50+(maxHeight-50)*ease)+'px';
      backdrop.style.opacity=String(ease);
      node.style.left=(from.x+(innerWidth/2-from.x)*ease)+'px';node.style.top=(from.y+(innerHeight/2-from.y)*ease)+'px';
      node.style.opacity=String(Math.min(1,(1-t)*14));
      draw(node,-.28+Math.PI*2*(t*t*(3-2*t)));
      if(t<1)animationFrame=requestAnimationFrame(frame);else cancel();
    }
    animationFrame=requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  reduced.addEventListener('change',()=>{if(reduced.matches)cancel();});
  addEventListener('pagehide',cancel);
  // Hidden controls have no dimensions at load; render again when revealed.
  const observer=new MutationObserver(redrawIcons);
  document.querySelectorAll('#videoViewPanel,#video3dToggle').forEach(node=>observer.observe(node,{attributes:true,subtree:true,attributeFilter:['hidden']}));
  window.CineWallGlasses={activate,cancel};
})();
