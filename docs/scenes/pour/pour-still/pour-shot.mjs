// Smoke-shot for the Pour scene: opens the app on synthetic audio pinned to
// the Pour scene, logs every console message/pageerror (so a shader compile
// failure is visible), optionally applies settings via window.__viz.setParams,
// and saves a screenshot at each requested time.
//
//   node pour-shot.mjs <outPrefix> [--port P] [--bpm N] [--quality Q] [--times 5,20,45] [--settings JSON]
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url).href);
import fs from "node:fs";

const args = process.argv.slice(2);
const outPrefix = args[0];
if (!outPrefix) {
  console.error("usage: node pour-shot.mjs <outPrefix> [--port P] [--bpm N] [--quality Q] [--times 5,20,45] [--settings JSON]");
  process.exit(1);
}

const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};

const port = Number(flag("--port", "5230"));
const bpm = Number(flag("--bpm", "120"));
const quality = flag("--quality", "high");
const times = flag("--times", "5,20,45")
  .split(",")
  .map((s) => Number(s.trim()));
const settingsJson = flag("--settings", null);
const settings = settingsJson ? JSON.parse(settingsJson) : null;

const outDir = outPrefix.substring(0, outPrefix.lastIndexOf("/"));
if (outDir) fs.mkdirSync(outDir, { recursive: true });

const url = `https://localhost:${port}/?audio=synthetic&bpm=${bpm}&quality=${quality}#/v/pour`;
console.log("[nav]", url);

const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1600, height: 900 },
  permissions: ["microphone"],
});
const page = await context.newPage();
page.on("console", (msg) => console.log(`[console:${msg.type()}]`, msg.text()));
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(url, { waitUntil: "load", timeout: 60000 });
try {
  await page.mouse.click(800, 450); // first-gesture audio start, harmless with synthetic audio
} catch {}

await page.waitForTimeout(1500);

const hash = await page.evaluate(() => location.hash);
console.log("[hash]", hash);
if (!hash.endsWith("/v/pour")) {
  console.error(`[error] expected location.hash to end in "/v/pour", got "${hash}"`);
}

if (settings) {
  await page.waitForFunction(() => typeof window.__viz?.setParams === "function", { timeout: 10000 });
  const result = await page.evaluate(
    (s) => window.__viz.setParams({ scene: "pour", autoPin: true, settings: s }),
    settings,
  );
  console.log("[setParams]", JSON.stringify(result ?? null));
}

let elapsed = 0;
const sorted = [...times].sort((a, b) => a - b);
for (const t of sorted) {
  const waitMs = t * 1000 - elapsed;
  if (waitMs > 0) {
    await page.waitForTimeout(waitMs);
    elapsed += waitMs;
  }
  const outPath = `${outPrefix}-${t}s.png`;
  await page.screenshot({ path: outPath });
  console.log("[shot]", outPath);
}

await browser.close();
