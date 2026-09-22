import { describe, it, expect } from "vitest";
import {
  simResolutionFor,
  sameSimSize,
  SIM_TIERS,
  WIDTH_QUANTUM,
  viscosityPasses,
  VISC_MAX_PASSES,
  mirrorDomain,
  MIRROR_OFF,
  MIRROR_LR,
  MIRROR_TB,
  MIRROR_KALEIDO,
  MIRROR_RADIAL,
  type MirrorMode,
} from "../src/render/scenes/skyFluidSim.ts";

// Ports the pure-function cases from origin/worktree-neon-fluid's
// tests/fluid.test.ts that exercise skyFluidSim.ts's own exports (the sim
// math, resolution/tier logic and mirror-domain description) — see
// skyFluidSim.ts's own header for why this file is a copy of fluidSim.ts
// rather than a shared module. The rest of that branch's test file covers
// fluid.ts's own emitter/splat/fold/strobe machinery, which sky.ts doesn't
// use (see sky.ts's header — MIRROR_OFF only, no folds, no lightning).

/** Every mirror mode, in enum order — see MIRROR_OPTIONS in skyFluidSim.ts. */
const ALL_MIRROR_MODES: MirrorMode[] = [
  MIRROR_OFF,
  MIRROR_LR,
  MIRROR_TB,
  MIRROR_KALEIDO,
  MIRROR_RADIAL,
];

