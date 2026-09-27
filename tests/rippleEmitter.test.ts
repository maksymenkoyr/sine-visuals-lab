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
  salienceMarks,
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
      const marks = salienceMarks(state);
      if (e > 0) expect(state.smoothed).toBeGreaterThanOrEqual(marks.ringsAbove - 1e-9);
      expect(marks.fullRing).toBeGreaterThan(marks.ringsAbove);
    }
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
