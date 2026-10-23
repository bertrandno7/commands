/**
 * COMMANDS / WindScreen browser demo controller.
 * All physics is executed by wind-worker.js, keeping 3D navigation responsive.
 */
import {getScene} from "./sunhours-engine.js?v=3";
import {createWindGrid,WIND_PALETTE} from "./wind-engine.js?v=2";
import {WindViewer} from "./wind-viewer.js?v=3";
const experimentalProjectMode=new URLSearchParams(location.search).get("project")==="1";
let projectTools=null;

const $=s=>document.querySelector(s);
const labels=[
  "N","NNE","NE","ENE","E","ESE","SE","SSE",
  "S","SSW","SW","WSW","W","WNW","NW","NNW"
];
const dirName=degrees=>labels[Math.round(((degrees%360)+360)%360/22.5)%16];
const number=n=>Number(n);
const fmtArea=m2=>m2>=1000?(m2/1000).toFixed(1)+"k m²":Math.round(m2)+" m²";

// Generate the legend from the SAME numeric stops used by WebGL.
const gradientStops=WIND_PALETTE.map(([ratio,color])=>
  "rgb("+color.join(",")+") "+(ratio/1.5*100).toFixed(2)+"%"
).join(", ");
$(".wind-gradient").style.background="linear-gradient(90deg, "+gradientStops+")";

const viewer=new WindViewer($("#view"),$("#flowOverlay"));
let scene=getScene("courtyard");
let project=null;
let field=null;
let currentGrid=null;
let running=null;
let runId=0;
let lastRunMs=null;
viewer.setScene(scene);

const controls={
  projection:$("#viewProjection"),lens:$("#viewLens"),
  orbit:$("#viewToolOrbit"),pan:$("#viewToolPan")
};
function updateNavigationHint(){
  const top=viewer.viewer.projection==="top";
  const perspective=viewer.viewer.projection==="perspective";
  controls.orbit.disabled=top;
  controls.lens.disabled=!perspective;
  controls.orbit.classList.toggle("active",!top&&viewer.viewer.activeTool==="orbit");
  controls.pan.classList.toggle("active",top||viewer.viewer.activeTool==="pan");
  controls.orbit.setAttribute("aria-pressed",String(!top&&viewer.viewer.activeTool==="orbit"));
  controls.pan.setAttribute("aria-pressed",String(top||viewer.viewer.activeTool==="pan"));
  const tool=top?"pan":viewer.viewer.activeTool;
  $("#navHint").textContent=top
    ?"TOP · RMB pan · wheel zoom · 1-finger pan"
    :perspective
      ?"PERSPECTIVE · RMB orbit · Shift+RMB pan · Ctrl+Shift+RMB pivot · wheel zoom · 1-finger "+tool
      :"PARALLEL · RMB pan · Ctrl+Shift+RMB orbit · wheel zoom · 1-finger "+tool;
}
controls.projection.addEventListener("change",e=>viewer.viewer.setProjection(e.target.value));
controls.lens.addEventListener("change",e=>viewer.viewer.setLens(e.target.value));
viewer.viewer.onProjectionChange=mode=>{
  controls.projection.value=mode;
  updateNavigationHint();
};
controls.orbit.addEventListener("click",()=>{
  viewer.viewer.setTool("orbit");updateNavigationHint();
});
controls.pan.addEventListener("click",()=>{
  viewer.viewer.setTool("pan");updateNavigationHint();
});
$("#viewReset").addEventListener("click",()=>viewer.viewer.reset());
$("#png").addEventListener("click",()=>viewer.exportPNG("WindScreen-"+$("#windDirection").value+"deg.png"));
$("#showArrows").addEventListener("change",e=>{
  viewer.arrows=e.target.checked;
  viewer.drawOverlay();
});
$("#showParticles").addEventListener("change",e=>{
  viewer.particlesOn=e.target.checked;
  viewer.drawOverlay();
});
updateNavigationHint();

function formValues(){
  const windFrom=number($("#windDirection").value);
  const freeSpeed=number($("#windSpeed").value);
  const [cell,steps]=$("#quality").value.split(":").map(number);
  return {windFrom,freeSpeed,cell,steps};
}

function updateCompass(){
  const windFrom=number($("#windDirection").value);
  const bearing=dirName(windFrom);
  $("#directionLabel").textContent=windFrom+"° · "+bearing;
  $("#compassLabel").textContent=windFrom+"° "+bearing;
  const to=(windFrom+180)%360;
  $("#towardsLabel").textContent="TO "+to+"° "+dirName(to);
  $("#windArrow").style.transform="rotate("+to+"deg)";
  document.querySelectorAll("[data-wind-from]").forEach(b=>{
    b.classList.toggle("selected",number(b.dataset.windFrom)===windFrom);
  });
}

