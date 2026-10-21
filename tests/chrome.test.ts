import { describe, expect, it } from "vitest";
import {
  advanceChromePhase,
  advanceShine,
  chromeFlows,
  FBM_OCTAVES,
  FLOW_LEN,
  FLOW_OCTAVE_SPEEDUP,
  FLOW_OCTAVE_TURN,
  FLOW_SITE_RATES,
  RUSH_GAIN,
  SHINE_TAU_SEC,
} from "../src/render/scenes/chrome.ts";
import { NOISE_PERIOD, wrapFlow } from "../src/render/noiseHash.ts";

describe("chrome drift offsets", () => {
  it("stays inside the lattice period however long the phase has grown", () => {
    for (const ph of [0, 1.7, 3600, 86_400 * 3]) {
      const out = chromeFlows(ph);
      expect(out.length).toBe(FLOW_LEN);
      for (const v of out) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(NOISE_PERIOD);
      }
    }
  });

  it("is each octave's own turned, sped-up drift, wrapped", () => {
    const ph = 12_345.678;
    const out = chromeFlows(ph);
    for (let site = 0; site < FLOW_SITE_RATES.length; site++) {
      const [rx, ry] = FLOW_SITE_RATES[site];
      for (let k = 0; k < FBM_OCTAVES; k++) {
        const a = k * FLOW_OCTAVE_TURN;
        const speed = FLOW_OCTAVE_SPEEDUP ** k;
        const o = (site * FBM_OCTAVES + k) * 2;
        expect(out[o]).toBeCloseTo(wrapFlow(ph * speed * (Math.cos(a) * rx - Math.sin(a) * ry)), 3);
        expect(out[o + 1]).toBeCloseTo(wrapFlow(ph * speed * (Math.sin(a) * rx + Math.cos(a) * ry)), 3);
      }
    }
  });
});

describe("chrome flow phase", () => {
  it("runs at Flow alone when Rush hears nothing", () => {
    expect(advanceChromePhase(5, 0.5, 2, 1.5, 0)).toBeCloseTo(6);
  });

  it("speeds up with the Rush reading and never runs backwards", () => {
    expect(advanceChromePhase(0, 1, 1, 1, 1)).toBeCloseTo(1 + RUSH_GAIN);
    expect(advanceChromePhase(3, -0.2, 1, 1, 1)).toBe(3);
    expect(advanceChromePhase(3, 0.1, 1, 1, -5)).toBeCloseTo(3.1);
  });
});

describe("chrome shine envelope", () => {
  it("jumps to a hit's size and relaxes by e every SHINE_TAU_SEC", () => {
    const hit = advanceShine(0.1, 0.016, 0.7);
    expect(hit).toBe(0.7);
    expect(advanceShine(hit, SHINE_TAU_SEC, 0)).toBeCloseTo(0.7 / Math.E);
  });
});
