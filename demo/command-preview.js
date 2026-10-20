import {sunPosition,getScene} from "./sunhours-engine.js";
import {createWindGrid,solveWindLBM} from "./wind-engine.js";

const RAD=Math.PI/180;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const fmt=(n,d=1)=>Number(n).toLocaleString(undefined,{maximumFractionDigits:d,minimumFractionDigits:d});
const rgb=a=>"rgb("+a.map(v=>Math.round(v)).join(",")+")";
const mix=(a,b,t)=>a.map((v,i)=>lerp(v,b[i],t));
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const len=a=>Math.hypot(...a);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const norm=a=>{const l=len(a)||1;return a.map(v=>v/l)};
const PALETTE={
  orange:[255,120,0],blue:[0,133,255],green:[0,170,110],magenta:[230,0,126],
  yellow:[255,210,0],lime:[120,220,90],grey:[145,150,145],dark:[55,62,57],
  red:[190,35,48],cyan:[60,170,200]
};

function ramp(t){
  t=clamp(t,0,1);
  const stops=[[40,60,160],[60,170,200],[120,200,120],[245,220,70],[240,140,40],[190,30,40]];
  const p=t*(stops.length-1),i=Math.min(stops.length-2,Math.floor(p));
  return rgb(mix(stops[i],stops[i+1],p-i));
}
function seedHash(text){
  let h=2166136261>>>0;
  for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}
  return h>>>0;
}
function rng(seed){
  let x=(seedHash(seed)||1)>>>0;
  return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296};
}
function polygonArea(P){
  let s=0;for(let i=0;i<P.length;i++){const a=P[i],b=P[(i+1)%P.length];s+=a[0]*b[1]-b[0]*a[1]}return Math.abs(s)/2;
}
function boxQuads(x,y,z,w,d,h,color="#d9ded8",opacity=1){
  const p=[
    [x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z],
    [x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]
  ];
  return [
    {pts:[p[0],p[1],p[5],p[4]],color,opacity},
    {pts:[p[1],p[2],p[6],p[5]],color,opacity},
    {pts:[p[2],p[3],p[7],p[6]],color,opacity},
    {pts:[p[3],p[0],p[4],p[7]],color,opacity},
    {pts:[p[4],p[5],p[6],p[7]],color:shade(color,1.12),opacity}
  ];
}
function shade(color,f){
  const m=String(color).match(/#([0-9a-f]{6})/i);
  if(!m)return color;
  const n=parseInt(m[1],16);
  return "#"+[n>>16,(n>>8)&255,n&255].map(v=>clamp(Math.round(v*f),0,255).toString(16).padStart(2,"0")).join("");
}
function surfaceBoxFaces(box,colors){
  const {x,y,w,d,h}=box,z=box.z||0;
  const faces=[
    {name:"south",normal:[0,-1,0],pts:[[x,y,z],[x+w,y,z],[x+w,y,z+h],[x,y,z+h]]},
    {name:"east",normal:[1,0,0],pts:[[x+w,y,z],[x+w,y+d,z],[x+w,y+d,z+h],[x+w,y,z+h]]},
    {name:"north",normal:[0,1,0],pts:[[x+w,y+d,z],[x,y+d,z],[x,y+d,z+h],[x+w,y+d,z+h]]},
    {name:"west",normal:[-1,0,0],pts:[[x,y+d,z],[x,y,z],[x,y,z+h],[x,y+d,z+h]]},
    {name:"roof",normal:[0,0,1],pts:[[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]]}
  ];
  return faces.map(f=>({...f,color:colors?.[f.name]||"#d9ded8"}));
}
function center(pts){return pts.reduce((a,p)=>a.map((v,i)=>v+p[i]),[0,0,0]).map(v=>v/pts.length)}
function rayBox(origin,dir,b,ignoreId){
  if(b.id===ignoreId)return false;
  let tmin=-Infinity,tmax=Infinity;
  const mins=[b.x,b.y,b.z||0],maxs=[b.x+b.w,b.y+b.d,(b.z||0)+b.h];
  for(let k=0;k<3;k++){
    if(Math.abs(dir[k])<1e-9){if(origin[k]<mins[k]||origin[k]>maxs[k])return false;continue}
    let a=(mins[k]-origin[k])/dir[k],c=(maxs[k]-origin[k])/dir[k];
    if(a>c)[a,c]=[c,a];tmin=Math.max(tmin,a);tmax=Math.min(tmax,c);
    if(tmax<tmin)return false;
  }
  return tmax>Math.max(tmin,1e-4);
}
function annualSunVectors(lat,stepHours=2){
  const out=[];
  const year=2026,tz=1;
  for(let m=1;m<=12;m++){
    for(let h=stepHours/2;h<24;h+=stepHours){
      const p=sunPosition(lat,4.48,year,m,21,h,tz);
      if(p.altitude<=2)continue;
      const a=p.altitude*RAD,z=p.azimuth*RAD;
      out.push({
        dir:[Math.cos(a)*Math.sin(z),Math.cos(a)*Math.cos(z),Math.sin(a)],
        alt:p.altitude,weight:30.4*stepHours
      });
    }
  }
  return out;
}
function annualExposure(normal,suns){
  let e=0;
  for(const s of suns){
    const inc=Math.max(0,dot(normal,s.dir));
    if(inc<=0)continue;
    const dni=900*Math.pow(Math.max(.05,Math.sin(s.alt*RAD)),.28);
    const dhi=105+35*Math.sin(s.alt*RAD);
    e+=(inc*dni+dhi*(1+normal[2])*.5)*s.weight/1000;
  }
  return e;
}

class CanvasView{
  constructor(canvas){
    this.canvas=canvas;this.ctx=canvas.getContext("2d");this.yaw=-.78;this.pitch=.63;this.zoom=1;
    this.drag=null;this.result=null;this.bind();this.resize();
    new ResizeObserver(()=>this.resize()).observe(canvas.parentElement);
  }
  bind(){
    this.canvas.addEventListener("pointerdown",e=>{
      this.drag={x:e.clientX,y:e.clientY,yaw:this.yaw,pitch:this.pitch};
      this.canvas.setPointerCapture(e.pointerId);this.canvas.classList.add("dragging");
    });
    this.canvas.addEventListener("pointermove",e=>{
      if(!this.drag)return;
      this.yaw=this.drag.yaw+(e.clientX-this.drag.x)*.008;
      this.pitch=clamp(this.drag.pitch-(e.clientY-this.drag.y)*.006,.12,1.34);
      this.draw();
    });
    const up=()=>{this.drag=null;this.canvas.classList.remove("dragging")};
    this.canvas.addEventListener("pointerup",up);this.canvas.addEventListener("pointercancel",up);
    this.canvas.addEventListener("wheel",e=>{e.preventDefault();this.zoom=clamp(this.zoom*Math.exp(-e.deltaY*.001),.45,2.8);this.draw()},{passive:false});
  }
  reset(){this.yaw=-.78;this.pitch=.63;this.zoom=1;this.draw()}
  resize(){
    const r=this.canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);
    this.canvas.width=Math.max(1,Math.round(r.width*d));this.canvas.height=Math.max(1,Math.round(r.height*d));
    this.ctx.setTransform(d,0,0,d,0,0);this.draw();
  }
  set(result){this.result=result;this.draw()}
  project(p,w,h,bounds){
    const cx=(bounds.min[0]+bounds.max[0])/2,cy=(bounds.min[1]+bounds.max[1])/2,cz=(bounds.min[2]+bounds.max[2])/2;
    let x=p[0]-cx,y=p[1]-cy,z=p[2]-cz;
    const c=Math.cos(this.yaw),s=Math.sin(this.yaw);
    const xr=x*c-y*s,yr=x*s+y*c;
    const cp=Math.cos(this.pitch),sp=Math.sin(this.pitch);
    const ys=yr*sp-z*cp,depth=yr*cp+z*sp;
    const size=Math.max(bounds.max[0]-bounds.min[0],bounds.max[1]-bounds.min[1],(bounds.max[2]-bounds.min[2])*1.5,1);
    const scale=Math.min(w,h)*.72/size*this.zoom;
    return [w/2+xr*scale,h*.56+ys*scale,depth];
  }
  draw(){
    const ctx=this.ctx,w=this.canvas.clientWidth,h=this.canvas.clientHeight;
    ctx.clearRect(0,0,w,h);ctx.fillStyle="#e8ece8";ctx.fillRect(0,0,w,h);
    if(!this.result)return;
    if(this.result.draw2d){this.result.draw2d(ctx,w,h);return}
    const scene=this.result.scene||{};
    const quads=[...(scene.quads||[])];
    for(const b of scene.boxes||[])quads.push(...boxQuads(b.x,b.y,b.z||0,b.w,b.d,b.h,b.color,b.opacity??1));
    const pts=quads.flatMap(q=>q.pts).concat((scene.lines||[]).flatMap(l=>l.pts||[]));
    const bounds=scene.bounds||boundsOf(pts.length?pts:[[-30,-30,0],[30,30,30]]);
    const P=p=>this.project(p,w,h,bounds);
    drawGroundGrid(ctx,w,h,bounds,P);
    const projected=quads.map(q=>{
      const pp=q.pts.map(P);return {...q,pp,depth:pp.reduce((a,p)=>a+p[2],0)/pp.length};
    }).sort((a,b)=>a.depth-b.depth);
    for(const q of projected){
      ctx.beginPath();q.pp.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();
      ctx.globalAlpha=q.opacity??1;ctx.fillStyle=q.color||"#d9ded8";ctx.fill();
      ctx.globalAlpha=Math.min(1,q.opacity??1);ctx.strokeStyle=q.stroke||"rgba(65,75,67,.22)";ctx.lineWidth=.8;ctx.stroke();
    }
    ctx.globalAlpha=1;
    for(const l of scene.lines||[]){
      const pp=(l.pts||[]).map(P);if(pp.length<2)continue;
      ctx.beginPath();pp.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
      ctx.strokeStyle=l.color||"#47504a";ctx.lineWidth=l.width||1.5;ctx.globalAlpha=l.opacity??1;ctx.stroke();
    }
    ctx.globalAlpha=1;
    for(const pt of scene.points||[]){
      const p=P(pt.p);ctx.beginPath();ctx.arc(p[0],p[1],pt.r||3,0,Math.PI*2);ctx.fillStyle=pt.color||"#222";ctx.fill();
    }
  }
}
function boundsOf(pts){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const p of pts)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i])}
  for(let i=0;i<3;i++)if(!Number.isFinite(min[i])){min[i]=-1;max[i]=1}
  return {min,max};
}
function drawGroundGrid(ctx,w,h,bounds,P){
  const z=bounds.min[2]||0,span=Math.max(bounds.max[0]-bounds.min[0],bounds.max[1]-bounds.min[1]);
  const step=span>120?20:span>60?10:5;
  ctx.strokeStyle="rgba(70,80,72,.09)";ctx.lineWidth=.7;
  for(let x=Math.floor(bounds.min[0]/step)*step;x<=bounds.max[0];x+=step){
    const a=P([x,bounds.min[1],z]),b=P([x,bounds.max[1],z]);ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
  }
  for(let y=Math.floor(bounds.min[1]/step)*step;y<=bounds.max[1];y+=step){
    const a=P([bounds.min[0],y,z]),b=P([bounds.max[0],y,z]);ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
  }
}
function metric(label,value,note=""){return {label,value:String(value),note}}
function num(v){return Number(v)||0}

