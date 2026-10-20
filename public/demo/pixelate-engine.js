/**
 * COMMANDS / M004 Pixelate computational core.
 * Browser port of Hark's M004_pixelate.py, based on its world-aligned
 * occupancy grid, five shape modes, center-sampling and mesh topology rules.
 *
 * Differences from Rhino:
 *  - the browser demo operates on three analytic sample massings
 *    (boxes, rotated boxes and spheres), not arbitrary imported Rhino Breps
 *  - inside intervals are computed analytically, not Rhino MeshLine rays
 *  - outputs are JS mesh arrays + OBJ/CSV; Rhino M004 still owns the .3dm bake
 *
 * Importantly, this is real sampling/meshing, not a visual voxel filter.
 */

const SQ3 = Math.sqrt(3)/2;
const RAD = Math.PI/180;
const EPS = 1e-9;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

export const MODES=[
  {id:0,key:"cube",name:"Cube",caption:"World-aligned cubic voxels"},
  {id:1,key:"tetra",name:"Tetra",caption:"6 Kuhn tetrahedra per cube"},
  {id:2,key:"tri",name:"Tri",caption:"Equilateral triangular prisms"},
  {id:3,key:"stagger",name:"Stagger",caption:"A–B–C shifted triangular floors"},
  {id:4,key:"cubestagger",name:"CubeStagger",caption:"Alternating half-cell shifted cubes"}
];
export const HEIGHT_RAMP=[
  [0,133,255],[120,220,90],[255,210,0],[255,120,0],[230,0,126]
];
export const CUBE_CORNERS=[
  [0,0,0],[1,0,0],[1,1,0],[0,1,0],
  [0,0,1],[1,0,1],[1,1,1],[0,1,1]
];
const CUBE_FACES=[
  [0,3,2,1],[4,5,6,7],[0,1,5,4],
  [1,2,6,5],[2,3,7,6],[3,0,4,7]
];
const TRI_CORNERS=[
  [[0,0],[1,0],[0,1]],
  [[1,0],[1,1],[0,1]]
];
const PRISM_FACES=[
  [0,1,2],[3,4,5],[0,1,4,3],[1,2,5,4],[2,0,3,5]
];
const TET_FACES=[
  [0,1,2],[0,1,3],[0,2,3],[1,2,3]
];
const KUHN=[];
for(const seq of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]){
  const p=[0,0,0],out=[[0,0,0]];
  for(const axis of seq){
    p[axis]=1;
    out.push([...p]);
  }
  KUHN.push(out);
}
export {KUHN};

const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const cross=(a,b)=>[
  a[1]*b[2]-a[2]*b[1],
  a[2]*b[0]-a[0]*b[2],
  a[0]*b[1]-a[1]*b[0]
];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mean=pts=>pts[0].map((_,i)=>
  pts.reduce((n,p)=>n+p[i],0)/pts.length
);

