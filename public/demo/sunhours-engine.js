/**
 * SunHours — browser computation core, adapted from Hark A001_sun_hours.py.
 *
 * Direct sun hours on sampled planar faces of axis-aligned box massing.
 * Solar positions: NOAA approximation ported from the user's A001 code.
 * Visibility: ray / axis-aligned-box intersection; includes self- and
 * context-shading among all solids. Does not require Rhino, npm, or a server.
 *
 * Important limitation: this preview handles orthogonal massing presets,
 * not arbitrary trimmed Breps/meshes from Rhino.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export function dayOfYear(year, month, day) {
  return Math.floor((Date.UTC(year, month - 1, day) -
    Date.UTC(year, 0, 1)) / 86400000) + 1;
}

function lastSunday(year, month) {
  const last = new Date(Date.UTC(year, month, 0));
  return last.getUTCDate() - last.getUTCDay();
}

export function euOffset(year, month, day) {
  const afterMarch = month > 3 || (month === 3 && day >= lastSunday(year, 3));
  const beforeOctober = month < 10 || (month === 10 && day < lastSunday(year, 10));
  return afterMarch && beforeOctober ? 2 : 1;
}

export function sunPosition(lat, lon, year, month, day, hourLocal, tz) {
  const n = dayOfYear(year, month, day);
  const g = 2 * Math.PI / 365 * (n - 1 + (hourLocal - 12) / 24);
  const equation = 229.18 * (0.000075 + 0.001868 * Math.cos(g)
    - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2*g)
    - 0.040849 * Math.sin(2*g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2*g) + 0.000907 * Math.sin(2*g)
    - 0.002697 * Math.cos(3*g) + 0.00148 * Math.sin(3*g);
  const tst = hourLocal * 60 + equation + 4 * lon - 60 * tz;
  const ha = (((tst / 4) % 360 + 360) % 360 - 180) * RAD;
  const la = lat * RAD;
  const cz = Math.sin(la)*Math.sin(dec) + Math.cos(la)*Math.cos(dec)*Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cz)));
  const alt = 90 - zen * DEG;
  const s = Math.sin(zen);
  if (Math.abs(s) < 1e-9) return { altitude: alt, azimuth: 180 };
  const ca = (Math.sin(la)*Math.cos(zen) - Math.sin(dec)) / (Math.cos(la)*s);
  const az = Math.acos(Math.max(-1, Math.min(1, ca))) * DEG;
  return { altitude: alt, azimuth: ha > 0 ? (180 + az) % 360 : (540 - az) % 360 };
}

export function sunSamples({lat, lon, year, month, day, step=30, tz=null, north=0}) {
  const offset = tz === null ? euOffset(year, month, day) : tz;
  const all = [];
  const daylight = [];
  for (let k=0; (k+0.5)*step/60 <= 24; k++) {
    const hour = (k+0.5)*step/60;
    const pos = sunPosition(lat,lon,year,month,day,hour,offset);
    if (pos.altitude <= 0) continue;
    const a = pos.altitude*RAD;
    const az = (pos.azimuth-north)*RAD;
    daylight.push({hour, ...pos, dir:[
      Math.cos(a)*Math.sin(az),
      Math.cos(a)*Math.cos(az),
      Math.sin(a)
    ]});
  }
  return {samples:daylight, daylightHours:daylight.length*step/60, tz:offset};
}

const box = (id,x,y,w,d,h,label) => ({id,x,y,w,d,h,label});

const scenePresets = {
  courtyard: {
    name:"Courtyard block",
    subtitle:"Hark A001-core · Rotterdam test massing",
    ground:{x:-18,y:-32,w:78,d:88},
    buildings:[
      box("north",0,30,40,10,24,"North slab"),
      box("west",0,0,10,30,15,"West wing"),
      box("east",30,0,10,30,9,"East wing"),
      box("tower",12,-18,14,14,45,"South tower")
    ]
  },
  tower: {
    name:"Tower + context",
    subtitle:"Tall building with surrounding obstructions",
    ground:{x:-52,y:-48,w:108,d:104},
    buildings:[
      box("tower",-9,-9,18,18,58,"Main tower"),
      box("northwest",-38,13,23,24,24,"Northwest block"),
      box("northeast",15,16,29,17,18,"Northeast block"),
      box("southwest",-39,-34,23,18,12,"Southwest block"),
      box("southeast",17,-35,25,19,32,"Southeast block")
    ]
  },
  canyon: {
    name:"Street canyon",
    subtitle:"Direct sun down a north-south street",
    ground:{x:-50,y:-49,w:100,d:98},
    buildings:[
      box("west",-32,-38,22,73,31,"West frontage"),
      box("east",8,-38,24,73,39,"East frontage"),
      box("north",-5,37,19,10,18,"End building"),
      box("southwest",-48,-18,13,27,16,"West neighbour")
    ]
  }
};

export function getScene(id="courtyard") {
  const preset = scenePresets[id] || scenePresets.courtyard;
  return {
    name:preset.name,
    subtitle:preset.subtitle,
    ground:{...preset.ground},
    buildings:preset.buildings.map(b=>({...b}))
  };
}

export function presetNames() {
  return Object.entries(scenePresets).map(([id,s])=>({id,name:s.name}));
}

function subdivide(width,height,grid) {
  return {nx:Math.ceil(width/grid),ny:Math.ceil(height/grid)};
}

function buildFaceCells(result, id, surface, origin, uvec, vvec, w, h, normal, grid) {
  const {nx,ny} = subdivide(w,h,grid);
  const du = w/nx, dv=h/ny;
  for(let j=0;j<ny;j++) for(let i=0;i<nx;i++) {
    const a=i*du,b=j*dv;
    const at=(u,v)=>[
      origin[0]+uvec[0]*u+vvec[0]*v,
      origin[1]+uvec[1]*u+vvec[1]*v,
      origin[2]+uvec[2]*u+vvec[2]*v
    ];
    const corners=[at(a,b),at(a+du,b),at(a+du,b+dv),at(a,b+dv)];
    result.push({
      building:id,surface,corners,
      center:at(a+du/2,b+dv/2),
      normal:[...normal],
      hours:0
    });
  }
}

/** Samples ground, all roofs, and all four facades. */
export function makeCells(scene,grid=4) {
  if(!(grid>=1 && grid<=15)) throw new Error("Grid size must be 1–15 m.");
  const out=[];
  const g=scene.ground;
  const {nx,ny}=subdivide(g.w,g.d,grid);
  const du=g.w/nx,dv=g.d/ny;
  for(let j=0;j<ny;j++) for(let i=0;i<nx;i++){
    const x=g.x+i*du,y=g.y+j*dv;
    const cx=x+du/2,cy=y+dv/2;
    if(scene.buildings.some(b=>cx>b.x && cx<b.x+b.w && cy>b.y && cy<b.y+b.d)) continue;
    out.push({
      building:"ground",surface:"ground",
      corners:[[x,y,0],[x+du,y,0],[x+du,y+dv,0],[x,y+dv,0]],
      center:[cx,cy,0],normal:[0,0,1],hours:0
    });
  }
  for(const b of scene.buildings){
    buildFaceCells(out,b.id,"roof",[b.x,b.y,b.h],[1,0,0],[0,1,0],b.w,b.d,[0,0,1],grid);
    buildFaceCells(out,b.id,"south",[b.x,b.y,0],[1,0,0],[0,0,1],b.w,b.h,[0,-1,0],grid);
    buildFaceCells(out,b.id,"north",[b.x,b.y+b.d,0],[1,0,0],[0,0,1],b.w,b.h,[0,1,0],grid);
    buildFaceCells(out,b.id,"west",[b.x,b.y,0],[0,1,0],[0,0,1],b.d,b.h,[-1,0,0],grid);
    buildFaceCells(out,b.id,"east",[b.x+b.w,b.y,0],[0,1,0],[0,0,1],b.d,b.h,[1,0,0],grid);
  }
  return out;
}