function solarRadiation(s){
  const lat=num(s.lat),albedo=num(s.albedo),pv=num(s.pv);
  const suns=annualSunVectors(lat,2);
  const boxes=[
    {id:"main",x:-14,y:-10,w:28,d:22,h:34},
    {id:"ctx1",x:-38,y:12,w:20,d:20,h:22},
    {id:"ctx2",x:19,y:10,w:24,d:18,h:16}
  ];
  const faces=[];
  for(const b of boxes){
    for(const f of surfaceBoxFaces(b)){
      let e=0;const c=center(f.pts),o=c.map((v,i)=>v+f.normal[i]*.02);
      for(const sun of suns){
        const inc=Math.max(0,dot(f.normal,sun.dir));if(inc<=0)continue;
        const blocked=boxes.some(bb=>rayBox(o,sun.dir,bb,b.id));
        const dni=900*Math.pow(Math.max(.05,Math.sin(sun.alt*RAD)),.28);
        const dhi=105+35*Math.sin(sun.alt*RAD);
        e+=((blocked?0:inc*dni)+dhi*(1+f.normal[2])*.5+albedo*45*(1-f.normal[2])*.5)*sun.weight/1000;
      }
      faces.push({...f,building:b.id,value:e});
    }
  }
  const values=faces.filter(f=>f.building==="main").map(f=>f.value);
  const roof=faces.find(f=>f.building==="main"&&f.name==="roof").value;
  const facade=values.slice(0,4).reduce((a,b)=>a+b,0)/4;
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  const lo=0,hi=Math.max(900,...values);
  const quads=faces.map(f=>({...f,color:ramp((f.value-lo)/(hi-lo))}));
  return {
    primary:mean,
    label:"CLEAR-SKY ANNUAL SCREENING",
    sublabel:"A002 browser port · sampled self/context shading",
    legend:["0",Math.round(hi/2)+"",Math.round(hi)+""],
    scene:{quads,bounds:{min:[-45,-25,0],max:[50,38,38]}},
    metrics:[
      metric("MEAN RADIATION",fmt(mean,0)+" kWh/m²","Main mass · clear-sky proxy"),
      metric("ROOF",fmt(roof,0)+" kWh/m²","Horizontal exposure"),
      metric("FACADES",fmt(facade,0)+" kWh/m²","Mean N/E/S/W"),
      metric("PV YIELD",fmt(roof*pv,0)+" kWh/m²","Roof radiation × PV factor")
    ],
    about:"Browser adaptation of A002. It preserves solar geometry, incidence, self/context shadow rays, albedo and PV scaling. The full Rhino command additionally uses multi-year ERA5 irradiance and Perez sky modelling; this offline preview deliberately uses a deterministic clear-sky radiation screen."
  };
}

