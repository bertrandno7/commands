const commands = [
{id:"A001",name:"SunHours",cat:"Analysis",desc:"Shading-aware sun-hours analysis using solar positions and context geometry.",rhino:"7 + 8",network:"No",tags:["Solar","Environmental"],featured:1},
{id:"A002",name:"SolarRadiation",cat:"Analysis",desc:"Cumulative solar radiation and PV estimate with context shading and weather data.",rhino:"7 + 8",network:"Yes",tags:["Solar","PV"],featured:2},
{id:"W001",name:"WindScreen",cat:"Analysis",desc:"Fast 2D lattice-Boltzmann wind screening at pedestrian height.",rhino:"8",network:"Optional",tags:["Wind","Screening"],featured:8},
{id:"W002",name:"WindComfort",cat:"Analysis",desc:"NEN 8100 wind comfort screening across multiple wind sectors.",rhino:"8",network:"Yes",tags:["Wind","Comfort"],featured:4},
{id:"X000",name:"SiteModel",cat:"Site",desc:"Generate 3D site context from latitude/longitude using BAG and OSM sources.",rhino:"7 + 8",network:"Yes",tags:["Context","OSM"],featured:3},
{id:"M003",name:"Density",cat:"Massing",desc:"Floor plates, GFA, FSI, GSI, OSR, envelope and orientation metrics.",rhino:"7 + 8",network:"No",tags:["Metrics","Spacemate"],featured:7},
{id:"M004",name:"Pixelate",cat:"Massing",desc:"Pixelate massing into cubes, tetrahedra or staggered triangular cells.",rhino:"7 + 8",network:"No",tags:["Geometry","Voxel"],featured:9},
{id:"M005",name:"SunCarve",cat:"Massing",desc:"Carve massing by searching for cuts that improve useful facade sun.",rhino:"7 + 8",network:"No",tags:["Solar","Optimization"],featured:0},
{id:"M006",name:"EmbodiedCarbon",cat:"Analysis",desc:"Estimate embodied carbon by structure, facade, reuse and new construction.",rhino:"7 + 8",network:"No",tags:["Carbon","LCA"],featured:6},
{id:"E001",name:"Scoreboard",cat:"Evaluation",desc:"Snapshot, weight, rank and compare design options with Pareto scoring.",rhino:"7 + 8",network:"No",tags:["Options","Pareto"],featured:5},
{id:"G001",name:"VoxelGrowth",cat:"Generative",desc:"Analysis-driven voxel growth massing with sun, density and cantilever controls.",rhino:"8",network:"No",tags:["Generative","Massing"],featured:10},
{id:"G005",name:"BriefGrowth",cat:"Generative",desc:"Brief-driven voxel growth that matches programme requirements.",rhino:"8",network:"No",tags:["Brief","Generative"],featured:11},
{id:"F001",name:"FacadePanels",cat:"Facade",desc:"Panelize facade surfaces and evaluate flat versus warped panels.",rhino:"7 + 8",network:"No",tags:["Panels","Geometry"],featured:12},
{id:"F002",name:"SunFacade",cat:"Facade",desc:"Sun-responsive facade grid where annual exposure controls opening size.",rhino:"7 + 8",network:"No",tags:["Solar","Facade"],featured:13},
{id:"S001",name:"SpiralStair",cat:"Geometry",desc:"Generate a configurable spiral stair with treads, column, rail and balusters.",rhino:"7 + 8",network:"No",tags:["Stairs","Generator"],featured:14}
];
let active="All"; const grid=document.querySelector("#grid"), filters=document.querySelector("#filters"), search=document.querySelector("#searchInput"), meta=document.querySelector("#resultMeta");
const cats=["All",...new Set(commands.map(c=>c.cat))];
filters.innerHTML=cats.map(c=>`<button class="filter ${c==="All"?"active":""}" data-cat="${c}">${c}</button>`).join("");
function render(){
 const q=search.value.trim().toLowerCase(); let list=commands.filter(c=>(active==="All"||c.cat===active)&&(!q||[c.name,c.cat,c.desc,...c.tags].join(" ").toLowerCase().includes(q)));
 const sort=document.querySelector("#sortSelect").value; if(sort==="name")list.sort((a,b)=>a.name.localeCompare(b.name)); else if(sort==="category")list.sort((a,b)=>a.cat.localeCompare(b.cat)); else list.sort((a,b)=>a.featured-b.featured);
 meta.textContent=`${list.length} command${list.length===1?"":"s"} · real seed tools from the Hark library`;
 grid.innerHTML=list.map(c=>`<article class="card" data-id="${c.id}">
 <div class="card-top"><div class="cmd-icon">${c.name.slice(0,2).toUpperCase()}</div><span class="status">DRAFT</span></div>
 <h3>${c.name}</h3><p>${c.desc}</p>
 <div class="tags"><span class="tag">${c.cat}</span>${c.tags.map(t=>`<span class="tag">${t}</span>`).join("")}</div>
 <div class="meta"><span>${c.id}</span><span>Rhino ${c.rhino}</span></div></article>`).join("");
 document.querySelectorAll(".card").forEach(el=>el.onclick=()=>openDetail(el.dataset.id));
}
filters.onclick=e=>{const b=e.target.closest(".filter");if(!b)return;active=b.dataset.cat;document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x===b));render()};
search.oninput=render; document.querySelector("#sortSelect").onchange=render;
document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();search.focus()}});
function openDetail(id){const c=commands.find(x=>x.id===id);document.querySelector("#detailContent").innerHTML=`<div class="detail-hero"><p class="eyebrow">${c.cat.toUpperCase()} · ${c.id}</p><h2>${c.name}</h2><p class="lede">${c.desc}</p><div class="tags"><span class="tag">Rhino ${c.rhino}</span>${c.tags.map(t=>`<span class="tag">${t}</span>`).join("")}</div><div class="detail-grid"><div class="detail-box"><strong>Runtime</strong><p>Rhino Python command. Network: ${c.network}. Seeded from Bertrand's working Hark command library.</p></div><div class="detail-box"><strong>Status</strong><p>Draft. This V0 deliberately avoids fake ratings, installs or community metrics.</p></div></div><pre class="detail-code">Command: ${c.name}\nPackage ID: ${c.id}\nHost: Rhino\nStatus: draft</pre></div>`;document.querySelector("#detailDialog").showModal()}
document.querySelector("#closeDetail").onclick=()=>document.querySelector("#detailDialog").close();
const pub=document.querySelector("#publishDialog"); function openPub(){pub.showModal()} document.querySelector("#publishBtn").onclick=openPub;document.querySelector("#heroPublish").onclick=openPub;document.querySelector("#closePublish").onclick=()=>pub.close();
render();