import { describe, it, expect } from "vitest";
import {
  simResolutionFor,
  sameSimSize,
  SIM_TIERS,
  WIDTH_QUANTUM,
  SPLAT_SLOTS,
  viscosityPasses,
  VISC_MAX_PASSES,
  mirrorDomain,
  MIRROR_OFF,
  MIRROR_LR,
  MIRROR_TB,
  MIRROR_KALEIDO,
  MIRROR_RADIAL,
  MIRROR_OPTIONS,
  FOLD_WEDGES_MIN,
  FOLD_WEDGES_MAX,
  type MirrorMode,
  type Splat,
} from "../src/render/scenes/fluidSim.ts";
import {
  splatEnvelope,
  emitterState,
  emitterPosition,
  emitterDirection,
  emitterScreenPosition,
  TB_EMIT_Y,
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
  SYMMETRY_OPTIONS,
  symmetryToMirror,
  FOLD_FAMILY,
  FOLD_FADE_SEC,
  FOLD_HOLD_MIN,
  FOLD_HOLD_MAX,
  FOLD_ZOOM_AMP,
  createFoldState,
  advanceFold,
  foldZoom,
  foldMixEased,
  SHOCK_SLOTS,
  SHOCK_LIFE,
  createShockState,
  triggerShock,
  advanceShocks,
  STROBE_DUR,
  STROBE_MIN_GAP,
  createStrobeState,
  triggerStrobe,
  advanceStrobe,
  strobePhase,
  type EmitterInputs,
} from "../src/render/scenes/fluid.ts";
import type { SignalId } from "../src/render/signals.ts";

/** Every mirror mode, in enum order — see MIRROR_OPTIONS. */
const ALL_MIRROR_MODES: MirrorMode[] = [
  MIRROR_OFF,
  MIRROR_LR,
  MIRROR_TB,
  MIRROR_KALEIDO,
  MIRROR_RADIAL,
];

/** Slot 0 (the centre emitter)'s expected sim-space position per mirror
 *  mode — shared between emitterState's own test and the direct
 *  emitterPosition test below, since the two must agree. */
