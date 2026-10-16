import { describe, it, expect } from "vitest";
import {
  buildProfile,
  createRippleEmitter,
  createRingRateState,
  advanceRingRate,
  autoNarrowWidthW,
  PROFILE_MAX_RADIUS,
  PROFILE_SAMPLES,
  rippleDecayFor,
  rippleEnvelope,
  rippleSpeedFor,
  rippleWidthFor,
  ringStyleFor,
  type RingStyle,
  type RippleProfileParams,
} from "../src/render/scenes/rippleEmitter.ts";
import { advanceStandoutAmount, createStandoutState } from "../src/render/standout.ts";

// anim.beatPulse/lowPulse's own real shape (animClock.ts's BEAT_PULSE_DECAY_PER_SEC):
// a step to 1 in a single tick, then exponential decay at 6/sec.
const BEAT_PULSE_DECAY = 6;
const DT = 1 / 60;

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
    const emission = createStandoutState();
    for (let i = 0; i < 20; i++) advanceStandoutAmount(emission, DT, 0); // settle
    let maxCrest = 0;
    for (let t = 0; t < 5; t += DT) {
      emitter.tick(DT, TYPICAL_PARAMS);
      const signal = Math.exp(-BEAT_PULSE_DECAY * (t % 0.15));
      emitter.emit(advanceStandoutAmount(emission, DT, signal));
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

describe("ringStyleFor", () => {
  it("maps 0/1/2 to bump/wave/merge, and clamps/rounds anything else", () => {
    expect(ringStyleFor(0)).toBe("bump");
    expect(ringStyleFor(1)).toBe("wave");
    expect(ringStyleFor(2)).toBe("merge");
    expect(ringStyleFor(0.4)).toBe("bump"); // rounds down
    expect(ringStyleFor(1.6)).toBe("merge"); // rounds up
    expect(ringStyleFor(-5)).toBe("bump"); // clamps low
    expect(ringStyleFor(50)).toBe("merge"); // clamps high
  });
});

function peakAbs(arr: Float32Array): number {
  let m = 0;
  for (let i = 0; i < arr.length; i++) m = Math.max(m, Math.abs(arr[i]!));
  return m;
}

describe("Ring style: Wave (a crest and a trough, net zero height)", () => {
  it("Bump's output is unchanged when style is passed explicitly (bit-identical to the default)", () => {
    const withStyle = createRippleEmitter();
    const withoutStyle = createRippleEmitter();
    withStyle.emit(1, "bump");
    withoutStyle.emit(1);
    withStyle.tick(1.2, TYPICAL_PARAMS);
    withoutStyle.tick(1.2, TYPICAL_PARAMS);
    const c1 = new Float32Array(PROFILE_SAMPLES);
    const s1 = new Float32Array(PROFILE_SAMPLES);
    const c2 = new Float32Array(PROFILE_SAMPLES);
    const s2 = new Float32Array(PROFILE_SAMPLES);
    buildProfile(withStyle, TYPICAL_PARAMS, c1, s1, "bump");
    buildProfile(withoutStyle, TYPICAL_PARAMS, c2, s2);
    expect(c1).toEqual(c2);
    expect(s1).toEqual(s2);
  });

  it("a lone mature ring's profile integrates to ~0 over r (plain dr weighting — see this test's own comment for why not r·dr)", () => {
    const emitter = createRippleEmitter();
    emitter.emit(1, "wave");
    emitter.tick(2.0, TYPICAL_PARAMS); // mature: well past the young-ring transient (WAVE_TROUGH_SHIFT_SIGMAS' own comment in rippleEmitter.ts)
    const crest = new Float32Array(PROFILE_SAMPLES);
    const slope = new Float32Array(PROFILE_SAMPLES);
    buildProfile(emitter, TYPICAL_PARAMS, crest, slope, "wave");
    const dr = PROFILE_MAX_RADIUS / (PROFILE_SAMPLES - 1);
    let integral = 0;
    for (let i = 0; i < PROFILE_SAMPLES; i++) integral += crest[i]! * dr;
    // Plain dr weighting: the crest-minus-shifted-trough construction is an
    // exact zero-mean pair over d=r-R for *any* shift (a gaussian's own
    // integral doesn't depend on where it's centred — WAVE_TROUGH_SHIFT_SIGMAS'
    // own comment), so this comes out ~0 up to truncation/discretization.
    // The r·dr-weighted integral is deliberately NOT checked here — it
    // settles to a positive constant instead, since weighting by r gives the
    // (larger-r) crest more say than the (smaller-r) trough it's paired
    // against; dr alone is the honest "net zero height" measure for a
    // radially-symmetric height field like this one.
    expect(Math.abs(integral)).toBeLessThan(0.02);
  });

  it("a lone mature ring's peak slope and peak crest match Bump's within 10%", () => {
    const ageSec = 2.0;
    const bump = createRippleEmitter();
    bump.emit(1, "bump");
    bump.tick(ageSec, TYPICAL_PARAMS);
    const wave = createRippleEmitter();
    wave.emit(1, "wave");
    wave.tick(ageSec, TYPICAL_PARAMS);

    const bCrest = new Float32Array(PROFILE_SAMPLES);
    const bSlope = new Float32Array(PROFILE_SAMPLES);
    const wCrest = new Float32Array(PROFILE_SAMPLES);
    const wSlope = new Float32Array(PROFILE_SAMPLES);
    buildProfile(bump, TYPICAL_PARAMS, bCrest, bSlope, "bump");
    buildProfile(wave, TYPICAL_PARAMS, wCrest, wSlope, "wave");

    const bumpSlopePeak = peakAbs(bSlope);
    const waveSlopePeak = peakAbs(wSlope);
    expect(Math.abs(waveSlopePeak - bumpSlopePeak)).toBeLessThan(bumpSlopePeak * 0.1);

    const bumpCrestPeak = peakAbs(bCrest);
    const waveCrestPeak = peakAbs(wCrest);
    expect(Math.abs(waveCrestPeak - bumpCrestPeak)).toBeLessThan(bumpCrestPeak * 0.1);
  });

  it("keeps the slope exactly zero at r=0, same guarantee as Bump (both mirrored gaussians cancel their own slope there)", () => {
    const cases = [0, 0.05, 0.5, 1.5, 3, 10];
    for (const age of cases) {
      const emitter = createRippleEmitter();
      emitter.emit(1, "wave");
      emitter.tick(age, TYPICAL_PARAMS);
      const crest = new Float32Array(PROFILE_SAMPLES);
      const slope = new Float32Array(PROFILE_SAMPLES);
      buildProfile(emitter, TYPICAL_PARAMS, crest, slope, "wave");
      expect(Math.abs(slope[0]!)).toBeLessThan(1e-5);
    }
  });

  it("a dense train (emit 1.0 every ~0.27s — this file's own bug-report rate, at default speed/width) keeps a large mid-radius slope amplitude, unlike Bump's near-flat sum there", () => {
    const period = 1 / 3.7; // ~0.27s
    const dt = 1 / 60;
    const totalSec = 8; // several seconds of steady emission — past both styles' own settle time
    function trainSlope(style: RingStyle): Float32Array {
      const emitter = createRippleEmitter();
      let nextEmit = 0;
      for (let t = 0; t < totalSec; t += dt) {
        emitter.tick(dt, TYPICAL_PARAMS);
        if (t >= nextEmit) {
          emitter.emit(1, style);
          nextEmit += period;
        }
      }
      const crest = new Float32Array(PROFILE_SAMPLES);
      const slope = new Float32Array(PROFILE_SAMPLES);
      buildProfile(emitter, TYPICAL_PARAMS, crest, slope, style);
      return slope;
    }
    const dr = PROFILE_MAX_RADIUS / (PROFILE_SAMPLES - 1);
    function maxAbsInWindow(arr: Float32Array, loR: number, hiR: number): number {
      let m = 0;
      for (let i = 0; i < arr.length; i++) {
        const r = i * dr;
        if (r >= loR && r <= hiR) m = Math.max(m, Math.abs(arr[i]!));
      }
      return m;
    }
    const mb = maxAbsInWindow(trainSlope("bump"), 1, 2.5);
    const mw = maxAbsInWindow(trainSlope("wave"), 1, 2.5);
    expect(mw).toBeGreaterThanOrEqual(mb * 3);
  });
});

describe("auto-narrowing: rings that come close together stay separate", () => {
  const dt = 1 / 60;
  const dr = PROFILE_MAX_RADIUS / (PROFILE_SAMPLES - 1);

  /** Emits 1.0 every `period` s for 8 s, tracking the ring rate; returns the
   *  final slope profile built with or without auto-narrowing. */
  function train(period: number, narrow: boolean) {
    const emitter = createRippleEmitter();
    const rate = createRingRateState();
    let nextEmit = 0;
    for (let t = 0; t < 8; t += dt) {
      emitter.tick(dt, TYPICAL_PARAMS);
      let e = 0;
      if (t >= nextEmit) {
        e = 1;
        nextEmit += period;
      }
      emitter.emit(e, "bump");
      advanceRingRate(rate, dt, e);
    }
    const w = narrow ? autoNarrowWidthW(TYPICAL_PARAMS.widthGaussianW, TYPICAL_PARAMS.speedUnitsPerSec, rate) : TYPICAL_PARAMS.widthGaussianW;
    const crest = new Float32Array(PROFILE_SAMPLES);
    const slope = new Float32Array(PROFILE_SAMPLES);
    buildProfile(emitter, { ...TYPICAL_PARAMS, widthGaussianW: w }, crest, slope, "bump");
    return { slope, w };
  }
  /** Sign changes and peak-to-peak of the slope over r in [1, 2.5] — how
   *  many separate ring edges the eye gets there, and how strongly. */
  function ripple(slope: Float32Array) {
    let flips = 0;
    let lo = Infinity;
    let hi = -Infinity;
    let prev = 0;
    for (let i = 0; i < slope.length; i++) {
      const r = i * dr;
      if (r < 1 || r > 2.5) continue;
      const s = slope[i]!;
      if (prev !== 0 && Math.sign(s) !== Math.sign(prev)) flips++;
      prev = s;
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    return { flips, p2p: hi - lo };
  }

  it("a fast train (3.7 rings/s) turns from a flat plateau into separate rings", () => {
    const plain = ripple(train(1 / 3.7, false).slope);
    const narrowed = ripple(train(1 / 3.7, true).slope);
    expect(plain.flips).toBeLessThanOrEqual(1);
    expect(narrowed.flips).toBeGreaterThanOrEqual(6);
    expect(narrowed.p2p).toBeGreaterThan(plain.p2p * 5);
  });

  it("slow hits (one every 2 s) keep the user's Ring width", () => {
    expect(train(2, true).w).toBe(TYPICAL_PARAMS.widthGaussianW);
  });

  it("after a pause, the next lone hit is back to full width", () => {
    const rate = createRingRateState();
    for (let t = 0; t < 4; t += dt) advanceRingRate(rate, dt, Math.round(t * 60) % 16 === 0 ? 1 : 0);
    const busy = autoNarrowWidthW(4, 1.1, rate);
    for (let t = 0; t < 5; t += dt) advanceRingRate(rate, dt, 0);
    expect(busy).toBeGreaterThan(4);
    expect(autoNarrowWidthW(4, 1.1, rate)).toBe(4);
  });
});

describe("Ring style: Merge (close rings combine into one stronger ring)", () => {
  /** Emits 1.0 every `period` seconds for `totalSec`, ticking every `dt` —
   *  the same "continuous emission at a fixed rate" idiom the dense-train
   *  Wave test above uses, reused here for Merge's own emitter-level effect. */
  function simulate(style: RingStyle, period: number, totalSec = 10, dt = 1 / 60) {
    const emitter = createRippleEmitter();
    let nextEmit = 0;
    for (let t = 0; t < totalSec; t += dt) {
      emitter.tick(dt, TYPICAL_PARAMS);
      if (t >= nextEmit) {
        emitter.emit(1, style);
        nextEmit += period;
      }
    }
    return emitter;
  }

  function avgAmp(e: ReturnType<typeof createRippleEmitter>): number {
    let sum = 0;
    for (let i = 0; i < e.count; i++) sum += e.amp[i]!;
    return sum / e.count;
  }

  it("at 3.7 emissions/s, fewer ring entries are in flight than Bump, each carrying a larger amplitude", () => {
    const period = 1 / 3.7;
    const bump = simulate("bump", period);
    const merge = simulate("merge", period);
    expect(merge.count).toBeLessThan(bump.count);
    expect(avgAmp(merge)).toBeGreaterThan(avgAmp(bump));
  });

  it("caps a merged amplitude at MERGE_AMP_CAP (2.5) rather than letting it grow without bound", () => {
    const merge = simulate("merge", 1 / 3.7);
    for (let i = 0; i < merge.count; i++) expect(merge.amp[i]!).toBeLessThanOrEqual(2.5 + 1e-9);
  });

  it("at 1 emission/s (slower than the merge window), Merge is identical to Bump — nothing close enough together to combine", () => {
    const period = 1; // > mergeWindowSec at TYPICAL_PARAMS (~0.6s), so nothing ever merges
    const bump = simulate("bump", period);
    const merge = simulate("merge", period);
    expect(merge.count).toBe(bump.count);
    for (let i = 0; i < bump.count; i++) {
      expect(merge.amp[i]).toBeCloseTo(bump.amp[i]!, 6);
      expect(merge.ageSec[i]).toBeCloseTo(bump.ageSec[i]!, 6);
    }
  });
});
