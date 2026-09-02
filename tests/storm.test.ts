import { describe, it, expect } from "vitest";
import {
  BOLT_BRANCH_SEGMENTS,
  BOLT_MAX_BRANCHES,
  BOLT_PATH_VERTS,
  BOLT_RIBBON_VERTS,
  BOLT_SEGMENTS,
  BOLT_VERT_FLOATS,
  MORPH_MAX_STEP,
  SHAPE_VARIANTS,
  STRIKE_LEN_MAX,
  advanceMorphPhase,
  buildBoltTree,
  buildCloud,
  buildFilamentVertices,
  buildFlowVolume,
  buildLobeSets,
  buildLobes,
  buildNoiseVolume,
  filamentStrandCount,
  buildShapeVolume,
  buildSurfaceNet,
  createRng,
  createStrikePool,
  GAS_RECIPES,
  GAS_TYPES,
  insideCloud,
  particleCountForQuality,
  sampleStrikeSegment,
  shapeAt,
  shapePhaseWeights,
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
      expect(len).toBeLessThanOrEqual(STRIKE_LEN_MAX + 1e-9);
    }
  });

  it("draws the fired slot's bolt tree between its own endpoints and marks only it dirty", () => {
    const pool = createStrikePool(lobes, createRng(6));
    expect(Array.from(pool.pathDirty).every((d) => d === 0)).toBe(true);
    expect(pool.trigger(1)).toBe(true);
    const slot = Array.from(pool.pathDirty).indexOf(1);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(Array.from(pool.pathDirty).filter((d) => d === 1)).toHaveLength(1);

    const stride = BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS;
    const o = slot * stride;
    // The main channel leads the slot's slice and still ends on the segment
    // the strike lights the gas with.
    for (let k = 0; k < 3; k++) {
      expect(pool.path[o + k]).toBeCloseTo(pool.posA[slot * 3 + k], 6);
      expect(pool.path[o + BOLT_SEGMENTS * 2 * BOLT_VERT_FLOATS + k]).toBeCloseTo(pool.posB[slot * 3 + k], 6);
    }
    // Every other slot's slice is still untouched.
    for (let i = 0; i < pool.pathDirty.length; i++) {
      if (i === slot) continue;
      const zeros = Array.from(pool.path.subarray(i * stride, (i + 1) * stride));
      expect(zeros.every((v) => v === 0)).toBe(true);
    }
  });

  it("places new strikes in whatever lobes it was last pointed at", () => {
    // The cloud morphs, so render() re-points the pool as the shape phase
    // moves; a strike has to land in the silhouette that is actually drawn.
    const far: Lobe[] = [{ cx: 0, cy: 0.5, cz: 0, r: 0.05 }];
    const pool = createStrikePool(lobes, createRng(8));
    pool.setLobes(far);
    expect(pool.trigger(1)).toBe(true);
    const slot = Array.from(pool.strength).findIndex((s) => s > 0);
    expect(Math.hypot(pool.posA[slot * 3] - 0, pool.posA[slot * 3 + 1] - 0.5, pool.posA[slot * 3 + 2] - 0))
      .toBeLessThan(0.2);
  });
});

