/**
 * COMMANDS / SunHours WebGL viewer.
 *
 * Native WebGL 1 with real GPU depth testing. No CDN or framework required.
 * Perspective uses an actual pinhole projection (depth-dependent 1/w scaling).
 * Rhino Top uses a separate parallel projection with north consistently up.
 * Default Rhino-style orbit: yaw around fixed world Z, pitch around camera
 * right. It is slower, predictable and never introduces accidental roll;
 * vertical rotation can still pass both poles without artificial clamping.
 * Rhino-inspired desktop navigation (Perspective):
 *   RMB orbit, Shift+RMB pan, Ctrl+RMB / wheel zoom, MMB pan.
 * Top view: RMB pan, Ctrl+Shift+RMB rotates as a parallel view.
 * Left-drag uses the selected web-demo tool (Orbit or Pan).
 * Touch: one-finger Orbit/Pan tool; two-finger screen-following pan + pinch.
 * Pan moves geometry in the exact screen-space direction of the pointer.
 * Camera always orbits around the visible scene.
 */
import { hoursColor } from "./sunhours-engine.js?v=3";
import {
  defaultCameraOrientation, cameraAxes, rhinoWorldOrbit, rollView,
  quatMultiply, quatConjugate, quatRotate
} from "./camera-rotation.js?v=3";

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const dot = (a,b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const sub = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross = (a,b) => [
  a[1]*b[2]-a[2]*b[1],
  a[2]*b[0]-a[0]*b[2],
  a[0]*b[1]-a[1]*b[0]
];
function normalized(a) {
  const k = Math.hypot(...a) || 1;
  return a.map(x => x/k);
}
const avg = (a,b) => [(a[0]+b[0])/2,(a[1]+b[1])/2];
const distance2 = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);

function addQuad(out, vertices, rgb, offset = [0,0,0]) {
  const shifted = vertices.map(p => [
    p[0]+offset[0],p[1]+offset[1],p[2]+offset[2]
  ]);
  for (const i of [0,1,2,0,2,3]) {
    const p = shifted[i];
    out.push(p[0],p[1],p[2],...rgb);
  }
}
function addLine(out, a, b, rgb) {
  out.push(...a,...rgb,...b,...rgb);
}
function buildMeshes(scene, result) {
  const base=[], heat=[], outlines=[], guides=[];
  const g=scene.ground;
  addQuad(base,[
    [g.x,g.y,-0.04],[g.x+g.w,g.y,-0.04],
    [g.x+g.w,g.y+g.d,-0.04],[g.x,g.y+g.d,-0.04]
  ],[0.89,0.915,0.895]);

  const face = (v,c) => addQuad(base,v,c);
  for (const b of scene.buildings) {
    const x=b.x,y=b.y,w=b.w,d=b.d,z=b.h;
    const a=[x,y,0], bb=[x+w,y,0], c=[x+w,y+d,0], d0=[x,y+d,0];
    const aa=[x,y,z], ab=[x+w,y,z], ac=[x+w,y+d,z], ad=[x,y+d,z];
    face([aa,ab,ac,ad],[.91,.93,.91]);
    face([a,bb,ab,aa],[.75,.80,.77]);
    face([bb,c,ac,ab],[.81,.85,.82]);
    face([c,d0,ad,ac],[.67,.74,.70]);
    face([d0,a,aa,ad],[.73,.79,.75]);
    const edgeColor=[.37,.44,.40];
    const top=[aa,ab,ac,ad],bot=[a,bb,c,d0];
    for(let i=0;i<4;i++) {
      addLine(outlines,top[i],top[(i+1)%4],edgeColor);
      addLine(outlines,bot[i],bot[(i+1)%4],edgeColor);
      addLine(outlines,bot[i],top[i],edgeColor);
    }
  }

  const gLine=[.80,.84,.80];
  const firstX=Math.ceil(g.x/10)*10, firstY=Math.ceil(g.y/10)*10;
  for(let x=firstX; x<=g.x+g.w;x+=10)
    addLine(guides,[x,g.y,.07],[x,g.y+g.d,.07],gLine);
  for(let y=firstY;y<=g.y+g.d;y+=10)
    addLine(guides,[g.x,y,.07],[g.x+g.w,y,.07],gLine);
  addLine(guides,[g.x,g.y,.08],[g.x+g.w,g.y,.08],[.51,.57,.52]);
  addLine(guides,[g.x,g.y,.08],[g.x,g.y+g.d,.08],[.51,.57,.52]);

  if(result) {
    const max = result.daylightHours;
    for(const c of result.cells) {
      const col=typeof result.colorFor==="function"
        ?result.colorFor(c.hours):hoursColor(c.hours,max);
      const shade=c.normal[2]>.5?1:(c.normal[0]?0.88:0.94);
      const rgb=col.map(v => v/255*shade);
      // Offset out from the solid to avoid Z fighting with its reference face.
      const offset=c.normal.map(n=>n*0.055);
      addQuad(heat,c.corners,rgb,offset);
    }
  }
  return {base,heat,outlines,guides};
}

