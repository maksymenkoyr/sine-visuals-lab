import { describe, expect, it } from "vitest";
import {
  advanceOnsetEnvelope,
  createOnsetEnvelope,
  createRng,
  buildWall,
  layoutSlats,
  packSlats,
  partitionSlabs,
  shouldReshuffle,
  SLAT_STRIDE,
  type Slab,
} from "../src/render/scenes/slats/layout.ts";

const WIDTH = 2;
const PART = { minWidthFrac: 0.035, maxWidthFrac: 0.16, layers: 3 };
const HAIR = { hairFraction: 0.12, hairScale: 0.35, hairMax: 1, stepMin: 4, stepMax: 18, stepSpan: 0.18, alphaJitter: 0.35 };

describe("partitionSlabs", () => {
  it("tiles the width contiguously with no gaps or overlaps", () => {
    const slabs = partitionSlabs(createRng(7), WIDTH, PART);
    expect(slabs.length).toBeGreaterThan(5);
    expect(slabs[0].x0).toBeCloseTo(-WIDTH / 2, 9);
    expect(slabs[slabs.length - 1].x1).toBeCloseTo(WIDTH / 2, 9);
    for (let i = 1; i < slabs.length; i++) expect(slabs[i].x0).toBe(slabs[i - 1].x1);
  });

  it("keeps every slab but the last within the configured width range", () => {
    const slabs = partitionSlabs(createRng(11), WIDTH, PART);
    const minW = PART.minWidthFrac * WIDTH;
    const maxW = PART.maxWidthFrac * WIDTH;
    for (const s of slabs.slice(0, -1)) {
      const w = s.x1 - s.x0;
      expect(w).toBeGreaterThanOrEqual(minW - 1e-9);
      expect(w).toBeLessThanOrEqual(maxW + 1e-9);
    }
    const last = slabs[slabs.length - 1];
    expect(last.x1 - last.x0).toBeLessThanOrEqual(maxW + 1e-9);
  });

  it("draws layers, heights, centres and alphas within their bounds", () => {
    const slabs = partitionSlabs(createRng(3), WIDTH, PART);
    for (const s of slabs) {
      expect(Number.isInteger(s.layer)).toBe(true);
      expect(s.layer).toBeGreaterThanOrEqual(0);
      expect(s.layer).toBeLessThan(PART.layers);
      expect(s.halfHeight).toBeGreaterThan(0);
      expect(s.halfHeight).toBeLessThanOrEqual(0.85);
      expect(Math.abs(s.centre)).toBeLessThanOrEqual(0.32);
      expect(s.alpha).toBeGreaterThan(0);
      expect(s.alpha).toBeLessThanOrEqual(0.6);
    }
  });

  it("is deterministic for a seed", () => {
    const a = partitionSlabs(createRng(99), WIDTH, PART);
    const b = partitionSlabs(createRng(99), WIDTH, PART);
    expect(a).toEqual(b);
  });
});

describe("layoutSlats", () => {
  const slabs = partitionSlabs(createRng(5), WIDTH, PART);

  it("returns exactly n slats, monotone in x, each inside its slab", () => {
    for (const n of [7, 300, 2600]) {
      const slats = layoutSlats(slabs, n, createRng(1), HAIR);
      expect(slats).toHaveLength(n);
      for (let i = 1; i < slats.length; i++) expect(slats[i].x).toBeGreaterThanOrEqual(slats[i - 1].x);
      for (const s of slats) {
        const slab = slabs[s.slabIndex];
        expect(s.x).toBeGreaterThanOrEqual(slab.x0);
        expect(s.x).toBeLessThanOrEqual(slab.x1);
        expect(s.slabHalfHeight).toBeGreaterThanOrEqual(slab.halfHeight * (1 - HAIR.stepSpan) - 1e-9);
        expect(s.slabHalfHeight).toBeLessThanOrEqual(slab.halfHeight * (1 + HAIR.stepSpan) + 1e-9);
        expect(s.slabCentre).toBe(slab.centre);
        expect(s.layer).toBe(slab.layer);
        expect(s.alpha).toBeGreaterThanOrEqual(slab.alpha * (1 - HAIR.alphaJitter) - 1e-9);
        expect(s.alpha).toBeLessThanOrEqual(slab.alpha * (1 + HAIR.alphaJitter) + 1e-9);
      }
    }
  });

  it("gives roughly hairFraction of slats a non-negative, capped hairExtra", () => {
    const slats = layoutSlats(slabs, 4000, createRng(2), HAIR);
    const hairs = slats.filter((s) => s.hairExtra > 0);
    const frac = hairs.length / slats.length;
    expect(frac).toBeGreaterThan(HAIR.hairFraction * 0.7);
    expect(frac).toBeLessThan(HAIR.hairFraction * 1.3);
    for (const s of slats) {
      expect(s.hairExtra).toBeGreaterThanOrEqual(0);
      expect(s.hairExtra).toBeLessThanOrEqual(HAIR.hairMax);
    }
  });

  it("shares one step factor across runs of neighbouring slats", () => {
    const slab: Slab = { x0: -1, x1: 1, halfHeight: 0.5, centre: 0, layer: 0, alpha: 0.4 };
    const slats = layoutSlats([slab], 400, createRng(9), HAIR);
    let runs = 1;
    for (let i = 1; i < slats.length; i++) if (slats[i].slabHalfHeight !== slats[i - 1].slabHalfHeight) runs++;
    expect(runs).toBeGreaterThan(400 / HAIR.stepMax - 1);
    expect(runs).toBeLessThan(400 / HAIR.stepMin + 1);
  });

  it("handles empty input", () => {
    expect(layoutSlats([], 10, createRng(1), HAIR)).toEqual([]);
    expect(layoutSlats(slabs, 0, createRng(1), HAIR)).toEqual([]);
  });
});

