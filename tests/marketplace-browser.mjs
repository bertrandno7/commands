/**
 * COMMANDS marketplace smoke tests.
 * Command details must automatically mount the REAL runnable simulation.
 * No extra click or placeholder image is acceptable for A001 / W001.
 */
import assert from "node:assert/strict";
import {mkdirSync,existsSync} from "node:fs";
import {chromium} from "playwright-core";

const browserPath=[
  process.env.CHROME_PATH,"/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable","/usr/bin/chromium"
].filter(Boolean).find(existsSync);
assert.ok(browserPath,"Installed Chrome/Chromium required for smoke test");
mkdirSync("artifacts",{recursive:true});
const browser=await chromium.launch({
  headless:true,executablePath:browserPath,
  args:["--no-sandbox","--enable-webgl",
    "--enable-unsafe-swiftshader","--use-gl=angle",
    "--use-angle=swiftshader"]
});
const ORIGIN="http://127.0.0.1:8765";

async function openLive(page,id,expectedPath,completion,outputId,artifact){
  const previous=page.locator("#liveCommandFrame");
  assert.equal(await previous.count(),0,
    "Previous command WebGL frame must be destroyed on close");

  const button=page.locator('.command-card[data-id="'+id+'"] .card-open');
  assert.equal(await button.count(),1,id+" visible discover card");
  await button.click();
  const drawer=page.locator("#detailDrawer");
  await drawer.waitFor({state:"visible"});
  assert.ok(await drawer.evaluate(el=>el.classList.contains("has-live-demo")),
    id+" should use live viewer layout");
  const frame=page.locator("#liveCommandFrame");
  assert.equal(await frame.count(),1,id+" should auto-mount exactly one iframe");
  const src=await frame.getAttribute("src");
  assert.ok(src?.includes(expectedPath+"?embed=1"),"iframe source should be embedded live demo");

  // The outer detail UI must contain no static fake showroom image.
  assert.equal(await page.locator(".detail-showcase .hero-preview").count(),0);

  await page.waitForFunction(
    ({completion,outputId})=>{
      const inner=document.querySelector("#liveCommandFrame")?.contentDocument;
      const progress=inner?.querySelector("#progressLabel")?.textContent||"";
      const metric=inner?.querySelector(outputId)?.textContent||"";
      return progress.includes(completion)&&/[0-9]/.test(metric);
    },
    {completion,outputId},
    {timeout:120000}
  );
  assert.equal(await page.locator("#detailFrameLoading").isHidden(),true);
  const liveView=page.frameLocator("#liveCommandFrame").locator("#view");
  assert.ok(await liveView.evaluate(c=>Boolean(c.getContext("webgl"))),
    "Detail viewer should have real WebGL geometry");
  assert.equal(
    await page.locator(".detail-expand").getAttribute("href"),
    "./"+expectedPath
  );

  await drawer.screenshot({path:"artifacts/"+artifact+".png",timeout:25000});
  const text=await page.frameLocator("#liveCommandFrame")
    .locator(outputId).textContent();
  console.log(id+" embedded computation completed: "+text);
  await page.locator("#closeDrawer").click();
  await page.waitForFunction(
    ()=>!document.querySelector("#liveCommandFrame")
  );
}

async function run(mode,options){
  const page=await browser.newPage(options);
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto(ORIGIN+"/",{waitUntil:"domcontentloaded",timeout:30000});
  await page.waitForFunction(
    ()=>document.querySelectorAll(".command-card").length>=15
  );
  await openLive(page,"A001","demo/sunhours.html","complete","#mean","market-"+mode+"-sunhours");
  await openLive(page,"W001","demo/wind.html","ready","#peak","market-"+mode+"-wind");
  assert.deepEqual(errors,[],"No uncaught marketplace JS errors");
  await page.close();
}

try{
  await run("desktop",{viewport:{width:1440,height:960},deviceScaleFactor:1});
  await run("mobile",{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
}finally{
  await browser.close();
}
