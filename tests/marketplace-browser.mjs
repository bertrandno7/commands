/**
 * Registry-driven marketplace smoke test.
 *
 * No command IDs or demo paths are hard-coded here. The test reads the same
 * generated registry that the browser UI consumes, then verifies every listed
 * command and every registered live preview.
 */
import assert from "node:assert/strict";
import {mkdirSync,existsSync} from "node:fs";
import {chromium} from "playwright-core";

const browserPath=[
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium"
].filter(Boolean).find(existsSync);
assert.ok(browserPath,"Installed Chrome/Chromium required for smoke test");

mkdirSync("artifacts",{recursive:true});
const browser=await chromium.launch({
  headless:true,
  executablePath:browserPath,
  args:[
    "--no-sandbox",
    "--enable-webgl",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader"
  ]
});
const ORIGIN="http://127.0.0.1:8765";

async function registry(page){
  return page.evaluate(async()=>{
    const response=await fetch("./generated/commands.json",{cache:"no-store"});
    if(!response.ok)throw new Error("registry "+response.status);
    return response.json();
  });
}

async function waitForMarketplace(page,count){
  await page.waitForFunction(
    expected=>document.querySelectorAll(".command-card").length===expected,
    count,{timeout:20000}
  );
}

async function waitForPreview(page,preview){
  await page.waitForFunction(
    ready=>{
      const marker=document.querySelector(ready.selector);
      const metric=document.querySelector(ready.metric);
      if(!marker||!metric)return false;
      const markerText=(marker.textContent||"").trim();
      const metricText=((metric.value??metric.textContent)||"").trim();
      let done=true;
      if(ready.includes!=null)done=markerText.includes(String(ready.includes));
      if(ready.attribute){
        const value=marker.getAttribute(ready.attribute);
        done=done&&(ready.equals==null?value!=null:value===String(ready.equals));
      }
      return done&&/[0-9]/.test(metricText)&&!metricText.includes("—");
    },
    preview.ready,{timeout:120000}
  );
}

async function verifyHomepage(page,mode,reg){
  const listed=reg.commands.filter(c=>c.listed!==false&&c.kind==="command");
  await waitForMarketplace(page,listed.length);

  assert.equal(await page.locator("#detailDrawer").count(),0);
  assert.equal(await page.locator("#categoryStrip").count(),0);
  assert.equal(await page.locator(".try-demo").count(),0);

  const categories=[...new Set(listed.map(c=>c.category))].sort();
  assert.equal(
    await page.locator("#categorySidebar .sideitem").count(),
    categories.length,
    "Sidebar categories must come entirely from the registry"
  );

  for(const command of listed){
    const card=page.locator('.command-card[data-id="'+command.id+'"]');
    assert.equal(await card.count(),1,command.id+" must render exactly once");
    assert.ok((await card.locator("h3").textContent()).includes(command.name));
    if(command.preview?.type==="web"){
      assert.equal(await card.getAttribute("data-demo"),"./"+command.preview.entry);
      const background=await card.locator(".card-visual").evaluate(
        el=>getComputedStyle(el).backgroundImage
      );
      assert.ok(background.includes(command.id+".png"),
        command.id+" must use its captured preview image");
    }else{
      assert.equal(await card.getAttribute("data-demo"),null,
        command.id+" without browser preview must not fake a live link");
    }
  }

  // Sidebar remains the only category filter.
  const sampleCategory=categories.find(cat=>
    listed.filter(c=>c.category===cat).length>1
  )||categories[0];
  const expected=listed.filter(c=>c.category===sampleCategory).length;
  await page.locator('#categorySidebar .sideitem[data-cat="'+sampleCategory+'"]').click();
  await waitForMarketplace(page,expected);
  await page.locator("#discoverAll").click();
  await waitForMarketplace(page,listed.length);

  // Install remains independent from preview navigation.
  const first=listed[0];
  await page.locator(
    '.command-card[data-id="'+first.id+'"] [data-install="'+first.id+'"]'
  ).click();
  assert.equal(await page.locator("#installDialog").evaluate(el=>el.open),true);
  await page.locator("#closeInstall").click();

  await page.screenshot({
    path:"artifacts/market-"+mode+"-registry.png",fullPage:true
  });
}

async function openEveryPreview(page,mode,reg){
  const live=reg.commands.filter(c=>
    c.listed!==false&&c.kind==="command"&&c.preview?.type==="web"
  );
  for(const command of live){
    console.log("Opening live preview "+command.id+" "+command.name);
    const card=page.locator('.command-card[data-id="'+command.id+'"]');
    await card.click();
    await page.waitForURL("**/"+command.preview.entry,{timeout:20000});
    try{
      await waitForPreview(page,command.preview);
    }catch(error){
      throw new Error(command.id+" "+command.name+" preview did not become ready: "+error.message);
    }

    await page.screenshot({
      path:"artifacts/market-"+mode+"-"+command.id.toLowerCase()+".png",
      fullPage:false
    });

    await page.goBack({waitUntil:"domcontentloaded"});
    await waitForMarketplace(
      page,
      reg.commands.filter(c=>c.listed!==false&&c.kind==="command").length
    );
  }
}

async function run(mode,options){
  const page=await browser.newPage(options);
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));

  await page.goto(ORIGIN+"/",{waitUntil:"domcontentloaded",timeout:30000});
  const reg=await registry(page);
  await verifyHomepage(page,mode,reg);
  await openEveryPreview(page,mode,reg);

  assert.deepEqual(errors,[],"No uncaught marketplace/preview JavaScript errors");
  console.log(
    "Marketplace "+mode+" passed: "+reg.listedCount+
    " commands, "+reg.livePreviewCount+" live previews"
  );
  await page.close();
}

try{
  await run("desktop",{viewport:{width:1440,height:960},deviceScaleFactor:1});
  await run("mobile",{
    viewport:{width:390,height:844},
    deviceScaleFactor:2,isMobile:true,hasTouch:true
  });
}finally{
  await browser.close();
}
