import { describe, it, expect } from "vitest";
import { packTouch, smellWeight, TOUCH_EAT_GAIN, TOUCH_FEED_GAIN, TOUCH_MAX_BITE } from "../src/render/scenes/physarum2Affinity.ts";

// feedRows/eatCols are Float32Array (the GPU's own uniform-array precision),
// so exact-decimal expectations use toBeCloseTo at a digit count float32
// actually holds (~7 significant digits), not toBe/10-digit closeness.

describe("packTouch", () => {
  it("all-zero input gives identity feed rows, all-zero eat columns, and returns false", () => {
    const n = 4;
    const touch = new Array(n * n).fill(0);
    const feedRows = new Float32Array(16);
    const eatCols = new Float32Array(16);
    const eats = packTouch(touch, n, feedRows, eatCols);
    expect(eats).toBe(false);
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) {
        expect(feedRows[k * 4 + j]).toBe(j === k ? 1 : 0);
      }
    }
    expect(Array.from(eatCols)).toEqual(new Array(16).fill(0));
  });

  it("+0.6 gives feedRows[i*4+j] = 0.6 * TOUCH_FEED_GAIN and returns false", () => {
    const n = 2;
    const touch = [0, 0.6, 0, 0]; // touch[0][1] = 0.6
    const feedRows = new Float32Array(16);
    const eatCols = new Float32Array(16);
    const eats = packTouch(touch, n, feedRows, eatCols);
    expect(eats).toBe(false);
    expect(feedRows[0 * 4 + 1]).toBeCloseTo(0.6 * TOUCH_FEED_GAIN, 5);
    expect(feedRows[0 * 4 + 0]).toBe(1); // own-channel entry always 1
    expect(feedRows[1 * 4 + 1]).toBe(1);
    expect(Array.from(eatCols)).toEqual(new Array(16).fill(0));
  });

  it("-1 gives eatCols[j*4+i] = -ln(1-0.3) and returns true", () => {
    const n = 2;
    const touch = [0, -1, 0, 0]; // strain 0 eats strain 1's trail
    const feedRows = new Float32Array(16);
    const eatCols = new Float32Array(16);
    const eats = packTouch(touch, n, feedRows, eatCols);
    expect(eats).toBe(true);
    // i = 0 (eater), j = 1 (victim): eatCols[1*4+0]
    expect(eatCols[1 * 4 + 0]).toBeCloseTo(-Math.log(1 - 0.3), 5);
    expect(feedRows[0 * 4 + 1]).toBe(0); // negative touch never feeds
  });

  it("a non-zero diagonal is ignored", () => {
    const n = 2;
    const touch = [0.9, 0, 0, -0.9]; // diagonal only
    const feedRows = new Float32Array(16);
    const eatCols = new Float32Array(16);
    const eats = packTouch(touch, n, feedRows, eatCols);
    expect(eats).toBe(false);
    expect(feedRows[0 * 4 + 0]).toBe(1);
    expect(feedRows[1 * 4 + 1]).toBe(1);
    expect(Array.from(eatCols)).toEqual(new Array(16).fill(0));
  });

  it("-10 caps at -ln(1-TOUCH_MAX_BITE)", () => {
    const n = 2;
    const touch = [0, -10, 0, 0];
    const feedRows = new Float32Array(16);
    const eatCols = new Float32Array(16);
    const eats = packTouch(touch, n, feedRows, eatCols);
    expect(eats).toBe(true);
    expect(eatCols[1 * 4 + 0]).toBeCloseTo(-Math.log(1 - TOUCH_MAX_BITE), 5);
  });

  it("for n = 0..5 landings, exp(-n*L) equals (1-bite)^n", () => {
    const bite = Math.min(TOUCH_MAX_BITE, 1 * TOUCH_EAT_GAIN);
    const feedRows = new Float32Array(16);
    const eatCols = new Float32Array(16);
    packTouch([0, -1, 0, 0], 2, feedRows, eatCols); // -1 -> bite = TOUCH_EAT_GAIN = 0.3
    const L = eatCols[1 * 4 + 0]!;
    for (let landings = 0; landings <= 5; landings++) {
      const viaExp = Math.exp(-landings * L);
      const viaPow = Math.pow(1 - bite, landings);
      expect(viaExp).toBeCloseTo(viaPow, 5);
    }
  });
});

describe("smellWeight", () => {
  it("leaves the diagonal unchanged regardless of rivalry", () => {
    expect(smellWeight(0.8, 1, 1, 0)).toBe(0.8);
    expect(smellWeight(0.8, 1, 1, 0.5)).toBe(0.8);
    expect(smellWeight(0.8, 1, 1, 1)).toBe(0.8);
  });

  it("rivalry 0.5 is the identity for the off-diagonal", () => {
    expect(smellWeight(-1.1, 0, 1, 0.5)).toBeCloseTo(-1.1, 10);
    expect(smellWeight(0.7, 2, 3, 0.5)).toBeCloseTo(0.7, 10);
  });

  it("rivalry 0 zeroes the off-diagonal", () => {
    // toBeCloseTo, not toBe: -1.1 * 0 * 2 is -0 in IEEE 754, and Object.is
    // (toBe's equality) tells -0 and 0 apart even though they're == and
    // behave identically everywhere this value is actually used.
    expect(smellWeight(-1.1, 0, 1, 0)).toBeCloseTo(0, 10);
    expect(smellWeight(0.7, 2, 3, 0)).toBeCloseTo(0, 10);
  });
});
