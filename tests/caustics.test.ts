import { describe, it, expect } from "vitest";
import {
  advanceKickJolt,
  advanceLoudSwell,
  advanceLurch,
  causticDensityScale,
  createLoudSwellState,
  createLurchState,
  createRipplePool,
  driftRatePerSec,
  focusSharp,
  fogFloorCut,
  fogRestingSharp,
  loudSpeedFactor,
  loudSwellDrive,
  rippleEnvelope,
  sparkleBrightGain,
  sparkleDensityExponent,
  sparkleGrainFreq,
  sparkleSpreadRange,
  type DriftInputs,
} from "../src/render/scenes/caustics.ts";

// Baseline: everything off except the Drift speed slider itself. Beat surge
// is no longer part of DriftInputs — it's the separate advanceLurch impulse
// tested below, added onto uDriftPhase rather than modulating this rate.
// loudSwell defaults to 0.5 (neutral) — advanceLoudSwell's "no information
// yet" reading — so a bare `driftLoud` override doesn't silently mean
// "maximally loud" the way `energy: 1` used to.
function base(overrides: Partial<DriftInputs> = {}): DriftInputs {
  return {
    drift: 0,
    driftKick: 0,
    driftLoud: 0,
    lowPulse: 0,
    loudSwell: 0.5,
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

  it("drift=0 freezes the wander term, regardless of audio or reactivity", () => {
    expect(driftRatePerSec(base({ drift: 0, driftKick: 1, driftLoud: 1, lowPulse: 1, loudSwell: 1, dropReactivity: 1, sectionIntensity: 1 }))).toBe(0);
  });

  it("a surge slider at 0 contributes nothing even with its driver maxed", () => {
    const withoutSurge = driftRatePerSec(base({ drift: 0.5 }));
    const driverMaxedSliderZero = driftRatePerSec(base({ drift: 0.5, lowPulse: 1, loudSwell: 1 }));
    expect(driverMaxedSliderZero).toBeCloseTo(withoutSurge, 10);
  });

  it("Kick surge at 1 with a full low-band pulse adds its documented gain (2.0x)", () => {
    expect(driftRatePerSec(base({ drift: 0.5, driftKick: 1, lowPulse: 1 }))).toBeCloseTo(3.0, 10);
  });

  it("Drop reactivity boosts drift with sectionIntensity even with all surge sliders at 0", () => {
    // driftBoost = 1 + 1*1*0.8 = 1.8
    expect(driftRatePerSec(base({ drift: 0.5, dropReactivity: 1, sectionIntensity: 1 }))).toBeCloseTo(1.8, 10);
  });

  it("every remaining input maxed (loudSwell neutral) clamps to SURGE_CAP (5x the base rate), reproducing the pre-loudness-rework ceiling", () => {
    const rate = driftRatePerSec(
      base({
        drift: 1,
        driftKick: 1,
        driftLoud: 1,
        lowPulse: 1,
        loudSwell: 0.5,
        dropReactivity: 1,
        sectionIntensity: 1,
      }),
    );
    // driftBoost = 1.8, surge = 1 + 2.0 = 3.0, driftBoost*surge = 5.4 > 5
    // DRIFT_BASE_RATE(2.0) * drift(1) * min(5.4, 5) * loudSpeedFactor(1, 0.5)=1 -> 10.0
    expect(rate).toBeCloseTo(10.0, 10);
    expect(Number.isFinite(rate)).toBe(true);
  });

  it("every remaining input maxed including a fully loud passage clamps to DRIFT_RATE_MAX (20) rather than compounding unbounded", () => {
    const rate = driftRatePerSec(
      base({
        drift: 1,
        driftKick: 1,
        driftLoud: 1,
        lowPulse: 1,
        loudSwell: 1,
        dropReactivity: 1,
        sectionIntensity: 1,
      }),
    );
    // SURGE_CAP-bound modulation (5) * loudSpeedFactor(1,1) = 4^1.5 = 8 ->
    // DRIFT_BASE_RATE(2.0) * drift(1) * 5 * 8 = 80, clamped to DRIFT_RATE_MAX.
    expect(rate).toBeCloseTo(20.0, 10);
    expect(Number.isFinite(rate)).toBe(true);
  });

  it("never produces NaN or a negative rate across a broad random sweep", () => {
    for (let i = 0; i < 500; i++) {
      const s: DriftInputs = {
        drift: Math.random(),
        driftKick: Math.random(),
        driftLoud: Math.random(),
        lowPulse: Math.random(),
        loudSwell: Math.random(),
        dropReactivity: Math.random(),
        sectionIntensity: Math.random(),
      };
      const rate = driftRatePerSec(s);
      expect(Number.isFinite(rate)).toBe(true);
      expect(rate).toBeGreaterThanOrEqual(0);
    }
  });
});

