// Headless frames of Chaikin Curves at chosen seconds after it opens, on the
// real GPU (Metal flags), with synthetic audio — the way the scene was built
// (2026-10-05). The reference is silent, so tools/ref-shoot.mjs has no audio
// to replay.
//
//   node docs/scenes/chaikin/scripts/shot.mjs <outPrefix> [--port 5173]
//     [--w 720] [--h 720] [--at 1,4,8,14,20,30] [--bpm 124] [--quality high]
//     [--settings '{"births":0}'] [--drives '{"chaikin":{"relaunch":{"patch":{"source":"beat","grid":5}}}}']
//
// --drives seeds the drive store (vibe.drives) before the page loads: the
// example fires Relaunch on a two-bar grid instead of waiting for a real
// drop, which synthetic audio rarely makes. Writes <outPrefix>-<sec>.png and
// prints the probe's scene and fps per shot, then any page errors (an
// all-black frame is a shader compile error — it's in that list).
import { chromium } from "playwright";

const args = process.argv.slice(2);
const out = args[0];
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const port = opt("port", "5173");
const W = Number(opt("w", "720"));
const H = Number(opt("h", "720"));
const at = opt("at", "1,4,8,14,20,30").split(",").map(Number);
const settings = opt("settings", null);
const drives = opt("drives", null);
const bpm = opt("bpm", "124");
const quality = opt("quality", null);

const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: W, height: H } });
if (drives) await ctx.addInitScript((d) => localStorage.setItem("vibe.drives", d), drives);
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => {
  if (m.type() === "error" || /shader|compile|ERROR/i.test(m.text())) errs.push(m.text());
});
page.on("pageerror", (e) => errs.push(String(e)));
const q = `audio=synthetic&bpm=${bpm}${quality ? `&quality=${quality}` : ""}`;
await page.goto(`https://localhost:${port}/?${q}#/v/chaikin`);
await page.waitForFunction(() => window.__viz && window.__viz.probe, null, { timeout: 30000 });
if (settings) {
  await page.evaluate((s) => window.__viz.setParams({ scene: "chaikin", autoPin: true, settings: JSON.parse(s) }), settings);
}
await page.addStyleTag({ content: "body > :not(canvas) { visibility: hidden !important; }" });
const t0 = Date.now();
for (const t of at) {
  const wait = t * 1000 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  const probe = await page.evaluate(() => {
    const p = window.__viz.probe();
    return { scene: p.scene, fps: Math.round(p.fps) };
  });
  const file = `${out}-${String(t).padStart(3, "0")}.png`;
  await page.screenshot({ path: file });
  console.log(file, JSON.stringify(probe));
}
if (errs.length) console.log("page errors:\n" + errs.slice(0, 20).join("\n"));
await browser.close();