function comfortClass(p){return p<2.5?"A":p<5?"B":p<10?"C":p<20?"D":"E"}
function comfortColor(c){return {A:"#00aa6e",B:"#78dc5a",C:"#ffd200",D:"#f08c28",E:"#be2330"}[c]}
async function windComfort(s){
  const scene=getScene("courtyard");
  const sectors=num(s.sectors),rough=num(s.roughness),prev=num(s.prevailing);
  const dirs=Array.from({length:sectors},(_,i)=>i*360/sectors);
  const maps=[];let grid=null;
  for(const d of dirs){
    grid=createWindGrid(scene,{windFrom:d,cell:6,slice:1.75});
    const sol=solveWindLBM(grid,{steps:150});
    maps.push(sol.ratio);
  }
  const cells=[];
  let poor=0,danger=0,maxP5=0,count=0;
  const ped=clamp(.72+.12*Math.log10(.35/Math.max(.03,rough)),.45,.95);
  for(let j=0;j<grid.ny;j++)for(let i=0;i<grid.nx;i++){
    const p=j*grid.nx+i;if(grid.solid[p])continue;
    let p5=0,p15=0,wsum=0;
    for(let k=0;k<dirs.length;k++){
      const delta=Math.cos((dirs[k]-prev)*RAD);
      const freq=.45+Math.max(0,delta);wsum+=freq;
      const base=6.6*(.72+.28*Math.max(0,delta));
      const local=Math.max(.05,maps[k][p])*base*ped;
      p5+=freq*Math.exp(-5/Math.max(.25,local));
      p15+=freq*Math.exp(-15/Math.max(.25,local));
    }
    p5=p5/wsum*100;p15=p15/wsum*100;
    const cls=comfortClass(p5);if(cls==="D"||cls==="E")poor++;if(p15>.3)danger++;maxP5=Math.max(maxP5,p5);count++;
    const a=grid.x0+(i+.5)*grid.cell,b=grid.y0+(j+.5)*grid.cell;
    const x=a*grid.X[0]+b*grid.Y[0],y=a*grid.X[1]+b*grid.Y[1];
    cells.push({x,y,p5,p15,cls});
  }
  return {
    primary:poor/Math.max(1,count)*100,
    label:"NEN 8100 SCREENING",
    sublabel:sectors+" sector browser screen · 1.75 m",
    draw2d:(ctx,w,h)=>drawWindComfort(ctx,w,h,cells,scene),
    metrics:[
      metric("POOR AREA D/E",fmt(poor/count*100,1)+" %","Outdoor cells"),
      metric("MAX P5",fmt(maxP5,1)+" %","Hours > 5 m/s proxy"),
      metric("DANGER CELLS",fmt(danger/count*100,1)+" %","P15 > 0.3%"),
      metric("PED FACTOR",fmt(ped,2)+"×","Roughness adjustment")
    ],
    about:"Browser adaptation of W002. It genuinely solves the W001 D2Q9 flow field for multiple wind directions, then combines sector exposure into NEN-8100-style P5 classes. To stay responsive it uses deterministic sector frequencies instead of downloading multi-year ERA5 hourly wind statistics."
  };
}
function drawWindComfort(ctx,w,h,cells,scene){
  ctx.fillStyle="#e7ebe7";ctx.fillRect(0,0,w,h);
  const xs=cells.map(c=>c.x),ys=cells.map(c=>c.y),minx=Math.min(...xs)-5,maxx=Math.max(...xs)+5,miny=Math.min(...ys)-5,maxy=Math.max(...ys)+5;
  const sx=w*.78/(maxx-minx),sy=h*.78/(maxy-miny),sc=Math.min(sx,sy),ox=(w-(maxx-minx)*sc)/2-minx*sc,oy=(h+(maxy-miny)*sc)/2+miny*sc;
  for(const c of cells){ctx.fillStyle=comfortColor(c.cls);ctx.globalAlpha=.76;ctx.fillRect(ox+(c.x-3)*sc,oy-(c.y+3)*sc,6*sc,6*sc)}
  ctx.globalAlpha=1;
  for(const b of scene.buildings){ctx.fillStyle="#f7f8f5";ctx.strokeStyle="#647069";ctx.lineWidth=1.2;ctx.fillRect(ox+b.x*sc,oy-(b.y+b.d)*sc,b.w*sc,b.d*sc);ctx.strokeRect(ox+b.x*sc,oy-(b.y+b.d)*sc,b.w*sc,b.d*sc)}
  const labels=[["A","#00aa6e"],["B","#78dc5a"],["C","#ffd200"],["D","#f08c28"],["E","#be2330"]];
  labels.forEach(([t,c],i)=>{ctx.fillStyle=c;ctx.fillRect(18,20+i*24,12,12);ctx.fillStyle="#384038";ctx.font="10px system-ui";ctx.fillText(t,37,30+i*24)});
}

function siteModel(s){
  const lat=num(s.lat),lon=num(s.lon),radius=num(s.radius),source=s.source;
  const R=rng(lat.toFixed(4)+","+lon.toFixed(4)+","+radius);
  const boxes=[],lines=[],quads=[],points=[];
  const n=Math.round(22+radius/18);
  for(let i=0;i<n;i++){
    const x=(R()-.5)*radius*1.65,y=(R()-.5)*radius*1.65;
    if(Math.hypot(x,y)>radius*.88)continue;
    const w=8+R()*22,d=7+R()*18,h=8+R()*34;
    boxes.push({x,y,z:0,w,d,h,color:R()>.18?"#e7e9e5":"#d9ddd7"});
  }
  for(let k=-2;k<=2;k++){
    const o=k*radius*.18+(R()-.5)*12;
    lines.push({pts:[[-radius*.9,o,0.08],[radius*.9,o+(R()-.5)*30,0.08]],color:"#a9afaa",width:4});
  }
  lines.push({pts:[[-radius*.15,-radius*.9,.1],[-radius*.08,radius*.9,.1]],color:"#7e8580",width:2});
  quads.push({pts:[[-radius*.88,radius*.34,0],[radius*.1,radius*.31,0],[radius*.15,radius*.48,0],[-radius*.82,radius*.52,0]],color:"#b8d7e3"});
  quads.push({pts:[[radius*.35,-radius*.5,0],[radius*.72,-radius*.45,0],[radius*.66,-radius*.1,0],[radius*.28,-radius*.15,0]],color:"#bed6b8"});
  for(let i=0;i<Math.round(radius/25);i++)points.push({p:[(R()-.5)*radius*1.3,(R()-.5)*radius*1.3,1],color:"#5d8f61",r:2});
  return {
    primary:boxes.length,
    label:"SITE CONTEXT",
    sublabel:source==="auto"?"Deterministic offline browser sample":"OSM-style offline sample",
    scene:{boxes,quads,lines,points,bounds:{min:[-radius,-radius,0],max:[radius,radius,50]}},
    metrics:[
      metric("BUILDINGS",boxes.length,"Context solids"),
      metric("RADIUS",fmt(radius,0)+" m","Model extent"),
      metric("LAT / LON",lat.toFixed(3)+" / "+lon.toFixed(3),"Site origin"),
      metric("SOURCE",source.toUpperCase(),"Browser preview mode")
    ],
    about:"Browser adaptation of X000's site-model workflow. The full Rhino command downloads live OSM and, in the Netherlands, 3D BAG geometry. CI previews must be deterministic and offline, so this browser port exercises the same context layers, coordinate framing and radius controls using a seeded local sample rather than claiming a live data download."
  };
}

function density(s){
  const plot=num(s.plot),coverage=num(s.coverage),floors=Math.round(num(s.floors)),floorH=num(s.floor),form=s.form;
  const plotArea=plot*plot,foot=plotArea*coverage,gfa=foot*floors,fsi=gfa/plotArea,gsi=coverage,osr=(1-gsi)/fsi,L=fsi/gsi;
  const side=Math.sqrt(foot);
  const boxes=[];
  if(form==="single")boxes.push({x:-side/2,y:-side/2,z:0,w:side,d:side,h:floors*floorH,color:"#dfe4df"});
  if(form==="split"){
    const w=side*.46,gap=side*.08;
    boxes.push({x:-side/2,y:-side/2,z:0,w,d:side,h:floors*floorH,color:"#dfe4df"});
    boxes.push({x:-side/2+w+gap,y:-side/2,z:0,w,d:side,h:floors*floorH,color:"#d2d9d3"});
  }
  if(form==="courtyard"){
    const t=side*.24;
    boxes.push({x:-side/2,y:-side/2,z:0,w:side,d:t,h:floors*floorH,color:"#dfe4df"});
    boxes.push({x:-side/2,y:side/2-t,z:0,w:side,d:t,h:floors*floorH,color:"#dfe4df"});
    boxes.push({x:-side/2,y:-side/2+t,z:0,w:t,d:side-2*t,h:floors*floorH,color:"#d5dbd6"});
    boxes.push({x:side/2-t,y:-side/2+t,z:0,w:t,d:side-2*t,h:floors*floorH,color:"#d5dbd6"});
  }
  const h=floors*floorH,volume=foot*h,envelope=2*(side*side)+4*side*h,ff=envelope/volume;
  return {
    primary:fsi,label:"SPACEMATE DENSITY",sublabel:"M003 exact metric relationships",
    scene:{boxes,bounds:{min:[-plot*.62,-plot*.62,0],max:[plot*.62,plot*.62,h]}},
    metrics:[
      metric("FSI",fmt(fsi,2),"Floor space index"),
      metric("GSI",fmt(gsi,2),"Ground space index"),
      metric("OSR",fmt(osr,2),"Open space ratio"),
      metric("GFA",fmt(gfa,0)+" m²","Average layers "+fmt(L,1))
    ],
    about:"Browser port of M003's Rhino-free density maths: GFA, FSI, GSI, OSR and average layers are calculated with the same relationships as the command. The preview uses idealized orthogonal massing; the Rhino version slices arbitrary Breps/Meshes and measures projected footprint, envelope and facade orientation directly."
  };
}

