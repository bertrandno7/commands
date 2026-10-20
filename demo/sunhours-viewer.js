/**
 * COMMANDS / SunHours WebGL viewer.
 *
 * Native WebGL 1 with real GPU depth testing. No CDN or framework required.
 * Drag: orbit. Shift/right-drag: pan. Wheel or two-finger pinch: zoom.
 * Two-finger translation pans. Camera always orbits around the visible scene.
 */
import { hoursColor } from "./sunhours-engine.js?v=3";

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
      const col=hoursColor(c.hours,max);
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
  uniform vec3 uClip; // half width, half height, half depth
  varying vec3 vColor;
  void main() {
    vec3 p = aPosition - uTarget;
    gl_Position = vec4(
      dot(p,uRight)/uClip.x,
      dot(p,uUp)/uClip.y,
      dot(p,uForward)/uClip.z,
      1.0
    );
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
    this.yaw=-0.72;
    this.elevation=0.78;
    this.zoom=1;
    this.target=[0,0,12];
    this.baseHalfHeight=60;
    this.pointers=new Map();
    this.gl=canvas.getContext("webgl",{
      antialias:true,alpha:false,depth:true,preserveDrawingBuffer:true,
      powerPreference:"default"
    });
    this.buffers={};
    this.webglAvailable=!!this.gl;
    this.mousePan=false;
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
        clip:gl.getUniformLocation(program,"uClip")
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
      this.zoom=clamp(this.zoom*Math.exp(-e.deltaY*multiplier*.0012),.45,5);
      this.draw();
    },{passive:false});
    this.canvas.addEventListener("dblclick",()=>this.reset());
    if(typeof ResizeObserver!=="undefined")
      this.observer=new ResizeObserver(()=>this.draw());
    this.observer?.observe(this.canvas);
    window.addEventListener("resize",()=>this.draw(),{passive:true});
  }

  reset(){
    this.yaw=-0.72;
    this.elevation=0.78;
    this.zoom=1;
    if(this.scene){
      const g=this.scene.ground;
      const h=Math.max(1,...this.scene.buildings.map(b=>b.h));
      this.target=[g.x+g.w/2,g.y+g.d/2,h*.28];
      this.baseHalfHeight=Math.max(22,Math.hypot(g.w,g.d,h)*.66);
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
    const ce=Math.cos(this.elevation),se=Math.sin(this.elevation);
    const radial=[ce*Math.sin(this.yaw),-ce*Math.cos(this.yaw),se];
    const forward=radial.map(x=>-x);
    const right=normalized(cross(forward,[0,0,1]));
    const up=normalized(cross(right,forward));
    const h=this.baseHalfHeight/this.zoom;
    const aspect=Math.max(.2,this.canvas.clientWidth/Math.max(1,this.canvas.clientHeight));
    return {right,up,forward,halfHeight:h,halfWidth:h*aspect,
      depthHalf:this.baseHalfHeight*3.4};
  }

  moveTarget(dx,dy){
    const cam=this.camera();
    const worldPerPixel=2*cam.halfHeight/Math.max(1,this.canvas.clientHeight);
    const sx=-dx*worldPerPixel,sy=dy*worldPerPixel;
    for(let i=0;i<3;i++)
      this.target[i]+=cam.right[i]*sx+cam.up[i]*sy;
  }

  pointerDown(e){
    if(e.button!==0 && e.button!==1 && e.button!==2 && e.pointerType!=="touch")return;
    e.preventDefault();
    this.pointers.set(e.pointerId,[e.clientX,e.clientY]);
    this.mousePan=e.button!==0||e.shiftKey||e.ctrlKey||e.altKey;
    this.canvas.classList.add("dragging");
    try{this.canvas.setPointerCapture(e.pointerId);}catch(_){}
  }
  pointerMove(e){
    if(!this.pointers.has(e.pointerId))return;
    e.preventDefault();
    const pointsBefore=[...this.pointers.values()].map(p=>[...p]);
    const last=this.pointers.get(e.pointerId);
    const next=[e.clientX,e.clientY];
    this.pointers.set(e.pointerId,next);
    if(this.pointers.size===1){
      const dx=next[0]-last[0],dy=next[1]-last[1];
      if(this.mousePan){this.moveTarget(dx,dy);}
      else{
        this.yaw+=dx*.007;
        this.elevation=clamp(this.elevation-dy*.006,.10,1.48);
      }
    }else if(this.pointers.size===2){
      const pointsAfter=[...this.pointers.values()];
      const centerBefore=avg(...pointsBefore),centerAfter=avg(...pointsAfter);
      const d0=distance2(...pointsBefore),d1=distance2(...pointsAfter);
      if(d0>1)this.zoom=clamp(this.zoom*d1/d0,.45,5);
      this.moveTarget(centerAfter[0]-centerBefore[0],centerAfter[1]-centerBefore[1]);
    }
    this.draw();
  }
  pointerUp(e){
    if(!this.pointers.has(e.pointerId))return;
    this.pointers.delete(e.pointerId);
    if(this.pointers.size===0){
      this.canvas.classList.remove("dragging");
      this.mousePan=false;
    }
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

    this.drawSet("base",gl.TRIANGLES);
    // Ground guide lines should sit below the results heatmap if painted,
    // preserving heat colours while still giving the viewer depth cues.
    this.drawSet("guides",gl.LINES);
    this.drawSet("heat",gl.TRIANGLES);
    this.drawSet("outlines",gl.LINES);
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