function updateSpeed(){
  const speed=number($("#windSpeed").value);
  $("#speedLabel").textContent=speed.toFixed(1)+" m/s";
  viewer.setSpeed(speed);
  if(field)$("#scaled").textContent=(field.metrics.max*speed).toFixed(1)+" m/s";
}

function updateQuality(){
  const {cell,steps}=formValues();
  $("#solverNote").textContent=steps.toLocaleString()+" iterations · "+cell+
    " m cells · preliminary 2D screening";
}

function invalidate(message){
  // Never show stale heatmap colors beneath a newly selected wind direction.
  viewer.setScene(scene);
  field=null;currentGrid=null;lastRunMs=null;
  for(const id of ["mean","peak","sheltered","accelerated","scaled"])
    $("#"+id).textContent="—";
  for(const id of ["cellCount","stepCount","duration"])
    $("#"+id).textContent="—";
  $("#csv").disabled=true;
  $("#resultLabel").textContent=message;
}

function cancelCurrent(manual=false){
  if(running){
    running.worker.terminate();
    running=null;
  }
  $("#run").disabled=false;
  $("#cancel").hidden=true;
  if(manual){
    $("#progressLabel").textContent="Simulation cancelled";
    $("#viewStatus").textContent="Stopped · adjust and run again";
  }
}

function reportError(message){
  $("#progressWrap").hidden=false;
  $("#progressLabel").textContent="Error: "+message;
  $("#viewStatus").textContent="Solver stopped";
  $("#resultLabel").textContent="Calculation failed";
}

function resultUI(grid,solution,elapsedMs){
  const m=solution.metrics;
  $("#mean").textContent=m.mean.toFixed(2)+"×";
  $("#peak").textContent=m.max.toFixed(2)+"×";
  $("#sheltered").textContent=fmtArea(m.shelteredArea);
  $("#accelerated").textContent=fmtArea(m.acceleratedArea);
  $("#scaled").textContent=(m.max*number($("#windSpeed").value)).toFixed(1)+" m/s";
  $("#cellCount").textContent=m.count.toLocaleString()+" outdoor cells";
  $("#stepCount").textContent=solution.steps.toLocaleString()+" iterations";
  $("#duration").textContent=(elapsedMs/1000).toFixed(1)+" s solve time";
  $("#resultLabel").textContent=
    scene.name+" · wind from "+grid.windFrom+"° · "+grid.cell+" m grid"+
    (grid.project?" · 1.5 m above project base":"");
  $("#viewStatus").textContent=
    "Wind ratio "+m.mean.toFixed(2)+"× mean · "+m.acceleratedPercent.toFixed(1)+"% accelerated";
  $("#csv").disabled=false;
  $("#progressLabel").textContent="Wind field ready ✓";
  $("#progress").style.width="100%";
}

function runWind(){
  cancelCurrent();
  let grid,values;
  try{
    values=formValues();
    grid=project
      ?projectTools.createWindGridFromProject(project,{
          windFrom:values.windFrom,cell:values.cell,height:1.5
        })
      :createWindGrid(scene,{
          windFrom:values.windFrom,cell:values.cell,slice:1.5
        });
  }catch(err){
    reportError(err.message);return;
  }
  field=null;currentGrid=null;
  $("#csv").disabled=true;
  $("#run").disabled=true;
  $("#cancel").hidden=false;
  $("#progressWrap").hidden=false;
  $("#progress").style.width="0%";
  $("#progressLabel").textContent="Starting lattice-Boltzmann solver…";
  $("#viewStatus").textContent="Solving wind · viewport remains interactive";
  $("#resultLabel").textContent="Calculating · "+grid.nx+" × "+grid.ny+" cells";
  const job=++runId;
  let worker;
  try{
    worker=new Worker("./wind-worker.js?v=2",{type:"module"});
  }catch(err){
    $("#run").disabled=false;
    $("#cancel").hidden=true;
    reportError("Web Workers unavailable: "+err.message);
    return;
  }
  running={id:job,worker};
  worker.onmessage=event=>{
    const data=event.data||{};
    if(!running||data.id!==running.id)return;
    if(data.type==="progress"){
      const pct=Math.round(data.fraction*100);
      $("#progress").style.width=pct+"%";
      $("#progressLabel").textContent=
        "Solving flow · "+data.iteration.toLocaleString()+" / "+
        data.total.toLocaleString()+" steps ("+pct+"%)";
    }else if(data.type==="result"){
      const finished=running;
      finished.worker.terminate();running=null;
      $("#run").disabled=false;
      $("#cancel").hidden=true;
      currentGrid=grid;
      field=data.solution;
      lastRunMs=data.elapsedMs;
      viewer.setData(scene,grid,field);
      resultUI(grid,field,data.elapsedMs);
    }else if(data.type==="error"){
      worker.terminate();running=null;
      $("#run").disabled=false;$("#cancel").hidden=true;
      reportError(data.message||"Unknown solver error");
    }
  };
  worker.onerror=event=>{
    if(!running||running.id!==job)return;
    worker.terminate();running=null;
    $("#run").disabled=false;$("#cancel").hidden=true;
    reportError(event.message||"Worker could not start");
  };
  worker.postMessage({id:job,grid,steps:values.steps});
}

