import {pixelate,MODE_NAMES} from "./pixel-engine.js?v=1";
import {PixelViewer} from "./pixel-viewer.js?v=1";
const $=s=>document.querySelector(s);
const viewer=new PixelViewer($("#view"));
let latest=null;
let busy=false;
const controls={
 projection:$("#viewProjection"),lens:$("#viewLens"),
 orbit:$("#viewToolOrbit"),pan:$("#viewToolPan")
};

function refreshNav(){
 const cam=viewer.viewer,top=cam.projection==="top";
 controls.orbit.disabled=top;
 controls.lens.disabled=cam.projection!=="perspective";
 controls.orbit.classList.toggle("active",!top&&cam.activeTool==="orbit");
 controls.pan.classList.toggle("active",top||cam.activeTool==="pan");
 controls.orbit.setAttribute("aria-pressed",String(!top&&cam.activeTool==="orbit"));
 controls.pan.setAttribute("aria-pressed",String(top||cam.activeTool==="pan"));
 $("#navHint").textContent=top
  ?"TOP · RMB pan · wheel zoom · touch: 1-finger pan"
  :"PERSPECTIVE · RMB orbit · Shift+RMB pan · wheel zoom · touch: "+cam.activeTool;
}
controls.projection.addEventListener("change",e=>viewer.viewer.setProjection(e.target.value));
controls.lens.addEventListener("change",e=>viewer.viewer.setLens(Number(e.target.value)));
viewer.viewer.onProjectionChange=mode=>{controls.projection.value=mode;refreshNav();};
controls.orbit.addEventListener("click",()=>{viewer.viewer.setTool("orbit");refreshNav();});
controls.pan.addEventListener("click",()=>{viewer.viewer.setTool("pan");refreshNav();});
$("#viewReset").addEventListener("click",()=>viewer.reset());
$("#png").addEventListener("click",()=>viewer.exportPNG());
$("#obj").addEventListener("click",()=>viewer.exportOBJ());

function readOptions(){
 const size=Number($("#size").value);
 const h=Number($("#height").value);
 return {
  shape:$("#sourceShape").value,
  mode:Number($("#mode").value),
  size,height:h,gap:Number($("#gap").value),
  color:$("#colour").checked
 };
}
function refreshLabels(){
 const mode=Number($("#mode").value);
 $("#sizeLabel").textContent=Number($("#size").value).toFixed(1)+" m";
 $("#modeLabel").textContent=MODE_NAMES[mode].toUpperCase();
 $(".pixel-gradient").hidden=!$("#colour").checked;
 document.querySelectorAll("[data-mode]").forEach(b=>
  b.classList.toggle("selected",Number(b.dataset.mode)===mode));
}
function showError(error){
 $("#progressWrap").hidden=false;
 $("#progressLabel").textContent="Error: "+error.message;
 $("#resultLabel").textContent="Unable to generate this resolution";
 $("#viewStatus").textContent="Generation stopped";
 $("#obj").disabled=!latest;
}
function updateResults(r,elapsed){
 $("#count").textContent=r.count.toLocaleString();
 $("#volume").textContent=r.volume.toLocaleString(undefined,{maximumFractionDigits:0});
 $("#faces").textContent=r.geometry.surfaceFaces.toLocaleString();
 $("#triangles").textContent=r.geometry.triangles.toLocaleString();
 $("#duration").textContent=elapsed.toFixed(0)+" ms";
 $("#cellInfo").textContent=r.options.size+" × "+r.options.size+
  " × "+r.options.height+" m · "+r.count+" cells";
 $("#meshInfo").textContent="Mode "+r.modeName+
  " · "+Math.round(r.options.gap*100)+"% pixel scale";
 $("#resultLabel").textContent=r.modeName+" · "+r.options.shape+
  " · "+r.options.size.toFixed(1)+" m";
 $("#sceneSubtitle").textContent="Hark M004 · "+r.modeName+
  " · "+r.count.toLocaleString()+" pixels";
 $("#viewCount").textContent=r.count.toLocaleString()+" units";
 $("#viewStatus").textContent="3D mesh ready · "+r.geometry.triangles.toLocaleString()+" triangles";
 $("#progressWrap").hidden=false;
 $("#progress").style.width="100%";
 $("#progressLabel").textContent="Geometry complete ✓";
 $("#obj").disabled=false;
}
function generate(){
 if(busy)return;
 busy=true;$("#run").disabled=true;
 $("#viewStatus").textContent="Computing source geometry…";
 $("#progressWrap").hidden=false;
 $("#progressLabel").textContent="Sampling pixel centres…";
 $("#progress").style.width="18%";
 try{
  const started=performance.now();
  const result=pixelate(readOptions());
  if(!result.count)throw Error("No pixel centers fall inside the selected mass. Try a finer size.");
  const duration=performance.now()-started;
  viewer.show(result);
  latest=result;
  updateResults(result,duration);
 }catch(error){
  console.error(error);
  showError(error);
 }finally{
  busy=false;$("#run").disabled=false;
 }
}
let timer;
function schedule(){
 if(timer)clearTimeout(timer);
 timer=setTimeout(generate,110);
}
$("#pixelForm").addEventListener("submit",e=>{e.preventDefault();generate();});
$("#size").addEventListener("input",()=>{refreshLabels();schedule();});
$("#height").addEventListener("change",schedule);
$("#gap").addEventListener("change",schedule);
$("#sourceShape").addEventListener("change",schedule);
$("#mode").addEventListener("change",()=>{refreshLabels();schedule();});
$("#colour").addEventListener("change",()=>{refreshLabels();schedule();});
document.querySelectorAll("[data-mode]").forEach(button=>{
 button.addEventListener("click",()=>{
  $("#mode").value=button.dataset.mode;
  refreshLabels();generate();
 });
});
refreshLabels();refreshNav();generate();
