// Screenshots one scene headlessly on the Metal GPU and prints console errors.
//   node shot.mjs <outPrefix> --repo DIR --port P [--scene id] [--bpm N] [--frames N] [--every MS] [--settings JSON] [--quality Q] [--width W] [--height H]
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const repo = opt("--repo", process.cwd());
const { chromium } = await import(pathToFileURL(`${repo}/node_modules/playwright/index.mjs`).href);
const port = opt("--port", "5390");
const scene = opt("--scene", "oildrops");
const bpm = opt("--bpm", "120");
const frames = Number(opt("--frames", "1"));
const every = Number(opt("--every", "1000"));
const settings = opt("--settings", null);
const quality = opt("--quality", "high");
const width = Number(opt("--width", "1280"));
const height = Number(opt("--height", "720"));
const settle = Number(opt("--settle", "4000"));

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
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height }, permissions: ["microphone"] });
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[${m.type()}]`, m.text().slice(0, 600));
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=${bpm}&quality=${quality}#/v/${scene}`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1500);
if (settings) {
  await page.evaluate((s) => window.__viz.setParams({ scene: s.scene, autoPin: true, settings: JSON.parse(s.json) }), { scene, json: settings });
}
await page.waitForTimeout(settle);
for (let i = 0; i < frames; i++) {
  await page.screenshot({ path: `${out}-${String(i).padStart(2, "0")}.png` });
  if (i < frames - 1) await page.waitForTimeout(every);
}
const probe = await page.evaluate(() => (window.__viz?.probeText ? window.__viz.probeText() : "no probe"));
console.log(probe.split("\n").slice(0, 6).join("\n"));
await browser.close();