describe("storm bolt tree", () => {
  const ends: [number[], number[]] = [[-0.4, 0.1, 0.2], [0.5, -0.2, -0.1]];
  const STRIDE = BOLT_RIBBON_VERTS * BOLT_VERT_FLOATS;

  /** One path vertex out of the ribbon layout: buildBoltTree writes each of
   *  them twice, once per side, so the pair at 2i is the vertex at i. */
  const vertAt = (buf: Float32Array, i: number, base = 0) => {
    const o = base + i * 2 * BOLT_VERT_FLOATS;
    return {
      p: [buf[o], buf[o + 1], buf[o + 2]],
      tan: [buf[o + 3], buf[o + 4], buf[o + 5]],
      w: buf[o + 6],
      level: buf[o + 7],
      mirrorP: [buf[o + BOLT_VERT_FLOATS], buf[o + BOLT_VERT_FLOATS + 1], buf[o + BOLT_VERT_FLOATS + 2]],
      mirrorW: buf[o + BOLT_VERT_FLOATS + 6],
    };
  };

  /** The path-vertex index each polyline of the tree starts at: the main
   *  channel, then one fixed-size slot per branch. */
  const lineStarts = (): number[] => {
    const starts = [0];
    for (let j = 0; j < BOLT_MAX_BRANCHES; j++) {
      starts.push(BOLT_SEGMENTS + 1 + j * (BOLT_BRANCH_SEGMENTS + 1));
    }
    return starts;
  };

  it("fills exactly one strike's budget, with the main channel first and on the strike's endpoints", () => {
    const tree = buildBoltTree(createRng(1), ends[0], ends[1]);
    expect(tree.length).toBe(STRIDE);
    for (let k = 0; k < 3; k++) {
      // Float32 storage, so "exactly" is to the precision the buffer holds.
      expect(vertAt(tree, 0).p[k]).toBeCloseTo(ends[0][k], 6);
      expect(vertAt(tree, BOLT_SEGMENTS).p[k]).toBeCloseTo(ends[1][k], 6);
    }
  });

  it("writes both sides of every ribbon vertex: same point, opposite width", () => {
    const tree = buildBoltTree(createRng(3), ends[0], ends[1]);
    for (let i = 0; i < BOLT_PATH_VERTS; i++) {
      const v = vertAt(tree, i);
      expect(v.p).toEqual(v.mirrorP);
      expect(v.mirrorW).toBe(-v.w);
      expect(Number.isFinite(v.w)).toBe(true);
      expect(Math.hypot(v.tan[0], v.tan[1], v.tan[2])).toBeCloseTo(1, 5);
    }
  });

  it("kinks every interior vertex of the channel, but never far off the straight line", () => {
    // The displacement halves per level, so the whole train sums to well
    // under half the segment's length however deep the recursion goes.
    const [a, b] = ends;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let offAxis = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const tree = buildBoltTree(createRng(seed), a, b);
      for (let i = 1; i < BOLT_SEGMENTS; i++) {
        const p = vertAt(tree, i).p;
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
        const t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (len * len);
        const d = Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
        expect(d).toBeLessThan(len * 0.5);
        if (d > 1e-4) offAxis++;
      }
    }
    expect(offAxis).toBeGreaterThan(0);
  });

  it("tapers every polyline to nothing at both tips, monotonically from its widest vertex", () => {
    // Zero tips are what let the whole tree draw as one triangle strip, and
    // the taper is what makes a branch read as a branch rather than a bar.
    for (let seed = 1; seed <= 20; seed++) {
      const tree = buildBoltTree(createRng(seed), ends[0], ends[1]);
      const starts = lineStarts();
      starts.forEach((start, line) => {
        const n = line === 0 ? BOLT_SEGMENTS + 1 : BOLT_BRANCH_SEGMENTS + 1;
        const w = Array.from({ length: n }, (_, i) => vertAt(tree, start + i).w);
        expect(w[0]).toBe(0);
        expect(w[n - 1]).toBe(0);
        const peak = w.indexOf(Math.max(...w));
        for (let i = 1; i <= peak; i++) expect(w[i]).toBeGreaterThanOrEqual(w[i - 1]);
        for (let i = peak + 1; i < n; i++) expect(w[i]).toBeLessThanOrEqual(w[i - 1]);
      });
    }
  });

  it("branches off vertices that lie on an earlier polyline, thinner than what they left", () => {
    let branches = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const tree = buildBoltTree(createRng(seed), ends[0], ends[1]);
      const starts = lineStarts();
      const mainPeak = Math.max(...Array.from({ length: BOLT_SEGMENTS + 1 }, (_, i) => vertAt(tree, i).w));
      for (let j = 1; j < starts.length; j++) {
        const start = starts[j];
        const w = Array.from({ length: BOLT_BRANCH_SEGMENTS + 1 }, (_, i) => vertAt(tree, start + i).w);
        const peak = Math.max(...w);
        if (peak === 0) continue; // an unfilled branch slot: padding, not a branch
        branches++;
        expect(peak).toBeLessThan(mainPeak);
        expect(vertAt(tree, start).level).toBeGreaterThanOrEqual(1);
        // The root sits exactly on a vertex of the channel it forked from,
        // which is what hides the join.
        const root = vertAt(tree, start).p;
        let onParent = false;
        for (let i = 0; i < start && !onParent; i++) {
          const p = vertAt(tree, i).p;
          onParent = Math.hypot(p[0] - root[0], p[1] - root[1], p[2] - root[2]) < 1e-6;
        }
        expect(onParent).toBe(true);
      }
    }
    expect(branches).toBeGreaterThan(20 * 2);
  });

  it("keeps every vertex in the region a strike could plausibly reach", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const a = sampleStrikeSegment(createRng(seed), buildLobes(createRng(seed + 1)));
      const tree = buildBoltTree(createRng(seed), a.slice(0, 3), a.slice(3));
      for (let i = 0; i < BOLT_PATH_VERTS; i++) {
        const p = vertAt(tree, i).p;
        expect(p.every((v) => Number.isFinite(v))).toBe(true);
        // The cloud's own ellipsoid, loosened for the midpoint jitter and for
        // a branch tip clamped to the surface.
        expect(insideCloud(p[0] / 1.6, p[1] / 1.6, p[2] / 1.6)).toBe(true);
      }
    }
  });

  it("is deterministic for a given rng, and different for a different one", () => {
    const a = Array.from(buildBoltTree(createRng(4), ends[0], ends[1]));
    const b = Array.from(buildBoltTree(createRng(4), ends[0], ends[1]));
    const c = Array.from(buildBoltTree(createRng(5), ends[0], ends[1]));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("writes into a shared buffer at the offset it is given, touching nothing else", () => {
    const out = new Float32Array(STRIDE * 2);
    buildBoltTree(createRng(2), ends[0], ends[1], out, STRIDE);
    expect(Array.from(out.subarray(0, STRIDE)).every((v) => v === 0)).toBe(true);
    expect(vertAt(out, 0, STRIDE).p[0]).toBeCloseTo(ends[0][0], 6);
  });
});

