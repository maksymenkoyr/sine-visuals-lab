// Nebula on the real GPU with a wav as the microphone (a /ref bundle's silent audio.wav for the
// look at rest, or a song), the app's chrome hidden. Screenshots, or with --video S a real-time
// recording for lagcorr.py, since screenshots stall the frame clock.
//
//   node docs/scenes/nebula/scripts/rest.mjs <outPrefix> --port P --wav <file.wav>
//        [--settings JSON] [--frames N] [--every MS] [--wait MS] [--size WxH] [--video S]
import { launchWithMic, openScene } from "../../../../tools/ref-browser.mjs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5173");
const wav = opt("--wav", null);
const frames = Number(opt("--frames", "3"));
const every = Number(opt("--every", "2000"));
const wait = Number(opt("--wait", "2500"));
const settings = opt("--settings", null);
const [W, H] = opt("--size", "1280x720").split("x").map(Number);
const video = Number(opt("--video", "0"));
const scene = "nebula";
if (!out || !wav) throw new Error("usage: rest.mjs <outPrefix> --port P --wav <file.wav> [...]");

const { browser, ctx } = await launchWithMic(wav, { width: W, height: H });
let pageCtx = ctx;
if (video > 0) {
  // recordVideo is fixed when a context is made, so video gets a context of its own.
  await ctx.close();
  pageCtx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: W, height: H },
    permissions: ["microphone"],
    recordVideo: { dir: `${out}-video`, size: { width: W, height: H } },
  });
  await pageCtx.addInitScript(() => {
    const md = navigator.mediaDevices;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => {
      const s = await orig(c);
      if (c && c.audio && !window.__micT0) window.__micT0 = performance.now();
      return s;
    };
  });
}
const page = await openScene(pageCtx, { port, scene });
if (settings) {
  await page.evaluate(([s, sc]) => window.__viz.setParams({ scene: sc, autoPin: true, settings: JSON.parse(s) }), [settings, scene]);
}
if (video > 0) {
  await page.waitForTimeout(wait + video * 1000);
  await pageCtx.close();
  console.log("video in", `${out}-video`);
} else {
  await page.waitForTimeout(wait);
  for (let i = 0; i < frames; i++) {
    await page.screenshot({ path: `${out}-${String(i).padStart(2, "0")}.png` });
    if (i < frames - 1) await page.waitForTimeout(every);
  }
}
await browser.close();
