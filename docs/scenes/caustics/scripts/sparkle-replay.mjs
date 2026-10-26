// Replays songs recorded by sparkle-record.mjs through causticsSparkle.ts as
// built: Basic against Adaptive, both through advanceSparkleHits. Usage:
// node docs/scenes/caustics/scripts/sparkle-replay.mjs <recDir>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { advanceSparkleHits, createSparkleHits, SHAPE_PLUCK } from "../../../../src/render/scenes/causticsSparkle.ts";

const BASE = { shape: SHAPE_PLUCK, length: 0.6, attack: 0, decay: 0.5, vibration: 0.5, speedHz: 39, vibDecay: 0.5, bounces: 4, rise: 0.75, release: 0.5 };

function run(rows, adaptive) {
  const st = createSparkleHits();
  let trembling = 0;
  const env = rows.map((r, i) => {
    const fired = r[2] === 1 && rows[i - 1]?.[2] !== 1;
    const v = advanceSparkleHits(st, i ? r[0] - rows[i - 1][0] : 1 / 120, fired, 1, BASE, adaptive, r[1], fired ? r[3] : -1);
    if (st.ring === 1) trembling++;
    return v;
  });
  return { env, trembleShare: trembling / rows.length };
}

function stats(env, rows) {
  const pos = env.map((x) => Math.max(0, x));
  const mean = pos.reduce((a, b) => a + b, 0) / pos.length;
  const peaks = [];
  for (let i = 1; i < rows.length; i++) {
    if (!(rows[i][2] && !rows[i - 1][2])) continue;
    let m = 0;
    for (let j = i; j < rows.length && rows[j][0] - rows[i][0] < 0.06; j++) m = Math.max(m, env[j]);
    peaks.push(m);
  }
  const pm = peaks.reduce((a, b) => a + b, 0) / peaks.length;
  const cv = Math.sqrt(peaks.reduce((a, b) => a + (b - pm) ** 2, 0) / peaks.length) / pm;
  return { mean, cv };
}

console.log("song              | basic mean | adaptive mean | peak spread basic → adaptive | differs | trembling");
for (const f of readdirSync(process.argv[2]).filter((x) => x.endsWith(".json"))) {
  const rows = JSON.parse(readFileSync(join(process.argv[2], f), "utf8"));
  const b = run(rows, false);
  const a = run(rows, true);
  const bs = stats(b.env, rows);
  const as = stats(a.env, rows);
  const diff = a.env.reduce((s, x, i) => s + Math.abs(Math.max(0, x) - Math.max(0, b.env[i])), 0) / a.env.length / bs.mean;
  console.log(
    `${f.replace(".json", "").padEnd(17)} | ${bs.mean.toFixed(2).padStart(10)} | ${as.mean.toFixed(2).padStart(13)} | ${bs.cv.toFixed(2)} → ${as.cv.toFixed(2)}`.padEnd(78) +
      ` | ${(100 * diff).toFixed(0).padStart(5)}% | ${(100 * a.trembleShare).toFixed(0).padStart(5)}%`,
  );
}
