import { describe, it, expect } from "vitest";
import {
  BOLT_SEGMENTS,
  MORPH_MAX_STEP,
  SHAPE_VARIANTS,
  advanceMorphPhase,
  buildBoltPath,
  buildCloud,
  buildLobeSets,
  buildLobes,
  buildNoiseVolume,
  buildShapeVolume,
  buildSurfaceNet,
  createRng,
  createStrikePool,
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
      expect(len).toBeLessThanOrEqual(0.85 + 1e-9);
    }
  });

  it("draws the fired slot's bolt path between its own endpoints and marks only it dirty", () => {
    const pool = createStrikePool(lobes, createRng(6));
    expect(Array.from(pool.pathDirty).every((d) => d === 0)).toBe(true);
    expect(pool.trigger(1)).toBe(true);
    const slot = Array.from(pool.pathDirty).indexOf(1);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(Array.from(pool.pathDirty).filter((d) => d === 1)).toHaveLength(1);

    const verts = BOLT_SEGMENTS + 1;
    const o = slot * verts * 3;
    for (let k = 0; k < 3; k++) {
      expect(pool.path[o + k]).toBeCloseTo(pool.posA[slot * 3 + k], 6);
      expect(pool.path[o + (verts - 1) * 3 + k]).toBeCloseTo(pool.posB[slot * 3 + k], 6);
    }
    // Every other slot's path is still untouched.
    for (let i = 0; i < pool.pathDirty.length; i++) {
      if (i === slot) continue;
      const zeros = Array.from(pool.path.subarray(i * verts * 3, (i + 1) * verts * 3));
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

describe("storm bolt path", () => {
  const ends: [number[], number[]] = [[-0.4, 0.1, 0.2], [0.5, -0.2, -0.1]];

  it("is one vertex per segment plus one, exactly on the strike's endpoints", () => {
    const path = buildBoltPath(createRng(1), ends[0], ends[1]);
    expect(path.length).toBe((BOLT_SEGMENTS + 1) * 3);
    for (let k = 0; k < 3; k++) {
      // Float32 storage, so "exactly" is to the precision the buffer holds.
      expect(path[k]).toBeCloseTo(ends[0][k], 6);
      expect(path[BOLT_SEGMENTS * 3 + k]).toBeCloseTo(ends[1][k], 6);
    }
  });

  it("kinks every interior vertex, but never far off the straight line", () => {
    // The displacement halves per level, so the whole train sums to well
    // under half the segment's length however deep the recursion goes.
    const [a, b] = ends;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let offAxis = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const path = buildBoltPath(createRng(seed), a, b);
      for (let i = 1; i < BOLT_SEGMENTS; i++) {
        const p = [path[i * 3], path[i * 3 + 1], path[i * 3 + 2]];
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

  it("is deterministic for a given rng, and different for a different one", () => {
    const a = Array.from(buildBoltPath(createRng(4), ends[0], ends[1]));
    const b = Array.from(buildBoltPath(createRng(4), ends[0], ends[1]));
    const c = Array.from(buildBoltPath(createRng(5), ends[0], ends[1]));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("writes into a shared buffer at the offset it is given, touching nothing else", () => {
    const verts = BOLT_SEGMENTS + 1;
    const out = new Float32Array(verts * 3 * 2);
    buildBoltPath(createRng(2), ends[0], ends[1], out, verts * 3);
    expect(Array.from(out.subarray(0, verts * 3)).every((v) => v === 0)).toBe(true);
    expect(out[verts * 3]).toBeCloseTo(ends[0][0], 6);
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
