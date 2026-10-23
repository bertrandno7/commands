import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const executablePath=[
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium"
].filter(Boolean).find(existsSync);

assert.ok(executablePath,"Chrome/Chromium required for shared project browser test");
mkdirSync("artifacts",{recursive:true});

const browser=await chromium.launch({
  headless:true,
  executablePath,
  args:["--no-sandbox","--enable-webgl","--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"]
});
const context=await browser.newContext({viewport:{width:1320,height:900}});
const page=await context.newPage();
const errors=[];
page.on("pageerror",error=>errors.push(error.message));
const origin=(process.env.COMMANDS_PREVIEW_ORIGIN||"http://127.0.0.1:8765").replace(/\/$/,"");

const cube=[
  "v 0 0 0","v 10 0 0","v 10 10 0","v 0 10 0",
  "v 0 0 10","v 10 0 10","v 10 10 10","v 0 10 10",
  "f 1 4 3 2","f 5 6 7 8","f 1 2 6 5",
  "f 2 3 7 6","f 3 4 8 7","f 4 1 5 8"
].join("\n");

async function seedProject(){
  await page.evaluate(async source=>{
    const db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open("commands-project-v1",1);
      request.onupgradeneeded=()=>{
        if(!request.result.objectStoreNames.contains("project"))
          request.result.createObjectStore("project");
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    const record={
      key:"active",
      version:1,
      name:"Shared browser cube",
      units:"m",
      updatedAt:new Date().toISOString(),
      files:[{
        name:"shared-cube.obj",
        size:source.length,
        type:"text/plain",
        lastModified:Date.now(),
        role:"analysis",
        blob:new Blob([source],{type:"text/plain"})
      }]
    };
    await new Promise((resolve,reject)=>{
      const tx=db.transaction("project","readwrite");
      tx.objectStore("project").put(record,"active");
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
    });
    db.close();
    const bc=new BroadcastChannel("commands-project");
    bc.postMessage({type:"commands:project-changed",updatedAt:record.updatedAt});
    bc.close();
  },cube);
}

try{
  await page.goto(origin+"/demo/sunhours.html",{waitUntil:"domcontentloaded",timeout:30000});
  await page.waitForFunction(
    ()=>document.querySelector("#progressLabel")?.textContent?.includes("complete") &&
      document.querySelector("#sceneTitle")?.textContent==="Rotterdam courtyard",
    null,{timeout:60000}
  );
  assert.equal(await page.locator("#projectGeometryMount").isHidden(),true,
    "Default SunHours must stay focused on sample geometry");

  await page.goto(origin+"/demo/sunhours.html?project=1",{waitUntil:"domcontentloaded",timeout:30000});
  await page.waitForSelector("#projectGeometryMount .shared-project-card",{timeout:15000});
  await seedProject();

  await page.waitForFunction(
    ()=>document.querySelector("#sceneTitle")?.textContent==="Shared browser cube" &&
      document.querySelector("#progressLabel")?.textContent?.includes("complete") &&
      document.querySelector("#mean")?.textContent?.includes("h"),
    null,{timeout:60000}
  );
  assert.equal(await page.locator("#scene").isDisabled(),true);
  assert.ok(await page.locator("#sampleSceneField").evaluate(el=>el.classList.contains("project-overridden")));
  assert.ok((await page.locator("#sceneSubtitle").textContent()).includes("triangles"));
  const sunMean=Number.parseFloat(await page.locator("#mean").textContent());
  assert.ok(sunMean>0,"Uploaded project must produce numerical SunHours");
  await page.screenshot({path:"artifacts/project-shared-sunhours.png",fullPage:false});

  await page.goto(origin+"/demo/wind.html?project=1",{waitUntil:"domcontentloaded",timeout:30000});
  await page.waitForFunction(
    ()=>document.querySelector("#sceneTitle")?.textContent==="Shared browser cube" &&
      document.querySelector("#progressLabel")?.textContent?.includes("ready") &&
      document.querySelector("#mean")?.textContent?.includes("×"),
    null,{timeout:100000}
  );
  assert.equal(await page.locator("#scene").isDisabled(),true);
  assert.ok((await page.locator("#sceneSubtitle").textContent()).includes("1.5 m above base"));
  const windMean=Number.parseFloat(await page.locator("#mean").textContent());
  assert.ok(windMean>.1&&windMean<3,"Same uploaded project must feed WindScreen");
  assert.ok((await page.locator("#resultLabel").textContent()).includes("Shared browser cube"));
  await page.screenshot({path:"artifacts/project-shared-wind.png",fullPage:false});

  assert.deepEqual(errors,[],"Shared-project demos must run without page errors");
  console.log("Shared project passed: SunHours mean="+sunMean+" h; WindScreen mean="+windMean+"×");
}finally{
  await browser.close();
}
