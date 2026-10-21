import { describe, expect, it } from "vitest";
import {
  advanceChurn,
  advanceFlare,
  BOIL_RATE,
  boilDepths,
  CHURN_LEN,
  CHURN_PATHS,
  churnOffsets,
  FBM_OCTAVES,
  FLARE_DECAY_PER_SEC,
} from "../src/render/scenes/cloud.ts";
import { NOISE_PERIOD } from "../src/render/noiseHash.ts";

describe("cloud churn", () => {
  it("keeps every offset inside its path's radius however long the page runs", () => {
    for (const ph of [0, 1.5, 1e3, 1e6, 3.7e8]) {
      const out = churnOffsets(ph);
      expect(out.length).toBe(CHURN_LEN);
      CHURN_PATHS.forEach(({ radius }, s) => {
        expect(Math.abs(out[s * 2])).toBeLessThanOrEqual(radius + 1e-6);
        expect(Math.abs(out[s * 2 + 1])).toBeLessThanOrEqual(radius + 1e-6);
      });
    }
  });

  it("moves the offsets only a little per frame, even after hours", () => {
    for (const start of [0, 3.6e4]) {
      const a = churnOffsets(start);
      const b = churnOffsets(start + 1 / 60);
      for (let i = 0; i < CHURN_LEN; i++) expect(Math.abs(b[i] - a[i])).toBeLessThan(0.02);
    }
  });

  it("ignores a hidden tab's long step and a backward or broken one", () => {
    expect(advanceChurn(5, 30, 1)).toBeLessThan(5.5);
    expect(advanceChurn(5, -1, 1)).toBe(5);
    expect(advanceChurn(5, Number.NaN, 1)).toBe(5);
    expect(advanceChurn(5, 0.1, Number.NaN)).toBe(5);
    expect(advanceChurn(5, 0.1, -2)).toBe(5);
    expect(advanceChurn(5, 0.1, 2)).toBeCloseTo(5.2);
  });
});

describe("cloud boil", () => {
  it("keeps every octave's depth inside the lattice period after hours", () => {
    for (const ph of [0, 10, 3.6e4, 3.6e6]) {
      const d = boilDepths(ph);
      expect(d.length).toBe(FBM_OCTAVES);
      for (const z of d) {
        expect(z).toBeGreaterThanOrEqual(0);
        expect(z).toBeLessThan(NOISE_PERIOD);
      }
    }
  });

  it("matches the unwrapped depth modulo the period, so the wrap never shows", () => {
    const ph = 3.6e4 + 0.37;
    const d = boilDepths(ph);
    const raw = ph * BOIL_RATE;
    const diff = ((d[0] - raw) % NOISE_PERIOD + NOISE_PERIOD) % NOISE_PERIOD;
    expect(Math.min(diff, NOISE_PERIOD - diff)).toBeLessThan(1e-3);
  });
});

describe("cloud flare", () => {
  it("jumps to a hit's size, never down, then relaxes", () => {
    let env = advanceFlare(0, 0.016, 0.7);
    expect(env).toBe(0.7);
    expect(advanceFlare(0.9, 0, 0.4)).toBe(0.9);
    env = advanceFlare(1, 1, 0);
    expect(env).toBeCloseTo(Math.exp(-FLARE_DECAY_PER_SEC));
  });
});
