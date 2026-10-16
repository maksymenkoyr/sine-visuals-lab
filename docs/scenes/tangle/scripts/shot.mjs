// Headless frames of a scene at chosen seconds, the way Tangle was tuned
// (2026-10-05). The reference was silent, so tools/ref-shoot.mjs had no audio
// to replay; this takes synthetic audio or any wav as the microphone instead.
//
//   node docs/scenes/tangle/scripts/shot.mjs <outPrefix> [--port 5173]
//     [--scene tangle] [--bpm 124] [--wav FILE] [--at 0.17,0.57,1.37,2.97,11]
//     [--settings '{"inflate":0,"reset":0}'] [--size 720x720] [--quality high]
//
// --at: seconds after the scene opens (synthetic) or after the mic starts
// (--wav, a 48 kHz mono s16 file such as a /ref bundle's audio.wav). The
// defaults are the reference's own sample times; with Re-inflate and Reset
// at 0 the scene collapses undisturbed, which is what the silent reference
// shows. Uses the Metal GPU (headless SwiftShader runs too slow for the warp).
import { chromium } from "playwright";

const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5173");
const scene = opt("--scene", "tangle");
const bpm = opt("--bpm", "124");
const wav = opt("--wav", null);
const at = opt("--at", "0.17,0.57,1.37,2.97,11").split(",").map(Number);
const settings = opt("--settings", null);
const [W, H] = opt("--size", "720x720").split("x").map(Number);
const quality = opt("--quality", "high");

const flags = [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist",
];
if (wav) flags.push(`--use-file-for-fake-audio-capture=${wav}%noloop`);
const browser = await chromium.launch({ channel: "chromium", args: flags });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: W, height: H }, permissions: ["microphone"] });
await ctx.addInitScript(() => {
  const md = navigator.mediaDevices;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    const s = await orig(c);
    if (c && c.audio && !window.__micT0) window.__micT0 = performance.now();
    return s;
  };
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 1500)));
const q = wav ? `?quality=${quality}` : `?audio=synthetic&bpm=${bpm}&quality=${quality}`;
await page.goto(`https://localhost:${port}/${q}#/v/${scene}`, { waitUntil: "load" });
await page.waitForTimeout(600);
if (settings) {
  await page.evaluate(({ scene, s }) => window.__viz?.setParams({ scene, autoPin: true, settings: JSON.parse(s) }), { scene, s: settings });
}
await page.mouse.click(W / 2, H / 2);
if (wav) await page.waitForFunction(() => window.__micT0 > 0, null, { timeout: 8000 });
else await page.evaluate(() => (window.__micT0 = performance.now()));
await page.addStyleTag({ content: "body > :not(canvas) { visibility: hidden !important; }" });
for (const t of at) {
  await page.evaluate(
    (ms) => new Promise((r) => { const tick = () => (performance.now() - window.__micT0 >= ms ? r() : requestAnimationFrame(tick)); tick(); }),
    t * 1000,
  );
  const f = `${out}-${String(t).replace(".", "_")}.png`;
  await page.screenshot({ path: f });
  console.log(f);
}
await browser.close();
