/**
 * COMMANDS / W001 WindScreen — browser LBM core.
 *
 * Port of the algorithm and parameterization in Hark
 * W001_wind_screening.py (D2Q9 BGK + Smagorinsky, 2D at slice height).
 * The numerical routines are written in typed-array JavaScript so the
 * browser can execute in a Web Worker without a server or NumPy.
 *
 * Like the original W001 this is **screening only**: no vertical wind,
 * no downwash, no boundary layer and no NEN 8100 sign-off.
 */

const PI=Math.PI, RAD=PI/180;
const CX=[0,1,0,-1,0,1,-1,-1,1];
const CY=[0,0,1,0,-1,1,1,-1,-1];
const W=[4/9,1/9,1/9,1/9,1/9,1/36,1/36,1/36,1/36];
const OPP=[0,3,4,1,2,7,8,5,6];
export const WIND_PALETTE=[
  [0.0,[40,60,160]],
  [0.5,[60,170,200]],
  [0.85,[120,200,120]],
  [1.0,[245,220,70]],
  [1.2,[240,140,40]],
  [1.5,[190,30,40]]
];
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

/** Wind from 0=N, 90=E, 180=S, 270=W, model +Y = north. */
export function flowAxes(fromDeg,north=0){
  const angle=(fromDeg+180-north)*RAD;
  const X=[Math.sin(angle),Math.cos(angle)]; // downwind axis
  return {X,Y:[-X[1],X[0]]};
}
export function windRatioColor(r){
  const t=clamp(Number.isFinite(r)?r:0,0,1.5);
  for(let i=1;i<WIND_PALETTE.length;i++){
    const [a,c0]=WIND_PALETTE[i-1], [b,c1]=WIND_PALETTE[i];
    if(t<=b){
      const f=(t-a)/(b-a);
      return c0.map((v,k)=>Math.floor(v+(c1[k]-v)*f));
    }
  }
  return [...WIND_PALETTE.at(-1)[1]];
}

/**
 * Rasterize planar building sections into the wind-aligned frame.
 * The side padding mirrors W001: >= 2.5x cross-wind span to keep overall
 * 2D blockage low; the smaller upstream/downstream browser defaults are
 * explicitly disclosed in the UI as a fast screening preview.
 */
export function createWindGrid(scene,{
  windFrom=240,cell=4,slice=1.5,upstream=36,downstream=54
}={}){
  if(!scene?.buildings?.length)throw new Error("No buildings in scene.");
  if(!(cell>=1&&cell<=10))throw new Error("Grid cell must be 1–10 metres.");
  if(!Number.isFinite(windFrom))throw new Error("Wind direction is invalid.");
  if(!Number.isFinite(slice)||slice<0)throw new Error("Slice height must be nonnegative.");
  const buildings=scene.buildings.filter(b=>b.h>=slice);
  if(!buildings.length)throw new Error("No buildings intersect the analysis slice.");
  const {X,Y}=flowAxes(windFrom);
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
  for(const b of buildings){
    for(const x of [b.x,b.x+b.w])for(const y of [b.y,b.y+b.d]){
      const a=x*X[0]+y*X[1],c=x*Y[0]+y*Y[1];
      xmin=Math.min(xmin,a);xmax=Math.max(xmax,a);
      ymin=Math.min(ymin,c);ymax=Math.max(ymax,c);
    }
  }
  const side=Math.max(upstream,2.5*(ymax-ymin));
  const x0=xmin-upstream,y0=ymin-side;
  const nx=Math.ceil((xmax+downstream-x0)/cell);
  const ny=Math.ceil((ymax+side-y0)/cell);
  if(nx*ny>85000)throw new Error("Grid too large for browser preview.");
  const solid=new Uint8Array(nx*ny);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const along=x0+(i+.5)*cell,cross=y0+(j+.5)*cell;
    const x=along*X[0]+cross*Y[0];
    const y=along*X[1]+cross*Y[1];
    for(const b of buildings){
      if(x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.d){
        solid[j*nx+i]=1;break;
      }
    }
  }
  return {
    nx,ny,cell,x0,y0,windFrom,slice,
    X,Y,solid,
    obstacles:buildings.length,
    area:solid.reduce((n,v)=>n+v,0)*cell*cell
  };
}

