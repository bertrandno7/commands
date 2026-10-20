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
    getBoundingClientRect(){return {left:12,top:20,width:520,height:380};},
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


function screenPosition(viewer,point){
  const cam=viewer.camera();
  const p=point.map((n,i)=>n-viewer.target[i]);
  const scale=viewer.canvas.clientHeight/(2*cam.halfHeight);
  const dot=(a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
  return [
    viewer.canvas.clientWidth/2+dot(p,cam.right)*scale,
    viewer.canvas.clientHeight/2-dot(p,cam.up)*scale
  ];
}
function assertScreenFollows(viewer,point,before,dx,dy){
  const after=screenPosition(viewer,point);
  assert.ok(Math.abs(after[0]-before[0]-dx)<1e-7,
    "Panning right must move the model right by exactly "+dx+"px");
  assert.ok(Math.abs(after[1]-before[1]-dy)<1e-7,
    "Panning down must move the model down by exactly "+dy+"px");
}

test("Perspective: RMB orbits without panning (Rhino default)",()=>{
  const {canvas}=mockCanvas();
  const v=new SunHoursViewer(canvas);
  v.setData(getScene("courtyard"),null);
  const yaw=v.yaw,elevation=v.elevation,target=[...v.target];
  const mouse={pointerType:"mouse",button:2};
  v.pointerDown(ev(1,100,100,mouse));
  v.pointerMove(ev(1,155,130,mouse));
  v.pointerUp(ev(1,155,130,mouse));
  assert.notEqual(v.yaw,yaw);
  assert.notEqual(v.elevation,elevation);
  assert.deepEqual(v.target,target);
});

test("Perspective: Shift+RMB pans geometry in screen-drag direction",()=>{
  const {canvas}=mockCanvas();
  const v=new SunHoursViewer(canvas);
  v.setData(getScene("courtyard"),null);
  const point=[12,22,30],before=screenPosition(v,point);
  const yaw=v.yaw,elevation=v.elevation;
  const mouse={pointerType:"mouse",button:2,shiftKey:true};
  v.pointerDown(ev(2,140,140,mouse));
  v.pointerMove(ev(2,220,195,mouse));
  v.pointerUp(ev(2,220,195,mouse));
  assertScreenFollows(v,point,before,80,55);
  assert.equal(v.yaw,yaw);
  assert.equal(v.elevation,elevation);
});

test("Perspective: MMB pans while Ctrl+RMB zooms toward pointer",()=>{
  const {canvas}=mockCanvas();
  const v=new SunHoursViewer(canvas);
  v.setData(getScene("courtyard"),null);
  const point=[-9,15,0],before=screenPosition(v,point);
  const middle={pointerType:"mouse",button:1};
  v.pointerDown(ev(3,100,100,middle));
  v.pointerMove(ev(3,135,125,middle));
  v.pointerUp(ev(3,135,125,middle));
  assertScreenFollows(v,point,before,35,25);

  // An arbitrary point on the view plane under the mouse should remain pinned
  // when zooming to cursor, just like Rhino wheel zoom.
  const anchorScreen=[210,170]; // client coordinates
  const origin=[...v.target],cam=v.camera();
  const scale=2*cam.halfHeight/canvas.clientHeight;
  const sx=anchorScreen[0]-12-canvas.clientWidth/2;
  const sy=anchorScreen[1]-20-canvas.clientHeight/2;
  const anchor=origin.map((t,i)=>t+scale*(sx*cam.right[i]-sy*cam.up[i]));
  const expected=screenPosition(v,anchor);
  const old=v.zoom;
  const mouse={pointerType:"mouse",button:2,ctrlKey:true};
  v.pointerDown(ev(4,...anchorScreen,mouse));
  v.pointerMove(ev(4,anchorScreen[0],anchorScreen[1]-70,mouse));
  v.pointerUp(ev(4,anchorScreen[0],anchorScreen[1]-70,mouse));
  assert.ok(v.zoom>old);
  const after=screenPosition(v,anchor);
  assert.ok(Math.abs(after[0]-expected[0])<1e-7);
  assert.ok(Math.abs(after[1]-expected[1])<1e-7);
});

test("Top view: RMB pans; Ctrl+Shift+RMB breaks into Perspective orbit",()=>{
  const {canvas}=mockCanvas();
  const v=new SunHoursViewer(canvas);
  v.setData(getScene("tower"),null);
  v.setProjection("top");
  assert.equal(v.projection,"top");
  const before=screenPosition(v,[18,12,0]);
  const pan={pointerType:"mouse",button:2};
  v.pointerDown(ev(5,120,130,pan));
  v.pointerMove(ev(5,180,100,pan));
  v.pointerUp(ev(5,180,100,pan));
  assertScreenFollows(v,[18,12,0],before,60,-30);
  const forceRotate={pointerType:"mouse",button:2,ctrlKey:true,shiftKey:true};
  v.pointerDown(ev(6,110,150,forceRotate));
  assert.equal(v.projection,"perspective");
  const yaw=v.yaw;
  v.pointerMove(ev(6,140,150,forceRotate));
  v.pointerUp(ev(6,140,150,forceRotate));
  assert.notEqual(v.yaw,yaw);
});

test("Touch: one-finger Orbit/Pan tool and two-finger screen-following pan",()=>{
  const {canvas}=mockCanvas();
  const v=new SunHoursViewer(canvas);
  v.setData(getScene("courtyard"),null);
  const yaw=v.yaw;
  v.pointerDown(ev(1,100,110));
  v.pointerMove(ev(1,145,110));
  v.pointerUp(ev(1,145,110));
  assert.notEqual(v.yaw,yaw);

  v.setTool("pan");
  const point=[20,20,16],before=screenPosition(v,point);
  v.pointerDown(ev(2,100,100));
  v.pointerMove(ev(2,180,140));
  v.pointerUp(ev(2,180,140));
  assertScreenFollows(v,point,before,80,40);

  v.setTool("orbit");
  const again=screenPosition(v,point);
  const z=v.zoom;
  v.pointerDown(ev(7,100,170));
  v.pointerDown(ev(8,200,170));
  v.pointerMove(ev(7,120,190));
  v.pointerMove(ev(8,220,190));
  v.pointerUp(ev(7,120,190));
  v.pointerUp(ev(8,220,190));
  assertScreenFollows(v,point,again,20,20);
  assert.equal(v.zoom,z);

  v.pointerDown(ev(9,120,170));
  v.pointerDown(ev(10,220,170));
  v.pointerMove(ev(10,270,170));
  assert.ok(v.zoom>z);
  v.pointerUp(ev(9,120,170));
  v.pointerUp(ev(10,270,170));

  v.reset();
  assert.equal(v.zoom,1);
  assert.equal(v.yaw,-0.72);
});
