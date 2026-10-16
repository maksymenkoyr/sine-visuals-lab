// Chladni sand colour — same-moment A/B shots: for each variant, a shot of the
// plate with the base settings, then the variant switched on and shot 120 ms
// later (and again 0.9 s on), so both shots see the same sand. Embers and Beat
// waves keep their memory running whatever their sliders say, so they A/B the
// same way.
// usage: node docs/scenes/chladni/scripts/colour-ab-shots.mjs <outDir> [--port P]
//          [--wav PATH] [--warm S] [--hold S] [--base JSON] [--only name,name]
//   --wav   a song through the fake mic (tools/.cache/tempo-tracks/<slug>/audio.wav);
//           without it, the synthetic feed
//   --warm  seconds before the first variant; --hold  seconds on the base before each
//
// Loads the app on the Metal GPU with the dev server on https://localhost:<port>
// and pushes settings through window.__viz.setParams. Run from a checkout so
// `playwright` resolves.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5173");
const base = JSON.parse(opt("--base", "{}"));
const hold = Number(opt("--hold", "3"));
const warm = Number(opt("--warm", "8"));
const only = opt("--only", "");
const wav = opt("--wav", "");
if (!out) {
  console.error("usage: node colour-ab-shots.mjs <outDir> [--port P] [--wav PATH] [--warm S] [--hold S] [--base JSON] [--only a,b]");
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const VARIANTS = {
  thrownSecond: { thrownColour: 1.5, thrownTo: 1 },
  thrownPalette: { thrownColour: 1.5, thrownTo: 2 },
  thrownShadow: { thrownColour: 1.5, thrownTo: 3 },
  twoSides: { twoSides: 1 },
  embers: { embers: 1, emberFade: 2 },
  spectrum: { spectrumRings: 1 },
  waves: { beatWaves: 1 },
  glitter: { glitter: 1 },
};

const launchArgs = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  "--enable-gpu",
  "--use-angle=metal",
  "--enable-gpu-rasterization",
  "--ignore-gpu-blocklist",
];
if (wav) launchArgs.push(`--use-file-for-fake-audio-capture=${wav}`);
const browser = await chromium.launch({ channel: "chromium", args: launchArgs });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 }, permissions: ["microphone"] });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 400)));
await page.goto(`https://localhost:${port}/${wav ? "" : "?audio=synthetic&bpm=120"}#/v/chladni`);
await page.waitForFunction(() => typeof window.__viz?.setParams === "function", null, { timeout: 30000 });
await page.waitForTimeout(warm * 1000);
const set = (s) => page.evaluate((x) => window.__viz.setParams({ scene: "chladni", autoPin: true, settings: x }), s);
for (const [name, v] of Object.entries(VARIANTS)) {
  if (only && !only.split(",").includes(name)) continue;
  await set(base);
  await page.waitForTimeout(hold * 1000);
  await page.screenshot({ path: `${out}/${name}-0off.png` });
  await set({ ...base, ...v });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${out}/${name}-1on.png` });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${name}-2on.png` });
  console.log("shot:", name);
}
await set(base);
console.log(errors.join("\n") || "(no errors)");
await browser.close();
