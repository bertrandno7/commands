/**
 * COMMANDS marketplace integration smoke test.
 * Each audited command page must mount its real runnable simulation, complete
 * the calculation, and resize the iframe to its intrinsic content height.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const browserPath = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
].filter(Boolean).find(existsSync);

assert.ok(browserPath, "Installed Chrome/Chromium is required for smoke tests");
mkdirSync("artifacts", { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: browserPath,
  args: [
    "--no-sandbox",
    "--enable-webgl",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
  ],
});

const ORIGIN = (process.env.COMMANDS_PREVIEW_ORIGIN || "http://127.0.0.1:8765").replace(/\/$/, "");
const commands = [
  { id: "A001", slug: "sun-hours", path: "/demo/sunhours.html", completion: "complete", metric: "#mean" },
  { id: "W001", slug: "wind-screen", path: "/demo/wind.html", completion: "ready", metric: "#peak" },
  { id: "M004", slug: "pixelate", path: "/demo/pixel.html", completion: "complete", metric: "#count" },
  ...[
    ["A002", "solar-radiation", "a002-solar-radiation"],
    ["E001", "scoreboard", "e001-scoreboard"],
    ["F001", "facade-panels", "f001-facade-panels"],
    ["F002", "sun-facade", "f002-sun-facade"],
    ["G001", "voxel-growth", "g001-voxel-growth"],
    ["G005", "brief-growth", "g005-brief-growth"],
    ["M003", "density", "m003-density"],
    ["M005", "sun-carve", "m005-sun-carve"],
    ["M006", "embodied-carbon", "m006-embodied-carbon"],
    ["S001", "spiral-stair", "s001-spiral-stair"],
    ["W002", "wind-comfort", "w002-wind-comfort"],
    ["X000", "site-model", "x000-site-model"],
  ].map(([id, slug, folder]) => ({
    id, slug,
    path: `/commands/${folder}/preview/index.html`,
    metric: "[data-preview-metric]",
    generic: true,
  })),
];

async function checkCommand(page, command, mode) {
  await page.goto(`${ORIGIN}/commands/${command.slug}#live-demo`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  const frame = page.locator("#live-command-frame");
  await frame.waitFor({ state: "visible" });
  assert.ok(
    (await frame.getAttribute("src"))?.includes(`${command.path}?embed=1`),
    `${command.id} command page must embed its audited demo`,
  );

  const inner = page.frameLocator("#live-command-frame");
  await inner.locator(command.metric).waitFor({ state: "visible", timeout: 120_000 });
  await page.waitForFunction(
    ({ completion, metric, generic }) => {
      const iframe = document.querySelector("#live-command-frame");
      const documentInside = iframe?.contentDocument;
      if (generic) {
        const ready = documentInside?.body?.getAttribute("data-preview-ready");
        const value = documentInside?.querySelector(metric)?.textContent || "";
        return ready === "true" && /[0-9]/.test(value) && !value.includes("—");
      }
      const progress = documentInside?.querySelector("#progressLabel")?.textContent || "";
      const value = documentInside?.querySelector(metric)?.textContent || "";
      return progress.includes(completion) && /[0-9]/.test(value) && !value.includes("—");
    },
    { completion: command.completion, metric: command.metric, generic: command.generic },
    { timeout: 120_000 },
  );

  if (command.generic) {
    const canvas = inner.locator("#previewCanvas");
    assert.equal(await canvas.count(), 1, `${command.id} must render its preview canvas`);
    assert.ok(await canvas.evaluate((element) => Boolean(element.getContext("2d"))), `${command.id} must have a 2D preview context`);
  } else {
    const webgl = await inner.locator("#view").evaluate((canvas) => Boolean(canvas.getContext("webgl")));
    assert.ok(webgl, `${command.id} must render real WebGL geometry`);
  }

  if (!command.generic) {
    await page.waitForFunction(() => {
      const iframe = document.querySelector("#live-command-frame");
      const content = iframe?.contentDocument?.querySelector(".page");
      if (!iframe || !content) return false;
      const actual = iframe.getBoundingClientRect().height;
      const natural = content.getBoundingClientRect().height;
      return natural > 300 && actual >= Math.min(natural - 4, 2396);
    }, null, { timeout: 20_000 });
  }

  await page.locator(".live-demo-frame-shell").screenshot({
    path: `artifacts/market-${mode}-${command.slug}.png`,
    timeout: 25_000,
  });
  const value = await inner.locator(command.metric).textContent();
  console.log(`✔ ${command.id} ${mode} embedded computation: ${value}`);
}

async function run(mode, options, list = commands) {
  const page = await browser.newPage(options);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const command of list) await checkCommand(page, command, mode);
  assert.deepEqual(errors, [], `${mode} command pages should have no uncaught errors`);
  await page.close();
}

try {
  await run("desktop", { viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  await run("mobile", {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  }, commands.slice(0, 3));
} finally {
  await browser.close();
}
