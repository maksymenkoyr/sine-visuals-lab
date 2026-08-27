// A/B compare: two override sets applied to the same URL, captured at
// (approximately) the same synthetic-audio timecode, in two parallel pages
// so wall-clock drift between them stays small. Writes one PNG + one probe
// JSON per side rather than compositing a single image — no image library
// needed, and the numeric probe often answers "is B better than A" on its
// own without even opening the PNGs.
//
//   node tools/tune-ab.mjs <url> <paramsA.json> <paramsB.json> <outPrefix> [--settle MS]
//
// paramsA.json / paramsB.json shape (passed straight to window.__viz.setParams):
//   { "scene": "meshGrid", "autoPin": true, "settings": { "amplitude": 1.8 } }
//
// url should carry ?audio=synthetic&bpm=... for the comparison to be
// meaningful — real mic input differs between the two pages by construction.
import { chromium } from "playwright";
import fs from "node:fs";

const args = process.argv.slice(2);
const [url, paramsAPath, paramsBPath, outPrefix] = args;
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : Number(args[i + 1]);
};
const settle = flag("--settle", 3000);

if (!url || !paramsAPath || !paramsBPath || !outPrefix) {
  console.error("usage: node tools/tune-ab.mjs <url> <paramsA.json> <paramsB.json> <outPrefix> [--settle MS]");
  process.exit(1);
}

const paramsA = JSON.parse(fs.readFileSync(paramsAPath, "utf8"));
const paramsB = JSON.parse(fs.readFileSync(paramsBPath, "utf8"));

const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-unsafe-swiftshader",
  ],
});

async function runSide(label, params) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
    permissions: ["microphone"],
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(`[pageerror ${label}]`, e.message));

  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  try {
    await page.mouse.click(640, 400);
  } catch {}
  await page.waitForFunction(() => typeof window.__viz?.setParams === "function", { timeout: 10000 });
  await page.evaluate((p) => window.__viz.setParams(p), params);
  await page.waitForTimeout(settle);

  const [dataUrl, probeText] = await Promise.all([
    page.evaluate(() => window.__viz.capture({ frames: 1 })),
    page.evaluate(() => window.__viz.probeText()),
  ]);

  const pngPath = `${outPrefix}-${label}.png`;
  const probePath = `${outPrefix}-${label}.txt`;
  fs.writeFileSync(pngPath, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64"));
  fs.writeFileSync(probePath, probeText + "\n");
  console.log(`--- ${label} ---`);
  console.log(probeText);
  console.log("wrote", pngPath, probePath);

  await context.close();
}

// Parallel, not sequential, so both pages' synthetic clocks start within
// milliseconds of each other rather than one settle-period apart.
await Promise.all([runSide("a", paramsA), runSide("b", paramsB)]);

await browser.close();
