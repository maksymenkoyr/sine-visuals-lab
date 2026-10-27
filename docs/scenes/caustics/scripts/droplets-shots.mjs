// Screenshots of Caustics on the synthetic feed with settings applied (Droplets: {"sparkleFx":3}), on the real GPU. Needs `npm run dev`.
// node docs/scenes/caustics/scripts/droplets-shots.mjs <outPrefix> --port P [--settings JSON] [--frames 4] [--every 250] [--wait 3000] [--dpr 1] [--clip x,y,w,h]
import { chromium } from "playwright";

const args = process.argv.slice(2);
const out = args[0];
const get = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : args[i + 1];
};
const frames = Number(get("frames", "4"));
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
try {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(get("dpr", "1")) });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 2000)));
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !/8787|ERR_CONNECTION_REFUSED|403|Room server/.test(m.text())) console.log(`[${m.type()}]`, m.text().slice(0, 2000));
  });
  await page.goto(`https://localhost:${get("port", "5173")}/?audio=synthetic&bpm=120&quality=high#/v/caustics`);
  await page.waitForFunction(() => window.__viz, null, { timeout: 30_000 });
  // The dev tuning bus clears overrides when its startup fetch of tuning/params.json lands.
  await page.waitForTimeout(1500);
  await page.evaluate((s) => window.__viz.setParams({ scene: "caustics", autoPin: true, settings: s }), JSON.parse(get("settings", '{"sparkleFx":3}')));
  await page.waitForTimeout(Number(get("wait", "3000")));
  const clip = get("clip", null)?.split(",").map(Number);
  for (let i = 0; i < frames; i++) {
    const path = `${out}-${String(i).padStart(2, "0")}.png`;
    await page.screenshot(clip ? { path, clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3] } } : { path });
    console.log(path);
    if (i < frames - 1) await page.waitForTimeout(Number(get("every", "250")));
  }
} finally {
  await browser.close();
}
