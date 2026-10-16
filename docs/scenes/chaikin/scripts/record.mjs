// Records Chaikin Curves as a square webm from the moment it opens
// (Playwright's recorder, about 25 fps), for measuring with the /ref
// bundle's own scripts — docs/scenes/chaikin/hebt-ab/scripts/cells.py reads
// it exactly as it read the reference video:
//
//   node docs/scenes/chaikin/scripts/record.mjs <outDir> [--port 5173]
//     [--seconds 50] [--size 720] [--bpm 124] [--settings '{"births":0}']
//   uv run docs/scenes/chaikin/hebt-ab/scripts/cells.py <outDir>/page@….webm 3 ours-cells.json
//
// Births 0 compares like with like: the reference is silent, and kick
// children double the cell density in their band.
import { chromium } from "playwright";

const args = process.argv.slice(2);
const out = args[0];
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const port = opt("port", "5173");
const seconds = Number(opt("seconds", "50"));
const size = Number(opt("size", "720"));
const bpm = opt("bpm", "124");
const settings = opt("settings", null);

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: size, height: size },
  recordVideo: { dir: out, size: { width: size, height: size } },
});
const page = await ctx.newPage();
await page.addInitScript(() => {
  const s = document.createElement("style");
  s.textContent = "body > :not(canvas) { visibility: hidden !important; }";
  document.addEventListener("DOMContentLoaded", () => document.head.appendChild(s));
});
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=${bpm}#/v/chaikin`);
await page.waitForFunction(() => window.__viz && window.__viz.probe, null, { timeout: 30000 });
if (settings) await page.evaluate((s) => window.__viz.setParams({ scene: "chaikin", autoPin: true, settings: JSON.parse(s) }), settings);
await page.waitForTimeout(seconds * 1000);
await ctx.close();
await browser.close();
