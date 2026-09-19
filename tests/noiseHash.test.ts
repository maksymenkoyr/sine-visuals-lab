import { describe, expect, it } from "vitest";
import { NOISE_HASH_GLSL, NOISE_MASK, NOISE_PERIOD, wrapFlow } from "../src/render/noiseHash.ts";

describe("noiseHash", () => {
  it("has a power-of-two period and the matching mask", () => {
    expect(Number.isInteger(Math.log2(NOISE_PERIOD))).toBe(true);
    expect(NOISE_MASK).toBe(NOISE_PERIOD - 1);
  });

  it("never returns a value that rounds up to the period in fp32", () => {
    // The wrapped offsets are uploaded through a Float32Array, and a
    // float64 value a hair under the period rounds to the period itself
    // there — one lattice period is the same point, so it comes back as 0.
    const w = wrapFlow(NOISE_PERIOD - 1e-9);
    expect(w).toBe(0);
    expect(Math.fround(w)).toBeLessThan(NOISE_PERIOD);
  });

  it("wrapFlow reduces into [0, NOISE_PERIOD) and is congruent to its input", () => {
    for (const x of [0, 1.5, -1.5, NOISE_PERIOD, -NOISE_PERIOD, 1e9 + 0.25, -1e9 - 0.25]) {
      const w = wrapFlow(x);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThan(NOISE_PERIOD);
      expect(Number.isInteger((x - w) / NOISE_PERIOD)).toBe(true);
      expect(Math.fround(w)).toBeLessThan(NOISE_PERIOD);
    }
  });

  it("declares 32-bit ints before the hash, and hashes the masked lattice", () => {
    // The two halves of the mobile-precision fix: real 32-bit integer ops,
    // and a wrap on the cell index rather than a fract() of a large product.
    expect(NOISE_HASH_GLSL.indexOf("precision highp int;")).toBeLessThan(NOISE_HASH_GLSL.indexOf("uint uhash"));
    expect(NOISE_HASH_GLSL).toContain("ivec2(cell) & ivec2(mask)");
    expect(NOISE_HASH_GLSL).not.toMatch(/fract\(/);
  });
});
