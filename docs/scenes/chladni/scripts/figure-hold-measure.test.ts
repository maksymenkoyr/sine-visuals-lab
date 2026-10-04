// How much the figure changes, across Figure hold: the tempo-eval synthetic
// tracks (tests/tempoEval/synth.ts), clean and through micChain, run through
// the real FeatureExtractor into createPlateResponse at default settings.
// Prints per track and setting:
//   turn — the plate's blend as a weight per table mode, sampled every second
//          from 3 s on; half the L1 distance between consecutive samples is
//          the share of the figure that changed in that second (0 = same
//          figure, 1 = all new).
//   clar — the mean top-mode weight (1 = one clean figure, 0.25 = a four-way
//          blur).
// The last two rows per track are Resonance and Ring maxed at hold 0, the
// check that Figure hold isn't something those already did. The numbers are
// in the record's Measurements. Lives here, not in tests/, so CI doesn't run
// it; to run, copy it into tests/ and:
//   node node_modules/vitest/vitest.mjs run tests/figure-hold-measure.test.ts
import { it } from "vitest";
import { createPlateResponse, MODE_TABLE } from "../src/render/scenes/chladni.ts";
import { FeatureExtractor } from "../src/audio/features.ts";
import { readBandsDb } from "./tempoEval/bands.ts";
import { micChain } from "./tempoEval/micChain.ts";
import { buildTracks, SR } from "./tempoEval/synth.ts";

const RUNS: { hold: number; resonance: number; ring: number }[] = [
  { hold: 0, resonance: 0.6, ring: 0.4 },
  { hold: 0.25, resonance: 0.6, ring: 0.4 },
  { hold: 0.5, resonance: 0.6, ring: 0.4 },
  { hold: 0.75, resonance: 0.6, ring: 0.4 },
  { hold: 1, resonance: 0.6, ring: 0.4 },
  { hold: 0, resonance: 1, ring: 0.4 },
  { hold: 0, resonance: 1, ring: 1 },
];

it("figure turnover across Figure hold", () => {
  const fps = 60;
  const idx = new Map(MODE_TABLE.map((m, i) => [`${m.n},${m.m}`, i]));
  for (const mic of [false, true]) {
    for (const track of buildTracks()) {
      const mono = mic ? micChain(track.mono, SR) : track.mono;
      const ex = new FeatureExtractor();
      const frames: Float32Array[] = [];
      for (let i = 0; i < Math.floor((mono.length / SR) * fps); i++) {
        frames.push(Float32Array.from(ex.update(readBandsDb(mono, i / fps, SR), i / fps, 1).bands));
      }
      const row: string[] = [];
      for (const run of RUNS) {
        const r = createPlateResponse();
        const inp = { complexity: 0.5, resonance: run.resonance, ring: run.ring, figureHold: run.hold };
        let prev: Float32Array | null = null;
        let turn = 0;
        let n = 0;
        let clarity = 0;
        frames.forEach((b, i) => {
          const m = r.advance(1 / fps, b, inp);
          clarity += m[0].weight;
          if (i % fps !== 0 || i < 3 * fps) return;
          const w = new Float32Array(MODE_TABLE.length);
          for (const a of m) w[idx.get(`${a.n},${a.m}`)!] += a.weight;
          if (prev) {
            let d = 0;
            for (let k = 0; k < w.length; k++) d += Math.abs(w[k] - prev[k]);
            turn += d / 2;
            n++;
          }
          prev = w;
        });
        row.push(`h${run.hold} r${run.resonance} g${run.ring}: turn ${(turn / Math.max(1, n)).toFixed(2)} clar ${(clarity / frames.length).toFixed(2)}`);
      }
      console.log(`${mic ? "mic  " : "clean"} ${track.name.padEnd(7)} | ${row.join(" | ")}`);
    }
  }
}, 600_000);