function compile(gl,type,src) {
  const sh=gl.createShader(type);
  gl.shaderSource(sh,src);
  gl.compileShader(sh);
  if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){
    const why=gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("WebGL shader: "+why);
  }
  return sh;
}

const VERTEX = `
  attribute vec3 aPosition;
  attribute vec3 aColor;
  uniform vec3 uTarget;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform vec3 uForward;
  uniform vec3 uClip; // parallel viewport: half width, half height, half depth
  uniform float uPerspective; // 1.0 for Perspective, 0.0 for Top/Parallel
  uniform float uCameraDistance;
  uniform float uFocalY; // cot(vertical fov / 2)
  uniform float uAspect;
  uniform vec2 uNearFar;
  varying vec3 vColor;
  void main() {
    vec3 p = aPosition - uTarget;
    float px = dot(p,uRight);
    float py = dot(p,uUp);
    float pz = dot(p,uForward);
    if (uPerspective > 0.5) {
      // True perspective: a model point twice as far from the camera
      // produces half the on-screen size. Clip.w varies with depth.
      float depth = uCameraDistance + pz;
      float n = uNearFar.x;
      float f = uNearFar.y;
      float clipZ = (f+n)/(f-n)*depth - 2.0*f*n/(f-n);
      gl_Position = vec4(
        px*uFocalY/uAspect,
        py*uFocalY,
        clipZ,
        depth
      );
    } else {
      // Top is true parallel/orthographic. A zero-Z camera frame is
      // explicitly provided by the JS camera function.
      gl_Position = vec4(px/uClip.x,py/uClip.y,pz/uClip.z,1.0);
    }
    vColor = aColor;
  }
`;
const FRAGMENT = `
  precision mediump float;
  varying vec3 vColor;
  void main() { gl_FragColor = vec4(vColor,1.0); }
`;

export class SunHoursViewer {
  constructor(canvas) {
    this.canvas=canvas;
    this.scene=null;
    this.result=null;
    this.defaultOrientation=defaultCameraOrientation();
    this.orientation=[...this.defaultOrientation];
    this.savedNonTopOrientation=[...this.defaultOrientation];
    this.zoom=1;
    this.target=[0,0,12];
    this.baseHalfHeight=60;
    this.baseDistance=175;
    this.lensMm=35; // architectural 35mm lens, changeable in UI
    this.pointers=new Map();
    this.gl=canvas.getContext("webgl",{
      antialias:true,alpha:false,depth:true,preserveDrawingBuffer:true,
      powerPreference:"default"
    });
    this.buffers={};
    this.webglAvailable=!!this.gl;
    this.projection="perspective";
    this.activeTool="orbit";
    this.onProjectionChange=null;
    this.onDraw=null;
    this.init();
  }