describe("simResolutionFor", () => {
  it("is monotone non-decreasing in detail (higher detail never yields a smaller grid)", () => {
    const detailSteps = [0, 0.1, 0.2, 0.35, 0.4, 0.6, 0.65, 0.7, 0.85, 0.9, 0.95, 1];
    for (const mirror of ALL_MIRROR_MODES) {
      let prev = simResolutionFor(detailSteps[0], 1920, 1080, mirror);
      for (let i = 1; i < detailSteps.length; i++) {
        const cur = simResolutionFor(detailSteps[i], 1920, 1080, mirror);
        expect(cur.velH).toBeGreaterThanOrEqual(prev.velH);
        expect(cur.dyeH).toBeGreaterThanOrEqual(prev.dyeH);
        expect(cur.jacobiIters).toBeGreaterThanOrEqual(prev.jacobiIters);
        prev = cur;
      }
    }
  });

  it("matches SIM_TIERS row counts exactly at each tier's own minDetail", () => {
    for (const tier of SIM_TIERS) {
      const size = simResolutionFor(tier.minDetail, 1920, 1080, MIRROR_KALEIDO);
      expect(size.velH).toBe(tier.velRows);
      expect(size.dyeH).toBe(tier.dyeRows);
      expect(size.jacobiIters).toBe(tier.jacobi);
    }
  });

  it("widths are always a multiple of WIDTH_QUANTUM, and at least one quantum", () => {
    const bufSizes: Array<[number, number]> = [
      [1920, 1080],
      [1280, 720],
      [800, 600],
      [375, 812],
      [3840, 2160],
      [1, 1],
    ];
    for (const [bufW, bufH] of bufSizes) {
      for (const mirror of ALL_MIRROR_MODES) {
        for (const detail of [0, 0.3, 0.5, 0.8, 1]) {
          const size = simResolutionFor(detail, bufW, bufH, mirror);
          expect(size.velW % WIDTH_QUANTUM).toBe(0);
          expect(size.dyeW % WIDTH_QUANTUM).toBe(0);
          expect(size.velW).toBeGreaterThanOrEqual(WIDTH_QUANTUM);
          expect(size.dyeW).toBeGreaterThanOrEqual(WIDTH_QUANTUM);
        }
      }
    }
  });

  it("keeps texel density per screen pixel constant across mirror modes: Off gets twice the quadrant's rows, and both share the full-screen aspect", () => {
    for (const [bufW, bufH] of [[1920, 1080], [1280, 720], [1000, 1000], [2560, 1080]] as Array<[number, number]>) {
      for (const detail of [0, 0.5, 1]) {
        const off = simResolutionFor(detail, bufW, bufH, MIRROR_OFF);
        const kaleidoscope = simResolutionFor(detail, bufW, bufH, MIRROR_KALEIDO);
        expect(off.velH).toBe(kaleidoscope.velH * 2);
        expect(off.dyeH).toBe(kaleidoscope.dyeH * 2);
        // Same aspect, twice the rows → about twice the width (quantised).
        expect(off.velW / kaleidoscope.velW).toBeGreaterThan(1.8);
        expect(off.velW / kaleidoscope.velW).toBeLessThan(2.2);
      }
    }
  });

  it("left-right's half domain is roughly half of Off's width (aspect halved, quantised)", () => {
    const off = simResolutionFor(1, 1920, 1080, MIRROR_OFF);
    const leftRight = simResolutionFor(1, 1920, 1080, MIRROR_LR);
    const ratio = leftRight.velW / off.velW;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it("top-bottom simulates the same row count as one unfolded axis (velH === tier.velRows) and is about twice Kaleidoscope's width", () => {
    for (const [bufW, bufH] of [[1920, 1080], [1280, 720], [1000, 1000]] as Array<[number, number]>) {
      for (const detail of [0, 0.5, 1]) {
        const tier = SIM_TIERS.find((t) => detail >= t.minDetail) ?? SIM_TIERS[SIM_TIERS.length - 1];
        const tb = simResolutionFor(detail, bufW, bufH, MIRROR_TB);
        expect(tb.velH).toBe(tier.velRows);
        const kaleidoscope = simResolutionFor(detail, bufW, bufH, MIRROR_KALEIDO);
        expect(tb.dyeW / kaleidoscope.dyeW).toBeGreaterThan(1.8);
        expect(tb.dyeW / kaleidoscope.dyeW).toBeLessThan(2.2);
      }
    }
  });

  it("MIRROR_RADIAL simulates the same grid size as Kaleidoscope (they share the quadrant)", () => {
    const kaleidoscope = simResolutionFor(0.7, 1920, 1080, MIRROR_KALEIDO);
    expect(simResolutionFor(0.7, 1920, 1080, MIRROR_RADIAL)).toEqual(kaleidoscope);
  });

  it("a 1px canvas resize doesn't change the sim size (quantisation absorbs it)", () => {
    for (const mirror of ALL_MIRROR_MODES) {
      const a = simResolutionFor(1, 1920, 1080, mirror);
      const b = simResolutionFor(1, 1921, 1080, mirror);
      expect(sameSimSize(a, b)).toBe(true);
    }
  });

  it("guards a degenerate zero (or negative) buffer height by treating aspect as 1, staying finite", () => {
    for (const bufH of [0, -1]) {
      const size = simResolutionFor(0.5, 1920, bufH, MIRROR_KALEIDO);
      expect(Number.isFinite(size.velW)).toBe(true);
      expect(Number.isFinite(size.dyeW)).toBe(true);
      expect(size.velW).toBeGreaterThanOrEqual(WIDTH_QUANTUM);
      expect(size.dyeW).toBeGreaterThanOrEqual(WIDTH_QUANTUM);
    }
  });

  it("also guards a non-finite buffer size", () => {
    const size = simResolutionFor(0.5, NaN, 1080, MIRROR_OFF);
    expect(Number.isFinite(size.velW)).toBe(true);
    expect(Number.isFinite(size.dyeW)).toBe(true);
  });
});

describe("sameSimSize", () => {
  it("is true for two identical sizes and false when any field differs", () => {
    const base = simResolutionFor(0.8, 1920, 1080, MIRROR_KALEIDO);
    expect(sameSimSize(base, { ...base })).toBe(true);
    expect(sameSimSize(base, { ...base, velW: base.velW + WIDTH_QUANTUM })).toBe(false);
    expect(sameSimSize(base, { ...base, velH: base.velH + 1 })).toBe(false);
    expect(sameSimSize(base, { ...base, dyeW: base.dyeW + WIDTH_QUANTUM })).toBe(false);
    expect(sameSimSize(base, { ...base, dyeH: base.dyeH + 1 })).toBe(false);
    expect(sameSimSize(base, { ...base, jacobiIters: base.jacobiIters + 1 })).toBe(false);
  });
});

describe("mirrorDomain", () => {
  it("radial is true only for MIRROR_RADIAL", () => {
    for (const mirror of ALL_MIRROR_MODES) {
      expect(mirrorDomain(mirror).radial).toBe(mirror === MIRROR_RADIAL);
    }
  });

  it("folds both axes for Kaleidoscope and MIRROR_RADIAL, one axis for Left-right/Top-bottom, neither for Off", () => {
    expect(mirrorDomain(MIRROR_OFF)).toEqual({ foldX: false, foldY: false, radial: false });
    expect(mirrorDomain(MIRROR_LR)).toEqual({ foldX: true, foldY: false, radial: false });
    expect(mirrorDomain(MIRROR_TB)).toEqual({ foldX: false, foldY: true, radial: false });
    expect(mirrorDomain(MIRROR_KALEIDO)).toEqual({ foldX: true, foldY: true, radial: false });
    expect(mirrorDomain(MIRROR_RADIAL)).toEqual({ foldX: true, foldY: true, radial: true });
  });
});

describe("viscosityPasses", () => {
  it("is {0, 0} at viscosity 0", () => {
    const { full, frac } = viscosityPasses(0);
    expect(full).toBe(0);
    expect(frac).toBe(0);
  });

  it("is {VISC_MAX_PASSES, ~0} at viscosity 1", () => {
    const { full, frac } = viscosityPasses(1);
    expect(full).toBe(VISC_MAX_PASSES);
    expect(frac).toBeCloseTo(0, 6);
  });

  it("splits a fractional pass count correctly (0.375 * VISC_MAX_PASSES = 1.5)", () => {
    const { full, frac } = viscosityPasses(0.375);
    expect(full).toBe(1);
    expect(frac).toBeCloseTo(0.5, 6);
  });

  it("total pass-equivalent (full + frac) is monotone non-decreasing in viscosity", () => {
    let prev = -Infinity;
    for (let v = 0; v <= 1; v += 0.01) {
      const { full, frac } = viscosityPasses(v);
      const total = full + frac;
      expect(total).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = total;
    }
  });
});
