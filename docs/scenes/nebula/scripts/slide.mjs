// Does Nebula's picture slide one way (wind) or change shape in place? In silence, grey thumbnails
// every SAMPLE_MS; for frames --lag apart, the correlation at every whole-pixel shift within
// ±MAX_SHIFT. A slide shows as a best shift away from 0, consistent in direction (consistency near 1)
// and well above the correlation at no shift; a reshape keeps the best shift near 0 and only lowers
// the correlation. The scene runs with tuning/params.json's settings, so set the gas alone there
// (speed, surge, stars and the reactions at 0) to judge Gas drift by itself.
//
//   node docs/scenes/nebula/scripts/slide.mjs --port P [--from S] [--seconds S] [--lag MS]
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchWithMic, openScene } from "../../../../tools/ref-browser.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5173");
const fromSec = Number(opt("--from", "6"));
const seconds = Number(opt("--seconds", "20"));
const lagMs = Number(opt("--lag", "2000"));
const SAMPLE_MS = 250;
const W = 192;
const H = 108;
const MAX_SHIFT = 10;

function silentWav(sec) {
  const rate = 48000;
  const data = Math.ceil(sec * rate) * 2;
  const b = Buffer.alloc(44 + data);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + data, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(data, 40);
  const path = join(mkdtempSync(join(tmpdir(), "slide-")), "silence.wav");
  writeFileSync(path, b);
  return path;
}

const { browser, ctx } = await launchWithMic(silentWav(fromSec + seconds + 5));
try {
  const page = await openScene(ctx, { port, scene: "nebula" });
  const frames = await page.evaluate(
    ({ fromMs, untilMs, sampleMs, w, h }) =>
      new Promise((resolve) => {
        const gl = document.getElementById("gl");
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const g = c.getContext("2d", { willReadFrequently: true });
        const out = [];
        let next = fromMs;
        const tick = () => {
          const t = performance.now() - window.__micT0;
          if (t >= next && t < untilMs) {
            g.drawImage(gl, 0, 0, w, h);
            const px = g.getImageData(0, 0, w, h).data;
            const grey = new Array(w * h);
            for (let i = 0; i < w * h; i++) grey[i] = (px[4 * i] + px[4 * i + 1] + px[4 * i + 2]) / 3;
            out.push({ t, grey });
            next += sampleMs;
          }
          if (t >= untilMs) resolve(out);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    { fromMs: fromSec * 1000, untilMs: (fromSec + seconds) * 1000, sampleMs: SAMPLE_MS, w: W, h: H },
  );

  const corr = (a, b, dx, dy) => {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
    for (let y = MAX_SHIFT; y < H - MAX_SHIFT; y++) {
      for (let x = MAX_SHIFT; x < W - MAX_SHIFT; x++) {
        const va = a[y * W + x];
        const vb = b[(y + dy) * W + (x + dx)];
        sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; n++;
      }
    }
    const cov = sab / n - (sa / n) * (sb / n);
    const den = Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2));
    return den > 0 ? cov / den : 0;
  };

  const lag = Math.round(lagMs / SAMPLE_MS);
  const rows = [];
  for (let i = 0; i + lag < frames.length; i += 2) {
    const a = frames[i].grey;
    const b = frames[i + lag].grey;
    const c0 = corr(a, b, 0, 0);
    let best = { c: -2, dx: 0, dy: 0 };
    for (let dy = -MAX_SHIFT; dy <= MAX_SHIFT; dy++) {
      for (let dx = -MAX_SHIFT; dx <= MAX_SHIFT; dx++) {
        const c = corr(a, b, dx, dy);
        if (c > best.c) best = { c, dx, dy };
      }
    }
    rows.push({ c0, ...best });
  }
  const mean = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  const mx = mean((r) => r.dx);
  const my = mean((r) => r.dy);
  const mag = mean((r) => Math.hypot(r.dx, r.dy));
  console.log(
    `pairs ${rows.length}, lag ${lagMs} ms: corr at 0 ${mean((r) => r.c0).toFixed(3)}, best ${mean((r) => r.c).toFixed(3)}, ` +
      `best shift mean (${mx.toFixed(2)}, ${my.toFixed(2)}) px, |shift| ${mag.toFixed(2)} px, consistency ${(Math.hypot(mx, my) / Math.max(mag, 1e-9)).toFixed(2)}`,
  );
} finally {
  await browser.close();
}