function box(type,x,y,z,w,d,h,angle=0){
  return {type,x,y,z,w,d,h,angle};
}
export function getPixelScene(id="reference"){
  let shapes, name, subtitle;
  if(id==="reference"){
    name="Hark sample massing";
    subtitle="44 × 16 m slab + rotated tower + sphere";
    shapes=[
      box("box",0,0,6,44,16,12),
      box("rotbox",12,2,23,12,12,46,25),
      {type:"sphere",x:-12,y:0,z:12,r:11}
    ];
  }else if(id==="courtyard"){
    name="Courtyard massing";
    subtitle="An open courtyard and staggered corners";
    shapes=[
      box("box",-18,-14,10,8,32,20),
      box("box",15,-14,14,8,32,28),
      box("box",-2,0,4,33,9,8),
      box("box",-18,20,7,42,7,14),
      box("box",1,-14,4,16,8,8)
    ];
  }else if(id==="stepped"){
    name="Stepped tower";
    subtitle="Stacked setbacks with a rooftop crown";
    shapes=[
      box("box",0,0,5,38,32,10),
      box("box",-3,0,13,27,25,16),
      box("box",-5,2,22,22,21,12),
      box("rotbox",-5,3,33,18,18,12,14),
      box("box",-6,4,42,12,13,8)
    ];
  }else{
    throw new Error("Unknown pixel massing: "+id);
  }
  const bounds=shapeBounds(shapes);
  const margin=14;
  return {
    id,name,subtitle,shapes,bounds,
    ground:{
      x:bounds.min[0]-margin,
      y:bounds.min[1]-margin,
      w:bounds.max[0]-bounds.min[0]+margin*2,
      d:bounds.max[1]-bounds.min[1]+margin*2
    },
    // Approximate volume bounds are for the Rhino-style camera fitting and
    // clicked-object pivot; actual geometry uses the analytic shapes.
    buildings:shapes.map(s=>{
      const b=shapeBound(s);
      return {
        x:b.min[0],y:b.min[1],w:b.max[0]-b.min[0],
        d:b.max[1]-b.min[1],h:b.max[2]
      };
    })
  };
}
function shapeBound(s){
  if(s.type==="sphere"){
    return {
      min:[s.x-s.r,s.y-s.r,s.z-s.r],
      max:[s.x+s.r,s.y+s.r,s.z+s.r]
    };
  }
  const angle=(s.angle||0)*RAD;
  const hx=s.w/2,hy=s.d/2;
  const x=Math.abs(Math.cos(angle))*hx+Math.abs(Math.sin(angle))*hy;
  const y=Math.abs(Math.sin(angle))*hx+Math.abs(Math.cos(angle))*hy;
  return {
    min:[s.x-x,s.y-y,s.z-s.h/2],
    max:[s.x+x,s.y+y,s.z+s.h/2]
  };
}
export function shapeBounds(shapes){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const s of shapes){
    const b=shapeBound(s);
    for(let k=0;k<3;k++){
      min[k]=Math.min(min[k],b.min[k]);
      max[k]=Math.max(max[k],b.max[k]);
    }
  }
  return {min,max};
}

/** Vertical ray union, equivalent to Hark's hits_to_intervals/union. */
export function intervalsAt(scene,x,y){
  const parts=[];
  for(const s of scene.shapes){
    if(s.type==="sphere"){
      const dx=x-s.x,dy=y-s.y;
      const r=s.r*s.r-dx*dx-dy*dy;
      if(r>EPS){
        const h=Math.sqrt(r);
        parts.push([s.z-h,s.z+h]);
      }
    }else{
      const a=(s.angle||0)*RAD,c=Math.cos(a),sn=Math.sin(a);
      const dx=x-s.x,dy=y-s.y;
      const localX=dx*c+dy*sn;
      const localY=-dx*sn+dy*c;
      if(Math.abs(localX)<s.w/2-EPS&&
         Math.abs(localY)<s.d/2-EPS){
        parts.push([s.z-s.h/2,s.z+s.h/2]);
      }
    }
  }
  parts.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const [a,b] of parts){
    if(merged.length&&a<=merged[merged.length-1][1]+EPS)
      merged[merged.length-1][1]=Math.max(
        merged[merged.length-1][1],b
      );
    else merged.push([a,b]);
  }
  return merged;
}
const gridRange=(a,b,s)=>[Math.floor(a/s),Math.ceil(b/s)];
const cubeShift=(floor,size)=>floor%2
  ?[size/2,size/2]:[0,0];
const triShift=(floor,size)=>{
  const phase=((floor%3)+3)%3;
  return [phase*size/2,phase*size*SQ3/3];
};
const voxelVolume=(sx,sz,mode)=>{
  if(mode===2||mode===3)return sx*sx*SQ3*sz/2;
  return sx*sx*sz/(mode===1?6:1);
};