describe("buildWall", () => {
  it("gives every layer a full-width partition and an equal share of slats", () => {
    const n = 1000;
    const slats = buildWall(createRng(21), WIDTH, PART, n, HAIR);
    expect(slats).toHaveLength(n);
    for (let layer = 0; layer < PART.layers; layer++) {
      const mine = slats.filter((s) => s.layer === layer);
      expect(Math.abs(mine.length - n / PART.layers)).toBeLessThanOrEqual(1);
      expect(mine[0].x).toBeLessThan(-WIDTH / 2 + 0.05);
      expect(mine[mine.length - 1].x).toBeGreaterThan(WIDTH / 2 - 0.05);
      for (let i = 1; i < mine.length; i++) expect(mine[i].x).toBeGreaterThanOrEqual(mine[i - 1].x);
    }
  });
});

describe("packSlats", () => {
  it("packs SLAT_STRIDE floats per slat in field order", () => {
    const slab: Slab = { x0: -1, x1: 1, halfHeight: 0.3, centre: 0.1, layer: 2, alpha: 0.4 };
    const slats = layoutSlats([slab], 3, createRng(4), HAIR);
    const packed = packSlats(slats);
    expect(packed.length).toBe(3 * SLAT_STRIDE);
    for (let i = 0; i < 3; i++) {
      const o = i * SLAT_STRIDE;
      const s = slats[i];
      expect(packed[o]).toBeCloseTo(s.x, 6);
      expect(packed[o + 1]).toBeCloseTo(s.slabHalfHeight, 6);
      expect(packed[o + 2]).toBeCloseTo(s.slabCentre, 6);
      expect(packed[o + 3]).toBeCloseTo(s.alpha, 6);
      expect(packed[o + 4]).toBe(s.layer);
      expect(packed[o + 5]).toBeCloseTo(s.hairExtra, 6);
      expect(packed[o + 6]).toBeCloseTo(s.seed, 3);
      expect(packed[o + 7]).toBe(s.slabIndex);
    }
  });
});

describe("onset envelope", () => {
  it("snaps to 1 on an onset and decays afterwards", () => {
    const env = createOnsetEnvelope();
    expect(advanceOnsetEnvelope(env, 1 / 60, false)).toBe(0);
    expect(advanceOnsetEnvelope(env, 1 / 60, true)).toBe(1);
    const a = advanceOnsetEnvelope(env, 0.1, false);
    const b = advanceOnsetEnvelope(env, 0.1, false);
    expect(a).toBeLessThan(1);
    expect(b).toBeLessThan(a);
    expect(b).toBeGreaterThan(0);
  });

  it("retriggers mid-decay and ignores a bad dt", () => {
    const env = createOnsetEnvelope();
    advanceOnsetEnvelope(env, 0, true);
    advanceOnsetEnvelope(env, 0.05, false);
    expect(advanceOnsetEnvelope(env, 0.05, true)).toBe(1);
    expect(advanceOnsetEnvelope(env, Number.NaN, false)).toBe(1);
    expect(advanceOnsetEnvelope(env, -1, false)).toBe(1);
  });
});

describe("shouldReshuffle", () => {
  const always = () => 0;
  it("fires only on a bar wrap while the clock is locked", () => {
    expect(shouldReshuffle(0.9, 0.05, 1, 1, always)).toBe(true);
    expect(shouldReshuffle(0.2, 0.3, 1, 1, always)).toBe(false);
    expect(shouldReshuffle(0.9, 0.05, 0.2, 1, always)).toBe(false);
  });

  it("respects the probability", () => {
    expect(shouldReshuffle(0.9, 0.05, 1, 0.3, () => 0.5)).toBe(false);
    expect(shouldReshuffle(0.9, 0.05, 1, 0.3, () => 0.1)).toBe(true);
    expect(shouldReshuffle(0.9, 0.05, 1, 0, always)).toBe(false);
  });
});
