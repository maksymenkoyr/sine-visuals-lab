import { describe, it, expect } from "vitest";
import {
  buildCloud,
  buildLobes,
  createRng,
  createStrikePool,
  insideCloud,
  particleCountForQuality,
  sampleStrikeSegment,
  strikeEnvelope,
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

describe("storm cloud sampler", () => {
  it("is deterministic for a given seed", () => {
    const a = buildCloud(2000, 9);
    const b = buildCloud(2000, 9);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.seeds)).toEqual(Array.from(b.seeds));
  });

  it("lays out count xyz triples, every one inside the bounding ellipsoid, with seeds in [0,1)", () => {
    const { positions, seeds } = buildCloud(5000, 3);
    expect(positions.length).toBe(15000);
    expect(seeds.length).toBe(5000);
    for (let i = 0; i < 5000; i++) {
      expect(insideCloud(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])).toBe(true);
      expect(seeds[i]).toBeGreaterThanOrEqual(0);
      expect(seeds[i]).toBeLessThan(1);
    }
  });

  it("any prefix is a representative subsample — the first half and second half share a centroid", () => {
    // Cloud density draws a prefix of the buffer; if particles were laid
    // down lobe by lobe, thinning the cloud would delete whole lobes.
    const n = 40000;
    const { positions } = buildCloud(n, 11);
    const centroid = (from: number, to: number) => {
      const c = [0, 0, 0];
      for (let i = from; i < to; i++) {
        c[0] += positions[i * 3];
        c[1] += positions[i * 3 + 1];
        c[2] += positions[i * 3 + 2];
      }
      return c.map((v) => v / (to - from));
    };
    const a = centroid(0, n / 2);
    const b = centroid(n / 2, n);
    for (let k = 0; k < 3; k++) expect(Math.abs(a[k] - b[k])).toBeLessThan(0.05);
  });
});

describe("storm particle budget", () => {
  it("caps the high preset and floors the floor preset", () => {
    expect(particleCountForQuality(200_000)).toBe(120_000);
    expect(particleCountForQuality(4_000)).toBe(4_000);
    expect(particleCountForQuality(1_600)).toBe(4_000); // a floor-preset gallery tile
    expect(particleCountForQuality(50_000)).toBe(50_000);
  });
});
