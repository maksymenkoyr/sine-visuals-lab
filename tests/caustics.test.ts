import { describe, it, expect } from "vitest";
import {
  advanceKickJolt,
  advanceLurch,
  causticDensityScale,
  createLurchState,
  createRipplePool,
  driftRatePerSec,
  focusSharp,
  fogFloorCut,
  fogRestingSharp,
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
function base(overrides: Partial<DriftInputs> = {}): DriftInputs {
  return {
    drift: 0,
    driftKick: 0,
    driftLoud: 0,
    lowPulse: 0,
    energy: 0,
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
    expect(driftRatePerSec(base({ drift: 0, driftKick: 1, driftLoud: 1, lowPulse: 1, energy: 1, dropReactivity: 1, sectionIntensity: 1 }))).toBe(0);
  });

  it("a surge slider at 0 contributes nothing even with its driver maxed", () => {
    const withoutSurge = driftRatePerSec(base({ drift: 0.5 }));
    const driverMaxedSliderZero = driftRatePerSec(base({ drift: 0.5, lowPulse: 1, energy: 1 }));
    expect(driverMaxedSliderZero).toBeCloseTo(withoutSurge, 10);
  });

  it("Kick surge at 1 with a full low-band pulse adds its documented gain (2.0x)", () => {
    expect(driftRatePerSec(base({ drift: 0.5, driftKick: 1, lowPulse: 1 }))).toBeCloseTo(3.0, 10);
  });

  it("Loudness surge's default (0.4) at full energy reproduces the old hardcoded DRIFT_ENERGY_GAIN (0.6)", () => {
    // surge = 1 + 0.4 * 1 * 1.5 = 1.6; at drift=0.5 (base rate 1.0/sec), rate = 1.6.
    // This matches what the old scene did: rate = base * (1 + energy * 0.6).
    const rate = driftRatePerSec(base({ drift: 0.5, driftLoud: 0.4, energy: 1 }));
    expect(rate).toBeCloseTo(1.0 * (1 + 1 * 0.6), 10);
  });

  it("negative energy (before floor tracking settles) never reduces the rate below the unmodulated baseline", () => {
    const rate = driftRatePerSec(base({ drift: 0.5, driftLoud: 1, energy: -0.5 }));
    expect(rate).toBeCloseTo(1.0, 10); // Math.max(0, energy) clamps the negative contribution to 0
  });

  it("Drop reactivity boosts drift with sectionIntensity even with all surge sliders at 0", () => {
    // driftBoost = 1 + 1*1*0.8 = 1.8
    expect(driftRatePerSec(base({ drift: 0.5, dropReactivity: 1, sectionIntensity: 1 }))).toBeCloseTo(1.8, 10);
  });

  it("every remaining input maxed clamps to SURGE_CAP (5x the base rate) rather than compounding unbounded", () => {
    const rate = driftRatePerSec(
      base({
        drift: 1,
        driftKick: 1,
        driftLoud: 1,
        lowPulse: 1,
        energy: 1,
        dropReactivity: 1,
        sectionIntensity: 1,
      }),
    );
    // driftBoost = 1.8, surge = 1 + 2.0 + 1.5 = 4.5, driftBoost*surge = 8.1 > 5
    // DRIFT_BASE_RATE(2.0) * drift(1) * min(8.1, 5) = 10.0
    expect(rate).toBeCloseTo(10.0, 10);
    expect(Number.isFinite(rate)).toBe(true);
  });

  it("never produces NaN or a negative rate across a broad random sweep", () => {
    for (let i = 0; i < 500; i++) {
      const s: DriftInputs = {
        drift: Math.random(),
        driftKick: Math.random(),
        driftLoud: Math.random(),
        lowPulse: Math.random(),
        energy: Math.random() * 2 - 1, // occasionally negative
        dropReactivity: Math.random(),
        sectionIntensity: Math.random(),
      };
      const rate = driftRatePerSec(s);
      expect(Number.isFinite(rate)).toBe(true);
      expect(rate).toBeGreaterThanOrEqual(0);
    }
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

// The sparkle sub-params (see the Sparkle group in SETTINGS) replaced five
// constants that used to be hardcoded directly on FRAG's sparkle line. This
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

  it("grain's default (0.5) reproduces the old fixed noise scale of 38.0", () => {
    expect(sparkleGrainFreq(0.5)).toBeCloseTo(38.0, 10);
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
