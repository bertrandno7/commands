/**
 * M004 Pixelate — Rhino-free numerical kernel adapted from Hark M004_pixelate.py.
 * Source: the user's Hark M004 and M004_pixelate_core.py.
 *
 * World-aligned Cube, conforming Kuhn tetrahedra, equilateral Tri prisms,
 * A/B/C staggered Tri, and alternate-floor staggered cubes.
 * Occupancy uses analytic unions of a slab, rotated rectangular tower and
 * sphere rather than a Rhino mesh parity ray. For these exact test solids,
 * centre-in-solid produces the same occupancy criterion as Hark's parity ray.
 */
export const SQ3=Math.sqrt(3)/2;
export const MODE_NAMES=["Cube","Tetra","Tri","Stagger","CubeStagger"];
const CORNERS=[
 [0,0,0],[1,0,0],[1,1,0],[0,1,0],
 [0,0,1],[1,0,1],[1,1,1],[0,1,1]
];
const FACE_CUBE=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
const FACE_TET=[[0,1,2],[0,1,3],[0,2,3],[1,2,3]];
const FACE_PRISM=[[0,1,2],[3,4,5],[0,1,4,3],[1,2,5,4],[2,0,3,5]];
const TRI_CORNERS=[[[0,0],[1,0],[0,1]],[[1,0],[1,1],[0,1]]];
const KUHN=[
 [0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]
].map(order=>{
 const c=[0,0,0],v=[[0,0,0]];
 for(const axis of order){c[axis]=1;v.push([...c]);}
 return v;
});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export const RAMP=[
 [0,133,255],[120,220,90],[255,210,0],[255,120,0],[230,0,126]
];
export function heightColor(t) {
 const a=clamp(t,0,1)*(RAMP.length-1),i=Math.min(RAMP.length-2,Math.floor(a));
 return RAMP[i].map((v,k)=>(v*(1-(a-i))+RAMP[i+1][k]*(a-i))/255);
}
export function cubeShift(k,s){return k%2?[s/2,s/2]:[0,0];}
export function triShift(k,s){
 const phase=((k%3)+3)%3;
 return [phase*s/2,phase*s*SQ3/3];
}
export function cellVolume(s,h,mode){
 return mode===2||mode===3?s*s*SQ3/2*h:
   mode===1?s*s*h/6:s*s*h;
}

/**
 * Test massing follows M004_pixelate_core.py:
 * slab: 44x16x12 centred (0,0,6)
 * rotated tower: 12x12x46 centred at (12,2,23), rotated 25° about Z
 * dome component: icosphere approximation radius 11 centred at (-12,0,12);
 * in this browser demo a true analytic sphere is used.
 */
export const SHAPES=[
 {id:"slab",label:"Slab",type:"box",cx:0,cy:0,cz:6,w:44,d:16,h:12,rotation:0},
 {id:"tower",label:"Rotated tower",type:"box",cx:12,cy:2,cz:23,w:12,d:12,h:46,rotation:25},
 {id:"dome",label:"Sphere",type:"sphere",cx:-12,cy:0,cz:12,r:11}
];
const RAD=Math.PI/180;
export function insideShape(shape,x,y,z){
 if(shape.type==="sphere"){
   return (x-shape.cx)**2+(y-shape.cy)**2+(z-shape.cz)**2<shape.r**2;
 }
 const a=shape.rotation*RAD,c=Math.cos(a),s=Math.sin(a);
 const dx=x-shape.cx,dy=y-shape.cy;
 const localX=dx*c+dy*s,localY=-dx*s+dy*c;
 return Math.abs(localX)<shape.w/2&&Math.abs(localY)<shape.d/2&&
   Math.abs(z-shape.cz)<shape.h/2;
}
export function insideMassing(x,y,z,shape="all"){
 return SHAPES.some(sh=>(shape==="all"||sh.id===shape)&&insideShape(sh,x,y,z));
}
export function shapeBounds(shape="all"){
 const selected=SHAPES.filter(sh=>shape==="all"||sh.id===shape);
 if(!selected.length)throw Error("No shape for selected preset");
 const b=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
 for(const sh of selected){
  let wx,wy,wz;
  if(sh.type==="sphere"){wx=wy=wz=sh.r;}
  else {
   const a=sh.rotation*RAD;
   wx=(Math.abs(Math.cos(a))*sh.w+Math.abs(Math.sin(a))*sh.d)/2;
   wy=(Math.abs(Math.sin(a))*sh.w+Math.abs(Math.cos(a))*sh.d)/2;
   wz=sh.h/2;
  }
  const values=[sh.cx-wx,sh.cy-wy,sh.cz-wz,sh.cx+wx,sh.cy+wy,sh.cz+wz];
  for(let i=0;i<3;i++){b[i]=Math.min(b[i],values[i]);b[i+3]=Math.max(b[i+3],values[i+3]);}
 }
 return {min:b.slice(0,3),max:b.slice(3)};
}

