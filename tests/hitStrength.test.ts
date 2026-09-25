import { describe, it, expect, beforeEach } from "vitest";
import {
  getHitShape,
  setHitShape,
  resetHitShape,
  hitStandout,
  hitStrength,
  HIT_AMOUNT_DEFAULT,
  HIT_KNEE_DEFAULT,
  HIT_LOUDNESS_DEFAULT,
  HIT_FLOOR_DEFAULT,
  HIT_AMOUNT_MIN,
  HIT_AMOUNT_MAX,
  HIT_KNEE_MIN,
  HIT_KNEE_MAX,
  HIT_LOUDNESS_MIN,
  HIT_LOUDNESS_MAX,
  HIT_FLOOR_MIN,
  HIT_FLOOR_MAX,
  type HitShape,
} from "../src/audio/hitStrength.ts";

const FLAT: HitShape = { amount: HIT_AMOUNT_DEFAULT, knee: HIT_KNEE_DEFAULT, loudness: HIT_LOUDNESS_DEFAULT, floor: HIT_FLOOR_DEFAULT };

describe("hitStandout", () => {
  it("is 0 at and below the firing line", () => {
    expect(hitStandout(1, 1)).toBe(0);
    expect(hitStandout(0.5, 1)).toBe(0);
    expect(hitStandout(0, 1)).toBe(0);
  });

  it("is monotonic and saturating as ratio rises above 1", () => {
    let prev = 0;
    for (let ratio = 1; ratio <= 10; ratio += 0.25) {
      const v = hitStandout(ratio, 1);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    expect(hitStandout(50, 1)).toBeGreaterThan(0.99);
  });

  it("a smaller knee reads higher stand-out at the same ratio", () => {
    const ratio = 2.5;
    expect(hitStandout(ratio, 0.2)).toBeGreaterThan(hitStandout(ratio, 2));
  });

  it("sanitizes non-finite ratio/knee", () => {
    expect(Number.isFinite(hitStandout(Number.NaN, 1))).toBe(true);
    expect(Number.isFinite(hitStandout(2, Number.NaN))).toBe(true);
    expect(Number.isFinite(hitStandout(2, 0))).toBe(true);
    expect(hitStandout(Number.POSITIVE_INFINITY, 1)).toBeLessThanOrEqual(1);
  });
});

describe("hitStrength", () => {
  it("amount 0 returns exactly 1, for any ratio/loudness/knee/loudness-mix/floor", () => {
    const cases: [number | null, number, HitShape][] = [
      [1, 0, FLAT],
      [5, 1, { amount: 0, knee: 3, loudness: 1, floor: 0.8 }],
      [null, 0.4, { amount: 0, knee: 0.1, loudness: 0.5, floor: 0.3 }],
      [Number.NaN, Number.NaN, { amount: 0, knee: Number.NaN, loudness: Number.NaN, floor: Number.NaN }],
    ];
    for (const [ratio, loudness, shape] of cases) {
      expect(hitStrength(ratio, loudness, shape).strength).toBe(1);
    }
  });

  it("null ratio reads as stand-out 1 (a bare trigger)", () => {
    const parts = hitStrength(null, 0, { amount: 1, knee: 1, loudness: 0, floor: 0 });
    expect(parts.standout).toBe(1);
  });

  it("loudness crossfade: mix 0 is stand-out only, mix 1 is loudness only", () => {
    const shapeStandoutOnly: HitShape = { amount: 1, knee: 1, loudness: 0, floor: 0 };
    const shapeLoudnessOnly: HitShape = { amount: 1, knee: 1, loudness: 1, floor: 0 };
    const ratio = 3;
    const loudness = 0.2;
    const standout = hitStandout(ratio, 1);
    expect(hitStrength(ratio, loudness, shapeStandoutOnly).strength).toBeCloseTo(standout, 6);
    expect(hitStrength(ratio, loudness, shapeLoudnessOnly).strength).toBeCloseTo(loudness, 6);
  });

  it("floor zeroes strength for a graded value below it and rescales the rest into 0..1", () => {
    // Stand-out-only, floor above this hit's own stand-out: gated should
    // land at 0, so with amount 1 strength is exactly 0.
    const ratio = 1.2; // a small clearance -> small stand-out
    const shape: HitShape = { amount: 1, knee: 1, loudness: 0, floor: 0.9 };
    const standout = hitStandout(ratio, 1);
    expect(standout).toBeLessThan(0.9);
    expect(hitStrength(ratio, 0, shape).strength).toBe(0);

    // A hit clearly above the floor still lands inside 0..1.
    const loud = hitStrength(50, 0, shape);
    expect(loud.strength).toBeGreaterThan(0);
    expect(loud.strength).toBeLessThanOrEqual(1);
  });

  it("a floor just under 1 stays finite for a graded value right at the top", () => {
    const shape: HitShape = { amount: 1, knee: 1, loudness: 0, floor: HIT_FLOOR_MAX };
    const parts = hitStrength(1000, 0, shape); // stand-out saturates near 1
    expect(Number.isFinite(parts.strength)).toBe(true);
    expect(parts.strength).toBeGreaterThanOrEqual(0);
    expect(parts.strength).toBeLessThanOrEqual(1);
  });

  it("a floor of exactly 1 (outside what the store ever stores) still returns a finite result", () => {
    const shape: HitShape = { amount: 1, knee: 1, loudness: 0, floor: 1 };
    expect(Number.isFinite(hitStrength(1000, 0, shape).strength)).toBe(true);
    expect(Number.isFinite(hitStrength(1, 0, shape).strength)).toBe(true);
  });

  it("amount blends linearly between flat 1 and the fully graded value", () => {
    const ratio = 1.5;
    const full: HitShape = { amount: 1, knee: 1, loudness: 0, floor: 0 };
    const half: HitShape = { amount: 0.5, knee: 1, loudness: 0, floor: 0 };
    const gradedStrength = hitStrength(ratio, 0, full).strength;
    const halfStrength = hitStrength(ratio, 0, half).strength;
    expect(halfStrength).toBeCloseTo(1 + (gradedStrength - 1) * 0.5, 6);
  });

  it("mutates the provided `out` object in place and returns it, without allocating", () => {
    const out = { standout: -1, loudness: -1, strength: -1 };
    const result = hitStrength(2, 0.4, FLAT, out);
    expect(result).toBe(out);
    expect(out.standout).toBeGreaterThanOrEqual(0);
  });

  it("sanitizes non-finite loudness and shape fields without throwing or producing NaN", () => {
    const shape: HitShape = { amount: Number.NaN, knee: 1, loudness: Number.NaN, floor: Number.NaN };
    const parts = hitStrength(2, Number.NaN, shape);
    expect(Number.isFinite(parts.standout)).toBe(true);
    expect(Number.isFinite(parts.loudness)).toBe(true);
    expect(Number.isFinite(parts.strength)).toBe(true);
  });
});

// Single global value, like silenceGate/autoGain/bandSplit — every test
// resets first so none of them can leak state into the next (vitest runs a
// file's tests in one module instance, sharing the module-level cache).
describe("hit shape persistence", () => {
  beforeEach(() => {
    resetHitShape();
  });

  it("defaults to the documented flat-1 shape", () => {
    expect(getHitShape()).toEqual(FLAT);
  });

  it("round-trips a partial set, leaving the other fields untouched", () => {
    setHitShape({ amount: 0.5 });
    expect(getHitShape()).toEqual({ ...FLAT, amount: 0.5 });
    setHitShape({ knee: 2, floor: 0.3 });
    expect(getHitShape()).toEqual({ ...FLAT, amount: 0.5, knee: 2, floor: 0.3 });
  });

  it("clamps out-of-range and non-finite values per field", () => {
    setHitShape({ amount: -1, knee: 100, loudness: 5, floor: -5 });
    expect(getHitShape()).toEqual({ amount: HIT_AMOUNT_MIN, knee: HIT_KNEE_MAX, loudness: HIT_LOUDNESS_MAX, floor: HIT_FLOOR_MIN });

    setHitShape({ amount: 5, knee: 0, loudness: -5, floor: 5 });
    expect(getHitShape()).toEqual({ amount: HIT_AMOUNT_MAX, knee: HIT_KNEE_MIN, loudness: HIT_LOUDNESS_MIN, floor: HIT_FLOOR_MAX });

    setHitShape({ amount: Number.NaN, knee: Number.NaN, loudness: Number.NaN, floor: Number.NaN });
    expect(getHitShape()).toEqual(FLAT);
  });

  it("getHitShape returns a snapshot the caller can't mutate", () => {
    const shape = getHitShape();
    expect(() => {
      (shape as { amount: number }).amount = 0.9;
    }).toThrow();
    expect(getHitShape().amount).toBe(HIT_AMOUNT_DEFAULT);
  });
});
