/**
 * COMMANDS / WindScreen renderer.
 *
 * Reuses the real depth-tested Rhino-inspired 3D viewport from SunHours.
 * The 1.5 m simulation field is mapped onto a world-space horizontal mesh.
 * A transparent overlay draws flow vectors and animated, field-following
 * tracers. Tracers illustrate the computed mean 2D vector field; they are
 * not a transient/3D CFD particle simulation.
 */
import {SunHoursViewer} from "./sunhours-viewer.js?v=12";
import {makeWindCells,windRatioColor,flowAt} from "./wind-engine.js?v=2";

const PI=Math.PI;
const unit=(x,y)=>{
  const n=Math.hypot(x,y)||1;
  return [x/n,y/n];
};
function seed(i){
  let n=(i*1103515245+12345)>>>0;
  n=(n^n>>>16)*2246822519;
  return ((n>>>0)%10000)/10000;
}

export class WindViewer {
  constructor(canvas,overlay){
    this.canvas=canvas;
    this.overlay=overlay;
    this.viewer=new SunHoursViewer(canvas);
    this.viewer.onDraw=()=>this.drawOverlay();
    this.ctx=overlay.getContext("2d");
    this.scene=null;
    this.grid=null;
    this.solution=null;
    this.freeSpeed=6;
    this.arrows=true;
    this.particlesOn=true;
    this.particles=[];
    this.lastTime=0;
    this.lastPaint=0;
    this.resizeObserver=typeof ResizeObserver==="undefined"?null:
      new ResizeObserver(()=>this.drawOverlay());
    this.resizeObserver?.observe(canvas);
    this.tick=this.tick.bind(this);
    this.animation=requestAnimationFrame(this.tick);
  }

  setScene(scene){
    this.scene=scene;
    this.grid=null;
    this.solution=null;
    this.particles=[];
    this.viewer.setData(scene,null);
    this.drawOverlay();
  }

  setData(scene,grid,solution){
    this.scene=scene;
    this.grid=grid;
    this.solution=solution;
    const cells=makeWindCells(grid,solution);
    this.viewer.setData(scene,{
      kind:"wind",
      cells,daylightHours:1.5,colorFor:windRatioColor
    });
    this.initParticles();
    this.drawOverlay();
  }

  setSpeed(ms){
    this.freeSpeed=Math.max(0,Number(ms)||0);
  }

  initParticles(){
    const count=115;
    this.particles=[];
    for(let i=0;i<count;i++)this.particles.push(this.spawn(i,true));
  }

  spawn(i,spread=false){
    const grid=this.grid;
    if(!grid)return {x:0,y:0,trail:[],age:0};
    const a=grid.x0+grid.cell*(1.8+seed(i*7)*2.5);
    const b=grid.y0+grid.ny*grid.cell*(.025+.95*seed(i*37+173));
    // Seed some tracers farther downstream so the first frame isn't empty.
    const u=spread?a+seed(i*17+19)*grid.nx*grid.cell*.80:a;
    const x=u*grid.X[0]+b*grid.Y[0];
    const y=u*grid.X[1]+b*grid.Y[1];
    return {x,y,trail:[],age:0};
  }

  step(dt){
    if(!this.solution||!this.grid)return;
    const speedScale=this.freeSpeed/Math.max(.001,this.solution.ref);
    for(let i=0;i<this.particles.length;i++){
      const p=this.particles[i];
      const vel=flowAt(this.grid,this.solution,p.x,p.y);
      if(!vel||!Number.isFinite(vel.x)||!Number.isFinite(vel.y)
         ||p.age>75||Math.hypot(vel.x,vel.y)<.001){
        this.particles[i]=this.spawn(i);
        continue;
      }
      p.trail.push([p.x,p.y]);
      if(p.trail.length>7)p.trail.shift();
      // The vector field is steady; we integrate just for visualization.
      p.x+=vel.x*speedScale*dt;
      p.y+=vel.y*speedScale*dt;
      p.age+=dt;
    }
  }

  tick(now){
    if(this.lastTime){
      const dt=Math.min(.065,Math.max(0,(now-this.lastTime)/1000));
      if(this.particlesOn&&this.solution)this.step(dt);
      if(now-this.lastPaint>=32){
        this.drawOverlay();
        this.lastPaint=now;
      }
    }
    this.lastTime=now;
    this.animation=requestAnimationFrame(this.tick);
  }

