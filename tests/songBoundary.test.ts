import { describe, it, expect } from "vitest";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";
import { createSongBoundary, type SongBoundaryInputs } from "../src/render/songBoundary.ts";

const DT = 1 / 60;

function bandsA(): Float32Array {
  // Bass-heavy — stands in for one track's spectral personality.
  const b = new Float32Array(NUM_BANDS);
  for (let i = 0; i < NUM_BANDS; i++) b[i] = i < 4 ? 0.8 : 0.05;
  return b;
}

function bandsB(): Float32Array {
  // Treble-heavy — near-orthogonal to bandsA, standing in for a different track.
  const b = new Float32Array(NUM_BANDS);
  for (let i = 0; i < NUM_BANDS; i++) b[i] = i >= NUM_BANDS - 4 ? 0.8 : 0.05;
  return b;
}

function noiseBands(): Float32Array {
  // Flat mid-level noise — what an AGC-inflated gap would actually look
  // like in `bands` (see songBoundary.ts's file header on why bandRecent/
  // bandEstablished must freeze on the level-based `isQuiet` flag rather
  // than on their own band-peak). Fed during "gap" ticks below specifically
  // to prove the freeze holds regardless of what bands itself reads then.
  return new Float32Array(NUM_BANDS).fill(0.3);
}

function mkFrame(overrides: Partial<FeatureFrame> = {}): FeatureFrame {
  return {
    time: 0,
    bands: bandsA(),
    energy: 0.5,
    level: 0.7,
    onset: false,
    bpm: 128,
    onsetPhase: 0,
    ...overrides,
  };
}

function mkInputs(overrides: Partial<SongBoundaryInputs> = {}): SongBoundaryInputs {
  return { tempoLock: 0.9, rawIntensity: 0.5, centroidRaw: 0.5, ...overrides };
}