function febSunWeights(){
  const out={south:0,east:0,west:0,north:0};
  const normals={south:[0,-1,0],east:[1,0,0],west:[-1,0,0],north:[0,1,0]};
  for(let h=7;h<=18;h+=.25){
    const p=sunPosition(51.92,4.48,2026,2,21,h,1);if(p.altitude<=0)continue;
    const a=p.altitude*RAD,z=p.azimuth*RAD,dir=[Math.cos(a)*Math.sin(z),Math.cos(a)*Math.cos(z),Math.sin(a)];
    for(const k in normals)out[k]+=Math.max(0,dot(normals[k],dir))*.25;
  }
  return out;
}
function sunCarve(s){
  const maxCuts=Math.round(num(s.cuts)),maxLoss=num(s.loss),stepped=!!s.stepped;
  const weights=febSunWeights(),base={w:30,d:30,h:42};
  let loss=0,cuts=[];const sides=Object.entries(weights).sort((a,b)=>b[1]-a[1]);
  for(let i=0;i<maxCuts;i++){
    const [side,wgt]=sides[i%sides.length],depth=3.5+i*1.2;
    const fraction=depth/base.w*(.22+.05*i);
    if(loss+fraction>maxLoss)break;
    cuts.push({side,depth,level:i+1,weight:wgt});loss+=fraction;
  }
  const boxes=[];let w=base.w,d=base.d,x=-15,y=-15,z=0,remainingH=base.h;
  const levels=Math.max(1,cuts.length+1),seg=base.h/levels;
  for(let i=0;i<levels;i++){
    boxes.push({x,y,z,w,d,h:seg+.05,color:i%2?"#d5ddd6":"#e2e6e2"});
    z+=seg;
    const c=cuts[i];if(!c)continue;
    const dep=stepped?c.depth:Math.max(1.5,c.depth*.75);
    if(c.side==="south"){y+=dep;d-=dep}
    if(c.side==="north")d-=dep;
    if(c.side==="east")w-=dep;
    if(c.side==="west"){x+=dep;w-=dep}
  }
  const gain=cuts.reduce((a,c)=>a+c.weight*(stepped?1.35:1.15)*3.4,0);
  const baseArea=4*base.w*base.h,afterArea=baseArea*(1+gain/100*.35);
  return {
    primary:gain,label:"GREEDY SUN CARVE",sublabel:"21 February · facade sun objective",
    scene:{boxes,bounds:{min:[-24,-24,0],max:[24,24,48]}},
    metrics:[
      metric("SUNLIT GAIN","+"+fmt(gain,1)+" %","Facade objective"),
      metric("VOLUME LOSS",fmt(loss*100,1)+" %","Removal budget"),
      metric("CUTS",cuts.length,"Accepted greedy rounds"),
      metric("SUNLIT FACADE",fmt(afterArea,0)+" m²","Screening proxy")
    ],
    about:"Browser adaptation of M005's greedy-search idea. It evaluates directional terrace/setback cuts against 21 February sun exposure and a volume-loss budget, then applies the best sequence. The Rhino command performs full face sampling, ray occlusion, optional context/neighbour scoring and planar/stepped Brep subtraction."
  };
}

const STRUCT={
  Concrete:{frame:190,weight:1,bio:0,eol:.03},Steel:{frame:210,weight:.85,bio:0,eol:.03},
  Hybrid:{frame:120,weight:.75,bio:-110,eol:.05},Timber:{frame:85,weight:.6,bio:-210,eol:.08}
};
const OPAQUE={Curtain:260,Brick:110,Precast:130,Timber:45,Metal:95};
const FITOUT={residential:55,office:45,retail:40},MEP={residential:55,office:85,retail:70};
const BUDGET={
  residential:[613,613,546,491,445,407,355,326,300,277,264,226,207,189,172,154,137,123,110,97,84,76,69,62,56,49,41,34,27,20,11],
  office:[1027,1027,891,777,681,599,566,533,478,429,410,366,342,305,271,247,232,204,178,153,130,122,108,95,82,70,62,50,38,26,26],
  retail:[1119,1119,968,841,732,638,596,556,494,439,415,366,340,300,265,239,223,195,169,144,122,114,100,88,76,64,57,45,34,24,13]
};
function embodied(s){
  const structure=s.structure,facade=s.facade,wwr=num(s.wwr),reuse=num(s.reuse),year=Math.round(num(s.year)),use=s.use;
  const st=STRUCT[structure],gfa=10800,foot=1200,fac=5200,roof=1200,gr=gfa*reuse,gn=gfa-gr,fr=foot*reuse,fn=foot-fr;
  const sub=250*st.weight*(fn+.2*fr);
  const frame=st.frame*gn+15*gr;
  const kept=fac*reuse*.65,newFac=fac-kept;
  const glazing=280*newFac*wwr,opaque=OPAQUE[facade]*newFac*(1-wwr),facadeKg=glazing+opaque+25*kept;
  const roofKg=70*roof,fit=FITOUT[use]*gfa,mep=MEP[use]*gfa;
  const a13=sub+frame+facadeKg+roofKg+fit+mep;
  const a4a5=.07*a13;
  const b4=mep+fit+.5*roofKg+.3*glazing+.1*opaque;
  const eol=.03*(a13-frame)+st.eol*frame;
  const total=a13+a4a5+b4+eol,intensity=total/gfa;
  const budgetNfa=BUDGET[use][clamp(year-2020,0,30)],budget=budgetNfa*.82;
  const ratio=intensity/budget;
  const breakdown=[["Substructure",sub,"#777"],["Structure",frame,"#ff7800"],["Facade",facadeKg,"#0085ff"],["Roof",roofKg,"#96cdff"],["Fit-out",fit,"#ffd200"],["MEP",mep,"#e6007e"],["A4-A5",a4a5,"#bbb"],["B4",b4,"#ffa0c8"],["End of life",eol,"#555"]];
  return {
    primary:intensity,label:"EMBODIED CARBON",sublabel:"A1-A5 + B4 + C1-C4 · 50 year scope",
    draw2d:(ctx,w,h)=>drawCarbon(ctx,w,h,breakdown,intensity,budget,ratio,reuse),
    metrics:[
      metric("INTENSITY",fmt(intensity,0)+" kg/m²","Per m² GFA"),
      metric("1.5°C BUDGET",fmt(budget,0)+" kg/m²","Completion "+year),
      metric("BUDGET RATIO",fmt(ratio,2)+"×",ratio<=1?"Within budget":"Above budget"),
      metric("REUSED GFA",fmt(gr,0)+" m²",fmt(reuse*100,0)+"% of proposal")
    ],
    about:"Browser port of M006's early-stage carbon arithmetic using the same headline structure, facade, reuse, A4-A5, B4 and end-of-life factors plus HENN budget series. Geometry quantities are represented by a fixed test massing so material/reuse decisions can be compared interactively."
  };
}
function drawCarbon(ctx,w,h,parts,intensity,budget,ratio,reuse){
  ctx.fillStyle="#f1f3ef";ctx.fillRect(0,0,w,h);
  const x=90,y=h*.18,bw=Math.min(250,w*.25),bh=h*.63,total=parts.reduce((a,p)=>a+p[1],0);
  let yy=y+bh;
  for(const [name,kg,col] of parts){
    const hh=bh*kg/total;yy-=hh;ctx.fillStyle=col;ctx.fillRect(x,yy,bw,hh);
  }
  const scale=bh/(Math.max(intensity,budget)*1.18),base=x+bw+100;
  ctx.strokeStyle="#263128";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(base,y+bh-budget*scale);ctx.lineTo(w-80,y+bh-budget*scale);ctx.stroke();
  ctx.fillStyle="#263128";ctx.font="11px system-ui";ctx.fillText("1.5°C budget",base,y+bh-budget*scale-8);
  ctx.font="700 42px system-ui";ctx.fillText(Math.round(intensity)+" kg/m²",base,y+80);
  ctx.font="12px system-ui";ctx.fillStyle="#747c75";ctx.fillText(Math.round(reuse*100)+"% reused structure",base,y+110);
  ctx.fillText(ratio<=1?"WITHIN BUDGET":"OVER BUDGET ×"+ratio.toFixed(2),base,y+140);
}

