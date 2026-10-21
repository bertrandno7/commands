/**
 * Geometry adapters that let multiple COMMANDS consume the same uploaded
 * Project Geometry without teaching each command how OBJ/STL/GLB works.
 */
import {sunSamples} from "./sunhours-engine.js?v=3";
import {flowAxes} from "./wind-engine.js?v=2";

const EPS=1e-7;
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a,b)=>[
  a[1]*b[2]-a[2]*b[1],
  a[2]*b[0]-a[0]*b[2],
  a[0]*b[1]-a[1]*b[0]
];
const length=a=>Math.hypot(a[0],a[1],a[2]);
const normalize=a=>{
  const n=length(a)||1;
  return [a[0]/n,a[1]/n,a[2]/n];
};
const mix=(a,b,t)=>[
  a[0]+(b[0]-a[0])*t,
  a[1]+(b[1]-a[1])*t,
  a[2]+(b[2]-a[2])*t
];
function triAt(positions,index){
  const k=index*9;
  return [
    [positions[k],positions[k+1],positions[k+2]],
    [positions[k+3],positions[k+4],positions[k+5]],
    [positions[k+6],positions[k+7],positions[k+8]]
  ];
}
function mergePositions(a,b){
  const out=new Float32Array(a.length+b.length);
  out.set(a,0);out.set(b,a.length);
  return out;
}

/* ------------------------------ BVH ray casting ------------------------------ */

function makeBvh(positions){
  const count=positions.length/9;
  const ids=Array.from({length:count},(_,i)=>i);
  const centers=new Float32Array(count*3);
  const boxes=new Float32Array(count*6);

  for(let i=0;i<count;i++){
    const [a,b,c]=triAt(positions,i);
    const min=[
      Math.min(a[0],b[0],c[0]),Math.min(a[1],b[1],c[1]),Math.min(a[2],b[2],c[2])
    ];
    const max=[
      Math.max(a[0],b[0],c[0]),Math.max(a[1],b[1],c[1]),Math.max(a[2],b[2],c[2])
    ];
    boxes.set([...min,...max],i*6);
    centers.set([(min[0]+max[0])/2,(min[1]+max[1])/2,(min[2]+max[2])/2],i*3);
  }

  const build=(start,end)=>{
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    const cmin=[Infinity,Infinity,Infinity],cmax=[-Infinity,-Infinity,-Infinity];
    for(let p=start;p<end;p++){
      const id=ids[p],bk=id*6,ck=id*3;
      for(let axis=0;axis<3;axis++){
        min[axis]=Math.min(min[axis],boxes[bk+axis]);
        max[axis]=Math.max(max[axis],boxes[bk+3+axis]);
        cmin[axis]=Math.min(cmin[axis],centers[ck+axis]);
        cmax[axis]=Math.max(cmax[axis],centers[ck+axis]);
      }
    }
    const node={min,max,start,end,left:null,right:null};
    if(end-start<=12)return node;
    const spans=cmax.map((v,i)=>v-cmin[i]);
    const axis=spans[0]>=spans[1]&&spans[0]>=spans[2]?0:spans[1]>=spans[2]?1:2;
    const sorted=ids.slice(start,end).sort((a,b)=>centers[a*3+axis]-centers[b*3+axis]);
    for(let i=0;i<sorted.length;i++)ids[start+i]=sorted[i];
    const mid=(start+end)>>1;
    node.left=build(start,mid);
    node.right=build(mid,end);
    return node;
  };

  const root=count?build(0,count):null;

  const hitsBox=(origin,dir,node)=>{
    let near=0,far=Infinity;
    for(let axis=0;axis<3;axis++){
      const d=dir[axis];
      if(Math.abs(d)<1e-12){
        if(origin[axis]<node.min[axis]||origin[axis]>node.max[axis])return false;
        continue;
      }
      let t0=(node.min[axis]-origin[axis])/d;
      let t1=(node.max[axis]-origin[axis])/d;
      if(t0>t1)[t0,t1]=[t1,t0];
      near=Math.max(near,t0);far=Math.min(far,t1);
      if(far<near)return false;
    }
    return far>1e-5;
  };
  const hitsTri=(origin,dir,id)=>{
    const [a,b,c]=triAt(positions,id);
    const e1=sub(b,a),e2=sub(c,a),p=cross(dir,e2),det=dot(e1,p);
    if(Math.abs(det)<1e-10)return false;
    const inv=1/det,t=sub(origin,a),u=dot(t,p)*inv;
    if(u<0||u>1)return false;
    const q=cross(t,e1),v=dot(dir,q)*inv;
    if(v<0||u+v>1)return false;
    const distance=dot(e2,q)*inv;
    return distance>1e-4;
  };

  return {
    blocked(origin,dir,ignore=-1){
      if(!root)return false;
      const stack=[root];
      while(stack.length){
        const node=stack.pop();
        if(!hitsBox(origin,dir,node))continue;
        if(node.left){
          stack.push(node.left,node.right);
          continue;
        }
        for(let p=node.start;p<node.end;p++){
          const id=ids[p];
          if(id===ignore)continue;
          if(hitsTri(origin,dir,id))return true;
        }
      }
      return false;
    }
  };
}

