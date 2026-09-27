// Burst-screenshots Caustics at a fast synthetic tempo with Beat ripple maxed
// and every other motion zeroed, for the #154 ring-pool before/after. Stills
// turned out not to show ring reach clearly; the pool test in
// tests/caustics.test.ts and the ripple-pool artifact are the real checks.
// Written 2026-09-26. Needs a dev server (Metal GPU Chromium flags).
// usage: node ripple-shot.mjs <outPrefix> --port P --bpm N --frames N --every MS --wait MS
import { chromium } from "/Users/yaro/projects/audio-visualization/node_modules/playwright/index.mjs";
const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const port = opt("port", "5231"), bpm = opt("bpm", "300");
const frames = +opt("frames", "6"), every = +opt("every", "400"), wait = +opt("wait", "8000");
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 200)); });
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=${bpm}#/v/caustics`);
await page.waitForFunction(() => !!window.__viz, null, { timeout: 20000 });
await page.evaluate(() => window.__viz.setParams({ scene: "caustics", autoPin: true, settings: { ripple: 1, drift: 0, driftBeat: 0, driftChurn: 0, driftKick: 0, breathe: 0, bass: 0, turbulence: 0, dropReactivity: 0, flash: 0, sparkleBright: 0 } }));
await page.waitForTimeout(wait);
for (let i = 0; i < frames; i++) {
  await page.screenshot({ path: `${out}-${String(i).padStart(2, "0")}.png` });
  await page.waitForTimeout(every);
}
await browser.close();
