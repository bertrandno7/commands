const categoryInfo = {
  Analysis:["◫","Environmental and spatial analysis"],
  Massing:["▱","Urban form and volumetrics"],
  Facade:["▦","Panels, systems and envelopes"],
  Generative:["✦","Form finding and rule-based growth"],
  Geometry:["◇","Modelling tools and generators"],
  Site:["⌖","Context and mapping"],
  Evaluation:["◎","Compare design options"],
  Utilities:["·","Workflow and utility commands"]
};

let commands=[];
let activeCategory="All";

const grid=document.querySelector("#commandGrid");
const resultMeta=document.querySelector("#resultMeta");
const empty=document.querySelector("#emptyState");
const search=document.querySelector("#searchInput");
const sort=document.querySelector("#sortSelect");
const sidebar=document.querySelector("#categorySidebar");
const discoverAll=document.querySelector("#discoverAll");

const esc=value=>String(value??"")
  .replaceAll("&","&amp;")
  .replaceAll("<","&lt;")
  .replaceAll(">","&gt;")
  .replaceAll('"',"&quot;")
  .replaceAll("'","&#39;");

function categories(){
  return [...new Set(commands.map(c=>c.category))].sort((a,b)=>a.localeCompare(b));
}
function countCat(cat){
  return commands.filter(c=>c.category===cat).length;
}
function renderSidebar(){
  document.querySelector("#allCount").textContent=commands.length;
  discoverAll.classList.toggle("active",activeCategory==="All");
  sidebar.innerHTML=categories().map(cat=>{
    const info=categoryInfo[cat]||["·",""];
    return `<button class="sideitem ${activeCategory===cat?"active":""}" type="button"
      data-cat="${esc(cat)}" title="${esc(info[1])}">
      <span>${esc(info[0])}</span>
      <span>${esc(cat)}</span>
      <small>${countCat(cat)}</small>
    </button>`;
  }).join("");
}

function filteredCommands(){
  const q=search.value.trim().toLowerCase();
  let list=commands.filter(c=>{
    const categoryMatch=activeCategory==="All"||c.category===activeCategory;
    const haystack=[
      c.name,c.category,c.summary,c.author?.name,c.id,...(c.tags||[])
    ].join(" ").toLowerCase();
    return categoryMatch&&(!q||haystack.includes(q));
  });
  if(sort.value==="name")list.sort((a,b)=>a.name.localeCompare(b.name));
  if(sort.value==="category")
    list.sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name));
  if(sort.value==="featured")
    list.sort((a,b)=>a.id.localeCompare(b.id));
  return list;
}

function commandCard(c){
  const demo=c.preview?.type==="web"?c.preview.entry:null;
  const demoAttrs=demo
    ?` data-demo="./${esc(demo)}" tabindex="0" role="link" aria-label="Open ${esc(c.name)}"`
    :"";
  const thumb=c.preview?.thumbnail;
  const visualStyle=thumb
    ?` style="background-image:url('./${esc(thumb)}')"`
    :"";
  const rhino=c.runtime?.rhino||"—";
  return `<article class="command-card ${demo?"has-demo":""}"
      data-id="${esc(c.id)}" data-cat="${esc(c.category)}"${demoAttrs}>
    <div class="card-visual" aria-hidden="true"${visualStyle}></div>
    <div class="card-body">
      <div class="card-title-row">
        <div>
          <h3>${esc(c.name)}</h3>
          <span class="creator-name">${esc(c.author?.name||"Community")}</span>
        </div>
        <div class="title-meta">
          <span class="version">v${esc(c.version)}</span>
          ${demo?'<span class="open-mark" aria-hidden="true">↗</span>':""}
        </div>
      </div>
      <p>${esc(c.summary)}</p>
      <div class="tags">${(c.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
      <div class="card-footer">
        <span class="card-stats">${esc(c.id)} · Rhino ${esc(rhino)}</span>
        <button class="install-mini" type="button" data-install="${esc(c.id)}">Install</button>
      </div>
    </div>
  </article>`;
}

function render(){
  const list=filteredCommands();
  resultMeta.textContent=`${list.length} command${list.length===1?"":"s"}`;
  empty.hidden=list.length>0;
  grid.innerHTML=list.map(commandCard).join("");
}

function setCategory(cat){
  activeCategory=cat;
  renderSidebar();
  render();
}

function openInstall(command){
  document.querySelector("#installTitle").textContent=`Install ${command.name}`;
  document.querySelector("#installDialog").showModal();
}

async function loadRegistry(){
  grid.setAttribute("aria-busy","true");
  const response=await fetch("./generated/commands.json",{cache:"no-store"});
  if(!response.ok)throw new Error("Registry request failed ("+response.status+")");
  const registry=await response.json();
  if(!Array.isArray(registry.commands))throw new Error("Registry has no commands array");
  commands=registry.commands.filter(c=>c.listed!==false&&c.kind==="command");
  renderSidebar();
  render();
  grid.removeAttribute("aria-busy");
}

document.addEventListener("click",event=>{
  const category=event.target.closest("[data-cat]");
  if(category&&category.classList.contains("sideitem")){
    setCategory(category.dataset.cat);
    return;
  }

  const install=event.target.closest("[data-install]");
  if(install){
    event.preventDefault();
    event.stopPropagation();
    const command=commands.find(c=>c.id===install.dataset.install);
    if(command)openInstall(command);
    return;
  }

  const card=event.target.closest(".command-card.has-demo");
  if(card?.dataset.demo)window.location.href=card.dataset.demo;
});

document.addEventListener("keydown",event=>{
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){
    event.preventDefault();
    search.focus();
    return;
  }
  if((event.key==="Enter"||event.key===" ")&&
      document.activeElement?.classList.contains("command-card")){
    const card=document.activeElement;
    if(card.dataset.demo){
      event.preventDefault();
      window.location.href=card.dataset.demo;
    }
  }
});

discoverAll.addEventListener("click",()=>setCategory("All"));
search.addEventListener("input",render);
sort.addEventListener("change",render);

const publish=document.querySelector("#publishDialog");
document.querySelector("#publishBtn").addEventListener("click",()=>publish.showModal());
document.querySelector("#publishSideBtn").addEventListener("click",()=>publish.showModal());
document.querySelector("#closePublish").addEventListener("click",()=>publish.close());
document.querySelector("#closeInstall").addEventListener("click",
  ()=>document.querySelector("#installDialog").close());

loadRegistry().catch(error=>{
  console.error(error);
  grid.removeAttribute("aria-busy");
  commands=[];
  renderSidebar();
  render();
  empty.hidden=false;
  empty.querySelector("h2").textContent="Command registry unavailable";
  empty.querySelector("p").textContent="The generated catalogue could not be loaded.";
});