/**
 * Scalar typed-array D2Q9 BGK LBM with local Smagorinsky viscosity.
 *
 * Matches W001's D2Q9 directions, equilibrium, tau formula, average window,
 * bounce-back, periodic crosswind sides and speed normalization.
 *
 * For browser responsiveness: reduced domain/step defaults, explicit inlet
 * equilibrium and last-column zero-gradient outflow instead of the full
 * NumPy/Zou-He vectorized inlet reconstruction.
 */
export function solveWindLBM(grid,{
  steps=1250,u0=0.075,tau0=0.54,cs=0.15,avgFraction=.5,
  onProgress=()=>{}
}={}){
  const {nx,ny,solid}=grid, N=nx*ny;
  if(nx<8||ny<8)throw new Error("Domain is too small.");
  if(!(steps>=100&&steps<=6500))throw new Error("Steps must be in 100–6500.");
  const f=Array.from({length:9},()=>new Float64Array(N));
  const post=Array.from({length:9},()=>new Float64Array(N));
  const next=Array.from({length:9},()=>new Float64Array(N));
  const eqIn=W.map((w,k)=>{
    const cu=3*CX[k]*u0;
    return w*(1+cu+.5*cu*cu-1.5*u0*u0);
  });
  const eqRest=W.slice();
  for(let k=0;k<9;k++){
    const fk=f[k];
    for(let p=0;p<N;p++)fk[p]=solid[p]?eqRest[k]:eqIn[k];
  }

  // -2 marks bounce-back from an obstacle; -1 the wind inlet; -3 outlet.
  const src=Array.from({length:9},()=>new Int32Array(N));
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const p=j*nx+i;
    for(let k=0;k<9;k++){
      const i0=i-CX[k];
      if(i0<0){src[k][p]=-1;continue;}
      if(i0>=nx){src[k][p]=-3;continue;}
      let j0=j-CY[k];
      if(j0<0)j0=ny-1;
      else if(j0>=ny)j0=0;
      const n=j0*nx+i0;
      src[k][p]=solid[n]?-2:n;
    }
  }
  const accumU=new Float64Array(N);
  const accumV=new Float64Array(N);
  const accumSpeed=new Float64Array(N);
  const diffs=new Float64Array(9);
  const start=Math.floor(steps*(1-avgFraction));
  let samples=0;
  const cxx=[0,1,0,1,0,1,1,1,1];
  const cyy=[0,0,1,0,1,1,1,1,1];
  const cxy=CX.map((x,k)=>x*CY[k]);

  for(let t=0;t<steps;t++){
    for(let j=0;j<ny;j++){
      const row=j*nx;
      for(let i=0;i<nx;i++){
        const p=row+i;
        if(solid[p])continue;

        // Explicit constant-velocity inflow; low-gradient downstream.
        if(i===0){
          for(let k=0;k<9;k++)f[k][p]=eqIn[k];
        }else if(i===nx-1){
          for(let k=0;k<9;k++)f[k][p]=f[k][p-1];
        }

        let rho=0,ux=0,uy=0;
        for(let k=0;k<9;k++){
          const v=f[k][p];
          rho+=v;ux+=v*CX[k];uy+=v*CY[k];
        }
        if(!Number.isFinite(rho)||rho<.05||rho>8)
          throw new Error("Flow became unstable. Use a coarser grid or reduce steps.");
        ux/=rho;uy/=rho;
        const usq=ux*ux+uy*uy;
        let pxx=0,pyy=0,pxy=0;
        for(let k=0;k<9;k++){
          const cu=3*(CX[k]*ux+CY[k]*uy);
          const feq=W[k]*rho*(1+cu+.5*cu*cu-1.5*usq);
          const diff=f[k][p]-feq;
          diffs[k]=diff;
          pxx+=diff*cxx[k];pyy+=diff*cyy[k];pxy+=diff*cxy[k];
        }
        const q=Math.sqrt(pxx*pxx+pyy*pyy+2*pxy*pxy);
        const tau=.5*(tau0+Math.sqrt(tau0*tau0+18*Math.SQRT2*cs*cs*q/rho));
        const invTau=1/tau;
        for(let k=0;k<9;k++)post[k][p]=f[k][p]-diffs[k]*invTau;

        if(t>=start){
          const speed=Math.hypot(ux,uy);
          accumU[p]+=ux;accumV[p]+=uy;accumSpeed[p]+=speed;
        }
      }
    }
    if(t>=start)samples++;
    for(let p=0;p<N;p++){
      if(solid[p])continue;
      for(let k=0;k<9;k++){
        const from=src[k][p];
        next[k][p]=from>=0?post[k][from]:
          from===-2?post[OPP[k]][p]:
          from===-1?eqIn[k]:
          post[k][p];
      }
    }
    for(let k=0;k<9;k++){
      const old=f[k];
      f[k]=next[k];
      next[k]=old;
    }
    if((t+1)%50===0||t===steps-1){
      onProgress((t+1)/steps,t+1,steps);
    }
  }

  const ratio=new Float32Array(N);
  const vx=new Float32Array(N);
  const vy=new Float32Array(N);
  const speed=new Float32Array(N);
  let edge=0,edgeCount=0;
  for(let i=0;i<nx;i++){
    for(const j of [0,ny-1]){
      const p=j*nx+i;
      if(solid[p])continue;
      edge+=accumSpeed[p]/Math.max(1,samples);
      edgeCount++;
    }
  }
  const ref=edgeCount?edge/edgeCount:u0;
  if(!Number.isFinite(ref)||ref<1e-5)throw new Error("No valid free-field reference speed.");
  let min=Infinity,max=-Infinity,sum=0,count=0,sheltered=0,accelerated=0;
  for(let p=0;p<N;p++){
    if(solid[p])continue;
    const mean=accumSpeed[p]/Math.max(1,samples);
    const r=mean/ref;
    ratio[p]=r;
    vx[p]=accumU[p]/Math.max(1,samples);
    vy[p]=accumV[p]/Math.max(1,samples);
    speed[p]=mean;
    min=Math.min(min,r);max=Math.max(max,r);sum+=r;count++;
    if(r<.5)sheltered++;
    if(r>1.2)accelerated++;
  }
  return {
    ratio,vx,vy,speed,
    ref,steps,samples,
    metrics:{
      count,min,max,mean:sum/Math.max(1,count),
      shelteredArea:sheltered*grid.cell**2,
      acceleratedArea:accelerated*grid.cell**2,
      exposedArea:count*grid.cell**2,
      shelteredPercent:count?100*sheltered/count:0,
      acceleratedPercent:count?100*accelerated/count:0
    }
  };
}

