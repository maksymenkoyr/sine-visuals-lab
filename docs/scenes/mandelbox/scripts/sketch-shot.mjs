// Shoot the Mandelbox sketch headlessly on the Metal GPU: one frame per (seed, settings, skip).
// usage: node sketch-shot.mjs <page.html> <outdir> '<json list of {name, seed, set, skip}>'
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const [page_, out, listJson] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const wrapped = resolve(out, "_wrapped.html");
writeFileSync(wrapped, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}</style></head><body>${readFileSync(page_, "utf8")}</body></html>`);
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
await page.goto("file://" + wrapped + (process.env.QS || ""));
await page.waitForFunction(() => window.__sketch, null, { timeout: 15000 });
await page.evaluate(() => { document.getElementById("hide").click(); });
for (const s of JSON.parse(listJson)) {
  await page.evaluate((s) => {
    window.__sketch.set(Object.assign({ shape: -1.8, flight: 0.075, mirror: "off" }, s.set || {}));
    window.__sketch.seed(s.seed);
    if (s.skip) window.__sketch.skip(s.skip);
  }, s);
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => window.__sketch.info());
  await page.screenshot({ path: join(out, `${s.name}.png`) });
  console.log(s.name, JSON.stringify(info));
}
console.log(logs.filter((l) => !l.includes("fonts")).slice(0, 10).join("\n"));
await browser.close();
