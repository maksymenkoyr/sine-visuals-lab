import { describe, it, expect } from "vitest";
import {
  advanceEmission,
  buildProfile,
  createRippleEmissionState,
  createRippleEmitter,
  PROFILE_MAX_RADIUS,
  PROFILE_SAMPLES,
  rippleDecayFor,
  rippleEnvelope,
  rippleSpeedFor,
  rippleWidthFor,
  type RippleProfileParams,
} from "../src/render/scenes/rippleEmitter.ts";

// anim.beatPulse/lowPulse's own real shape (animClock.ts's BEAT_PULSE_DECAY_PER_SEC):
// a step to 1 in a single tick, then exponential decay at 6/sec.
const BEAT_PULSE_DECAY = 6;
const DT = 1 / 60;

/** Runs advanceEmission over a driver that sits at 0 (letting the smoothing
 *  settle there) and then jumps to 1 and decays like a real beat pulse,
 *  returning the total emitted. */
function simulateSingleHit(totalSec = 3): number {
  const state = createRippleEmissionState();
  // Settle the smoothing at 0 before the hit, same as a quiet passage.
  for (let i = 0; i < 10; i++) advanceEmission(state, DT, 0);
  let total = 0;
  for (let t = 0; t < totalSec; t += DT) {
    total += advanceEmission(state, DT, Math.exp(-BEAT_PULSE_DECAY * t));
  }
  return total;
}

