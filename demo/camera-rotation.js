/**
 * COMMANDS — unbounded 3D camera rotation.
 *
 * A unit quaternion is stored as [x, y, z, w], with camera +X pointing
 * screen-right, +Y pointing screen-up and +Z pointing back at the viewer.
 * The world-space viewing direction is -rotate(q,[0,0,1]).
 *
 * Unlike yaw/elevation "turntable" rotation, camera-local quaternions have
 * no poles, +/-90 degree clamp or gimbal lock. Moving the mouse repeatedly
 * can make arbitrarily many complete revolutions, including upside down.
 */
export function quatNormalize(q){
  const n=Math.hypot(q[0],q[1],q[2],q[3]);
  if(!Number.isFinite(n)||n<1e-12)return [0,0,0,1];
  return q.map(v=>v/n);
}

export function quatMultiply(a,b){
  const [ax,ay,az,aw]=a,[bx,by,bz,bw]=b;
  return [
    aw*bx+ax*bw+ay*bz-az*by,
    aw*by-ax*bz+ay*bw+az*bx,
    aw*bz+ax*by-ay*bx+az*bw,
    aw*bw-ax*bx-ay*by-az*bz
  ];
}

export function quatAxisAngle(axis,angle){
  const len=Math.hypot(...axis);
  if(len<1e-12||!Number.isFinite(len)||!Number.isFinite(angle))
    return [0,0,0,1];
  const s=Math.sin(angle/2)/len;
  return [
    axis[0]*s,axis[1]*s,axis[2]*s,Math.cos(angle/2)
  ];
}

export function quatRotate(q,v){
  // Quaternion vector rotation without allocating intermediate quaternions.
  const [x,y,z,w]=q;
  const t=[
    2*(y*v[2]-z*v[1]),
    2*(z*v[0]-x*v[2]),
    2*(x*v[1]-y*v[0])
  ];
  return [
    v[0]+w*t[0]+y*t[2]-z*t[1],
    v[1]+w*t[1]+z*t[0]-x*t[2],
    v[2]+w*t[2]+x*t[1]-y*t[0]
  ];
}

function cross(a,b){
  return [
    a[1]*b[2]-a[2]*b[1],
    a[2]*b[0]-a[0]*b[2],
    a[0]*b[1]-a[1]*b[0]
  ];
}
function unit(v){
  const n=Math.hypot(...v);
  return v.map(x=>x/n);
}

/** Rotate camera +X/+Y/+Z axes to right/up/back axes in world coordinates. */
export function quatFromBasis(right,up,back){
  const m00=right[0],m01=up[0],m02=back[0];
  const m10=right[1],m11=up[1],m12=back[1];
  const m20=right[2],m21=up[2],m22=back[2];
  const trace=m00+m11+m22;
  let x,y,z,w;
  if(trace>0){
    const s=Math.sqrt(trace+1)*2;
    w=s/4;x=(m21-m12)/s;y=(m02-m20)/s;z=(m10-m01)/s;
  }else if(m00>m11&&m00>m22){
    const s=Math.sqrt(1+m00-m11-m22)*2;
    w=(m21-m12)/s;x=s/4;y=(m01+m10)/s;z=(m02+m20)/s;
  }else if(m11>m22){
    const s=Math.sqrt(1+m11-m00-m22)*2;
    w=(m02-m20)/s;x=(m01+m10)/s;y=s/4;z=(m12+m21)/s;
  }else{
    const s=Math.sqrt(1+m22-m00-m11)*2;
    w=(m10-m01)/s;x=(m02+m20)/s;y=(m12+m21)/s;z=s/4;
  }
  return quatNormalize([x,y,z,w]);
}

/** Initial Rhino-style architecture view, no ongoing Euler angles. */
export function defaultCameraOrientation(yaw=-.72,elevation=.61){
  const ce=Math.cos(elevation),se=Math.sin(elevation);
  const back=[
    ce*Math.sin(yaw),
    -ce*Math.cos(yaw),
    se
  ];
  const forward=back.map(v=>-v);
  const right=unit(cross(forward,[0,0,1]));
  const up=unit(cross(back,right));
  return quatFromBasis(right,up,back);
}

/** Current view-relative right/up/back axes, orthonormal at all angles. */
export function cameraAxes(q){
  const right=quatRotate(q,[1,0,0]);
  const up=quatRotate(q,[0,1,0]);
  const back=quatRotate(q,[0,0,1]);
  return {right,up,back,forward:back.map(v=>-v)};
}

/**
 * Free tumble: any number of 360-degree revolutions, including through the
 * vertical poles. Rotations are incremental in the current camera plane.
 * No clamping of elevation and no world-up reconstitution every frame.
 */
export function freeOrbit(q,dx,dy,sensitivity=.0065){
  if(!Number.isFinite(dx)||!Number.isFinite(dy))return quatNormalize(q);
  const pixels=Math.hypot(dx,dy);
  if(pixels<1e-12)return quatNormalize(q);
  // Drag model right => turn camera left, drag model down => tilt camera up.
  const delta=quatAxisAngle([-dy,-dx,0],pixels*sensitivity);
  return quatNormalize(quatMultiply(q,delta));
}

/** Optional view-axis roll for fully unconstrained 3-axis navigation. */
export function rollView(q,delta,sensitivity=.0065){
  const rotation=quatAxisAngle([0,0,1],delta*sensitivity);
  return quatNormalize(quatMultiply(q,rotation));
}
