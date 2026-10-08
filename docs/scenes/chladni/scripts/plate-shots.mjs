// Chladni plates — real-GPU shots of named plate settings on a real song
// through the fake mic (or the synthetic feed).
// usage: node docs/scenes/chladni/scripts/plate-shots.mjs <port> <outDir> <w> <h> <wav|synthetic> '<variants JSON>'
//          [--settle MS] [--early MS] [--burst N] [--every MS]
//   variants: {"name": {settings…}, …}, e.g. {"round":{"plateShape":1},"tri-z2":{"plateShape":3,"plateZoom":2}}
//   --early MS   also shoots <name>-early.png that long after the switch (does the sand form in time?)
//   --burst N    shoots N frames --every MS apart after the settle, cropped to the
//                fitted plate at 1280x720 (<name>-NN.png), for plate-lines.py
//
// Loads the app on the Metal GPU with the dev server on https://localhost:<port>,
// waits for the song to reach the plate, then pushes each variant through
// window.__viz.setParams. Run from a checkout so `playwright` resolves. Never
// judge Chladni's figures on the synthetic feed (docs/scenes/chladni.md): it
// has no spectrum to follow. The song WAVs are tools/.cache/tempo-tracks/<slug>/audio.wav.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const [port, outDir, w, h, wav, variantsJson] = args;
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const settle = Number(flag("--settle", "5000"));
const early = Number(flag("--early", "0"));
const burst = Number(flag("--burst", "0"));
const every = Number(flag("--every", "500"));
if (!variantsJson) {
  console.error("usage: node plate-shots.mjs <port> <outDir> <w> <h> <wav|synthetic> '<variants JSON>' [--settle MS] [--early MS] [--burst N] [--every MS]");
  process.exit(1);
}
const variants = JSON.parse(variantsJson);
mkdirSync(outDir, { recursive: true });

const synthetic = wav === "synthetic";
const launchArgs = [
  "--enable-gpu",
  "--use-angle=metal",
  "--enable-gpu-rasterization",
  "--ignore-gpu-blocklist",
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
];
if (!synthetic) launchArgs.push(`--use-file-for-fake-audio-capture=${wav}`);
const browser = await chromium.launch({ channel: "chromium", args: launchArgs });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: Number(w), height: Number(h) },
  permissions: ["microphone"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`[page] ${String(e && e.stack ? e.stack : e)}`));

await page.goto(`https://localhost:${port}/${synthetic ? "?audio=synthetic&bpm=120" : ""}#/v/chladni`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => typeof window.__viz?.setParams === "function", { timeout: 20000 });
await page.waitForTimeout(6000);

for (const [name, settings] of Object.entries(variants)) {
  await page.evaluate((s) => window.__viz.setParams({ scene: "chladni", autoPin: true, settings: s }), settings);
  if (early > 0) {
    await page.waitForTimeout(early);
    await page.screenshot({ path: `${outDir}/${name}-early.png` });
  }
  await page.waitForTimeout(Math.max(0, settle - early));
  if (burst > 0) {
    for (let f = 0; f < burst; f++) {
      await page.screenshot({ path: `${outDir}/${name}-${String(f).padStart(2, "0")}.png`, clip: { x: 310, y: 30, width: 660, height: 660 } });
      await page.waitForTimeout(every);
    }
  } else {
    await page.screenshot({ path: `${outDir}/${name}.png` });
  }
  console.log("shot:", name);
}
console.log(errors.join("\n") || "(no errors)");
await browser.close();
