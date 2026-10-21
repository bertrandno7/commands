import {
  getActiveProjectRecord,
  loadActiveProjectGeometry,
  projectRecordStats,
  subscribeProjectChanges
} from "./project-geometry.js?v=1";

const bytes=value=>{
  if(value<1024*1024)return Math.max(1,Math.round(value/1024))+" KB";
  return (value/1024/1024).toFixed(value>20*1024*1024?0:1)+" MB";
};

export async function attachProjectPanel({mount,onProjectChanged}){
  if(!mount)throw new Error("Project panel mount is missing.");
  let disposed=false;
  let serial=0;

  const renderEmpty=()=>{
    mount.innerHTML=
      '<div class="shared-project-card is-empty">'+
        '<div class="shared-project-head"><span>COMMANDS PROJECT</span><small>Shared input</small></div>'+
        '<strong>Use your own geometry</strong>'+
        '<p>Load one OBJ, STL or GLB project and reuse it across compatible commands.</p>'+
        '<a class="shared-project-action" href="/project" target="_top">Set project geometry ↗</a>'+
        '<small class="shared-project-privacy">Local browser storage · geometry is not uploaded</small>'+
      '</div>';
  };

  const renderLoading=()=>{
    mount.innerHTML=
      '<div class="shared-project-card is-loading">'+
        '<div class="shared-project-head"><span>COMMANDS PROJECT</span><small>Reading local model…</small></div>'+
        '<div class="shared-project-skeleton"></div>'+
        '<div class="shared-project-skeleton short"></div>'+
      '</div>';
  };

  const refresh=async()=>{
    const token=++serial;
    renderLoading();
    try{
      const record=await getActiveProjectRecord();
      if(disposed||token!==serial)return;
      if(!record){
        renderEmpty();
        await onProjectChanged(null,null);
        return;
      }
      const stats=projectRecordStats(record);
      const project=await loadActiveProjectGeometry();
      if(disposed||token!==serial)return;
      mount.innerHTML=
        '<div class="shared-project-card is-active">'+
          '<div class="shared-project-head"><span>COMMANDS PROJECT</span><small class="shared-project-live">ACTIVE</small></div>'+
          '<strong>'+escapeHtml(project.name)+'</strong>'+
          '<div class="shared-project-meta">'+
            '<span>'+project.triangleCount.toLocaleString()+' triangles</span>'+
            '<span>'+stats.fileCount+' file'+(stats.fileCount===1?'':'s')+'</span>'+
            '<span>'+bytes(stats.bytes)+'</span>'+
          '</div>'+
          '<p>'+(stats.contextFiles?stats.contextFiles+' context file'+(stats.contextFiles===1?'':'s')+' · ':'')+
            'source units '+escapeHtml(record.units||'m')+'</p>'+
          '<a class="shared-project-action subtle" href="/project" target="_top">Manage project ↗</a>'+
          '<small class="shared-project-privacy">Shared automatically with other browser-capable commands</small>'+
        '</div>';
      await onProjectChanged(project,null);
    }catch(error){
      if(disposed||token!==serial)return;
      mount.innerHTML=
        '<div class="shared-project-card is-error">'+
          '<div class="shared-project-head"><span>COMMANDS PROJECT</span><small>Needs attention</small></div>'+
          '<strong>Could not read project geometry</strong>'+
          '<p>'+escapeHtml(error instanceof Error?error.message:String(error))+'</p>'+
          '<a class="shared-project-action" href="/project" target="_top">Fix project geometry ↗</a>'+
        '</div>';
      await onProjectChanged(null,error);
    }
  };

  const unsubscribe=subscribeProjectChanges(refresh);
  await refresh();
  return {
    refresh,
    destroy(){
      disposed=true;
      if(unsubscribe)unsubscribe();
    }
  };
}

function escapeHtml(value){
  return String(value??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}
