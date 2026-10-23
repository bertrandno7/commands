import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const executablePath=[
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium"
].filter(Boolean).find(existsSync);

assert.ok(executablePath,"Chrome/Chromium required for basic-shape preview test");
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

async function waitForSunComplete(){
  await page.waitForFunction(
    ()=>document.querySelector("#progressLabel")?.textContent?.includes("complete") &&
      /[0-9]/.test(document.querySelector("#mean")?.textContent||""),
    null,{timeout:60000}
  );
}

async function waitForWindReady(){
  await page.waitForFunction(
    ()=>document.querySelector("#progressLabel")?.textContent?.includes("ready") &&
      /[0-9]/.test(document.querySelector("#mean")?.textContent||""),
    null,{timeout:100000}
  );
}

try{
  await page.goto(origin+"/demo/sunhours.html",{waitUntil:"domcontentloaded",timeout:30000});
  assert.equal(await page.locator("#projectGeometryMount").count(),0,
    "SunHours V1 must not expose project-upload UI");
  assert.equal(await page.locator("#scene").isEnabled(),true);
  await waitForSunComplete();
  assert.equal(await page.locator("#scene").inputValue(),"courtyard");

  await page.locator("#scene").selectOption("tower");
  await waitForSunComplete();
  assert.equal(await page.locator("#sceneTitle").textContent(),"Tower + context");
  const sunMean=Number.parseFloat(await page.locator("#mean").textContent());
  assert.ok(sunMean>=0,"Tower preset must produce numerical SunHours");
  await page.screenshot({path:"artifacts/basic-shape-sunhours.png",fullPage:false});

  await page.goto(origin+"/demo/wind.html",{waitUntil:"domcontentloaded",timeout:30000});
  assert.equal(await page.locator("#projectGeometryMount").count(),0,
    "WindScreen V1 must not expose project-upload UI");
  assert.equal(await page.locator("#scene").isEnabled(),true);
  await waitForWindReady();
  assert.equal(await page.locator("#scene").inputValue(),"courtyard");

  await page.locator("#scene").selectOption("tower");
  await waitForWindReady();
  assert.equal(await page.locator("#sceneTitle").textContent(),"Tower + context");
  const windMean=Number.parseFloat(await page.locator("#mean").textContent());
  assert.ok(windMean>.1&&windMean<3,"Tower preset must produce a plausible relative wind mean");
  await page.screenshot({path:"artifacts/basic-shape-wind.png",fullPage:false});

  assert.deepEqual(errors,[],"Basic-shape previews must run without page errors");
  console.log("Basic-shape previews passed: SunHours="+sunMean+" h; WindScreen="+windMean+"×");
}finally{
  await browser.close();
}
