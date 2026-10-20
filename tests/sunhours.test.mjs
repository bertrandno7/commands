import test from "node:test";
import assert from "node:assert/strict";
import {
  getScene, sunSamples, sunPosition, analyzeSunHours, rayHitsBox
} from "../demo/sunhours-engine.js";
import { SunHoursViewer } from "../demo/sunhours-viewer.js";
import {
  quatRotate, quatNormalize, cameraAxes, freeOrbit,
  rhinoWorldOrbit, defaultCameraOrientation
} from "../demo/camera-rotation.js";

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
  return viewer.projectWorld(point).slice(0,2);
}
function targetPlanePoint(viewer,x=16,y=12){
  const cam=viewer.camera();
  return viewer.target.map((t,i)=>t+cam.right[i]*x+cam.up[i]*y);
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
  const pose=[...v.orientation],target=[...v.target];
  const mouse={pointerType:"mouse",button:2};
  v.pointerDown(ev(1,100,100,mouse));
  v.pointerMove(ev(1,155,130,mouse));
  v.pointerUp(ev(1,155,130,mouse));
  assert.notDeepEqual(v.orientation,pose,"RMB must tumble the camera");
  assert.deepEqual(v.target,target,"Normal orbit must preserve its pivot");
});

test("Perspective: Shift+RMB pans geometry in screen-drag direction",()=>{
  const {canvas}=mockCanvas();
  const v=new SunHoursViewer(canvas);
  v.setData(getScene("courtyard"),null);
  const point=targetPlanePoint(v),before=screenPosition(v,point);
  const pose=[...v.orientation];
  const mouse={pointerType:"mouse",button:2,shiftKey:true};
  v.pointerDown(ev(2,140,140,mouse));
  v.pointerMove(ev(2,220,195,mouse));
  v.pointerUp(ev(2,220,195,mouse));
  assertScreenFollows(v,point,before,80,55);
  assert.deepEqual(v.orientation,pose,"Panning must not alter camera orientation");
});

