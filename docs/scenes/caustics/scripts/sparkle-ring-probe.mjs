// Plays a song as the fake mic into Caustics and logs the probe's treble
// level and treble hits every frame, then applies Adaptive's ring test
// (causticsSparkle.ts: peak over the first PEAK s, level at CHECK s) to
// every hit, with the share that would tremble at several hold thresholds.
// Run from the repo root with the dev server up:
// node docs/scenes/caustics/scripts/sparkle-ring-probe.mjs <wav> <port> [fromSec] [seconds]
import { launchWithMic, openScene } from "../../../../tools/ref-browser.mjs";

const [wav, port, fromArg, secArg] = process.argv.slice(2);
const fromMs = Number(fromArg ?? 6) * 1000;
const untilMs = fromMs + Number(secArg ?? 40) * 1000;
const PEAK = 0.05, CHECK = 0.12, HOLD = 0.6;

const { browser, ctx } = await launchWithMic(wav);
try {
  const page = await openScene(ctx, { port, scene: "caustics" });
  const rows = await page.evaluate(
    ({ fromMs, untilMs }) =>
      new Promise((resolve) => {
        const out = [];
        const tick = () => {
          const t = performance.now() - window.__micT0;
          const p = window.__viz?.probe();
          if (p && t >= fromMs) out.push([t / 1000, p.bands.high, p.beat.lanes.high ? 1 : 0]);
          if (t < untilMs) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    { fromMs, untilMs },
  );
  const hits = [];
  for (let i = 1; i < rows.length; i++) if (rows[i][2] && !rows[i - 1][2]) hits.push(i);
  const ratios = [];
  let cut = 0;
  for (let h = 0; h < hits.length; h++) {
    const i = hits[h];
    const t0 = rows[i][0];
    const nextT = h + 1 < hits.length ? rows[hits[h + 1]][0] : Infinity;
    if (nextT <= t0 + CHECK) { cut++; continue; }
    let peak = 0, j = i;
    while (j < rows.length && rows[j][0] <= t0 + PEAK) peak = Math.max(peak, rows[j++][1]);
    while (j < rows.length && rows[j][0] < t0 + CHECK) j++;
    if (j >= rows.length || peak <= 0) continue;
    ratios.push(rows[j][1] / peak);
  }
  const gaps = hits.slice(1).map((i, k) => rows[i][0] - rows[hits[k]][0]).sort((a, b) => a - b);
  const fps = rows.length / (rows[rows.length - 1][0] - rows[0][0]);
  const hist = Array(10).fill(0);
  for (const r of ratios) hist[Math.min(9, Math.floor(r * 10))]++;
  const rings = ratios.filter((r) => r >= HOLD).length;
  console.log(JSON.stringify({
    wav: wav.split("/").slice(-2, -1)[0],
    fps: +fps.toFixed(1),
    trebleHits: hits.length,
    perMin: +(hits.length / ((untilMs - fromMs) / 60000)).toFixed(0),
    gapMedian: +(gaps[Math.floor(gaps.length / 2)] ?? 0).toFixed(3),
    cutBeforeCheck: cut,
    tested: ratios.length,
    ringing: rings,
    ringPct: ratios.length ? Math.round((100 * rings) / ratios.length) : 0,
    ringPctAt: Object.fromEntries([0.7, 0.8, 0.85, 0.9].map((h) => [h, Math.round((100 * ratios.filter((r) => r >= h).length) / Math.max(1, ratios.length))])),
    ratioHistByTenth: hist,
  }));
} finally {
  await browser.close();
}
