// Burst-screenshots Caustics' Breathe across its three regimes and prints
// each frame's mean pixel distance from the burst's first frame, so "the
// pool zooms" / "the pool sits still" is a number, not an impression:
//
//   before  - the bar-locked "Tempo breathe" this branch replaces (run this
//             script against the base branch BEFORE the change lands)
//   unwired - "Breathe" with no cable patched: inert, so the only frame-to-
//             frame movement left is the shader's own slow hue drift
//   wired   - "Breathe" patched to the bass level through localStorage
//             (vibe.drives, driveStore.ts's storage key/shape), so the zoom
//             pumps with each kick of the synthetic feed
//
// Every motion dial except breathe is zeroed (see FROZEN) so a moving frame
// in a burst can only be the breath — the one exception is the palette's own
// uTime hue creep, which is why "unwired" reads as a small floor rather than
// exactly 0.
// usage: node breathe-shot.mjs [port] [outDir] [before|unwired|wired ...]
// Created 2026-09-26 for the Tempo-breathe -> Breathe (wirable) change.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = process.argv[2] ?? "5173";
const OUT = process.argv[3] ?? join(tmpdir(), "shots-breathe");
const conditions = process.argv.slice(4);
const RUNS = conditions.length ? conditions : ["before"];
mkdirSync(OUT, { recursive: true });

// Breathe at full depth, everything else still — see header.
const FROZEN = {
  breathe: 1,
  drift: 0,
  driftBeat: 0,
  driftKick: 0,
  driftLoud: 0,
  driftChurn: 0,
  bass: 0,
  turbulence: 0,
  ripple: 0,
  flash: 0,
  focus: 0,
  sparkle: 0,
  injection: 0,
  dropReactivity: 0,
  centroidHue: 0,
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

for (const cond of RUNS) {
  const browser = await chromium.launch({ channel: "chromium", args: LAUNCH_ARGS });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 540 } });
  if (cond === "wired") {
    // driveStore.ts seeds its cache from localStorage at module import, so
    // this has to land before any page script runs. The shape is
    // encodeDriveSetting's: a bare choice = a weight-1 add patch on "anim.low".
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("vibe.drives", JSON.stringify({ caustics: { breathe: { patch: "anim.low" } } }));
      } catch {
        /* opaque first about:blank — the real load retries this */
      }
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`https://localhost:${PORT}/?audio=synthetic&bpm=120#/v/caustics`);
  await page.waitForTimeout(6000); // let tempo detection / the feed settle
  await page.evaluate(
    (settings) => window.__viz.setParams({ scene: "caustics", autoPin: true, settings }),
    FROZEN,
  );
  await page.waitForTimeout(1500);

  let first = null;
  const dists = [];
  for (let i = 0; i < 10; i++) {
    if (i > 0) await page.waitForTimeout(300);
    const buf = await page.screenshot({ path: `${OUT}/${cond}-${i}.png` });
    const b64 = buf.toString("base64");
    if (first === null) first = b64;
    dists.push(i === 0 ? 0 : await distance(page, first, b64));
  }
  console.log(
    cond.padEnd(8),
    "dist-from-first:",
    dists.map((v) => v.toFixed(4)).join(" "),
    "| max",
    Math.max(...dists).toFixed(4),
  );
  console.log("  page errors:", errors.length ? errors : "none");
  await browser.close();
}
console.log("frames in", OUT);
