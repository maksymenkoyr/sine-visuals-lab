// Plays a song into Caustics with the given settings and, about every 33 ms,
// measures the full canvas's fine detail (mean absolute Laplacian of luma,
// every other pixel): Grain's glints are fine grain, so each flash adds to
// it, where tune-real's 64×36 change metric averages them away and the
// palette keeps them from reading as near-white. Reports each treble hit's
// flash (its peak detail within FLASH_SEC) and how varied the flashes are.
// Run from the repo root with the dev server up:
// node docs/scenes/caustics/scripts/sparkle-glint-probe.mjs <wav> <port> <settingsJson> [fromSec] [seconds]
import { launchWithMic, openScene } from "../../../../tools/ref-browser.mjs";

const [wav, port, json, fromArg, secArg] = process.argv.slice(2);
const settings = JSON.parse(json);
const fromMs = Number(fromArg ?? 6) * 1000;
const untilMs = fromMs + Number(secArg ?? 30) * 1000;
const FLASH_SEC = 0.1;

const { browser, ctx } = await launchWithMic(wav);
try {
  const page = await openScene(ctx, { port, scene: "caustics" });
  await page.evaluate((s) => window.__viz.setParams({ scene: "caustics", autoPin: true, settings: s }), settings);
  const r = await page.evaluate(
    ({ fromMs, untilMs }) =>
      new Promise((resolve) => {
        const gl = document.getElementById("gl");
        const c = document.createElement("canvas");
        c.width = gl.width;
        c.height = gl.height;
        const g = c.getContext("2d", { willReadFrequently: true });
        const shares = [];
        const hits = [];
        let next = fromMs;
        let was = false;
        const tick = () => {
          const t = performance.now() - window.__micT0;
          const p = window.__viz.probe();
          const hit = p.beat.lanes.high;
          if (t >= fromMs && hit && !was) hits.push(t / 1000);
          was = hit;
          if (t >= next) {
            next = t + 33;
            g.drawImage(gl, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height).data;
            const W = c.width;
            const H = c.height;
            const L = (x, y) => {
              const i = 4 * (y * W + x);
              return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            };
            let n = 0;
            for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) n += Math.abs(4 * L(x, y) - L(x - 1, y) - L(x + 1, y) - L(x, y - 1) - L(x, y + 1));
            shares.push([t / 1000, n / (((W - 2) * (H - 2)) / 4) / 255]);
          }
          if (t < untilMs) requestAnimationFrame(tick);
          else resolve({ shares, hits, w: c.width, h: c.height });
        };
        requestAnimationFrame(tick);
      }),
    { fromMs, untilMs },
  );
  const flashes = r.hits.map((h) => {
    let m = 0;
    for (const [t, s] of r.shares) if (t >= h && t < h + 0.1) m = Math.max(m, s);
    return m;
  });
  const mean = flashes.reduce((a, b) => a + b, 0) / flashes.length;
  const cv = Math.sqrt(flashes.reduce((a, b) => a + (b - mean) ** 2, 0) / flashes.length) / mean;
  const sorted = [...flashes].sort((a, b) => a - b);
  const avgShare = r.shares.reduce((a, b) => a + b[1], 0) / r.shares.length;
  console.log(JSON.stringify({
    settings: settings.sparkleAdapt === 1 ? "Adaptive" : "Basic",
    canvas: `${r.w}x${r.h}`,
    hits: r.hits.length,
    avgDetail: +(100 * avgShare).toFixed(3),
    flashMean: +(100 * mean).toFixed(3),
    flashP10: +(100 * sorted[Math.floor(sorted.length * 0.1)]).toFixed(3),
    flashP90: +(100 * sorted[Math.floor(sorted.length * 0.9)]).toFixed(3),
    flashSpreadCV: +cv.toFixed(2),
  }));
} finally {
  await browser.close();
}
