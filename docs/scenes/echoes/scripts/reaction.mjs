// Echoes: how much the music alone moves the picture, per Shape and per wire.
// Spin and Drift are 0, so nothing but the wires can move it. `moved` divides
// the frame-to-frame change by the light on screen, so a figure with many
// edges doesn't score higher just for drawing more lines; it saturates once a
// line clears its own width. `travel` reads the same on coarse blocks, where
// light shifts in proportion to how far a line went, so it keeps growing.
//
// A wire other than the one under test has its amount at 0; Flow, whose amount
// also sets the trail, is unplugged instead, so it rests at its middle.
//
//   node reaction.mjs --port P --wav song.wav --out results.jsonl \
//        [--shapes 0,6,9] [--wires all,flow,kick,breathe,shock] [--from 6] [--seconds 16]
//        [--settings JSON]
import { appendFileSync } from "node:fs";
import { launchWithMic, openScene } from "../../../../tools/ref-browser.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5373");
const wav = opt("--wav");
const out = opt("--out");
const shapes = opt("--shapes", "0,6,9").split(",").map(Number);
const wires = opt("--wires", "all,flow,kick,breathe,shock").split(",");
const fromSec = Number(opt("--from", "6"));
const seconds = Number(opt("--seconds", "16"));
const extra = JSON.parse(opt("--settings", "{}"));
const NAMES = ["Circle", "Triangle", "Square", "Pentagon", "Hexagon", "Tetrahedron", "Cube", "Octahedron", "Icosahedron", "Tesseract", "16-cell", "24-cell", "Dodecahedron", "Cuboctahedron", "5-cell"];

const AMOUNT_WIRES = ["kick", "breathe", "shock"];
function plan(wire) {
  const settings = { spin: 0, drift: 0, ...extra };
  const drives = {};
  if (wire !== "all") {
    for (const k of AMOUNT_WIRES) if (k !== wire) settings[k] = 0;
    if (wire !== "flow") drives.flow = { patch: { m: "add", s: [] } };
  }
  return { settings, drives };
}

async function run(shape, wire) {
  const { settings, drives } = plan(wire);
  const { browser, ctx } = await launchWithMic(wav);
  try {
    await ctx.addInitScript((d) => localStorage.setItem("vibe.drives", JSON.stringify({ echoes: d })), drives);
    const page = await openScene(ctx, { port, scene: "echoes" });
    await page.waitForTimeout(1500);
    await page.evaluate((s) => window.__viz.setParams({ scene: "echoes", autoPin: true, settings: s }), { ...settings, shape });
    const r = await page.evaluate(
      ({ fromMs, untilMs }) =>
        new Promise((resolve) => {
          const gl = document.getElementById("gl");
          const W = 240;
          const H = 135;
          const c = document.createElement("canvas");
          c.width = W;
          c.height = H;
          const g = c.getContext("2d", { willReadFrequently: true });
          g.imageSmoothingEnabled = true;
          g.imageSmoothingQuality = "high";
          let prev = null;
          let next = fromMs;
          const change = [];
          const light = [];
          // Blocks about a tenth of a half-height wide: a line that moves less
          // than a block shifts light in proportion to how far it moved, so
          // this keeps growing where `moved` saturates at a line's own width.
          const BLOCK = 8;
          const CW = Math.floor(W / BLOCK);
          const CH = Math.floor(H / BLOCK);
          let prevCoarse = null;
          const coarseChange = [];
          const coarseLight = [];
          let frames = 0;
          const tick = () => {
            const t = performance.now() - window.__micT0;
            if (t >= fromMs) {
              frames++;
              if (t >= next) {
                g.drawImage(gl, 0, 0, W, H);
                const px = g.getImageData(0, 0, W, H).data;
                let l = 0;
                for (let i = 0; i < px.length; i += 4) l += px[i] + px[i + 1] + px[i + 2];
                light.push((l / (W * H * 3 * 255)) * 100);
                if (prev) {
                  let s = 0;
                  for (let i = 0; i < px.length; i += 4) s += Math.abs(px[i] - prev[i]) + Math.abs(px[i + 1] - prev[i + 1]) + Math.abs(px[i + 2] - prev[i + 2]);
                  change.push((s / (W * H * 3 * 255)) * 100);
                }
                prev = px;
                const coarse = new Float32Array(CW * CH);
                for (let y = 0; y < CH * BLOCK; y++) {
                  for (let x = 0; x < CW * BLOCK; x++) {
                    const i = (y * W + x) * 4;
                    coarse[Math.floor(y / BLOCK) * CW + Math.floor(x / BLOCK)] += (px[i] + px[i + 1] + px[i + 2]) / (3 * 255 * BLOCK * BLOCK);
                  }
                }
                let cl = 0;
                for (const v of coarse) cl += v;
                coarseLight.push(cl / coarse.length);
                if (prevCoarse) {
                  let s = 0;
                  for (let i = 0; i < coarse.length; i++) s += Math.abs(coarse[i] - prevCoarse[i]);
                  coarseChange.push(s / coarse.length);
                }
                prevCoarse = coarse;
                next = t + 100;
              }
            }
            if (t >= untilMs) resolve({ change, light, coarseChange, coarseLight, fps: frames / ((t - fromMs) / 1000), scene: window.__viz.probe()?.scene });
            else requestAnimationFrame(tick);
          };
          tick();
        }),
      { fromMs: fromSec * 1000, untilMs: (fromSec + seconds) * 1000 },
    );
    const sorted = [...r.change].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const row = {
      shape: NAMES[shape],
      wire,
      changeMed: at(0.5),
      changeP95: at(0.95),
      changeMean: mean(r.change),
      light: mean(r.light),
      moved: (mean(r.change) / Math.max(1e-6, mean(r.light))) * 100,
      movedP95: (at(0.95) / Math.max(1e-6, mean(r.light))) * 100,
      travel: (mean(r.coarseChange) / Math.max(1e-6, mean(r.coarseLight))) * 100,
      travelP95: ([...r.coarseChange].sort((a, b) => a - b)[Math.floor(0.95 * r.coarseChange.length)] / Math.max(1e-6, mean(r.coarseLight))) * 100,
      fps: r.fps,
      scene: r.scene,
    };
    appendFileSync(out, `${JSON.stringify(row)}\n`);
    console.log(
      `${row.shape.padEnd(13)} ${wire.padEnd(8)} light ${row.light.toFixed(2).padStart(5)}  moved ${row.moved.toFixed(0).padStart(4)}% p95 ${row.movedP95.toFixed(0).padStart(4)}%  travel ${row.travel.toFixed(1).padStart(5)}% p95 ${row.travelP95.toFixed(1).padStart(5)}%  fps ${row.fps.toFixed(0)} ${row.scene ?? ""}`,
    );
  } finally {
    await browser.close();
  }
}

for (const wire of wires) for (const shape of shapes) await run(shape, wire);