function centerOffsets(mode){
  if(mode===1)return KUHN.map((tet,t)=>({
    t,
    frac:mean(tet)
  }));
  return [{t:0,frac:[.5,.5,.5]}];
}
function cornersForCell(c,sx,sz,mode){
  const [i,j,k,t]=c;
  if(mode===2||mode===3){
    const [dx,dy]=mode===3?triShift(k,sx):[0,0];
    const out=[];
    for(const z of [k*sz,(k+1)*sz]){
      for(const [a,b] of TRI_CORNERS[t]){
        out.push([
          (i+a+(j+b)/2)*sx+dx,
          (j+b)*sx*SQ3+dy,
          z
        ]);
      }
    }
    return out;
  }
  const shift=mode===4?cubeShift(k,sx):[0,0];
  const corners=mode===1?KUHN[t]:CUBE_CORNERS;
  return corners.map(([u,v,w])=>[
    (i+u)*sx+shift[0],
    (j+v)*sx+shift[1],
    (k+w)*sz
  ]);
}
function latticeKeys(c,mode){
  const [i,j,k,t]=c;
  if(mode===2){
    const points=TRI_CORNERS[t];
    return points.map(([a,b])=>[i+a,j+b,k]).concat(
      points.map(([a,b])=>[i+a,j+b,k+1])
    );
  }
  const base=mode===1?KUHN[t]:CUBE_CORNERS;
  return base.map(([a,b,d])=>[i+a,j+b,k+d]);
}
const faceList=mode=>
  mode===1?TET_FACES:(mode===2||mode===3)?PRISM_FACES:CUBE_FACES;

function createCells(scene,sx,sz,mode){
  const {min,max}=scene.bounds;
  const [z0,z1]=gridRange(min[2],max[2],sz);
  const candidates=[];
  const push=(i,j,t,x,y,w,phase=null)=>{
    candidates.push({i,j,t,x,y,w,phase});
  };
  if(mode===2||mode===3){
    const stepY=sx*SQ3;
    const phases=mode===3?[0,1,2]:[null];
    for(const phase of phases){
      const [dx,dy]=phase===null?[0,0]:triShift(phase,sx);
      const [j0,j1]=gridRange(min[1]-dy,max[1]-dy,stepY);
      for(let j=j0;j<j1;j++){
        const i0=Math.floor((min[0]-dx-(j+1)*sx/2)/sx)-1;
        const i1=Math.ceil((max[0]-dx-j*sx/2)/sx)+1;
        for(let i=i0;i<i1;i++){
          for(const [t,u,v] of [[0,1/3,1/3],[1,2/3,2/3]]){
            const a=i+u,b=j+v;
            push(i,j,t,(a+b/2+1e-5)*sx+dx,
              (b+1.7e-5)*stepY+dy,.5,phase);
          }
        }
      }
    }
  }else if(mode===4){
    for(const phase of [0,1]){
      const [dx,dy]=cubeShift(phase,sx);
      const [i0,i1]=gridRange(min[0]-dx,max[0]-dx,sx);
      const [j0,j1]=gridRange(min[1]-dy,max[1]-dy,sx);
      for(let i=i0;i<i1;i++)for(let j=j0;j<j1;j++){
        push(i,j,0,(i+.5+1e-5)*sx+dx,
          (j+.5+1.7e-5)*sx+dy,.5,phase);
      }
    }
  }else{
    const [i0,i1]=gridRange(min[0],max[0],sx);
    const [j0,j1]=gridRange(min[1],max[1],sx);
    const offsets=centerOffsets(mode);
    for(let i=i0;i<i1;i++)for(let j=j0;j<j1;j++){
      for(const {t,frac:[u,v,w]} of offsets){
        push(i,j,t,(i+u+1e-5)*sx,(j+v+1.7e-5)*sx,w);
      }
    }
  }
  if(candidates.length*Math.max(0,z1-z0)>350000)
    throw new Error("Too many candidate pixels. Increase Size to 4–6 m.");
  const cells=[];
  for(const c of candidates){
    const intervals=intervalsAt(scene,c.x,c.y);
    for(const [a,b] of intervals){
      const k0=Math.ceil(a/sz-c.w),k1=Math.floor(b/sz-c.w);
      for(let k=k0;k<=k1;k++){
        const z=(k+c.w)*sz;
        if(!(a<z&&z<b))continue;
        if(c.phase!==null&&
          ((k%(mode===4?2:3))+(mode===4?2:3))%(mode===4?2:3)!==c.phase)
          continue;
        cells.push([c.i,c.j,k,c.t]);
      }
    }
  }
  cells.sort((a,b)=>{
    for(let i=0;i<4;i++)if(a[i]!==b[i])return a[i]-b[i];
    return 0;
  });
  // Source M004 uses sorted(set(cells)), so dedupe overlapping intervals.
  const unique=cells.filter((c,i)=>!i||c.some((n,j)=>n!==cells[i-1][j]));
  if(unique.length>24000)
    throw new Error("More than 24,000 pixels; increase Size.");
  return unique;
}

