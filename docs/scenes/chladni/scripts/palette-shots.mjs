// Chladni on every library palette: a song through the fake mic, one 1280×720
// shot per palette after it has played a while, for palette-score.py.
// usage: node docs/scenes/chladni/scripts/palette-shots.mjs <outDir> --wav PATH
//          [--port P] [--settings JSON] [--palettes a,b]
//   --wav  a 48 kHz mono WAV (tools/.cache/tempo-tracks/<slug>/audio.wav)
// Loads the app on the Metal GPU with the dev server on https://localhost:<port>.
// Run from a checkout so `playwright` resolves.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5173");
const wav = opt("--wav");
const settings = JSON.parse(opt("--settings", "{}"));
const pals = opt(
  "--palettes",
  "neon,sunset,acid,ice,fire,cobalt,toxic,anaglyph,vapor,royal,reef,sodium,abyss,ember,arcade,halation,malachite,amethyst,phosphor,amber",
).split(",");
if (!out || !wav) {
  console.error("usage: node palette-shots.mjs <outDir> --wav PATH [--port P] [--settings JSON] [--palettes a,b]");
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`,
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 }, permissions: ["microphone"] });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 400)));
page.on("console", (m) => {
  if (m.type() === "error" && /shader|compile|GLSL/i.test(m.text())) errors.push(m.text().slice(0, 600));
});
await page.goto(`https://localhost:${port}/#/v/chladni`);
await page.waitForFunction(() => typeof window.__viz?.setParams === "function", null, { timeout: 30000 });
await page.mouse.click(640, 360);
await page.evaluate((s) => window.__viz.setParams({ scene: "chladni", autoPin: true, settings: s }), settings);
await page.waitForTimeout(8000);
for (const id of pals) {
  await page.evaluate((p) => window.__viz.setPalette(p), id);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${id}.png` });
  console.log("shot", id);
}
console.log(errors.join("\n") || "(no errors)");
await browser.close();
