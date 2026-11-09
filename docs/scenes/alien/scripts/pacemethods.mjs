// node docs/scenes/alien/scripts/pacemethods.mjs [bpm]
// How to give every Alien dance one pace, judged on three measures of how fast
// each dance visibly moves at its captured speed (four samples per frame,
// hands + feet + head):
//   acc   accents/s: peaks of the summed tip speed, smoothed over ⅛ beat, a
//         quarter beat apart, above the median by ¼ of the way to the p90;
//   cen   that speed's spectral centroid between 0.25 and 10 Hz;
//   rmsf  the tips' RMS frequency about their mean places (Hz);
// plus m/s, the tips' mean speed. Each way below sets every dance's playback
// rate; the table prints each measure's spread across the dances (sd of log2)
// after it, over all dances and without the two slow modern moves. A good way
// narrows all three cadence measures, not just its own. [bpm] is the shared
// tempo for the two tempo ways (default 128). Rates clamp to [½, 2].
import { readFileSync } from "node:fs";
const src = (p) => new URL(`../../../../src/render/scenes/${p}`, import.meta.url).pathname;
const { CLIP_LIBRARY_URL, decodeClipLibrary, sampleClip } = await import(src("dancers/clipFormat.ts"));
const rig = await import(src("dancers/rig.ts"));
const { LOOPS, clipSeconds } = await import(src("alien/reel.ts"));

const bin = readFileSync(new URL(`../../../../public${CLIP_LIBRARY_URL}`, import.meta.url));
const lib = decodeClipLibrary(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const TIPS = [rig.B.L_hand, rig.B.R_hand, rig.B.L_foot, rig.B.R_foot, rig.B.head];
const SUB = 4;
const BPM = Number(process.argv[2] ?? 128);

function measure(clip) {
  const seconds = clipSeconds(clip);
  const n = clip.frames * SUB;
  const dt = seconds / n;
  const pose = rig.createPose();
  const world = rig.createRigWorld();
  const tip = new Float32Array(3);
  const X = [];
  for (let i = 0; i < n; i++) {
    sampleClip(clip, i / n, pose);
    rig.forwardKinematics(pose, world);
    rig.groundToFloor(world, pose[rig.CH_LIFT]);
    const p = [];
    for (const b of TIPS) {
      rig.boneTail(world, b, tip, 0);
      p.push(tip[0], tip[1], tip[2]);
    }
    X.push(p);
  }
  const D = TIPS.length * 3;
  const s = new Float64Array(n);
  let v2 = 0;
  for (let i = 0; i < n; i++) {
    const a = X[i];
    const b = X[(i + 1) % n];
    for (let k = 0; k < D; k += 3) {
      const sp2 = ((b[k] - a[k]) ** 2 + (b[k + 1] - a[k + 1]) ** 2 + (b[k + 2] - a[k + 2]) ** 2) / (dt * dt);
      v2 += sp2;
      s[i] += Math.sqrt(sp2);
    }
  }
  const mu = new Array(D).fill(0);
  for (const p of X) for (let d = 0; d < D; d++) mu[d] += p[d] / n;
  let x2 = 0;
  for (const p of X) for (let d = 0; d < D; d++) x2 += (p[d] - mu[d]) ** 2;
  const sm = s.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let k = 1; k < n / 2; k++) {
    const f = k / seconds;
    if (f < 0.25 || f > 10) continue;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      re += (s[i] - sm) * Math.cos((2 * Math.PI * k * i) / n);
      im -= (s[i] - sm) * Math.sin((2 * Math.PI * k * i) / n);
    }
    num += f * (re * re + im * im);
    den += re * re + im * im;
  }
  const perBeat = n / clip.beats;
  const w = Math.max(1, Math.round(perBeat / 8));
  const ss = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = -w; j <= w; j++) ss[i] += s[(i + j + n) % n];
    ss[i] /= 2 * w + 1;
  }
  const sorted = [...ss].sort((a, b) => a - b);
  const med = sorted[Math.floor(n / 2)];
  const floor = med + 0.25 * (sorted[Math.floor(n * 0.9)] - med);
  const gap = Math.round(perBeat / 4);
  let peaks = 0;
  let last = -Infinity;
  for (let i = 0; i < n; i++) {
    if (ss[i] > floor && ss[i] > ss[(i - 1 + n) % n] && ss[i] >= ss[(i + 1) % n] && i - last >= gap) {
      peaks++;
      last = i;
    }
  }
  return { acc: peaks / seconds, cen: num / den, rmsf: Math.sqrt(v2 / x2) / (2 * Math.PI), ms: sm / TIPS.length };
}

const rows = LOOPS.map((l) => {
  const clip = lib.byName.get(l.clip);
  return { dance: l.dance, bpm: clip.nativeBpm, ...measure(clip) };
});
const geo = (xs) => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length);
const sd = (xs) => {
  const l = xs.map(Math.log2);
  const m = l.reduce((a, b) => a + b, 0) / l.length;
  return Math.sqrt(l.reduce((a, b) => a + (b - m) ** 2, 0) / l.length);
};
const fold = (bpm) => {
  let f = bpm;
  while (f < BPM / Math.SQRT2) f *= 2;
  while (f >= BPM * Math.SQRT2) f /= 2;
  return f;
};
const norm = Object.fromEntries(["acc", "cen", "rmsf"].map((k) => [k, geo(rows.map((r) => r[k]))]));
const consensus = (r) => geo(["acc", "cen", "rmsf"].map((k) => r[k] / norm[k]));
const evenBy = (pace) => {
  const target = geo(rows.map(pace));
  return (r) => Math.min(2, Math.max(0.5, target / pace(r)));
};
const ways = {
  "as captured": () => 1,
  [`captured tempo → ${BPM}`]: (r) => BPM / r.bpm,
  [`same, octave-folded`]: (r) => BPM / fold(r.bpm),
  "even accents/s": evenBy((r) => r.acc),
  "even centroid": evenBy((r) => r.cen),
  "even RMS frequency": evenBy((r) => r.rmsf),
  "even all three (pace.ts)": evenBy(consensus),
};
const real = rows.filter((r) => r.acc > 0.6);
const line = (set, rate) => ["acc", "cen", "rmsf", "ms"].map((k) => `${k} ${sd(set.map((r) => r[k] * rate(r))).toFixed(2)}`).join("  ");
console.log(`way                        all ${rows.length} dances                       | without the slow modern moves`);
for (const [name, rate] of Object.entries(ways)) console.log(`${name.padEnd(26)} ${line(rows, rate)} | ${line(real, rate)}`);
