import { describe, it, expect } from "vitest";
import {
  advanceEmission,
  advanceStandout,
  buildProfile,
  createRippleEmissionState,
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
  salienceMarks,
  ringThresholdBar,
  RING_THRESHOLD_DEFAULT,
  type RingStyle,
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

/** Same shape as simulateSingleHit, but a climb of `height` (not necessarily
 *  a full 0->1 jump) and a caller-chosen threshold — Ring threshold's own Off
 *  switch (`null`) included. */
function simulateStepClimb(height: number, threshold: number | null, totalSec = 3): number {
  const state = createRippleEmissionState();
  for (let i = 0; i < 10; i++) advanceEmission(state, DT, 0, threshold);
  let total = 0;
  for (let t = 0; t < totalSec; t += DT) {
    total += advanceEmission(state, DT, height * Math.exp(-BEAT_PULSE_DECAY * t), threshold);
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

describe("advanceEmission salience — a ring is sized by how much a hit stands out", () => {
  /** A beat-pulse-shaped driver from a list of hits ({t, h}): each hit
   *  raises the pulse to max(current, h), then it decays like anim.beatPulse.
   *  Returns the total emitted around each hit (from the hit's tick until the
   *  next hit), in hit order. */
  function emitPerHit(hits: { t: number; h: number }[], endSec: number, state = createRippleEmissionState()): number[] {
    const out = hits.map(() => 0);
    let pulse = 0;
    let next = 0;
    let current = -1;
    advanceEmission(state, DT, 0);
    for (let t = 0; t < endSec; t += DT) {
      pulse *= Math.exp(-BEAT_PULSE_DECAY * DT);
      while (next < hits.length && hits[next]!.t <= t) {
        pulse = Math.max(pulse, hits[next]!.h);
        current = next++;
      }
      const e = advanceEmission(state, DT, pulse);
      if (current >= 0) out[current]! += e;
    }
    return out;
  }

  // Deterministic "noise": small hits between kicks, heights in 0.2..0.4.
  const noisyKicks = (seconds: number) => {
    const hits: { t: number; h: number; kick: boolean }[] = [];
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let t = 0; t < seconds; t += 0.1) {
      const kick = Math.abs((t / 0.5) - Math.round(t / 0.5)) < 1e-6;
      hits.push({ t, h: kick ? 1 : 0.2 + 0.2 * rnd(), kick });
    }
    return hits;
  };

  it("background hits between kicks emit ~nothing once the floor has settled, kicks still emit full rings", () => {
    const hits = noisyKicks(12);
    const emitted = emitPerHit(hits, 12.5);
    const settled = hits.map((hit, i) => ({ ...hit, e: emitted[i]! })).filter((h) => h.t > 4);
    const noise = settled.filter((h) => !h.kick).map((h) => h.e);
    const kicks = settled.filter((h) => h.kick).map((h) => h.e);
    // Most background hits emit exactly nothing; the odd louder blip may make
    // a faint ring, never anything near a kick's.
    expect(noise.reduce((a, b) => a + b, 0) / noise.length).toBeLessThan(0.05);
    expect(Math.max(...noise)).toBeLessThan(0.3);
    expect(Math.min(...kicks)).toBeGreaterThan(0.7);
  });

  it("a steady run of equal kicks keeps emitting full rings — the peak is the kick itself", () => {
    const hits = Array.from({ length: 60 }, (_, i) => ({ t: i * 0.5, h: 1 }));
    const emitted = emitPerHit(hits, 30.5);
    for (const e of emitted.slice(-10)) expect(e).toBeGreaterThan(0.85);
  });

  it("after a quiet spell a modest hit stands out again", () => {
    const state = createRippleEmissionState();
    // A busy passage of 0.3 hits pushes the floor up to ~0.3...
    emitPerHit(Array.from({ length: 40 }, (_, i) => ({ t: i * 0.1, h: 0.3 })), 4, state);
    // ...then 8s of silence, then one 0.3 hit.
    const [afterQuiet] = emitPerHit([{ t: 8, h: 0.3 }], 8.5, state);
    expect(afterQuiet).toBeGreaterThan(0.7);
  });

  it("a noise-only passage settles to ~nothing instead of ringing on every blip", () => {
    const hits = noisyKicks(10).filter((h) => !h.kick);
    const emitted = emitPerHit(hits, 10.5);
    const late = emitted.filter((_, i) => hits[i]!.t > 5);
    const mean = late.reduce((a, b) => a + b, 0) / late.length;
    expect(mean).toBeLessThan(0.3);
  });
});

describe("advanceEmission on a smooth source — whole climbs, not frame steps", () => {
  // A level sitting high with smooth raised-cosine bumps, alternating a big
  // (0.25) and a small (0.06) one every second, each 0.5 s long — the shape a
  // level or drawn-line source gives, not a hit envelope.
  const bumpSignal = (t: number) => {
    const k = Math.floor(t);
    const ph = t - k;
    const size = k % 2 === 0 ? 0.25 : 0.06;
    return 0.75 + (ph < 0.5 ? size * 0.5 * (1 - Math.cos((ph / 0.5) * 2 * Math.PI)) : 0);
  };

  /** Per bump: total emitted and how many separate runs of emitting frames. */
  function runBumps(dt: number, seconds: number) {
    const state = createRippleEmissionState();
    const totals: number[] = [];
    const runs: number[] = [];
    let wasEmitting = false;
    for (let t = 0; t < seconds; t += dt) {
      const k = Math.floor(t);
      const e = advanceEmission(state, dt, bumpSignal(t));
      totals[k] = (totals[k] ?? 0) + e;
      if (e > 0 && !wasEmitting) runs[k] = (runs[k] ?? 0) + 1;
      wasEmitting = e > 0;
    }
    return { totals, runs };
  }

  it("each big bump sends one ring, small bumps send nothing once it has learned the source", () => {
    const { totals, runs } = runBumps(DT, 20);
    for (let k = 6; k < 20; k++) {
      if (k % 2 === 0) {
        expect(totals[k]!).toBeGreaterThan(0.7);
        expect(runs[k]).toBe(1);
      } else {
        expect(totals[k] ?? 0).toBeLessThan(0.15);
      }
    }
  });

  it("a bump's ring is the same size at 30 and 120 fps", () => {
    const slow = runBumps(1 / 30, 12).totals;
    const fast = runBumps(1 / 120, 12).totals;
    for (let k = 6; k < 12; k += 2) expect(Math.abs(slow[k]! - fast[k]!)).toBeLessThan(0.1);
  });

  it("a ring only starts once the signal is above the drawn 'rings above' line", () => {
    const state = createRippleEmissionState();
    for (let t = 0; t < 12; t += DT) {
      const e = advanceEmission(state, DT, bumpSignal(t));
      const marks = salienceMarks(state)!; // Ring threshold is on (the default) throughout this test
      if (e > 0) expect(state.smoothed).toBeGreaterThanOrEqual(marks.ringsAbove - 1e-9);
      expect(marks.fullRing).toBeGreaterThan(marks.ringsAbove);
    }
  });
});

describe("Ring threshold (the adaptive threshold's margin)", () => {
  it("the default is exactly the old fixed bar: 1.5x the floor, no minimum", () => {
    expect(ringThresholdBar(0.2, RING_THRESHOLD_DEFAULT)).toBeCloseTo(0.3, 10);
    expect(ringThresholdBar(0, RING_THRESHOLD_DEFAULT)).toBe(0);
  });

  it("raising it rings less on the busy kick-and-hi-hat case; lowering it rings more", () => {
    const totalFaint = (threshold: number) => {
      const state = createRippleEmissionState();
      let pulse = 0;
      let faint = 0;
      let seed = 11;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      advanceEmission(state, DT, 0, threshold);
      for (let f = 0; f < 60 * 12; f++) {
        const t = f * DT;
        pulse *= Math.exp(-BEAT_PULSE_DECAY * DT);
        const tick = f % 6 === 0; // every 0.1 s
        const kick = f % 30 === 0; // every 0.5 s
        if (kick) pulse = 1;
        else if (tick) pulse = Math.max(pulse, 0.2 + 0.2 * rnd());
        const e = advanceEmission(state, DT, pulse, threshold);
        if (t > 4 && !(f % 30 < 3)) faint += e; // emission not caused by a kick
      }
      return faint;
    };
    expect(totalFaint(0)).toBeGreaterThan(totalFaint(RING_THRESHOLD_DEFAULT));
    expect(totalFaint(1)).toBeLessThan(totalFaint(RING_THRESHOLD_DEFAULT) + 1e-9);
  });

  it("at its top it still blocks small jumps on a clean source (floor 0)", () => {
    const state = createRippleEmissionState();
    advanceEmission(state, DT, 0, 1);
    let total = 0;
    for (let t = 0; t < 1; t += DT) total += advanceEmission(state, DT, 0.15 * Math.exp(-BEAT_PULSE_DECAY * t), 1);
    expect(total).toBe(0);
  });

  it("the drawn line follows it", () => {
    const low = createRippleEmissionState();
    const high = createRippleEmissionState();
    for (let t = 0; t < 1; t += DT) {
      advanceEmission(low, DT, 0.2, 0);
      advanceEmission(high, DT, 0.2, 1);
    }
    expect(salienceMarks(high)!.ringsAbove).toBeGreaterThan(salienceMarks(low)!.ringsAbove);
  });
});

describe("Ring threshold Off (threshold: null) — every climb rings, sized by its own climb", () => {
  it("a background-sized (0.3) climb rings ~0.3 and a clean (1.0) hit still rings ~1", () => {
    const background = simulateStepClimb(0.3, null);
    expect(background).toBeGreaterThan(0.25);
    expect(background).toBeLessThan(0.35);
    const full = simulateStepClimb(1, null);
    expect(full).toBeGreaterThan(0.85);
    expect(full).toBeLessThan(1.05);
  });

  it("the same busy kick-and-hi-hat background that reads as ~nothing at the default (see the salience describe above) rings for real once the threshold is off", () => {
    // Same shape as noisyKicks/emitPerHit above (this file's own idiom for a
    // busy track), inlined here since those are scoped to their own describe.
    function noiseTotal(threshold: number | null): number {
      const hits: { t: number; h: number; kick: boolean }[] = [];
      let seed = 11;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let t = 0; t < 12; t += 0.1) {
        const kick = Math.abs(t / 0.5 - Math.round(t / 0.5)) < 1e-6;
        hits.push({ t, h: kick ? 1 : 0.2 + 0.2 * rnd(), kick });
      }
      const state = createRippleEmissionState();
      let pulse = 0;
      let next = 0;
      let current = -1;
      advanceEmission(state, DT, 0, threshold);
      let total = 0;
      for (let t = 0; t < 12.5; t += DT) {
        pulse *= Math.exp(-BEAT_PULSE_DECAY * DT);
        while (next < hits.length && hits[next]!.t <= t) {
          pulse = Math.max(pulse, hits[next]!.h);
          current = next++;
        }
        const e = advanceEmission(state, DT, pulse, threshold);
        if (current >= 0 && t > 4 && !hits[current]!.kick) total += e;
      }
      return total;
    }
    const atDefault = noiseTotal(RING_THRESHOLD_DEFAULT);
    const off = noiseTotal(null);
    expect(atDefault).toBeLessThan(2); // matches the salience describe's own "emit ~nothing" verdict
    expect(off).toBeGreaterThan(atDefault * 2.5); // the very same hits ring for real once nothing is filtered
  });

  it("salienceMarks returns null (no bar to draw) while off, and the real bar again once back on", () => {
    const state = createRippleEmissionState();
    advanceEmission(state, DT, 0.2, null);
    expect(salienceMarks(state)).toBeNull();
    advanceEmission(state, DT, 0.2, RING_THRESHOLD_DEFAULT);
    expect(salienceMarks(state)).not.toBeNull();
  });
});

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

describe("advanceStandout — one yes per hit that stands out (Physarum 2's Dose reseed)", () => {
  /** Fires counted per hit, for kicks (height 1 every 0.5s) with a small
   *  background blip between each, like noisyKicks above. */
  function firesFor(threshold: number | null): { kick: number; blip: number } {
    const state = createRippleEmissionState();
    let pulse = 0;
    let kick = 0;
    let blip = 0;
    advanceStandout(state, DT, 0, threshold);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let t = 0; t < 12; t += DT) {
      pulse *= Math.exp(-BEAT_PULSE_DECAY * DT);
      const onKick = Math.abs(t / 0.5 - Math.round(t / 0.5)) < DT / 2 / 0.5;
      const onBlip = !onKick && Math.abs((t - 0.25) / 0.5 - Math.round((t - 0.25) / 0.5)) < DT / 2 / 0.5;
      if (onKick) pulse = Math.max(pulse, 1);
      else if (onBlip) pulse = Math.max(pulse, 0.2 + 0.2 * rnd());
      const fired = advanceStandout(state, DT, pulse, threshold);
      if (fired && t > 4) {
        if (pulse > 0.8) kick++;
        else blip++;
      }
    }
    return { kick, blip };
  }

  it("fires once per kick and stays quiet on the background blips", () => {
    const { kick, blip } = firesFor(RING_THRESHOLD_DEFAULT);
    // 16 kicks in the 8s after the floor settles; one fire each, never two.
    expect(kick).toBeGreaterThanOrEqual(14);
    expect(kick).toBeLessThanOrEqual(16);
    expect(blip).toBeLessThanOrEqual(1);
  });

  it("with the threshold Off every climb counts, blips included", () => {
    // Many blips sit under the decaying tail of the kick before them and make
    // no climb at all; the ones that do climb all count with the line off.
    const { blip } = firesFor(null);
    expect(blip).toBeGreaterThanOrEqual(2);
    expect(blip).toBeGreaterThan(firesFor(RING_THRESHOLD_DEFAULT).blip);
  });

  it("a steady level never fires", () => {
    const state = createRippleEmissionState();
    let fires = 0;
    for (let i = 0; i < 300; i++) if (advanceStandout(state, DT, 0.6)) fires++;
    expect(fires).toBe(0);
  });
});