export function rayHitsBox(origin,direction,b,epsilon=1e-5) {
  const min=[b.x,b.y,0],max=[b.x+b.w,b.y+b.d,b.h];
  let near=-Infinity,far=Infinity;
  for(let i=0;i<3;i++){
    const d=direction[i],v=origin[i];
    if(Math.abs(d)<1e-12){
      if(v<min[i] || v>max[i]) return false;
      continue;
    }
    let t0=(min[i]-v)/d,t1=(max[i]-v)/d;
    if(t0>t1){const temp=t0;t0=t1;t1=temp;}
    near=Math.max(near,t0);
    far=Math.min(far,t1);
    if(far<near) return false;
  }
  return far>epsilon && near<Infinity;
}

function dot3(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}

/** Async iteration yields control between solar samples for responsive mobile UI. */
export async function analyzeSunHours(scene,options={},onProgress=()=>{}) {
  const opts={lat:51.92,lon:4.48,year:2026,month:6,day:21,step:30,grid:4,tz:null,north:0,...options};
  if(!Number.isFinite(opts.lat) || Math.abs(opts.lat)>90) throw new Error("Latitude must be between -90 and 90.");
  if(!Number.isFinite(opts.lon) || Math.abs(opts.lon)>180) throw new Error("Longitude must be between -180 and 180.");
  if(![10,15,20,30,60].includes(opts.step)) throw new Error("Choose a 10, 15, 20, 30, or 60-minute step.");
  const time=sunSamples(opts);
  const cells=makeCells(scene,opts.grid);
  const n=time.samples.length;
  for(let k=0;k<n;k++){
    const v=time.samples[k].dir;
    for(const cell of cells){
      if(dot3(cell.normal,v)<=1e-8) continue;
      const org=[
        cell.center[0]+cell.normal[0]*0.03+v[0]*0.005,
        cell.center[1]+cell.normal[1]*0.03+v[1]*0.005,
        cell.center[2]+cell.normal[2]*0.03+v[2]*0.005
      ];
      let blocked=false;
      for(const b of scene.buildings){
        if(rayHitsBox(org,v,b)){ blocked=true;break; }
      }
      if(!blocked) cell.hours+=opts.step/60;
    }
    if(k%3===0 || k===n-1){
      onProgress(n ? (k+1)/n : 1);
      if(k<n-1) await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  const values=cells.map(c=>c.hours);
  const sum=values.reduce((a,b)=>a+b,0);
  const ground=cells.filter(c=>c.surface==="ground");
  const facade=cells.filter(c=>!["ground","roof"].includes(c.surface));
  const mean=(arr)=>arr.length ? arr.reduce((s,c)=>s+c.hours,0)/arr.length : 0;
  return {
    scene,options:opts,cells,
    sun:time.samples,
    timezone:time.tz,
    daylightHours:time.daylightHours,
    metrics:{
      cells:cells.length,
      samples:n,
      min:values.length?Math.min(...values):0,
      mean:values.length?sum/values.length:0,
      max:values.length?Math.max(...values):0,
      groundMean:mean(ground),
      facadeMean:mean(facade),
      sunlit2h:values.length ? 100*values.filter(v=>v>=2).length/values.length : 0
    }
  };
}

export function hoursColor(hours,maximum) {
  const t=maximum<=0?0:Math.max(0,Math.min(1,hours/maximum));
  const stops=[[0,[40,60,160]],[.33,[60,170,200]],[.66,[245,210,60]],[1,[215,50,40]]];
  for(let i=0;i<stops.length-1;i++){
    const [t0,c0]=stops[i],[t1,c1]=stops[i+1];
    if(t<=t1){
      const a=(t-t0)/(t1-t0);
      return c0.map((n,j)=>Math.round(n+(c1[j]-n)*a));
    }
  }
  return [...stops[stops.length-1][1]];
}

export function colorCss(hours,maximum){
  const [r,g,b]=hoursColor(hours,maximum);
  return `rgb(${r},${g},${b})`;
}
