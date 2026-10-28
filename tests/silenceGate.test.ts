import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  silenceGateDimmer,
  hitPasses,
  resetSilenceGateTracker,
  resolveSilenceGate,
  feedSilenceGateMeasurement,
  silenceGateMarksForFloor,
  SILENCE_GATE_MIN,
  SILENCE_GATE_OFF,
  SILENCE_GATE_SEED,
} from "../src/audio/silenceGate.ts";
import { createSyntheticFeed } from "../src/audio/synthetic.ts";

const SEED_GAP = SILENCE_GATE_SEED.open - SILENCE_GATE_SEED.closed;

describe("silenceGateDimmer", () => {
  const marks = { closed: 0.1, open: 0.3 };

  it("is 0 at and below the closed mark", () => {
    expect(silenceGateDimmer(0.1, marks)).toBe(0);
    expect(silenceGateDimmer(0.05, marks)).toBe(0);
    expect(silenceGateDimmer(SILENCE_GATE_MIN, marks)).toBe(0);
  });

  it("is 1 at and above the open mark", () => {
    expect(silenceGateDimmer(0.3, marks)).toBe(1);
    expect(silenceGateDimmer(0.9, marks)).toBe(1);
  });

  it("is strictly between 0 and 1 inside the marks", () => {
    const mid = silenceGateDimmer(0.2, marks);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("is monotonically non-decreasing across a sweep from closed to open", () => {
    let prev = -1;
    for (let level = 0; level <= 0.4; level += 0.01) {
      const d = silenceGateDimmer(level, marks);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
  });

  it("gates nothing when closed sits at SILENCE_GATE_MIN", () => {
    const off = { closed: SILENCE_GATE_MIN, open: 0.3 };
    expect(silenceGateDimmer(0, off)).toBe(1);
    expect(silenceGateDimmer(0.01, off)).toBe(1);
    expect(silenceGateDimmer(0.5, off)).toBe(1);
  });

  it("SILENCE_GATE_OFF passes a bare hit in a dead silent room", () => {
    expect(silenceGateDimmer(0, SILENCE_GATE_OFF)).toBe(1);
    expect(hitPasses(1.01, silenceGateDimmer(0, SILENCE_GATE_OFF))).toBe(true);
  });

  it("fails open on a non-finite level", () => {
    expect(silenceGateDimmer(Number.NaN, marks)).toBe(1);
    expect(silenceGateDimmer(Number.POSITIVE_INFINITY, marks)).toBe(1);
  });

  // The seed marks are placeholders picked so that src/audio/synthetic.ts's
  // feed — every headless screenshot/tuning tool run with ?audio=synthetic —
  // is never dimmed. Drive the real feed across a long span at the seed and
  // check every frame agrees, rather than trusting the arithmetic (the seed's
  // `open` sitting at synthetic's own quietest `level`) by eye.
  it("never dims the synthetic feed at the seed marks", () => {
    const feed = createSyntheticFeed();
    const dt = 1 / 60;
    for (let t = 0; t < 60; t += dt) {
      const frame = feed.frame(t);
      expect(silenceGateDimmer(frame.level, SILENCE_GATE_SEED)).toBe(1);
    }
  });
});

// An engine hit's strength is over 1 by construction (EngineReading in
// src/audio/types.ts), so an open gate must pass every hit and a shut one none.
describe("hitPasses", () => {
  it("passes every hit at an open gate and none at a shut one", () => {
    for (const strength of [1.001, 1.5, 4]) {
      expect(hitPasses(strength, 1)).toBe(true);
      expect(hitPasses(strength, 0)).toBe(false);
    }
  });

  it("a half-open gate passes only hits that cleared twice the threshold", () => {
    expect(hitPasses(1.9, 0.5)).toBe(false);
    expect(hitPasses(2.1, 0.5)).toBe(true);
  });

  it("no hit never passes", () => {
    expect(hitPasses(0, 1)).toBe(false);
  });

  it("the synthetic feed's hits all pass its own undimmed gate", () => {
    const feed = createSyntheticFeed();
    let hits = 0;
    for (let t = 0; t < 10; t += 1 / 60) {
      const frame = feed.frame(t);
      const e = frame.engine!;
      const strongest = Math.max(e.kick, e.snare, e.hat);
      if (strongest === 0) continue;
      hits++;
      expect(hitPasses(strongest, silenceGateDimmer(frame.level, SILENCE_GATE_SEED))).toBe(true);
    }
    expect(hits).toBeGreaterThan(30);
  });
});

// silenceGateMarksForFloor is the pure mapping the room-floor tracker leans
// on — a higher floor should never ask for a lower `closed` than a quieter
// one, and the gap between the two marks should stay the seed's own gap
// regardless of where `closed` lands.
describe("silenceGateMarksForFloor", () => {
  it("keeps the seed's gap width, away from either clamp", () => {
    for (const floor of [0.02, 0.1, 0.2]) {
      const marks = silenceGateMarksForFloor(floor);
      expect(marks.open - marks.closed).toBeCloseTo(SEED_GAP);
    }
  });

  it("never returns closed at SILENCE_GATE_MIN even for a very low or negative floor", () => {
    for (const floor of [0, -1, -100]) {
      const marks = silenceGateMarksForFloor(floor);
      expect(marks.closed).toBeGreaterThan(SILENCE_GATE_MIN);
    }
  });

  it("never returns marks at the top of level's range even for a very high floor", () => {
    const marks = silenceGateMarksForFloor(100);
    expect(marks.closed).toBeLessThan(1);
    expect(marks.open).toBeLessThan(1);
  });

  it("is monotonically non-decreasing as the floor rises", () => {
    let prevClosed = -Infinity;
    for (let floor = -0.1; floor <= 1; floor += 0.05) {
      const marks = silenceGateMarksForFloor(floor);
      expect(marks.closed).toBeGreaterThanOrEqual(prevClosed - 1e-9);
      prevClosed = marks.closed;
    }
  });

  it("falls back sanely on a non-finite floor", () => {
    const marks = silenceGateMarksForFloor(Number.NaN);
    expect(Number.isFinite(marks.closed)).toBe(true);
    expect(Number.isFinite(marks.open)).toBe(true);
  });
});

describe("room-floor tracker", () => {
  beforeEach(() => {
    resetSilenceGateTracker();
  });

  it("starts at SILENCE_GATE_SEED, before the room has been heard", () => {
    const marks = resolveSilenceGate();
    expect(marks.closed).toBeCloseTo(SILENCE_GATE_SEED.closed, 12);
    expect(marks.open).toBeCloseTo(SILENCE_GATE_SEED.open, 12);
  });

  it("hands out a snapshot the caller can't mutate", () => {
    const marks = resolveSilenceGate();
    expect(() => {
      (marks as { closed: number }).closed = 0.9;
    }).toThrow();
    expect(resolveSilenceGate().closed).toBeCloseTo(SILENCE_GATE_SEED.closed);
  });

  it("a steady low level pulls the marks to settle just above it", () => {
    const quietLevel = 0.01; // below the seed's own closed mark
    for (let i = 0; i < 60; i++) feedSilenceGateMeasurement(quietLevel, 1);
    const resolved = resolveSilenceGate();
    // "Just above" — closer to the room's own quiet level than to the seed's
    // gap between the two marks, without pinning the exact margin (an
    // unmeasured placeholder — see this module's header).
    expect(resolved.closed).toBeGreaterThan(quietLevel);
    expect(resolved.closed).toBeLessThan(quietLevel + SEED_GAP);
  });

  it("a fluctuating, music-like level never lets the floor rise", () => {
    const before = resolveSilenceGate();
    // Both levels sit above the seeded floor, so this only exercises the
    // steadiness gate, not the fast-drop path — a wide, constantly-moving
    // window should never read as "the room went quiet."
    for (let i = 0; i < 400; i++) feedSilenceGateMeasurement(i % 2 === 0 ? 0.4 : 0.15, 1 / 20);
    const after = resolveSilenceGate();
    expect(after.closed).toBeCloseTo(before.closed);
  });

  it("a level dropping below the floor pulls the marks down faster than an equally-distant rise", () => {
    // Mid-range starting point, away from either clamp in both directions,
    // so neither leg below saturates SILENCE_GATE_AUTO_CLOSED_FLOOR/CEIL and
    // confounds the comparison.
    resetSilenceGateTracker(0.15);
    const before = resolveSilenceGate();
    feedSilenceGateMeasurement(before.closed - 0.1, 0.1);
    const afterDrop = resolveSilenceGate().closed;

    // Fresh seed + fresh envelope for a clean second comparison — a
    // first-ever reading needs only one sample (both envelope bounds start
    // unset), so this isolates the rate difference from any envelope
    // warm-up effect the first leg left behind.
    resetSilenceGateTracker(0.15);
    const beforeRise = resolveSilenceGate();
    feedSilenceGateMeasurement(beforeRise.closed + 0.1, 0.1);
    const afterRise = resolveSilenceGate().closed;

    const dropDelta = before.closed - afterDrop;
    const riseDelta = afterRise - beforeRise.closed;
    expect(dropDelta).toBeGreaterThan(0);
    expect(riseDelta).toBeGreaterThan(0);
    // The two legs aren't symmetric around `floor` (SILENCE_GATE_AUTO_MARGIN
    // puts `closed` above it), which narrows the FLOOR_DROP_RATE /
    // FLOOR_RISE_RATE ratio actually observed here; 2x keeps a comfortable
    // margin below it either way.
    expect(dropDelta).toBeGreaterThan(riseDelta * 2);
  });

  it("closed never reaches SILENCE_GATE_MIN, even after a very long silence", () => {
    for (let i = 0; i < 200; i++) feedSilenceGateMeasurement(0, 5);
    expect(resolveSilenceGate().closed).toBeGreaterThan(SILENCE_GATE_MIN);
  });

  it("closed stays under a very long, loud drone", () => {
    const drone = 0.6;
    for (let i = 0; i < 200; i++) feedSilenceGateMeasurement(drone, 5);
    expect(resolveSilenceGate().closed).toBeLessThan(drone);
  });

  it("keeps the seed's gap across a run with varied levels", () => {
    const levels = [0.5, 0.02, 0.4, 0.01, 0.6, 0, 0.3];
    for (let i = 0; i < 200; i++) feedSilenceGateMeasurement(levels[i % levels.length], 1 / 30);
    const resolved = resolveSilenceGate();
    expect(resolved.open - resolved.closed).toBeCloseTo(SEED_GAP);
  });

  it("ignores a non-finite level or dt outright, holding the last estimate", () => {
    feedSilenceGateMeasurement(0.02, 1); // establish a real reading first
    const before = resolveSilenceGate();
    feedSilenceGateMeasurement(Number.NaN, 1);
    feedSilenceGateMeasurement(0.02, Number.NaN);
    feedSilenceGateMeasurement(Number.POSITIVE_INFINITY, 1);
    expect(resolveSilenceGate()).toEqual(before);
  });
});

// An older version stored manual marks and an Auto flag; a profile that still
// holds them must come up on the tracker at the seed, like a fresh one.
describe("silence gate on module load", () => {
  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
    vi.resetModules();
  });

  it("ignores stored manual marks and Auto off", async () => {
    const store = new Map<string, string>([
      ["vibe.silenceGateClosed", "0.12"],
      ["vibe.silenceGateOpen", "0.22"],
      ["vibe.silenceGateAuto", "0"],
    ]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    vi.resetModules();
    const fresh = await import("../src/audio/silenceGate.ts");
    expect(fresh.resolveSilenceGate().closed).toBeCloseTo(fresh.SILENCE_GATE_SEED.closed, 12);
    for (let i = 0; i < 60; i++) fresh.feedSilenceGateMeasurement(0.01, 1);
    expect(fresh.resolveSilenceGate().closed).toBeLessThan(fresh.SILENCE_GATE_SEED.closed);
  });
});
