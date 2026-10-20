/**
 * COMMANDS marketplace smoke tests.
 *
 * The marketplace is deliberately shallow:
 * sidebar filter -> command card -> full runnable workspace.
 * There is no slide-in detail drawer and no separate "live demo" CTA.
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

const live=[
  {id:"A001",path:"demo/sunhours.html",completion:"complete",output:"#mean"},
  {id:"W001",path:"demo/wind.html",completion:"ready",output:"#peak"},
  {id:"M004",path:"demo/pixel.html",completion:"complete",output:"#count"}
];

async function waitForMarketplace(page){
  await page.waitForFunction(
    ()=>document.querySelectorAll(".command-card").length===15,
    null,{timeout:15000}
  );
}

async function verifyHomepage(page,mode){
  await waitForMarketplace(page);

  assert.equal(await page.locator("#detailDrawer").count(),0,
    "No intermediate command drawer");
  assert.equal(await page.locator("#categoryStrip").count(),0,
    "No duplicate category strip above commands");
  assert.equal(await page.locator(".try-demo").count(),0,
    "No redundant live-demo buttons");
  assert.equal(await page.locator("#categorySidebar .sideitem").count(),7,
    "Categories live in the sidebar");

  // Sidebar is the single category-navigation system.
  await page.locator('#categorySidebar .sideitem[data-cat="Analysis"]').click();
  await page.waitForFunction(
    ()=>document.querySelectorAll(".command-card").length===5
  );
  assert.ok((await page.locator("#resultMeta").textContent()).startsWith("5 command"));

  await page.locator("#discoverAll").click();
  await waitForMarketplace(page);

  // Install remains independent from opening the runnable command.
  const before=page.url();
  await page.locator('.command-card[data-id="A001"] [data-install="A001"]').click();
  assert.equal(await page.locator("#installDialog").evaluate(el=>el.open),true);
  assert.equal(page.url(),before,"Install button must not navigate into demo");
  await page.locator("#closeInstall").click();

  await page.screenshot({
    path:"artifacts/market-"+mode+"-minimal.png",
    fullPage:true
  });
}

async function openDirect(page,demo,mode){
  const card=page.locator('.command-card[data-id="'+demo.id+'"]');
  assert.equal(await card.count(),1,demo.id+" command card");
  assert.equal(await card.getAttribute("data-demo"),"./"+demo.path);
  assert.ok(await card.evaluate(el=>el.classList.contains("has-demo")));

  await card.click();
  await page.waitForURL("**/"+demo.path,{timeout:20000});
  assert.ok(page.url().endsWith("/"+demo.path),
    demo.id+" card should navigate directly to full demo");

  await page.waitForFunction(
    ({completion,output})=>{
      const progress=document.querySelector("#progressLabel")?.textContent||"";
      const metric=document.querySelector(output)?.textContent||"";
      return progress.includes(completion)&&/[0-9]/.test(metric);
    },
    {completion:demo.completion,output:demo.output},
    {timeout:120000}
  );

  assert.ok(await page.locator("#view").evaluate(c=>Boolean(c.getContext("webgl"))),
    demo.id+" full workspace uses real WebGL");

  await page.screenshot({
    path:"artifacts/market-"+mode+"-"+demo.id.toLowerCase()+"-full-demo.png",
    fullPage:false
  });

  await page.goBack({waitUntil:"domcontentloaded"});
  await waitForMarketplace(page);
}

async function run(mode,options){
  const page=await browser.newPage(options);
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));

  await page.goto(ORIGIN+"/",{waitUntil:"domcontentloaded",timeout:30000});
  await verifyHomepage(page,mode);

  for(const demo of live)await openDirect(page,demo,mode);

  assert.deepEqual(errors,[],"No uncaught marketplace/demo JavaScript errors");
  await page.close();
}

try{
  await run("desktop",{viewport:{width:1440,height:960},deviceScaleFactor:1});
  await run("mobile",{
    viewport:{width:390,height:844},
    deviceScaleFactor:2,
    isMobile:true,
    hasTouch:true
  });
}finally{
  await browser.close();
}