// loudSpeedFactor is the actual fix: driftLoud used to only be able to gain
// ~1.5x against an already-flattened frame.energy, which is why cranking it
// never read as reactive. These pin the geometric-swing properties that make
// it reactive instead: an exact no-op at neutral loudness/at driftLoud=0, and
// a wide, monotone quiet<->loud range at driftLoud=1.
describe("caustics loudness speed swing (loudSpeedFactor)", () => {
  it("loudSwell=0.5 (neutral) is an exact identity at every driftLoud", () => {
    for (const driftLoud of [0, 0.25, 0.4, 0.7, 1]) {
      expect(loudSpeedFactor(driftLoud, 0.5)).toBeCloseTo(1, 10);
    }
  });

  it("driftLoud=0 ignores loudSwell entirely", () => {
    for (const loudSwell of [0, 0.3, 0.7, 1]) {
      expect(loudSpeedFactor(0, loudSwell)).toBeCloseTo(1, 10);
    }
  });

  it("the default (0.4) at a chorus-level loudSwell (0.8) stays close to today's old ~1.2x response, not a barely-perceptible nudge", () => {
    const factor = loudSpeedFactor(0.4, 0.8);
    expect(factor).toBeGreaterThan(1.1);
    expect(factor).toBeLessThan(1.4);
  });

  it("a maxed Loudness surge spans a dramatic quiet<->loud ratio (>=50x between loudSwell=0 and loudSwell=1)", () => {
    const quiet = loudSpeedFactor(1, 0);
    const loud = loudSpeedFactor(1, 1);
    expect(loud / quiet).toBeGreaterThanOrEqual(50);
  });

  it("is monotonically non-decreasing in loudSwell at every fixed driftLoud", () => {
    for (const driftLoud of [0.1, 0.4, 0.7, 1]) {
      let prev = loudSpeedFactor(driftLoud, 0);
      for (let s = 0.1; s <= 1; s += 0.1) {
        const f = loudSpeedFactor(driftLoud, s);
        expect(f).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = f;
      }
    }
  });

  it("never produces NaN, a negative, or a zero factor across a broad random sweep", () => {
    for (let i = 0; i < 500; i++) {
      const f = loudSpeedFactor(Math.random(), Math.random());
      expect(Number.isFinite(f)).toBe(true);
      expect(f).toBeGreaterThan(0);
    }
  });
});