/** Color-mapped screen at pedestrian height as real 3D quad faces. */
export function makeWindCells(grid,result){
  const {nx,ny,cell,x0,y0,X,Y,solid,slice}=grid;
  const cells=[];
  const toWorld=(a,b)=>[
    a*X[0]+b*Y[0],
    a*X[1]+b*Y[1],
    slice
  ];
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const p=j*nx+i;
    if(solid[p])continue;
    const u=x0+i*cell,v=y0+j*cell;
    cells.push({
      building:"wind",surface:"wind",
      corners:[
        toWorld(u,v),toWorld(u+cell,v),
        toWorld(u+cell,v+cell),toWorld(u,v+cell)
      ],
      center:toWorld(u+cell*.5,v+cell*.5),
      normal:[0,0,1],
      hours:result.ratio[p],
      i,j,
      vx:result.vx[p],vy:result.vy[p]
    });
  }
  return cells;
}

/** Bilinear flow sampling in the solver's wind-aligned coordinate system. */
export function flowAt(grid,result,worldX,worldY){
  const {X,Y,x0,y0,cell,nx,ny,solid}=grid;
  const u=worldX*X[0]+worldY*X[1];
  const v=worldX*Y[0]+worldY*Y[1];
  const a=(u-x0)/cell-.5,b=(v-y0)/cell-.5;
  const i=Math.floor(a),j=Math.floor(b),fx=a-i,fy=b-j;
  if(i<0||i+1>=nx||j<0||j+1>=ny)return null;
  let ux=0,uy=0,weight=0;
  for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++){
    const idx=(j+dy)*nx+i+dx;
    if(solid[idx])return null;
    const k=(dx?fx:1-fx)*(dy?fy:1-fy);
    ux+=result.vx[idx]*k;uy+=result.vy[idx]*k;weight+=k;
  }
  if(weight<1e-8)return null;
  return {
    x:(ux*X[0]+uy*Y[0])/weight,
    y:(ux*X[1]+uy*Y[1])/weight
  };
}
