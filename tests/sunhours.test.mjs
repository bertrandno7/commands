import test from "node:test";
import assert from "node:assert/strict";
import {
  getScene, sunSamples, sunPosition, analyzeSunHours, rayHitsBox
} from "../demo/sunhours-engine.js";
import { SunHoursViewer } from "../demo/sunhours-viewer.js";

const BASE={lat:51.92,lon:4.48,year:2026,step:60,grid:6};

test("Rotterdam solar position is higher in summer than winter", () => {
  const summer=sunPosition(51.92,4.48,2026,6,21,13,2);
  const winter=sunPosition(51.92,4.48,2026,12,21,13,1);
  assert.ok(summer.altitude>winter.altitude);
});

test("June has more daylight than December", () => {
  const jun=sunSamples({...BASE,month:6,day:21});
  const dec=sunSamples({...BASE,month:12,day:21});
  assert.ok(jun.daylightHours>dec.daylightHours);
});

test("SunHours ray-casting produces bounded, variable facade results", async () => {
  for(const id of ["courtyard","tower","canyon"]){
    const r=await analyzeSunHours(getScene(id),{...BASE,month:6,day:21});
    assert.ok(r.metrics.cells>100,id);
    assert.ok(r.metrics.min>=0,id);
    assert.ok(r.metrics.max<=r.daylightHours+1e-7,id);
    assert.ok(r.metrics.mean>0,id);
    assert.ok(r.metrics.facadeMean<=r.daylightHours,id);
  }
});

test("A ray does not hit a solid behind its origin", () => {
  const block={x:10,y:10,w:5,d:5,h:20};
  assert.equal(rayHitsBox([0,0,4],[0,0,1],block),false);
  assert.equal(rayHitsBox([11,11,25],[0,0,-1],block),true);
});

function mockCanvas(){
  const draws=[];
  const gl = new Proxy({
    VERTEX_SHADER:35633,FRAGMENT_SHADER:35632,COMPILE_STATUS:35713,
    LINK_STATUS:35714,DEPTH_TEST:2929,CULL_FACE:2884,LEQUAL:515,
    ARRAY_BUFFER:34962,STATIC_DRAW:35044,FLOAT:5126,
    TRIANGLES:4,LINES:1,COLOR_BUFFER_BIT:16384,DEPTH_BUFFER_BIT:256,
    createShader:()=>({}),getShaderParameter:()=>true,
    createProgram:()=>({}),getProgramParameter:()=>true,
    getAttribLocation:()=>0,getUniformLocation:(_,name)=>name,
    createBuffer:()=>({}),
    enable:(flag)=>draws.push(["enable",flag]),
    bufferData:(_,data)=>draws.push(["buffer",data.length]),
    drawArrays:(mode,offset,count)=>draws.push(["draw",mode,count])
  },{
    get(target,property){
      return property in target ? target[property] : () => {};
    }
  });
  const canvas={
    width:0,height:0,clientWidth:520,clientHeight:380,
    style:{},classList:{add(){},remove(){}},
    getContext:(kind)=>kind==="webgl"?gl:null,
    addEventListener(){},setPointerCapture(){}
  };
  return {canvas,draws};
}

globalThis.window={devicePixelRatio:1,addEventListener(){}};
globalThis.ResizeObserver=class{observe(){}};

const ev=(pointerId,x,y,options={})=>({
  pointerId,clientX:x,clientY:y,pointerType:"touch",
  button:0,preventDefault(){},...options
});

test("WebGL draws real depth-tested polygons, not painted backfaces", async()=>{
  const {canvas,draws}=mockCanvas();
  const viewer=new SunHoursViewer(canvas);
  const scene=getScene("courtyard");
  const result=await analyzeSunHours(scene,{...BASE,month:6,day:21});
  viewer.setData(scene,result);
  assert.equal(canvas.style.touchAction,"none");
  assert.ok(draws.some(d=>d[0]==="enable"&&d[1]===2929),"depth test enabled");
  assert.ok(draws.some(d=>d[0]==="draw"&&d[1]===4&&d[2]>200),"heat triangles");
  assert.ok(draws.some(d=>d[0]==="draw"&&d[1]===1&&d[2]>20),"guides and edges");
});

test("Single-finger orbit, right-drag pan, pinch zoom and reset are stable",()=>{
  const {canvas}=mockCanvas();
  const viewer=new SunHoursViewer(canvas);
  viewer.setData(getScene("courtyard"),null);
  const yaw=viewer.yaw,el=viewer.elevation;

  viewer.pointerDown(ev(1,100,100));
  viewer.pointerMove(ev(1,135,80));
  viewer.pointerUp(ev(1,135,80));
  assert.notEqual(viewer.yaw,yaw);
  assert.notEqual(viewer.elevation,el);

  const originalZoom=viewer.zoom;
  viewer.pointerDown(ev(1,100,130));
  viewer.pointerDown(ev(2,200,130));
  viewer.pointerMove(ev(2,250,130));
  assert.ok(viewer.zoom>originalZoom);
  viewer.pointerUp(ev(1,100,130));
  viewer.pointerUp(ev(2,250,130));

  const target=[...viewer.target];
  const mouse={pointerType:"mouse",button:2};
  viewer.pointerDown(ev(3,120,150,mouse));
  viewer.pointerMove(ev(3,170,150,mouse));
  viewer.pointerUp(ev(3,170,150,mouse));
  assert.ok(viewer.target.some((x,i)=>Math.abs(x-target[i])>.01));

  viewer.reset();
  assert.equal(viewer.zoom,1);
  assert.equal(viewer.yaw,-.72);
});
