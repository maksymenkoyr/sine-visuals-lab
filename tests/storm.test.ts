import { describe, it, expect } from "vitest";
import {
  buildLobes,
  buildNoiseVolume,
  buildShapeVolume,
  createRng,
  createStrikePool,
  insideCloud,
  sampleStrikeSegment,
  shapeAt,
  strikeEnvelope,
  type Lobe,
} from "../src/render/scenes/storm.ts";

describe("storm strike envelope", () => {
  it("is exactly 1 at the instant of the strike", () => {
    expect(strikeEnvelope(0, 0.3, 0.4, 0.5)).toBe(1);
  });

  it("is 0 before the strike and for a non-finite age", () => {
    expect(strikeEnvelope(-0.01, 0.3, 0.4, 0.5)).toBe(0);
    expect(strikeEnvelope(Number.NaN, 0.3, 0.4, 0.5)).toBe(0);
  });

  it("with Flicker off is a single stroke: strictly decreasing over the first second", () => {
    let prev = strikeEnvelope(0, 0.7, 0.4, 0);
    for (let t = 0.005; t <= 1; t += 0.005) {
      const v = strikeEnvelope(t, 0.7, 0.4, 0);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });

  it("has faded to nothing well within a bar at any afterglow", () => {
    expect(strikeEnvelope(5, 0.2, 0, 1)).toBeLessThan(1e-3);
    expect(strikeEnvelope(5, 0.2, 1, 1)).toBeLessThan(1e-3);
  });

  it("with Flicker up, a return stroke re-brightens the strike within 0.3 s", () => {
    let rises = 0;
    let prev = strikeEnvelope(0, 0.7, 0.4, 1);
    for (let t = 0.002; t <= 0.3; t += 0.002) {
      const v = strikeEnvelope(t, 0.7, 0.4, 1);
      if (v > prev) rises++;
      prev = v;
    }
    expect(rises).toBeGreaterThan(0);
  });

  it("a longer Afterglow keeps the strike brighter 200 ms in", () => {
    expect(strikeEnvelope(0.2, 0.7, 1, 0)).toBeGreaterThan(strikeEnvelope(0.2, 0.7, 0, 0));
  });

  it("the return-stroke pattern is stable for a given seed", () => {
    for (let t = 0; t < 0.5; t += 0.01) {
      expect(strikeEnvelope(t, 42, 0.5, 1)).toBe(strikeEnvelope(t, 42, 0.5, 1));
    }
  });

  it("never produces NaN, a negative value, or more than its documented cap across a random sweep", () => {
    for (let i = 0; i < 2000; i++) {
      const v = strikeEnvelope(Math.random() * 3, Math.random() * 1000, Math.random(), Math.random());
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1.5);
    }
  });
});

describe("storm strike pool", () => {
  const lobes = buildLobes(createRng(7));

  it("uploads the strike at full amplitude on the frame it fires", () => {
    const pool = createStrikePool(lobes, createRng(1));
    expect(pool.trigger(0.9)).toBe(true);
    const live = Array.from(pool.strength).filter((s) => s > 0);
    expect(live).toHaveLength(1);
    expect(live[0]).toBeCloseTo(0.9, 5);
  });

  it("an inactive pool contributes nothing", () => {
    const pool = createStrikePool(lobes, createRng(1));
    pool.tick(1 / 60, 0.4, 0.5);
    expect(Array.from(pool.strength).every((s) => s === 0)).toBe(true);
  });

  it("reclaims the slot that has been fading the longest, never the newest", () => {
    const pool = createStrikePool(lobes, createRng(2));
    const slotOf = (amp: number) => pool.strength.indexOf(amp);
    // Fill every slot with a distinguishable amplitude, spaced by more than
    // the refractory window.
    const amps = [0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18];
    for (const a of amps) {
      pool.trigger(a);
      pool.tick(0.001, 1, 0); // long afterglow: decay is negligible over 1 ms
      pool.tick(0.1, 1, 0);
    }
    const newestSlot = slotOf(pool.strength[7]);
    // The ninth strike must land in the first (oldest) slot, not the newest.
    const before = Array.from(pool.strength);
    pool.trigger(0.5);
    const reclaimed = slotOf(0.5);
    expect(reclaimed).toBe(before.indexOf(Math.min(...before)));
    expect(reclaimed).not.toBe(newestSlot);
  });

  it("folds a second trigger inside the refractory window into the first", () => {
    const pool = createStrikePool(lobes, createRng(3));
    expect(pool.trigger(1)).toBe(true);
    pool.tick(0.016, 0.4, 0.5); // the next frame: a broadband beat right after a low onset
    expect(pool.trigger(1)).toBe(false);
    expect(Array.from(pool.strength).filter((s) => s > 0)).toHaveLength(1);
    pool.tick(0.1, 0.4, 0.5);
    expect(pool.trigger(1)).toBe(true);
  });

  it("a forced trigger (drop burst) ignores the refractory window", () => {
    const pool = createStrikePool(lobes, createRng(4));
    expect(pool.trigger(1)).toBe(true);
    expect(pool.trigger(1.5, true)).toBe(true);
    expect(pool.trigger(1.5, true)).toBe(true);
    expect(Array.from(pool.strength).filter((s) => s > 0)).toHaveLength(3);
  });

  it("keeps every strike's segment inside the cloud, no longer than STRIKE_LEN_MAX", () => {
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) {
      const [ax, ay, az, bx, by, bz] = sampleStrikeSegment(rng, lobes);
      expect(insideCloud(ax, ay, az)).toBe(true);
      expect(insideCloud(bx, by, bz)).toBe(true);
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      expect(len).toBeGreaterThan(0);
      expect(len).toBeLessThanOrEqual(0.6 + 1e-9);
    }
  });
});