const SLOT0_POSITION_CASES: Array<[MirrorMode, number[]]> = [
  [MIRROR_OFF, [0.5, 0.5]],
  [MIRROR_LR, [0, 0.5]],
  [MIRROR_TB, [0, TB_EMIT_Y]],
  [MIRROR_KALEIDO, [0, 0]],
  [MIRROR_RADIAL, [0, 0]],
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
    mirror: MIRROR_KALEIDO,
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

  it.each(SLOT0_POSITION_CASES)("slot-0 position for mirror mode %i is %o", (mirror, expected) => {
    const out = emitterState(baseInputs({ mirror }), freshSplats());
    expect(out[0].x).toBeCloseTo(expected[0], 6);
    expect(out[0].y).toBeCloseTo(expected[1], 6);
  });

  it("keeps every slot position within [0,1]^2 in every mirror mode", () => {
    for (const mirror of ALL_MIRROR_MODES) {
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

describe("emitterPosition / emitterDirection / emitterScreenPosition", () => {
  it.each(SLOT0_POSITION_CASES)("emitterPosition for mirror mode %i is %o (matches emitterState's slot 0)", (mirror, expected) => {
    const [x, y] = emitterPosition(mirror);
    expect(x).toBeCloseTo(expected[0], 6);
    expect(y).toBeCloseTo(expected[1], 6);
  });

  it("emitterDirection is +x for Top-bottom (its seam is horizontal) and +y for every other mode (a vertical seam)", () => {
    for (const mirror of ALL_MIRROR_MODES) {
      const [dx, dy] = emitterDirection(mirror);
      expect(Math.hypot(dx, dy)).toBeCloseTo(1, 6);
      if (mirror === MIRROR_TB) {
        expect(dx).toBeCloseTo(1, 6);
        expect(dy).toBeCloseTo(0, 6);
      } else {
        expect(dx).toBeCloseTo(0, 6);
        expect(dy).toBeCloseTo(1, 6);
      }
    }
  });

  it("emitterScreenPosition is the screen's left edge, TB_EMIT_Y off the seam, for Top-bottom, screen centre for every other mode", () => {
    for (const mirror of ALL_MIRROR_MODES) {
      const [x, y] = emitterScreenPosition(mirror);
      if (mirror === MIRROR_TB) {
        expect([x, y]).toEqual([0, 0.5 + TB_EMIT_Y * 0.5]);
      } else {
        expect([x, y]).toEqual([0.5, 0.5]);
      }
    }
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

  it("symmetry is an enum setting whose options and range match SYMMETRY_OPTIONS exactly", () => {
    const symmetry = SETTINGS.find((s) => s.key === "symmetry")!;
    expect(symmetry.type).toBe("enum");
    expect(symmetry.options).toEqual(SYMMETRY_OPTIONS);
    expect(symmetry.min).toBe(0);
    expect(symmetry.max).toBe(SYMMETRY_OPTIONS.length - 1);
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

// ---------------------------------------------------------------------------
// Symmetry / fold drift: the Symmetry group's `symmetry` setting's Auto
// option (value 0) drifts between FOLD_FAMILY's quadrant folds instead of
// holding one, warping the sample coordinate itself between them (see
// foldMixEased) rather than crossfading two rendered images — see fluid.ts's
// FoldState/createFoldState/advanceFold/foldZoom/foldMixEased. The group's
// Spin/Zoom breathing/Auto drift settings gate advanceFold's rotation, zoom
// amplitude, and hold-countdown rate respectively.
// ---------------------------------------------------------------------------

/** Deterministic stand-in for Math.random in fold-drift tests: cycles
 *  through the given values (repeating the last one) instead of drawing a
 *  fresh real random number each call. */
function fixedRng(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** Small deterministic PRNG (mulberry32) for tests that need many distinct
 *  pseudo-random draws (fixedRng's fixed cycle isn't varied enough to drive
 *  advanceFold through hundreds of distinct reconfigures) while staying
 *  reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("SYMMETRY_OPTIONS / symmetryToMirror", () => {
  it("is Auto plus every MIRROR_OPTIONS entry, index-shifted by one", () => {
    expect(SYMMETRY_OPTIONS.length).toBe(MIRROR_OPTIONS.length + 1);
    expect(SYMMETRY_OPTIONS[0]).toBe("Auto");
    expect(SYMMETRY_OPTIONS.slice(1)).toEqual(MIRROR_OPTIONS);
  });

  it("maps 0 to null (Auto) and k > 0 to MirrorMode k - 1", () => {
    expect(symmetryToMirror(0)).toBeNull();
    for (let k = 1; k < SYMMETRY_OPTIONS.length; k++) {
      expect(symmetryToMirror(k)).toBe(k - 1);
    }
  });
});

describe("createFoldState", () => {
  it("starts settled on a FOLD_FAMILY member: modeA === modeB, mix 1, rot 0", () => {
    const st = createFoldState();
    expect(FOLD_FAMILY).toContain(st.modeA);
    expect(st.modeA).toBe(st.modeB);
    expect(st.mix).toBe(1);
    expect(st.rot).toBe(0);
  });

  it("starts on Kaleidoscope", () => {
    const st = createFoldState();
    expect(st.modeA).toBe(MIRROR_KALEIDO);
  });

  it("carries no wedge count of its own — Mirror count is authoritative everywhere (render() alone owns uFoldWedgesA/B)", () => {
    const st = createFoldState();
    expect(st).not.toHaveProperty("wedgesA");
    expect(st).not.toHaveProperty("wedgesB");
  });

  it("draws holdLeft from [FOLD_HOLD_MIN, FOLD_HOLD_MAX]", () => {
    for (const rng of [fixedRng(0), fixedRng(0.999), fixedRng(0.5)]) {
      const st = createFoldState(rng);
      expect(st.holdLeft).toBeGreaterThanOrEqual(FOLD_HOLD_MIN);
      expect(st.holdLeft).toBeLessThanOrEqual(FOLD_HOLD_MAX);
    }
  });
});

/** advanceFold's full input shape, with defaults chosen so the pre-existing
 *  tests below see the same numeric behaviour they always have: spin/breathe
 *  at 1 (full effect), drift at 0.5 (the value the task spec calls out as
 *  matching the fold's drift rate before the Symmetry group's Auto drift
 *  setting existed — see advanceFold's own doc comment in fluid.ts). */
function foldInp(overrides: Partial<{ energy: number; dropOnset: boolean; beatPulse: number; spin: number; breathe: number; drift: number }> = {}) {
  return {
    energy: 0,
    dropOnset: false,
    beatPulse: 0,
    spin: 1,
    breathe: 1,
    drift: 0.5,
    ...overrides,
  };
}

describe("advanceFold", () => {
  const inp = foldInp;

  it("rises mix toward 1 within FOLD_FADE_SEC of a reconfigure", () => {
    const st = createFoldState(fixedRng(0.9));
    advanceFold(st, 0, inp({ dropOnset: true }), fixedRng(0.9)); // force mix -> 0
    expect(st.mix).toBe(0);
    let t = 0;
    const dt = 0.05;
    while (t < FOLD_FADE_SEC) {
      advanceFold(st, dt, inp(), fixedRng(0.9));
      t += dt;
    }
    expect(st.mix).toBeCloseTo(1, 5);
  });

  it("a dropOnset at mix 1 changes modeB to a different FOLD_FAMILY member and resets mix to 0", () => {
    const st = createFoldState();
    const prevA = st.modeA;
    advanceFold(st, 0.016, inp({ dropOnset: true }));
    expect(st.mix).toBe(0);
    expect(st.modeA).toBe(prevA);
    expect(st.modeB).not.toBe(st.modeA);
    expect(FOLD_FAMILY).toContain(st.modeB);
  });

  it("never interrupts a warp already in flight, even on a dropOnset", () => {
    const st = createFoldState();
    advanceFold(st, 0.016, inp({ dropOnset: true })); // starts a warp, mix -> 0
    const { modeA, modeB } = st;
    advanceFold(st, 0.01, inp({ dropOnset: true })); // still mid-fade
    expect(st.modeA).toBe(modeA);
    expect(st.modeB).toBe(modeB);
  });

  it("hold expiry (simulated FOLD_HOLD_MAX + 1s at energy 0) changes the fold once settled", () => {
    const st = createFoldState(fixedRng(0)); // holdLeft starts at FOLD_HOLD_MIN
    const startMode = st.modeB;
    let t = 0;
    const dt = 0.05;
    let changed = false;
    while (t < FOLD_HOLD_MAX + 1) {
      advanceFold(st, dt, inp());
      t += dt;
      if (st.modeB !== startMode) changed = true;
    }
    expect(changed).toBe(true);
  });

  it("keeps modeA and modeB in FOLD_FAMILY across many steps of mixed energy/beat/drop input", () => {
    const st = createFoldState();
    for (let i = 0; i < 2000; i++) {
      advanceFold(st, 0.03, foldInp({ energy: (i % 7) / 7, dropOnset: i % 53 === 0, beatPulse: (i % 11) / 11 }));
      expect(FOLD_FAMILY).toContain(st.modeA);
      expect(FOLD_FAMILY).toContain(st.modeB);
    }
  });

  it("alternates between the two FOLD_FAMILY modes on every reconfigure (never repeats the mode just settled on)", () => {
    const rng = mulberry32(12345);
    const st = createFoldState(rng);
    let reconfigures = 0;
    for (let i = 0; i < 4000; i++) {
      const before = st.modeB;
      // dropOnset + drift 1 every frame reconfigures the instant each warp
      // settles (st.mix reaches 1), driving many transitions quickly.
      advanceFold(st, 0.05, { energy: rng(), dropOnset: true, beatPulse: 0, spin: 0, breathe: 0, drift: 1 }, rng);
      if (st.mix === 0) {
        reconfigures++;
        expect(st.modeB).not.toBe(before);
        expect(FOLD_FAMILY).toContain(st.modeB);
      }
    }
    expect(reconfigures).toBeGreaterThan(20);
  });

  it("rot advances faster with more energy", () => {
    const lo = createFoldState(fixedRng(0));
    const hi = createFoldState(fixedRng(0));
    advanceFold(lo, 0.1, inp({ energy: 0 }), fixedRng(0));
    advanceFold(hi, 0.1, inp({ energy: 1 }), fixedRng(0));
    expect(Math.abs(hi.rot)).toBeGreaterThan(Math.abs(lo.rot));
  });

  it("rot advances faster on a beat pulse", () => {
    const lo = createFoldState(fixedRng(0));
    const hi = createFoldState(fixedRng(0));
    advanceFold(lo, 0.1, inp({ beatPulse: 0 }), fixedRng(0));
    advanceFold(hi, 0.1, inp({ beatPulse: 1 }), fixedRng(0));
    expect(Math.abs(hi.rot)).toBeGreaterThan(Math.abs(lo.rot));
  });

  it("spin 0 leaves rot unchanged (no rotation at all)", () => {
    const st = createFoldState(fixedRng(0));
    for (let i = 0; i < 50; i++) advanceFold(st, 0.1, inp({ spin: 0, energy: (i % 5) / 5, beatPulse: (i % 3) / 3 }));
    expect(st.rot).toBe(0);
  });

  it("drift 0 never changes the fold, even past FOLD_HOLD_MAX and on a dropOnset", () => {
    const st = createFoldState(fixedRng(0)); // holdLeft starts at FOLD_HOLD_MIN
    const modeA = st.modeA;
    const modeB = st.modeB;
    let t = 0;
    const dt = 0.05;
    while (t < FOLD_HOLD_MAX + 1) {
      advanceFold(st, dt, inp({ drift: 0, dropOnset: true }));
      t += dt;
    }
    expect(st.modeA).toBe(modeA);
    expect(st.modeB).toBe(modeB);
    // mix still rises normally at drift 0 — only the reconfigure is gated.
    expect(st.mix).toBe(1);
  });
});

describe("foldZoom", () => {
  it("is 1 at zoomPhase 0 (a fresh state), regardless of breathe", () => {
    expect(foldZoom(createFoldState(), 1)).toBeCloseTo(1, 6);
    expect(foldZoom(createFoldState(), 0)).toBeCloseTo(1, 6);
  });

  it("oscillates within [1 - FOLD_ZOOM_AMP, 1 + FOLD_ZOOM_AMP] at breathe 0.5 (matches the pre-setting amplitude)", () => {
    const st = createFoldState();
    for (let i = 0; i < 500; i++) {
      advanceFold(st, 0.05, foldInp({ breathe: 0.5 }));
      const z = foldZoom(st, 0.5);
      expect(z).toBeGreaterThanOrEqual(1 - FOLD_ZOOM_AMP - 1e-9);
      expect(z).toBeLessThanOrEqual(1 + FOLD_ZOOM_AMP + 1e-9);
    }
  });

  it("amplitude scales with breathe (breathe 1 swings twice as far as breathe 0.5)", () => {
    const st = createFoldState();
    st.zoomPhase = 0.25; // sin(0.25 * 2*pi) = 1, the oscillation's peak
    const zHalf = foldZoom(st, 0.5) - 1;
    const zFull = foldZoom(st, 1) - 1;
    expect(zFull).toBeCloseTo(zHalf * 2, 6);
  });
});

describe("foldMixEased", () => {
  it("is 0 at 0, 1 at 1, and 0.5 at 0.5 (the smoothstep formula m*m*(3-2m))", () => {
    expect(foldMixEased(0)).toBe(0);
    expect(foldMixEased(1)).toBe(1);
    expect(foldMixEased(0.5)).toBeCloseTo(0.5, 10);
  });

  it("is monotone non-decreasing over [0, 1]", () => {
    let prev = -Infinity;
    for (let m = 0; m <= 1; m += 0.01) {
      const v = foldMixEased(m);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

describe("Symmetry group settings", () => {
  const symmetrySettings = SETTINGS.filter((s) => s.group === "Symmetry");
  const SYMMETRY_KEYS = ["symmetry", "foldCount", "foldSpread", "foldSpin", "foldBreathe", "foldDrift"];

  it("has exactly symmetry, foldCount, foldSpread, foldSpin, foldBreathe, foldDrift", () => {
    expect(symmetrySettings.map((s) => s.key).sort()).toEqual([...SYMMETRY_KEYS].sort());
  });

  it("symmetry itself carries no reads (moved to foldDrift)", () => {
    const symmetry = SETTINGS.find((s) => s.key === "symmetry")!;
    expect(symmetry.reads).toBeUndefined();
  });

  it("foldDrift reads anim.dropOnset", () => {
    const foldDrift = SETTINGS.find((s) => s.key === "foldDrift")!;
    expect(foldDrift.reads).toEqual(["anim.dropOnset"]);
  });

  it("foldCount is a manual (no auto) slider spanning [FOLD_WEDGES_MIN, FOLD_WEDGES_MAX], step 1, default 6, placed right after symmetry", () => {
    const s = SETTINGS.find((x) => x.key === "foldCount")!;
    expect(s.min).toBe(FOLD_WEDGES_MIN);
    expect(s.max).toBe(FOLD_WEDGES_MAX);
    expect(s.step).toBe(1);
    expect(s.default).toBe(6);
    expect(s.auto).toBeUndefined();
    const symmetryIdx = SETTINGS.findIndex((x) => x.key === "symmetry");
    const foldCountIdx = SETTINGS.findIndex((x) => x.key === "foldCount");
    expect(foldCountIdx).toBe(symmetryIdx + 1);
  });

  it("foldSpread/foldSpin/foldBreathe/foldDrift are 0..1 ranged sliders with step 0.05", () => {
    for (const key of ["foldSpread", "foldSpin", "foldBreathe", "foldDrift"]) {
      const s = SETTINGS.find((x) => x.key === key)!;
      expect(s.min, key).toBe(0);
      expect(s.max, key).toBe(1);
      expect(s.step, key).toBe(0.05);
    }
  });
});

// ---------------------------------------------------------------------------
// Sparkle group: the treble-driven electric/grain spark controls added on
// top of the plain glow boost (see fluid.ts's display-shader section).
// ---------------------------------------------------------------------------

describe("Sparkle settings", () => {
  const sparkleSettings = SETTINGS.filter((s) => s.key.startsWith("sparkle"));

  it("has at least the sparkle master plus its sub-params", () => {
    expect(sparkleSettings.length).toBeGreaterThan(1);
  });

  it("every sparkle* setting lives in the Sparkle group", () => {
    for (const s of sparkleSettings) expect(s.group, s.key).toBe("Sparkle");
  });

  it("enum sparkle settings have max === options.length - 1 and min 0 / step 1", () => {
    for (const s of sparkleSettings) {
      if (s.type !== "enum") continue;
      expect(s.options, s.key).toBeDefined();
      expect(s.max, s.key).toBe(s.options!.length - 1);
      expect(s.min, s.key).toBe(0);
      expect(s.step, s.key).toBe(1);
    }
  });

  it("sparkleStyle exposes its five style options (Lightning included, and the default) and sparkleTint its four tint options, both matching the display shader's int(u... + 0.5) branches", () => {
    const style = SETTINGS.find((s) => s.key === "sparkleStyle")!;
    const tint = SETTINGS.find((s) => s.key === "sparkleTint")!;
    expect(style.options).toEqual(["Glow", "Currents", "Grain", "Currents + Glow", "Lightning"]);
    expect(style.default).toBe(4);
    expect(tint.options).toEqual(["Negative", "Complement", "White", "Palette"]);
  });

  it("keeps the auto weight convention (|w| in [0.15, 0.5], sum under 0.8) for any sparkle* setting that opts into auto", () => {
    for (const s of sparkleSettings) {
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

  it("the sparkle master itself keeps its original auto weights, unchanged by the regroup", () => {
    const sparkle = SETTINGS.find((s) => s.key === "sparkle")!;
    expect(sparkle.auto).toEqual({ brightness: 0.35, attack: 0.15 });
  });

  it("currentDensity lives in Sparkle, manual (no auto)", () => {
    const s = SETTINGS.find((x) => x.key === "currentDensity")!;
    expect(s.group).toBe("Sparkle");
    expect(s.auto).toBeUndefined();
    expect(s.min).toBe(0);
    expect(s.max).toBe(1);
    expect(s.default).toBe(0.3);
  });
});

// ---------------------------------------------------------------------------
// Look group's neon saturation / white-hot cores tone-map controls (see
// fluid.ts's hue-preserving tone map in main()).
// ---------------------------------------------------------------------------

describe("Look group: neon / hotWhite", () => {
  it("neon lives in Look, manual (no auto)", () => {
    const s = SETTINGS.find((x) => x.key === "neon")!;
    expect(s.group).toBe("Look");
    expect(s.auto).toBeUndefined();
    expect(s.default).toBe(0.5);
  });

  it("hotWhite lives in Look and opts into auto with the loudness/dynamics weights", () => {
    const s = SETTINGS.find((x) => x.key === "hotWhite")!;
    expect(s.group).toBe("Look");
    expect(s.default).toBe(0.5);
    expect(s.auto).toEqual({ loudness: 0.25, dynamics: 0.15 });
  });
});

// ---------------------------------------------------------------------------
// Light group: music-reactive flashes layered on top of the line/halo (see
// fluid.ts's dropFlash/shockwave/buildGlow/beatFlash in main()).
// ---------------------------------------------------------------------------

describe("Light group settings", () => {
  const lightSettings = SETTINGS.filter((s) => s.group === "Light");
  const LIGHT_KEYS = ["dropFlash", "shockwave", "buildGlow", "beatFlash", "strobe"];

  it("has exactly the dropFlash/shockwave/buildGlow/beatFlash/strobe settings", () => {
    expect(lightSettings.map((s) => s.key).sort()).toEqual([...LIGHT_KEYS].sort());
  });

  it("every Light setting is 0..1 ranged; every one except strobe opts into auto with a valid weight convention (strobe is manual — see its own describe block)", () => {
    for (const s of lightSettings) {
      expect(s.min, s.key).toBe(0);
      expect(s.max, s.key).toBe(1);
      if (s.key === "strobe") {
        expect(s.auto, s.key).toBeUndefined();
        continue;
      }
      expect(s.auto, s.key).toBeDefined();
      let sum = 0;
      for (const [dial, w] of Object.entries(s.auto!)) {
        expect(Math.abs(w!), `${s.key}.auto.${dial}`).toBeGreaterThanOrEqual(0.15);
        expect(Math.abs(w!), `${s.key}.auto.${dial}`).toBeLessThanOrEqual(0.5);
        sum += Math.abs(w!);
      }
      expect(sum, `${s.key} sum of |auto weights|`).toBeLessThan(0.8);
    }
  });

  it("dropFlash reads anim.dropOnset and shockwave reads anim.lowOnset + anim.dropOnset", () => {
    const dropFlash = SETTINGS.find((s) => s.key === "dropFlash")!;
    const shockwave = SETTINGS.find((s) => s.key === "shockwave")!;
    expect(dropFlash.reads).toEqual(["anim.dropOnset"]);
    expect(shockwave.reads).toEqual(["anim.lowOnset", "anim.dropOnset"]);
  });

  it("buildGlow and beatFlash carry no reads claim beyond their auto weights", () => {
    const buildGlow = SETTINGS.find((s) => s.key === "buildGlow")!;
    const beatFlash = SETTINGS.find((s) => s.key === "beatFlash")!;
    expect(buildGlow.reads).toBeUndefined();
    expect(beatFlash.reads).toBeUndefined();
  });

  it("strobe is manual (no auto), claims no signal of its own (it rides the lightning strikes), and defaults to 0.35", () => {
    const strobe = SETTINGS.find((s) => s.key === "strobe")!;
    expect(strobe.auto).toBeUndefined();
    expect(strobe.reads).toBeUndefined();
    expect(strobe.default).toBe(0.35);
  });
});

// ---------------------------------------------------------------------------
// Shockwave pool (Light group's Bass shockwave) — see fluid.ts's
// createShockState/triggerShock/advanceShocks, same ring-pool idiom as
// caustics.ts's createRipplePool.
// ---------------------------------------------------------------------------

describe("Shockwave pool", () => {
  it("createShockState returns SHOCK_SLOTS-length arrays with every slot inactive (amp 0)", () => {
    const st = createShockState();
    expect(st.age.length).toBe(SHOCK_SLOTS);
    expect(st.amp.length).toBe(SHOCK_SLOTS);
    for (let i = 0; i < SHOCK_SLOTS; i++) expect(st.amp[i]).toBe(0);
  });

  it("triggerShock fills the oldest slot: on a fresh state, sequential triggers fill slots 0..SHOCK_SLOTS-1 in order, then wrap back to slot 0", () => {
    const st = createShockState();
    for (let i = 0; i < SHOCK_SLOTS; i++) {
      triggerShock(st, i + 1);
      expect(st.age[i]).toBe(0);
      expect(st.amp[i]).toBe(i + 1);
    }
    // Every slot now shares age 0 (a tie) — the oldest-slot search picks the
    // lowest index on a tie, so a further trigger reuses slot 0.
    triggerShock(st, 99);
    expect(st.amp[0]).toBe(99);
    expect(st.age[0]).toBe(0);
  });

  it("triggerShock never erases the youngest ring while an older one is available", () => {
    const st = createShockState();
    triggerShock(st, 1); // slot 0
    advanceShocks(st, 0.1);
    triggerShock(st, 2); // slot 1 (older than slot 0, which just aged 0.1s)
    // Slot 0 (the most recent trigger) must survive the next trigger, which
    // should land on one of the still-untouched (far older) slots instead.
    expect(st.amp[0]).toBe(1);
  });

  it("advanceShocks ages every slot by dtSec", () => {
    const st = createShockState();
    triggerShock(st, 1);
    advanceShocks(st, 0.25);
    advanceShocks(st, 0.25);
    expect(st.age[0]).toBeCloseTo(0.5, 6);
  });

  it("advanceShocks leaves amp untouched while age <= SHOCK_LIFE, and zeroes it once age exceeds SHOCK_LIFE", () => {
    const st = createShockState();
    triggerShock(st, 1.6);
    advanceShocks(st, SHOCK_LIFE - 0.01);
    // amp is a Float32Array — 1.6 isn't exactly representable, so compare
    // with tolerance rather than Object.is equality.
    expect(st.amp[0]).toBeCloseTo(1.6, 5);
    advanceShocks(st, 0.02); // pushes age just past SHOCK_LIFE
    expect(st.amp[0]).toBe(0);
  });

  it("never has more than SHOCK_SLOTS rings live at once (capacity-bound by construction)", () => {
    const st = createShockState();
    for (let i = 0; i < SHOCK_SLOTS * 3; i++) triggerShock(st, 1);
    const live = st.amp.filter((a) => a > 0).length;
    expect(live).toBeLessThanOrEqual(SHOCK_SLOTS);
  });
});

// ---------------------------------------------------------------------------
// Strobe (Light group's `strobe` setting) — see fluid.ts's
// createStrobeState/triggerStrobe/advanceStrobe/strobePhase, and the display
// shader's uStrobeT/uStrobeAmp block applied after the tone map.
// ---------------------------------------------------------------------------

describe("Strobe", () => {
  it("createStrobeState starts inactive (age past STROBE_DUR, amp 0)", () => {
    const st = createStrobeState();
    expect(st.age).toBeGreaterThan(STROBE_DUR);
    expect(st.amp).toBe(0);
  });

  it("triggerStrobe fires and resets age to 0 when clear of the refractory window", () => {
    const st = createStrobeState();
    expect(triggerStrobe(st, 0.8)).toBe(true);
    expect(st.age).toBe(0);
    expect(st.amp).toBe(0.8);
  });

  it("triggerStrobe respects the refractory window: a retrigger inside STROBE_MIN_GAP is dropped, and the state is left untouched", () => {
    const st = createStrobeState();
    triggerStrobe(st, 0.5);
    advanceStrobe(st, STROBE_MIN_GAP - 0.01);
    expect(triggerStrobe(st, 1.0)).toBe(false);
    // Neither age nor amp moved — the dropped trigger is a true no-op.
    expect(st.age).toBeCloseTo(STROBE_MIN_GAP - 0.01, 6);
    expect(st.amp).toBe(0.5);
  });

  it("triggerStrobe fires again once STROBE_MIN_GAP has elapsed", () => {
    const st = createStrobeState();
    triggerStrobe(st, 0.5);
    advanceStrobe(st, STROBE_MIN_GAP);
    expect(triggerStrobe(st, 1.0)).toBe(true);
    expect(st.age).toBe(0);
    expect(st.amp).toBe(1.0);
  });

  it("strobePhase is 0 the instant a flash fires and 1 once STROBE_DUR has elapsed (clamped, never overshooting)", () => {
    const st = createStrobeState();
    triggerStrobe(st, 1.0);
    expect(strobePhase(st)).toBe(0);
    advanceStrobe(st, STROBE_DUR);
    expect(strobePhase(st)).toBe(1);
    advanceStrobe(st, 10);
    expect(strobePhase(st)).toBe(1);
  });

  it("strobePhase rises monotonically between a fire and STROBE_DUR", () => {
    const st = createStrobeState();
    triggerStrobe(st, 1.0);
    let prev = -Infinity;
    const step = STROBE_DUR / 20;
    for (let i = 0; i < 20; i++) {
      advanceStrobe(st, step);
      const phase = strobePhase(st);
      expect(phase).toBeGreaterThanOrEqual(prev);
      prev = phase;
    }
    expect(prev).toBeCloseTo(1, 6);
  });
});
