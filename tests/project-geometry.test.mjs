import test from "node:test";
import assert from "node:assert/strict";
import {
  parseGeometryBlob,
  projectToViewerScene,
  supportedGeometryFile
} from "../public/demo/project-geometry.js";
import {
  analyzeProjectSunHours,
  createWindGridFromProject
} from "../public/demo/project-analysis.js";

function cubeObj(size=10){
  return [
    "v 0 0 0",
    "v "+size+" 0 0",
    "v "+size+" "+size+" 0",
    "v 0 "+size+" 0",
    "v 0 0 "+size,
    "v "+size+" 0 "+size,
    "v "+size+" "+size+" "+size,
    "v 0 "+size+" "+size,
    "f 1 4 3 2",
    "f 5 6 7 8",
    "f 1 2 6 5",
    "f 2 3 7 6",
    "f 3 4 8 7",
    "f 4 1 5 8"
  ].join("\n");
}

function binaryStlTriangle(){
  const buffer=new ArrayBuffer(84+50);
  const view=new DataView(buffer);
  view.setUint32(80,1,true);
  let o=84+12;
  for(const p of [[0,0,0],[1,0,0],[0,1,0]]){
    view.setFloat32(o,p[0],true);
    view.setFloat32(o+4,p[1],true);
    view.setFloat32(o+8,p[2],true);
    o+=12;
  }
  return buffer;
}

function minimalGlb(){
  const positions=new Float32Array([
    0,0,0,
    2,0,0,
    0,2,0
  ]);
  const bin=new Uint8Array(positions.buffer);
  const json={
    asset:{version:"2.0"},
    buffers:[{byteLength:bin.byteLength}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:bin.byteLength}],
    accessors:[{
      bufferView:0,byteOffset:0,componentType:5126,
      count:3,type:"VEC3",min:[0,0,0],max:[2,2,0]
    }],
    meshes:[{primitives:[{attributes:{POSITION:0},mode:4}]}],
    nodes:[{mesh:0}],
    scenes:[{nodes:[0]}],
    scene:0
  };
  const enc=new TextEncoder();
  let jsonBytes=enc.encode(JSON.stringify(json));
  const jsonPad=(4-jsonBytes.length%4)%4;
  const paddedJson=new Uint8Array(jsonBytes.length+jsonPad);
  paddedJson.set(jsonBytes);
  paddedJson.fill(0x20,jsonBytes.length);
  const binPad=(4-bin.length%4)%4;
  const paddedBin=new Uint8Array(bin.length+binPad);
  paddedBin.set(bin);
  const total=12+8+paddedJson.length+8+paddedBin.length;
  const out=new ArrayBuffer(total);
  const view=new DataView(out);
  view.setUint32(0,0x46546c67,true);
  view.setUint32(4,2,true);
  view.setUint32(8,total,true);
  let offset=12;
  view.setUint32(offset,paddedJson.length,true);
  view.setUint32(offset+4,0x4E4F534A,true);
  new Uint8Array(out,offset+8,paddedJson.length).set(paddedJson);
  offset+=8+paddedJson.length;
  view.setUint32(offset,paddedBin.length,true);
  view.setUint32(offset+4,0x004E4942,true);
  new Uint8Array(out,offset+8,paddedBin.length).set(paddedBin);
  return out;
}

test("shared project importer accepts OBJ STL and GLB",()=>{
  assert.equal(supportedGeometryFile("tower.obj"),true);
  assert.equal(supportedGeometryFile("site.STL"),true);
  assert.equal(supportedGeometryFile("massing.glb"),true);
  assert.equal(supportedGeometryFile("drawing.3dm"),false);
});

test("OBJ parser triangulates closed architectural massing and applies units",async()=>{
  const parsed=await parseGeometryBlob(
    new Blob([cubeObj(10000)]),
    "tower.obj",
    {units:"mm"}
  );
  assert.equal(parsed.triangleCount,12);
  assert.deepEqual(parsed.bounds.min.map(v=>Math.round(v*1000)/1000),[0,0,0]);
  assert.deepEqual(parsed.bounds.max.map(v=>Math.round(v*1000)/1000),[10,10,10]);
});

test("binary STL and uncompressed GLB parse into the same project contract",async()=>{
  const stl=await parseGeometryBlob(new Blob([binaryStlTriangle()]),"one.stl");
  assert.equal(stl.triangleCount,1);
  assert.deepEqual(stl.bounds.max,[1,1,0]);

  const glb=await parseGeometryBlob(new Blob([minimalGlb()]),"one.glb");
  assert.equal(glb.triangleCount,1);
  assert.deepEqual(glb.bounds.max,[2,2,0]);
});

test("one imported cube feeds both SunHours and WindScreen adapters",async()=>{
  const parsed=await parseGeometryBlob(new Blob([cubeObj(10)]),"cube.obj");
  const project={
    name:"Shared cube",
    triangleCount:parsed.triangleCount,
    analysis:parsed,
    context:{
      positions:new Float32Array(0),
      triangleCount:0,
      bounds:null
    },
    bounds:parsed.bounds,
    files:[]
  };

  const scene=projectToViewerScene(project);
  assert.equal(scene.kind,"project");
  assert.equal(scene.meshPositions.length,parsed.positions.length);
  assert.ok(scene.ground.w>10&&scene.ground.d>10);

  let lastProgress=0;
  const sun=await analyzeProjectSunHours(project,{
    lat:51.92,lon:4.48,year:2026,month:6,day:21,
    step:60,grid:5
  },value=>{lastProgress=value;});
  assert.ok(sun.metrics.cells>=12);
  assert.ok(sun.metrics.max>0);
  assert.ok(sun.metrics.max<=sun.daylightHours+1e-6);
  assert.ok(sun.metrics.roofMean>0);
  assert.ok(lastProgress>.99);

  const wind=createWindGridFromProject(project,{
    windFrom:270,cell:2,height:1.5
  });
  assert.ok(wind.nx>8&&wind.ny>8);
  assert.ok(wind.solid.some(Boolean));
  assert.ok(wind.area>20);
  assert.equal(wind.project,true);
  assert.equal(wind.slice,1.5);
});

test("WindScreen rejects geometry with no closed section at pedestrian height",async()=>{
  const glb=await parseGeometryBlob(new Blob([minimalGlb()]),"plane.glb");
  const project={
    name:"Open plane",
    analysis:glb,
    context:{positions:new Float32Array(0),triangleCount:0,bounds:null},
    bounds:glb.bounds
  };
  assert.throws(
    ()=>createWindGridFromProject(project,{cell:2,height:1.5}),
    /closed building section|closed WindScreen obstacle/
  );
});
