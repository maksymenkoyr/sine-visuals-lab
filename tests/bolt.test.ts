import { describe, it, expect } from "vitest";
import {
  BOLT_PATH_VERTS,
  BOLT_RIBBON_VERTS,
  BOLT_SEGMENTS,
  BOLT_VERT_FLOATS,
  buildBoltTree,
  createRng,
  jagPolyline,
  strikeEnvelope,
} from "../src/render/bolt.ts";
import {
  BOLT_BOIL_MIN,
  BOLT_BOIL_SEC,
  BOLT_CUTOFF,
  BOLT_REFRACTORY,
  MAX_BOLTS,
  createBoltPool,
} from "../src/render/scenes/fluidBolts.ts";

describe("bolt strike envelope", () => {
  it("is exactly 1 at the instant of the strike", () => {
    expect(strikeEnvelope(0, 0.3, 0.4, 0.5)).toBe(1);
  });

  it("is 0 before the strike and for a non-finite age", () => {
    expect(strikeEnvelope(-0.01, 0.3, 0.4, 0.5)).toBe(0);
    expect(strikeEnvelope(Number.NaN, 0.3, 0.4, 0.5)).toBe(0);
  });

  it("with flicker off is a single stroke: strictly decreasing over the first second", () => {
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

  it("with flicker up, a return stroke re-brightens the strike within 0.3 s", () => {
    let rises = 0;
    let prev = strikeEnvelope(0, 0.7, 0.4, 1);
    for (let t = 0.002; t <= 0.3; t += 0.002) {
      const v = strikeEnvelope(t, 0.7, 0.4, 1);
      if (v > prev) rises++;
      prev = v;
    }
    expect(rises).toBeGreaterThan(0);
  });

  it("with flicker at 0, never rises after the initial decay begins", () => {
    let rises = 0;
    let prev = strikeEnvelope(0, 0.7, 0.4, 0);
    for (let t = 0.002; t <= 1; t += 0.002) {
      const v = strikeEnvelope(t, 0.7, 0.4, 0);
      if (v > prev) rises++;
      prev = v;
    }
    expect(rises).toBe(0);
  });

  it("a longer afterglow keeps the strike brighter 200 ms in", () => {
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

describe("jagPolyline", () => {
  it("pins both endpoints exactly, whatever the jitter", () => {
    const rng = createRng(11);
    const a = [-0.3, 0.6, 0];
    const b = [0.9, -0.2, 0];
    const out = jagPolyline(rng, a, b, 12, 0.4);
    expect(out[0]).toBeCloseTo(a[0], 6);
    expect(out[1]).toBeCloseTo(a[1], 6);
    expect(out[2]).toBeCloseTo(a[2], 6);
    expect(out[12 * 3]).toBeCloseTo(b[0], 6);
    expect(out[12 * 3 + 1]).toBeCloseTo(b[1], 6);
    expect(out[12 * 3 + 2]).toBeCloseTo(b[2], 6);
  });

  it("displaces at least one interior vertex off the straight line", () => {
    const rng = createRng(12);
    const a = [0, 0, 0];
    const b = [1, 0, 0];
    const out = jagPolyline(rng, a, b, 8, 0.3);
    let offAxis = 0;
    for (let i = 1; i < 8; i++) if (Math.abs(out[i * 3 + 1]) > 1e-6) offAxis++;
    expect(offAxis).toBeGreaterThan(0);
  });
});

describe("buildBoltTree", () => {
  const STRIDE = BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS;
  const cases: [number[], number[]][] = [
    [[-0.4, 0.1, 0], [0.5, -0.2, 0]],
    [[0.02, 0.1, 0], [0.3, 0.7, 0]],
    [[0, 0, 0], [1, 1, 0]],
  ];

  /** One path vertex out of the ribbon layout: buildBoltTree writes each of
   *  them twice, once per side, so the pair at 2i is the vertex at i. */
  const vertAt = (buf: Float32Array, i: number) => {
    const o = i * 2 * BOLT_VERT_FLOATS;
    return { p: [buf[o], buf[o + 1], buf[o + 2]], w: buf[o + 6] };
  };

  it("writes exactly BOLT_RIBBON_VERTS ribbon vertices", () => {
    const tree = buildBoltTree(createRng(1), cases[0][0], cases[0][1]);
    expect(tree.length).toBe(STRIDE);
    expect(tree.length / BOLT_VERT_FLOATS).toBe(BOLT_RIBBON_VERTS);
  });

  it("the first and last path vertex of the main channel are zero width", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const tree = buildBoltTree(createRng(seed), cases[0][0], cases[0][1]);
      expect(vertAt(tree, 0).w).toBe(0);
      expect(vertAt(tree, BOLT_SEGMENTS).w).toBe(0);
    }
  });

  it("starts and ends the main channel exactly on a and b", () => {
    const [a, b] = cases[1];
    const tree = buildBoltTree(createRng(2), a, b);
    const first = vertAt(tree, 0).p;
    const last = vertAt(tree, BOLT_SEGMENTS).p;
    for (let k = 0; k < 3; k++) {
      expect(first[k]).toBeCloseTo(a[k], 5);
      expect(last[k]).toBeCloseTo(b[k], 5);
    }
  });

  it("keeps every position finite and inside the a-b bounding box padded by the bolt's own length", () => {
    // buildBoltTree kinks the main channel by up to ~2 * BOLT_JITTER of its
    // length and forks branches off it that run out to a further fraction of
    // their parent's length at an angle — an empirical sweep over many random
    // segments and seeds put the worst-case excursion (lateral plus overshoot
    // past either tip) at a bit over one segment length, so padding the a-b
    // bounding box by 2x the segment's own length is comfortably generous
    // without being a no-op check. The jitter direction is a genuine 3D
    // perpendicular even when a and b share z = 0 (removing the along-axis
    // component doesn't zero out z on its own), so a "2D" tree still wanders
    // in z by up to the same padding — harmless for a caller (the Fluid
    // scene's shader reads only aPos.xy) but real, so the box covers z too.
    for (const [a, b] of cases) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1e-6;
      const pad = 2 * len;
      const minX = Math.min(a[0], b[0]) - pad;
      const maxX = Math.max(a[0], b[0]) + pad;
      const minY = Math.min(a[1], b[1]) - pad;
      const maxY = Math.max(a[1], b[1]) + pad;
      const minZ = Math.min(a[2], b[2]) - pad;
      const maxZ = Math.max(a[2], b[2]) + pad;
      for (let seed = 1; seed <= 25; seed++) {
        const tree = buildBoltTree(createRng(seed), a, b);
        for (let i = 0; i < BOLT_PATH_VERTS; i++) {
          const p = vertAt(tree, i).p;
          expect(p.every((v) => Number.isFinite(v))).toBe(true);
          expect(p[0]).toBeGreaterThanOrEqual(minX);
          expect(p[0]).toBeLessThanOrEqual(maxX);
          expect(p[1]).toBeGreaterThanOrEqual(minY);
          expect(p[1]).toBeLessThanOrEqual(maxY);
          expect(p[2]).toBeGreaterThanOrEqual(minZ);
          expect(p[2]).toBeLessThanOrEqual(maxZ);
        }
      }
    }
  });

  it("is deterministic for a given rng, and different for a different one", () => {
    const [a, b] = cases[0];
    const t1 = Array.from(buildBoltTree(createRng(4), a, b));
    const t2 = Array.from(buildBoltTree(createRng(4), a, b));
    const t3 = Array.from(buildBoltTree(createRng(5), a, b));
    expect(t1).toEqual(t2);
    expect(t1).not.toEqual(t3);
  });

  it("writes into a shared buffer at the offset it is given, touching nothing else", () => {
    const [a, b] = cases[0];
    const out = new Float32Array(STRIDE * 2);
    buildBoltTree(createRng(3), a, b, out, STRIDE);
    expect(Array.from(out.subarray(0, STRIDE)).every((v) => v === 0)).toBe(true);
    expect(out[STRIDE]).toBeCloseTo(a[0], 5);
    expect(out[STRIDE + 1]).toBeCloseTo(a[1], 5);
  });
});

describe("createBoltPool", () => {
  it("blocks a second strike inside the refractory window", () => {
    const pool = createBoltPool(createRng(1));
    expect(pool.strike(0.1, 0.1, 0.5, 0.5, 1)).toBe(true);
    expect(pool.strike(0.2, 0.2, 0.6, 0.6, 1)).toBe(false);
    expect(Array.from(pool.strengths).filter((s) => s > 0)).toHaveLength(1);
  });

  it("allows a strike again once the refractory window has passed", () => {
    const pool = createBoltPool(createRng(2));
    expect(pool.strike(0.1, 0.1, 0.5, 0.5, 1)).toBe(true);
    pool.tick(BOLT_REFRACTORY + 0.01, 0.4, 0.5);
    expect(pool.strike(0.2, 0.2, 0.6, 0.6, 1)).toBe(true);
  });

  it("a forced strike ignores the refractory window", () => {
    const pool = createBoltPool(createRng(3));
    expect(pool.strike(0, 0, 1, 1, 1)).toBe(true);
    expect(pool.strike(0, 0, 1, 1, 1, true)).toBe(true);
    expect(Array.from(pool.strengths).filter((s) => s > 0)).toHaveLength(2);
  });

  it("reclaims the slot that has been fading the longest, never the newest", () => {
    const pool = createBoltPool(createRng(4));
    const slotOf = (amp: number) => Array.from(pool.strengths).indexOf(amp);
    const amps = Array.from({ length: MAX_BOLTS }, (_, i) => 0.11 + i * 0.01);
    for (const a of amps) {
      pool.strike(0.1, 0.1, 0.5, 0.5, a);
      pool.tick(0.001, 1, 0); // long afterglow: decay is negligible over 1 ms
      pool.tick(0.1, 1, 0);
    }
    const newestSlot = slotOf(pool.strengths[MAX_BOLTS - 1]);
    const before = Array.from(pool.strengths);
    pool.strike(0.1, 0.1, 0.5, 0.5, 0.5);
    const reclaimed = slotOf(0.5);
    expect(reclaimed).toBe(before.indexOf(Math.min(...before)));
    expect(reclaimed).not.toBe(newestSlot);
  });

  it("tick decays a fired slot's strength monotonically, then cuts it to exactly 0 under BOLT_CUTOFF and keeps it there", () => {
    const pool = createBoltPool(createRng(5));
    expect(pool.strike(0.1, 0.1, 0.9, 0.9, 1)).toBe(true);
    const slot = Array.from(pool.strengths).findIndex((s) => s > 0);
    expect(pool.strengths[slot]).toBeCloseTo(1, 5);
    let prev = pool.strengths[slot];
    let cut = false;
    for (let i = 0; i < 40; i++) {
      pool.tick(0.02, 0.4, 0);
      const s = pool.strengths[slot];
      if (cut) {
        expect(s).toBe(0);
      } else if (s === 0) {
        expect(prev).toBeLessThan(BOLT_CUTOFF * 1.5); // the cut happens near the threshold, not from full brightness
        cut = true;
      } else {
        expect(s).toBeLessThan(prev);
        expect(s).toBeGreaterThanOrEqual(BOLT_CUTOFF);
      }
      prev = s;
    }
    expect(cut).toBe(true);
  });

  it("an untriggered pool contributes nothing", () => {
    const pool = createBoltPool(createRng(6));
    pool.tick(1 / 60, 0.4, 0.5);
    expect(Array.from(pool.strengths).every((s) => s === 0)).toBe(true);
  });

  it("keeps strike endpoints exactly as given, even outside the screen (a bolt may enter from off-frame)", () => {
    const pool = createBoltPool(createRng(7));
    expect(pool.strike(-0.5, 1.5, 2, -3, 1)).toBe(true);
    const slot = Array.from(pool.strengths).findIndex((s) => s > 0);
    const stride = BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS;
    const o = slot * stride;
    const bOff = o + BOLT_SEGMENTS * 2 * BOLT_VERT_FLOATS;
    expect(pool.paths[o]).toBeCloseTo(-0.5, 5);
    expect(pool.paths[o + 1]).toBeCloseTo(1.5, 5);
    expect(pool.paths[bOff]).toBeCloseTo(2, 5);
    expect(pool.paths[bOff + 1]).toBeCloseTo(-3, 5);
    expect(Array.from(pool.ends.subarray(slot * 4, slot * 4 + 4))).toEqual([-0.5, 1.5, 2, -3]);
  });

  describe("boil", () => {
    const stride = BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS;
    const pathOf = (pool: ReturnType<typeof createBoltPool>, slot: number) =>
      Array.from(pool.paths.subarray(slot * stride, (slot + 1) * stride));

    it("re-jags a live bolt once BOLT_BOIL_SEC has passed, marking it dirty and keeping its endpoints", () => {
      const pool = createBoltPool(createRng(8));
      pool.strike(0.2, -0.2, 0.9, 1.3, 1);
      const slot = Array.from(pool.strengths).findIndex((s) => s > 0);
      pool.dirty[slot] = 0; // pretend the strike's tree was uploaded
      const before = pathOf(pool, slot);
      pool.tick(BOLT_BOIL_SEC * 0.5, 1, 0);
      expect(pool.dirty[slot]).toBe(0);
      expect(pathOf(pool, slot)).toEqual(before);
      pool.tick(BOLT_BOIL_SEC * 0.6, 1, 0);
      expect(pool.dirty[slot]).toBe(1);
      const after = pathOf(pool, slot);
      expect(after).not.toEqual(before);
      // Same endpoints: the main channel still starts on a and ends on b.
      const bOff = BOLT_SEGMENTS * 2 * BOLT_VERT_FLOATS;
      expect(after[0]).toBeCloseTo(0.2, 5);
      expect(after[1]).toBeCloseTo(-0.2, 5);
      expect(after[bOff]).toBeCloseTo(0.9, 5);
      expect(after[bOff + 1]).toBeCloseTo(1.3, 5);
    });

    it("leaves a bolt alone once it has faded below BOLT_BOIL_MIN", () => {
      const pool = createBoltPool(createRng(9));
      pool.strike(0.2, 0.2, 0.9, 0.9, 1);
      const slot = Array.from(pool.strengths).findIndex((s) => s > 0);
      // Short afterglow: well faded after half a second.
      pool.tick(0.5, 0, 0);
      expect(pool.strengths[slot]).toBeLessThan(BOLT_BOIL_MIN);
      pool.dirty[slot] = 0;
      const before = pathOf(pool, slot);
      for (let i = 0; i < 10; i++) pool.tick(BOLT_BOIL_SEC, 0, 0);
      expect(pool.dirty[slot]).toBe(0);
      expect(pathOf(pool, slot)).toEqual(before);
    });
  });
});
