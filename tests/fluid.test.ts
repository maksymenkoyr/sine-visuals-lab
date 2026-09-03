import { describe, it, expect } from "vitest";
import {
  simResolutionFor,
  sameSimSize,
  SIM_TIERS,
  WIDTH_QUANTUM,
  SPLAT_SLOTS,
  type MirrorMode,
  type Splat,
} from "../src/render/scenes/fluidSim.ts";
import {
  splatEnvelope,
  emitterState,
  SETTINGS,
  SPLAT_RATE,
  SPLAT_SIGMA,
  EMIT_SWAY,
  EMIT_SIGMA,
  type EmitterInputs,
} from "../src/render/scenes/fluid.ts";

describe("simResolutionFor", () => {
  it("is monotone non-decreasing in detail (higher detail never yields a smaller grid)", () => {
    const detailSteps = [0, 0.1, 0.2, 0.35, 0.4, 0.6, 0.65, 0.7, 0.85, 0.9, 0.95, 1];
    for (const mirror of [0, 1, 2] as MirrorMode[]) {
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
      const size = simResolutionFor(tier.minDetail, 1920, 1080, 2);
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
      for (const mirror of [0, 1, 2] as MirrorMode[]) {
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
        const off = simResolutionFor(detail, bufW, bufH, 0);
        const kaleidoscope = simResolutionFor(detail, bufW, bufH, 2);
        expect(off.velH).toBe(kaleidoscope.velH * 2);
        expect(off.dyeH).toBe(kaleidoscope.dyeH * 2);
        // Same aspect, twice the rows → about twice the width (quantised).
        expect(off.velW / kaleidoscope.velW).toBeGreaterThan(1.8);
        expect(off.velW / kaleidoscope.velW).toBeLessThan(2.2);
      }
    }
  });

  it("left-right's half domain is roughly half of Off's width (aspect halved, quantised)", () => {
    const off = simResolutionFor(1, 1920, 1080, 0);
    const leftRight = simResolutionFor(1, 1920, 1080, 1);
    const ratio = leftRight.velW / off.velW;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it("a 1px canvas resize doesn't change the sim size (quantisation absorbs it)", () => {
    for (const mirror of [0, 1, 2] as MirrorMode[]) {
      const a = simResolutionFor(1, 1920, 1080, mirror);
      const b = simResolutionFor(1, 1921, 1080, mirror);
      expect(sameSimSize(a, b)).toBe(true);
    }
  });

  it("guards a degenerate zero (or negative) buffer height by treating aspect as 1, staying finite", () => {
    for (const bufH of [0, -1]) {
      const size = simResolutionFor(0.5, 1920, bufH, 2);
      expect(Number.isFinite(size.velW)).toBe(true);
      expect(Number.isFinite(size.dyeW)).toBe(true);
      expect(size.velW).toBeGreaterThanOrEqual(WIDTH_QUANTUM);
      expect(size.dyeW).toBeGreaterThanOrEqual(WIDTH_QUANTUM);
    }
  });

  it("also guards a non-finite buffer size", () => {
    const size = simResolutionFor(0.5, NaN, 1080, 0);
    expect(Number.isFinite(size.velW)).toBe(true);
    expect(Number.isFinite(size.dyeW)).toBe(true);
  });
});

describe("sameSimSize", () => {
  it("is true for two identical sizes and false when any field differs", () => {
    const base = simResolutionFor(0.8, 1920, 1080, 2);
    expect(sameSimSize(base, { ...base })).toBe(true);
    expect(sameSimSize(base, { ...base, velW: base.velW + WIDTH_QUANTUM })).toBe(false);
    expect(sameSimSize(base, { ...base, velH: base.velH + 1 })).toBe(false);
    expect(sameSimSize(base, { ...base, dyeW: base.dyeW + WIDTH_QUANTUM })).toBe(false);
    expect(sameSimSize(base, { ...base, dyeH: base.dyeH + 1 })).toBe(false);
    expect(sameSimSize(base, { ...base, jacobiIters: base.jacobiIters + 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fluid.ts's own chunk: emitter/splat logic and the SETTINGS weight
// convention. See fluid.ts's file header for what these functions model.
// ---------------------------------------------------------------------------

function baseInputs(overrides: Partial<EmitterInputs> = {}): EmitterInputs {
  return {
    flowPhase: 0,
    energy: 0.5,
    lowPulse: 0,
    beatPulse: 0,
    emitStrength: 0.5,
    beatKick: 0.5,
    dyeFlow: 0.5,
    mirror: 2,
    ...overrides,
  };
}

function freshSplats(): Splat[] {
  return [];
}

describe("splatEnvelope", () => {
  it("stays within [0, 1]", () => {
    for (let t = 0; t < 50; t += 0.037) {
      for (let i = 0; i < SPLAT_SLOTS; i++) {
        const v = splatEnvelope(t, i);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is periodic with period 1/SPLAT_RATE in flowPhase", () => {
    // Values kept away from an exact cycle boundary (t=0 sits right at the
    // envelope's sharp reset — floating-point noise there can straddle the
    // reset and produce a huge, but meaningless, difference).
    const period = 1 / SPLAT_RATE;
    for (const t of [0.05, 0.2, 1.3, 4.75]) {
      expect(splatEnvelope(t, 0)).toBeCloseTo(splatEnvelope(t + period, 0), 6);
      expect(splatEnvelope(t, 1)).toBeCloseTo(splatEnvelope(t + 3 * period, 1), 6);
    }
  });

  it("phase-offsets each slot so they don't all peak together", () => {
    // At flowPhase = 0 the envelope for slot 0 sits at its peak (fract = 0);
    // slots 1 and 2 are offset by 1/3 and 2/3 of a cycle and so read lower.
    const e0 = splatEnvelope(0, 0);
    const e1 = splatEnvelope(0, 1);
    const e2 = splatEnvelope(0, 2);
    expect(e0).toBeGreaterThan(e1);
    expect(e0).toBeGreaterThan(e2);
  });
});

describe("emitterState", () => {
  it("returns SPLAT_SLOTS entries", () => {
    const out = emitterState(baseInputs(), freshSplats());
    expect(out.length).toBe(SPLAT_SLOTS);
  });

  it.each([
    [2 as MirrorMode, [0, 0]],
    [1 as MirrorMode, [0, 0.5]],
    [0 as MirrorMode, [0.5, 0.5]],
  ])("slot-0 position for mirror mode %i is %o", (mirror, expected) => {
    const out = emitterState(baseInputs({ mirror }), freshSplats());
    expect(out[0].x).toBeCloseTo(expected[0], 6);
    expect(out[0].y).toBeCloseTo(expected[1], 6);
  });

  it("keeps every slot position within [0,1]^2 in every mirror mode", () => {
    for (const mirror of [0, 1, 2] as MirrorMode[]) {
      for (const flowPhase of [0, 0.7, 3.14, 12.9]) {
        const out = emitterState(baseInputs({ mirror, flowPhase }), freshSplats());
        for (const s of out) {
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.x).toBeLessThanOrEqual(1);
          expect(s.y).toBeGreaterThanOrEqual(0);
          expect(s.y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("slot-0 force magnitude strictly increases with lowPulse", () => {
    const mag = (s: Splat) => Math.hypot(s.fx, s.fy);
    const low = emitterState(baseInputs({ lowPulse: 0 }), freshSplats())[0];
    const high = emitterState(baseInputs({ lowPulse: 1 }), freshSplats())[0];
    expect(mag(high)).toBeGreaterThan(mag(low));
  });

  it("slot-0 force magnitude strictly increases with emitStrength", () => {
    const mag = (s: Splat) => Math.hypot(s.fx, s.fy);
    const low = emitterState(baseInputs({ emitStrength: 0.1 }), freshSplats())[0];
    const high = emitterState(baseInputs({ emitStrength: 0.9 }), freshSplats())[0];
    expect(mag(high)).toBeGreaterThan(mag(low));
  });

  it("tags slot 0 as the emitter (1) and every other slot as a plain splat (0)", () => {
    const out = emitterState(baseInputs(), freshSplats());
    expect(out[0].tag).toBe(1);
    for (let i = 1; i < out.length; i++) expect(out[i].tag).toBe(0);
  });

  it("still injects dye > 0 in silence (energy 0, pulses 0)", () => {
    const out = emitterState(baseInputs({ energy: 0, lowPulse: 0, beatPulse: 0 }), freshSplats());
    expect(out[0].dye).toBeGreaterThan(0);
  });

  it("bounds the emitter's sway angle by EMIT_SWAY", () => {
    for (const flowPhase of [0, 1, 2, 5.5, 17.3]) {
      const out = emitterState(baseInputs({ flowPhase }), freshSplats());
      // Direction is +y rotated by the sway angle, so the angle off +y is
      // atan2(fx, fy) — bounded by +/-EMIT_SWAY regardless of force magnitude.
      const angle = Math.atan2(out[0].fx, out[0].fy);
      expect(Math.abs(angle)).toBeLessThanOrEqual(EMIT_SWAY + 1e-6);
    }
  });

  it("keeps slot-0 sigma at EMIT_SIGMA and secondary slots at SPLAT_SIGMA", () => {
    const out = emitterState(baseInputs(), freshSplats());
    expect(out[0].sigma).toBeCloseTo(EMIT_SIGMA, 6);
    for (let i = 1; i < out.length; i++) expect(out[i].sigma).toBeCloseTo(SPLAT_SIGMA, 6);
  });
});

describe("SETTINGS weight convention", () => {
  const IDENTIFIER_TAIL = /^[A-Za-z_][A-Za-z0-9_]*$/;

  it("every key is a valid GLSL identifier tail", () => {
    for (const s of SETTINGS) expect(s.key).toMatch(IDENTIFIER_TAIL);
  });

  it("every auto weight has |w| in [0.15, 0.5] and each setting's sum of |w| stays under 0.8", () => {
    for (const s of SETTINGS) {
      if (!s.auto) continue;
      let sum = 0;
      for (const [dial, w] of Object.entries(s.auto)) {
        expect(Math.abs(w!), `${s.key}.auto.${dial}`).toBeGreaterThanOrEqual(0.15);
        expect(Math.abs(w!), `${s.key}.auto.${dial}`).toBeLessThanOrEqual(0.5);
        sum += Math.abs(w!);
      }
      expect(sum, `${s.key} sum of |auto weights|`).toBeLessThan(0.8);
    }
  });

  it("mirror is an enum setting with three options", () => {
    const mirror = SETTINGS.find((s) => s.key === "mirror")!;
    expect(mirror.type).toBe("enum");
    expect(mirror.options?.length).toBe(3);
  });
});