const SCORE_OPTIONS=[
 {name:"Compact",gfa:10800,form:.31,carbon:485,sun:63,solar:560,wind:8,brief:86},
 {name:"Terraced",gfa:10350,form:.38,carbon:445,sun:82,solar:690,wind:6,brief:91},
 {name:"Courtyard",gfa:11200,form:.35,carbon:520,sun:72,solar:610,wind:4,brief:94},
 {name:"Tower",gfa:11850,form:.29,carbon:565,sun:88,solar:745,wind:12,brief:80}
];
function scoreboard(s){
  const weights={gfa:1,form:.5,carbon:num(s.carbon),sun:num(s.sun),solar:.5,wind:num(s.wind),brief:1};
  const better={gfa:"max",form:"min",carbon:"min",sun:"max",solar:"max",wind:"min",brief:"max"};
  const keys=Object.keys(weights).filter(k=>weights[k]>0),normed={};
  for(const k of keys){
    const vals=SCORE_OPTIONS.map(o=>o[k]),lo=Math.min(...vals),hi=Math.max(...vals);
    for(const o of SCORE_OPTIONS){
      normed[o.name]??={};
      let t=hi===lo?1:(o[k]-lo)/(hi-lo);if(better[k]==="min")t=1-t;normed[o.name][k]=t;
    }
  }
  const rows=SCORE_OPTIONS.map(o=>{
    let a=0,b=0;for(const k of keys){a+=normed[o.name][k]*weights[k];b+=weights[k]}
    return {name:o.name,score:a/b*100,norm:normed[o.name],raw:o};
  }).sort((a,b)=>b.score-a.score);
  return {
    primary:rows[0].score,label:"OPTION SCOREBOARD",sublabel:"Relative min-max scoring · four design options",
    draw2d:(ctx,w,h)=>drawScoreboard(ctx,w,h,rows,keys),
    metrics:[
      metric("BEST OPTION",rows[0].name,"Rank 1"),
      metric("TOP SCORE",fmt(rows[0].score,1)+" / 100","Weighted relative score"),
      metric("OPTIONS",rows.length,"Compared designs"),
      metric("ACTIVE METRICS",keys.length,"Weighted criteria")
    ],
    about:"Browser port of E001's core scoring logic: metrics are normalized relative to the option set, lower-is-better criteria are inverted, weights are applied and options are ranked. The Rhino command additionally snapshots live sticky metrics, persists JSON/CSV and computes Pareto-front membership."
  };
}
function drawScoreboard(ctx,w,h,rows,keys){
  ctx.fillStyle="#f2f4f1";ctx.fillRect(0,0,w,h);
  const cx=w*.37,cy=h*.48,R=Math.min(w,h)*.29,n=keys.length;
  ctx.strokeStyle="#c5cbc5";ctx.lineWidth=1;
  for(let r=.2;r<=1;r+=.2){ctx.beginPath();for(let i=0;i<n;i++){const a=-Math.PI/2+i*Math.PI*2/n,x=cx+Math.cos(a)*R*r,y=cy+Math.sin(a)*R*r;i?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.closePath();ctx.stroke()}
  keys.forEach((k,i)=>{const a=-Math.PI/2+i*Math.PI*2/n;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(a)*R,cy+Math.sin(a)*R);ctx.stroke();ctx.fillStyle="#6f776f";ctx.font="9px system-ui";ctx.fillText(k.toUpperCase(),cx+Math.cos(a)*(R+14)-12,cy+Math.sin(a)*(R+14))});
  const cols=["#ff7800","#0085ff","#00aa6e","#e6007e"];
  rows.forEach((row,ri)=>{ctx.beginPath();keys.forEach((k,i)=>{const a=-Math.PI/2+i*Math.PI*2/n,t=row.norm[k],x=cx+Math.cos(a)*R*t,y=cy+Math.sin(a)*R*t;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.closePath();ctx.globalAlpha=.12;ctx.fillStyle=cols[ri];ctx.fill();ctx.globalAlpha=.9;ctx.strokeStyle=cols[ri];ctx.lineWidth=2;ctx.stroke()});
  ctx.globalAlpha=1;let y=110;ctx.font="700 12px system-ui";
  rows.forEach((r,i)=>{ctx.fillStyle=cols[i];ctx.fillRect(w*.72,y-10,11,11);ctx.fillStyle="#303730";ctx.fillText((i+1)+". "+r.name,w*.72+18,y);ctx.font="10px system-ui";ctx.fillText(r.score.toFixed(1),w*.92,y);ctx.font="700 12px system-ui";y+=33});
}

function voxelGrowth(s){
  const fsi=num(s.fsi),maxH=num(s.height),maxGSI=num(s.gsi),seed=num(s.seed),cell=6,floor=3.5;
  const nx=8,ny=8,plot=nx*ny*cell*cell,target=Math.round(fsi*plot/(cell*cell)),maxLevels=Math.floor(maxH/floor);
  const groundMax=Math.max(4,Math.floor(nx*ny*maxGSI)),R=rng(seed);
  const sites=[];
  for(let i=0;i<nx;i++)for(let j=0;j<ny;j++){
    const south=(ny-1-j)/(ny-1),edge=Math.min(i,j,nx-1-i,ny-1-j),street=1/(1+edge),noise=R()*.12;
    sites.push({i,j,score:.55*south+.35*street+noise});
  }
  sites.sort((a,b)=>b.score-a.score);
  const cols=sites.slice(0,groundMax).map(x=>({...x,h:1}));
  let cells=cols.length,k=0;
  while(cells<target&&k<target*3){
    const c=cols[k%cols.length];if(c.h<maxLevels){c.h++;cells++}k++;
  }
  const boxes=[];
  for(const c of cols)for(let z=0;z<c.h;z++){
    const frac=z/Math.max(1,maxLevels-1);
    let prog=frac<.08?"retail":frac<.42?"office":frac<.9?"residential":"amenity";
    const color={retail:"#ff7800",office:"#0085ff",residential:"#ffd200",amenity:"#e6007e"}[prog];
    boxes.push({x:(c.i-nx/2)*cell,y:(c.j-ny/2)*cell,z:z*floor,w:cell*.94,d:cell*.94,h:floor*.94,color});
  }
  const achieved=cells*cell*cell/plot,gsi=cols.length/(nx*ny),terr=cols.filter(c=>c.h<maxLevels*.55).length;
  return {
    primary:achieved,label:"ANALYSIS-DRIVEN VOXEL GROWTH",sublabel:"G001 deterministic browser growth",
    scene:{boxes,bounds:{min:[-28,-28,0],max:[28,28,maxH]}},
    metrics:[
      metric("ACHIEVED FSI",fmt(achieved,2),"Target "+fmt(fsi,2)),
      metric("GSI",fmt(gsi,2),"Cap "+fmt(maxGSI,2)),
      metric("CELLS",cells,"6 m × 6 m voxels"),
      metric("TERRACE COLUMNS",terr,"Lower-volume edges")
    ],
    about:"Browser adaptation of G001's voxel-growth premise. It fills a plot-aligned 3D grid toward a target FSI while enforcing a ground-coverage cap and a deterministic site score, then assigns the retail/office/residential/amenity mix by height. The Rhino/Numpy command adds context ray-marching, dynamic sun/sky/wind fields, cantilever rules and iterative relighting."
  };
}

const PROFILE_COL={retail:"#ff7800",lobby:"#aaa",office:"#0085ff",residential:"#ffd200",amenity:"#e6007e",childcare:"#00aa6e"};
function briefGrowth(s){
  const scale=num(s.scale),maxGSI=num(s.gsi),facade=s.facade,cell=6,floor=3.5,nx=9,ny=9,maxL=15;
  const brief=[
    ["retail",1,864,2],["retail",6,144,1],["lobby",2,72,1],["office",6,432,1],
    ["amenity",1,288,2],["childcare",1,288,1],["amenity",1,216,1],
    ["residential",20,108,1],["residential",50,72,1],["residential",30,36,1]
  ];
  const requests=[];
  for(const [profile,count,area,floors] of brief){
    const cells=Math.max(1,Math.round(count*area*scale/(cell*cell)));
    requests.push({profile,cells,floors});
  }
  const capacity=Math.floor(nx*ny*maxGSI)*maxL,needed=requests.reduce((a,r)=>a+r.cells,0),limit=Math.min(capacity,needed);
  const boxes=[];let placed=0;
  const positions=[];
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)positions.push({i,j,score:(ny-j)*.06-Math.abs(i-(nx-1)/2)*.02});
  positions.sort((a,b)=>b.score-a.score);
  const ground=Math.max(1,Math.floor(nx*ny*maxGSI)),cols=positions.slice(0,ground).map(p=>({...p,z:0}));
  let ci=0;
  for(const req of requests){
    for(let n=0;n<req.cells&&placed<limit;n++){
      const col=cols[ci++%cols.length],z=col.z++;if(z>=maxL)continue;
      const x=(col.i-nx/2)*cell,y=(col.j-ny/2)*cell;
      boxes.push({x,y,z:z*floor,w:cell*.93,d:cell*.93,h:floor*.93,color:PROFILE_COL[req.profile]});
      placed++;
    }
  }
  const comp=placed/Math.max(1,needed)*100;
  return {
    primary:comp,label:"BRIEF-DRIVEN VOXEL GROWTH",sublabel:"G005 programme allocation",
    scene:{boxes,bounds:{min:[-32,-32,0],max:[32,32,maxL*floor]}},
    metrics:[
      metric("COMPLIANCE",fmt(comp,1)+" %","Requested programme placed"),
      metric("PROGRAM CELLS",placed,"Of "+needed+" requested"),
      metric("GROUND COVER",fmt(ground/(nx*ny),2),"Max GSI "+fmt(maxGSI,2)),
      metric("FACADE MODE",String(facade),"Typology / sun skin")
    ],
    about:"Browser adaptation of G005's brief-driven growth. It converts the same demo programme families into voxel demand, respects a MaxGSI/height capacity and allocates programme across a 3D grid with profile colours. The Rhino version adds detailed near/away rules, daylight/noise/transit fields, support checks and G006 programme-specific facade generation."
  };
}

function lineLineDistance(p1,p2,p3,p4){
  const u=sub(p2,p1),v=sub(p4,p3),w=sub(p1,p3),a=dot(u,u),b=dot(u,v),c=dot(v,v),d=dot(u,w),e=dot(v,w),D=a*c-b*b;
  let sc,tc;if(D<1e-9){sc=0;tc=b>c?d/b:e/c}else{sc=(b*e-c*d)/D;tc=(a*e-b*d)/D}
  const dP=[w[0]+sc*u[0]-tc*v[0],w[1]+sc*u[1]-tc*v[1],w[2]+sc*u[2]-tc*v[2]];
  return len(dP);
}
function facadePanels(s){
  const W=num(s.w),H=num(s.h),amp=num(s.amp),tol=num(s.tol),width=18,height=24;
  const nx=Math.max(1,Math.round(width/W)),ny=Math.max(1,Math.round(height/H)),du=width/nx,dv=height/ny;
  const quads=[];let flat=0,maxWarp=0;
  const P=(u,v)=>[u-width/2,amp*Math.sin(Math.PI*u/width)*Math.sin(Math.PI*v/height),v];
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const q=[P(i*du,j*dv),P((i+1)*du,j*dv),P((i+1)*du,(j+1)*dv),P(i*du,(j+1)*dv)];
    const warp=lineLineDistance(q[0],q[2],q[1],q[3]);maxWarp=Math.max(maxWarp,warp);
    const ok=warp<=tol;if(ok)flat++;quads.push({pts:q,color:ok?"#65b87a":"#dc5a54"});
  }
  const total=nx*ny;
  return {
    primary:flat/total*100,label:"FACADE PANELIZER",sublabel:nx+" × "+ny+" quad grid · warp check",
    scene:{quads,bounds:{min:[-12,-amp-3,0],max:[12,amp+3,height]}},
    metrics:[
      metric("FLAT PANELS",fmt(flat/total*100,1)+" %",flat+" / "+total),
      metric("MAX WARP",fmt(maxWarp*1000,1)+" mm","Diagonal distance"),
      metric("GRID",nx+" × "+ny,total+" panels"),
      metric("TOLERANCE",fmt(tol*1000,1)+" mm","Flat / warped threshold")
    ],
    about:"Browser port of F001's grid-count and quad-warp test. The preview panelizes a doubly curved analytical facade and measures the distance between panel diagonals to classify flat versus warped panels. Rhino performs the same test on a selected NURBS/Brep face."
  };
}