$("#windForm").addEventListener("submit",e=>{
  e.preventDefault();runWind();
});
$("#cancel").addEventListener("click",()=>cancelCurrent(true));

$("#scene").addEventListener("change",e=>{
  if(project)return;
  cancelCurrent();
  scene=getScene(e.target.value);
  viewer.setScene(scene);
  $("#sceneTitle").textContent=scene.name;
  $("#sceneSubtitle").textContent=scene.subtitle+" · W001 slice";
  invalidate("Scene changed · solving again");
  runWind();
});
$("#windDirection").addEventListener("input",updateCompass);
$("#windDirection").addEventListener("change",()=>{
  invalidate("Direction changed · solving again");
  runWind();
});
document.querySelectorAll("[data-wind-from]").forEach(b=>{
  b.addEventListener("click",()=>{
    const value=number(b.dataset.windFrom);
    if(number($("#windDirection").value)===value)return;
    $("#windDirection").value=String(value);
    updateCompass();invalidate("Direction changed · solving again");
    runWind();
  });
});
$("#windSpeed").addEventListener("input",updateSpeed);
$("#quality").addEventListener("change",()=>{
  updateQuality();invalidate("Resolution changed · solving again");runWind();
});

$("#csv").addEventListener("click",()=>{
  if(!field||!currentGrid)return;
  const {nx,ny,cell,x0,y0,X,Y,solid}=currentGrid;
  const speed=number($("#windSpeed").value);
  const rows=["x_m,y_m,z_m,speed_ratio,scaled_speed_mps,scaled_vx_mps,scaled_vy_mps"];
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const p=j*nx+i;if(solid[p])continue;
    const a=x0+(i+.5)*cell,b=y0+(j+.5)*cell;
    const x=a*X[0]+b*Y[0],y=a*X[1]+b*Y[1];
    const v=field.vx[p]*X[0]+field.vy[p]*Y[0];
    const w=field.vx[p]*X[1]+field.vy[p]*Y[1];
    const conversion=speed/field.ref;
    rows.push([
      x.toFixed(3),y.toFixed(3),"1.500",
      field.ratio[p].toFixed(5),
      (field.ratio[p]*speed).toFixed(4),
      (v*conversion).toFixed(4),
      (w*conversion).toFixed(4)
    ].join(","));
  }
  const url=URL.createObjectURL(new Blob([rows.join("\n")],{type:"text/csv"}));
  const a=document.createElement("a");
  a.href=url;a.download="WindScreen-"+currentGrid.windFrom+"deg.csv";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
});

window.addEventListener("beforeunload",()=>cancelCurrent());
updateCompass();updateSpeed();updateQuality();

async function useProjectGeometry(nextProject,error){
  cancelCurrent();
  project=nextProject;
  field=null;
  currentGrid=null;
  $("#csv").disabled=true;
  $("#scene").disabled=!!project;
  $("#sampleSceneField").classList.toggle("project-overridden",!!project);

  if(project){
    scene=projectTools.projectToViewerScene(project);
    viewer.setScene(scene);
    $("#sceneTitle").textContent=project.name;
    $("#sceneSubtitle").textContent=
      project.triangleCount.toLocaleString()+" triangles · W001 section at 1.5 m above base";
    invalidate("Project geometry · solving wind");
  }else{
    scene=getScene($("#scene").value);
    viewer.setScene(scene);
    $("#sceneTitle").textContent=scene.name;
    $("#sceneSubtitle").textContent=scene.subtitle+" · W001 slice";
    invalidate(error?"Project unavailable · using sample":"Sample geometry · solving wind");
  }
  runWind();
}

async function initialisePreview(){
  const mount=$("#projectGeometryMount");
  if(!experimentalProjectMode){
    if(mount)mount.hidden=true;
    runWind();
    return;
  }

  if(mount)mount.hidden=false;
  const [analysisModule,geometryModule,panelModule]=await Promise.all([
    import("./project-analysis.js?v=1"),
    import("./project-geometry.js?v=1"),
    import("./project-panel.js?v=1")
  ]);
  projectTools={
    createWindGridFromProject:analysisModule.createWindGridFromProject,
    projectToViewerScene:geometryModule.projectToViewerScene
  };
  await panelModule.attachProjectPanel({
    mount,
    onProjectChanged:useProjectGeometry
  });
}

initialisePreview().catch(error=>{
  console.error(error);
  useProjectGeometry(null,error);
});
