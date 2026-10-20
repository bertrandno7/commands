/**
 * Background worker for COMMANDS WindScreen.
 * Solver runs completely off the UI thread, without remote services.
 */
import { solveWindLBM } from "./wind-engine.js?v=2";

self.onmessage = event => {
  const {id,grid,steps}=event.data||{};
  if(!grid?.solid)return;
  try{
    const started=performance.now();
    const solution=solveWindLBM(grid,{
      steps,
      onProgress:(fraction,iteration,total)=>{
        self.postMessage({type:"progress",id,fraction,iteration,total});
      }
    });
    const elapsedMs=Math.round(performance.now()-started);
    self.postMessage({type:"result",id,solution,elapsedMs},[
      solution.ratio.buffer,
      solution.vx.buffer,
      solution.vy.buffer,
      solution.speed.buffer
    ]);
  }catch(error){
    self.postMessage({
      type:"error",id,
      message:error instanceof Error?error.message:String(error)
    });
  }
};