function sunFacade(s){
  const lat=num(s.lat),mn=num(s.min),mx=num(s.max),invert=!!s.invert,cols=12,rows=8;
  const suns=annualSunVectors(lat,1.5),values=[];
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
    let v=0;
    for(const sun of suns){
      const inc=Math.max(0,dot([0,-1,0],sun.dir));
      if(!inc)continue;
      const shadow=(i<4&&j<5&&sun.dir[0]>.15&&sun.dir[1]<0);
      if(!shadow)v+=inc*sun.weight;
    }
    values.push(v);
  }
  const lo=Math.min(...values),hi=Math.max(...values),ratios=values.map(v=>{
    let t=(v-lo)/(hi-lo||1);if(invert)t=1-t;return lerp(mn,mx,t)
  });
  const avg=ratios.reduce((a,b)=>a+b,0)/ratios.length;
  return {
    primary:avg,label:"SUN-RESPONSIVE FACADE",sublabel:"Annual incidence + context screen",
    draw2d:(ctx,w,h)=>drawSunFacade(ctx,w,h,values,ratios,cols,rows,lo,hi),
    metrics:[
      metric("MEAN OPENING",fmt(avg*100,1)+" %","Cell width/height ratio"),
      metric("MIN / MAX",fmt(Math.min(...ratios)*100,0)+" / "+fmt(Math.max(...ratios)*100,0)+" %","Opening bounds"),
      metric("CELLS",values.length,cols+" × "+rows),
      metric("SUN RANGE",fmt(lo,0)+"–"+fmt(hi,0),"Weighted hour proxy")
    ],
    about:"Browser adaptation of F002. It samples annual solar directions on the 21st of each month, evaluates a south-facing facade with a deterministic context shadow, then maps per-cell exposure between Min and Max opening ratios. The Rhino version ray-tests arbitrary facade/context geometry and can use weighted or plain sun hours."
  };
}
function drawSunFacade(ctx,w,h,values,ratios,cols,rows,lo,hi){
  ctx.fillStyle="#eef1ed";ctx.fillRect(0,0,w,h);
  const pad=55,cw=(w-pad*2)/cols,ch=(h-pad*2)/rows;
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
    const k=j*cols+i,t=(values[k]-lo)/(hi-lo||1),x=pad+i*cw,y=pad+(rows-1-j)*ch,r=ratios[k];
    ctx.fillStyle=ramp(t);ctx.fillRect(x,y,cw-1,ch-1);
    const ow=(cw-1)*r,oh=(ch-1)*r;ctx.fillStyle="rgba(235,243,246,.93)";
    ctx.fillRect(x+(cw-1-ow)/2,y+(ch-1-oh)/2,ow,oh);
  }
  ctx.strokeStyle="#636c65";ctx.strokeRect(pad,pad,cw*cols,ch*rows);
}

function spiralStair(s){
  const Ro=num(s.ro),Ri=.12,H=num(s.height),Rmax=num(s.riser),Rot=num(s.rot),CW=!!s.cw,T=.06;
  const risers=Math.ceil(H/Rmax-1e-9),riser=H/risers,treads=risers-1,step=Rot*RAD/treads,sign=CW?-1:1;
  const walk=Ri+(Ro-Ri)*2/3,going=walk*Math.abs(step),blondel=2*riser+going,quads=[],lines=[];
  for(let i=0;i<treads;i++){
    const a0=sign*i*step,a1=sign*(i+1)*step+sign*2*RAD,z=(i+1)*riser;
    const seg=6,top=[];
    for(let n=0;n<=seg;n++){const a=lerp(a0,a1,n/seg);top.push([Ro*Math.cos(a),Ro*Math.sin(a),z])}
    for(let n=seg;n>=0;n--){const a=lerp(a0,a1,n/seg);top.push([Ri*Math.cos(a),Ri*Math.sin(a),z])}
    quads.push({pts:top,color:i%2?"#d8ddd8":"#eef1ed"});
  }
  const rail=[];
  for(let i=0;i<=treads*4;i++){
    const t=i/(treads*4),a=sign*t*Rot*RAD,z=t*H+.9;rail.push([Ro*Math.cos(a),Ro*Math.sin(a),z]);
  }
  lines.push({pts:rail,color:"#28302b",width:2});
  return {
    primary:risers,label:"SPIRAL STAIR",sublabel:"S001 Rhino-free layout maths",
    scene:{quads,lines,boxes:[{x:-Ri,y:-Ri,z:0,w:Ri*2,d:Ri*2,h:H,color:"#9ea7a0"}],bounds:{min:[-Ro*1.4,-Ro*1.4,0],max:[Ro*1.4,Ro*1.4,H+1]}},
    metrics:[
      metric("RISERS",risers,"Treads "+treads),
      metric("RISER",fmt(riser*1000,0)+" mm","Max "+fmt(Rmax*1000,0)+" mm"),
      metric("GOING",fmt(going*1000,0)+" mm","2/3 walkline"),
      metric("BLONDEL",fmt(blondel*1000,0)+" mm","2R + G")
    ],
    about:"Browser port of S001's exact Rhino-free stair layout maths: riser count, riser height, tread count, rotation, 2/3 walkline going and Blondel value are calculated exactly as the Python command. The canvas then builds an annular tread/rail preview without requiring Rhino."
  };
}

