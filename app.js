const commands = [
  {id:"M005",name:"SunCarve",cat:"Massing",desc:"Greedy planar and stepped cuts that improve useful facade sun while controlling volume loss.",rhino:"7 + 8",network:"No",tags:["Solar","Optimization"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"A001",name:"SunHours",cat:"Analysis",desc:"Shading-aware sun-hours analysis using solar positions and context geometry.",rhino:"7 + 8",network:"No",tags:["Solar","Environmental"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"W001",name:"WindScreen",cat:"Analysis",desc:"Fast 2D lattice-Boltzmann wind screening at pedestrian height.",rhino:"8",network:"Optional",tags:["Wind","Screening"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"A002",name:"SolarRadiation",cat:"Analysis",desc:"Cumulative solar radiation and PV estimate with weather and context shading.",rhino:"7 + 8",network:"Yes",tags:["Solar","PV"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"W002",name:"WindComfort",cat:"Analysis",desc:"NEN 8100 wind comfort screening across multiple wind sectors.",rhino:"8",network:"Yes",tags:["Wind","Comfort"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"X000",name:"SiteModel",cat:"Site",desc:"Generate 3D context from latitude and longitude using BAG and OSM sources.",rhino:"7 + 8",network:"Yes",tags:["Context","OSM"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"M003",name:"Density",cat:"Massing",desc:"Floor plates, GFA, FSI, GSI, OSR, envelope and orientation metrics.",rhino:"7 + 8",network:"No",tags:["Metrics","Spacemate"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"M004",name:"Pixelate",cat:"Massing",desc:"Pixelate massing into cubes, tetrahedra or staggered triangular cells.",rhino:"7 + 8",network:"No",tags:["Geometry","Voxel"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"M006",name:"EmbodiedCarbon",cat:"Analysis",desc:"Estimate embodied carbon by structure, facade, reuse and new construction.",rhino:"7 + 8",network:"No",tags:["Carbon","LCA"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"E001",name:"Scoreboard",cat:"Evaluation",desc:"Snapshot, weight, rank and compare design options with Pareto scoring.",rhino:"7 + 8",network:"No",tags:["Options","Pareto"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"G001",name:"VoxelGrowth",cat:"Generative",desc:"Analysis-driven voxel growth massing with sun, density and cantilever controls.",rhino:"8",network:"No",tags:["Generative","Massing"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"G005",name:"BriefGrowth",cat:"Generative",desc:"Brief-driven voxel growth that matches programme requirements.",rhino:"8",network:"No",tags:["Brief","Generative"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"F001",name:"FacadePanels",cat:"Facade",desc:"Panelize facade surfaces and evaluate flat versus warped panels.",rhino:"7 + 8",network:"No",tags:["Panels","Geometry"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"F002",name:"SunFacade",cat:"Facade",desc:"Sun-responsive facade grid where annual exposure controls opening size.",rhino:"7 + 8",network:"No",tags:["Solar","Facade"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"S001",name:"SpiralStair",cat:"Geometry",desc:"Generate a configurable spiral stair with treads, column, rail and balusters.",rhino:"7 + 8",network:"No",tags:["Stairs","Generator"],creator:"Bertrand Tan",version:"0.1.0"}
];

const categoryInfo = {
  Analysis:["◫","Environmental and spatial analysis"],
  Massing:["▱","Urban form and volumetrics"],
  Facade:["▦","Panels, systems and envelopes"],
  Generative:["✦","Form finding and rule-based growth"],
  Geometry:["◇","Modelling tools and generators"],
  Site:["⌖","Context and mapping"],
  Evaluation:["◎","Compare design options"]
};

const liveDemoPaths = Object.freeze({
  A001:"demo/sunhours.html",
  W001:"demo/wind.html",
  M004:"demo/pixel.html"
});

let activeCategory = "All";

const grid = document.querySelector("#commandGrid");
const resultMeta = document.querySelector("#resultMeta");
const empty = document.querySelector("#emptyState");
const search = document.querySelector("#searchInput");
const sort = document.querySelector("#sortSelect");
const sidebar = document.querySelector("#categorySidebar");
const discoverAll = document.querySelector("#discoverAll");

function categories(){
  return [...new Set(commands.map(c=>c.cat))];
}

function countCat(cat){
  return commands.filter(c=>c.cat===cat).length;
}

function renderSidebar(){
  document.querySelector("#allCount").textContent=commands.length;
  discoverAll.classList.toggle("active",activeCategory==="All");

  sidebar.innerHTML=categories().map(cat=>{
    const info=categoryInfo[cat]||["•",""];
    return `<button class="sideitem ${activeCategory===cat?"active":""}" type="button" data-cat="${cat}" title="${info[1]}">
      <span>${info[0]}</span>
      <span>${cat}</span>
      <small>${countCat(cat)}</small>
    </button>`;
  }).join("");
}

function filteredCommands(){
  const q=search.value.trim().toLowerCase();
  let list=commands.filter(c=>{
    const categoryMatch=activeCategory==="All"||c.cat===activeCategory;
    const queryMatch=!q||[c.name,c.cat,c.desc,c.creator,...c.tags].join(" ").toLowerCase().includes(q);
    return categoryMatch&&queryMatch;
  });

  if(sort.value==="name") list.sort((a,b)=>a.name.localeCompare(b.name));
  if(sort.value==="category") list.sort((a,b)=>a.cat.localeCompare(b.cat)||a.name.localeCompare(b.name));
  if(sort.value==="featured") list.sort((a,b)=>commands.indexOf(a)-commands.indexOf(b));
  return list;
}

function commandCard(c){
  const demo=liveDemoPaths[c.id];
  const demoAttrs=demo
    ?` data-demo="./${demo}" tabindex="0" role="link" aria-label="Open ${c.name}"`
    :"";

  return `<article class="command-card ${demo?"has-demo":""}" data-id="${c.id}" data-cat="${c.cat}"${demoAttrs}>
    <div class="card-visual" aria-hidden="true"></div>
    <div class="card-body">
      <div class="card-title-row">
        <div>
          <h3>${c.name}</h3>
          <span class="creator-name">${c.creator}</span>
        </div>
        <div class="title-meta">
          <span class="version">v${c.version}</span>
          ${demo?'<span class="open-mark" aria-hidden="true">↗</span>':""}
        </div>
      </div>
      <p>${c.desc}</p>
      <div class="tags">${c.tags.map(t=>`<span class="tag">${t}</span>`).join("")}</div>
      <div class="card-footer">
        <span class="card-stats">${c.id} · Rhino ${c.rhino}</span>
        <button class="install-mini" type="button" data-install="${c.id}">Install</button>
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
  if(card&&card.dataset.demo){
    window.location.href=card.dataset.demo;
  }
});

document.addEventListener("keydown",event=>{
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){
    event.preventDefault();
    search.focus();
    return;
  }

  if((event.key==="Enter"||event.key===" ")&&document.activeElement?.classList.contains("command-card")){
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
document.querySelector("#closeInstall").addEventListener("click",()=>document.querySelector("#installDialog").close());

renderSidebar();
render();
