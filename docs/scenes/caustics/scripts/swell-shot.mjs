// Burst-screenshots Speed boost (driftLevel) with every other motion dial
// zeroed, so any radial scale change across the synthetic feed's section
// arc can only be the old loudSwell → uLoudSwell aperture channel (run
// against base for "before", against the Speed-boost-rate-only branch for
// "after"). Prints each frame's mean pixel distance from the burst's first
// frame — the same zoom metric docs/scenes/caustics/scripts/breathe-shot.mjs
// uses — and saves the stills for eyeballing filament size at quiet vs loud
// points of the arc.
//
// Created 2026-09-29 for the Speed-boost-is-speed-only change.
// usage: node swell-shot.mjs [port] [outDir] [label]
// Needs a dev server (Metal GPU Chromium flags).
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = process.argv[2] ?? "5173";
const OUT = process.argv[3] ?? join(tmpdir(), "shots-speedboost");
const LABEL = process.argv[4] ?? "boost";
mkdirSync(OUT, { recursive: true });

// Speed boost maxed, everything else still — see header. drift=0 so the
// only rate left is driftLevel's own level term; breathe=0 so Breathe can't
// contribute a zoom of its own; causticDensity pinned (autoPin) so the
// Section drive can't re-scale the mesh under the comparison — density
// moving with the section arc was what swamped the first burst's numbers.
const FROZEN = {
  driftLevel: 1,
  drift: 0,
  driftPump: 0,
  breathe: 0,
  bass: 0,
  turbulence: 0,
  ripple: 0,
  flash: 0,
  focus: 0,
  sparkle: 0,
  injection: 0,
  dropReactivity: 0,
  centroidHue: 0,
  causticDensity: 0.35,
};

const LAUNCH_ARGS = [
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  "--enable-gpu",
  "--use-angle=metal",
  "--enable-gpu-rasterization",
  "--ignore-gpu-blocklist",
];

// Mean pixel distance between two screenshots (both drawn into one 96x54
// canvas first), 0..1 — the zoom check from the header.
async function distance(page, aB64, bB64) {
  return page.evaluate(
    async ({ a, b }) => {
      const load = async (s) => {
        const img = new Image();
        img.src = "data:image/png;base64," + s;
        await img.decode();
        return img;
      };
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const c = document.createElement("canvas");
      c.width = 96;
      c.height = 54;
      const g = c.getContext("2d");
      g.drawImage(ia, 0, 0, c.width, c.height);
      const da = g.getImageData(0, 0, c.width, c.height).data;
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(ib, 0, 0, c.width, c.height);
      const db = g.getImageData(0, 0, c.width, c.height).data;
      let s = 0;
      for (let i = 0; i < da.length; i++) s += Math.abs(da[i] - db[i]);
      return s / da.length / 255;
    },
    { a: aB64, b: bB64 },
  );
}

const browser = await chromium.launch({ channel: "chromium", args: LAUNCH_ARGS });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 540 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`https://localhost:${PORT}/?audio=synthetic&bpm=120#/v/caustics`);
await page.waitForFunction(() => !!window.__viz, null, { timeout: 20000 });
await page.waitForTimeout(6000); // let the feed settle and advanceLoudSwell seed
await page.evaluate(
  (settings) => window.__viz.setParams({ scene: "caustics", autoPin: true, settings }),
  FROZEN,
);
await page.waitForTimeout(2000);

// Synthetic feed's section arc is a slow cosine (SECTION_PERIOD_SEC): four
// stills spanning ~half a cycle catch quiet→loud→quiet, the stretch where
// the old swell channel swung hardest.
const SPACING_MS = 7000;
let first = null;
const dists = [];
for (let i = 0; i < 4; i++) {
  if (i > 0) await page.waitForTimeout(SPACING_MS);
  const buf = await page.screenshot({ path: `${OUT}/${LABEL}-${i}.png` });
  const b64 = buf.toString("base64");
  if (first === null) first = b64;
  dists.push(i === 0 ? 0 : await distance(page, first, b64));
}
console.log(
  LABEL.padEnd(8),
  "dist-from-first:",
  dists.map((v) => v.toFixed(4)).join(" "),
  "| max",
  Math.max(...dists).toFixed(4),
);
console.log("  page errors:", errors.length ? errors : "none");
await browser.close();
console.log("frames in", OUT);