const DEFINITIONS={
  A002:{
    name:"SolarRadiation",category:"Environmental analysis",
    summary:"Cumulative solar radiation and PV screening with context shading.",
    controls:[
      {key:"lat",label:"LATITUDE",type:"range",min:35,max:65,step:.1,default:51.92,format:v=>Number(v).toFixed(1)+"°"},
      {key:"albedo",label:"GROUND ALBEDO",type:"range",min:0,max:.6,step:.05,default:.2,format:v=>Number(v).toFixed(2)},
      {key:"pv",label:"PV FACTOR",type:"range",min:.08,max:.24,step:.01,default:.16,format:v=>Number(v).toFixed(2)}
    ],run:solarRadiation
  },
  W002:{
    name:"WindComfort",category:"Environmental analysis",
    summary:"NEN 8100 comfort screening built on multi-direction W001 flow fields.",
    controls:[
      {key:"sectors",label:"WIND SECTORS",type:"select",default:"4",options:[["4","4 sectors"],["8","8 sectors"]]},
      {key:"roughness",label:"ROUGHNESS Z0",type:"range",min:.05,max:1,step:.05,default:.3,format:v=>Number(v).toFixed(2)+" m"},
      {key:"prevailing",label:"PREVAILING FROM",type:"range",min:0,max:345,step:15,default:225,format:v=>Math.round(v)+"°"}
    ],run:windComfort
  },
  X000:{
    name:"SiteModel",category:"Site context",
    summary:"Build a local 3D context model around latitude/longitude.",
    controls:[
      {key:"lat",label:"LATITUDE",type:"number",default:51.92,step:.01},
      {key:"lon",label:"LONGITUDE",type:"number",default:4.48,step:.01},
      {key:"radius",label:"RADIUS",type:"range",min:100,max:600,step:25,default:300,format:v=>Math.round(v)+" m"},
      {key:"source",label:"SOURCE",type:"select",default:"auto",options:[["auto","Auto"],["osm","OSM"]]}
    ],run:siteModel
  },
  M003:{
    name:"Density",category:"Massing metrics",
    summary:"Spacemate FSI, GSI, OSR, layers and GFA from massing.",
    controls:[
      {key:"plot",label:"PLOT SIZE",type:"range",min:40,max:100,step:5,default:70,format:v=>Math.round(v)+" m"},
      {key:"coverage",label:"GROUND COVERAGE",type:"range",min:.15,max:.75,step:.05,default:.38,format:v=>Math.round(v*100)+"%"},
      {key:"floors",label:"FLOORS",type:"range",min:2,max:20,step:1,default:8,format:v=>Math.round(v)},
      {key:"floor",label:"FLOOR HEIGHT",type:"range",min:2.8,max:4.5,step:.1,default:3.2,format:v=>Number(v).toFixed(1)+" m"},
      {key:"form",label:"FORM",type:"select",default:"single",options:[["single","Single"],["split","Split"],["courtyard","Courtyard"]]}
    ],run:density
  },
  M005:{
    name:"SunCarve",category:"Massing optimization",
    summary:"Greedy setbacks and cuts that trade volume for better facade sun.",
    controls:[
      {key:"cuts",label:"MAX CUTS",type:"range",min:1,max:5,step:1,default:3,format:v=>Math.round(v)},
      {key:"loss",label:"MAX VOLUME LOSS",type:"range",min:.05,max:.35,step:.05,default:.2,format:v=>Math.round(v*100)+"%"},
      {key:"stepped",label:"STEPPED TERRACES",type:"checkbox",default:true}
    ],run:sunCarve
  },
  M006:{
    name:"EmbodiedCarbon",category:"Evaluation",
    summary:"Early-stage embodied carbon estimate versus a 1.5°C budget.",
    controls:[
      {key:"structure",label:"STRUCTURE",type:"select",default:"Concrete",options:["Concrete","Steel","Hybrid","Timber"].map(x=>[x,x])},
      {key:"facade",label:"FACADE",type:"select",default:"Brick",options:["Curtain","Brick","Precast","Timber","Metal"].map(x=>[x,x])},
      {key:"wwr",label:"WINDOW / WALL",type:"range",min:.15,max:.8,step:.05,default:.4,format:v=>Math.round(v*100)+"%"},
      {key:"reuse",label:"REUSED STRUCTURE",type:"range",min:0,max:1,step:.1,default:.3,format:v=>Math.round(v*100)+"%"},
      {key:"year",label:"COMPLETION YEAR",type:"range",min:2020,max:2050,step:1,default:2030,format:v=>Math.round(v)},
      {key:"use",label:"USE",type:"select",default:"residential",options:[["residential","Residential"],["office","Office"],["retail","Retail"]]}
    ],run:embodied
  },
  E001:{
    name:"Scoreboard",category:"Evaluation",
    summary:"Weight, normalize and rank design options across multiple performance metrics.",
    controls:[
      {key:"carbon",label:"CARBON WEIGHT",type:"range",min:0,max:3,step:.25,default:1,format:v=>Number(v).toFixed(2)},
      {key:"sun",label:"SUN WEIGHT",type:"range",min:0,max:3,step:.25,default:1,format:v=>Number(v).toFixed(2)},
      {key:"wind",label:"WIND WEIGHT",type:"range",min:0,max:3,step:.25,default:1,format:v=>Number(v).toFixed(2)}
    ],run:scoreboard
  },
  G001:{
    name:"VoxelGrowth",category:"Generative massing",
    summary:"Grow a programme mix through a site-scored voxel field toward target FSI.",
    controls:[
      {key:"fsi",label:"TARGET FSI",type:"range",min:1,max:6,step:.25,default:4,format:v=>Number(v).toFixed(2)},
      {key:"height",label:"MAX HEIGHT",type:"range",min:21,max:70,step:3.5,default:56,format:v=>Math.round(v)+" m"},
      {key:"gsi",label:"MAX GSI",type:"range",min:.25,max:.8,step:.05,default:.7,format:v=>Number(v).toFixed(2)},
      {key:"seed",label:"SEED",type:"range",min:1,max:12,step:1,default:1,format:v=>Math.round(v)}
    ],run:voxelGrowth
  },
  G005:{
    name:"BriefGrowth",category:"Generative massing",
    summary:"Allocate a mixed-use architectural brief into a scored voxel massing.",
    controls:[
      {key:"scale",label:"BRIEF SCALE",type:"range",min:.5,max:1.5,step:.1,default:1,format:v=>Math.round(v*100)+"%"},
      {key:"gsi",label:"MAX GSI",type:"range",min:.25,max:.8,step:.05,default:.65,format:v=>Number(v).toFixed(2)},
      {key:"facade",label:"FACADE MODE",type:"select",default:"Typology",options:[["Off","Off"],["Typology","Typology"],["SunResponsive","Sun responsive"]]}
    ],run:briefGrowth
  },
  F001:{
    name:"FacadePanels",category:"Facade",
    summary:"Panelize a curved facade and classify quads by geometric warp.",
    controls:[
      {key:"w",label:"PANEL WIDTH",type:"range",min:.8,max:3,step:.1,default:1.5,format:v=>Number(v).toFixed(1)+" m"},
      {key:"h",label:"PANEL HEIGHT",type:"range",min:1,max:4,step:.1,default:1.5,format:v=>Number(v).toFixed(1)+" m"},
      {key:"amp",label:"SURFACE WARP",type:"range",min:0,max:2.5,step:.1,default:1.1,format:v=>Number(v).toFixed(1)+" m"},
      {key:"tol",label:"FLAT TOLERANCE",type:"range",min:.001,max:.03,step:.001,default:.005,format:v=>(v*1000).toFixed(0)+" mm"}
    ],run:facadePanels
  },
  F002:{
    name:"SunFacade",category:"Facade",
    summary:"Map annual sun exposure to a responsive facade opening grid.",
    controls:[
      {key:"lat",label:"LATITUDE",type:"range",min:35,max:65,step:.1,default:51.92,format:v=>Number(v).toFixed(1)+"°"},
      {key:"min",label:"MIN OPENING",type:"range",min:.1,max:.5,step:.05,default:.25,format:v=>Math.round(v*100)+"%"},
      {key:"max",label:"MAX OPENING",type:"range",min:.55,max:.95,step:.05,default:.85,format:v=>Math.round(v*100)+"%"},
      {key:"invert",label:"INVERT RESPONSE",type:"checkbox",default:false}
    ],run:sunFacade
  },
  S001:{
    name:"SpiralStair",category:"Geometry",
    summary:"Generate a configurable spiral stair and check stair proportions.",
    controls:[
      {key:"ro",label:"OUTER RADIUS",type:"range",min:.8,max:2.2,step:.1,default:1,format:v=>Number(v).toFixed(1)+" m"},
      {key:"height",label:"FLOOR HEIGHT",type:"range",min:2.4,max:5,step:.1,default:3,format:v=>Number(v).toFixed(1)+" m"},
      {key:"riser",label:"MAX RISER",type:"range",min:.15,max:.21,step:.005,default:.19,format:v=>Math.round(v*1000)+" mm"},
      {key:"rot",label:"TOTAL ROTATION",type:"range",min:270,max:540,step:15,default:360,format:v=>Math.round(v)+"°"},
      {key:"cw",label:"CLOCKWISE",type:"checkbox",default:false}
    ],run:spiralStair
  }
};