/* ----------------------------- SunHours adapter ----------------------------- */

function signedVolume(positions){
  let volume=0;
  for(let i=0;i<positions.length;i+=9){
    const a=[positions[i],positions[i+1],positions[i+2]];
    const b=[positions[i+3],positions[i+4],positions[i+5]];
    const c=[positions[i+6],positions[i+7],positions[i+8]];
    volume+=dot(a,cross(b,c))/6;
  }
  return volume;
}
function maxEdge(a,b,c){
  return Math.max(length(sub(b,a)),length(sub(c,b)),length(sub(a,c)));
}
function bary(a,b,c,u,v){
  return [
    a[0]+(b[0]-a[0])*u+(c[0]-a[0])*v,
    a[1]+(b[1]-a[1])*u+(c[1]-a[1])*v,
    a[2]+(b[2]-a[2])*u+(c[2]-a[2])*v
  ];
}
function estimateCells(positions,grid){
  let count=0;
  for(let i=0;i<positions.length/9;i++){
    const [a,b,c]=triAt(positions,i);
    const n=Math.max(1,Math.min(10,Math.ceil(maxEdge(a,b,c)/grid)));
    count+=n*n;
  }
  return count;
}
function makeProjectSunCells(project,requestedGrid,maxCells=22000){
  const positions=project.analysis.positions;
  if(!positions.length)throw new Error("Project has no analysis geometry.");
  let grid=requestedGrid;
  const estimated=estimateCells(positions,grid);
  if(estimated>maxCells)grid*=Math.sqrt(estimated/maxCells);

  const reverse=signedVolume(positions)<-1e-5;
  const cells=[];
  for(let sourceIndex=0;sourceIndex<positions.length/9;sourceIndex++){
    const [a,b,c]=triAt(positions,sourceIndex);
    let normal=normalize(cross(sub(b,a),sub(c,a)));
    if(reverse)normal=normal.map(v=>-v);
    if(!normal.every(Number.isFinite)||length(normal)<.5)continue;
    const n=Math.max(1,Math.min(10,Math.ceil(maxEdge(a,b,c)/grid)));
    for(let i=0;i<n;i++)for(let j=0;j<n-i;j++){
      const p00=bary(a,b,c,i/n,j/n);
      const p10=bary(a,b,c,(i+1)/n,j/n);
      const p01=bary(a,b,c,i/n,(j+1)/n);
      const first=[p00,p10,p01];
      cells.push(makeSunCell(first,normal,sourceIndex));
      if(i+j<n-1){
        const p11=bary(a,b,c,(i+1)/n,(j+1)/n);
        cells.push(makeSunCell([p10,p11,p01],normal,sourceIndex));
      }
    }
  }
  return {cells,effectiveGrid:grid};
}
function makeSunCell(corners,normal,sourceIndex){
  const center=[
    (corners[0][0]+corners[1][0]+corners[2][0])/3,
    (corners[0][1]+corners[1][1]+corners[2][1])/3,
    (corners[0][2]+corners[1][2]+corners[2][2])/3
  ];
  const nz=normal[2];
  return {
    building:"project",
    surface:nz>.65?"roof":nz<-.65?"underside":"facade",
    corners,center,normal,sourceIndex,hours:0
  };
}
function meanHours(cells,predicate){
  const selected=cells.filter(predicate);
  return selected.length?
    selected.reduce((sum,c)=>sum+c.hours,0)/selected.length:0;
}
export async function analyzeProjectSunHours(project,options={},onProgress=()=>{}){
  const opts={
    lat:51.92,lon:4.48,year:2026,month:6,day:21,
    step:30,grid:4,tz:null,north:0,...options
  };
  const time=sunSamples(opts);
  const {cells,effectiveGrid}=makeProjectSunCells(project,opts.grid);
  const combined=mergePositions(project.analysis.positions,project.context.positions);
  const bvh=makeBvh(combined);
  const n=time.samples.length;

  for(let k=0;k<n;k++){
    const sun=time.samples[k].dir;
    for(const cell of cells){
      if(dot(cell.normal,sun)<=1e-8)continue;
      const origin=[
        cell.center[0]+cell.normal[0]*.025+sun[0]*.008,
        cell.center[1]+cell.normal[1]*.025+sun[1]*.008,
        cell.center[2]+cell.normal[2]*.025+sun[2]*.008
      ];
      if(!bvh.blocked(origin,sun,cell.sourceIndex))
        cell.hours+=opts.step/60;
    }
    if(k%2===0||k===n-1){
      onProgress(n?(k+1)/n:1);
      if(k<n-1)await new Promise(resolve=>setTimeout(resolve,0));
    }
  }

  const values=cells.map(c=>c.hours),sum=values.reduce((a,b)=>a+b,0);
  return {
    kind:"project-sun",
    project,options:opts,cells,sun:time.samples,
    timezone:time.tz,daylightHours:time.daylightHours,effectiveGrid,
    metrics:{
      cells:cells.length,samples:n,
      min:values.length?Math.min(...values):0,
      mean:values.length?sum/values.length:0,
      max:values.length?Math.max(...values):0,
      groundMean:0,
      roofMean:meanHours(cells,c=>c.surface==="roof"),
      facadeMean:meanHours(cells,c=>c.surface==="facade"),
      sunlit2h:values.length?100*values.filter(v=>v>=2).length/values.length:0
    }
  };
}

