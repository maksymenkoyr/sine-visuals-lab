import { describe, it, expect } from "vitest";
import {
  advanceLoudSwell,
  advancePump,
  causticDensityScale,
  createLoudSwellState,
  createPumpState,
  driftFlows,
  driftRatePerSec,
  focusSharp,
  fogFloorCut,
  fogRestingSharp,
  loudSwellDrive,
  sparkleBrightGain,
  sparkleDensityExponent,
  sparkleGrainFreq,
  sparkleSpreadRange,
  type DriftInputs,
} from "../src/render/scenes/caustics.ts";
import { NOISE_PERIOD, wrapFlow } from "../src/render/noiseHash.ts";

// Baseline: everything off. driftLevel and pumpVel are additive terms (see
// driftRatePerSec's own comment) rather than multipliers pivoting around a
// neutral point, so — unlike the old loudSwell=0.5 "neutral" default this
// replaced — 0 is the right "nothing happening" default for levelValue too.
function base(overrides: Partial<DriftInputs> = {}): DriftInputs {
  return {
    drift: 0,
    driftLevel: 0,
    levelValue: 0,
    pumpVel: 0,
    dropReactivity: 0,
    sectionIntensity: 0,
    ...overrides,
  };
}

describe("caustics drift rate", () => {
  it("drift=0.5 with silence and no reactivity reproduces the scene's original speed (1.0/sec, matching flowClock's base rate)", () => {
    // This is the regression test: the old DRIFT_BASE_RATE (0.15) doubled up
    // with a 0.15 already baked into the shader's flow term, so the old
    // default (drift=1) actually ran at ~0.15/sec — 6.7x too slow. At the
    // fixed rate, half of the 0-1 slider (0.5) should land exactly on 1.0.
    expect(driftRatePerSec(base({ drift: 0.5 }))).toBeCloseTo(1.0, 10);
  });

  it("drift=1 with silence and no reactivity is exactly double the original speed", () => {
    expect(driftRatePerSec(base({ drift: 1 }))).toBeCloseTo(2.0, 10);
  });

  it("drift=0 freezes the base wander term, regardless of drop reactivity", () => {
    // Speed boost and Speed pump are additive terms, not multipliers on the base
    // (see the two tests right below), so this only pins the *base* term's
    // own dependence on drift — with driftLevel/pumpVel left at 0 too, the
    // whole rate is 0.
    expect(driftRatePerSec(base({ drift: 0, dropReactivity: 1, sectionIntensity: 1 }))).toBe(0);
  });

  it("Speed boost and Speed pump both still move the rate with Drift speed parked at 0 — the whole point of being additive rather than multiplicative", () => {
    expect(driftRatePerSec(base({ drift: 0, driftLevel: 1, levelValue: 1, pumpVel: 2 }))).toBeCloseTo(3.0 + 2, 10);
  });

  it("Speed boost at 0 contributes nothing even with levelValue maxed", () => {
    const withoutBoost = driftRatePerSec(base({ drift: 0.5 }));
    const boostZeroLevelMaxed = driftRatePerSec(base({ drift: 0.5, levelValue: 1 }));
    expect(boostZeroLevelMaxed).toBeCloseTo(withoutBoost, 10);
  });

  it("Speed boost adds LEVEL_GAIN (3.0) at driftLevel=1 with levelValue=1, and nothing at levelValue=0", () => {
    expect(driftRatePerSec(base({ drift: 0, driftLevel: 1, levelValue: 1 }))).toBeCloseTo(3.0, 10);
    expect(driftRatePerSec(base({ drift: 0, driftLevel: 1, levelValue: 0 }))).toBe(0);
  });

  it("Drop reactivity boosts drift with sectionIntensity even with Speed boost/Speed pump at 0", () => {
    // base = DRIFT_BASE_RATE(2) * drift(0.5) * (1 + 1*1*0.8) = 1.8
    expect(driftRatePerSec(base({ drift: 0.5, dropReactivity: 1, sectionIntensity: 1 }))).toBeCloseTo(1.8, 10);
  });

  it("every term maxed at once (base 3.6, level 3, pump capped at PUMP_VEL_CAP=8) sums to 14.6 — comfortably under DRIFT_RATE_MAX, which is now a generous backstop rather than a value the additive design tries to reach", () => {
    const rate = driftRatePerSec(
      base({
        drift: 1,
        driftLevel: 1,
        levelValue: 1,
        pumpVel: 8,
        dropReactivity: 1,
        sectionIntensity: 1,
      }),
    );
    expect(rate).toBeCloseTo(14.6, 10);
  });

  it("still clamps to DRIFT_RATE_MAX (20) if pumpVel is ever larger than advancePump's own cap would allow", () => {
    const rate = driftRatePerSec(
      base({
        drift: 1,
        driftLevel: 1,
        levelValue: 1,
        pumpVel: 1000,
        dropReactivity: 1,
        sectionIntensity: 1,
      }),
    );
    expect(rate).toBe(20);
  });

  it("never produces NaN or a negative rate across a broad random sweep", () => {
    for (let i = 0; i < 500; i++) {
      const s: DriftInputs = {
        drift: Math.random(),
        driftLevel: Math.random(),
        levelValue: Math.random(),
        pumpVel: Math.random() * 10,
        dropReactivity: Math.random(),
        sectionIntensity: Math.random(),
      };
      const rate = driftRatePerSec(s);
      expect(Number.isFinite(rate)).toBe(true);
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(20);
    }
  });
});

