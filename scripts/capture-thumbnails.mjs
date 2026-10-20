/**
 * COMMANDS — real preview thumbnails, generated during GitHub Pages builds.
 *
 * Capture the actual finished analysis viewport, not a mockup:
 *   A001 -> /demo/sunhours.html -> /assets/thumbnails/A001.png
 *   W001 -> /demo/wind.html     -> /assets/thumbnails/W001.png
 *
 * Extend DEMOS when a future command gets a runnable preview.
 * Requires a local static HTTP server and playwright-core + installed Chrome.
 * No API token, GPU subscription or image generation model is needed.
 */
import assert from "node:assert/strict";
import {existsSync,mkdirSync,statSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {chromium} from "playwright-core";

const ORIGIN=process.env.COMMANDS_PREVIEW_ORIGIN||"http://127.0.0.1:8765";
const SITE_ORIGIN=ORIGIN.endsWith("/")?ORIGIN.slice(0,-1):ORIGIN;
const OUTPUT=resolve(process.env.COMMANDS_THUMB_DIR||"assets/thumbnails");
const FRAME={width:960,height:540};

const DEMOS=[
  {
    id:"A001",
    name:"SunHours",
    path:"demo/sunhours.html",
    capture:".visual-panel",
    done:"complete",
    metric:"#mean"
  },
  {
    id:"W001",
    name:"WindScreen",
    path:"demo/wind.html",
    capture:".wind-stage",
    done:"ready",
    metric:"#peak"
  },
  {
    id:"M004",
    name:"Pixelate",
    path:"demo/pixel.html",
    capture:".pixel-stage",
    done:"complete",
    metric:"#count"
  }
];

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

// Capture the same native live viewport at a consistent 16:9 crop across
// commands.  Only page presentation is altered, not geometry or solver state.
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
  .wind-stage,
  .pixel-stage{
    position:relative!important;
    flex:none!important;
    overflow:hidden!important;
    width:960px!important;
    height:540px!important;
    min-height:540px!important;
  }
  .pixel-stage>#view{width:960px!important;height:540px!important}
  #flowOverlay{width:960px!important;height:540px!important}
  .visual-panel>.legend{
    left:20px!important;
    bottom:20px!important;
  }
  .wind-legend{left:20px!important;bottom:20px!important}
  .wind-indicator{top:20px!important;left:20px!important}
`;

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
      // Wait for a real completed numerical solve, not a skeleton loader.
      await page.waitForFunction(
        ({finished,metric})=>{
          const label=document.querySelector("#progressLabel")?.textContent||"";
          const value=document.querySelector(metric)?.textContent||"";
          return label.includes(finished)&&
            /[0-9]/.test(value)&&
            !value.includes("—");
        },
        {finished:demo.done,metric:demo.metric},
        {timeout:120000}
      );
      assert.deepEqual(errors,[],demo.id+": no runtime JavaScript errors");

      const gl=await page.locator("#view").evaluate(
        canvas=>Boolean(canvas.getContext("webgl"))
      );
      assert.ok(gl,demo.id+": a valid WebGL viewport is required");

      if(demo.id==="W001"){
        // Keep flow vectors but turn off moving tracers, so reruns make a
        // stable image from the finished numerical solution.
        await page.locator("#showParticles").uncheck();
      }else if(demo.id==="A001"){
        // Frame the result tightly for small cards. The live demo still
        // defaults to 35 mm; only its thumbnail uses this 50 mm view.
        await page.locator("#viewLens").selectOption("50");
      }

      await page.addStyleTag({content:captureStyle});
      const target=page.locator(demo.capture);
      await target.scrollIntoViewIfNeeded();
      await page.waitForTimeout(650); // ResizeObserver + WebGL redraw
      const dimensions=await target.evaluate(el=>({
        width:el.getBoundingClientRect().width,
        height:el.getBoundingClientRect().height
      }));
      assert.ok(Math.abs(dimensions.width-FRAME.width)<1 &&
        Math.abs(dimensions.height-FRAME.height)<1,
        demo.id+": thumbnail view must be exactly 960×540");

      const file=join(OUTPUT,demo.id+".png");
      await target.screenshot({
        path:file,
        type:"png",
        animations:"disabled",
        timeout:25000
      });
      const bytes=statSync(file).size;
      assert.ok(bytes>15000,demo.id+": unexpected blank or tiny capture");
      console.log("✔ "+demo.id+" "+dimensions.width+"×"+
        dimensions.height+" ("+Math.round(bytes/1024)+" KiB)");
      manifest.push({
        id:demo.id,
        name:demo.name,
        image:"assets/thumbnails/"+demo.id+".png",
        from:demo.path,
        width:FRAME.width,
        height:FRAME.height
      });
    }finally{
      await page.close();
    }
  }
  writeFileSync(join(OUTPUT,"manifest.json"),
    JSON.stringify({kind:"computed-preview",format:"png",demos:manifest},null,2)+"\n");
  console.log("Generated "+manifest.length+" live-command thumbnails");

  // Verify that the actual homepage uses the generated screenshots. This
  // catches a broken card script or stale CSS before GitHub Pages deploys.
  const marketplace=await browser.newPage({viewport:{width:1450,height:950}});
  const homepageErrors=[];
  marketplace.on("pageerror",err=>homepageErrors.push(err.message));
  try{
    await marketplace.goto(SITE_ORIGIN+"/",{
      waitUntil:"domcontentloaded",timeout:30000
    });
    await marketplace.waitForFunction(
      ()=>document.querySelectorAll(".command-card").length>=15,
      null,{timeout:15000}
    );
    assert.deepEqual(homepageErrors,[],
      "Marketplace must render without JavaScript errors");

    for(const demo of DEMOS){
      const card=marketplace.locator(
        '.command-card[data-id="'+demo.id+'"]'
      );
      assert.equal(await card.count(),1,demo.id+" must have a card");
      const background=await card.locator(".card-visual").evaluate(
        el=>getComputedStyle(el).backgroundImage
      );
      assert.ok(background.includes(demo.id+".png"),
        demo.id+" must use its computed screenshot as the card background");
      const image=await marketplace.request.get(
        SITE_ORIGIN+"/assets/thumbnails/"+demo.id+".png"
      );
      assert.ok(image.ok(),demo.id+" card image must return HTTP 200");
      assert.equal((image.headers()["content-type"]||"").split(";")[0],
        "image/png");
      assert.ok((await image.body()).length>15000);
      assert.equal(await card.locator(".try-demo").count(),0,
        demo.id+" must not use a redundant live-demo button");
      const target=await card.getAttribute("data-demo");
      assert.equal(target,"./"+demo.path,
        demo.id+" card itself must point directly to its full runnable demo");
    }
    assert.equal(await marketplace.locator("#detailDrawer").count(),0,
      "Marketplace must not include an intermediate detail drawer");
    assert.equal(await marketplace.locator("#categoryStrip").count(),0,
      "Category navigation belongs only in the sidebar");
    console.log("✔ Marketplace displays all "+manifest.length+
      " computed thumbnails and direct-to-command cards");
  }finally{
    await marketplace.close();
  }
}finally{
  await browser.close();
}
