// Outline radius over time: Echoes with Flow 0 and Echoes 2 (only the outline
// shows), sampled in-page every rAF for a few seconds by reading the canvas
// centre row — no screenshots, so the timing is real.
//   node radius_burst.mjs <port> <seconds> [extraSettingsJson]
import { chromium } from "../../../../node_modules/playwright/index.mjs";

const [port, secArg, extra] = process.argv.slice(2);
const seconds = +(secArg ?? 4);
const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 540, height: 540 } });
const page = await ctx.newPage();
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=112#/v/echoes`);
await page.waitForTimeout(2500);
const settings = { flow: 0, echoes: 2, spin: 0, ...(extra ? JSON.parse(extra) : {}) };
await page.evaluate((s) => window.__viz.setParams({ scene: "echoes", autoPin: true, settings: s }), settings);
await page.waitForTimeout(3000);
const samples = await page.evaluate(async (ms) => {
  const canvas = document.querySelector("canvas");
  const off = document.createElement("canvas");
  const out = [];
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    await new Promise((r) => requestAnimationFrame(r));
    off.width = canvas.width;
    off.height = 1;
    const c2 = off.getContext("2d");
    c2.drawImage(canvas, 0, canvas.height / 2, canvas.width, 1, 0, 0, canvas.width, 1);
    const row = c2.getImageData(0, 0, canvas.width, 1).data;
    let first = -1, last = -1;
    for (let x = 0; x < canvas.width; x++) {
      if (row[x * 4] > 120) { if (first < 0) first = x; last = x; }
    }
    const p = window.__viz.probe();
    out.push({ t: performance.now() - t0, r: first < 0 ? 0 : (last - first) / 2 / (canvas.height / 2), fired: p.beat?.fired ?? null });
  }
  return out;
}, seconds * 1000);
const rs = samples.map((s) => s.r);
console.log(`frames ${samples.length}, radius min ${Math.min(...rs).toFixed(3)} max ${Math.max(...rs).toFixed(3)} (half-heights)`);
let line = "";
for (let i = 0; i < samples.length; i += 3) line += `${(samples[i].t / 1000).toFixed(2)}:${samples[i].r.toFixed(3)}${samples[i].fired ? "*" : ""} `;
console.log(line);
await browser.close();
