/**
 * Build COMMANDS registry from the repository filesystem.
 *
 * Source of truth:
 *   commands/<package>/command.json + Python source
 *
 * Convenience:
 *   A loose .py file anywhere below commands/ is also discovered automatically
 *   when its directory does not contain command.json. Metadata is inferred
 *   from the filename/docstring so a script cannot silently disappear from
 *   the catalogue.
 *
 * Browser previews are explicit. If preview/index.html exists beside an
 * inferred script, it is auto-discovered using the standard preview contract.
 */
import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync
} from "node:fs";
import {dirname,join,relative,resolve,sep} from "node:path";
import {createHash} from "node:crypto";

const ROOT=resolve(process.cwd());
const COMMANDS=join(ROOT,"commands");
const GENERATED=join(ROOT,"generated");
const OUT=join(GENERATED,"commands.json");

const CATEGORY_BY_PREFIX={
  A:"Analysis",W:"Analysis",E:"Evaluation",F:"Facade",
  G:"Generative",M:"Massing",S:"Geometry",X:"Site"
};

function posix(path){return path.split(sep).join("/");}
function titleCase(value){
  return value
    .replace(/^[A-Za-z]\d{3}[_-]?/,"")
    .replace(/\.py$/i,"")
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(x=>x.charAt(0).toUpperCase()+x.slice(1))
    .join("");
}
function slugify(value){
  return value
    .replace(/([a-z0-9])([A-Z])/g,"$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"")||"command";
}
function regexEscape(value){
  return value.replace(/[.*+?^$()|[\]\\{}]/g,"\\$&");
}
function extractSummary(source,name){
  const match=source.match(/^\s*(?:[rubf]{0,2})?("""|''')([\s\S]*?)\1/m);
  if(!match)return name+" Python command.";
  const lines=match[2].split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  for(const line of lines){
    if(/^[-=]{3,}$/.test(line))continue;
    if(new RegExp("^"+regexEscape(name)+"\\b","i").test(line))continue;
    const cleaned=line.replace(/^\w\d{3}\s*[:\-–—]?\s*/,"").trim();
    if(cleaned.length>=18)return cleaned.slice(0,220);
  }
  return (lines[0]||name+" Python command.").slice(0,220);
}
function inferId(path){
  const base=path.split("/").at(-1)||"";
  const folder=path.split("/").at(-2)||"";
  const match=(base+" "+folder).match(/\b([A-Za-z]\d{3})\b/);
  if(match)return match[1].toUpperCase();
  const hash=createHash("sha1").update(path).digest("hex").slice(0,6).toUpperCase();
  return "C"+hash;
}
function walk(dir){
  if(!existsSync(dir))return [];
  const out=[];
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    const full=join(dir,entry.name);
    if(entry.isDirectory())out.push(...walk(full));
    else if(entry.isFile())out.push(full);
  }
  return out;
}
function standardPreview(packageDir){
  const page=join(packageDir,"preview","index.html");
  if(!existsSync(page))return {type:"none"};
  return {
    type:"web",
    entry:posix(relative(ROOT,page)),
    capture:"[data-command-preview]",
    ready:{
      selector:"body",
      attribute:"data-preview-ready",
      equals:"true",
      metric:"[data-preview-metric]"
    }
  };
}
function normalizeNetwork(value){
  if(value===true)return "required";
  if(value===false||value==null)return "none";
  const v=String(value).toLowerCase();
  return ["none","optional","required"].includes(v)?v:"optional";
}
function validatePreview(preview,id){
  if(!preview||preview.type==="none")return {type:"none"};
  if(preview.type!=="web")throw new Error(id+": preview.type must be web or none");
  if(!preview.entry)throw new Error(id+": web preview requires preview.entry");
  const file=join(ROOT,preview.entry);
  if(!existsSync(file))throw new Error(id+": preview entry does not exist: "+preview.entry);
  const ready=preview.ready||{};
  if(!ready.selector)throw new Error(id+": web preview requires preview.ready.selector");
  if(!ready.metric)throw new Error(id+": web preview requires preview.ready.metric");
  return {
    ...preview,
    capture:preview.capture||"[data-command-preview]",
    thumbnail:"assets/thumbnails/"+id+".png"
  };
}
function normalizeManifest(raw,packageDir,entryPath){
  const id=String(raw.id||inferId(posix(relative(ROOT,entryPath)))).toUpperCase();
  const name=String(raw.name||titleCase(entryPath));
  const packagePath=posix(relative(ROOT,packageDir));
  const runtime={
    host:raw.runtime?.host||"rhino",
    rhino:raw.runtime?.rhino||">=7",
    language:raw.runtime?.language||"python",
    entry:raw.runtime?.entry||posix(relative(packageDir,entryPath))
  };
  const runtimeFile=join(packageDir,runtime.entry);
  if(!existsSync(runtimeFile))
    throw new Error(id+": runtime entry does not exist: "+posix(relative(ROOT,runtimeFile)));

  const preview=validatePreview(raw.preview||standardPreview(packageDir),id);
  return {
    schemaVersion:String(raw.schemaVersion||"0.2"),
    id,
    slug:String(raw.slug||slugify(name)),
    name,
    version:String(raw.version||"0.1.0"),
    summary:String(raw.summary||extractSummary(readFileSync(entryPath,"utf8"),name)),
    kind:String(raw.kind||"command"),
    listed:raw.listed!==false,
    author:{name:String(raw.author?.name||raw.creator||"Community")},
    runtime,
    category:String(raw.category||CATEGORY_BY_PREFIX[id[0]]||"Utilities"),
    tags:Array.isArray(raw.tags)?raw.tags.map(String):[],
    network:normalizeNetwork(raw.network),
    preview,
    packagePath,
    sourcePath:posix(relative(ROOT,runtimeFile)),
    source:raw.source||{origin:"Repository"}
  };
}

export function buildRegistry(){
  if(!existsSync(COMMANDS))throw new Error("commands/ directory is missing");
  const files=walk(COMMANDS);
  const manifests=files.filter(x=>x.endsWith(sep+"command.json"));
  const packageDirs=new Set(manifests.map(dirname));
  const records=[];

  for(const manifestPath of manifests){
    const packageDir=dirname(manifestPath);
    const raw=JSON.parse(readFileSync(manifestPath,"utf8"));
    const entry=join(packageDir,raw.runtime?.entry||"main.py");
    records.push(normalizeManifest(raw,packageDir,entry));
  }

  for(const python of files.filter(x=>x.toLowerCase().endsWith(".py"))){
    const packageDir=dirname(python);
    if(packageDirs.has(packageDir))continue;
    const source=readFileSync(python,"utf8");
    const id=inferId(posix(relative(ROOT,python)));
    const name=titleCase(python);
    records.push(normalizeManifest({
      id,name,slug:slugify(name),version:"0.1.0",
      summary:extractSummary(source,name),
      category:CATEGORY_BY_PREFIX[id[0]]||"Utilities",
      tags:[],network:"none",preview:standardPreview(packageDir),
      source:{origin:"Auto-discovered Python script"}
    },packageDir,python));
  }

  const byId=new Map();
  for(const command of records){
    if(byId.has(command.id))
      throw new Error("Duplicate command id "+command.id+": "+
        byId.get(command.id).sourcePath+" and "+command.sourcePath);
    byId.set(command.id,command);
  }
  records.sort((a,b)=>a.id.localeCompare(b.id));

  const registry={
    schemaVersion:"0.2",
    commandCount:records.length,
    listedCount:records.filter(x=>x.listed).length,
    livePreviewCount:records.filter(x=>x.listed&&x.preview.type==="web").length,
    commands:records
  };
  mkdirSync(GENERATED,{recursive:true});
  writeFileSync(OUT,JSON.stringify(registry,null,2)+"\n","utf8");
  return registry;
}

const registry=buildRegistry();
console.log(
  "COMMANDS registry: "+registry.commandCount+" packages, "+
  registry.listedCount+" listed, "+registry.livePreviewCount+" live previews"
);