// advanceLoudSwell is what makes Speed boost's driver gain-independent: it
// calibrates FeatureFrame.level against its own recently observed range
// rather than reading it absolutely, so the dial behaves the same on a quiet
// room and a loud one. The gain-invariance property below is the one that
// makes a legacy wire sender (protocol.ts defaults level to 0.5) and silence
// degrade safely to neutral instead of pinning loud or quiet.
describe("caustics loudness calibration (advanceLoudSwell)", () => {
  const settle = (level: number, ticks = 3000, dt = 1 / 60): number => {
    const st = createLoudSwellState();
    let out = 0.5;
    for (let i = 0; i < ticks; i++) out = advanceLoudSwell(st, dt, level);
    return out;
  };

  it("any constant level settles at neutral (0.5), regardless of its absolute value", () => {
    for (const level of [0, 0.1, 0.5, 0.85, 1]) {
      expect(settle(level)).toBeCloseTo(0.5, 1);
    }
  });

  it("a square wave alternating between two levels converges toward the extremes (0 at the low value, 1 at the high one)", () => {
    const st = createLoudSwellState();
    const dt = 1 / 60;
    let out = 0.5;
    for (let cycle = 0; cycle < 200; cycle++) {
      const level = cycle % 2 === 0 ? 0.1 : 0.9;
      for (let i = 0; i < 30; i++) out = advanceLoudSwell(st, dt, level);
    }
    // Last half-cycle was the high value (0.9) — should read as loud.
    expect(out).toBeGreaterThan(0.7);
  });

  it("a long quiet passage following a loud one stays low, not drifting back toward neutral within a few seconds — the property distinguishing this from sectionIntensity.ts's faster phrase-length contraction", () => {
    const st = createLoudSwellState();
    const dt = 1 / 60;
    // Calibrate against real dynamics: alternate loud/quiet for a while.
    for (let cycle = 0; cycle < 100; cycle++) {
      const level = cycle % 2 === 0 ? 0.15 : 0.9;
      for (let i = 0; i < 30; i++) advanceLoudSwell(st, dt, level);
    }
    // Now a sustained quiet passage — well under sectionIntensity's ~12s
    // ceiling-relax time constant, to show this hasn't already forgotten.
    let out = 0.5;
    for (let i = 0; i < 10 * 60; i++) out = advanceLoudSwell(st, dt, 0.15);
    expect(out).toBeLessThan(0.3);
  });

  it("stays within [0,1] and finite for any level in [0,1] and any non-negative dt, including dt=0", () => {
    const st = createLoudSwellState();
    for (let i = 0; i < 1000; i++) {
      const out = advanceLoudSwell(st, Math.random() < 0.05 ? 0 : Math.random() / 30, Math.random());
      expect(Number.isFinite(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(1);
    }
  });

  it("clamps out-of-range level input instead of propagating it", () => {
    const st = createLoudSwellState();
    expect(Number.isFinite(advanceLoudSwell(st, 1 / 60, -0.5))).toBe(true);
    expect(Number.isFinite(advanceLoudSwell(st, 1 / 60, 1.5))).toBe(true);
  });

  it("the first call seeds calibration from that sample and returns neutral, rather than reporting a false full range", () => {
    const st = createLoudSwellState();
    expect(advanceLoudSwell(st, 1 / 60, 0.9)).toBeCloseTo(0.5, 10);
  });
});

// loudSwellDrive is uLoudSwell's source — the shader's aperture/floor-glow
// channel. Small at the slider's default so that channel stays a no-op until
// someone actually drags Speed boost up.
describe("caustics loudness swell drive (loudSwellDrive)", () => {
  it("is 0 at loudSwell=0.5 (neutral) for any driftLevel", () => {
    for (const driftLevel of [0, 0.4, 0.7, 1]) {
      expect(loudSwellDrive(driftLevel, 0.5)).toBeCloseTo(0, 10);
    }
  });

  it("stays within [-1, 1] across a broad random sweep", () => {
    for (let i = 0; i < 500; i++) {
      const d = loudSwellDrive(Math.random(), Math.random());
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(-1);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it("stays small in magnitude at the Speed boost default (0.4), even at a fully loud or fully quiet extreme", () => {
    expect(Math.abs(loudSwellDrive(0.4, 1))).toBeLessThan(0.2);
    expect(Math.abs(loudSwellDrive(0.4, 0))).toBeLessThan(0.2);
  });
});

// advancePump is the "push acceleration in a car" half of the user's own
// request: each push accelerates a velocity that then coasts back down to
// whatever Drift/Speed boost are already contributing, rather than tracking
// its input directly the way Speed boost does.
describe("caustics pump (advancePump)", () => {
  it("amount=0 never accelerates vel, regardless of input", () => {
    const st = createPumpState();
    for (let i = 0; i < 200; i++) advancePump(st, 1 / 60, Math.random(), 0);
    expect(st.vel).toBe(0);
  });

  it("one hit's whole decaying envelope at amount=1 raises vel to a peak well short of PUMP_ACCEL/BEAT_PULSE_DECAY_PER_SEC's naive 1.0 estimate — the release term (PUMP_RELEASE_SEC) is already draining vel during the rise, not just after it", () => {
    // A back-of-envelope sizing (PUMP_ACCEL / BEAT_PULSE_DECAY_PER_SEC = 1.0,
    // the file's own DRIFT_RATE_MAX-area comment) ignores that release keeps
    // acting throughout the rise, not only once the hit has passed — solving
    // the exact ODE (v' + v/PUMP_RELEASE_SEC = PUMP_ACCEL*e^-6t) puts the true
    // peak at about 0.76, which this pins directly against the real
    // discretized function rather than the approximation.
    const st = createPumpState();
    const dt = 1 / 60;
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      const t = i * dt;
      advancePump(st, dt, Math.exp(-6 * t), 1); // BEAT_PULSE_DECAY_PER_SEC's own decay shape (animClock.ts)
      if (st.vel > peak) peak = st.vel;
    }
    expect(peak).toBeGreaterThan(0.7);
    expect(peak).toBeLessThan(0.9);
  });

  it("once the input stops, vel decays to under 10% of its peak within about 3.5s (PUMP_RELEASE_SEC's own tau)", () => {
    const st = createPumpState();
    const dt = 1 / 60;
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      const t = i * dt;
      advancePump(st, dt, Math.exp(-6 * t), 1);
      if (st.vel > peak) peak = st.vel;
    }
    for (let i = 0; i < 3.5 * 60; i++) advancePump(st, dt, 0, 1);
    expect(st.vel).toBeLessThan(peak * 0.1);
  });

  it("a constant full-height input settles at PUMP_VEL_CAP (8) rather than climbing without bound", () => {
    const st = createPumpState();
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 10; i++) advancePump(st, dt, 1, 1); // 10s, well past settling
    expect(st.vel).toBeCloseTo(8, 5);
  });

  it("is monotonically non-decreasing in amount at a fixed sustained input", () => {
    const dt = 1 / 60;
    let prevVel = -Infinity;
    for (let amount = 0; amount <= 1; amount += 0.1) {
      const st = createPumpState();
      for (let i = 0; i < 60; i++) advancePump(st, dt, 1, amount);
      expect(st.vel).toBeGreaterThanOrEqual(prevVel - 1e-9);
      prevVel = st.vel;
    }
  });

  it("never produces NaN or a value outside [0, PUMP_VEL_CAP] across a broad random sweep", () => {
    const st = createPumpState();
    for (let i = 0; i < 500; i++) {
      advancePump(st, Math.random() * (1 / 30), Math.random(), Math.random());
      expect(Number.isFinite(st.vel)).toBe(true);
      expect(st.vel).toBeGreaterThanOrEqual(0);
      expect(st.vel).toBeLessThanOrEqual(8);
    }
  });
});

// The sparkle sub-params (see the sparkleBright..sparkleSustain entries in
// SETTINGS) replaced five constants that used to be hardcoded directly on
// FRAG's sparkle line. This
// is what makes that change a visual no-op: every sub-param's own default
// (0.5, or 0 for sustain) must map to the exact old constant it replaced, so
// nothing changes on screen until someone actually drags a slider.
describe("caustics sparkle sub-param mapping", () => {
  it("density's default (0.5) reproduces the old fixed pow() exponent of 8.0", () => {
    expect(sparkleDensityExponent(0.5)).toBeCloseTo(8.0, 10);
  });

  it("density's extremes span the old exponent's sparse/dense range", () => {
    expect(sparkleDensityExponent(0)).toBeCloseTo(13.0, 10);
    expect(sparkleDensityExponent(1)).toBeCloseTo(3.0, 10);
  });

  it("grain's default (0.5) lands at 53.0 — the finest end (SPARKLE_GRAIN_FREQ_LO) was raised from the old fixed 60.0 to 90.0 so the dial can reach finer glints, which moves the default off the old 38.0 too", () => {
    expect(sparkleGrainFreq(0.5)).toBeCloseTo(53.0, 10);
  });

  it("grain's extremes span the widened finest/coarsest range", () => {
    expect(sparkleGrainFreq(0)).toBeCloseTo(90.0, 10);
    expect(sparkleGrainFreq(1)).toBeCloseTo(16.0, 10);
  });

  it("spread's default (0.5) reproduces the old fixed crest-gate smoothstep(0.15, 0.6, acc)", () => {
    const { lo, hi } = sparkleSpreadRange(0.5);
    expect(lo).toBeCloseTo(0.15, 10);
    expect(hi).toBeCloseTo(0.6, 10);
  });

  it("spread's edges stay ordered (lo < hi) across its whole range", () => {
    for (let s = 0; s <= 1; s += 0.1) {
      const { lo, hi } = sparkleSpreadRange(s);
      expect(lo).toBeLessThan(hi);
    }
  });

  it("brightness's default (0.5) reproduces the old fixed 1.5x gain", () => {
    expect(sparkleBrightGain(0.5)).toBeCloseTo(1.5, 10);
  });

  it("brightness spans 0 (hard off) to 3.0 (double the old gain) across its range", () => {
    expect(sparkleBrightGain(0)).toBeCloseTo(0, 10);
    expect(sparkleBrightGain(1)).toBeCloseTo(3.0, 10);
  });
});

// focusSharp is the single function this scene's git history keeps breaking
// one invariant of at a time (see the FOCUS_SNAP_RATIO comment): a fixed
// ceiling that made every focus setting snap to the same peak (so the
// slider stopped moving the actual snap), or a floor that scaled together
// with the peak (so the slider read as "merely thinner lines", not more
// snap). These pin all three properties simultaneously.
describe("caustics focus snap / fog", () => {
  it("uFocus = 0 means no snap at all, at any beatPulse", () => {
    for (const fog of [0, 0.4, 1]) {
      const rest = focusSharp(fog, 0, 0);
      for (const beatPulse of [0.3, 0.7, 1]) {
        expect(focusSharp(fog, 0, beatPulse)).toBeCloseTo(rest, 10);
      }
    }
  });

  it("the resting look (beatPulse = 0) never depends on uFocus", () => {
    for (const fog of [0, 0.4, 1]) {
      const rest = focusSharp(fog, 0, 0);
      for (const focus of [0.25, 0.5, 0.75, 1]) {
        expect(focusSharp(fog, focus, 0)).toBeCloseTo(rest, 10);
      }
    }
  });

  it("sharp is non-decreasing in uFocus at any fixed fog/beatPulse (the historical inversion regression)", () => {
    for (const fog of [0, 0.4, 0.7, 1]) {
      for (const beatPulse of [0, 0.3, 0.7, 1]) {
        let prev = focusSharp(fog, 0, beatPulse);
        for (let focus = 0.1; focus <= 1; focus += 0.1) {
          const s = focusSharp(fog, focus, beatPulse);
          expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
          prev = s;
        }
      }
    }
  });

  it("stays filamentary at the defaults, matching the scene's original swing (~2x, never collapsing to pure fog)", () => {
    const rest = focusSharp(0.4, 0.7, 0);
    const peak = focusSharp(0.4, 0.7, 1);
    expect(rest).toBeGreaterThan(8);
    expect(peak / rest).toBeCloseTo(1.91, 1);
  });

  it("never exceeds FOCUS_SHARP_MAX (the anti pixel-ladder ceiling) regardless of inputs", () => {
    for (let i = 0; i < 200; i++) {
      const s = focusSharp(Math.random(), Math.random(), Math.random());
      expect(s).toBeLessThanOrEqual(18 + 1e-9);
    }
  });

  it("fog's default (0.4) reproduces the scene's old fixed resting floor/cut closely", () => {
    expect(fogRestingSharp(0.4)).toBeCloseTo(9.2, 5);
    expect(fogFloorCut(0.4)).toBeCloseTo(0.08, 1);
  });

  it("fog reaches past what focus alone could ever produce at rest, and past today's floor cut", () => {
    expect(fogRestingSharp(1)).toBeLessThan(4);
    expect(fogFloorCut(1)).toBe(0);
  });
});

describe("caustics caustic density", () => {
  it("the default (0.5) reproduces the old fixed noise-sampling frequency exactly (scale = 1)", () => {
    expect(causticDensityScale(0.5)).toBeCloseTo(1, 10);
  });

  it("the endpoints span roughly a moderate 0.43x..2.3x range, monotone across it", () => {
    expect(causticDensityScale(0)).toBeCloseTo(0.435, 2);
    expect(causticDensityScale(1)).toBeCloseTo(2.297, 2);
    let prev = causticDensityScale(0);
    for (let d = 0.1; d <= 1; d += 0.1) {
      const s = causticDensityScale(d);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
  });
});

describe("driftFlows keeps every shader-side offset bounded (mobile precision seams)", () => {
  // Regression guard for the tiled/dashed rendering on phones: the raw drift
  // phase used to reach the shader and be multiplied into every noise
  // coordinate, so the hash's inputs grew without bound. Now each offset is
  // reduced into [0, NOISE_PERIOD) in float64 before upload, and the shader's
  // integer hash is periodic in exactly that period, so the wrap is
  // invisible and the GPU never sees a large float.
  const HUGE_PHASE = 1e9; // hours at the drift-rate cap, and then some

  it("stays in [0, NOISE_PERIOD) for every entry, at any phase", () => {
    for (const phase of [0, 1, 123.456, -50, 1e4, HUGE_PHASE, -HUGE_PHASE]) {
      for (const dens of [causticDensityScale(0), causticDensityScale(0.5), causticDensityScale(1)]) {
        const flows = driftFlows(phase, dens);
        expect(flows.length).toBeGreaterThan(0);
        for (const v of flows) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(NOISE_PERIOD);
        }
      }
    }
  });

  it("is congruent to the unwrapped offset — a wrap is a whole number of periods", () => {
    // Forward warp x/y entries are phase * FLOW_X / FLOW_Y * densScale; check
    // them against an independently computed modulo at a phase where fp32
    // would have long since lost sub-cell resolution.
    const flows = driftFlows(HUGE_PHASE, 1);
    const fx = HUGE_PHASE * 0.15;
    const fy = -HUGE_PHASE * 0.09;
    const mod = (x: number) => ((x % NOISE_PERIOD) + NOISE_PERIOD) % NOISE_PERIOD;
    expect(flows[0]).toBeCloseTo(mod(fx), 3);
    expect(flows[1]).toBeCloseTo(mod(fy), 3);
    // Backward warp is the negated flow, wrapped — never just -flow.
    expect(flows[2]).toBeCloseTo(mod(-fx), 3);
    expect(flows[3]).toBeCloseTo(mod(-fy), 3);
  });

  it("advances continuously across a wrap, so the field never jumps", () => {
    // Step the phase by a small delta straddling a wrap boundary of the
    // forward-x entry: the wrapped value must move by exactly delta * FLOW_X
    // modulo the period, i.e. either +delta*0.15 or that minus the period.
    const period = NOISE_PERIOD / 0.15; // phase units per wrap of flows[0]
    const delta = 0.01;
    const before = driftFlows(period * 3 - delta / 2, 1)[0];
    const after = driftFlows(period * 3 + delta / 2, 1)[0];
    const step = wrapFlow(after - before);
    // Tolerance: the upload buffer is a Float32Array, so a value just under
    // the period carries fp32 rounding — still orders of magnitude below a
    // pixel's worth of noise coordinate, which is the whole point.
    expect(step).toBeCloseTo(delta * 0.15, 4);
  });

  it("reuses the caller's buffer, so the per-frame upload allocates nothing", () => {
    const buf = driftFlows(1, 1);
    expect(driftFlows(2, 1, buf)).toBe(buf);
  });
});