function cellCorners(index,size,height,mode){
 const [i,j,k,t]=index;
 let points;
 if(mode===1){
  points=KUHN[t].map(q=>[(i+q[0])*size,(j+q[1])*size,(k+q[2])*height]);
 }else if(mode===2||mode===3){
  const shift=mode===3?triShift(k,size):[0,0];
  points=[];
  for(let z=0;z<2;z++)for(const [a,b] of TRI_CORNERS[t]){
   points.push([
    (i+a+(j+b)/2)*size+shift[0],
    (j+b)*size*SQ3+shift[1],
    (k+z)*height
   ]);
  }
 }else{
  const shift=mode===4?cubeShift(k,size):[0,0];
  points=CORNERS.map(q=>[
   (i+q[0])*size+shift[0],
   (j+q[1])*size+shift[1],
   (k+q[2])*height
  ]);
 }
 return points;
}
const average=pts=>[0,1,2].map(a=>pts.reduce((s,v)=>s+v[a],0)/pts.length);
const facesFor=mode=>mode===1?FACE_TET:mode===2||mode===3?FACE_PRISM:FACE_CUBE;
const cross=(a,b)=>[
 a[1]*b[2]-a[2]*b[1],
 a[2]*b[0]-a[0]*b[2],
 a[0]*b[1]-a[1]*b[0]
];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const pushTriangle=(dst,a,b,c,colA,colB,colC)=>{
 for(const [p,col] of [[a,colA],[b,colB],[c,colC]]){
  dst.push(p[0],p[1],p[2],...col);
 }
};
/**
 * Surface extraction: Gap=1 cancels shared faces for Cube/Tetra/Tri (the
 * conforming modes); staggered modes always keep separate prisms.
 * Gap<1 shrinks individual pixel solids around their true polyhedral centres.
 */
export function buildPixelMesh(indices,{size,height,mode,gap=1,color=false,bounds}){
 const welded=gap>=.999999&&!([3,4].includes(mode));
 const vertices=[],edges=[],centres=[];
 const faces=new Map();
 const section=facesFor(mode);
 let surfaceFaces=0;
 let outputVolume=0;
 const unitGap=clamp(gap,.05,1);
 function addFace(pts,mean,key){
  const nrm=cross(sub(pts[1],pts[0]),sub(pts[2],pts[0]));
  const centroid=average(pts);
  const forward=dot(nrm,sub(centroid,mean))>=0?pts:[...pts].reverse();
  if(welded){
   if(faces.has(key)){faces.delete(key);return;}
   faces.set(key,{points:forward,mean});
  }else{
   paintFace(forward);
  }
 }
 function paintFace(pts){
  const colors=pts.map(p=>color?heightColor(
   (p[2]-bounds.min[2])/Math.max(1e-8,bounds.max[2]-bounds.min[2])
  ):[.89,.93,.94]);
  // Slight, physically-neutral lighting, uniform per face, adds form legibility.
  const nrm=cross(sub(pts[1],pts[0]),sub(pts[2],pts[0]));
  const len=Math.hypot(...nrm)||1;
  const lit=.80+.20*Math.max(0,nrm[2]/len);
  const c=colors.map(rgb=>rgb.map(v=>Math.min(1,v*lit)));
  for(let i=1;i<pts.length-1;i++)
   pushTriangle(vertices,pts[0],pts[i],pts[i+1],c[0],c[i],c[i+1]);
  surfaceFaces++;
  // Edge outlines are expensive but useful for visibly separated pixels;
  // avoid visual clutter above 1600 cells.
  if(indices.length<=1600){
   const ec=[.32,.40,.40];
   for(let i=0;i<pts.length;i++){
    const a=pts[i],b=pts[(i+1)%pts.length];
    edges.push(...a,...ec,...b,...ec);
   }
  }
 }
 for(const index of indices){
  const raw=cellCorners(index,size,height,mode);
  const centre=average(raw);
  centres.push(centre);
  outputVolume+=cellVolume(size,height,mode)*unitGap**3;
  const pts=unitGap===1?raw:raw.map(p=>p.map((v,a)=>centre[a]+(v-centre[a])*unitGap));
  for(const f of section){
   const polygon=f.map(k=>pts[k]);
   // World-aligned lattice face ID removes shared internal faces even for
   // tetrahedron contacts; rounded world coordinates avoid floating noise.
   const key=f.map(k=>raw[k].map(v=>v.toFixed(5)).join(",")).sort().join("|");
   addFace(polygon,centre,key);
  }
 }
 if(welded)for(const data of faces.values())paintFace(data.points);
 return {vertices,edges,centres,volume:outputVolume,surfaceFaces,
   triangles:vertices.length/18};
}

