import test from "node:test";
import assert from "node:assert/strict";
import {getScene} from "../public/demo/sunhours-engine.js";
import {
  flowAxes,windRatioColor,createWindGrid,
  solveWindLBM,makeWindCells,flowAt
} from "../public/demo/wind-engine.js";

const scene=getScene("courtyard");
const close=(a,b,epsilon=1e-8)=>Math.abs(a-b)<epsilon;

test("Wind-from convention matches W001: North blows south, East blows west",()=>{
  const north=flowAxes(0).X;
  const east=flowAxes(90).X;
  assert.ok(close(north[0],0)&&close(north[1],-1));
  assert.ok(close(east[0],-1)&&close(east[1],0));
});

test("WindScreen CFD palette maps exact U/U∞ values consistently",()=>{
  assert.deepEqual(windRatioColor(0),[35,49,150]);
  assert.deepEqual(windRatioColor(.3),[55,102,213]);
  assert.deepEqual(windRatioColor(.55),[49,188,220]);
  assert.deepEqual(windRatioColor(.8),[60,207,166]);
  assert.deepEqual(windRatioColor(1),[241,219,74]);
  assert.deepEqual(windRatioColor(1.2),[255,140,49]);
  assert.deepEqual(windRatioColor(1.5),[210,40,66]);
  assert.deepEqual(windRatioColor(2),[210,40,66]);
});

test("Rasterization uses the real W001 courtyard footprints and 2.5x crosswind padding",()=>{
  const grid=createWindGrid(scene,{windFrom:240,cell:5,slice:1.5});
  assert.ok(grid.nx>=20&&grid.ny>=50);
  assert.ok(grid.solid.some(Boolean));
  assert.ok(grid.area>0);
  assert.equal(grid.obstacles,4);
  const raised=createWindGrid(scene,{windFrom:240,cell:5,slice:18});
  assert.ok(raised.obstacles<grid.obstacles,
    "Higher slices ignore shorter masses; original 1.5 m model includes all");
});

test("Unobstructed D2Q9 flow is uniform and normalized around 1×",()=>{
  const grid={
    nx:22,ny:18,cell:4,solid:new Uint8Array(22*18),
    windFrom:270,slice:1.5,x0:0,y0:0,X:[1,0],Y:[0,1]
  };
  const result=solveWindLBM(grid,{steps:160});
  assert.ok(Number.isFinite(result.ref));
  assert.ok(Math.abs(result.metrics.mean-1)<.035);
  assert.ok(Math.abs(result.metrics.max-1)<.08);
  assert.equal(result.metrics.shelteredArea,0);
  assert.equal(result.metrics.acceleratedArea,0);
});

test("Courtyard creates relative acceleration and shelter from actual obstacle collisions",()=>{
  const grid=createWindGrid(scene,{windFrom:240,cell:5});
  const progress=[];
  const result=solveWindLBM(grid,{
    steps:350,
    onProgress:(fraction,iteration,total)=>progress.push({fraction,iteration,total})
  });
  assert.equal(result.ratio.length,grid.nx*grid.ny);
  assert.equal(result.vx.length,grid.nx*grid.ny);
  assert.equal(result.vy.length,grid.nx*grid.ny);
  assert.ok(result.metrics.min<.5,"There must be a sheltered wake");
  assert.ok(result.metrics.max>1.2,"There must be local acceleration");
  assert.ok(result.metrics.shelteredArea>0);
  assert.ok(result.metrics.acceleratedArea>0);
  assert.ok(Math.abs(progress.at(-1).fraction-1)<1e-12);
  const cells=makeWindCells(grid,result);
  assert.equal(cells.length,result.metrics.count);
  const sample=cells[Math.floor(cells.length/2)];
  assert.equal(sample.corners.length,4);
  assert.equal(sample.cornerRatios.length,4);
  assert.ok(sample.cornerRatios.every(Number.isFinite));
  assert.equal(sample.normal[2],1);
  assert.ok(Number.isFinite(sample.hours));
  const vel=flowAt(grid,result,sample.center[0],sample.center[1]);
  assert.ok(vel && Number.isFinite(vel.x) && Number.isFinite(vel.y));
});

test("Grid geometry rotates with incoming direction",()=>{
  const w=createWindGrid(scene,{windFrom:270,cell:5});
  const s=createWindGrid(scene,{windFrom:180,cell:5});
  assert.notDeepEqual(w.X,s.X);
  assert.notEqual(w.solid.reduce((sum,n)=>sum+n,0),0);
  assert.notEqual(s.solid.reduce((sum,n)=>sum+n,0),0);
});

test("Invalid resolution and absent obstacles fail safely",()=>{
  assert.throws(()=>createWindGrid(scene,{cell:.05}),/Grid cell/);
  assert.throws(()=>createWindGrid(scene,{slice:999}),/No buildings/);
});
