import test from "node:test";
import assert from "node:assert/strict";
import {
 SHAPES,MODE_NAMES,SQ3,cellVolume,heightColor,
 shapeBounds,insideMassing,cubeShift,triShift,pixelate
} from "../demo/pixel-engine.js";

test("M004 uses Hark's actual slab, rotated tower and spherical massing",()=>{
 assert.equal(SHAPES.length,3);
 assert.deepEqual(SHAPES.map(x=>x.id),["slab","tower","dome"]);
 assert.equal(SHAPES[0].w,44);
 assert.equal(SHAPES[1].rotation,25);
 assert.equal(SHAPES[2].r,11);
 assert.equal(insideMassing(0,0,6),true);
 assert.equal(insideMassing(12,2,30),true);
 assert.equal(insideMassing(-12,0,12),true);
 assert.equal(insideMassing(100,100,100),false);
});
test("World grids and stagger cycles reproduce source M004 definitions",()=>{
 assert.deepEqual(cubeShift(1,4),[2,2]);
 assert.deepEqual(cubeShift(2,4),[0,0]);
 assert.deepEqual(triShift(0,6),[0,0]);
 assert.ok(Math.abs(triShift(1,6)[1]-6*SQ3/3)<1e-10);
 assert.ok(Math.abs(triShift(3,6)[1])<1e-10);
 assert.equal(cellVolume(3,3,0),27);
 assert.equal(cellVolume(3,3,1),4.5);
 assert.ok(Math.abs(cellVolume(3,3,2)-27*SQ3/2)<1e-10);
});
test("Every Hark pixel geometry mode makes finite real triangles",()=>{
 for(let mode=0;mode<5;mode++){
  const r=pixelate({shape:"all",size:5,height:5,mode,gap:.85,color:true});
  assert.ok(r.count>20,MODE_NAMES[mode]);
  assert.ok(r.volume>0&&Number.isFinite(r.volume));
  assert.ok(r.geometry.triangles>0,MODE_NAMES[mode]);
  assert.equal(r.geometry.vertices.length%18,0);
  assert.ok(r.geometry.vertices.every(Number.isFinite));
  assert.ok(r.geometry.centres.every(v=>insideMassing(...v)),
    "Only mass-interior pixel centroids survive "+MODE_NAMES[mode]);
 }
});
test("Gap reduces true physical solid volume, not just visual spacing",()=>{
 const a=pixelate({size:5,mode:0,gap:1});
 const b=pixelate({size:5,mode:0,gap:.8});
 assert.equal(a.count,b.count);
 assert.ok(Math.abs(b.volume/a.volume-.8**3)<1e-10);
 assert.ok(b.geometry.surfaceFaces>a.geometry.surfaceFaces,
   "Separated voxels expose formerly internal faces");
});
test("Welded conforming cube/tetra/tri surfaces hide internal faces",()=>{
 for(const mode of [0,1,2]){
  const weld=pixelate({shape:"slab",size:5,mode,gap:1});
  const gap=pixelate({shape:"slab",size:5,mode,gap:.95});
  assert.ok(weld.geometry.surfaceFaces<gap.geometry.surfaceFaces,
    MODE_NAMES[mode]+" must remove shared full/filled boundaries");
 }
});
test("Staggered modes remain separate with Gap 1",()=>{
 for(const mode of [3,4]){
  const full=pixelate({shape:"tower",size:5,mode,gap:1});
  assert.ok(full.geometry.surfaceFaces>full.count*4);
  assert.ok(full.count>0);
 }
});
test("Colour by height interpolates Hark blue-green-yellow-orange-magenta ramp",()=>{
 assert.deepEqual(heightColor(0),[0,133/255,1]);
 const top=heightColor(1);
 assert.ok(top[0]>.8&&top[2]>.45&&top[1]<.01);
 assert.ok(heightColor(.5)[0]>.95);
});
test("World-aligned grid means separate sources occupy comparable cell IDs",()=>{
 const total=pixelate({size:5,mode:0,gap:1,shape:"all"});
 const slab=pixelate({size:5,mode:0,gap:1,shape:"slab"});
 const t=pixelate({size:5,mode:0,gap:1,shape:"tower"});
 const d=pixelate({size:5,mode:0,gap:1,shape:"dome"});
 const all=new Set(total.indices.map(x=>x.join(",")));
 for(const r of [slab,t,d])
  for(const c of r.indices)assert.ok(all.has(c.join(",")));
});
test("Excessive resolution and invalid parameters produce bounded errors",()=>{
 assert.throws(()=>pixelate({size:0}),/Pixel dimensions/);
 assert.throws(()=>pixelate({mode:7}),/Invalid pixel mode/);
 assert.throws(()=>pixelate({gap:0}),/Gap must/);
 assert.throws(()=>pixelate({size:1,mode:1,maxPixels:500}),/Too many pixels/);
});