describe("songBoundary", () => {
  it("fires provisional during a real gap and confirms once the next track settles in", () => {
    const b = createSongBoundary();
    const A = bandsA();
    const B = bandsB();
    const noise = noiseBands();

    for (let i = 0; i < 300; i++) b.advance(DT, mkFrame({ bands: A, level: 0.7, bpm: 128 }), mkInputs({ tempoLock: 0.9 }));

    let provisionals = 0;
    let confirmeds = 0;
    const count = (): void => {
      if (b.provisional) provisionals++;
      if (b.confirmed) confirmeds++;
    };

    for (let i = 0; i < Math.round(3 / DT); i++) {
      b.advance(DT, mkFrame({ bands: noise, level: 0.03, bpm: 0 }), mkInputs({ tempoLock: 0 }));
      count();
    }
    for (let i = 0; i < Math.round(8 / DT); i++) {
      b.advance(DT, mkFrame({ bands: B, level: 0.7, bpm: 140 }), mkInputs({ tempoLock: 0.9 }));
      count();
    }

    expect(provisionals).toBeGreaterThanOrEqual(1);
    expect(confirmeds).toBe(1);
  });

  it("confirms a hard cut with a tempo and timbre change but no gap at all", () => {
    const b = createSongBoundary();
    const A = bandsA();
    const B = bandsB();

    for (let i = 0; i < 300; i++) b.advance(DT, mkFrame({ bands: A, level: 0.7, bpm: 128 }), mkInputs({ tempoLock: 0.9 }));

    let confirmeds = 0;
    // Level never dips — the cut is instantaneous and no quieter than the
    // material either side of it.
    for (let i = 0; i < Math.round(10 / DT); i++) {
      b.advance(DT, mkFrame({ bands: B, level: 0.7, bpm: 140 }), mkInputs({ tempoLock: 0.9 }));
      if (b.confirmed) confirmeds++;
    }

    expect(confirmeds).toBe(1);
  });

  it("does not confirm a breakdown that returns to the same material, even though provisional may fire", () => {
    const b = createSongBoundary();
    const A = bandsA();

    for (let i = 0; i < 300; i++) b.advance(DT, mkFrame({ bands: A, level: 0.7, bpm: 128 }), mkInputs({ tempoLock: 0.9 }));

    // A breakdown: quiet for a few seconds, same track, same spectrum.
    for (let i = 0; i < Math.round(3 / DT); i++) {
      b.advance(DT, mkFrame({ bands: A, level: 0.05, bpm: 0 }), mkInputs({ tempoLock: 0 }));
    }

    // The drop: full loudness again, the exact same material and tempo.
    let confirmeds = 0;
    for (let i = 0; i < Math.round(8 / DT); i++) {
      b.advance(DT, mkFrame({ bands: A, level: 0.7, bpm: 128 }), mkInputs({ tempoLock: 0.9 }));
      if (b.confirmed) confirmeds++;
    }

    expect(confirmeds).toBe(0);
  });

  it("reads a slow crossfade as a rising confidence region, never more than one confirmed edge", () => {
    const b = createSongBoundary();
    const A = bandsA();
    const B = bandsB();

    for (let i = 0; i < 300; i++) b.advance(DT, mkFrame({ bands: A, level: 0.7, bpm: 128 }), mkInputs({ tempoLock: 0.9 }));

    const crossfadeSec = 20;
    const ticks = Math.round(crossfadeSec / DT);
    let confirmeds = 0;
    let sawMidConfidence = false;
    for (let i = 0; i < ticks; i++) {
      const t = i / ticks;
      const blended = new Float32Array(NUM_BANDS);
      for (let k = 0; k < NUM_BANDS; k++) blended[k] = A[k] * (1 - t) + B[k] * t;
      b.advance(DT, mkFrame({ bands: blended, level: 0.7, bpm: 128 }), mkInputs({ tempoLock: 0.9 }));
      if (b.confirmed) confirmeds++;
      if (b.confidence > 0.2 && b.confidence < 0.8) sawMidConfidence = true;
    }
    for (let i = 0; i < Math.round(8 / DT); i++) {
      b.advance(DT, mkFrame({ bands: B, level: 0.7, bpm: 128 }), mkInputs({ tempoLock: 0.9 }));
      if (b.confirmed) confirmeds++;
    }

    expect(sawMidConfidence).toBe(true);
    expect(confirmeds).toBeLessThanOrEqual(1);
  });

  it("a refractory window collapses two close boundary candidates into one confirmed edge", () => {
    const b = createSongBoundary();
    const A = bandsA();
    const B = bandsB();
    const noise = noiseBands();
    let confirmeds = 0;

    for (let i = 0; i < 300; i++) b.advance(DT, mkFrame({ bands: A, level: 0.7, bpm: 128 }), mkInputs({ tempoLock: 0.9 }));

    const runGap = (after: Float32Array, bpmAfter: number): void => {
      for (let i = 0; i < Math.round(3 / DT); i++) {
        b.advance(DT, mkFrame({ bands: noise, level: 0.03, bpm: 0 }), mkInputs({ tempoLock: 0 }));
        if (b.confirmed) confirmeds++;
      }
      for (let i = 0; i < Math.round(6 / DT); i++) {
        b.advance(DT, mkFrame({ bands: after, level: 0.7, bpm: bpmAfter }), mkInputs({ tempoLock: 0.9 }));
        if (b.confirmed) confirmeds++;
      }
    };

    runGap(B, 140); // a real transition, A -> B
    runGap(A, 128); // and immediately back — well within the refractory window

    expect(confirmeds).toBe(1);
  });

  it("does not alias the caller's shared bands buffer across ticks", () => {
    // bandGains.ts hands animClock a single reused scratch buffer every
    // tick (see songBoundary.ts's file header) — anything here that held a
    // raw reference instead of copying values out of it would see every
    // retained spectrum silently become whatever the buffer holds *now*.
    const b = createSongBoundary();
    const shared = new Float32Array(NUM_BANDS);
    const A = bandsA();
    const B = bandsB();
    const noise = noiseBands();

    shared.set(A);
    for (let i = 0; i < 300; i++) b.advance(DT, mkFrame({ bands: shared, level: 0.7, bpm: 128 }), mkInputs({ tempoLock: 0.9 }));

    shared.set(noise);
    for (let i = 0; i < Math.round(3 / DT); i++) b.advance(DT, mkFrame({ bands: shared, level: 0.03, bpm: 0 }), mkInputs({ tempoLock: 0 }));

    shared.set(B);
    let confirmeds = 0;
    for (let i = 0; i < Math.round(8 / DT); i++) {
      b.advance(DT, mkFrame({ bands: shared, level: 0.7, bpm: 140 }), mkInputs({ tempoLock: 0.9 }));
      if (b.confirmed) confirmeds++;
    }

    expect(confirmeds).toBe(1);
  });

  it("quietHoldSec and gapConfidence build while level stays below the established threshold, and reset the instant it doesn't", () => {
    const b = createSongBoundary();
    for (let i = 0; i < 300; i++) b.advance(DT, mkFrame({ level: 0.7 }), mkInputs());

    for (let i = 0; i < Math.round(3 / DT); i++) b.advance(DT, mkFrame({ level: 0.02 }), mkInputs());
    expect(b.quietHoldSec).toBeGreaterThan(2.9);
    expect(b.gapConfidence).toBeGreaterThan(0.5);

    b.advance(DT, mkFrame({ level: 0.7 }), mkInputs());
    expect(b.quietHoldSec).toBe(0);
    expect(b.gapConfidence).toBe(0);
  });

  it("tempoLockDrop stays near 0 for a track that never held a lock in the first place", () => {
    const b = createSongBoundary();
    for (let i = 0; i < 600; i++) {
      b.advance(DT, mkFrame({ bpm: 0 }), mkInputs({ tempoLock: 0 }));
      expect(b.tempoLockDrop).toBeLessThan(0.05);
    }
  });

  it("tempoShift stays low re-locking to the same tempo, and rises re-locking to a different one", () => {
    const same = createSongBoundary();
    for (let i = 0; i < 180; i++) same.advance(DT, mkFrame({ bpm: 128 }), mkInputs({ tempoLock: 0.9 }));
    for (let i = 0; i < 90; i++) same.advance(DT, mkFrame({ bpm: 0 }), mkInputs({ tempoLock: 0 }));
    same.advance(DT, mkFrame({ bpm: 128 }), mkInputs({ tempoLock: 0.9 }));
    expect(same.tempoShift).toBeLessThan(0.1);

    const different = createSongBoundary();
    for (let i = 0; i < 180; i++) different.advance(DT, mkFrame({ bpm: 128 }), mkInputs({ tempoLock: 0.9 }));
    for (let i = 0; i < 90; i++) different.advance(DT, mkFrame({ bpm: 0 }), mkInputs({ tempoLock: 0 }));
    different.advance(DT, mkFrame({ bpm: 174 }), mkInputs({ tempoLock: 0.9 }));
    expect(different.tempoShift).toBeGreaterThan(0.5);
  });

  it("rangeStale only rises once rawIntensity has sat pinned at an extreme for a while, and resets quickly off it", () => {
    const b = createSongBoundary();
    for (let i = 0; i < 300; i++) b.advance(DT, mkFrame(), mkInputs({ rawIntensity: 0.5 }));
    expect(b.rangeStale).toBe(0);

    for (let i = 0; i < Math.round(20 / DT); i++) b.advance(DT, mkFrame(), mkInputs({ rawIntensity: 0.97 }));
    expect(b.rangeStale).toBeGreaterThan(0.9);

    b.advance(DT, mkFrame(), mkInputs({ rawIntensity: 0.5 }));
    expect(b.rangeStale).toBe(0);
  });

  it("provisional and confirmed edge counts are the same regardless of frame rate", () => {
    function run(fps: number): { provisionals: number; confirmeds: number } {
      const dt = 1 / fps;
      const b = createSongBoundary();
      const A = bandsA();
      const B = bandsB();
      const noise = noiseBands();
      let provisionals = 0;
      let confirmeds = 0;
      const count = (): void => {
        if (b.provisional) provisionals++;
        if (b.confirmed) confirmeds++;
      };
      for (let i = 0; i < Math.round(5 / dt); i++) b.advance(dt, mkFrame({ bands: A, level: 0.7, bpm: 128 }), mkInputs({ tempoLock: 0.9 }));
      for (let i = 0; i < Math.round(3 / dt); i++) {
        b.advance(dt, mkFrame({ bands: noise, level: 0.03, bpm: 0 }), mkInputs({ tempoLock: 0 }));
        count();
      }
      for (let i = 0; i < Math.round(8 / dt); i++) {
        b.advance(dt, mkFrame({ bands: B, level: 0.7, bpm: 140 }), mkInputs({ tempoLock: 0.9 }));
        count();
      }
      return { provisionals, confirmeds };
    }

    const at30 = run(30);
    const at120 = run(120);
    expect(at30.confirmeds).toBe(at120.confirmeds);
    expect(at30.confirmeds).toBeGreaterThanOrEqual(1);
  });

  it("never produces NaN or out-of-range values across a long, varied run", () => {
    const b = createSongBoundary();
    for (let i = 0; i < 5000; i++) {
      const t = i * 0.01;
      const bands = new Float32Array(NUM_BANDS);
      for (let k = 0; k < NUM_BANDS; k++) bands[k] = Math.max(0, 0.5 + 0.5 * Math.sin(t + k));
      const level = Math.max(0, 0.5 + 0.5 * Math.sin(t));
      const bpm = 100 + 40 * Math.sin(t * 0.3);
      const tempoLock = 0.5 + 0.5 * Math.sin(t * 0.5);
      const rawIntensity = 0.5 + 0.5 * Math.sin(t * 0.2);
      const centroidRaw = 0.5 + 0.5 * Math.sin(t * 0.7);

      b.advance(DT, mkFrame({ bands, level, bpm, time: t }), mkInputs({ tempoLock, rawIntensity, centroidRaw }));

      for (const v of [
        b.quietDepth,
        b.quietHoldSec,
        b.gapConfidence,
        b.novelty,
        b.centroidStep,
        b.tempoLockDrop,
        b.tempoShift,
        b.rangeStale,
        b.confidence,
      ]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(b.confidence).toBeGreaterThanOrEqual(0);
      expect(b.confidence).toBeLessThanOrEqual(1);
      expect(b.novelty).toBeGreaterThanOrEqual(0);
      expect(b.novelty).toBeLessThanOrEqual(1);
      expect(b.sinceBoundarySec === Infinity || Number.isFinite(b.sinceBoundarySec)).toBe(true);
    }
  });
});
