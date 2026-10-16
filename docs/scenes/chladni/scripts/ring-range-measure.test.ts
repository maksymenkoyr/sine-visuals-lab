// How hard the plate's figures ring: the tempo-eval synthetic tracks
// (tests/tempoEval/synth.ts), clean and through micChain, run through the
// real FeatureExtractor into createPlateResponse at default settings. From
// 3 s on, prints per track:
//   all    — every table mode's ring (its amplitude), every frame: p50, p90;
//   top    — the loudest mode's ring each frame: p10 … max;
//   lead w — the top mode's share of the plate.
// Where the Mode ladder's bar ends (RING_FLOOR, RING_FULL in
// src/ui/widgets/modeLadder.ts) come from; the numbers are in the record's
// Measurements. Lives here, not in tests/, so CI doesn't run it; to run, copy
// it into tests/ and:
//   node node_modules/vitest/vitest.mjs run tests/ring-range-measure.test.ts
import { it } from "vitest";
import { createPlateResponse } from "../src/render/scenes/chladni.ts";
import { FeatureExtractor } from "../src/audio/features.ts";
import { readBandsDb } from "./tempoEval/bands.ts";
import { micChain } from "./tempoEval/micChain.ts";
import { buildTracks, SR } from "./tempoEval/synth.ts";

const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(3);

it("ring range", () => {
  const fps = 60;
  for (const mic of [false, true]) {
    for (const track of buildTracks()) {
      const mono = mic ? micChain(track.mono, SR) : track.mono;
      const ex = new FeatureExtractor();
      const r = createPlateResponse();
      const inp = { complexity: 0.5, resonance: 0.6, ring: 0.4, figureHold: 0, newness: 0.8 };
      const all: number[] = [];
      const top: number[] = [];
      const lead: number[] = [];
      for (let i = 0; i < Math.floor((mono.length / SR) * fps); i++) {
        const b = ex.update(readBandsDb(mono, i / fps, SR), i / fps, 1).bands;
        const m = r.advance(1 / fps, b, inp);
        if (i < 3 * fps) continue;
        let mx = 0;
        for (const a of r.amplitudes) {
          all.push(a);
          mx = Math.max(mx, a);
        }
        top.push(mx);
        lead.push(m[0].weight);
      }
      all.sort((a, b) => a - b);
      top.sort((a, b) => a - b);
      lead.sort((a, b) => a - b);
      console.log(
        `${mic ? "mic  " : "clean"} ${track.name.padEnd(7)} all p50 ${q(all, 0.5)} p90 ${q(all, 0.9)} | top p10 ${q(top, 0.1)} p50 ${q(top, 0.5)} p90 ${q(top, 0.9)} p99 ${q(top, 0.99)} max ${q(top, 1)} | lead w p50 ${q(lead, 0.5)}`,
      );
    }
  }
}, 600_000);
