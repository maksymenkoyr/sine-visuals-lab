// A real-time clip of Nebula at Retina size, recorded in the page from the canvas (MediaRecorder,
// VP9 at a high bitrate), with a wav as the microphone. For judging fine detail and the temporal
// resolve in motion: Playwright's recordVideo smears sub-pixel detail, and screenshots stall the
// frame clock, so each one jumps the flight. --synthetic plays the app's synthetic feed instead of
// the wav, whose first drop lands about 13 s in (src/audio/synthetic.ts).
//
//   node docs/scenes/nebula/scripts/clip.mjs <out.webm> --port P --wav <file.wav>
//        [--settings JSON] [--seconds S] [--wait MS] [--size WxH] [--dpr N] [--synthetic]
import { writeFileSync } from "node:fs";
import { launchWithMic } from "../../../../tools/ref-browser.mjs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5173");
const wav = opt("--wav", null);
const seconds = Number(opt("--seconds", "6"));
const wait = Number(opt("--wait", "3000"));
const settings = opt("--settings", null);
const dpr = Number(opt("--dpr", "2"));
const [W, H] = opt("--size", "1512x945").split("x").map(Number);
const synthetic = args.includes("--synthetic");
if (!out || !wav) throw new Error("usage: clip.mjs <out.webm> --port P --wav <file.wav> [...]");

const { browser, ctx } = await launchWithMic(wav, { width: W, height: H });
// The device scale is fixed when a context is made.
await ctx.close();
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: W, height: H }, deviceScaleFactor: dpr, permissions: ["microphone"] });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 500)));
const query = synthetic ? "?audio=synthetic&bpm=128&quality=high" : "?quality=high";
await page.goto(`https://localhost:${port}/${query}#/v/nebula`, { waitUntil: "load" });
await page.waitForTimeout(800);
await page.mouse.click(W / 2, H / 2);
// The dev tuning bus's startup fetch clears overrides sent before it lands.
await page.waitForTimeout(1800);
await page.addStyleTag({ content: "body > :not(canvas) { visibility: hidden !important; }" });
if (settings) {
  await page.evaluate((s) => window.__viz.setParams({ scene: "nebula", autoPin: true, settings: JSON.parse(s) }), settings);
}
await page.waitForTimeout(wait);
const b64 = await page.evaluate(async (secs) => {
  const stream = document.querySelector("canvas").captureStream(60);
  const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 40_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start(500);
  await new Promise((r) => setTimeout(r, secs * 1000));
  rec.stop();
  await done;
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}, seconds);
writeFileSync(out, Buffer.from(b64, "base64"));
console.log(out);
await browser.close();
