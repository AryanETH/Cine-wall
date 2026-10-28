'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const geometry=require('../public/glasses-geometry');
function downloadedFaces() {
  const buffer=fs.readFileSync(path.join(__dirname,'../public/models/anaglyph-glasses.glb'));
  const length=buffer.readUInt32LE(12),model=JSON.parse(buffer.subarray(20,20+length).toString()),base=28+length;
  return model.meshes[0].primitives.flatMap(primitive=>{
    const a=model.accessors[primitive.attributes.POSITION],v=model.bufferViews[a.bufferView],ia=model.accessors[primitive.indices],iv=model.bufferViews[ia.bufferView];
    return Array.from({length:ia.count/3},(_,i)=>({points:Array.from({length:3},(_,j)=>{
      const index=buffer.readUInt16LE(base+(iv.byteOffset||0)+(i*3+j)*2),offset=base+(v.byteOffset||0)+index*12;
      return [-buffer.readFloatLE(offset)*21.4,(buffer.readFloatLE(offset+4)-.0175)*21.4,(buffer.readFloatLE(offset+8)+.04)*21.4-.5];
    })}));
  });
}
test('downloaded glasses retain safe canvas margins through a complete rotation',()=>{
  const faces=downloadedFaces(),bounds=geometry.rotationBounds(faces);
  assert.equal(faces.length,62);
  for(const [width,height] of [[70,50],[620,440],[288,250]]) {
    const scale=geometry.fitScale(width,height,bounds);
    for(let angle=0;angle<360;angle+=.5) for(const face of faces) for(const point of face.points) {
      const [x,y]=geometry.project(geometry.rotate(point,angle*Math.PI/180));
      assert.ok(Math.abs(x*scale)<width*.45,'horizontal rotation stays clear of edges');
      assert.ok(Math.abs(y*scale)<height*.45,'temples and corners stay clear of edges');
    }
  }
});

test('coplanar cardboard triangles share one fill path with consistent winding',()=>{
  const color=[1,1,1,1],groups=geometry.surfaces([
    {points:[[0,0,0],[1,0,0],[0,1,0]],color},
    {points:[[1,0,0],[0,1,0],[1,1,0]],color},
    {points:[[0,0,1],[1,0,1],[0,1,1]],color},
  ]);
  assert.equal(groups.length,2);assert.equal(groups[0].length,2);
  for(const face of groups[0]){const [a,b,c]=face.points;assert.ok((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0,'opposite source windings must not cancel the combined fill');}
});
