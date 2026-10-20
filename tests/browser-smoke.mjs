import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const chromePaths=[
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium"
].filter(Boolean);
const executablePath=chromePaths.find(existsSync);
assert.ok(executablePath,"CI runner needs an installed Chromium or Google Chrome");
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

async function checkPage(label,opts){
  const page=await browser.newPage(opts);
  const pageErrors=[];
  page.on("pageerror",err=>pageErrors.push(err.message));

  await page.goto("http://127.0.0.1:8765/demo/sunhours.html",{
    waitUntil:"domcontentloaded",timeout:30000
  });
  await page.waitForFunction(
    ()=>document.querySelector("#mean")?.textContent?.includes("h") &&
        document.querySelector("#progressLabel")?.textContent?.includes("complete"),
    {timeout:30000}
  );
  assert.deepEqual(pageErrors,[],"No uncaught page errors");
  const mean=await page.locator("#mean").textContent();
  const touchAction=await page.locator("#view").evaluate(x=>getComputedStyle(x).touchAction);
  assert.equal(touchAction,"none","Touch gestures must reach the viewport");

  const hasGL=await page.locator("#view").evaluate(c=>!!c.getContext("webgl"));
  await page.locator("#view").screenshot({path:"artifacts/sunhours-"+label+"-initial.png"});

  if(hasGL){
    const element=page.locator("#view");
    const bounds=await element.boundingBox();
    const x=bounds.x+bounds.width*.56, y=bounds.y+bounds.height*.5;
    const before=await element.evaluate(c=>c.toDataURL());
    await page.mouse.move(x,y);
    await page.mouse.down({button:"right"});
    await page.mouse.move(x+110,y-58,{steps:8});
    await page.mouse.up({button:"right"});
    const after=await element.evaluate(c=>c.toDataURL());
    assert.notEqual(after,before,"Orbit must move model image");
    await element.screenshot({path:"artifacts/sunhours-"+label+"-orbit.png"});

    if(label==="desktop"){
      const beforePan=await element.evaluate(c=>c.toDataURL());
      await page.mouse.move(x,y);
      await page.keyboard.down("Shift");
      await page.mouse.down({button:"right"});
      await page.mouse.move(x+75,y+35,{steps:6});
      await page.mouse.up({button:"right"});
      await page.keyboard.up("Shift");
      const afterPan=await element.evaluate(c=>c.toDataURL());
      assert.notEqual(afterPan,beforePan,"Rhino Shift+RMB pan must move the view");
      await element.screenshot({path:"artifacts/sunhours-desktop-pan.png"});
    }

    // Rhino Top: right drag pans; Perspective: right drag orbits.
    await page.locator("#viewProjection").selectOption("top");
    assert.ok((await page.locator("#navHint").textContent()).includes("RMB pan"));
    await element.screenshot({path:"artifacts/sunhours-"+label+"-top.png"});
    await page.locator("#viewProjection").selectOption("perspective");

    if(label==="mobile"){
      await page.locator("#viewToolPan").click();
      assert.equal(await page.locator("#viewToolPan").getAttribute("aria-pressed"),"true");
      assert.ok((await page.locator("#navHint").textContent()).includes("1 finger pan"));
      const beforePan=await element.evaluate(c=>c.toDataURL());
      await element.evaluate(c=>{
        const p=(type,x,y)=>c.dispatchEvent(new PointerEvent(type,{
          bubbles:true,cancelable:true,pointerId:10,pointerType:"touch",
          clientX:x,clientY:y,button:0,isPrimary:true
        }));
        p("pointerdown",180,240);
        p("pointermove",225,285);
        p("pointerup",225,285);
      });
      const afterPan=await element.evaluate(c=>c.toDataURL());
      assert.notEqual(afterPan,beforePan,"Touch Pan mode must move the model");
      await element.screenshot({path:"artifacts/sunhours-mobile-pan.png"});
    }


    if(label==="mobile"){
      // Dispatch two-finger pointer events directly to test gesture handling.
      const beforePinch=await element.evaluate(c=>c.toDataURL());
      await element.evaluate(c=>{
        const p=(type,id,x,y)=>c.dispatchEvent(new PointerEvent(type,{
          bubbles:true,cancelable:true,pointerId:id,pointerType:"touch",
          clientX:x,clientY:y,button:0,isPrimary:id===11
        }));
        p("pointerdown",11,160,200);
        p("pointerdown",12,260,200);
        p("pointermove",12,320,200);
        p("pointerup",11,160,200);
        p("pointerup",12,320,200);
      });
      const afterPinch=await element.evaluate(c=>c.toDataURL());
      assert.notEqual(afterPinch,beforePinch,"Pinch must update camera");
    }
  }else{
    console.warn(label+": WebGL disabled in CI; tested 2D fallback");
  }

  await page.locator('[data-date="2026-12-21"]').click();
  await page.waitForFunction(
    ()=>document.querySelector("#resultLabel")?.textContent.includes("21 / 12 / 2026"),
    {timeout:30000}
  );
  assert.deepEqual(pageErrors,[],"No errors after changing season");
  const winter=await page.locator("#mean").textContent();
  console.log(label+" passed — June mean "+mean+"; December mean "+winter+"; WebGL="+hasGL);
  await page.close();
}

try{
  await checkPage("desktop",{viewport:{width:1380,height:900},deviceScaleFactor:1});
  await checkPage("mobile",{viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true});
}finally{
  await browser.close();
}