  init(){
    if(this.gl){
      const gl=this.gl;
      const program=gl.createProgram();
      const vs=compile(gl,gl.VERTEX_SHADER,VERTEX);
      const fs=compile(gl,gl.FRAGMENT_SHADER,FRAGMENT);
      gl.attachShader(program,vs);gl.attachShader(program,fs);
      gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))
        throw new Error("WebGL link: "+gl.getProgramInfoLog(program));
      gl.deleteShader(vs);gl.deleteShader(fs);
      this.program=program;
      this.attribs={
        pos:gl.getAttribLocation(program,"aPosition"),
        color:gl.getAttribLocation(program,"aColor")
      };
      this.uniforms={
        target:gl.getUniformLocation(program,"uTarget"),
        right:gl.getUniformLocation(program,"uRight"),
        up:gl.getUniformLocation(program,"uUp"),
        forward:gl.getUniformLocation(program,"uForward"),
        clip:gl.getUniformLocation(program,"uClip"),
        perspective:gl.getUniformLocation(program,"uPerspective"),
        distance:gl.getUniformLocation(program,"uCameraDistance"),
        focalY:gl.getUniformLocation(program,"uFocalY"),
        aspect:gl.getUniformLocation(program,"uAspect"),
        nearFar:gl.getUniformLocation(program,"uNearFar")
      };
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
      gl.clearColor(.935,.95,.94,1);
    }
    // touch-action must be none BEFORE pointerdown to prevent scroll stealing.
    this.canvas.style.touchAction="none";
    this.canvas.addEventListener("pointerdown",e=>this.pointerDown(e));
    this.canvas.addEventListener("pointermove",e=>this.pointerMove(e));
    this.canvas.addEventListener("pointerup",e=>this.pointerUp(e));
    this.canvas.addEventListener("pointercancel",e=>this.pointerUp(e));
    this.canvas.addEventListener("lostpointercapture",e=>this.pointerUp(e));
    this.canvas.addEventListener("contextmenu",e=>e.preventDefault());
    this.canvas.addEventListener("wheel",e=>{
      e.preventDefault();
      const multiplier=e.deltaMode===1?16:e.deltaMode===2?this.canvas.clientHeight:1;
      // Rhino-like wheel zoom, anchored at the pointer rather than scene center.
      this.zoomAt(Math.exp(-e.deltaY*multiplier*.0012),e.clientX,e.clientY);
      this.draw();
    },{passive:false});
    this.canvas.addEventListener("dblclick",()=>this.reset());
    if(typeof ResizeObserver!=="undefined")
      this.observer=new ResizeObserver(()=>this.draw());
    this.observer?.observe(this.canvas);
    window.addEventListener("resize",()=>this.draw(),{passive:true});
  }

  reset(){
    this.orientation=this.projection==="top"?
      [0,0,0,1]:[...this.defaultOrientation];
    this.zoom=1;
    if(this.scene){
      const g=this.scene.ground;
      const h=Math.max(1,...this.scene.buildings.map(b=>b.h));
      this.target=[g.x+g.w/2,g.y+g.d/2,h*.28];
      this.baseHalfHeight=Math.max(22,Math.hypot(g.w,g.d,h)*.66);
      // Fit at 35 mm. Lens changes now really change the field of view
      // rather than silently dollying the camera to fake the same framing.
      this.baseDistance=this.baseHalfHeight/(12/35);
    }
    this.draw();
  }

  setData(scene,result){
    const changed=scene!==this.scene;
    this.scene=scene;
    this.result=result;
    if(changed)this.reset();
    if(this.gl)this.uploadMeshes(buildMeshes(scene,result));
    this.draw();
  }

  uploadMeshes(meshes){
    const gl=this.gl;
    for(const [name,arr] of Object.entries(meshes)){
      const prev=this.buffers[name];
      if(prev)gl.deleteBuffer(prev.buffer);
      const buffer=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(arr),gl.STATIC_DRAW);
      this.buffers[name]={buffer,count:arr.length/6};
    }
  }

  camera(){
    const parallel=this.projection!=="perspective";
    // The camera's three axes remain orthonormal at every orientation,
    // including upside down and exactly over either pole.
    const axes=this.projection==="top"
      ?{right:[1,0,0],up:[0,1,0],forward:[0,0,-1]}
      :cameraAxes(this.orientation);
    const {forward,right,up}=axes;
    const aspect=Math.max(.2,this.canvas.clientWidth/Math.max(1,this.canvas.clientHeight));
    const tanHalf=12/this.lensMm; // 35mm-camera vertical sensor size: 24 mm
    const distance=this.baseDistance/this.zoom;
    const h=parallel?this.baseHalfHeight/this.zoom:distance*tanHalf;
    const near=Math.max(0.03,distance*.001);
    const far=Math.max(1000,distance+this.baseHalfHeight*12);
    return {
      right,up,forward,aspect,
      halfHeight:h,halfWidth:h*aspect,depthHalf:this.baseHalfHeight*3.4,
      distance,tanHalf,focalY:1/tanHalf,near,far,parallel
    };
  }

  /** Verifiable screen projection. Used by tests and later object picking. */
  projectWorld(point){
    const cam=this.camera();
    const p=sub(point,this.target);
    const px=dot(p,cam.right),py=dot(p,cam.up);
    const depth=cam.distance+dot(p,cam.forward);
    if(!cam.parallel&&depth<=cam.near)return null;
    const scale=cam.parallel
      ?this.canvas.clientHeight/(2*cam.halfHeight)
      :this.canvas.clientHeight*cam.focalY/(2*depth);
    return [
      this.canvas.clientWidth*.5+px*scale,
      this.canvas.clientHeight*.5-py*scale,
      depth
    ];
  }

  /** Changing focal length adjusts field of view, not geometry or the camera target. */
  setLens(value){
    const lens=Number(value);
    if(![24,35,50].includes(lens))throw new Error("Unsupported lens.");
    this.lensMm=lens;
    this.draw();
  }

  /** Sets the web-demo's single-pointer tool. RMB remains Rhino-standard. */
  setTool(mode){
    if(!["orbit","pan"].includes(mode))throw new Error("Unknown navigation tool.");
    this.activeTool=mode;
  }

  /** Rhino: right-drag orbits Perspective and pans Top. */
  setProjection(mode){
    if(!["perspective","parallel","top"].includes(mode))throw new Error("Unknown view.");
    if(this.projection===mode)return;
    if(mode==="top"){
      this.savedNonTopOrientation=[...this.orientation];
      this.orientation=[0,0,0,1];
    }else if(this.projection==="top"){
      this.orientation=[...this.savedNonTopOrientation];
    }
    this.projection=mode;
    this.draw();
    if(typeof this.onProjectionChange==="function")this.onProjectionChange(mode);
  }

  /**
   * Free orbit around a pivot. If the pivot was picked on a face under the
   * pointer (Ctrl+Shift+RMB), preserve its exact screen position throughout
   * the rotation rather than snapping the model into the viewport center.
   */
  orbitByScreen(dx,dy,pivot=null){
    if(this.projection==="top")return;
    const previous=[...this.orientation];
    const next=rhinoWorldOrbit(previous,dx,dy);

    if(pivot){
      const cam=this.camera();
      const eye=this.target.map((t,i)=>t-cam.forward[i]*cam.distance);
      const delta=quatMultiply(next,quatConjugate(previous));
      const rotated=quatRotate(delta,sub(eye,pivot));
      const newEye=pivot.map((p,i)=>p+rotated[i]);
      const newBack=cameraAxes(next).back;
      this.target=newEye.map((p,i)=>p-newBack[i]*cam.distance);
    }
    this.orientation=next;
  }

  /**
   * Pick the nearest visible building face (or ground plane) beneath the
   * pointer. Scene consists of axis-aligned blocks, so we can intersect
   * analytically instead of requiring a second WebGL picking render pass.
   */
  pickOrbitPivot(clientX,clientY){
    if(!this.scene)return null;
    const cam=this.camera();
    const rect=this.canvas.getBoundingClientRect?.()||{
      left:0,top:0,width:this.canvas.clientWidth,height:this.canvas.clientHeight
    };
    const width=Math.max(1,this.canvas.clientWidth);
    const height=Math.max(1,this.canvas.clientHeight);
    const x=(clientX-rect.left-width/2)*2/height;
    const y=(height/2-(clientY-rect.top))*2/height;
    const origin=this.target.map((v,i)=>v-cam.forward[i]*cam.distance);
    let rayOrigin,rayDirection;
    if(cam.parallel){
      rayOrigin=origin.map((v,i)=>
        v+(x*cam.halfHeight)*cam.right[i]+(y*cam.halfHeight)*cam.up[i]);
      rayDirection=[...cam.forward];
    }else{
      const dir=cam.forward.map((v,i)=>v+
        x/cam.focalY*cam.right[i]+y/cam.focalY*cam.up[i]);
      const mag=Math.hypot(...dir);
      rayDirection=dir.map(v=>v/mag);
      rayOrigin=origin;
    }
    let best=Infinity;
    for(const b of this.scene.buildings){
      const low=[b.x,b.y,0],high=[b.x+b.w,b.y+b.d,b.h];
      let tmin=-Infinity,tmax=Infinity,valid=true;
      for(let i=0;i<3;i++){
        const d=rayDirection[i],p=rayOrigin[i];
        if(Math.abs(d)<1e-12){
          if(p<low[i]||p>high[i]){valid=false;break;}
          continue;
        }
        let ta=(low[i]-p)/d,tb=(high[i]-p)/d;
        if(ta>tb)[ta,tb]=[tb,ta];
        tmin=Math.max(tmin,ta);
        tmax=Math.min(tmax,tb);
        if(tmax<tmin){valid=false;break;}
      }
      if(valid){
        const t=tmin>1e-4?tmin:tmax>1e-4?tmax:null;
        if(t!==null&&t<best)best=t;
      }
    }
    // Ground is a plane, rather than a thick solid.
    if(Math.abs(rayDirection[2])>1e-9){
      const t=-rayOrigin[2]/rayDirection[2];
      if(t>1e-4&&t<best){
        const gx=rayOrigin[0]+rayDirection[0]*t;
        const gy=rayOrigin[1]+rayDirection[1]*t;
        const g=this.scene.ground;
        if(gx>=g.x&&gx<=g.x+g.w&&gy>=g.y&&gy<=g.y+g.d)
          best=t;
      }
    }
    if(!Number.isFinite(best))return null;
    return rayOrigin.map((v,i)=>v+best*rayDirection[i]);
  }

  /** Deliberate camera roll: Shift+Alt+right drag (Rhino TiltView). */
  rollByScreen(dx){
    if(this.projection==="top")return;
    this.orientation=rollView(this.orientation,dx);
  }

  /**
   * Screen-space pan: the geometry stays UNDER the pointer.
   *
   * Since WebGL Y points up but pointer Y points down, the target shift is
   * -dx * camera.right + dy * camera.up. This is intentionally NOT the
   * camera's perceived direction of travel; Rhino pans the scene.
   */
  panByScreen(dx,dy){
    const cam=this.camera();
    const worldPerPixel=2*cam.halfHeight/Math.max(1,this.canvas.clientHeight);
    for(let i=0;i<3;i++){
      this.target[i]+=worldPerPixel*(-dx*cam.right[i]+dy*cam.up[i]);
    }
  }

  /**
   * Zoom around the cursor/gesture midpoint. Without adjusting the camera
   * target here, pinch and wheel zoom appear to drag the model backwards.
   */
  zoomAt(factor,clientX,clientY){
    if(!(factor>0)||!Number.isFinite(factor))return;
    const oldZoom=this.zoom;
    const nextZoom=clamp(oldZoom*factor,.45,5);
    if(nextZoom===oldZoom)return;
    const cam=this.camera();
    const height=Math.max(1,this.canvas.clientHeight);
    const rect=this.canvas.getBoundingClientRect?.();
    const x=rect&&Number.isFinite(clientX)?
      clientX-rect.left-this.canvas.clientWidth/2:0;
    const y=rect&&Number.isFinite(clientY)?
      clientY-rect.top-this.canvas.clientHeight/2:0;
    const oldScale=2*this.baseHalfHeight/(height*oldZoom);
    const newScale=2*this.baseHalfHeight/(height*nextZoom);
    const diff=oldScale-newScale;
    for(let i=0;i<3;i++)
      this.target[i]+=diff*(x*cam.right[i]-y*cam.up[i]);
    this.zoom=nextZoom;
  }

  /** Resolve the gesture on pointer-down; no mid-drag tool switching. */
  pointerMode(e){
    const type=e.pointerType||"mouse";
    if(type==="touch"||type==="pen")
      return this.projection==="top"?"pan":this.activeTool;

    if(e.button===1)return "pan"; // middle mouse (optional Rhino-style mapping)
    if(e.button===2){
      if(this.projection==="perspective" && e.ctrlKey && e.shiftKey)
        return "orbit-object";
      if(this.projection!=="perspective" && e.ctrlKey && e.shiftKey){
        if(this.projection==="top"){
          // Rotating a Top viewport begins from a plan orientation, without
          // switching into pinhole Perspective.
          this.setProjection("parallel");
          this.orientation=[0,0,0,1];
          this.draw();
        }
        return "orbit";
      }
      if(e.ctrlKey && !e.shiftKey)return "zoom";
      // Rhino TiltView shortcut: Shift+Alt+RMB. Plain Alt must never
      // accidentally roll the camera during ordinary navigation.
      if(e.altKey&&e.shiftKey&&!e.ctrlKey&&this.projection!=="top")
        return "roll";
      if(e.shiftKey || this.projection!=="perspective")return "pan";
      return "orbit";
    }
    // Left drag is a web-demo convenience; Rhino's primary 3-button shortcuts
    // always take precedence and remain independent of this tool selector.
    if(e.shiftKey)return "pan";
    return this.projection==="top"?"pan":this.activeTool;
  }

  pointerDown(e){
    if(e.pointerType!=="touch" && ![0,1,2].includes(e.button))return;
    e.preventDefault();
    const mode=this.pointerMode(e);
    this.pointers.set(e.pointerId,{
      x:e.clientX,y:e.clientY,
      startX:e.clientX,startY:e.clientY,mode,
      pivot:mode==="orbit-object"?this.pickOrbitPivot(e.clientX,e.clientY):null
    });
    this.canvas.classList.add("dragging");
    try{this.canvas.setPointerCapture(e.pointerId);}catch(_){}
  }

  pointerMove(e){
    if(!this.pointers.has(e.pointerId))return;
    e.preventDefault();
    const pointsBefore=[...this.pointers.values()].map(p=>[p.x,p.y]);
    const last=this.pointers.get(e.pointerId);
    const dx=e.clientX-last.x,dy=e.clientY-last.y;
    last.x=e.clientX;
    last.y=e.clientY;

    if(this.pointers.size===1){
      if(last.mode==="pan"){
        this.panByScreen(dx,dy);
      }else if(last.mode==="zoom"){
        this.zoomAt(Math.exp(-dy*.012),last.startX,last.startY);
      }else if(last.mode==="orbit"||last.mode==="orbit-object"){
        this.orbitByScreen(dx,dy,last.pivot);
      }else if(last.mode==="roll"){
        this.rollByScreen(dx);
      }
    }else if(this.pointers.size===2){
      const pointsAfter=[...this.pointers.values()].map(p=>[p.x,p.y]);
      const beforeCenter=avg(...pointsBefore),afterCenter=avg(...pointsAfter);
      const distanceBefore=distance2(...pointsBefore);
      const distanceAfter=distance2(...pointsAfter);
      // The scale is anchored at the OLD midpoint, then moved to the NEW
      // midpoint. Pure translation moves the content in exactly that direction.
      if(distanceBefore>2){
        this.zoomAt(distanceAfter/distanceBefore,beforeCenter[0],beforeCenter[1]);
      }
      this.panByScreen(
        afterCenter[0]-beforeCenter[0],
        afterCenter[1]-beforeCenter[1]
      );
    }
    this.draw();
  }

  pointerUp(e){
    if(!this.pointers.has(e.pointerId))return;
    this.pointers.delete(e.pointerId);
    if(this.pointers.size===0)this.canvas.classList.remove("dragging");
  }

  drawSet(name,mode){
    const gl=this.gl,info=this.buffers[name];
    if(!info?.count)return;
    gl.bindBuffer(gl.ARRAY_BUFFER,info.buffer);
    gl.enableVertexAttribArray(this.attribs.pos);
    gl.enableVertexAttribArray(this.attribs.color);
    gl.vertexAttribPointer(this.attribs.pos,3,gl.FLOAT,false,24,0);
    gl.vertexAttribPointer(this.attribs.color,3,gl.FLOAT,false,24,12);
    gl.drawArrays(mode,0,info.count);
  }

  draw(){
    if(!this.scene)return;
    const width=this.canvas.clientWidth,height=this.canvas.clientHeight;
    if(width<=0||height<=0)return;
    const ratio=Math.min(window.devicePixelRatio||1,2);
    const w=Math.max(1,Math.round(width*ratio));
    const h=Math.max(1,Math.round(height*ratio));
    if(this.canvas.width!==w||this.canvas.height!==h){
      this.canvas.width=w;this.canvas.height=h;
    }
    if(!this.gl) return this.drawFallback();
    const gl=this.gl;
    gl.viewport(0,0,w,h);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    const c=this.camera();
    gl.uniform3fv(this.uniforms.target,this.target);
    gl.uniform3fv(this.uniforms.right,c.right);
    gl.uniform3fv(this.uniforms.up,c.up);
    gl.uniform3fv(this.uniforms.forward,c.forward);
    gl.uniform3fv(this.uniforms.clip,[c.halfWidth,c.halfHeight,c.depthHalf]);
    gl.uniform1f(this.uniforms.perspective,c.parallel?0:1);
    gl.uniform1f(this.uniforms.distance,c.distance);
    gl.uniform1f(this.uniforms.focalY,c.focalY);
    gl.uniform1f(this.uniforms.aspect,c.aspect);
    gl.uniform2fv(this.uniforms.nearFar,[c.near,c.far]);

    this.drawSet("base",gl.TRIANGLES);
    // Ground guide lines should sit below the results heatmap if painted,
    // preserving heat colours while still giving the viewer depth cues.
    this.drawSet("guides",gl.LINES);
    this.drawSet("heat",gl.TRIANGLES);
    this.drawSet("outlines",gl.LINES);
    if(typeof this.onDraw==="function")this.onDraw();
  }

  /** Graceful top-plan fallback if the device disables WebGL. */
  drawFallback(){
    const c=this.canvas.getContext("2d");
    if(!c)return;
    const w=this.canvas.width,h=this.canvas.height;
    c.fillStyle="#edf1ec";c.fillRect(0,0,w,h);
    const g=this.scene.ground;
    const scale=Math.min(w/g.w,h/g.d)*.76*this.zoom;
    const project=(p)=>[
      w/2+(p[0]-this.target[0])*scale,
      h/2-(p[1]-this.target[1])*scale
    ];
    const polygon=(pts,color)=>{
      c.beginPath();
      pts.forEach((p,i)=>{const [x,y]=project(p);i?c.lineTo(x,y):c.moveTo(x,y);});
      c.closePath();c.fillStyle=color;c.fill();
    };
    for(const cell of (this.result?.cells||[])){
      if(!["roof","ground"].includes(cell.surface))continue;
      const color=hoursColor(cell.hours,this.result.daylightHours);
      polygon(cell.corners,"rgb("+color.join(",")+")");
    }
    for(const b of this.scene.buildings){
      const pts=[[b.x,b.y],[b.x+b.w,b.y],[b.x+b.w,b.y+b.d],[b.x,b.y+b.d]];
      c.beginPath();pts.forEach((p,i)=>{
        const [x,y]=project(p);i?c.lineTo(x,y):c.moveTo(x,y);
      });
      c.closePath();c.strokeStyle="#64756b";c.lineWidth=2;c.stroke();
    }
    c.font="14px system-ui";c.fillStyle="#273d2f";
    c.fillText("PLAN VIEW · WebGL unavailable",20,30);
  }

  savePNG(filename="SunHours.png"){
    this.draw();
    const a=document.createElement("a");
    a.href=this.canvas.toDataURL("image/png");
    a.download=filename;
    a.click();
  }
}
