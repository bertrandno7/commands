import {SunHoursViewer} from "./sunhours-viewer.js?v=12";

/**
 * Pixelate preview renders Hark's extracted polygon mesh using the exact same
 * native WebGL depth-tested 3D camera as SunHours/WindScreen.
 * Building silhouettes are used only to frame the camera; the original box
 * geometry is NOT shown, nor are fake illustrative cubes generated.
 */
export class PixelViewer{
 constructor(canvas){
  this.canvas=canvas;
  this.viewer=new SunHoursViewer(canvas);
  this.result=null;
  this.centerScene={
   ground:{x:-38,y:-30,w:85,d:66},
   buildings:[{x:-23,y:-10,w:45,d:20,h:50}]
  };
  this.viewer.setData(this.centerScene,null);
 }
 show(result){
  this.result=result;
  const b=result.bounds;
  const width=b.max[0]-b.min[0],depth=b.max[1]-b.min[1];
  const scene={
   ground:{
    x:b.min[0]-Math.max(10,width*.25),
    y:b.min[1]-Math.max(10,depth*.25),
    w:width+Math.max(20,width*.5),
    d:depth+Math.max(20,depth*.5)
   },
   buildings:[{
    x:b.min[0],y:b.min[1],
    w:width,d:depth,h:b.max[2]-b.min[2]
   }]
  };
  // Explicitly reset the camera only if the selected scene changes: do not
  // jump when users adjust voxel size, gap, modes or colors.
  const different=!this._sceneName||this._sceneName!==result.options.shape;
  this._sceneName=result.options.shape;
  if(different){
   this.centerScene=scene;
   this.viewer.scene=scene;
   this.viewer.reset();
   this.viewer.zoom=Math.max(.68,this.viewer.zoom);
  }
  const base=[],lines=[];
  const ground=scene.ground,z=-.08,col=[.89,.92,.90];
  for(const [x,y] of [
   [ground.x,ground.y],
   [ground.x+ground.w,ground.y],
   [ground.x+ground.w,ground.y+ground.d],
   [ground.x,ground.y+ground.d]
  ]){
   base.push([x,y,z,...col]);
  }
  const groundTriangles=[...base[0],...base[1],...base[2],
    ...base[0],...base[2],...base[3]];
  const guide=[.73,.79,.75];
  const putLine=(a,b)=>lines.push(...a,...guide,...b,...guide);
  for(let x=Math.ceil(ground.x/10)*10;x<=ground.x+ground.w;x+=10)
   putLine([x,ground.y,.08],[x,ground.y+ground.d,.08]);
  for(let y=Math.ceil(ground.y/10)*10;y<=ground.y+ground.d;y+=10)
   putLine([ground.x,y,.08],[ground.x+ground.w,y,.08]);
  this.viewer.uploadMeshes({
   base:groundTriangles,
   heat:result.geometry.vertices,
   outlines:result.geometry.edges,
   guides:lines
  });
  this.viewer.draw();
 }
 reset(){this.viewer.reset();}
 exportPNG(){
  this.viewer.savePNG("M004-Pixelate-"+(this.result?.modeName||"preview")+".png");
 }
 /** Offline OBJ for real generated polygons, not the original Rhino input. */
 exportOBJ(){
  if(!this.result)return;
  const data=this.result.geometry.vertices;
  const rows=["# M004 Pixelate - COMMANDS live browser result",
    "# "+this.result.modeName+" "+this.result.count+" pixels"];
  for(let i=0;i<data.length;i+=6)rows.push(
    "v "+data[i].toFixed(5)+" "+data[i+1].toFixed(5)+" "+data[i+2].toFixed(5));
  for(let i=0;i<data.length/6;i+=3)
   rows.push("f "+(i+1)+" "+(i+2)+" "+(i+3));
  const blob=new Blob([rows.join("\n")],{type:"text/plain"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download="M004-"+this.result.modeName+".obj";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
 }
}