/**
 * Deterministic occupancy port from Hark: sample each pixel's true centre
 * against the UNION of source masses. Global grid origin is world (0,0,0).
 */
export function pixelate({
 shape="all",size=3.5,height=0,mode=0,gap=.92,color=true,maxPixels=12500
}={}){
 size=Number(size);height=height>0?Number(height):size;
 mode=Number(mode);gap=Number(gap);
 if(!(size>0&&size<=25)||!(height>0&&height<=25))throw Error("Pixel dimensions must be positive and ≤25 metres");
 if(!Number.isInteger(mode)||mode<0||mode>4)throw Error("Invalid pixel mode");
 if(!(gap>=.1&&gap<=1))throw Error("Gap must be between 0.1 and 1");
 const bounds=shapeBounds(shape);
 const [xmin,ymin,zmin]=bounds.min,[xmax,ymax,zmax]=bounds.max;
 const k0=Math.floor(zmin/height)-1,k1=Math.ceil(zmax/height)+1;
 const indices=[],seen=new Set();
 const accept=(i,j,k,t)=>{
  const key=[i,j,k,t].join(",");
  if(seen.has(key))return;
  seen.add(key);
  const ps=cellCorners([i,j,k,t],size,height,mode);
  const centre=average(ps);
  if(!insideMassing(...centre,shape))return;
  indices.push([i,j,k,t]);
  if(indices.length>maxPixels)throw Error(
    "Too many pixels ("+indices.length+"). Increase size or choose a smaller mass.");
 };
 if(mode===2||mode===3){
  const triHeight=size*SQ3;
  for(let k=k0;k<=k1;k++){
   const [dx,dy]=mode===3?triShift(k,size):[0,0];
   const j0=Math.floor((ymin-dy)/triHeight)-2;
   const j1=Math.ceil((ymax-dy)/triHeight)+2;
   for(let j=j0;j<=j1;j++){
    const i0=Math.floor((xmin-dx-(j+1)*size/2)/size)-2;
    const i1=Math.ceil((xmax-dx-j*size/2)/size)+2;
    for(let i=i0;i<=i1;i++)for(let t=0;t<2;t++)accept(i,j,k,t);
   }
  }
 }else{
  for(let k=k0;k<=k1;k++){
   const [dx,dy]=mode===4?cubeShift(k,size):[0,0];
   const i0=Math.floor((xmin-dx)/size)-1,i1=Math.ceil((xmax-dx)/size)+1;
   const j0=Math.floor((ymin-dy)/size)-1,j1=Math.ceil((ymax-dy)/size)+1;
   for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){
    if(mode===1)for(let t=0;t<6;t++)accept(i,j,k,t);
    else accept(i,j,k,0);
   }
  }
 }
 const geometry=buildPixelMesh(indices,{size,height,mode,gap,color,bounds});
 return {indices,geometry,bounds,options:{shape,size,height,mode,gap,color},
   count:indices.length,modeName:MODE_NAMES[mode],
   volume:geometry.volume,
   rawVolume:indices.length*cellVolume(size,height,mode),
   cellVolume:cellVolume(size,height,mode),
   source:"Hark M004 analytic slab, rotated tower, spherical test massing"};
}