function orientFace(indices,points,center){
  const v=indices.map(i=>points[i]),c=mean(v);
  const n=cross(sub(v[1],v[0]),sub(v[2],v[0]));
  return dot(n,sub(c,center))<0?[...indices].reverse():indices;
}
export function makePixelMesh(cells,sx,sz,mode,gap){
  const full=gap>=1-1e-9 && mode!==3 && mode!==4;
  const vertices=[],faces=[],centres=[];
  const templates=faceList(mode);
  if(full){
    const faceOwners=new Map(),nodeMap=new Map();
    const virtualPts=new Map();
    for(const c of cells){
      const corners=latticeKeys(c,mode);
      const points=cornersForCell(c,sx,sz,mode);
      centres.push(mean(points));
      for(let fi=0;fi<templates.length;fi++){
        const face=templates[fi],keys=face.map(i=>corners[i]);
        const id=keys.map(k=>k.join(",")).sort().join("|");
        if(faceOwners.has(id)){
          faceOwners.get(id).count++;
        }else{
          faceOwners.set(id,{
            count:1,keys,points,
            faceIndices:[...face],center:mean(points)
          });
        }
      }
      corners.forEach((p,k)=>virtualPts.set(p.join(","),points[k]));
    }
    for(const info of faceOwners.values()){
      if(info.count!==1)continue;
      const face=orientFace(info.faceIndices,info.points,info.center);
      const indices=face.map(index=>{
        const key=info.keys[info.faceIndices.indexOf(index)].join(",");
        // Use actual lattice-coordinate vertex as the welded topology key.
        if(!nodeMap.has(key)){
          nodeMap.set(key,vertices.length);
          vertices.push([...virtualPts.get(key)]);
        }
        return nodeMap.get(key);
      });
      faces.push(indices);
    }
  }else{
    const shrink=clamp(gap,.1,1);
    for(const c of cells){
      const points=cornersForCell(c,sx,sz,mode);
      const cen=mean(points),base=vertices.length;
      centres.push(cen);
      for(const p of points){
        vertices.push(p.map((v,i)=>cen[i]+(v-cen[i])*shrink));
      }
      for(const f of templates){
        const ord=orientFace(f,points,cen);
        faces.push(ord.map(i=>base+i));
      }
    }
  }
  return {vertices,faces,centres};
}

export function pixelHeightColor(t){
  const value=clamp(t,0,1)*(HEIGHT_RAMP.length-1);
  const i=Math.min(HEIGHT_RAMP.length-2,Math.floor(value));
  const f=value-i;
  return HEIGHT_RAMP[i].map((v,k)=>
    Math.round(v+(HEIGHT_RAMP[i+1][k]-v)*f)
  );
}

