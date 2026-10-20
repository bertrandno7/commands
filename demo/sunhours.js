/**
 * COMMANDS / SunHours browser demo controller.
 * The analysis engine and the WebGL view are intentionally independent:
 * orbiting / panning / pinching never recalculates the sun hours.
 */
import {getScene, analyzeSunHours} from "./sunhours-engine.js?v=3";
import {SunHoursViewer} from "./sunhours-viewer.js?v=8";

const $=s=>document.querySelector(s);
const form=$("#analysisForm");
const button=$("#run");
const canvas=$("#view");
const viewer=new SunHoursViewer(canvas);
let scene=getScene("courtyard");
let result=null;
let pending=false;
let rerunRequested=false;

viewer.setData(scene,null);

// Rhino-style gesture mapping:
// Perspective RMB orbit; Shift+RMB pan; Ctrl+RMB or wheel zoom.
// Top RMB pan. Left-drag/one finger uses the chosen web-demo tool.
const viewProjection=$("#viewProjection");
const viewLens=$("#viewLens");
const orbitButton=$("#viewToolOrbit");
const panButton=$("#viewToolPan");

function setGestureTool(mode){
  viewer.setTool(mode);
  orbitButton.classList.toggle("active",mode==="orbit");
  panButton.classList.toggle("active",mode==="pan");
  orbitButton.setAttribute("aria-pressed",String(mode==="orbit"));
  panButton.setAttribute("aria-pressed",String(mode==="pan"));
  updateNavigationHint();
}
function updateNavigationHint(){
  const top=viewer.projection==="top";
  const isPerspective=viewer.projection==="perspective";
  const tool=top?"Pan":viewer.activeTool==="pan"?"Pan":"Orbit";
  orbitButton.disabled=top;
  viewLens.disabled=!isPerspective;
  orbitButton.classList.toggle("active",!top && viewer.activeTool==="orbit");
  panButton.classList.toggle("active",top || viewer.activeTool==="pan");
  orbitButton.setAttribute("aria-pressed",String(!top && viewer.activeTool==="orbit"));
  panButton.setAttribute("aria-pressed",String(top || viewer.activeTool==="pan"));
  $("#navHint").textContent=top
    ?"TOP · RMB pan · Ctrl+Shift+RMB rotate parallel · wheel zoom · touch: one-finger pan"
    :isPerspective
      ?"PERSPECTIVE · FREE 360° tumble · RMB orbit · Ctrl+Shift+RMB orbit object · Shift+RMB pan · Alt+RMB roll · wheel zoom · touch: one-finger "+tool.toLowerCase()
      :"PARALLEL · RMB pan · Ctrl+Shift+RMB orbit · wheel zoom · touch: one-finger "+tool.toLowerCase();
}
viewProjection.addEventListener("change",e=>viewer.setProjection(e.target.value));
viewLens.addEventListener("change",e=>viewer.setLens(e.target.value));
viewer.onProjectionChange=(mode)=>{
  viewProjection.value=mode;
  updateNavigationHint();
};
orbitButton.addEventListener("click",()=>setGestureTool("orbit"));
panButton.addEventListener("click",()=>setGestureTool("pan"));
setGestureTool("orbit");

const fmt=v=>v.toFixed(1)+" h";

function optionsFromForm(){
  const date=$("#date").value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("Choose a valid calendar date.");
  const [year,month,day]=date.split("-").map(Number);
  const check=new Date(Date.UTC(year,month-1,day));
  if(check.getUTCFullYear()!==year||check.getUTCMonth()+1!==month||
     check.getUTCDate()!==day)
    throw new Error("Invalid calendar date.");
  const lat=Number($("#lat").value),lon=Number($("#lon").value);
  if(!Number.isFinite(lat)||!Number.isFinite(lon))throw new Error("Enter valid coordinates.");
  return {
    lat,lon,year,month,day,
    step:Number($("#step").value),
    grid:Number($("#grid").value)
  };
}

function updateProgress(value){
  const percent=Math.round(value*100);
  $("#progress").style.width=percent+"%";
  $("#progressLabel").textContent="Computing solar visibility… "+percent+"%";
}

function showResults(r){
  $("#mean").textContent=fmt(r.metrics.mean);
  $("#max").textContent=fmt(r.metrics.max);
  $("#facade").textContent=fmt(r.metrics.facadeMean);
  $("#ground").textContent=fmt(r.metrics.groundMean);
  $("#daylight").textContent=fmt(r.daylightHours);
  $("#cellCount").textContent=r.metrics.cells.toLocaleString()+" sampled cells";
  $("#sunCount").textContent=r.metrics.samples+" sun positions";
  $("#timezone").textContent="UTC+"+r.timezone+" · "+r.options.year;
  $("#legendMax").textContent=fmt(r.daylightHours);
  $("#resultLabel").textContent=[
    r.options.day,r.options.month,r.options.year
  ].join(" / ")+" · "+scene.name;
  $("#viewStatus").textContent=r.metrics.sunlit2h.toFixed(1)+"% of cells receive ≥2 h";
  $("#csv").disabled=false;
}

async function runAnalysis(){
  if(pending){rerunRequested=true;return;}
  pending=true;
  button.disabled=true;
  $("#progressWrap").hidden=false;
  updateProgress(0);
  $("#viewStatus").textContent="Computing direct sunlight…";
  const analysedScene=scene;
  try{
    const options=optionsFromForm();
    const r=await analyzeSunHours(analysedScene,options,updateProgress);
    if(analysedScene===scene && !rerunRequested){
      result=r;
      viewer.setData(scene,r);
      showResults(r);
      $("#progressLabel").textContent="Analysis complete ✓";
    }
  }catch(err){
    console.error(err);
    $("#progressLabel").textContent="Error: "+err.message;
    $("#viewStatus").textContent="Analysis failed";
  }finally{
    pending=false;
    button.disabled=false;
    if(rerunRequested){
      rerunRequested=false;
      runAnalysis();
    }
  }
}

form.addEventListener("submit",e=>{e.preventDefault();runAnalysis();});
$("#scene").addEventListener("change",e=>{
  scene=getScene(e.target.value);
  result=null;
  viewer.setData(scene,null);
  $("#sceneTitle").textContent=scene.name;
  $("#sceneSubtitle").textContent=scene.subtitle;
  $("#viewStatus").textContent="Scene changed · calculating";
  $("#resultLabel").textContent="Scene modified — rerunning";
  $("#csv").disabled=true;
  runAnalysis();
});

document.querySelectorAll("[data-date]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    $("#date").value=btn.dataset.date;
    document.querySelectorAll("[data-date]").forEach(x=>
      x.classList.toggle("selected",x===btn));
    runAnalysis();
  });
});
$("#date").addEventListener("change",()=>{
  document.querySelectorAll("[data-date]").forEach(btn=>
    btn.classList.toggle("selected",btn.dataset.date===$("#date").value));
});

$("#viewReset").addEventListener("click",()=>viewer.reset());
$("#png").addEventListener("click",()=>viewer.savePNG("SunHours-"+$("#date").value+".png"));
$("#csv").addEventListener("click",()=>{
  if(!result)return;
  const rows=["building,surface,x,y,z,direct_sun_hours",
    ...result.cells.map(c=>[
      c.building,c.surface,...c.center.map(v=>v.toFixed(3)),
      c.hours.toFixed(4)
    ].join(","))
  ];
  const csv=new Blob([rows.join("\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(csv);
  const link=document.createElement("a");
  link.href=url;
  link.download="SunHours-"+$("#date").value+".csv";
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
});

runAnalysis();
