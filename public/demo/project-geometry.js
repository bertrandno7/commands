/**
 * COMMANDS Project Geometry
 *
 * One local browser project can be consumed by multiple commands.
 * Geometry is stored in IndexedDB as the original file Blob(s), then parsed
 * on demand inside each command. No project geometry is uploaded to COMMANDS.
 *
 * Supported V1 formats:
 *   - OBJ (triangulated client-side)
 *   - STL (binary or ASCII)
 *   - GLB 2.0 (standard TRIANGLES primitives; no Draco compression)
 */

const DB_NAME="commands-project-v1";
const DB_VERSION=1;
const STORE="project";
const ACTIVE_KEY="active";
const CHANNEL="commands-project";
const SUPPORTED=["obj","stl","glb"];
const UNIT_SCALE={m:1,cm:.01,mm:.001,ft:.3048};

function ext(name=""){
  const part=String(name).toLowerCase().split(".").pop();
  return part===String(name).toLowerCase()?"":part;
}
export function supportedGeometryFile(name){
  return SUPPORTED.includes(ext(name));
}
export function supportedGeometryExtensions(){
  return [...SUPPORTED];
}
export function unitScale(units="m"){
  return UNIT_SCALE[units]??1;
}
function openDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error("Could not open project database."));
  });
}
async function withStore(mode,fn){
  const db=await openDb();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode);
      const store=tx.objectStore(STORE);
      let value;
      try{value=fn(store);}catch(error){reject(error);return;}
      if(value&&typeof value.onsuccess!=="undefined"){
        value.onsuccess=()=>resolve(value.result);
        value.onerror=()=>reject(value.error||new Error("Project database request failed."));
      }else{
        tx.oncomplete=()=>resolve(value);
        tx.onerror=()=>reject(tx.error||new Error("Project database transaction failed."));
        tx.onabort=()=>reject(tx.error||new Error("Project database transaction was aborted."));
      }
    });
  }finally{db.close();}
}
export async function getActiveProjectRecord(){
  if(typeof indexedDB==="undefined")return null;
  return await withStore("readonly",store=>store.get(ACTIVE_KEY))||null;
}
export async function saveActiveProjectRecord(record){
  if(typeof indexedDB==="undefined")throw new Error("This browser does not support local project storage.");
  const next={...record,key:ACTIVE_KEY,version:1,updatedAt:new Date().toISOString()};
  await withStore("readwrite",store=>store.put(next,ACTIVE_KEY));
  notifyProjectChanged(next);
  return next;
}
export async function clearActiveProject(){
  if(typeof indexedDB==="undefined")return;
  await withStore("readwrite",store=>store.delete(ACTIVE_KEY));
  notifyProjectChanged(null);
}
function notifyProjectChanged(record){
  try{
    const bc=new BroadcastChannel(CHANNEL);
    bc.postMessage({type:"commands:project-changed",updatedAt:record?.updatedAt||null});
    bc.close();
  }catch{}
  try{window.dispatchEvent(new CustomEvent("commands:project-changed"));}catch{}
}
export function subscribeProjectChanges(callback){
  let bc=null;
  const local=()=>callback();
  window.addEventListener("commands:project-changed",local);
  try{
    bc=new BroadcastChannel(CHANNEL);
    bc.addEventListener("message",event=>{
      if(event.data?.type==="commands:project-changed")callback();
    });
  }catch{}
  return ()=>{
    window.removeEventListener("commands:project-changed",local);
    bc?.close();
  };
}
export function makeProjectRecord({
  name="Untitled project",units="m",analysisFiles=[],contextFiles=[]
}={}){
  const normalize=(file,role)=>({
    name:file.name,
    size:file.size,
    type:file.type||"",
    lastModified:file.lastModified||Date.now(),
    role,
    blob:file
  });
  return {
    name:String(name||analysisFiles[0]?.name||"Untitled project"),
    units:UNIT_SCALE[units]?units:"m",
    files:[
      ...analysisFiles.map(file=>normalize(file,"analysis")),
      ...contextFiles.map(file=>normalize(file,"context"))
    ]
  };
}
export function projectRecordStats(record){
  const files=record?.files||[];
  return {
    fileCount:files.length,
    analysisFiles:files.filter(f=>f.role!=="context").length,
    contextFiles:files.filter(f=>f.role==="context").length,
    bytes:files.reduce((sum,f)=>sum+(Number(f.size)||0),0)
  };
}

