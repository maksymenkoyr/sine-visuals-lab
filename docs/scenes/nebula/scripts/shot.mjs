// shot.mjs <outPrefix> --port P [--frames N] [--every MS] [--wait MS] [--settings JSON] [--bpm N] [--quality Q]
import { chromium } from "../../../../node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5242");
const frames = Number(opt("--frames", "3"));
const every = Number(opt("--every", "2000"));
const wait = Number(opt("--wait", "4000"));
const settings = opt("--settings", null);
const bpm = opt("--bpm", "124");
const quality = opt("--quality", null);
const scene = opt("--scene", "nebula");

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
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[${m.type()}] ${m.text().slice(0, 400)}`);
});
const q = `?audio=synthetic&bpm=${bpm}${quality ? `&quality=${quality}` : ""}`;
await page.goto(`https://localhost:${port}/${q}#/v/${scene}`);
await page.waitForTimeout(1500);
if (settings) {
  await page.evaluate(([s, sc]) => window.__viz.setParams({ scene: sc, autoPin: true, settings: JSON.parse(s) }), [settings, scene]);
}
await page.waitForTimeout(wait);
for (let i = 0; i < frames; i++) {
  await page.screenshot({ path: `${out}-${String(i).padStart(2, "0")}.png` });
  if (i < frames - 1) await page.waitForTimeout(every);
}
const probe = await page.evaluate(() => {
  const p = window.__viz?.probe?.();
  return p ? { scene: p.scene, fps: p.fps, bpm: p.bpm } : null;
});
console.log("probe", JSON.stringify(probe));
console.log("hash", await page.evaluate(() => location.hash));
await browser.close();
