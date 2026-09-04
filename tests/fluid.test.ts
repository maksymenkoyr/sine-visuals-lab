import { describe, it, expect } from "vitest";
import {
  simResolutionFor,
  sameSimSize,
  SIM_TIERS,
  WIDTH_QUANTUM,
  SPLAT_SLOTS,
  viscosityPasses,
  VISC_MAX_PASSES,
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
  EMIT_RING,
  EMIT_RING_SIGMA,
  puffEnv,
  createPuffState,
  advancePuff,
  warpedDt,
  PUFF_FALLBACK_AFTER,
  PUFF_FALLBACK_RATE,
  SIM_DT_MAX,
  SIM_DT_DEFAULT,
  WARP_MIN,
  type EmitterInputs,
} from "../src/render/scenes/fluid.ts";
import type { SignalId } from "../src/render/signals.ts";

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
    // Puff clock inputs default to "no puff in flight" (a large puffAge so
    // every secondary splat's puff-based envelope has decayed to ~0) so
    // existing tests that don't care about the puff clock see the same
    // baseline as before it existed.
    puff: 0,
    puffAge: 999,
    dropPulse: 0,
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

  it("bounds the emitter's sway angle by EMIT_SWAY", () => {
    for (const flowPhase of [0, 1, 2, 5.5, 17.3]) {
      const out = emitterState(baseInputs({ flowPhase }), freshSplats());
      // Direction is +y rotated by the sway angle, so the angle off +y is
      // atan2(fx, fy) — bounded by +/-EMIT_SWAY regardless of force magnitude.
      const angle = Math.atan2(out[0].fx, out[0].fy);
      expect(Math.abs(angle)).toBeLessThanOrEqual(EMIT_SWAY + 1e-6);
    }
  });

  it("slot-0 sigma/ring follow EMIT_RING (a gaussian shell when > 0, a blob at EMIT_SIGMA otherwise); secondary slots stay plain blobs at SPLAT_SIGMA with ring 0", () => {
    const out = emitterState(baseInputs(), freshSplats());
    if (EMIT_RING > 0) {
      expect(out[0].ring).toBeCloseTo(EMIT_RING, 6);
      expect(out[0].sigma).toBeCloseTo(EMIT_RING_SIGMA, 6);
    } else {
      expect(out[0].ring).toBe(0);
      expect(out[0].sigma).toBeCloseTo(EMIT_SIGMA, 6);
    }
    for (let i = 1; i < out.length; i++) {
      expect(out[i].sigma).toBeCloseTo(SPLAT_SIGMA, 6);
      expect(out[i].ring).toBe(0);
    }
  });

  it("slot-0 force magnitude and dye strictly increase with puff", () => {
    const mag = (s: { fx: number; fy: number }) => Math.hypot(s.fx, s.fy);
    const low = emitterState(baseInputs({ puff: 0 }), freshSplats())[0];
    const high = emitterState(baseInputs({ puff: 1 }), freshSplats())[0];
    expect(mag(high)).toBeGreaterThan(mag(low));
    expect(high.dye).toBeGreaterThan(low.dye);
  });

  it("still injects dye > 0 in full silence (puff 0, energy 0, pulses 0)", () => {
    const out = emitterState(baseInputs({ energy: 0, lowPulse: 0, beatPulse: 0, puff: 0, dropPulse: 0 }), freshSplats());
    expect(out[0].dye).toBeGreaterThan(0);
  });
});

describe("puffEnv", () => {
  it("is 0 at age 0 (and for any negative age)", () => {
    expect(puffEnv(0)).toBe(0);
    expect(puffEnv(-0.1)).toBe(0);
    expect(puffEnv(-5)).toBe(0);
  });

  it("peaks before 0.1s", () => {
    let peakT = 0;
    let peakV = -Infinity;
    for (let t = 0; t <= 0.3; t += 0.001) {
      const v = puffEnv(t);
      if (v > peakV) {
        peakV = v;
        peakT = t;
      }
    }
    expect(peakT).toBeLessThan(0.1);
    expect(peakV).toBeGreaterThan(0);
  });

  it("decays to under 0.05 by 0.5s", () => {
    expect(puffEnv(0.5)).toBeLessThan(0.05);
  });

  it("decays monotonically once past the peak", () => {
    let prev = puffEnv(0.1);
    for (let t = 0.15; t <= 2; t += 0.05) {
      const v = puffEnv(t);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
});

describe("advancePuff", () => {
  it("fires and resets age to 0 when `fired` is true", () => {
    const st = createPuffState();
    st.age = 5;
    const fired = advancePuff(st, 0.016, true, 0, 0, 0);
    expect(fired).toBe(true);
    expect(st.age).toBe(0);
  });

  it("does not fire twice in a row without a new onset", () => {
    const st = createPuffState();
    expect(advancePuff(st, 0.01, true, 0, 0, 0)).toBe(true);
    // Immediately after: no new onset, and nowhere near the silence
    // fallback's PUFF_FALLBACK_AFTER threshold yet.
    expect(advancePuff(st, 0.01, false, 0, 0, 0.001)).toBe(false);
  });

  it("falls back to firing on its own within ~1/PUFF_FALLBACK_RATE s of silence once PUFF_FALLBACK_AFTER has elapsed", () => {
    const st = createPuffState();
    const dt = 0.01;
    let t = 0;
    let firedAt: number | null = null;
    for (let i = 0; i < 1000 && firedAt === null; i++) {
      t += dt;
      // flowPhase advances at the same rate as wall time here, matching how
      // flowClock behaves at rest (see flowClock.ts).
      if (advancePuff(st, dt, false, 0, 0, t)) firedAt = t;
    }
    expect(firedAt).not.toBeNull();
    expect(firedAt as number).toBeGreaterThanOrEqual(PUFF_FALLBACK_AFTER);
    expect(firedAt as number).toBeLessThanOrEqual(PUFF_FALLBACK_AFTER + 1 / PUFF_FALLBACK_RATE + dt);
  });
});

describe("warpedDt", () => {
  it("at warp 0 and energy 0, scales dt by exactly WARP_MIN", () => {
    const dt = SIM_DT_DEFAULT;
    expect(warpedDt(dt, 0, 0)).toBeCloseTo(dt * WARP_MIN, 10);
  });

  it("clamps to SIM_DT_MAX for a large enough energy/warp", () => {
    expect(warpedDt(SIM_DT_MAX, 1, 1)).toBe(SIM_DT_MAX);
    expect(warpedDt(1, 1, 1)).toBe(SIM_DT_MAX);
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

  it("every `reads` entry names a signal id that actually exists in signals.ts", () => {
    const validIds: SignalId[] = ["feature.onset", "anim.lowOnset", "anim.dropOnset", "anim.centroid"];
    for (const s of SETTINGS) {
      if (!s.reads) continue;
      for (const link of s.reads) {
        const id = typeof link === "string" ? link : link.signal;
        expect(validIds, `${s.key}.reads includes ${id}`).toContain(id);
      }
    }
  });
});