describe("storm shape phase", () => {
  it("blends two adjacent variants, with weights summing to 1", () => {
    for (let p = -3; p <= 9; p += 0.13) {
      const { a, b, f } = shapePhaseWeights(p);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(SHAPE_VARIANTS);
      expect(b).toBe((a + 1) % SHAPE_VARIANTS);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      expect((1 - f) + f).toBeCloseTo(1, 12);
    }
  });

  it("is a pure variant at every whole phase, and loops back to the first", () => {
    expect(shapePhaseWeights(0)).toEqual({ a: 0, b: 1, f: 0 });
    expect(shapePhaseWeights(2)).toEqual({ a: 2, b: 3, f: 0 });
    // The variants are a loop: the phase past the last one wraps to variant 0
    // rather than parking, which is what lets the slow drift keep morphing.
    expect(shapePhaseWeights(SHAPE_VARIANTS)).toEqual({ a: 0, b: 1, f: 0 });
    expect(shapePhaseWeights(SHAPE_VARIANTS - 1).b).toBe(0);
  });
});

describe("storm surface net", () => {
  const RES = 24;
  const BOUNDS: [number, number, number] = [1, 1, 1];
  const RADIUS = 0.6;
  // A sphere as an analytic density: 1 at the centre, falling linearly to 0
  // at the bounds, so the iso surface below is a sphere of a known radius.
  const sphere = (iso: number) => (i: number, j: number, k: number) => {
    const x = (i / RES) * 2 - 1;
    const y = (j / RES) * 2 - 1;
    const z = (k / RES) * 2 - 1;
    return iso + (RADIUS - Math.hypot(x, y, z));
  };

  it("puts every vertex in a thin shell at the iso radius, with lines in range", () => {
    const { positions, lines } = buildSurfaceNet(sphere(0.5), 0.5, RES, BOUNDS);
    expect(positions.length).toBeGreaterThan(0);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length % 2).toBe(0);
    const cell = 2 / RES;
    for (let i = 0; i < positions.length; i += 3) {
      const r = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
      expect(Math.abs(r - RADIUS)).toBeLessThan(cell);
    }
    for (const idx of lines) expect(idx).toBeLessThan(positions.length / 3);
  });

  it("returns an empty mesh for a field that never crosses the iso value", () => {
    const empty = buildSurfaceNet(() => 0, 0.5, RES, BOUNDS);
    expect(empty.positions.length).toBe(0);
    expect(empty.lines.length).toBe(0);
    const solid = buildSurfaceNet(() => 1, 0.5, RES, BOUNDS);
    expect(solid.positions.length).toBe(0);
    expect(solid.lines.length).toBe(0);
  });

  it("links a vertex only to neighbouring cells, so no line spans the shape", () => {
    const { positions, lines } = buildSurfaceNet(sphere(0.5), 0.5, RES, BOUNDS);
    // One cell apart in one axis, plus the sub-cell slack the centroid
    // placement can add on the other two.
    const maxLen = (2 / RES) * 3;
    for (let i = 0; i < lines.length; i += 2) {
      const a = lines[i] * 3;
      const b = lines[i + 1] * 3;
      const d = Math.hypot(positions[a] - positions[b], positions[a + 1] - positions[b + 1], positions[a + 2] - positions[b + 2]);
      expect(d).toBeLessThan(maxLen);
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

  it("samples the same lobes the shape volume is baked from", () => {
    // Both draw their lobes first from a fresh rng on the same seed, which is
    // what puts the points inside the gas rather than beside it in Both mode.
    expect(buildCloud(16, 4).lobes).toEqual(buildLobes(createRng(4)));
  });

  it("any prefix is a representative subsample \u2014 the first half and second half share a centroid", () => {
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

describe("storm flow volume", () => {
  // Small, like the noise volume's suite: every lattice is defined over the
  // unit cube, so the properties hold at any size.
  const SIZE = 24;
  const data = buildFlowVolume(SIZE, 5);
  const at = (x: number, y: number, z: number, channel: number) =>
    data[(((z * SIZE + y) * SIZE + x) * 3) + channel];

  it("is three channels of every texel, in range, and deterministic for a given seed", () => {
    expect(data.length).toBe(SIZE * SIZE * SIZE * 3);
    // Every byte is in range and whole — what that really tests is that
    // encodeSigned clamps, since a raw curl far past FLOW_NORM would
    // otherwise wrap around inside the Uint8Array rather than pin to an end.
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i++) {
      min = Math.min(min, data[i]);
      max = Math.max(max, data[i]);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(255);
    expect(min).toBeLessThan(100);
    expect(max).toBeGreaterThan(155);
    const digest = (v: Uint8Array) => v.reduce((a, b, i) => (a + b * (i % 7 + 1)) % 1e9, 0);
    expect(digest(buildFlowVolume(SIZE, 5))).toBe(digest(data));
    expect(digest(buildFlowVolume(SIZE, 6))).not.toBe(digest(data));
  });

  it("is a signed field centred on zero, with real variance in every channel", () => {
    // Curl has no reason to prefer a direction, so each channel's decoded
    // mean sits on 0 (byte 127.5) — a mean far off it would mean the
    // differencing had picked up a bias. The spread is what says FLOW_NORM
    // is in the right ballpark: too large and the field hugs its mean, too
    // small and it clips to the ends.
    const n = SIZE * SIZE * SIZE;
    for (const channel of [0, 1, 2]) {
      let sum = 0;
      let sumSq = 0;
      let saturated = 0;
      for (let i = 0; i < n; i++) {
        const v = data[i * 3 + channel];
        sum += v;
        sumSq += v * v;
        if (v === 0 || v === 255) saturated++;
      }
      const mean = sum / n;
      expect(Math.abs(mean - 127.5)).toBeLessThan(3);
      expect(Math.sqrt(sumSq / n - mean * mean)).toBeGreaterThan(15);
      expect(saturated / n).toBeLessThan(0.02);
    }
  });

  it("tiles: the wrap-around seam is as smooth as any interior step", () => {
    // Sampled with REPEAT, so texel `size` is texel 0. The curl is taken as
    // central differences over wrapped grid indices, which is what makes the
    // field itself periodic — not just the potential behind it. Magnitudes,
    // not equality: neighbouring texels never match anywhere.
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

    for (const channel of [0, 1, 2]) {
      for (const axis of [0, 1, 2] as const) {
        const seam = meanDelta(axis, SIZE - 1, 0, channel);
        const interior = meanDelta(axis, SIZE / 2, SIZE / 2 + 1, channel);
        expect(seam).toBeLessThan(interior * 3 + 1);
      }
    }
  });
});

describe("storm filament strands", () => {
  it("spends a fraction of the particle budget, with a floor and a ceiling", () => {
    expect(filamentStrandCount(200_000)).toBeLessThan(particleCountForQuality(200_000));
    expect(filamentStrandCount(4_000)).toBe(filamentStrandCount(0));
    expect(filamentStrandCount(1e9)).toBe(filamentStrandCount(1e10));
    expect(filamentStrandCount(50_000)).toBeGreaterThan(filamentStrandCount(12_000));
  });

  it("emits each strand as consecutive line pairs sharing one seed point", () => {
    const strands = 3;
    const steps = 4;
    const cloud = buildCloud(strands);
    const v = buildFilamentVertices(cloud.positions, cloud.seeds, strands, steps);
    expect(v.positions.length).toBe(strands * steps * 2 * 3);
    expect(v.seeds.length).toBe(strands * steps * 2);
    for (let s = 0; s < strands; s++) {
      for (let j = 0; j < steps; j++) {
        const o = (s * steps + j) * 2;
        // The pair straddles one step of the trace...
        expect(v.steps[o]).toBe(j);
        expect(v.steps[o + 1]).toBe(j + 1);
        // ...and every vertex of the strand carries the same seed, since the
        // shader is what turns a step index into a position.
        expect(v.seeds[o]).toBe(cloud.seeds[s]);
        expect(v.positions[o * 3]).toBe(cloud.positions[s * 3]);
        expect(v.positions[(o + 1) * 3 + 2]).toBe(cloud.positions[s * 3 + 2]);
      }
    }
  });
});

describe("storm morph phase", () => {
  const DT = 1 / 60;

  it("is frozen with Morph speed and Morph on beat both off", () => {
    let phase = 0;
    for (let i = 0; i < 600; i++) phase = advanceMorphPhase(phase, DT, 0, 0, i % 30 === 0 ? 1 : 0);
    expect(phase).toBe(0);
  });

  it("only ever moves forward, whatever the settings and however big the frame", () => {
    let phase = 0;
    for (const speed of [0, 0.05, 0.35, 1]) {
      for (const beat of [0, 0.4, 1]) {
        for (const dt of [0, DT, 0.25]) {
          for (const amp of [0, 0.5, 1]) {
            const next = advanceMorphPhase(phase, dt, speed, beat, amp);
            expect(next).toBeGreaterThanOrEqual(phase);
            phase = next;
          }
        }
      }
    }
  });

  it("glides faster the higher Morph speed is", () => {
    const slow = advanceMorphPhase(0, 1, 0.2, 0, 0);
    const mid = advanceMorphPhase(0, 1, 0.5, 0, 0);
    const fast = advanceMorphPhase(0, 1, 1, 0, 0);
    expect(mid).toBeGreaterThan(slow);
    expect(fast).toBeGreaterThan(mid);
    // Fast enough to walk the whole loop of silhouettes inside a few seconds
    // at the top of the slider — the point of the control.
    expect(fast * 20).toBeGreaterThan(SHAPE_VARIANTS);
  });

  it("a beat adds a step on top of the glide, in proportion to Morph on beat", () => {
    const quiet = advanceMorphPhase(0, DT, 0.35, 0.4, 0);
    const hit = advanceMorphPhase(0, DT, 0.35, 0.4, 1);
    const harder = advanceMorphPhase(0, DT, 0.35, 1, 1);
    expect(hit).toBeGreaterThan(quiet);
    expect(harder).toBeGreaterThan(hit);
    // ...and none at all with the slider off, however hard the beat.
    expect(advanceMorphPhase(0, DT, 0.35, 0, 1)).toBe(quiet);
  });

  it("caps one frame's step, so a drop's burst can't teleport the shape past a variant", () => {
    for (const dt of [DT, 0.25]) {
      for (const amp of [1, 5, 1000]) {
        expect(advanceMorphPhase(0, dt, 1, 1, amp)).toBeLessThanOrEqual(MORPH_MAX_STEP + 1e-9);
      }
    }
    expect(advanceMorphPhase(0, DT, 1, 1, 1000)).toBeGreaterThan(0);
  });

  it("survives a non-finite phase, dt or setting rather than poisoning the accumulator", () => {
    expect(Number.isFinite(advanceMorphPhase(Number.NaN, DT, 0.5, 0.5, 1))).toBe(true);
    expect(Number.isFinite(advanceMorphPhase(0, Number.NaN, 0.5, 0.5, 1))).toBe(true);
    expect(Number.isFinite(advanceMorphPhase(0, DT, Number.NaN, Number.NaN, Number.NaN))).toBe(true);
    // A backwards frame is a no-op, not a rewind.
    expect(advanceMorphPhase(2, -1, 1, 0, 0)).toBe(2);
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

  it("bakes one silhouette per channel, every one zero on every face of the box", () => {
    // The real lobe sets, at a resolution fine enough to stand in for the one
    // the scene bakes: the fade into the bounding ellipsoid is what drives a
    // face texel to zero, and a coarse volume samples it before it has faded.
    const size = 32;
    const lobeSets = buildLobeSets();
    const data = buildShapeVolume(size, lobeSets);
    expect(data.length).toBe(size * size * size * 4);
    const at = (x: number, y: number, z: number, c: number) => data[((z * size + y) * size + x) * 4 + c];
    for (let c = 0; c < 4; c++) {
      for (let a = 0; a < size; a++) {
        for (let b = 0; b < size; b++) {
          // Every box face lies outside the bounding ellipsoid, which is what
          // makes the shader's CLAMP_TO_EDGE lookup safe — in every channel,
          // since shape() now reads all four.
          expect(at(0, a, b, c)).toBe(0);
          expect(at(size - 1, a, b, c)).toBe(0);
          expect(at(a, 0, b, c)).toBe(0);
          expect(at(a, size - 1, b, c)).toBe(0);
          expect(at(a, b, 0, c)).toBe(0);
          expect(at(a, b, size - 1, c)).toBe(0);
        }
      }
    }
    expect(data.reduce((m, v) => Math.max(m, v), 0)).toBeGreaterThan(200);
  });

  it("gives every variant its own cloud, and keeps variant 0 the one the points sample", () => {
    const sets = buildLobeSets();
    expect(sets).toHaveLength(SHAPE_VARIANTS);
    // buildCloud draws its lobes from a fresh rng on CLOUD_SEED, exactly as
    // variant 0 does — that is what puts the points inside the gas at phase 0.
    expect(buildCloud(16).lobes).toEqual(sets[0]);
    for (let i = 1; i < sets.length; i++) expect(sets[i]).not.toEqual(sets[0]);
  });
});

describe("storm gas recipes", () => {
  it("has exactly one recipe per gas type", () => {
    expect(GAS_RECIPES).toHaveLength(GAS_TYPES.length);
  });

  it("keeps Cumulus at identity, so the default cloud is arithmetic that cancels", () => {
    // Every field of a recipe is a factor on an expression the march already
    // had, and Cumulus is what the setting defaults to — so this is what
    // makes "the default frame is unchanged" true by construction rather
    // than by eye. A non-identity value here is a silent visual regression
    // in every marched mode at once.
    expect(GAS_TYPES[0]).toBe("Cumulus");
    expect(GAS_RECIPES[0]).toEqual({
      freq: 1,
      stretch: [1, 1, 1],
      erosion: 1,
      worley: 1,
      extinction: 1,
      powder: 1,
      tint: [1, 1, 1],
    });
  });

  it("keeps every recipe finite and inside sane bounds", () => {
    for (const r of GAS_RECIPES) {
      // A frequency or stretch at zero collapses the noise lookup onto one
      // texel; an extinction at zero makes the gas invisible whatever the
      // density slider says. The upper bounds are just "still a cloud".
      expect(r.freq).toBeGreaterThan(0.25);
      expect(r.freq).toBeLessThan(4);
      expect(r.stretch).toHaveLength(3);
      for (const s of r.stretch) {
        expect(Number.isFinite(s)).toBe(true);
        expect(s).toBeGreaterThan(0.1);
        expect(s).toBeLessThan(6);
      }
      expect(r.erosion).toBeGreaterThan(0.25);
      expect(r.erosion).toBeLessThan(4);
      expect(r.worley).toBeGreaterThan(0.25);
      expect(r.worley).toBeLessThan(4);
      expect(r.extinction).toBeGreaterThan(0.1);
      expect(r.extinction).toBeLessThan(4);
      expect(r.powder).toBeGreaterThanOrEqual(0);
      expect(r.powder).toBeLessThan(4);
      expect(r.tint).toHaveLength(3);
      for (const c of r.tint) {
        expect(Number.isFinite(c)).toBe(true);
        expect(c).toBeGreaterThan(0);
        expect(c).toBeLessThan(4);
      }
    }
  });

  it("gives every type a character of its own", () => {
    // Four options that render the same cloud would be four dead chips.
    const seen = new Set(GAS_RECIPES.map((r) => JSON.stringify(r)));
    expect(seen.size).toBe(GAS_RECIPES.length);
  });
});
