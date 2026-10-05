import { describe, expect, it } from "vitest";
import { bitonicPasses, bitonicStageCpu, mortonCell, sortLayout, SORT_GRID_BITS } from "../src/render/scenes/physarum2Sort.ts";

describe("sortLayout", () => {
  it("covers the agent texture with a power-of-two count in a near-square power-of-two target", () => {
    for (const slots of [1, 2, 3, 1000, 4096, 4097, 895 * 895, 2 ** 20]) {
      const l = sortLayout(slots);
      expect(l.n).toBeGreaterThanOrEqual(slots);
      expect(l.n).toBe(2 ** l.log2n);
      expect(l.n / 2).toBeLessThan(Math.max(2, slots));
      expect(l.w * l.h).toBe(l.n);
      expect(Number.isInteger(Math.log2(l.w))).toBe(true);
      expect(l.w).toBeGreaterThanOrEqual(l.h);
      expect(l.w / l.h).toBeLessThanOrEqual(2);
    }
  });
});

describe("bitonicPasses", () => {
  it("lists log2n·(log2n+1)/2 stages, ending on the final ascending merge", () => {
    for (const m of [1, 4, 10, 20]) {
      const p = bitonicPasses(m);
      expect(p.length).toBe((m * (m + 1)) / 2);
      expect(p[p.length - 1]).toEqual({ k: 2 ** m, j: 1 });
    }
  });
});

describe("mortonCell", () => {
  it("interleaves the cell's x and y bits, x lowest", () => {
    const g = 2 ** SORT_GRID_BITS;
    expect(mortonCell(0, 0)).toBe(0);
    expect(mortonCell(1 / g, 0)).toBe(1);
    expect(mortonCell(0, 1 / g)).toBe(2);
    expect(mortonCell(1 / g, 1 / g)).toBe(3);
    expect(mortonCell(0.999999, 0.999999)).toBe(4 ** SORT_GRID_BITS - 1);
  });
  it("clamps positions at the edges into the grid", () => {
    expect(mortonCell(1, 1)).toBe(4 ** SORT_GRID_BITS - 1);
    expect(mortonCell(-0.1, -0.1)).toBe(0);
  });
});

describe("the shader's sort network (CPU twin)", () => {
  function sortAll(keys: number[]): { key: Uint32Array; idx: Uint32Array } {
    const l = sortLayout(keys.length);
    let key = new Uint32Array(l.n).fill(0xffffffff);
    let idx = new Uint32Array(l.n);
    keys.forEach((k, i) => (key[i] = k));
    for (let i = 0; i < l.n; i++) idx[i] = i;
    let k2 = new Uint32Array(l.n);
    let i2 = new Uint32Array(l.n);
    for (const { k, j } of bitonicPasses(l.log2n)) {
      bitonicStageCpu(key, idx, k2, i2, k, j);
      [key, k2] = [k2, key];
      [idx, i2] = [i2, idx];
    }
    return { key, idx };
  }

  it("sorts by key, ties by index, and every stage stays a permutation", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (const count of [5, 64, 300, 1000]) {
      // Few distinct keys, so ties are everywhere — the case a sloppy
      // compare would duplicate or drop an agent on.
      const keys = Array.from({ length: count }, () => Math.floor(rnd() * 16));
      const { key, idx } = sortAll(keys);
      const seen = new Set<number>();
      for (let i = 0; i < key.length; i++) {
        seen.add(idx[i]!);
        if (i > 0) {
          const before = key[i - 1]! < key[i]! || (key[i - 1] === key[i] && idx[i - 1]! < idx[i]!);
          expect(before).toBe(true);
        }
        if (idx[i]! < count) expect(key[i]).toBe(keys[idx[i]!]);
      }
      expect(seen.size).toBe(key.length);
      // The padding sorts to the end, so slots below `count` hold real agents.
      for (let i = 0; i < count; i++) expect(idx[i]!).toBeLessThan(count);
    }
  });
});
