import { describe, it, expect } from "vitest";
import {
  getHitShape,
  hitStandout,
  hitStrength,
  HIT_AMOUNT_DEFAULT,
  HIT_KNEE_DEFAULT,
  HIT_LOUDNESS_DEFAULT,
  HIT_FLOOR_DEFAULT,
  pulseDecayScale,
  pulseDecayScales,
  UNIT_TAILS,
  type HitShape,
} from "../src/audio/hitStrength.ts";

const FLAT: HitShape = { amount: HIT_AMOUNT_DEFAULT, knee: HIT_KNEE_DEFAULT, loudness: HIT_LOUDNESS_DEFAULT, floor: HIT_FLOOR_DEFAULT, tail: UNIT_TAILS };

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
      [5, 1, { amount: 0, knee: 3, loudness: 1, floor: 0.8, tail: UNIT_TAILS }],
      [null, 0.4, { amount: 0, knee: 0.1, loudness: 0.5, floor: 0.3, tail: UNIT_TAILS }],
      [Number.NaN, Number.NaN, { amount: 0, knee: Number.NaN, loudness: Number.NaN, floor: Number.NaN, tail: UNIT_TAILS }],
    ];
    for (const [ratio, loudness, shape] of cases) {
      expect(hitStrength(ratio, loudness, shape).strength).toBe(1);
    }
  });

  it("null ratio reads as stand-out 1 (a bare trigger)", () => {
    const parts = hitStrength(null, 0, { amount: 1, knee: 1, loudness: 0, floor: 0, tail: UNIT_TAILS });
    expect(parts.standout).toBe(1);
  });

  it("loudness crossfade: mix 0 is stand-out only, mix 1 is loudness only", () => {
    const shapeStandoutOnly: HitShape = { amount: 1, knee: 1, loudness: 0, floor: 0, tail: UNIT_TAILS };
    const shapeLoudnessOnly: HitShape = { amount: 1, knee: 1, loudness: 1, floor: 0, tail: UNIT_TAILS };
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
    const shape: HitShape = { amount: 1, knee: 1, loudness: 0, floor: 0.9, tail: UNIT_TAILS };
    const standout = hitStandout(ratio, 1);
    expect(standout).toBeLessThan(0.9);
    expect(hitStrength(ratio, 0, shape).strength).toBe(0);

    // A hit clearly above the floor still lands inside 0..1.
    const loud = hitStrength(50, 0, shape);
    expect(loud.strength).toBeGreaterThan(0);
    expect(loud.strength).toBeLessThanOrEqual(1);
  });

  it("a floor just under 1 stays finite for a graded value right at the top", () => {
    const shape: HitShape = { amount: 1, knee: 1, loudness: 0, floor: 0.95, tail: UNIT_TAILS };
    const parts = hitStrength(1000, 0, shape); // stand-out saturates near 1
    expect(Number.isFinite(parts.strength)).toBe(true);
    expect(parts.strength).toBeGreaterThanOrEqual(0);
    expect(parts.strength).toBeLessThanOrEqual(1);
  });

  it("a floor of exactly 1 (a pure fn a test can call directly) still returns a finite result", () => {
    const shape: HitShape = { amount: 1, knee: 1, loudness: 0, floor: 1, tail: UNIT_TAILS };
    expect(Number.isFinite(hitStrength(1000, 0, shape).strength)).toBe(true);
    expect(Number.isFinite(hitStrength(1, 0, shape).strength)).toBe(true);
  });

  it("amount blends linearly between flat 1 and the fully graded value", () => {
    const ratio = 1.5;
    const full: HitShape = { amount: 1, knee: 1, loudness: 0, floor: 0, tail: UNIT_TAILS };
    const half: HitShape = { amount: 0.5, knee: 1, loudness: 0, floor: 0, tail: UNIT_TAILS };
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
    const shape: HitShape = { amount: Number.NaN, knee: 1, loudness: Number.NaN, floor: Number.NaN, tail: UNIT_TAILS };
    const parts = hitStrength(2, Number.NaN, shape);
    expect(Number.isFinite(parts.standout)).toBe(true);
    expect(Number.isFinite(parts.loudness)).toBe(true);
    expect(Number.isFinite(parts.strength)).toBe(true);
  });
});

describe("getHitShape", () => {
  it("is the flat-1 shape, frozen so nothing can change it", () => {
    expect(getHitShape()).toEqual(FLAT);
    expect(() => {
      (getHitShape() as { amount: number }).amount = 0.9;
    }).toThrow();
    expect(() => {
      (getHitShape().tail as { low: number }).low = 3;
    }).toThrow();
  });
});

describe("pulseDecayScale", () => {
  it("is exactly 1 at the default tail and for no shape at all", () => {
    expect(pulseDecayScale(FLAT, "beat")).toBe(1);
    expect(pulseDecayScale(undefined, "low")).toBe(1);
  });

  it("is the inverse of that lane's tail: twice as long falls at half the rate", () => {
    const shape = { ...FLAT, tail: { ...UNIT_TAILS, low: 2, high: 0.25 } };
    expect(pulseDecayScale(shape, "low")).toBe(0.5);
    expect(pulseDecayScale(shape, "high")).toBe(4);
    expect(pulseDecayScale(shape, "beat")).toBe(1);
  });

  it("falls back to 1 for a non-finite or non-positive tail", () => {
    for (const mid of [Number.NaN, Number.POSITIVE_INFINITY, 0, -3]) {
      expect(pulseDecayScale({ ...FLAT, tail: { ...UNIT_TAILS, mid } }, "mid")).toBe(1);
    }
  });

  it("pulseDecayScales gives every lane at once, and the unit set for no shape", () => {
    expect(pulseDecayScales(undefined)).toBe(UNIT_TAILS);
    expect(pulseDecayScales({ ...FLAT, tail: { beat: 2, low: 4, mid: 0.5, high: 1 } })).toEqual({ beat: 0.5, low: 0.25, mid: 2, high: 1 });
  });
});
