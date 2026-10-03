// How much does a pad value change what a pair culture does?
// Runs the real CPU pair culture (src/render/scenes/physarum2Preview.ts) with
// the shipped default motion, sweeping one direction of one pair while the
// other direction stays at its ATTRACT_ROWS default, several seeds, no beat
// reseeds, and measures the settled culture on its raw trails (not the
// pad's displayed pixels, which clip):
//   together — how much of the two strains' territory is shared: each
//              strain's trail summed into 6×6-cell blocks, normalised to sum
//              1, then Σ min(pA, pB). 0 = never in the same block, 1 = the
//              same map. Territories score low, crossing networks high.
//   ratio    — (Touch sweep) the eaten/fed strain's total trail over the
//              other's, so eating shows as a drop below 1.
// Used 2026-10-02 for "the monitor barely shows any change" and "often we
// don't see any change" — the record's Decisions entry of that date.
//
//   node padresponse.mjs [--steps 500] [--seeds 4] [--json out.json]
import { createPairCulture } from "../../../../src/render/scenes/physarum2Preview.ts";
import { ATTRACT_ROWS } from "../../../../src/render/scenes/physarum2Affinity.ts";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const STEPS = Number(opt("--steps", "500"));
const SEEDS = Number(opt("--seeds", "4"));
const json = opt("--json", "");

// physarum2.ts LEGACY_MOTION + STRAINS sensor angles, in pad cells the way
// previews.ts converts them (REF_TEXELS_PER_PREVIEW_CELL = 4).
const DEG = Math.PI / 180;
const LEGACY = [
  { d: 30, turn: 40, step: 1.4, angle: 22 },
  { d: 12, turn: 35, step: 0.9, angle: 60 },
  { d: 45, turn: 100, step: 1.8, angle: 95 },
  { d: 5, turn: 20, step: 0.45, angle: 35 },
];
const motion = (k) => ({
  sensorAngle: LEGACY[k].angle * DEG,
  reach: LEGACY[k].d / 4,
  turn: LEGACY[k].turn * DEG,
  step: LEGACY[k].step / 4,
  deposit: 0.03,
});

const SIZE = 72;
const BLOCK = 6;
function together(c) {
  const n = SIZE / BLOCK;
  const sums = [new Float64Array(n * n), new Float64Array(n * n)];
  const tr = c.trails();
  for (let k = 0; k < 2; k++)
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) sums[k][Math.floor(y / BLOCK) * n + Math.floor(x / BLOCK)] += tr[k][y * SIZE + x];
  let sa = 0, sb = 0;
  for (let i = 0; i < n * n; i++) { sa += sums[0][i]; sb += sums[1][i]; }
  let o = 0;
  for (let i = 0; i < n * n; i++) o += Math.min(sums[0][i] / sa, sums[1][i] / sb);
  return o;
}

function settle(A, B, smellAB, smellBA, touchAB, seed) {
  const c = createPairCulture({ size: SIZE, agents: 1600, seed });
  const inputs = {
    motion: [motion(A), motion(B)],
    smell: [
      [ATTRACT_ROWS[A][A], smellAB],
      [smellBA, ATTRACT_ROWS[B][B]],
    ],
    touch: [
      [0, touchAB],
      [0, 0],
    ],
  };
  for (let s = 0; s < STEPS; s++) c.step(inputs);
  return c;
}

const xs = Array.from({ length: 13 }, (_, i) => -1.5 + i * 0.25);
const mean = (f) => {
  let s = 0;
  for (let seed = 1; seed <= SEEDS; seed++) s += f(seed * 7 + 3);
  return s / SEEDS;
};

// Smell: A → B swept, B → A at its default.
const smell = [];
for (const [A, B] of [
  [0, 1],
  [0, 3],
]) {
  const ys = xs.map((x) => mean((seed) => together(settle(A, B, x, ATTRACT_ROWS[B][A], 0, seed))));
  smell.push({ pair: [A, B], partner: ATTRACT_ROWS[B][A], together: ys });
  console.log(`smell ${A}→${B} (partner ${ATTRACT_ROWS[B][A]}): ` + ys.map((v) => v.toFixed(2)).join(" "));
}

// Touch: A's steps on B's trail swept, under the default Smell and under a
// mutual +0.6 attraction.
const touch = [];
for (const [label, sAB, sBA] of [
  ["default smell", ATTRACT_ROWS[0][1], ATTRACT_ROWS[1][0]],
  ["both +0.6", 0.6, 0.6],
]) {
  const ys = xs.map((x) =>
    mean((seed) => {
      const [a, b] = settle(0, 1, sAB, sBA, x, seed).totals();
      return b / a;
    }),
  );
  touch.push({ label, smell: [sAB, sBA], ratio: ys });
  console.log(`touch 0→1 (${label}): ` + ys.map((v) => v.toFixed(2)).join(" "));
}
console.log("x: " + xs.join(" "));

if (json) {
  const fs = await import("node:fs");
  fs.writeFileSync(json, JSON.stringify({ steps: STEPS, seeds: SEEDS, xs, smell, touch }, null, 1));
}
