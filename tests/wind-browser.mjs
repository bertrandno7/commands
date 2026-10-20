/**
 * COMMANDS WindScreen smoke tests: real Worker calculation and 3D rendering.
 * Invoked after serving the static site on http://127.0.0.1:8765 .
 */
import assert from "node:assert/strict";
import {existsSync,mkdirSync} from "node:fs";
import {chromium} from "playwright-core";

const paths=[
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium"
].filter(Boolean);
const executablePath=paths.find(existsSync);
assert.ok(executablePath,"Chromium or Chrome must be installed in CI");
mkdirSync("artifacts",{recursive:true});
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

async function runViewport(label,config){
  const page=await browser.newPage(config);
  const errors=[];
  page.on("pageerror",err=>errors.push(err.message));
  page.on("console",msg=>{
    if(msg.type()==="error")errors.push("Console: "+msg.text());
  });
  page.on("requestfailed",req=>{
    errors.push("Request failed: "+req.url()+" "+req.failure()?.errorText);
  });

  await page.goto("http://127.0.0.1:8765/demo/wind.html",{
    waitUntil:"domcontentloaded",timeout:30000
  });
  await page.waitForFunction(
    ()=>document.querySelector("#progressLabel")?.textContent?.includes("ready") &&
      document.querySelector("#mean")?.textContent?.includes("×"),
    null,{timeout:100000}
  );
  assert.deepEqual(errors,[],"Wind screen must load without browser errors");
  const mean=Number.parseFloat(await page.locator("#mean").textContent());
  const peak=Number.parseFloat(await page.locator("#peak").textContent());
  assert.ok(mean>.1&&mean<3,"Physically plausible average normalized ratio");
  assert.ok(peak>1.2&&peak<6,"Accelerated regions must be present");
  assert.equal(await page.locator("#csv").isDisabled(),false);
  assert.ok((await page.locator("#stepCount").textContent()).includes("650"));
  assert.equal(await page.locator("#compassLabel").textContent(),"240° WSW");

  const canvas=page.locator("#view");
  assert.ok(await canvas.evaluate(c=>!!c.getContext("webgl")),"3D WebGL context");
  await canvas.scrollIntoViewIfNeeded();
  await canvas.screenshot({path:"artifacts/wind-"+label+"-initial.png"});

  // Verify the overlay is not empty: visible mean-field arrows or tracers.
  await page.waitForTimeout(250);
  const overlays=await page.locator("#flowOverlay").evaluate(c=>{
    const a=c.getContext("2d").getImageData(0,0,c.width,c.height).data;
    let painted=0;
    for(let i=3;i<a.length;i+=4)if(a[i]>20)painted++;
    return painted;
  });
  assert.ok(overlays>40,"Velocity overlay must contain real vectors/particles");

  const baseline=await canvas.evaluate(c=>c.toDataURL());
  const b=await canvas.boundingBox();
  await page.mouse.move(b.x+b.width*.58,b.y+b.height*.43);
  await page.mouse.down({button:"right"});
  await page.mouse.move(b.x+b.width*.58+95,b.y+b.height*.43-38,{steps:8});
  await page.mouse.up({button:"right"});
  const rotated=await canvas.evaluate(c=>c.toDataURL());
  assert.notEqual(rotated,baseline,"Rhino RMB drag must orbit wind massing");
  await canvas.screenshot({path:"artifacts/wind-"+label+"-orbit.png"});

  await page.locator("#viewProjection").selectOption("top");
  await canvas.screenshot({path:"artifacts/wind-"+label+"-top.png"});
  await page.locator("#viewProjection").selectOption("perspective");
  const speedBefore=await page.locator("#scaled").textContent();
  await page.locator("#windSpeed").fill("9");
  const speedAfter=await page.locator("#scaled").textContent();
  assert.notEqual(speedBefore,speedAfter,"Free wind speed rescales output");

  if(label==="desktop"){
    // Re-running with a new wind direction should produce a new solution,
    // rather than rotating the old field cosmetically.
    await page.locator('[data-wind-from="270"]').click();
    await page.waitForFunction(
      ()=>document.querySelector("#progressLabel")?.textContent?.includes("ready") &&
        document.querySelector("#resultLabel")?.textContent?.includes("270°"),
      null,{timeout:100000}
    );
    assert.equal(await page.locator("#compassLabel").textContent(),"270° W");
    assert.deepEqual(errors,[],"No errors when switching direction and rerunning");
    await canvas.screenshot({path:"artifacts/wind-"+label+"-westerly.png"});
  }
  console.log("WindScreen "+label+" passed: mean="+mean+" peak="+peak+" overlay pixels="+overlays);
  await page.close();
}

try{
  await runViewport("desktop",{viewport:{width:1400,height:900},deviceScaleFactor:1});
  await runViewport("mobile",{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
}finally{
  await browser.close();
}
