import {
  getScene, analyzeSunHours, colorCss, sunSamples
} from "./sunhours-engine.js?v=2";

const $ = (s) => document.querySelector(s);
const canvas = $("#view"), ctx = canvas.getContext("2d", {alpha:false});
const form = $("#analysisForm");
const runBtn = $("#run");
let scene = getScene("courtyard");
let result = null;
let yaw = -0.67, elevation = 0.61, zoom = 1;
let dragging=false, px=0, py=0;
let pending=false;
const num=(v)=>Number(v);
const fmt=(v)=>`${v.toFixed(1)} h`;

function getOptions(){
  const date = $("#date").value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error("Select a valid date.");
  const [year,month,day]=date.split("-").map(Number);
  const check=new Date(Date.UTC(year,month-1,day));
  if(check.getUTCFullYear()!==year||check.getUTCMonth()+1!==month||check.getUTCDate()!==day) throw Error("Invalid calendar date.");
  return {
    lat:num($("#lat").value),lon:num($("#lon").value),
    year,month,day,step:num($("#step").value),grid:num($("#grid").value)
  };
}

function centerAndScale() {
  const g=scene.ground;
  const cx=g.x+g.w/2,cy=g.y+g.d/2;
  const maxHeight=Math.max(...scene.buildings.map(b=>b.h));
  const span=Math.max(g.w,g.d,maxHeight*1.5);
  const w=canvas.clientWidth,h=canvas.clientHeight;
  return {cx,cy,w,h,scale:Math.min(w*.65,h*.80)/span*zoom};
}

function projection() {
  const {cx,cy,w,h,scale}=centerAndScale();
  const cosy=Math.cos(yaw),siny=Math.sin(yaw);
  const sine=Math.sin(elevation),cose=Math.cos(elevation);
  return {
    project(p){
      const x=p[0]-cx,y=p[1]-cy,z=p[2];
      const horizontal=x*cosy-y*siny;
      const depth=x*siny+y*cosy;
      return [w*.5+horizontal*scale,h*.62+(depth*sine-z*cose)*scale];
    },
    depth(p){
      const x=p[0]-cx,y=p[1]-cy,z=p[2];
      return x*siny+y*cosy+z*Math.sin(elevation)*.26;
    },
    w,h
  };
}
function drawFace(vertices,fill,stroke="rgba(28,34,35,.12)") {
  ctx.beginPath();
  vertices.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
  ctx.closePath();ctx.fillStyle=fill;ctx.fill();
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.45;ctx.stroke();}
}

function baseSceneFaces(){
  const surfaces=[];
  const g=scene.ground;
  surfaces.push({pts:[[g.x,g.y,0],[g.x+g.w,g.y,0],[g.x+g.w,g.y+g.d,0],[g.x,g.y+g.d,0]],shade:"#d8dcd7"});
  for(const b of scene.buildings){
    const x=b.x,y=b.y,z=b.h,w=b.w,d=b.d;
    surfaces.push({pts:[[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z]],shade:"#e9eeec"});
    surfaces.push({pts:[[x,y,0],[x+w,y,0],[x+w,y,z],[x,y,z]],shade:"#c3cac7"});
    surfaces.push({pts:[[x,y+d,0],[x+w,y+d,0],[x+w,y+d,z],[x,y+d,z]],shade:"#bec6c3"});
    surfaces.push({pts:[[x,y,0],[x,y+d,0],[x,y+d,z],[x,y,z]],shade:"#9eaaa8"});
    surfaces.push({pts:[[x+w,y,0],[x+w,y+d,0],[x+w,y+d,z],[x+w,y,z]],shade:"#d1d9d7"});
  }
  return surfaces;
}

function draw() {
  const w=canvas.clientWidth,h=canvas.clientHeight;
  if(!w||!h) return;
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const tw=Math.round(w*dpr),th=Math.round(h*dpr);
  if(canvas.width!==tw||canvas.height!==th){canvas.width=tw;canvas.height=th;}
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle="#e9ece9";ctx.fillRect(0,0,w,h);
  const fade=ctx.createLinearGradient(0,0,0,h);
  fade.addColorStop(0,"#f3f5f2");fade.addColorStop(1,"#e1e5e0");
  ctx.fillStyle=fade;ctx.fillRect(0,0,w,h);
  const p=projection();

  // Fine grid on ground plane.
  const g=scene.ground;
  for(let x=Math.ceil(g.x/10)*10;x<=g.x+g.w;x+=10){
    const a=p.project([x,g.y,0]),b=p.project([x,g.y+g.d,0]);
    ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.strokeStyle="#d3d9d3";ctx.lineWidth=.5;ctx.stroke();
  }
  for(let y=Math.ceil(g.y/10)*10;y<=g.y+g.d;y+=10){
    const a=p.project([g.x,y,0]),b=p.project([g.x+g.w,y,0]);
    ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.strokeStyle="#d3d9d3";ctx.lineWidth=.5;ctx.stroke();
  }
  const base=baseSceneFaces().map(f=>({...f,depth:f.pts.reduce((s,v)=>s+p.depth(v),0)/f.pts.length}));
  base.sort((a,b)=>b.depth-a.depth);
  for(const face of base)drawFace(face.pts.map(p.project),face.shade);

  if(result) {
    const upper=result.daylightHours;
    const cells=result.cells.map(c=>({...c,depth:p.depth(c.center)}));
    cells.sort((a,b)=>b.depth-a.depth);
    for(const c of cells){
      // Darken heat cells on vertical faces slightly, to retain depth cues.
      const [rr,gg,bb] = colorCss(c.hours,upper).match(/\d+/g).map(Number);
      const factor=c.normal[2]>0?1: c.normal[0]!==0?.88:.94;
      const color=`rgb(${Math.round(rr*factor)},${Math.round(gg*factor)},${Math.round(bb*factor)})`;
      drawFace(c.corners.map(p.project),color,"rgba(16,22,25,.045)");
    }
  }

  // Location orientation glyph.
  ctx.fillStyle="#57635c";ctx.font="600 11px system-ui";ctx.textAlign="center";
  const center=p.project([g.x+g.w-8,g.y+g.d-8,0]);
  ctx.fillText("N ↑",Math.min(w-30,Math.max(30,center[0])),Math.min(h-25,Math.max(32,center[1]-10)));
  ctx.fillStyle="rgba(35,49,42,.55)";ctx.font="10px ui-monospace,monospace";ctx.textAlign="left";
  ctx.fillText(result?"A001 · ANALYSIS RESULT":"A001 · ORIGINAL MASSING",18,26);
}