test("Perspective: MMB pans while Ctrl+RMB zooms toward pointer",()=>{
  const {canvas}=mockCanvas();
  const v=new SunHoursViewer(canvas);
  v.setData(getScene("courtyard"),null);
  const point=targetPlanePoint(v),before=screenPosition(v,point);
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

test("Top: RMB pans; Ctrl+Shift+RMB rotates while remaining parallel",()=>{
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
  assert.equal(v.projection,"parallel");
  assert.equal(v.camera().parallel,true,"Ctrl+Shift+RMB must stay orthographic");
  const pose=[...v.orientation];
  v.pointerMove(ev(6,140,150,forceRotate));
  v.pointerUp(ev(6,140,150,forceRotate));
  assert.notDeepEqual(v.orientation,pose);
  assert.equal(v.camera().parallel,true);
  const parallelPoint=targetPlanePoint(v);
  const beforeParallel=screenPosition(v,parallelPoint);
  v.pointerDown(ev(7,100,100,pan));
  v.pointerMove(ev(7,120,145,pan));
  v.pointerUp(ev(7,120,145,pan));
  assertScreenFollows(v,parallelPoint,beforeParallel,20,45);
});

test("Touch: one-finger Orbit/Pan tool and two-finger screen-following pan",()=>{
  const {canvas}=mockCanvas();
  const v=new SunHoursViewer(canvas);
  v.setData(getScene("courtyard"),null);
  const pose=[...v.orientation];
  v.pointerDown(ev(1,100,110));
  v.pointerMove(ev(1,145,110));
  v.pointerUp(ev(1,145,110));
  assert.notDeepEqual(v.orientation,pose);

  v.setTool("pan");
  const point=targetPlanePoint(v),before=screenPosition(v,point);
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
  assert.ok(Math.abs(v.zoom-z)<1e-10,"Two-finger pure translation does not zoom");

  v.pointerDown(ev(9,120,170));
  v.pointerDown(ev(10,220,170));
  v.pointerMove(ev(10,270,170));
  assert.ok(v.zoom>z);
  v.pointerUp(ev(9,120,170));
  v.pointerUp(ev(10,270,170));

  v.reset();
  assert.equal(v.zoom,1);
  assert.deepEqual(v.orientation,v.defaultOrientation);
});

test("Perspective is true depth-dependent pinhole projection",()=>{
  const {canvas}=mockCanvas();
  const v=new SunHoursViewer(canvas);
  v.setData(getScene("courtyard"),null);
  const cam=v.camera();
  assert.equal(cam.parallel,false);
  assert.ok(Math.abs(cam.focalY-35/12)<1e-10);
  const anchor=v.target;
  const world=(depth,offset=15)=>anchor.map((t,i)=>
    t+cam.forward[i]*depth+cam.right[i]*offset);
  const near=v.projectWorld(world(-30));
  const far=v.projectWorld(world(30));
  const cx=canvas.clientWidth/2;
  assert.ok(Math.abs(near[0]-cx)>Math.abs(far[0]-cx)*1.1,
    "Same object width must project larger at nearer depth");
  assert.ok(near[2]<far[2],"Camera depth must increase with distance");

  const beforeLens=v.projectWorld(world(0));
  v.setLens(50);
  const afterLens=v.projectWorld(world(0));
  assert.ok(Math.abs(afterLens[0]-cx)>Math.abs(beforeLens[0]-cx)*1.3,
    "Changing from 35mm to 50mm must tighten true perspective framing");

  v.setProjection("top");
  const c=v.camera();
  assert.equal(c.parallel,true);
  assert.deepEqual(c.right,[1,0,0],"East must appear right in Top");
  assert.deepEqual(c.up,[0,1,0],"North must appear up in Top");
  const xy=v.target;
  const p1=[xy[0]+20,xy[1]+15,0];
  const p2=[xy[0]+20,xy[1]+15,100];
  const a=v.projectWorld(p1);
  const b=v.projectWorld(p2);
  assert.ok(Math.abs(a[0]-b[0])<1e-8);
  assert.ok(Math.abs(a[1]-b[1])<1e-8,
    "Top must be parallel; height cannot change screen X/Y");
  assert.ok(a[0]>canvas.clientWidth/2,"+X moves right");
  assert.ok(a[1]<canvas.clientHeight/2,"+Y moves up");
});

test("Perspective zoom anchors its target-plane point under the cursor",()=>{
  const {canvas}=mockCanvas();
  const v=new SunHoursViewer(canvas);
  v.setData(getScene("tower"),null);
  const cam=v.camera(),pixel=[140,220],rect=canvas.getBoundingClientRect();
  const px=pixel[0]-rect.left-canvas.clientWidth/2;
  const py=pixel[1]-rect.top-canvas.clientHeight/2;
  const scale=2*cam.halfHeight/canvas.clientHeight;
  const anchor=v.target.map((t,i)=>
    t+scale*(px*cam.right[i]-py*cam.up[i]));
  const before=screenPosition(v,anchor);
  v.zoomAt(1.75,...pixel);
  assert.ok(v.zoom>1);
  const after=screenPosition(v,anchor);
  assert.ok(Math.abs(after[0]-before[0])<1e-7);
  assert.ok(Math.abs(after[1]-before[1])<1e-7);
});

function vecDot(a,b){return a.reduce((sum,v,i)=>sum+v*b[i],0);}
function vecDist(a,b){return Math.hypot(...a.map((v,i)=>v-b[i]));}
function near(a,b,tol=1e-9){return Math.abs(a-b)<tol;}

/**
 * This regression catches the exact reported bug: the old camera
 * clamped elevation to [0.08,1.50], so objects could never be viewed from
 * below. Camera-local quaternion tumbling must travel through zenith/nadir.
 */
test("Free orbit crosses both poles, goes underneath and never hits a clamp",()=>{
  const {canvas}=mockCanvas();
  const v=new SunHoursViewer(canvas);
  v.setData(getScene("courtyard"),null);
  const initial=v.camera().forward;
  let minZ=1,maxZ=-1;
  let crossedPole=false,downwardFrames=0;
  for(let i=0;i<1000;i++){
    v.orbitByScreen(0,18);
    const cam=v.camera();
    // Forward is camera -> pivot; looking downward means forward.z<0.
    minZ=Math.min(minZ,cam.forward[2]);
    maxZ=Math.max(maxZ,cam.forward[2]);
    if(cam.forward[2]>.90)crossedPole=true;
    if(cam.forward[2]<-.90)downwardFrames++;
    assert.ok(Number.isFinite(cam.right[0]));
    assert.ok(near(Math.hypot(...v.orientation),1,1e-10));
    assert.ok(near(Math.hypot(...cam.up),1,1e-10));
    assert.ok(near(vecDot(cam.right,cam.up),0,1e-10));
    assert.ok(near(vecDot(cam.right,cam.forward),0,1e-10));
  }
  assert.ok(maxZ>.95,"Can look upward from underneath the buildings");
  assert.ok(minZ<-.95,"Can look straight down from above");
  assert.ok(crossedPole&&downwardFrames>0);
  assert.ok(vecDist(v.camera().forward,initial)>.1);

});

test("Unbounded orbit supports multiple revolutions with stable orientation",()=>{
  const q0=defaultCameraOrientation();
  // 2pi for ~966.64 px at .0065rad/px. Three loops must bring the
  // camera back close to the start without accumulating Euler drift.
  const oneLoop=2*Math.PI/.0065;
  const q1=freeOrbit(q0,oneLoop,0);
  const q3=freeOrbit(q0,oneLoop*3,0);
  const a=cameraAxes(q0),b=cameraAxes(q1),c=cameraAxes(q3);
  assert.ok(vecDist(a.forward,b.forward)<1e-8);
  assert.ok(vecDist(a.up,b.up)<1e-8);
  assert.ok(vecDist(a.forward,c.forward)<1e-8);
  assert.ok(vecDist(a.right,c.right)<1e-8);

  // Near a pole, sideways orbit should still respond smoothly.
  const up=q0;
  const pole=freeOrbit(up,0,(Math.PI/2)/.0065);
  const sideways=freeOrbit(pole,80,0);
  assert.ok(vecDist(cameraAxes(pole).forward,cameraAxes(sideways).forward)>.01);
});

test("Alt+RMB rolls view around its optical axis, without losing view direction",()=>{
  const {canvas}=mockCanvas();
  const v=new SunHoursViewer(canvas);
  v.setData(getScene("courtyard"),null);
  const before=v.camera();
  const roll={pointerType:"mouse",button:2,altKey:true};
  v.pointerDown(ev(22,180,155,roll));
  v.pointerMove(ev(22,330,155,roll));
  v.pointerUp(ev(22,330,155,roll));
  const after=v.camera();
  assert.ok(vecDist(before.forward,after.forward)<1e-8,"Rolling should not change viewing direction");
  assert.ok(vecDist(before.up,after.up)>.1,"Horizon should visibly roll");
});

test("Top view orientation restores correctly after leaving and returning",()=>{
  const {canvas}=mockCanvas();
  const v=new SunHoursViewer(canvas);
  v.setData(getScene("tower"),null);
  v.orbitByScreen(130,80);
  const pose=[...v.orientation];
  v.setProjection("top");
  assert.deepEqual(v.camera().up,[0,1,0]);
  v.setProjection("perspective");
  assert.ok(vecDist(v.orientation,pose)<1e-10,"Restore prior free camera view");
});

test("Ctrl+Shift+RMB picks a building and preserves it under the pointer",()=>{
  const {canvas}=mockCanvas();
  const v=new SunHoursViewer(canvas);
  v.setData(getScene("courtyard"),null);
  const buildingPoint=[20,35,24];
  const screen=v.projectWorld(buildingPoint);
  const rect=canvas.getBoundingClientRect();
  const clientX=screen[0]+rect.left,clientY=screen[1]+rect.top;
  const pivot=v.pickOrbitPivot(clientX,clientY);
  assert.ok(pivot&&pivot.every(Number.isFinite),
    "Ray from cursor should intersect site geometry");
  const before=v.projectWorld(pivot);
  const target=[...v.target];

  const mouse={pointerType:"mouse",button:2,ctrlKey:true,shiftKey:true};
  v.pointerDown(ev(25,clientX,clientY,mouse));
  const state=v.pointers.get(25);
  assert.equal(state.mode,"orbit-object");
  assert.ok(state.pivot);
  v.pointerMove(ev(25,clientX+128,clientY+68,mouse));
  v.pointerUp(ev(25,clientX+128,clientY+68,mouse));
  const after=v.projectWorld(pivot);
  assert.ok(near(after[0],before[0],1e-6));
  assert.ok(near(after[1],before[1],1e-6),
    "Building point must stay at the original mouse pixel");
  assert.ok(vecDist(v.target,target)>1,
    "Orbiting around a picked point changes the target as the camera moves");
});

test("Normal RMB orbit still uses the scene pivot without target drift",()=>{
  const {canvas}=mockCanvas();
  const v=new SunHoursViewer(canvas);
  v.setData(getScene("tower"),null);
  const target=[...v.target];
  for(let i=0;i<300;i++)v.orbitByScreen(6,4);
  assert.deepEqual(v.target,target);
});

test("Rhino world-axis orbit prevents unintended camera roll on diagonal drags",()=>{
  const initial=defaultCameraOrientation();
  let q=initial;
  for(let i=0;i<1000;i++){
    q=rhinoWorldOrbit(q,3,4);
    const axes=cameraAxes(q);
    // Right vector stays parallel to the world XY plane, even when upside
    // down. The previous camera-local trackball drifted into sideways roll.
    assert.ok(Math.abs(axes.right[2])<1e-9,"Rhino orbit maintains world-horizontal screen right");
    assert.ok(Math.abs(Math.hypot(...q)-1)<1e-10);
  }
});

test("Rhino orbit drag-back restores the exact same camera orientation",()=>{
  let q=defaultCameraOrientation();
  const start=cameraAxes(q);
  for(let i=0;i<200;i++)q=rhinoWorldOrbit(q,3.5,2.7);
  for(let i=0;i<200;i++)q=rhinoWorldOrbit(q,-3.5,-2.7);
  const end=cameraAxes(q);
  assert.ok(vecDist(start.up,end.up)<1e-8);
  assert.ok(vecDist(start.right,end.right)<1e-8);
  assert.ok(vecDist(start.forward,end.forward)<1e-8);
});

test("Rhino orbit sensitivity is controlled and anomalous mouse spikes limited",()=>{
  const q=defaultCameraOrientation();
  const before=cameraAxes(q);
  const hundred=cameraAxes(rhinoWorldOrbit(q,100,0));
  const angle=Math.acos(Math.max(-1,Math.min(1,vecDot(before.right,hundred.right))));
  assert.ok(angle>=.29&&angle<=.31,"100px right-drag turns approx 17 degrees");
  const jumped=cameraAxes(rhinoWorldOrbit(q,10000,0));
  const safe=Math.acos(Math.max(-1,Math.min(1,vecDot(before.right,jumped.right))));
  assert.ok(safe<.38,"A browser 10,000px pointer spike cannot spin several revolutions");
});