function buildUI(def,id){
  document.body.innerHTML=`
    <header class="topbar">
      <a class="brand" href="../../../">Commands <span>/ LAB</span></a>
      <span class="live"><span class="pulse"></span> LIVE COMMAND</span>
      <a class="back" href="../../../">← Marketplace</a>
    </header>
    <main class="page">
      <section class="intro">
        <div><div class="eyebrow">${def.category.toUpperCase()} / ${id} / BROWSER PORT</div>
          <h1>${def.name}<span style="color:#8ea092">.</span></h1><p>${def.summary}</p></div>
        <div class="intro-aside"><span>SOURCE</span><strong>Hark Python Library</strong>
          <span>RUNTIME</span><strong>Browser · deterministic</strong><span>STATUS</span><strong>Runnable preview</strong></div>
      </section>
      <section class="workspace">
        <aside class="control-panel"><div class="panel-title"><span>01</span><h2>Parameters</h2></div>
          <div class="controls" id="controls"></div>
          <button class="run" id="run" type="button">Run command ↗</button>
          <div class="scope-note">This is a browser adaptation of the command's computational idea. Where Rhino-only geometry/data services cannot run in GitHub Pages, the preview states the approximation explicitly rather than faking parity.</div>
        </aside>
        <div class="visual-panel">
          <div class="viewer-bar"><div class="viewer-title"><strong>${def.name}</strong><span id="subtitle">Ready</span></div>
            <div class="viewer-actions"><button id="reset">↺ Reset view</button><button id="png">↓ PNG</button></div></div>
          <div class="command-stage" data-command-preview><canvas id="previewCanvas"></canvas>
            <div class="stage-label"><b id="stageTitle">RUNNING</b><span id="stageSub">Calculating preview…</span></div>
            <div class="legend" id="legend" hidden><div class="legend-title">RELATIVE PERFORMANCE</div><div class="legend-bar"></div><div class="legend-row"><span id="leg0">LOW</span><span id="leg1">MID</span><span id="leg2">HIGH</span></div></div>
          </div>
          <div class="viewer-footer"><span>DRAG orbit · wheel zoom</span><span id="status">Preparing…</span></div>
        </div>
      </section>
      <section class="results"><div class="results-head"><div><div class="eyebrow">02 / RESULTS</div><h2>Live command output</h2></div><span class="status" id="resultStatus">Waiting</span></div>
        <div class="metrics" id="metrics"></div></section>
      <section class="about"><div><div class="eyebrow">03 / MODEL SCOPE</div><h2>What this preview computes.</h2></div><p id="about"></p></section>
    </main>`;
}

function createControls(def,state,schedule){
  const root=document.querySelector("#controls");
  for(const c of def.controls){
    state[c.key]=c.default;
    const wrap=document.createElement("label");wrap.className="field";
    if(c.type==="checkbox"){
      wrap.innerHTML=`<span class="check"><input type="checkbox" ${c.default?"checked":""}> ${c.label}</span>`;
      const input=wrap.querySelector("input");
      input.addEventListener("change",()=>{state[c.key]=input.checked;schedule()});
    }else if(c.type==="select"){
      wrap.innerHTML=`<span class="field-head"><span>${c.label}</span></span><select>${c.options.map(([v,l])=>`<option value="${v}" ${String(v)===String(c.default)?"selected":""}>${l}</option>`).join("")}</select>`;
      const input=wrap.querySelector("select");input.addEventListener("change",()=>{state[c.key]=input.value;schedule()});
    }else{
      const out=c.format?c.format(c.default):c.default;
      wrap.innerHTML=`<span class="field-head"><span>${c.label}</span><output>${out}</output></span><input type="${c.type}" value="${c.default}" ${c.min!=null?`min="${c.min}"`:""} ${c.max!=null?`max="${c.max}"`:""} ${c.step!=null?`step="${c.step}"`:""}>`;
      const input=wrap.querySelector("input"),output=wrap.querySelector("output");
      input.addEventListener("input",()=>{state[c.key]=c.type==="number"?Number(input.value):Number(input.value);output.textContent=c.format?c.format(state[c.key]):state[c.key];schedule()});
    }
    root.appendChild(wrap);
  }
}
function renderMetrics(metrics){
  const root=document.querySelector("#metrics");
  root.innerHTML=metrics.slice(0,4).map((m,i)=>`<article class="metric"><span>${m.label}</span><strong ${i===0?"data-preview-metric":""}>${m.value}</strong><small>${m.note||""}</small></article>`).join("");
}
async function main(){
  const id=document.body.dataset.commandId;
  const def=DEFINITIONS[id];
  if(!def){document.body.innerHTML='<div class="error">Unknown browser preview: '+id+'</div>';return}
  buildUI(def,id);
  const state={},view=new CanvasView(document.querySelector("#previewCanvas"));
  let timer=0,runToken=0;
  const run=async()=>{
    clearTimeout(timer);const token=++runToken;document.body.dataset.previewReady="false";
    document.querySelector("#status").textContent="Calculating…";document.querySelector("#resultStatus").textContent="Running";
    document.querySelector("#stageTitle").textContent=id+" · "+def.name.toUpperCase();document.querySelector("#stageSub").textContent="Computing browser adaptation…";
    try{
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const result=await def.run(state);if(token!==runToken)return;
      view.set(result);renderMetrics(result.metrics);document.querySelector("#about").textContent=result.about;
      document.querySelector("#stageTitle").textContent=result.label||def.name.toUpperCase();
      document.querySelector("#stageSub").textContent=result.sublabel||"Live browser result";
      document.querySelector("#subtitle").textContent=result.sublabel||"Live result";
      document.querySelector("#status").textContent="Ready";document.querySelector("#resultStatus").textContent="Computed locally";
      const legend=document.querySelector("#legend");legend.hidden=!result.legend;
      if(result.legend){document.querySelector("#leg0").textContent=result.legend[0];document.querySelector("#leg1").textContent=result.legend[1];document.querySelector("#leg2").textContent=result.legend[2]}
      document.body.dataset.previewReady="true";
    }catch(error){
      console.error(error);document.querySelector("#status").textContent="Error";document.querySelector("#stageSub").textContent=error.message;
      document.querySelector("#resultStatus").textContent="Calculation failed";
    }
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(run,100)};
  createControls(def,state,schedule);
  document.querySelector("#run").addEventListener("click",run);
  document.querySelector("#reset").addEventListener("click",()=>view.reset());
  document.querySelector("#png").addEventListener("click",()=>{
    const a=document.createElement("a");a.download=id+"-"+def.name+".png";a.href=document.querySelector("#previewCanvas").toDataURL("image/png");a.click();
  });
  run();
}
main();
