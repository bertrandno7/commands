/**
 * Capture card thumbnails from every registry command with preview.type=web.
 *
 * There is no hard-coded demo list. Add a command package, give it a web
 * preview in command.json (or a standard preview/index.html), run the registry
 * build, and this script discovers/captures it automatically.
 */
import assert from "node:assert/strict";
import {
  existsSync,mkdirSync,readFileSync,statSync,writeFileSync
} from "node:fs";
import {resolve,join} from "node:path";
import {chromium} from "playwright-core";

const ORIGIN=process.env.COMMANDS_PREVIEW_ORIGIN||"http://127.0.0.1:8765";
const SITE_ORIGIN=ORIGIN.endsWith("/")?ORIGIN.slice(0,-1):ORIGIN;
const OUTPUT=resolve(process.env.COMMANDS_THUMB_DIR||"assets/thumbnails");
const REGISTRY=resolve("generated/commands.json");
const FRAME={width:960,height:540};

assert.ok(existsSync(REGISTRY),
  "generated/commands.json is missing; run npm run registry first.");
const registry=JSON.parse(readFileSync(REGISTRY,"utf8"));
const DEMOS=registry.commands
  .filter(c=>c.listed!==false&&c.kind==="command"&&c.preview?.type==="web")
  .map(c=>({
    id:c.id,
    name:c.name,
    path:c.preview.entry,
    capture:c.preview.capture,
    ready:c.preview.ready,
    prepare:c.preview.prepare||{}
  }));

assert.ok(DEMOS.length>0,"Registry contains no runnable web previews.");

const executablePath=[
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean).find(existsSync);
assert.ok(executablePath,
  "Chrome/Chromium is required (set CHROME_PATH if not in default locations).");

const browser=await chromium.launch({
  headless:true,executablePath,
  args:[
    "--no-sandbox",
    "--enable-webgl",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader"
  ]
});

mkdirSync(OUTPUT,{recursive:true});

const captureStyle=`
  html{scroll-behavior:auto!important}
  body{overflow:visible!important}
  .workspace{
    grid-template-columns:310px 960px!important;
    width:1284px!important;
    max-width:none!important;
  }
  .visual-panel{
    box-sizing:border-box!important;
    display:block!important;
    position:relative!important;
    width:960px!important;
    min-width:960px!important;
    max-width:960px!important;
    height:540px!important;
    min-height:540px!important;
    max-height:540px!important;
    border:none!important;
    border-radius:0!important;
    box-shadow:none!important;
    overflow:hidden!important;
  }
  .visual-panel>.viewer-bar,
  .visual-panel>.viewer-footer,
  .visual-panel>.display-controls{display:none!important}
  .visual-panel>#view,
  .visual-panel>.wind-stage,
  .wind-stage>#view{
    display:block!important;
    box-sizing:border-box!important;
    width:960px!important;
    height:540px!important;
    min-height:540px!important;
    max-height:540px!important;
  }
  .wind-stage,.pixel-stage,[data-command-preview]{
    position:relative!important;
    flex:none!important;
    overflow:hidden!important;
    width:960px!important;
    height:540px!important;
    min-height:540px!important;
    max-height:540px!important;
  }
  .pixel-stage>#view{width:960px!important;height:540px!important}
  #flowOverlay{width:960px!important;height:540px!important}
  .visual-panel>.legend{left:20px!important;bottom:20px!important}
  .wind-legend{left:20px!important;bottom:20px!important}
  .wind-indicator{top:20px!important;left:20px!important}
`;

async function waitUntilReady(page,demo){
  await page.waitForFunction(
    ({ready})=>{
      const marker=document.querySelector(ready.selector);
      const metric=document.querySelector(ready.metric);
      if(!marker||!metric)return false;
      const markerText=(marker.textContent||"").trim();
      const metricValue=((metric.value??metric.textContent)||"").trim();
      let readyState=true;
      if(ready.includes!=null)readyState=markerText.includes(String(ready.includes));
      if(ready.attribute){
        const value=marker.getAttribute(ready.attribute);
        readyState=readyState&&(
          ready.equals==null?value!=null:value===String(ready.equals)
        );
      }
      return readyState&&/[0-9]/.test(metricValue)&&!metricValue.includes("—");
    },
    {ready:demo.ready},
    {timeout:120000}
  );
}