function progress(value){
  $("#progress").style.width=`${Math.round(value*100)}%`;
  $("#progressLabel").textContent=`Calculating solar visibility… ${Math.round(value*100)}%`;
}
function output(result){
  $("#mean").textContent=fmt(result.metrics.mean);
  $("#max").textContent=fmt(result.metrics.max);
  $("#facade").textContent=fmt(result.metrics.facadeMean);
  $("#ground").textContent=fmt(result.metrics.groundMean);
  $("#daylight").textContent=fmt(result.daylightHours);
  $("#cellCount").textContent=`${result.metrics.cells.toLocaleString()} sampled cells`;
  $("#sunCount").textContent=`${result.metrics.samples} sun positions`;
  $("#timezone").textContent=`UTC+${result.timezone} · ${result.options.year}`;
  $("#legendMax").textContent=fmt(result.daylightHours);
  $("#resultLabel").textContent=`${result.options.day} / ${result.options.month} / ${result.options.year} · ${scene.name}`;
  $("#viewStatus").textContent=`${result.metrics.sunlit2h.toFixed(1)}% of sample cells receive ≥2 h`;
  $("#csv").disabled=false;
}

async function runAnalysis(){
  if(pending)return;
  pending=true;runBtn.disabled=true;
  $("#progressWrap").hidden=false;
  progress(0);
  $("#viewStatus").textContent="Computing direct sunlight…";
  try {
    const options=getOptions();
    result=await analyzeSunHours(scene,options,progress);
    output(result);draw();
    $("#progressLabel").textContent="Analysis complete ✓";
  } catch(error) {
    $("#progressLabel").textContent=`Error: ${error.message}`;
    $("#viewStatus").textContent="Analysis failed";
    console.error(error);
  } finally {
    pending=false;runBtn.disabled=false;
  }
}

form.addEventListener("submit",(e)=>{e.preventDefault();runAnalysis();});
$("#scene").addEventListener("change",(e)=>{
  if(pending)return;
  scene=getScene(e.target.value);result=null;
  $("#sceneTitle").textContent=scene.name;
  $("#sceneSubtitle").textContent=scene.subtitle;
  $("#viewStatus").textContent="Scene changed · run analysis";
  $("#resultLabel").textContent="Scene modified — rerun";
  yaw=-.67;elevation=.61;zoom=1;
  draw();runAnalysis();
});
document.querySelectorAll("[data-date]").forEach(btn=>btn.addEventListener("click",()=>{
  $("#date").value=btn.dataset.date;
  document.querySelectorAll("[data-date]").forEach(b=>b.classList.toggle("selected",b===btn));
  runAnalysis();
}));
$("#date").addEventListener("change",()=>{
  document.querySelectorAll("[data-date]").forEach(b=>b.classList.toggle("selected",b.dataset.date===$("#date").value));
});
$("#viewReset").onclick=()=>{yaw=-.67;elevation=.61;zoom=1;draw();};
$("#png").onclick=()=>{draw();const a=document.createElement("a");a.href=canvas.toDataURL("image/png");a.download="SunHours-"+$("#date").value+".png";a.click();};
$("#csv").onclick=()=>{
  if(!result)return;
  const rows=["building,surface,x,y,z,direct_sun_hours",...result.cells.map(c=>[
    c.building,c.surface,...c.center.map(n=>n.toFixed(3)),c.hours.toFixed(4)
  ].join(","))];
  const a=document.createElement("a"),url=URL.createObjectURL(new Blob([rows.join("\n")],{type:"text/csv"}));
  a.href=url;a.download="SunHours-"+$("#date").value+".csv";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
};
canvas.addEventListener("pointerdown",e=>{
  dragging=true;px=e.clientX;py=e.clientY;
  canvas.classList.add("dragging");canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove",e=>{
  if(!dragging)return;
  yaw+=(e.clientX-px)*.007; elevation=Math.max(.18,Math.min(1.25,elevation+(e.clientY-py)*.004));
  px=e.clientX;py=e.clientY;draw();
});
const release=()=>{dragging=false;canvas.classList.remove("dragging");};
canvas.addEventListener("pointerup",release);
canvas.addEventListener("pointercancel",release);
canvas.addEventListener("wheel",e=>{
  e.preventDefault();
  zoom=Math.max(.55,Math.min(2.6,zoom*(e.deltaY>0?.91:1.1)));draw();
},{passive:false});
new ResizeObserver(draw).observe(canvas);

draw();
runAnalysis();