describe("storm noise volume", () => {
  // A small volume: the generator is resolution-independent (every lattice is
  // defined over the unit cube), so the properties below hold at any size.
  const SIZE = 32;
  const data = buildNoiseVolume(SIZE, 5);
  const at = (x: number, y: number, z: number, channel: number) =>
    data[(((z * SIZE + y) * SIZE + x) * 2) + channel];

  it("is two channels of every texel, and deterministic for a given seed", () => {
    expect(data.length).toBe(SIZE * SIZE * SIZE * 2);
    const digest = (v: Uint8Array) => v.reduce((a, b, i) => (a + b * (i % 7 + 1)) % 1e9, 0);
    expect(digest(buildNoiseVolume(SIZE, 5))).toBe(digest(data));
    expect(digest(buildNoiseVolume(SIZE, 6))).not.toBe(digest(data));
  });

  it("uses the whole 0..255 range in both channels, with real variance", () => {
    // Uint8Array already guarantees whole values in 0..255; what matters is
    // that the generator actually fills that range instead of hugging its
    // mean (which is what a mis-normalized octave sum would do).
    for (const channel of [0, 1]) {
      let min = 255;
      let max = 0;
      let sum = 0;
      let sumSq = 0;
      const n = SIZE * SIZE * SIZE;
      for (let i = 0; i < n; i++) {
        const v = data[i * 2 + channel];
        min = Math.min(min, v);
        max = Math.max(max, v);
        sum += v;
        sumSq += v * v;
      }
      const mean = sum / n;
      const sd = Math.sqrt(sumSq / n - mean * mean);
      expect(min).toBeLessThan(100);
      expect(max).toBeGreaterThan(155);
      expect(sd).toBeGreaterThan(15);
    }
  });

  it("tiles: the wrap-around seam is as smooth as any interior step", () => {
    // The texture is sampled with REPEAT wrap, so texel `size` is texel 0. If
    // the lattices didn't wrap, the seam would show as a discontinuity — a
    // much bigger neighbour-to-neighbour jump than anywhere inside.
    const meanDelta = (axis: 0 | 1 | 2, a: number, b: number, channel: number) => {
      let total = 0;
      let count = 0;
      for (let i = 0; i < SIZE; i++) {
        for (let j = 0; j < SIZE; j++) {
          const pa = axis === 0 ? at(a, i, j, channel) : axis === 1 ? at(i, a, j, channel) : at(i, j, a, channel);
          const pb = axis === 0 ? at(b, i, j, channel) : axis === 1 ? at(i, b, j, channel) : at(i, j, b, channel);
          total += Math.abs(pa - pb);
          count++;
        }
      }
      return total / count;
    };

    for (const channel of [0, 1]) {
      for (const axis of [0, 1, 2] as const) {
        const seam = meanDelta(axis, SIZE - 1, 0, channel);
        const interior = meanDelta(axis, SIZE / 2, SIZE / 2 + 1, channel);
        expect(seam).toBeLessThan(interior * 3 + 1);
      }
    }
  });
});

describe("storm shape field", () => {
  const one: Lobe[] = [{ cx: 0, cy: 0, cz: 0, r: 0.4 }];

  it("peaks at a lobe's centre and falls to nothing well outside it", () => {
    expect(shapeAt(one, 0, 0, 0)).toBeCloseTo(1, 3);
    expect(shapeAt(one, 1.2, 0, 0)).toBe(0);
  });

  it("is a cumulus profile: the underside cuts off before the top does", () => {
    // Same distance above and below the lobe centre — the base has to be the
    // one that has already run out, or the cloud reads as a ball.
    const d = 0.6;
    expect(shapeAt(one, 0, d, 0)).toBeGreaterThan(shapeAt(one, 0, -d, 0));
    expect(shapeAt(one, 0, -0.72, 0)).toBe(0);
    expect(shapeAt(one, 0, 0.72, 0)).toBeGreaterThan(0);
  });

  it("smooth-unions neighbouring lobes into one mass instead of two balls", () => {
    // Two lobes far enough apart that a plain max would dip between them;
    // the smooth union has to hold the seam above that dip.
    const pair: Lobe[] = [
      { cx: -0.6, cy: 0, cz: 0, r: 0.4 },
      { cx: 0.6, cy: 0, cz: 0, r: 0.4 },
    ];
    const left = shapeAt([pair[0]], 0, 0, 0);
    const right = shapeAt([pair[1]], 0, 0, 0);
    expect(shapeAt(pair, 0, 0, 0)).toBeGreaterThan(Math.max(left, right));
  });

  it("bakes to size^3 bytes that are zero on every face of the box", () => {
    const size = 16;
    const lobes = buildLobes(createRng(3));
    const data = buildShapeVolume(size, lobes);
    expect(data.length).toBe(size * size * size);
    const at = (x: number, y: number, z: number) => data[(z * size + y) * size + x];
    for (let a = 0; a < size; a++) {
      for (let b = 0; b < size; b++) {
        // Every box face lies outside the bounding ellipsoid, which is what
        // makes the shader's CLAMP_TO_EDGE lookup safe.
        expect(at(0, a, b)).toBe(0);
        expect(at(size - 1, a, b)).toBe(0);
        expect(at(a, 0, b)).toBe(0);
        expect(at(a, size - 1, b)).toBe(0);
        expect(at(a, b, 0)).toBe(0);
        expect(at(a, b, size - 1)).toBe(0);
      }
    }
    expect(Math.max(...data)).toBeGreaterThan(200);
  });
});
