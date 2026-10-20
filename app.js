const commands = [
  {id:"M005",name:"SunCarve",cat:"Massing",desc:"Greedy planar and stepped cuts that improve useful facade sun while controlling volume loss.",rhino:"7 + 8",network:"No",tags:["Solar","Optimization"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"A001",name:"SunHours",cat:"Analysis",desc:"Shading-aware sun-hours analysis using solar positions and context geometry.",rhino:"7 + 8",network:"No",tags:["Solar","Environmental"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"W001",name:"WindScreen",cat:"Analysis",desc:"Fast 2D lattice-Boltzmann wind screening at pedestrian height.",rhino:"8",network:"Optional",tags:["Wind","Screening"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"A002",name:"SolarRadiation",cat:"Analysis",desc:"Cumulative solar radiation and PV estimate with context shading and weather data.",rhino:"7 + 8",network:"Yes",tags:["Solar","PV"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"W002",name:"WindComfort",cat:"Analysis",desc:"NEN 8100 wind comfort screening across multiple wind sectors.",rhino:"8",network:"Yes",tags:["Wind","Comfort"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"X000",name:"SiteModel",cat:"Site",desc:"Generate 3D site context from latitude and longitude using BAG and OSM sources.",rhino:"7 + 8",network:"Yes",tags:["Context","OSM"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"M003",name:"Density",cat:"Massing",desc:"Floor plates, GFA, FSI, GSI, OSR, envelope and orientation metrics.",rhino:"7 + 8",network:"No",tags:["Metrics","Spacemate"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"M004",name:"Pixelate",cat:"Massing",desc:"Pixelate massing into cubes, tetrahedra or staggered triangular cells.",rhino:"7 + 8",network:"No",tags:["Geometry","Voxel"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"M006",name:"EmbodiedCarbon",cat:"Analysis",desc:"Estimate embodied carbon by structure, facade, reuse and new construction.",rhino:"7 + 8",network:"No",tags:["Carbon","LCA"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"E001",name:"Scoreboard",cat:"Evaluation",desc:"Snapshot, weight, rank and compare design options with Pareto scoring.",rhino:"7 + 8",network:"No",tags:["Options","Pareto"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"G001",name:"VoxelGrowth",cat:"Generative",desc:"Analysis-driven voxel growth massing with sun, density and cantilever controls.",rhino:"8",network:"No",tags:["Generative","Massing"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"G005",name:"BriefGrowth",cat:"Generative",desc:"Brief-driven voxel growth that matches programme requirements.",rhino:"8",network:"No",tags:["Brief","Generative"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"F001",name:"FacadePanels",cat:"Facade",desc:"Panelize facade surfaces and evaluate flat versus warped panels.",rhino:"7 + 8",network:"No",tags:["Panels","Geometry"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"F002",name:"SunFacade",cat:"Facade",desc:"Sun-responsive facade grid where annual exposure controls opening size.",rhino:"7 + 8",network:"No",tags:["Solar","Facade"],creator:"Bertrand Tan",version:"0.1.0"},
  {id:"S001",name:"SpiralStair",cat:"Geometry",desc:"Generate a configurable spiral stair with treads, column, rail and balusters.",rhino:"7 + 8",network:"No",tags:["Stairs","Generator"],creator:"Bertrand Tan",version:"0.1.0"},
];

const categoryInfo = {
  Analysis:["◫","Environmental and spatial analysis"],
  Massing:["▱","Urban form and volumetrics"],
  Facade:["▦","Panels, systems and envelopes"],
  Generative:["✦","Form finding and rule-based growth"],
  Geometry:["◇","Modelling tools and generators"],
  Site:["⌖","Context, mapping and site data"],
  Evaluation:["◎","Compare and score design options"]
};

let activeCategory = "All";
let sideMode = "discover";
const saved = new Set();
const grid = document.querySelector("#commandGrid");
const resultMeta = document.querySelector("#resultMeta");
const empty = document.querySelector("#emptyState");
const search = document.querySelector("#searchInput");
const sort = document.querySelector("#sortSelect");
const strip = document.querySelector("#categoryStrip");
const sidebar = document.querySelector("#categorySidebar");
const drawer = document.querySelector("#detailDrawer");
const backdrop = document.querySelector("#drawerBackdrop");
let currentCommand = null;
const liveDemoPaths=Object.freeze({
  A001:"demo/sunhours.html",
  W001:"demo/wind.html"
});

function categories() {
  return [...new Set(commands.map(c => c.cat))];
}
function countCat(cat){ return commands.filter(c => c.cat === cat).length; }

function renderCategories(){
  strip.innerHTML = categories().slice(0,6).map(cat => {
    const info = categoryInfo[cat] || ["•","Community tools"];
    return `<button class="category-card ${activeCategory===cat?"active":""}" data-cat="${cat}">
      <span class="category-icon">${info[0]}</span>
      <strong>${cat}</strong><small>${countCat(cat)}</small>
      <p>${info[1]}</p>
    </button>`;
  }).join("");

  sidebar.innerHTML = categories().map(cat => `<button class="sideitem ${activeCategory===cat?"active":""}" data-cat="${cat}">
    <span>${(categoryInfo[cat]||["•"])[0]}</span>${cat}<small style="margin-left:auto;color:#aaa">${countCat(cat)}</small>
  </button>`).join("");
}

function filteredCommands(){
  const q = search.value.trim().toLowerCase();
  let list = commands.filter(c => {
    const categoryMatch = activeCategory === "All" || c.cat === activeCategory;
    const savedMatch = sideMode !== "saved" || saved.has(c.id);
    const queryMatch = !q || [c.name,c.cat,c.desc,c.creator,...c.tags].join(" ").toLowerCase().includes(q);
    return categoryMatch && savedMatch && queryMatch;
  });
  if(sort.value==="name") list.sort((a,b)=>a.name.localeCompare(b.name));
  if(sort.value==="category") list.sort((a,b)=>a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
  if(sort.value==="featured") list.sort((a,b)=>commands.indexOf(a)-commands.indexOf(b));
  return list;
}

function render(){
  const list = filteredCommands();
  resultMeta.textContent = `${list.length} command${list.length===1?"":"s"}`;
  empty.hidden = list.length > 0;

  grid.innerHTML = list.map(c => `
    <article class="command-card" data-id="${c.id}" data-cat="${c.cat}">
      <button class="card-open" data-open="${c.id}" aria-label="Open ${c.name}">
        <div class="card-visual"></div>
      </button>
      <div class="card-body">
        <div class="card-title-row">
          <div class="card-name"><span class="card-icon">${c.name.slice(0,2).toUpperCase()}</span><h3>${c.name}</h3></div>
          <span class="version">v${c.version}</span>
        </div>
        <p>${c.desc}</p>
        <div class="creator"><span class="creator-avatar"></span><span>${c.creator}</span></div>
        <div class="tags"><span class="tag">${c.cat}</span>${c.tags.map(t=>`<span class="tag">${t}</span>`).join("")}</div>
        <div class="card-footer">
          <span class="card-stats">${c.id} · Rhino ${c.rhino}</span>
          <div class="card-actions">${c.id==="A001"?'<a class="try-demo" href="./demo/sunhours.html">▶ Try live demo</a>':c.id==="W001"?'<a class="try-demo" href="./demo/wind.html">▶ Try live demo</a>':""}<button class="install-mini" data-install="${c.id}">Install</button></div>
        </div>
      </div>
    </article>`).join("");
}

function openDetail(id){
  const c=commands.find(x=>x.id===id);
  if(!c)return;
  currentCommand=c;
  const demo=liveDemoPaths[c.id]||null;
  const isSaved=saved.has(c.id);
  const saveButton=document.querySelector("#saveCommand");
  saveButton.textContent=isSaved?"♥ Saved":"♡ Save";

  const livePreview=demo?`
    <section class="detail-live" aria-label="Live interactive ${c.name} demonstration">
      <div class="detail-live-heading">
        <span class="live-status"><span class="live-dot"></span> LIVE INTERACTIVE SIMULATION</span>
        <span class="live-instruction">Orbit, adjust inputs and rerun — right here</span>
        <a class="detail-expand" href="./${demo}" target="_blank" rel="noopener noreferrer">Open full workspace ↗</a>
      </div>
      <div class="detail-frame-wrap">
        <div class="detail-frame-loading" id="detailFrameLoading" role="status">
          <span class="loading-orbit" aria-hidden="true"></span>
          Loading ${c.name} simulation…
        </div>
        <iframe
          id="liveCommandFrame"
          class="detail-live-iframe"
          title="Interactive ${c.name} analysis"
          src="./${demo}?embed=1"
          loading="eager"
          scrolling="no"
          referrerpolicy="same-origin"
        ></iframe>
      </div>
      <p class="detail-live-caption">This is the real browser-based computation, not a screenshot. Early-stage design screening only; results depend on the simplified sample geometry and analysis settings.</p>
    </section>`:`
    <section class="detail-showcase">
      <div class="hero-preview" aria-label="Illustrative command preview"></div>
      <div class="detail-copy">
        <p>${c.name} comes from the Hark seed command library. A runnable web demo hasn't been published for this command yet.</p>
        <div class="tags"><span class="tag">${c.cat}</span>${c.tags.map(t=>`<span class="tag">${t}</span>`).join("")}</div>
        <div class="notice">No invented ratings or downloads. Community metrics will only appear when there is real activity.</div>
      </div>
    </section>`;

  document.querySelector("#detailContent").innerHTML=`
    <div class="detail-wrap">
      <div class="detail-head">
        <div class="detail-thumb ${demo?"detail-thumb-live":""}" ${demo?`style="background-image:url('./assets/thumbnails/${c.id}.png')"`:""}></div>
        <div>
          <div class="detail-name-row">
            <h2>${c.name}</h2>
            <span class="version">v${c.version}</span>
            ${demo?'<span class="detail-runtime-badge">RUNNABLE</span>':""}
          </div>
          <p class="detail-summary">${c.desc}</p>
          <div class="author-row">
            <span class="creator-avatar"></span><strong>${c.creator}</strong>
            <span>· ${c.id}</span>
          </div>
        </div>
      </div>
      <div class="detail-tabs">
        <span class="active">${demo?"Live demo":"Overview"}</span>
        <span>README</span><span>Inputs / Outputs</span><span>Dependencies</span>
      </div>
      ${livePreview}
      <div class="detail-columns">
        <section class="detail-section">
          <h3>About ${c.name}</h3>
          <p>${c.desc}</p>
          <h3>Command details</h3>
          <ul>
            <li>Runs as a Rhino Python command</li>
            <li>Rhino compatibility: ${c.rhino}</li>
            <li>Network requirement: ${c.network}</li>
            <li>${demo?"Demo runs independently in your browser":"Browser execution not yet available"}</li>
          </ul>
        </section>
        <section class="detail-section">
          <h3>Package</h3>
          <ul>
            <li>ID: ${c.id}</li>
            <li>Version: ${c.version}</li>
            <li>Host: Rhino</li>
            <li>Language: Python</li>
          </ul>
          <h3>Open command standard</h3>
          <p>Commands will support inspectable source, dependencies and typed inputs and outputs, for people and eventually AI agents.</p>
        </section>
      </div>
    </div>`;

  drawer.classList.toggle("has-live-demo",Boolean(demo));
  drawer.classList.add("open");
  backdrop.classList.add("open");
  drawer.setAttribute("aria-hidden","false");
  drawer.scrollTop=0;
  document.body.classList.add("detail-is-open");

  if(demo){
    // The analysis starts as soon as the iframe is inserted. No "Try" click
    // and no duplicate demo implementation inside the marketplace.
    const frame=document.querySelector("#liveCommandFrame");
    const loading=document.querySelector("#detailFrameLoading");
    frame.addEventListener("load",()=>{
      if(loading)loading.hidden=true;
    },{once:true});
    frame.addEventListener("error",()=>{
      if(loading)loading.textContent="Could not load the live demo. Try the full workspace link.";
    },{once:true});
  }
}

function closeDetail(){
  drawer.classList.remove("open");
  backdrop.classList.remove("open");
  drawer.setAttribute("aria-hidden","true");
  drawer.classList.remove("has-live-demo");
  document.body.classList.remove("detail-is-open");
  // Destroy the embedded WebGL/Worker instance on close to release GPU and
  // CPU resources. Opening the command later starts a clean live simulation.
  document.querySelector("#detailContent").replaceChildren();
  currentCommand=null;
}

// Same-origin embedded demos tell us their intrinsic content height.
// The drawer scrolls once; we don't trap the user's touch gestures inside
// a second 850px-tall scrolling iframe.
window.addEventListener("message",event=>{
  if(event.origin!==location.origin)return;
  const data=event.data;
  if(data?.type!=="commands:embed-height")return;
  const frame=document.querySelector("#liveCommandFrame");
  if(!frame || event.source!==frame.contentWindow)return;
  const pixels=Number(data.height);
  if(!Number.isFinite(pixels))return;
  const height=Math.max(460,Math.min(3400,Math.ceil(pixels)+6));
  const previous=Number.parseFloat(frame.style.height||"0");
  if(Math.abs(previous-height)>5)frame.style.height=height+"px";
});

function openInstall(c){
  document.querySelector("#installTitle").textContent = `Install ${c.name}`;
  document.querySelector("#installDialog").showModal();
}

document.addEventListener("click", e => {
  const cat = e.target.closest("[data-cat]");
  if(cat && (cat.classList.contains("category-card") || cat.classList.contains("sideitem"))){
    activeCategory = cat.dataset.cat;
    sideMode = "discover";
    document.querySelectorAll(".sideitem").forEach(x=>x.classList.remove("active"));
    renderCategories(); render(); return;
  }
  const open = e.target.closest("[data-open]");
  if(open){ openDetail(open.dataset.open); return; }
  const install = e.target.closest("[data-install]");
  if(install){ e.stopPropagation(); openInstall(commands.find(c=>c.id===install.dataset.install)); return; }
});

document.querySelectorAll("[data-side]").forEach(btn => btn.addEventListener("click", () => {
  sideMode = btn.dataset.side;
  activeCategory = "All";
  document.querySelectorAll("[data-side]").forEach(x=>x.classList.toggle("active",x===btn));
  renderCategories(); render();
}));

search.addEventListener("input", render);
sort.addEventListener("change", render);
document.addEventListener("keydown", e => {
  if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==="k"){ e.preventDefault(); search.focus(); }
  if(e.key==="Escape" && drawer.classList.contains("open")) closeDetail();
});

document.querySelector("#closeDrawer").onclick = closeDetail;
backdrop.onclick = closeDetail;
document.querySelector("#installCommand").onclick = () => currentCommand && openInstall(currentCommand);
document.querySelector("#saveCommand").onclick = () => {
  if(!currentCommand) return;
  if(saved.has(currentCommand.id)) saved.delete(currentCommand.id); else saved.add(currentCommand.id);
  document.querySelector("#saveCommand").textContent = saved.has(currentCommand.id) ? "♥ Saved" : "♡ Save";
  render();
};

const pub = document.querySelector("#publishDialog");
["#publishBtn","#publishSideBtn"].forEach(sel => document.querySelector(sel).onclick = () => pub.showModal());
document.querySelector("#closePublish").onclick = () => pub.close();
document.querySelector("#closeInstall").onclick = () => document.querySelector("#installDialog").close();

renderCategories();
render();