const emptyBounds=()=>({
  min:[Infinity,Infinity,Infinity],
  max:[-Infinity,-Infinity,-Infinity]
});
function expandBounds(bounds,x,y,z){
  bounds.min[0]=Math.min(bounds.min[0],x);
  bounds.min[1]=Math.min(bounds.min[1],y);
  bounds.min[2]=Math.min(bounds.min[2],z);
  bounds.max[0]=Math.max(bounds.max[0],x);
  bounds.max[1]=Math.max(bounds.max[1],y);
  bounds.max[2]=Math.max(bounds.max[2],z);
}
function finiteBounds(bounds){
  return bounds.min.every(Number.isFinite)&&bounds.max.every(Number.isFinite);
}
function appendTriangle(out,bounds,a,b,c,scale=1,matrix=null){
  const tx=p=>{
    let x=p[0]*scale,y=p[1]*scale,z=p[2]*scale;
    if(matrix){
      const nx=matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12];
      const ny=matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13];
      const nz=matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14];
      x=nx;y=ny;z=nz;
    }
    expandBounds(bounds,x,y,z);
    out.push(x,y,z);
  };
  tx(a);tx(b);tx(c);
}
function finalizeTriangles(out,bounds,name){
  if(!out.length)throw new Error(name+" contains no readable triangles.");
  return {
    positions:new Float32Array(out),
    triangleCount:out.length/9,
    bounds
  };
}

function parseObj(text,scale,name){
  const vertices=[],out=[],bounds=emptyBounds();
  const lines=text.split(/\r?\n/);
  for(const raw of lines){
    const line=raw.trim();
    if(!line||line.startsWith("#"))continue;
    const parts=line.split(/\s+/);
    if(parts[0]==="v"&&parts.length>=4){
      const p=[Number(parts[1]),Number(parts[2]),Number(parts[3])];
      if(p.every(Number.isFinite))vertices.push(p);
    }else if(parts[0]==="f"&&parts.length>=4){
      const indices=[];
      for(let k=1;k<parts.length;k++){
        const token=parts[k].split("/")[0];
        let index=Number.parseInt(token,10);
        if(!Number.isInteger(index)||index===0)continue;
        if(index<0)index=vertices.length+index;
        else index=index-1;
        if(index>=0&&index<vertices.length)indices.push(index);
      }
      for(let k=1;k+1<indices.length;k++){
        appendTriangle(out,bounds,
          vertices[indices[0]],vertices[indices[k]],vertices[indices[k+1]],scale);
      }
    }
  }
  return finalizeTriangles(out,bounds,name);
}

function looksBinaryStl(buffer){
  if(buffer.byteLength<84)return false;
  const view=new DataView(buffer);
  const count=view.getUint32(80,true);
  return 84+count*50<=buffer.byteLength;
}
function parseStl(buffer,scale,name){
  const out=[],bounds=emptyBounds();
  if(looksBinaryStl(buffer)){
    const view=new DataView(buffer);
    const count=view.getUint32(80,true);
    let offset=84;
    for(let i=0;i<count;i++,offset+=50){
      const pts=[];
      for(let v=0;v<3;v++){
        const base=offset+12+v*12;
        pts.push([
          view.getFloat32(base,true),
          view.getFloat32(base+4,true),
          view.getFloat32(base+8,true)
        ]);
      }
      if(pts.flat().every(Number.isFinite))
        appendTriangle(out,bounds,pts[0],pts[1],pts[2],scale);
    }
  }else{
    const text=new TextDecoder().decode(buffer);
    const re=/\bvertex\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)/gi;
    let match,pts=[];
    while((match=re.exec(text))){
      const p=[Number(match[1]),Number(match[2]),Number(match[3])];
      if(p.every(Number.isFinite))pts.push(p);
      if(pts.length===3){
        appendTriangle(out,bounds,pts[0],pts[1],pts[2],scale);
        pts=[];
      }
    }
  }
  return finalizeTriangles(out,bounds,name);
}