/* ----------------------------- WindScreen adapter ---------------------------- */

function sectionSegments(positions,slice){
  const segments=[];
  const epsilon=1e-5;
  for(let i=0;i<positions.length/9;i++){
    const tri=triAt(positions,i),points=[];
    for(const [p,q] of [[tri[0],tri[1]],[tri[1],tri[2]],[tri[2],tri[0]]]){
      const ap=p[2]-slice,aq=q[2]-slice;
      if(Math.abs(ap)<epsilon&&Math.abs(aq)<epsilon)continue;
      if((ap<=0&&aq>0)||(aq<=0&&ap>0)){
        const t=(slice-p[2])/(q[2]-p[2]);
        points.push(mix(p,q,t));
      }else if(Math.abs(ap)<epsilon){
        points.push([...p]);
      }
    }
    const unique=[];
    for(const p of points)
      if(!unique.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<epsilon))unique.push(p);
    if(unique.length>=2){
      let a=unique[0],b=unique[1],best=0;
      for(let m=0;m<unique.length;m++)for(let n=m+1;n<unique.length;n++){
        const d=Math.hypot(unique[m][0]-unique[n][0],unique[m][1]-unique[n][1]);
        if(d>best){best=d;a=unique[m];b=unique[n];}
      }
      if(best>epsilon)segments.push([a,b]);
    }
  }
  return segments;
}
export function createWindGridFromProject(project,{
  windFrom=240,cell=4,height=1.5,upstream=36,downstream=54
}={}){
  if(!(cell>=1&&cell<=10))throw new Error("Grid cell must be 1–10 metres.");
  const slice=project.bounds.min[2]+height;
  const positions=mergePositions(project.analysis.positions,project.context.positions);
  const worldSegments=sectionSegments(positions,slice);
  if(worldSegments.length<3)
    throw new Error(
      "No closed building section was found "+height.toFixed(1)+
      " m above the project base. WindScreen needs closed massing at that height."
    );

  const {X,Y}=flowAxes(windFrom);
  const segments=worldSegments.map(pair=>pair.map(p=>[
    p[0]*X[0]+p[1]*X[1],
    p[0]*Y[0]+p[1]*Y[1]
  ]));
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
  for(const [a,b] of segments)for(const p of [a,b]){
    xmin=Math.min(xmin,p[0]);xmax=Math.max(xmax,p[0]);
    ymin=Math.min(ymin,p[1]);ymax=Math.max(ymax,p[1]);
  }
  const span=Math.max(cell*4,ymax-ymin);
  const side=Math.max(upstream,2.5*span);
  const x0=xmin-upstream,y0=ymin-side;
  const nx=Math.ceil((xmax+downstream-x0)/cell);
  const ny=Math.ceil((ymax+side-y0)/cell);
  if(nx*ny>85000)throw new Error("Grid too large. Increase WindScreen cell size.");

  const solid=new Uint8Array(nx*ny);
  for(let j=0;j<ny;j++){
    const crosswind=y0+(j+.5)*cell;
    const hits=[];
    for(const [a,b] of segments){
      const y1=a[1],y2=b[1];
      if(!((y1<=crosswind&&y2>crosswind)||(y2<=crosswind&&y1>crosswind)))continue;
      const t=(crosswind-y1)/(y2-y1);
      hits.push(a[0]+(b[0]-a[0])*t);
    }
    hits.sort((a,b)=>a-b);
    for(let pair=0;pair+1<hits.length;pair+=2){
      const lo=hits[pair],hi=hits[pair+1];
      if(hi-lo<EPS)continue;
      const start=Math.max(0,Math.floor((lo-x0)/cell));
      const end=Math.min(nx-1,Math.floor((hi-x0)/cell));
      for(let i=start;i<=end;i++){
        const along=x0+(i+.5)*cell;
        if(along>lo&&along<hi)solid[j*nx+i]=1;
      }
    }
  }
  const occupied=solid.reduce((sum,v)=>sum+v,0);
  if(!occupied)throw new Error("The project section did not form a closed WindScreen obstacle.");

  return {
    nx,ny,cell,x0,y0,windFrom,slice,height,
    X,Y,solid,
    obstacles:worldSegments.length,
    sectionSegments:worldSegments.length,
    area:occupied*cell*cell,
    project:true
  };
}
