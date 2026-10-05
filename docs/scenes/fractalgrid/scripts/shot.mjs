// Headless shots of the fractalgrid scene on the real GPU (Metal flags), with
// the synthetic feed. Run from the repo root with `npm run dev` up:
//
//   node docs/scenes/fractalgrid/scripts/shot.mjs <outPrefix> [--port P] [--size WxH]
//        [--settings JSON] [--state JSON[;JSON...]] [--frames N --every MS]
//        [--wait MS] [--bpm N] [--quality Q]
//
// --settings pins scene settings through __viz.setParams. --state takes one
// or more dive-state overrides (phase, targetIndex, grid, gridTarget, fold,
// foldTarget, invert, invertHold — motion.ts's DiveState), separated by ';',
// one shot each. It needs a DEV-only hook the scene doesn't ship; to use it,
// paste this under `let lastTime` in src/render/scenes/fractalgrid/index.ts
// (and take it out again before committing):
//
//   if (import.meta.env.DEV) {
//     (globalThis as unknown as Record<string, unknown>).__fgDebug = {
//       get: () => ({ ...state }),
//       set: (p: Partial<typeof state>) => { state = { ...state, ...p }; },
//     };
//   }
//
// Freeze the camera with --settings '{"dive":0}' so a pinned phase stays put.
// Pin grid/gridTarget/fold/foldTarget too when diffing two builds (diff.py):
// hits move them between page load and the settings landing.
import { chromium } from "playwright";

const args = process.argv.slice(2);
const prefix = args[0];
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5481");
const [w, h] = opt("--size", "960x540").split("x").map(Number);
const settings = JSON.parse(opt("--settings", "{}"));
const states = opt("--state", null);
const frames = +opt("--frames", "1");
const every = +opt("--every", "500");
const wait = +opt("--wait", "2500");
const bpm = opt("--bpm", "120");
const quality = opt("--quality", "high");

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: h } });
const page = await ctx.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || /ERROR|shader|compile|fractalgrid/i.test(t)) console.log("[console]", m.type(), t.slice(0, 600));
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=${bpm}&quality=${quality}#/v/fractalgrid`, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.evaluate((s) => window.__viz?.setParams({ scene: "fractalgrid", autoPin: true, settings: s }), settings);
await page.waitForTimeout(wait);
const probe = await page.evaluate(() => {
  const p = window.__viz?.probe?.();
  return p ? { scene: p.scene, bpm: p.bpm, fps: p.fps } : null;
});
console.log("probe", JSON.stringify(probe));
if (states) {
  const list = states.split(";");
  for (let i = 0; i < list.length; i++) {
    await page.evaluate((st) => window.__fgDebug?.set(JSON.parse(st)), list[i]);
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => window.__fgDebug?.get());
    await page.screenshot({ path: `${prefix}-s${i}.png` });
    console.log(`${prefix}-s${i}.png`, JSON.stringify(st));
  }
} else {
  for (let i = 0; i < frames; i++) {
    await page.screenshot({ path: `${prefix}-${String(i).padStart(2, "0")}.png` });
    const st = await page.evaluate(() => window.__fgDebug?.get());
    console.log(`${prefix}-${String(i).padStart(2, "0")}.png`, JSON.stringify(st));
    if (i < frames - 1) await page.waitForTimeout(every);
  }
}
await browser.close();