describe("advanceEmission", () => {
  it("a clean hit (0->1 jump, beat-pulse decay) emits a total close to 1 — one old-style ring's worth", () => {
    const total = simulateSingleHit();
    expect(total).toBeGreaterThan(0.85);
    expect(total).toBeLessThan(1.05);
  });

  it("a constant signal emits nothing once settled", () => {
    const state = createRippleEmissionState();
    let total = 0;
    for (let i = 0; i < 300; i++) total += advanceEmission(state, DT, 0.6);
    expect(total).toBe(0);
  });

  it("a slow ramp (0->1 over 5s) emits close to nothing — too slow to clear the rise deadband", () => {
    const state = createRippleEmissionState();
    let total = 0;
    const rampSec = 5;
    for (let t = 0; t < rampSec; t += DT) {
      total += advanceEmission(state, DT, Math.min(1, t / rampSec));
    }
    expect(total).toBeLessThan(0.1);
  });

  it("a fast pulse train ducks itself: every hit after the first emits noticeably less than a lone hit", () => {
    const state = createRippleEmissionState();
    for (let i = 0; i < 20; i++) advanceEmission(state, DT, 0); // settle at 0
    const period = 0.15; // hits faster than the pulse's own ~1/6s decay area
    const totalSec = 2;
    const perPulse: number[] = [];
    let current = 0;
    let lastIdx = -1;
    for (let t = 0; t < totalSec; t += DT) {
      const idx = Math.floor(t / period);
      if (idx !== lastIdx) {
        if (lastIdx >= 0) perPulse.push(current);
        current = 0;
        lastIdx = idx;
      }
      current += advanceEmission(state, DT, Math.exp(-BEAT_PULSE_DECAY * (t % period)));
    }
    perPulse.push(current);

    const first = perPulse[0]!;
    const later = perPulse.slice(2, -1); // skip the first (settling from 0) and the last (partial window)
    expect(first).toBeGreaterThan(0.85); // reads like the lone-hit case above
    for (const p of later) {
      expect(p).toBeLessThan(first * 0.75); // meaningfully ducked, not merely a lone hit repeated
    }
  });

  it("never produces NaN or a negative amount across a broad random sweep, including dt=0", () => {
    const state = createRippleEmissionState();
    for (let i = 0; i < 500; i++) {
      const out = advanceEmission(state, Math.random() < 0.05 ? 0 : Math.random() / 30, Math.random());
      expect(Number.isFinite(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(0);
    }
  });
});

const TYPICAL_PARAMS: RippleProfileParams = {
  decayPerSec: rippleDecayFor(0.3), // Wave fade's own default
  speedUnitsPerSec: rippleSpeedFor(0.5), // Wave speed's own default
  widthGaussianW: rippleWidthFor(0.5), // Ring width's own default
};

describe("rippleEnvelope", () => {
  it("is 0 at or before age 0, and stays within [0, 1]", () => {
    expect(rippleEnvelope(0, 1)).toBe(0);
    expect(rippleEnvelope(-1, 1)).toBe(0);
    for (let age = 0.01; age < 10; age += 0.3) {
      const e = rippleEnvelope(age, 1);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
  });
});

describe("buildProfile", () => {
  it("a single full-strength entry produces one ring whose crest/slope peak sits near radius = speed * age", () => {
    const emitter = createRippleEmitter();
    emitter.emit(1);
    const ageSec = 1.2;
    emitter.tick(ageSec, TYPICAL_PARAMS);
    const crest = new Float32Array(PROFILE_SAMPLES);
    const slope = new Float32Array(PROFILE_SAMPLES);
    buildProfile(emitter, TYPICAL_PARAMS, crest, slope);

    const expectedRadius = ageSec * TYPICAL_PARAMS.speedUnitsPerSec;
    const dr = PROFILE_MAX_RADIUS / (PROFILE_SAMPLES - 1);

    let peakIdx = 0;
    for (let i = 1; i < PROFILE_SAMPLES; i++) if (crest[i]! > crest[peakIdx]!) peakIdx = i;
    const peakRadius = peakIdx * dr;
    expect(Math.abs(peakRadius - expectedRadius)).toBeLessThan(3 * dr);

    const expectedHeight = rippleEnvelope(ageSec, TYPICAL_PARAMS.decayPerSec);
    expect(crest[peakIdx]).toBeGreaterThan(expectedHeight * 0.95);
    expect(crest[peakIdx]).toBeLessThan(expectedHeight * 1.15); // the mirrored term adds a little near a young ring

    // The slope's own peak (just inside the crest) should be close to the
    // same envelope height — the old pool's own normalization made a lone
    // full-strength ring's peak slope exactly 1 at full envelope strength.
    let slopePeakAbs = 0;
    for (let i = 0; i < PROFILE_SAMPLES; i++) slopePeakAbs = Math.max(slopePeakAbs, Math.abs(slope[i]!));
    expect(slopePeakAbs).toBeGreaterThan(expectedHeight * 0.9);
    expect(slopePeakAbs).toBeLessThan(expectedHeight * 1.1);
  });

  it("the slope is exactly zero at r=0, for a fresh ring, an old one, or several overlapping ones", () => {
    const cases = [0, 0.05, 0.5, 3, 10];
    for (const age of cases) {
      const emitter = createRippleEmitter();
      emitter.emit(1);
      emitter.emit(0.6); // a second, coincident entry (merges — still one entry at age 0)
      emitter.tick(age, TYPICAL_PARAMS);
      emitter.emit(0.3); // a fresh entry riding alongside the aged one(s)
      const crest = new Float32Array(PROFILE_SAMPLES);
      const slope = new Float32Array(PROFILE_SAMPLES);
      buildProfile(emitter, TYPICAL_PARAMS, crest, slope);
      expect(Math.abs(slope[0]!)).toBeLessThan(1e-6);
    }
  });

  it("stays bounded under a fast pulse train instead of accumulating without limit", () => {
    const emitter = createRippleEmitter();
    const crest = new Float32Array(PROFILE_SAMPLES);
    const slope = new Float32Array(PROFILE_SAMPLES);
    const emission = createRippleEmissionState();
    for (let i = 0; i < 20; i++) advanceEmission(emission, DT, 0); // settle
    let maxCrest = 0;
    for (let t = 0; t < 5; t += DT) {
      emitter.tick(DT, TYPICAL_PARAMS);
      const signal = Math.exp(-BEAT_PULSE_DECAY * (t % 0.15));
      emitter.emit(advanceEmission(emission, DT, signal));
      buildProfile(emitter, TYPICAL_PARAMS, crest, slope);
      for (let i = 0; i < PROFILE_SAMPLES; i++) maxCrest = Math.max(maxCrest, crest[i]!);
    }
    expect(Number.isFinite(maxCrest)).toBe(true);
    expect(maxCrest).toBeLessThan(5); // well under a runaway sum; a lone ring peaks at ~1
    expect(emitter.count).toBeLessThan(512);
  });
});

describe("createRippleEmitter", () => {
  it("never exceeds maxEntries, dropping the oldest entry to make room", () => {
    const params: RippleProfileParams = { decayPerSec: 0, speedUnitsPerSec: 0, widthGaussianW: TYPICAL_PARAMS.widthGaussianW };
    const emitter = createRippleEmitter(4);
    for (let i = 0; i < 10; i++) {
      emitter.tick(0.01, params); // age past "still age 0 this frame" so the next emit doesn't merge
      emitter.emit(1);
      expect(emitter.count).toBeLessThanOrEqual(4);
    }
    expect(emitter.count).toBe(4);
  });

  it("merges an emit into the newest entry if it is still age 0 this frame", () => {
    const emitter = createRippleEmitter();
    emitter.emit(1);
    emitter.emit(0.5); // same frame — no tick() in between
    expect(emitter.count).toBe(1);
    expect(emitter.amp[0]).toBeCloseTo(1.5, 6);
  });

  it("drops an entry once its own envelope has faded below the visibility floor", () => {
    const params: RippleProfileParams = { decayPerSec: 2, speedUnitsPerSec: 0, widthGaussianW: TYPICAL_PARAMS.widthGaussianW };
    const emitter = createRippleEmitter();
    emitter.tick(0, params);
    emitter.emit(1);
    expect(emitter.count).toBe(1);
    emitter.tick(10, params);
    expect(emitter.count).toBe(0);
  });

  it("drops an entry once its ring has travelled past the profile's own edge, even with no decay", () => {
    const params: RippleProfileParams = { decayPerSec: 0, speedUnitsPerSec: 100, widthGaussianW: TYPICAL_PARAMS.widthGaussianW };
    const emitter = createRippleEmitter();
    emitter.tick(0, params);
    emitter.emit(1);
    emitter.tick(1, params); // radius = 100, far past PROFILE_MAX_RADIUS
    expect(emitter.count).toBe(0);
  });

  it("ignores an amount below the emit floor", () => {
    const emitter = createRippleEmitter();
    emitter.emit(1e-6);
    expect(emitter.count).toBe(0);
  });
});

describe("settings mappings reproduce the old ring pool's fixed constants near their defaults", () => {
  it("rippleSpeedFor(0.5) is close to the old ring pool's RIPPLE_SPEED (1.1)", () => {
    expect(Math.abs(rippleSpeedFor(0.5) - 1.1)).toBeLessThan(0.1);
  });

  it("rippleDecayFor(0.3), Wave fade's own default, is close to the old RIPPLE_DECAY_PER_SEC (0.45)", () => {
    expect(Math.abs(rippleDecayFor(0.3) - 0.45)).toBeLessThan(0.05);
  });

  it("rippleWidthFor(0.5) is close to the old RIPPLE_WIDTH (4.0)", () => {
    expect(Math.abs(rippleWidthFor(0.5) - 4.0)).toBeLessThan(0.3);
  });

  it("all three are monotone across 0..1 (rippleWidthFor decreasing, the other two increasing)", () => {
    let prevSpeed = rippleSpeedFor(0);
    let prevDecay = rippleDecayFor(0);
    let prevWidth = rippleWidthFor(0);
    for (let x = 0.1; x <= 1; x += 0.1) {
      const speed = rippleSpeedFor(x);
      const decay = rippleDecayFor(x);
      const width = rippleWidthFor(x);
      expect(speed).toBeGreaterThan(prevSpeed);
      expect(decay).toBeGreaterThan(prevDecay);
      expect(width).toBeLessThan(prevWidth);
      prevSpeed = speed;
      prevDecay = decay;
      prevWidth = width;
    }
  });
});