export function pixelate(scene,options={}){
  const size=Number(options.size??3);
  const height=Number(options.height??0);
  const mode=Number(options.mode??0);
  const gap=Number(options.gap??.92);
  const colour=options.colour!==false;
  if(!Number.isFinite(size)||size<1||size>12)
    throw new Error("Size must be 1–12 m.");
  if(!Number.isFinite(height)||height<0||height>16)
    throw new Error("Height must be 0–16 m.");
  if(!Number.isInteger(mode)||mode<0||mode>4)
    throw new Error("Choose a valid pixel mode.");
  if(!Number.isFinite(gap)||gap<.1||gap>1)
    throw new Error("Gap must be 0.1–1.0.");
  const sz=height>0?height:size;
  const cells=createCells(scene,size,sz,mode);
  const mesh=makePixelMesh(cells,size,sz,mode,gap);
  const volume=cells.length*voxelVolume(size,sz,mode);
  const separated=gap<1-1e-9||mode===3||mode===4;
  return {
    kind:"pixelate",
    scene:scene.id,options:{size,height:sz,mode,gap,colour},
    cells,count:cells.length,
    volume,renderedVolume:separated?volume*Math.pow(gap,3):volume,
    centroid:mean(mesh.centres.length?mesh.centres:[[0,0,0]]),
    mesh,
    sourceMesh:makeOriginalMesh(scene),
    solid:gap>=1-1e-9 && mode<3,
    faces:mesh.faces.length,
    triangles:mesh.faces.reduce((n,f)=>n+f.length-2,0)
  };
}

/** Source geometry for the side-by-side original/pixelated comparison. */
export function makeOriginalMesh(scene){
  const vertices=[],faces=[];
  function facePolygon(pts){
    const start=vertices.length;
    pts.forEach(p=>vertices.push(p));
    faces.push(pts.map((_,i)=>start+i));
  }
  for(const s of scene.shapes){
    if(s.type==="sphere"){
      const nLon=28,nLat=16;
      const base=vertices.length;
      for(let j=0;j<=nLat;j++){
        const a=Math.PI*j/nLat;
        const r=Math.sin(a)*s.r;
        const z=s.z+Math.cos(a)*s.r;
        for(let i=0;i<=nLon;i++){
          const t=2*Math.PI*i/nLon;
          vertices.push([s.x+r*Math.cos(t),s.y+r*Math.sin(t),z]);
        }
      }
      for(let j=0;j<nLat;j++)for(let i=0;i<nLon;i++){
        const p=base+j*(nLon+1)+i;
        // reverse if necessary: renderer fixes exterior normal shading
        faces.push([p,p+1,p+nLon+2,p+nLon+1]);
      }
    }else{
      const angle=(s.angle||0)*RAD;
      const co=Math.cos(angle),si=Math.sin(angle);
      const v=CUBE_CORNERS.map(([i,j,k])=>{
        const x=(i-.5)*s.w,y=(j-.5)*s.d;
        return [
          s.x+x*co-y*si,
          s.y+x*si+y*co,
          s.z+(k-.5)*s.h
        ];
      });
      for(const face of CUBE_FACES)facePolygon(face.map(i=>v[i]));
    }
  }
  return {vertices,faces};
}

export function toOBJ(result){
  const {vertices,faces}=result.mesh;
  const lines=[
    "# COMMANDS M004 Pixelate — analytic sample massing",
    "# Source: Hark M004_pixelate.py",
    "# Units: metres",
    "# Mode: "+MODES[result.options.mode].name,
    "# Pixel count: "+result.count,
    "# Gap: "+result.options.gap,
    "o Pixelate_M004"
  ];
  for(const [x,y,z] of vertices){
    lines.push("v "+x.toFixed(6)+" "+y.toFixed(6)+" "+z.toFixed(6));
  }
  for(const face of faces){
    if(face.length<3)continue;
    lines.push("f "+face.map(i=>i+1).join(" "));
  }
  return lines.join("\n")+"\n";
}
export function cellsCSV(result){
  const lines=["cell_i,cell_j,floor_k,subcell_t,x_m,y_m,z_m"];
  for(let i=0;i<result.cells.length;i++){
    const c=result.cells[i],v=result.mesh.centres[i];
    lines.push([...c,...v.map(n=>n.toFixed(4))].join(","));
  }
  return lines.join("\n")+"\n";
}
