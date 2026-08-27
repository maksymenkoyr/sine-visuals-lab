import { describe, it, expect } from "vitest";
import { driftRatePerSec, type DriftInputs } from "../src/render/scenes/caustics.ts";

// Baseline: everything off except the Drift speed slider itself.
function base(overrides: Partial<DriftInputs> = {}): DriftInputs {
  return {
    drift: 0,
    driftBeat: 0,
    driftKick: 0,
    driftLoud: 0,
    beatPulse: 0,
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

  it("drift=0 is always frozen, regardless of audio or reactivity", () => {
    expect(driftRatePerSec(base({ drift: 0, driftBeat: 1, driftKick: 1, driftLoud: 1, beatPulse: 1, lowPulse: 1, energy: 1, dropReactivity: 1, sectionIntensity: 1 }))).toBe(0);
  });

  it("a surge slider at 0 contributes nothing even with its driver maxed", () => {
    const withoutSurge = driftRatePerSec(base({ drift: 0.5 }));
    const driverMaxedSliderZero = driftRatePerSec(base({ drift: 0.5, beatPulse: 1, lowPulse: 1, energy: 1 }));
    expect(driverMaxedSliderZero).toBeCloseTo(withoutSurge, 10);
  });

  it("Beat surge at 1 with a full beat pulse adds its documented gain (2.0x)", () => {
    // rate = base * drift * (driftBoost=1) * (1 + 1*1*2.0) = base * 0.5 * 3.0
    expect(driftRatePerSec(base({ drift: 0.5, driftBeat: 1, beatPulse: 1 }))).toBeCloseTo(3.0, 10);
  });

  it("Kick surge at 1 with a full low-band pulse adds its documented gain (2.0x), independent of beatPulse", () => {
    expect(driftRatePerSec(base({ drift: 0.5, driftKick: 1, lowPulse: 1, beatPulse: 0 }))).toBeCloseTo(3.0, 10);
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

  it("every input maxed clamps to SURGE_CAP (5x the base rate) rather than compounding unbounded", () => {
    const rate = driftRatePerSec(
      base({
        drift: 1,
        driftBeat: 1,
        driftKick: 1,
        driftLoud: 1,
        beatPulse: 1,
        lowPulse: 1,
        energy: 1,
        dropReactivity: 1,
        sectionIntensity: 1,
      }),
    );
    // DRIFT_BASE_RATE(2.0) * drift(1) * min(driftBoost*surge, 5) = 2.0 * 5 = 10.0
    expect(rate).toBeCloseTo(10.0, 10);
    expect(Number.isFinite(rate)).toBe(true);
  });

  it("never produces NaN or a negative rate across a broad random sweep", () => {
    for (let i = 0; i < 500; i++) {
      const s: DriftInputs = {
        drift: Math.random(),
        driftBeat: Math.random(),
        driftKick: Math.random(),
        driftLoud: Math.random(),
        beatPulse: Math.random(),
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
