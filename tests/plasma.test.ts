import { describe, expect, it } from "vitest";
import {
  advanceChurn,
  advanceFlash,
  advanceSweep,
  BOIL_OCTAVE_GROWTH,
  BOIL_RATE,
  boilDepths,
  DRIFT_LEN,
  FIELD_OCTAVES,
  FLASH_TAU_SEC,
  monotoneTangents,
  OCTAVE_SPEEDUP,
  OCTAVE_TURN,
  plasmaDrifts,
  plasmaTone,
  RUSH_GAIN,
  SWEEP_PEAK,
  TONE_V,
  TONE_Z,
  WARP_OCTAVES,
  WARP_SITE_RATES,
} from "../src/render/scenes/plasma.ts";
import { NOISE_PERIOD, wrapFlow } from "../src/render/noiseHash.ts";

describe("plasma warp drifts", () => {
  it("stay inside the lattice period however long the phase has grown", () => {
    for (const ph of [0, 1.7, 3600, 86_400 * 3]) {
      const out = plasmaDrifts(ph);
      expect(out.length).toBe(DRIFT_LEN);
      for (const v of out) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(NOISE_PERIOD);
      }
    }
  });

  it("are each octave's own turned, sped-up drift, wrapped", () => {
    const ph = 12_345.678;
    const out = plasmaDrifts(ph);
    for (let site = 0; site < WARP_SITE_RATES.length; site++) {
      const [rx, ry] = WARP_SITE_RATES[site];
      for (let k = 0; k < WARP_OCTAVES; k++) {
        const a = k * OCTAVE_TURN;
        const speed = OCTAVE_SPEEDUP ** k;
        const o = (site * WARP_OCTAVES + k) * 2;
        expect(out[o]).toBeCloseTo(wrapFlow(ph * speed * (Math.cos(a) * rx - Math.sin(a) * ry)), 3);
        expect(out[o + 1]).toBeCloseTo(wrapFlow(ph * speed * (Math.sin(a) * rx + Math.cos(a) * ry)), 3);
      }
    }
  });
});

describe("plasma boil depths", () => {
  it("stay inside the lattice period and grow per octave", () => {
    for (const ph of [0, 2.5, 7200, 86_400 * 3]) {
      const out = boilDepths(ph);
      expect(out.length).toBe(FIELD_OCTAVES);
      for (const v of out) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(NOISE_PERIOD);
      }
    }
    const a = boilDepths(10);
    const b = boilDepths(11);
    for (let k = 0; k < FIELD_OCTAVES; k++) {
      expect(b[k] - a[k]).toBeCloseTo(BOIL_RATE * BOIL_OCTAVE_GROWTH ** k, 5);
    }
  });
});

describe("plasma churn phase", () => {
  it("runs at Churn alone when Rush hears nothing", () => {
    expect(advanceChurn(5, 0.1, 2, 1.5, 0)).toBeCloseTo(5.2);
  });

  it("speeds up with the Rush reading and never runs backwards", () => {
    expect(advanceChurn(0, 0.2, 1, 1, 1)).toBeCloseTo(0.2 * (1 + RUSH_GAIN));
    expect(advanceChurn(3, -0.2, 1, 1, 1)).toBe(3);
    expect(advanceChurn(3, 0.1, 1, 1, -5)).toBeCloseTo(3.1);
    expect(advanceChurn(3, 0.1, -1, 1, 1)).toBe(3);
  });

  it("treats a long frame gap as a short step, so a hidden tab resumes instead of lurching", () => {
    expect(advanceChurn(0, 5, 1, 0, 0)).toBeLessThanOrEqual(0.25 + 1e-9);
  });
});

describe("plasma sweep envelope", () => {
  it("peaks at a kick's own size about a tenth of a second in, then settles back", () => {
    const dt = 1 / 240;
    let s = advanceSweep({ fast: 0, out: 0 }, dt, 0.8);
    let peak = 0;
    let peakAt = 0;
    for (let i = 1; i < 240; i++) {
      s = advanceSweep(s, dt, 0);
      const v = s.out / SWEEP_PEAK;
      if (v > peak) {
        peak = v;
        peakAt = i * dt;
      }
    }
    expect(peak).toBeCloseTo(0.8, 1);
    expect(peakAt).toBeGreaterThan(0.05);
    expect(peakAt).toBeLessThan(0.2);
    expect(s.out / SWEEP_PEAK).toBeLessThan(0.05);
  });

  it("does nothing without a kick", () => {
    const s = advanceSweep({ fast: 0, out: 0 }, 0.016, 0);
    expect(s.out).toBe(0);
    expect(s.fast).toBe(0);
  });
});

describe("plasma flash envelope", () => {
  it("jumps to a hit's size and relaxes by e every FLASH_TAU_SEC", () => {
    const hit = advanceFlash(0.1, 0.016, 0.7);
    expect(hit).toBe(0.7);
    expect(advanceFlash(hit, FLASH_TAU_SEC, 0)).toBeCloseTo(0.7 / Math.E);
  });
});

describe("plasma tone curve", () => {
  it("has its knots in order", () => {
    expect(TONE_Z.length).toBe(TONE_V.length);
    for (let k = 1; k < TONE_Z.length; k++) {
      expect(TONE_Z[k]).toBeGreaterThan(TONE_Z[k - 1]);
      expect(TONE_V[k]).toBeGreaterThan(TONE_V[k - 1]);
    }
  });

  it("passes through every knot and never turns back between them", () => {
    for (let k = 0; k < TONE_Z.length; k++) expect(plasmaTone(TONE_Z[k])).toBeCloseTo(TONE_V[k], 6);
    let last = -Infinity;
    for (let z = -5; z <= 5; z += 0.01) {
      const v = plasmaTone(z);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      expect(v).toBeGreaterThanOrEqual(0);
      last = v;
    }
  });

  it("gets monotone tangents even where the data flattens", () => {
    const m = monotoneTangents([0, 1, 2, 3], [0, 1, 1, 2]);
    expect(m[1]).toBe(0);
    expect(m[2]).toBe(0);
  });
});