async function preparePreview(page,prepare){
  for(const [selector,value] of Object.entries(prepare.select||{}))
    await page.locator(selector).selectOption(String(value));
  for(const selector of prepare.uncheck||[])
    await page.locator(selector).uncheck();
  for(const selector of prepare.check||[])
    await page.locator(selector).check();
  for(const selector of prepare.click||[])
    await page.locator(selector).click();
}

const manifest=[];
try{
  for(const demo of DEMOS){
    const page=await browser.newPage({
      viewport:{width:1500,height:1000},
      deviceScaleFactor:1,
      colorScheme:"light",
      reducedMotion:"reduce"
    });
    const errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    try{
      const url=SITE_ORIGIN+"/"+demo.path;
      console.log("Capturing "+demo.id+" from "+url);
      await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000});
      await waitUntilReady(page,demo);
      assert.deepEqual(errors,[],demo.id+": no runtime JavaScript errors");

      await preparePreview(page,demo.prepare);
      await page.addStyleTag({content:captureStyle});
      const target=page.locator(demo.capture);
      assert.equal(await target.count(),1,
        demo.id+": capture selector must match exactly one element: "+demo.capture);
      await target.scrollIntoViewIfNeeded();
      await page.waitForTimeout(650);

      const dimensions=await target.evaluate(el=>({
        width:el.getBoundingClientRect().width,
        height:el.getBoundingClientRect().height
      }));
      assert.ok(Math.abs(dimensions.width-FRAME.width)<1&&
        Math.abs(dimensions.height-FRAME.height)<1,
        demo.id+": thumbnail view must be exactly 960×540");

      const file=join(OUTPUT,demo.id+".png");
      await target.screenshot({
        path:file,type:"png",animations:"disabled",timeout:25000
      });
      const bytes=statSync(file).size;
      assert.ok(bytes>15000,demo.id+": unexpected blank or tiny capture");
      console.log("✔ "+demo.id+" "+dimensions.width+"×"+
        dimensions.height+" ("+Math.round(bytes/1024)+" KiB)");

      manifest.push({
        id:demo.id,name:demo.name,
        image:"assets/thumbnails/"+demo.id+".png",
        from:demo.path,width:FRAME.width,height:FRAME.height
      });
    }finally{
      await page.close();
    }
  }

  writeFileSync(join(OUTPUT,"manifest.json"),
    JSON.stringify({kind:"computed-preview",format:"png",demos:manifest},null,2)+"\n");
  console.log("Generated "+manifest.length+" live-command thumbnails");

  const marketplace=await browser.newPage({viewport:{width:1450,height:950}});
  const homepageErrors=[];
  marketplace.on("pageerror",err=>homepageErrors.push(err.message));
  try{
    await marketplace.goto(SITE_ORIGIN+"/",{
      waitUntil:"domcontentloaded",timeout:30000
    });
    await marketplace.waitForFunction(
      count=>document.querySelectorAll(".command-card").length===count,
      registry.listedCount,
      {timeout:15000}
    );
    assert.deepEqual(homepageErrors,[],
      "Marketplace must render without JavaScript errors");

    for(const demo of DEMOS){
      const card=marketplace.locator('.command-card[data-id="'+demo.id+'"]');
      assert.equal(await card.count(),1,demo.id+" must have a card");
      const background=await card.locator(".card-visual").evaluate(
        el=>getComputedStyle(el).backgroundImage
      );
      assert.ok(background.includes(demo.id+".png"),
        demo.id+" must use its computed screenshot");

      const image=await marketplace.request.get(
        SITE_ORIGIN+"/assets/thumbnails/"+demo.id+".png"
      );
      assert.ok(image.ok(),demo.id+" thumbnail must return HTTP 200");
      assert.ok((await image.body()).length>15000);

      const target=await card.getAttribute("data-demo");
      assert.equal(target,"./"+demo.path,
        demo.id+" card must point directly to its full preview");
    }

    assert.equal(await marketplace.locator("#detailDrawer").count(),0);
    assert.equal(await marketplace.locator("#categoryStrip").count(),0);
    console.log("✔ Registry-driven marketplace displays "+registry.listedCount+
      " commands and all "+DEMOS.length+" live previews");
  }finally{
    await marketplace.close();
  }
}finally{
  await browser.close();
}