const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function matMul(a,b){
  const out=new Array(16).fill(0);
  for(let col=0;col<4;col++)for(let row=0;row<4;row++)
    for(let k=0;k<4;k++)out[col*4+row]+=a[k*4+row]*b[col*4+k];
  return out;
}
function matrixFromTrs(node){
  if(Array.isArray(node.matrix)&&node.matrix.length===16)return node.matrix.map(Number);
  const t=node.translation||[0,0,0],s=node.scale||[1,1,1];
  const q=node.rotation||[0,0,0,1];
  const [x,y,z,w]=q;
  const xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;
  return [
    (1-2*(yy+zz))*s[0],(2*(xy+wz))*s[0],(2*(xz-wy))*s[0],0,
    (2*(xy-wz))*s[1],(1-2*(xx+zz))*s[1],(2*(yz+wx))*s[1],0,
    (2*(xz+wy))*s[2],(2*(yz-wx))*s[2],(1-2*(xx+yy))*s[2],0,
    Number(t[0])||0,Number(t[1])||0,Number(t[2])||0,1
  ];
}
function componentReader(view,type,offset){
  switch(type){
    case 5120:return view.getInt8(offset);
    case 5121:return view.getUint8(offset);
    case 5122:return view.getInt16(offset,true);
    case 5123:return view.getUint16(offset,true);
    case 5125:return view.getUint32(offset,true);
    case 5126:return view.getFloat32(offset,true);
    default:throw new Error("Unsupported GLB component type "+type+".");
  }
}
function componentBytes(type){
  return ({5120:1,5121:1,5122:2,5123:2,5125:4,5126:4})[type]||0;
}
function accessorWidth(type){
  return ({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16})[type]||0;
}
function parseGlb(buffer,scale,name){
  const header=new DataView(buffer);
  if(buffer.byteLength<20||header.getUint32(0,true)!==0x46546c67)
    throw new Error(name+" is not a valid GLB 2.0 file.");
  if(header.getUint32(4,true)!==2)throw new Error("Only GLB 2.0 is supported.");
  let offset=12,json=null,bin=null;
  while(offset+8<=buffer.byteLength){
    const length=header.getUint32(offset,true);
    const type=header.getUint32(offset+4,true);
    const start=offset+8,end=start+length;
    if(end>buffer.byteLength)break;
    const chunk=buffer.slice(start,end);
    if(type===0x4E4F534A)json=JSON.parse(new TextDecoder().decode(chunk).replace(/\u0000+$/,""));
    if(type===0x004E4942)bin=chunk;
    offset=end;
  }
  if(!json||!bin)throw new Error(name+" must contain JSON and BIN chunks.");
  if(json.extensionsRequired?.includes("KHR_draco_mesh_compression"))
    throw new Error("Draco-compressed GLB is not supported yet. Export an uncompressed GLB or OBJ.");

  const binView=new DataView(bin);
  const readAccessor=index=>{
    const acc=json.accessors?.[index];
    if(!acc)throw new Error("GLB accessor "+index+" is missing.");
    if(acc.sparse)throw new Error("Sparse GLB accessors are not supported yet.");
    const bv=json.bufferViews?.[acc.bufferView];
    if(!bv)throw new Error("GLB bufferView is missing.");
    const width=accessorWidth(acc.type),bytes=componentBytes(acc.componentType);
    if(!width||!bytes)throw new Error("Unsupported GLB accessor type.");
    const stride=bv.byteStride||width*bytes;
    const start=(bv.byteOffset||0)+(acc.byteOffset||0);
    const values=new Array(acc.count*width);
    for(let i=0;i<acc.count;i++)for(let c=0;c<width;c++)
      values[i*width+c]=componentReader(binView,acc.componentType,start+i*stride+c*bytes);
    return {values,width,count:acc.count};
  };

  const out=[],bounds=emptyBounds();
  const nodes=json.nodes||[],meshes=json.meshes||[];
  const sceneIndex=json.scene??0;
  const roots=json.scenes?.[sceneIndex]?.nodes??nodes.map((_,i)=>i);

  const visit=(nodeIndex,parent)=>{
    const node=nodes[nodeIndex]||{};
    const world=matMul(parent,matrixFromTrs(node));
    if(Number.isInteger(node.mesh)){
      const mesh=meshes[node.mesh];
      for(const primitive of mesh?.primitives||[]){
        if(primitive.extensions?.KHR_draco_mesh_compression)
          throw new Error("Draco-compressed GLB is not supported yet.");
        const mode=primitive.mode??4;
        if(mode!==4)continue;
        const positionIndex=primitive.attributes?.POSITION;
        if(!Number.isInteger(positionIndex))continue;
        const pos=readAccessor(positionIndex);
        if(pos.width!==3)continue;
        const idx=Number.isInteger(primitive.indices)?readAccessor(primitive.indices):null;
        const indices=idx?idx.values:Array.from({length:pos.count},(_,i)=>i);
        for(let i=0;i+2<indices.length;i+=3){
          const p=n=>[
            pos.values[indices[i+n]*3],
            pos.values[indices[i+n]*3+1],
            pos.values[indices[i+n]*3+2]
          ];
          appendTriangle(out,bounds,p(0),p(1),p(2),scale,world);
        }
      }
    }
    for(const child of node.children||[])visit(child,world);
  };
  for(const root of roots)visit(root,identity());
  return finalizeTriangles(out,bounds,name);
}