  point(x,y){
    return this.viewer.projectWorld([x,y,(this.grid?.slice||1.5)+.20]);
  }
  clearCanvas(){
    const w=this.canvas.clientWidth,h=this.canvas.clientHeight;
    if(w<=0||h<=0)return false;
    const dpr=Math.min(2,window.devicePixelRatio||1);
    const wpx=Math.round(w*dpr),hpx=Math.round(h*dpr);
    if(this.overlay.width!==wpx||this.overlay.height!==hpx){
      this.overlay.width=wpx;this.overlay.height=hpx;
    }
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
    this.ctx.clearRect(0,0,w,h);
    return true;
  }

  drawOverlay(){
    if(!this.clearCanvas()||!this.grid||!this.solution)return;
    const ctx=this.ctx;
    if(this.arrows){
      const {nx,ny,solid,cell,x0,y0,X,Y}=this.grid;
      const {vx,vy,ratio}=this.solution;
      const stride=Math.max(5,Math.round(29/cell));
      ctx.strokeStyle="rgba(31,40,43,.55)";
      ctx.fillStyle="rgba(31,40,43,.56)";
      ctx.lineWidth=1.05;
      for(let j=2;j<ny-2;j+=stride)for(let i=2;i<nx-2;i+=stride){
        const p=j*nx+i;
        if(solid[p]||ratio[p]<.12)continue;
        const localX=vx[p],localY=vy[p];
        const wx=localX*X[0]+localY*Y[0];
        const wy=localX*X[1]+localY*Y[1];
        const [dx,dy]=unit(wx,wy);
        const u=x0+(i+.5)*cell,v=y0+(j+.5)*cell;
        const a=u*X[0]+v*Y[0],b=u*X[1]+v*Y[1];
        const length=cell*1.55;
        const head=this.point(a+dx*length/2,b+dy*length/2);
        const tail=this.point(a-dx*length/2,b-dy*length/2);
        if(!head||!tail)continue;
        const vx2=head[0]-tail[0],vy2=head[1]-tail[1];
        const norm=Math.hypot(vx2,vy2);
        if(norm<2||norm>80)continue;
        ctx.beginPath();ctx.moveTo(tail[0],tail[1]);ctx.lineTo(head[0],head[1]);ctx.stroke();
        const ux=vx2/norm,uy=vy2/norm;
        ctx.beginPath();
        ctx.moveTo(head[0],head[1]);
        ctx.lineTo(head[0]-ux*5-uy*2.7,head[1]-uy*5+ux*2.7);
        ctx.lineTo(head[0]-ux*5+uy*2.7,head[1]-uy*5-ux*2.7);
        ctx.closePath();ctx.fill();
      }
    }

    if(this.particlesOn){
      ctx.lineWidth=1.6;
      ctx.strokeStyle="rgba(255,255,255,.88)";
      for(const p of this.particles){
        if(p.trail.length<2)continue;
        const projected=[...p.trail,[p.x,p.y]].map(v=>this.point(v[0],v[1]));
        if(projected.some(v=>!v))continue;
        ctx.beginPath();
        for(let k=0;k<projected.length;k++){
          const [x,y]=projected[k];
          if(k===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
        }
        ctx.stroke();
        const end=projected.at(-1);
        ctx.beginPath();ctx.arc(end[0],end[1],1.6,0,PI*2);
        ctx.fillStyle="rgba(255,255,255,.9)";ctx.fill();
      }
    }
  }

  exportPNG(name="WindScreen.png"){
    this.viewer.draw();
    this.drawOverlay();
    const tmp=document.createElement("canvas");
    tmp.width=this.canvas.width;tmp.height=this.canvas.height;
    const ctx=tmp.getContext("2d");
    ctx.drawImage(this.canvas,0,0);
    ctx.drawImage(this.overlay,0,0,tmp.width,tmp.height);
    const a=document.createElement("a");
    a.href=tmp.toDataURL("image/png");a.download=name;a.click();
  }

  dispose(){
    cancelAnimationFrame(this.animation);
    this.resizeObserver?.disconnect();
  }
}