// advanceLoudSwell is what makes loudSpeedFactor's driver gain-independent:
// it calibrates FeatureFrame.level against its own recently observed range
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
// someone actually drags Loudness surge up.
describe("caustics loudness swell drive (loudSwellDrive)", () => {
  it("is 0 at loudSwell=0.5 (neutral) for any driftLoud", () => {
    for (const driftLoud of [0, 0.4, 0.7, 1]) {
      expect(loudSwellDrive(driftLoud, 0.5)).toBeCloseTo(0, 10);
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

  it("stays small in magnitude at the Loudness surge default (0.4), even at a fully loud or fully quiet extreme", () => {
    expect(Math.abs(loudSwellDrive(0.4, 1))).toBeLessThan(0.2);
    expect(Math.abs(loudSwellDrive(0.4, 0))).toBeLessThan(0.2);
  });
});

describe("caustics beat lurch (advanceLurch)", () => {
  it("amount=0 never moves the phase, regardless of firing", () => {
    const st = createLurchState();
    for (let i = 0; i < 200; i++) advanceLurch(st, 1 / 60, i % 10 === 0, 0);
    expect(st.phase).toBe(0);
    expect(st.vel).toBe(0);
  });

  it("a single fire's total displacement converges to amount * LURCH_IMPULSE / LURCH_DECAY_PER_SEC", () => {
    // Integrating the velocity's exponential decay to convergence gives the
    // impulse's total area; run long enough (10 tau) that the tail is
    // negligible. LURCH_IMPULSE=14.4, LURCH_DECAY_PER_SEC=9 -> 1.6 at amount=1.
    // advanceLurch steps phase before decaying velocity (matching the scene's
    // own frame-by-frame order), so a finite dt systematically overshoots the
    // continuous integral by a small, dt-proportional amount — this asserts
    // within that discretization error, not exact convergence.
    const st = createLurchState();
    advanceLurch(st, 0, true, 1); // fire once, no phase advance yet
    const dt = 1 / 1000;
    for (let i = 0; i < 10000; i++) advanceLurch(st, dt, false, 0); // ~10 tau
    expect(st.phase).toBeCloseTo(1.6, 1);
  });

  it("phase is monotonically non-decreasing under repeated fires", () => {
    const st = createLurchState();
    let prevPhase = st.phase;
    for (let i = 0; i < 500; i++) {
      advanceLurch(st, 1 / 60, Math.random() < 0.3, Math.random());
      expect(st.phase).toBeGreaterThanOrEqual(prevPhase);
      prevPhase = st.phase;
    }
  });

  it("velocity never exceeds LURCH_VEL_CAP even under back-to-back fires with no decay time", () => {
    const st = createLurchState();
    for (let i = 0; i < 50; i++) advanceLurch(st, 0, true, 1); // fire repeatedly, dt=0 so no decay
    // LURCH_IMPULSE=14.4, cap = 14.4*1.5 = 21.6
    expect(st.vel).toBeCloseTo(21.6, 10);
  });

  it("a maxed Beat surge (amount=1) displaces far more than the old multiplicative design's maxed 0.33 phase units", () => {
    const st = createLurchState();
    advanceLurch(st, 0, true, 1);
    const dt = 1 / 1000;
    for (let i = 0; i < 10000; i++) advanceLurch(st, dt, false, 0);
    expect(st.phase).toBeGreaterThan(0.33 * 4); // >4x the old ceiling
  });
});

describe("caustics kick jolt", () => {
  // A rate-only surge can only ever integrate a kick's sharp attack into a
  // smooth ramp — see driftRatePerSec's own comment. These pin the position
  // offset that actually produces a strike: it must stay bounded, weighted
  // toward the top of the driftKick slider, and relax back to ~0 as
  // lowPulse decays, all without ever depending on Drift speed.

  it("is 0 when driftKick is 0, even with a full low-band pulse", () => {
    expect(advanceKickJolt(0, 0, 1, 1 / 60)).toBe(0);
  });

  it("is 0 when lowPulse is 0, even with driftKick maxed", () => {
    expect(advanceKickJolt(0, 1, 0, 1 / 60)).toBe(0);
  });

  it("converges toward, but never past, its bound (KICK_JOLT_PHASE = 2.0) when driven at max for a full second", () => {
    let jolt = 0;
    for (let i = 0; i < 600; i++) jolt = advanceKickJolt(jolt, 1, 1, 1 / 600);
    expect(jolt).toBeGreaterThan(1.9);
    expect(jolt).toBeLessThanOrEqual(2.0);
  });

  it("is weighted toward the top of the slider: driftKick=0.25 reaches only a small fraction of driftKick=1's steady state", () => {
    const settle = (driftKick: number) => {
      let jolt = 0;
      for (let i = 0; i < 600; i++) jolt = advanceKickJolt(jolt, driftKick, 1, 1 / 600);
      return jolt;
    };
    // driftKick^2 -> 0.25 reaches 1/16th of the max, not 1/4.
    expect(settle(0.25) / settle(1)).toBeCloseTo(0.0625, 2);
  });

  it("relaxes back to ~0 within 1s after lowPulse decays, matching a real kick's envelope", () => {
    let jolt = advanceKickJolt(0, 1, 1, 1 / 600); // struck once
    let lowPulse = 1;
    const dt = 1 / 600;
    for (let i = 0; i < 600; i++) {
      lowPulse *= Math.exp(-dt * 3.5); // bandEnergy.ts's low-group pulseDecayRate
      jolt = advanceKickJolt(jolt, 1, lowPulse, dt);
    }
    expect(jolt).toBeLessThan(0.1); // <5% of KICK_JOLT_PHASE (2.0) after 1s
  });

  it("does not depend on Drift speed — a kick still jolts the phase when drift is frozen at 0", () => {
    // advanceKickJolt has no drift parameter at all; this documents that
    // independence directly rather than leaving it implicit.
    expect(advanceKickJolt(0, 1, 1, 1 / 60)).toBeGreaterThan(0);
  });

  it("never produces NaN or a value outside [0, KICK_JOLT_PHASE] across a broad random sweep", () => {
    let jolt = 0;
    for (let i = 0; i < 500; i++) {
      jolt = advanceKickJolt(jolt, Math.random(), Math.random(), Math.random() * (1 / 30));
      expect(Number.isFinite(jolt)).toBe(true);
      expect(jolt).toBeGreaterThanOrEqual(0);
      expect(jolt).toBeLessThanOrEqual(2.0);
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

describe("caustics beat ripple pool", () => {
  /** Index of the slot with the largest value in a pool array. */
  const argmax = (a: Float32Array) => a.indexOf(Math.max(...a));

  it("a ring starts from nothing (a strike, not a fully formed lobe) and is still clearly visible at the far corner of the frame", () => {
    expect(rippleEnvelope(0)).toBe(0);
    // Peak arrives quickly, then fades.
    expect(rippleEnvelope(0.15)).toBeGreaterThan(0.8);
    expect(rippleEnvelope(1)).toBeLessThan(rippleEnvelope(0.15));
    // p-space radius ~3 is the far corner of a 16:9 frame at the scene's 3x
    // zoom; at RIPPLE_SPEED a ring gets there around 2.8s. "Circles on water
    // that go from the center to the end" means it must not have faded out
    // before then.
    expect(rippleEnvelope(2.8)).toBeGreaterThan(0.2);
  });

  it("later beats never touch a ring already travelling — its radius keeps growing while it holds its slot", () => {
    const pool = createRipplePool();
    pool.trigger();
    pool.tick(0.5);
    const slot = argmax(pool.radius);
    let prev = pool.radius[slot]!;
    expect(prev).toBeGreaterThan(0);
    // Fewer beats than there are slots, so this ring is never reclaimed.
    for (let beat = 0; beat < pool.radius.length - 1; beat++) {
      pool.trigger();
      pool.tick(0.5);
      expect(pool.radius[slot]).toBeGreaterThan(prev);
      prev = pool.radius[slot]!;
    }
  });

  it("when every slot is taken, the most-faded ring is the one reused, never the youngest", () => {
    const pool = createRipplePool();
    for (let i = 0; i < pool.radius.length; i++) {
      pool.trigger();
      pool.tick(0.5);
    }
    const oldest = argmax(pool.radius);
    const youngest = pool.radius.indexOf(Math.min(...pool.radius));
    const youngestR = pool.radius[youngest]!;
    pool.trigger();
    expect(pool.radius[oldest]).toBe(0);
    expect(pool.radius[youngest]).toBe(youngestR);
  });

  it("at a steady fast tempo, the ring a new beat reclaims has already left the frame and faded", () => {
    const pool = createRipplePool();
    const beatSec = 60 / 150; // 150 bpm, every beat rings
    for (let i = 0; i < pool.radius.length; i++) {
      pool.trigger();
      pool.tick(beatSec);
    }
    const oldest = argmax(pool.radius);
    expect(pool.radius[oldest]).toBeGreaterThan(3); // past the frame corner
    expect(pool.strength[oldest]).toBeLessThan(0.25);
  });

  it("a drop's ring carries its amplitude; untriggered slots contribute nothing", () => {
    const pool = createRipplePool();
    pool.trigger(1.8);
    pool.tick(0.2);
    const slot = argmax(pool.strength);
    expect(pool.strength[slot]).toBeCloseTo(1.8 * rippleEnvelope(0.2), 5);
    for (let i = 0; i < pool.strength.length; i++) if (i !== slot) expect(pool.strength[i]).toBe(0);
  });
});
