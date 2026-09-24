// Caustics A/B: does "Sparkle from line" (sparkleLine) actually drive the
// glints off uLineDrive when dialed to 1, vs the plain treble hit detector
// at 0? Bursts frames for each and prints mean luminance per frame.
// Rescued from a working session on 2026-09-22.
// usage: node sparkle-line-ab.mjs [port] [outDir]
// May need adjusting to current code — setting names (sparkleLine, sparkle,
// sparkleBright, flash, drift, ripple, dropReactivity) may have changed.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = process.argv[2] ?? "5173";
const OUT = process.argv[3] ?? join(tmpdir(), "shots-band-line");
mkdirSync(OUT, { recursive: true });

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
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 540 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// Line: low/mid bands (0..15, below bandSplit.ts's MID_HIGH_DEFAULT) excluded
// (1 = fully out), treble bands (16..23) left at 0 (fully in) — so only
// treble energy above 0 can drive uLineDrive, the same band range the
// treble hit detector (uHighPulse) already covers.
const NUM_BANDS = 24;
const MID_HIGH_DEFAULT = 16;
const line = Array.from({ length: NUM_BANDS }, (_, i) => (i < MID_HIGH_DEFAULT ? 1 : 0));

await page.goto(`https://localhost:${PORT}/?audio=synthetic&bpm=120&_=${Date.now()}#/v/caustics`);
await page.evaluate((h) => localStorage.setItem("vibe.bandLine", JSON.stringify({ caustics: h })), line);
// Reload so app.ts's getBandLine(scene.id) picks up the seeded store — it's
// read once per tick from the module cache, which was already seeded before
// this reload by the localStorage write above having run in-page.
await page.goto(`https://localhost:${PORT}/?audio=synthetic&bpm=120&_=${Date.now()}#/v/caustics`);
await page.waitForTimeout(4000);

async function lum(buf) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 54;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4) / 255;
  }, buf.toString("base64"));
}

const base = { sparkle: 1, sparkleBright: 1, flash: 0, drift: 0, ripple: 0, dropReactivity: 0 };
const results = {};
for (const [name, sparkleLine] of [["sparkleLine-0", 0], ["sparkleLine-1", 1]]) {
  await page.evaluate(
    (settings) => window.__viz.setParams({ scene: "caustics", autoPin: true, settings }),
    { ...base, sparkleLine },
  );
  await page.waitForTimeout(1500);
  const lums = [];
  for (let i = 0; i < 12; i++) {
    const buf = await page.screenshot({ path: i === 0 || i === 6 ? `${OUT}/${name}-${i}.png` : undefined });
    lums.push(await lum(buf));
    await page.waitForTimeout(45);
  }
  const min = Math.min(...lums), max = Math.max(...lums);
  const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
  results[name] = { lums, min, max, mean };
  console.log(
    name,
    "lum",
    lums.map((v) => v.toFixed(4)).join(" "),
    "| mean",
    mean.toFixed(4),
    "min",
    min.toFixed(4),
    "max",
    max.toFixed(4),
    "swing",
    (max - min).toFixed(4),
  );
}
console.log("mean diff (sparkleLine-1 - sparkleLine-0):", (results["sparkleLine-1"].mean - results["sparkleLine-0"].mean).toFixed(5));
console.log("page errors:", errors.length ? errors : "none");
await browser.close();
