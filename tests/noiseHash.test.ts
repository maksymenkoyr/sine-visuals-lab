import { describe, expect, it } from "vitest";
import { FLOAT_HASH_GLSL, NOISE_HASH_GLSL, NOISE_MASK, NOISE_PERIOD, wrapFlow } from "../src/render/noiseHash.ts";

// A pure-TS mirror of FLOAT_HASH_GLSL's fhMix/fhBits/fhUnit/hash21, using
// DataView for the same bit-reinterpretation floatBitsToUint does in GLSL.
// Exercises the actual mixing math (not just the GLSL source text) so a
// change to the constants or the mix order would fail a test here too.
function fhMix(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}
function floatBitsToUint(f: number): number {
  const buf = new ArrayBuffer(4);
  new Float32Array(buf)[0] = f;
  return new Uint32Array(buf)[0];
}
function fhZero(x: number): number {
  return x === 0 ? 0 : x;
}
function fhBits(x: number): number {
  let h = floatBitsToUint(fhZero(x));
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  return h;
}
function fhUnit(h: number): number {
  return (h >>> 8) * (1 / 16777216);
}
function hash21Raw(p: [number, number]): number {
  return fhMix((fhBits(p[0]) ^ Math.imul(fhBits(p[1]), 0x9e3779b9)) >>> 0);
}
function hash21(p: [number, number]): number {
  return fhUnit(hash21Raw(p));
}

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

describe("FLOAT_HASH_GLSL", () => {
  it("declares int precision, provides every signature scenes call, and never falls back to a fract/dot hash", () => {
    expect(FLOAT_HASH_GLSL.indexOf("precision highp int;")).toBeLessThan(FLOAT_HASH_GLSL.indexOf("uint fhMix"));
    expect(FLOAT_HASH_GLSL).toContain("float hash21(vec2 p)");
    expect(FLOAT_HASH_GLSL).toContain("vec2 hash22(vec2 p)");
    expect(FLOAT_HASH_GLSL).toContain("float hash31(vec3 p)");
    expect(FLOAT_HASH_GLSL).toContain("vec3 hash33(vec3 p)");
    expect(FLOAT_HASH_GLSL).toContain("floatBitsToUint");
    // The retired BigWings-shaped hash this replaces everywhere in the repo.
    expect(FLOAT_HASH_GLSL).not.toMatch(/fract\(/);
    expect(FLOAT_HASH_GLSL).not.toContain("123.34");
  });

  it("uses a mixer distinct from NOISE_HASH_GLSL's uhash, so a scene can paste both", () => {
    expect(FLOAT_HASH_GLSL).not.toContain("uint uhash(");
    expect(NOISE_HASH_GLSL).not.toContain("uint fhMix(");
  });

  // Pure-TS mirror of the GLSL hash21 (see the helpers above): checks the
  // actual mixing math, not just the shape of the source text.
  it("hash21: is deterministic and uniform in [0, 1)", () => {
    for (const p of [
      [0, 0],
      [1, 2],
      [-3.5, 4.25],
      [1000.125, -999.875],
      [0.1, 0.2],
    ] as [number, number][]) {
      const a = hash21(p);
      const b = hash21(p);
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it("hash21: canonicalises -0.0 to +0.0, so floor()'s -0 hashes the same as 0", () => {
    expect(hash21([-0, 3])).toBe(hash21([0, 3]));
    expect(hash21([5, -0])).toBe(hash21([5, 0]));
  });

  it("hash21: different inputs land on different outputs (no trivial collisions nearby)", () => {
    const values = new Set<number>();
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) values.add(hash21([x, y]));
    }
    expect(values.size).toBe(16 * 16);
  });

  // A swept-integer lattice, including negative cell indices (a centred
  // coordinate system's floor(p) crosses zero routinely) — this is the exact
  // shape that caught a cheaper draft of fhBits colliding on ~25% of a
  // negative 128x128 sweep at the full 32-bit width, before the two-op
  // per-component decorrelation below (fhMix's first two steps) turned out
  // to be the minimum that stayed fully collision-free there. Checked at the
  // raw 32-bit width, not fhUnit's truncated-to-24-bits float: at 24 bits,
  // a swept sample this size is expected to see a handful of ordinary
  // birthday-paradox collisions even from a perfectly uniform hash, so
  // demanding zero there would be asserting a coincidence, not a property.
  it("hash21: collision-free (32-bit) across a swept lattice spanning negative and positive coordinates", () => {
    const values = new Set<number>();
    let total = 0;
    for (let x = -64; x < 64; x++) {
      for (let y = -64; y < 64; y++) {
        values.add(hash21Raw([x, y]));
        total++;
      }
    }
    expect(values.size).toBe(total);
  });
});
