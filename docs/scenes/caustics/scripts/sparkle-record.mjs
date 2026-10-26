// Records what Caustics' sparkle hears from a song, every frame: time,
// treble level, treble hit, the last treble hit's stand-out, beat phase,
// section — what sparkle-replay.mjs plays back. Run from the repo root with
// the dev server up:
// node docs/scenes/caustics/scripts/sparkle-record.mjs <wav> <port> <out.json> [fromSec] [seconds]
import { writeFileSync } from "node:fs";
import { launchWithMic, openScene } from "../../../../tools/ref-browser.mjs";

const [wav, port, out, fromArg, secArg] = process.argv.slice(2);
const fromMs = Number(fromArg ?? 6) * 1000;
const untilMs = fromMs + Number(secArg ?? 40) * 1000;
const { browser, ctx } = await launchWithMic(wav);
try {
  const page = await openScene(ctx, { port, scene: "caustics" });
  const rows = await page.evaluate(
    ({ fromMs, untilMs }) =>
      new Promise((resolve) => {
        const rows = [];
        const tick = () => {
          const t = performance.now() - window.__micT0;
          const p = window.__viz?.probe();
          if (p && t >= fromMs) rows.push([t / 1000, p.bands.high, p.beat.lanes.high ? 1 : 0, p.beat.standout.high, p.beat.phase, p.section]);
          if (t < untilMs) requestAnimationFrame(tick);
          else resolve(rows);
        };
        requestAnimationFrame(tick);
      }),
    { fromMs, untilMs },
  );
  writeFileSync(out, JSON.stringify(rows));
  const hits = rows.filter((r, i) => r[2] && !(rows[i - 1]?.[2]));
  const sizes = hits.map((r) => r[3]).sort((a, b) => a - b);
  console.log(out.split("/").pop(), "frames", rows.length, "hits", hits.length, "size p10/p50/p90", sizes[Math.floor(sizes.length * 0.1)]?.toFixed(2), sizes[Math.floor(sizes.length * 0.5)]?.toFixed(2), sizes[Math.floor(sizes.length * 0.9)]?.toFixed(2));
} finally {
  await browser.close();
}
