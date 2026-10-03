// Random motion search for the Strain Console's preset pills (MOTION_PRESETS
// in physarum2.ts): rolls the MOTION_PARAMS sliders for every strain over
// their whole ranges — what the console's Random button does — applies each
// roll through window.__viz.setParams, lets the dish grow for --hold ms, and
// saves a screenshot plus the roll as JSON. Seeded, so a run can be repeated;
// CONFIGS=<file.json> replays a list of rolls instead.
//   node motionsearch.mjs <seed> <count> <outdir> [--port 5199] [--hold 25000] [--swiftshader]
// Needs a dev server up. --swiftshader is for a GPU-less Linux box (slow: give
// it a longer --hold); the default flags match this folder's other scripts.
// Keep the viewport at 960x540 or larger: a smaller canvas caps the trail map
// below the agent count's own size and every roll reads washed out.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
const fs = await import("node:fs");
const args = process.argv.slice(2);
const [seedArg, countArg, outdir] = args.filter((a) => !a.startsWith("--"));
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5199");
const hold = +opt("--hold", "25000");
let x = +seedArg >>> 0 || 1;
const rnd = () => {
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return x / 4294967296;
};
const q = (v, step) => Math.round(v / step) * step;
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch(
  args.includes("--swiftshader")
    ? { headless: true, executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] }
    : { channel: "chromium", headless: true, args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"] },
);
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 540 } });
const fixed = process.env.CONFIGS ? JSON.parse(fs.readFileSync(process.env.CONFIGS, "utf8")) : null;
const n = fixed ? fixed.length : +countArg;
for (let c = 0; c < n; c++) {
  let settings = fixed?.[c];
  if (!settings) {
    settings = {};
    for (let k = 0; k < 4; k++) {
      settings[`sensor${k}`] = +q(rnd(), 0.02).toFixed(2);
      settings[`angle${k}`] = Math.round(5 + rnd() * 115);
      settings[`turn${k}`] = +q(rnd(), 0.02).toFixed(2);
      settings[`stride${k}`] = +q(rnd(), 0.02).toFixed(2);
    }
  }
  const name = `${outdir}/s${seedArg}-${String(c).padStart(2, "0")}`;
  fs.writeFileSync(`${name}.json`, JSON.stringify(settings));
  const page = await ctx.newPage();
  await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120&quality=low#/v/physarum2`);
  await page.waitForFunction(() => window.__viz?.setParams, null, { timeout: 20000 });
  await page.evaluate((s) => window.__viz.setParams({ scene: "physarum2", autoPin: true, settings: s }), settings);
  await page.waitForTimeout(hold);
  await page.screenshot({ path: `${name}.png` });
  await page.close();
  console.log(name);
}
await browser.close();