async function parseStoredFile(stored,scale){
  const blob=stored.blob;
  if(!(blob instanceof Blob))throw new Error(stored.name+" is missing its stored file data.");
  const extension=ext(stored.name);
  if(extension==="obj")return parseObj(await blob.text(),scale,stored.name);
  const buffer=await blob.arrayBuffer();
  if(extension==="stl")return parseStl(buffer,scale,stored.name);
  if(extension==="glb")return parseGlb(buffer,scale,stored.name);
  throw new Error("Unsupported geometry format: "+stored.name);
}
function mergeParsed(parsed){
  const total=parsed.reduce((sum,p)=>sum+p.positions.length,0);
  const positions=new Float32Array(total);
  const bounds=emptyBounds();
  let offset=0;
  for(const p of parsed){
    positions.set(p.positions,offset);offset+=p.positions.length;
    if(finiteBounds(p.bounds)){
      expandBounds(bounds,...p.bounds.min);
      expandBounds(bounds,...p.bounds.max);
    }
  }
  return {
    positions,
    triangleCount:positions.length/9,
    bounds:finiteBounds(bounds)?bounds:null
  };
}
function combinedBounds(a,b){
  const bounds=emptyBounds();
  for(const source of [a?.bounds,b?.bounds]){
    if(!source)continue;
    expandBounds(bounds,...source.min);
    expandBounds(bounds,...source.max);
  }
  return finiteBounds(bounds)?bounds:{min:[-10,-10,0],max:[10,10,10]};
}
export async function parseProjectRecord(record,{maxTriangles=180000}={}){
  if(!record?.files?.length)return null;
  const scale=unitScale(record.units);
  const analysis=[],context=[];
  for(const stored of record.files){
    if(!supportedGeometryFile(stored.name))
      throw new Error("Unsupported project file: "+stored.name);
    const parsed=await parseStoredFile(stored,scale);
    (stored.role==="context"?context:analysis).push(parsed);
  }
  const a=mergeParsed(analysis),c=mergeParsed(context);
  const total=a.triangleCount+c.triangleCount;
  if(total>maxTriangles)
    throw new Error(
      "Project has "+total.toLocaleString()+" triangles. Simplify the model below "+
      maxTriangles.toLocaleString()+" triangles for this browser preview."
    );
  return {
    id:"active",
    name:record.name||record.files[0]?.name||"Project geometry",
    units:"m",
    sourceUnits:record.units||"m",
    updatedAt:record.updatedAt||null,
    files:record.files.map(({blob,...meta})=>meta),
    analysis:a,
    context:c,
    triangleCount:total,
    bounds:combinedBounds(a,c)
  };
}
export async function loadActiveProjectGeometry(options){
  const record=await getActiveProjectRecord();
  return record?parseProjectRecord(record,options):null;
}
export function projectToViewerScene(project){
  const b=project.bounds;
  const sx=Math.max(.1,b.max[0]-b.min[0]);
  const sy=Math.max(.1,b.max[1]-b.min[1]);
  const pad=Math.max(4,Math.max(sx,sy)*.14);
  const floorZ=Math.min(0,b.min[2]);
  return {
    kind:"project",
    name:project.name,
    subtitle:project.triangleCount.toLocaleString()+" triangles · shared COMMANDS Project",
    bounds:{min:[...b.min],max:[...b.max]},
    ground:{x:b.min[0]-pad,y:b.min[1]-pad,w:sx+pad*2,d:sy+pad*2,z:floorZ},
    buildings:[],
    meshPositions:project.analysis.positions,
    contextPositions:project.context.positions
  };
}
