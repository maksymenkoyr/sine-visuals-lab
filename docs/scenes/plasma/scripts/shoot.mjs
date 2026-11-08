// Plasma on the real GPU with a wav as the microphone (silence for the look
// at rest, or a song), the app's chrome hidden: screenshots, or a real-time
// clip recorded in-page (canvas.captureStream + MediaRecorder, streamed to
// disk a second at a time) for the temporal measurements.
//
//   node shoot.mjs <outPrefix> --repo DIR --port P --wav <file.wav> [--scene plasma]
//        [--settings JSON] [--size WxH] [--wait MS] [--frames N] [--every MS]
//        [--clip S] [--fps F] [--mbps M]
import { appendFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const repo = opt("--repo", process.cwd());
const port = opt("--port", "5333");
const wav = opt("--wav", null);
const scene = opt("--scene", "plasma");
const settings = opt("--settings", null);
const [W, H] = opt("--size", "1280x720").split("x").map(Number);
const wait = Number(opt("--wait", "3000"));
const frames = Number(opt("--frames", "0"));
const every = Number(opt("--every", "2000"));
const clip = Number(opt("--clip", "0"));
const fps = Number(opt("--fps", "30"));
const mbps = Number(opt("--mbps", "16"));
if (!out || !wav) throw new Error("usage: shoot.mjs <outPrefix> --repo DIR --port P --wav <file.wav> [...]");

const mounts = Number(opt("--mounts", "1"));
const { launchWithMic, openScene } = await import(pathToFileURL(`${repo}/tools/ref-browser.mjs`).href);
const { browser, ctx } = await launchWithMic(wav, { width: W, height: H });
let page;
// --mounts N opens the scene N times (a fresh mount each, so a scene that
// starts at a random phase shows N independent layouts), `frames` shots each.
for (let m = 0; m < mounts; m++) {
  if (page) await page.close();
  page = await openScene(ctx, { port, scene });
  // The dev tuning bus's startup fetch clears overrides; wait it out first.
  await page.waitForTimeout(1500);
  if (settings) {
    await page.evaluate(([s, sc]) => window.__viz.setParams({ scene: sc, autoPin: true, settings: JSON.parse(s) }), [settings, scene]);
  }
  await page.waitForTimeout(wait);
  for (let i = 0; i < frames; i++) {
    const tag = mounts > 1 ? `m${String(m).padStart(2, "0")}-` : "";
    await page.screenshot({ path: `${out}-${tag}${String(i).padStart(2, "0")}.png` });
    if (i < frames - 1) await page.waitForTimeout(every);
  }
}
if (clip > 0) {
  const file = `${out}.webm`;
  writeFileSync(file, Buffer.alloc(0));
  await page.exposeFunction("__saveChunk", (b64) => appendFileSync(file, Buffer.from(b64, "base64")));
  const info = await page.evaluate(
    async ({ secs, fps, bps }) => {
      const c = document.querySelector("body > canvas");
      const stream = c.captureStream(fps);
      const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: bps });
      let pending = Promise.resolve();
      rec.ondataavailable = (e) => {
        if (!e.data.size) return;
        pending = pending.then(async () => {
          const buf = new Uint8Array(await e.data.arrayBuffer());
          let s = "";
          for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          await window.__saveChunk(btoa(s));
        });
      };
      const stopped = new Promise((r) => (rec.onstop = r));
      rec.start(1000);
      await new Promise((r) => setTimeout(r, secs * 1000));
      rec.stop();
      await stopped;
      await pending;
      return { w: c.width, h: c.height };
    },
    { secs: clip, fps, bps: mbps * 1e6 },
  );
  console.log("clip", file, "canvas", info.w, "x", info.h);
}
await browser.close();
