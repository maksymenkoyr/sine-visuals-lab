import { describe, it, expect } from "vitest";
import {
  createStrainPreview,
  createPairCulture,
  trailQuantile,
  pairOverlap,
  pairContactPixelsInto,
  type StrainPreviewMotion,
  type PairCultureInputs,
} from "../src/render/scenes/physarum2Preview.ts";

// A representative "coarse cells / spots" motion — sensor angle/reach/turn
// on the wide, sharp-turning end of the range physarum2.ts's own STRAINS/
// LEGACY_MOTION span (PP-C3's own profile: 95deg sensor layout, a 45-texel
// range and a 100deg turn on the real scene's 1024-wide field) — the
// prototype's own measurement note (this file's own createStrainPreview doc
// comment, ported from strainPreview.js) found this is the strain that
// coarsens fastest without RESPAWN_PER_STEP, so it's the sharpest test of
// the respawn claim.
const DEG = Math.PI / 180;
const SPOTTY_MOTION: StrainPreviewMotion = {
  sensorAngle: 95 * DEG,
  reach: 4,
  turn: 100 * DEG,
  step: 1.4,
  deposit: 0.03,
};

function runSteps(preview: ReturnType<typeof createStrainPreview>, motion: StrainPreviewMotion, n: number): void {
  for (let i = 0; i < n; i++) preview.step(motion);
}

describe("physarum2Preview: createStrainPreview", () => {
  it("is fully deterministic for a fixed seed — two identical runs produce identical pixels", () => {
    const a = createStrainPreview({ size: 32, agents: 300, seed: 42 });
    const b = createStrainPreview({ size: 32, agents: 300, seed: 42 });
    for (let i = 0; i < 60; i++) {
      a.step(SPOTTY_MOTION);
      b.step(SPOTTY_MOTION);
    }
    expect(a.pixels([1, 1, 1])).toEqual(b.pixels([1, 1, 1]));
  });

  it("pixelsInto writes exactly what pixels returns, and overwrites a dirty buffer fully", () => {
    const preview = createStrainPreview({ size: 24, agents: 300, seed: 5 });
    runSteps(preview, SPOTTY_MOTION, 30);
    const rgb: [number, number, number] = [0.9, 0.4, 0.2];
    const buf = new Uint8ClampedArray(24 * 24 * 4).fill(77);
    preview.pixelsInto(buf, rgb);
    expect(buf).toEqual(preview.pixels(rgb));
    runSteps(preview, SPOTTY_MOTION, 5);
    preview.pixelsInto(buf, rgb);
    expect(buf).toEqual(preview.pixels(rgb));
  });

  it("a different seed diverges (not a hidden shared/global RNG)", () => {
    const a = createStrainPreview({ size: 32, agents: 300, seed: 1 });
    const b = createStrainPreview({ size: 32, agents: 300, seed: 2 });
    for (let i = 0; i < 60; i++) {
      a.step(SPOTTY_MOTION);
      b.step(SPOTTY_MOTION);
    }
    expect(a.pixels([1, 1, 1])).not.toEqual(b.pixels([1, 1, 1]));
  });

  it("size/pixels shape: size*size*4 bytes, alpha always opaque", () => {
    const size = 24;
    const preview = createStrainPreview({ size, agents: 200, seed: 7 });
    expect(preview.size).toBe(size);
    runSteps(preview, SPOTTY_MOTION, 5);
    const buf = preview.pixels([1, 0.5, 0.2]);
    expect(buf.length).toBe(size * size * 4);
    for (let i = 3; i < buf.length; i += 4) expect(buf[i]).toBe(255);
  });

  it("tints each channel independently — a zeroed channel in `rgb` stays zero everywhere", () => {
    const preview = createStrainPreview({ size: 24, agents: 400, seed: 3 });
    runSteps(preview, SPOTTY_MOTION, 40);
    const buf = preview.pixels([1, 0, 0]);
    for (let i = 0; i < buf.length; i += 4) {
      expect(buf[i + 1]).toBe(0); // g
      expect(buf[i + 2]).toBe(0); // b
    }
  });

  it("never produces NaN/negative trail even over many steps with a large deposit", () => {
    const preview = createStrainPreview({ size: 24, agents: 500, seed: 9 });
    const hot: StrainPreviewMotion = { ...SPOTTY_MOTION, deposit: 1 };
    runSteps(preview, hot, 300);
    const buf = preview.pixels([1, 1, 1]);
    for (const v of buf) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  // The respawn claim (this module's own RESPAWN_PER_STEP comment, and
  // physarum2.ts's file header "Phase 3" paragraph): measured 2026-09-27
  // with a node harness, the densest 2% of a pure culture's cells held 76%
  // of the trail after 900 steps *without* RESPAWN_PER_STEP, falling to
  // about 12% *with* it. This test doesn't re-measure that exact number (a
  // fast, small-field test can't reproduce a 900-step/large-field run
  // bit-for-bit) — it checks the qualitative claim RESPAWN_PER_STEP exists
  // for: the trail stays spread across a real share of the field instead of
  // collapsing onto a tiny hot spot, at a size/step count that still runs in
  // well under a second.
  it("keeps a real share of the field lit (the respawn claim): visible share above a floor, densest-2% share below a ceiling", () => {
    const size = 48;
    const preview = createStrainPreview({ size, agents: 700, seed: 1234 });
    runSteps(preview, SPOTTY_MOTION, 400);
    const buf = preview.pixels([1, 1, 1]);
    const cells = size * size;
    const values: number[] = new Array(cells);
    let visible = 0;
    let total = 0;
    for (let i = 0; i < cells; i++) {
      const v = buf[i * 4]!; // tinted [1,1,1] — r === the raw (gamma'd) trail reading
      values[i] = v;
      total += v;
      if (v > 8) visible++; // "lit" floor — well above the gamma curve's black floor
    }
    const visibleShare = visible / cells;
    expect(visibleShare).toBeGreaterThan(0.15);

    values.sort((a, b) => b - a);
    const top2pct = Math.max(1, Math.round(cells * 0.02));
    const denseSum = values.slice(0, top2pct).reduce((a, b) => a + b, 0);
    const denseShare = total > 0 ? denseSum / total : 0;
    expect(denseShare).toBeLessThan(0.4);
  });
});

describe("physarum2Preview: createPairCulture", () => {
  const PAIR_MOTION: readonly [StrainPreviewMotion, StrainPreviewMotion] = [
    { sensorAngle: 60 * DEG, reach: 4, turn: 40 * DEG, step: 1.2, deposit: 0.03 },
    { sensorAngle: 60 * DEG, reach: 4, turn: 40 * DEG, step: 1.2, deposit: 0.03 },
  ];
  // Strain 0 chases strain 1's trail (asymmetric smell), so it actually
  // lands on strain 1's ink repeatedly instead of the two populations
  // wandering independently — Touch only has anything to feed/eat where the
  // eater's own path crosses the other's trail.
  function inputs(touch01: number, touch10 = 0, diag = 0): PairCultureInputs {
    return {
      motion: PAIR_MOTION,
      smell: [
        [0.2, 0.9],
        [0, 1],
      ],
      touch: [
        [diag, touch01],
        [touch10, diag],
      ],
    };
  }
  function runSteps(c: ReturnType<typeof createPairCulture>, n: number, inp: PairCultureInputs): void {
    for (let i = 0; i < n; i++) c.step(inp);
  }

  it("is fully deterministic for a fixed seed", () => {
    const a = createPairCulture({ size: 24, agents: 300, seed: 42 });
    const b = createPairCulture({ size: 24, agents: 300, seed: 42 });
    const inp = inputs(0);
    runSteps(a, 30, inp);
    runSteps(b, 30, inp);
    const bufA = new Uint8ClampedArray(24 * 24 * 4);
    const bufB = new Uint8ClampedArray(24 * 24 * 4);
    a.pixelsInto(bufA, [
      [1, 0, 0],
      [0, 1, 0],
    ]);
    b.pixelsInto(bufB, [
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(bufA).toEqual(bufB);
  });

  it("pixelsInto has the right shape and alpha 255", () => {
    const size = 20;
    const c = createPairCulture({ size, agents: 200, seed: 3 });
    runSteps(c, 10, inputs(0));
    const buf = new Uint8ClampedArray(size * size * 4);
    c.pixelsInto(buf, [
      [1, 1, 1],
      [1, 1, 1],
    ]);
    expect(buf.length).toBe(size * size * 4);
    for (let i = 3; i < buf.length; i += 4) expect(buf[i]).toBe(255);
  });

  it("seedColony with share 0 changes nothing", () => {
    const a = createPairCulture({ size: 24, agents: 300, seed: 9 });
    const b = createPairCulture({ size: 24, agents: 300, seed: 9 });
    runSteps(a, 20, inputs(0));
    runSteps(b, 20, inputs(0));
    a.seedColony(0, 0.1);
    runSteps(a, 10, inputs(0));
    runSteps(b, 10, inputs(0));
    expect(a.totals()).toEqual(b.totals());
  });

  it("seedColony with share 1 gathers every agent into one small disc", () => {
    const size = 32;
    const lit = (c: ReturnType<typeof createPairCulture>): number => {
      const buf = new Uint8ClampedArray(size * size * 4);
      c.pixelsInto(buf, [
        [1, 1, 1],
        [1, 1, 1],
      ]);
      let n = 0;
      for (let i = 0; i < buf.length; i += 4) if (buf[i]! > 0) n++;
      return n;
    };
    const spread = createPairCulture({ size, agents: 800, seed: 13 });
    runSteps(spread, 1, inputs(0));
    const seeded = createPairCulture({ size, agents: 800, seed: 13 });
    seeded.seedColony(1, 0.05);
    runSteps(seeded, 1, inputs(0));
    expect(lit(seeded)).toBeLessThan(lit(spread) * 0.3);
  });

  it("eating (touch01 = -1.5) leaves strain 1's total well below the no-touch run", () => {
    const base = createPairCulture({ size: 32, agents: 800, seed: 11 });
    runSteps(base, 60, inputs(0));
    const [, base1] = base.totals();

    const eaten = createPairCulture({ size: 32, agents: 800, seed: 11 });
    runSteps(eaten, 60, inputs(-1.5));
    const [, eaten1] = eaten.totals();

    expect(eaten1).toBeLessThan(base1 * 0.8);
  });

  it("feeding (touch01 = +1.5) raises strain 1's total above the no-touch run", () => {
    const base = createPairCulture({ size: 32, agents: 800, seed: 11 });
    runSteps(base, 60, inputs(0));
    const [, base1] = base.totals();

    const fed = createPairCulture({ size: 32, agents: 800, seed: 11 });
    runSteps(fed, 60, inputs(1.5));
    const [, fed1] = fed.totals();

    expect(fed1).toBeGreaterThan(base1);
  });

  it("Trail life (decayMul) ages each strain's own channel: a long-lived strain 0 keeps more ink", () => {
    const withLife = (m0: number | undefined): PairCultureInputs => ({
      ...inputs(0),
      motion: [{ ...PAIR_MOTION[0], decayMul: m0 }, PAIR_MOTION[1]],
    });
    const total0 = (m0: number | undefined): number => {
      const c = createPairCulture({ size: 32, agents: 800, seed: 21 });
      runSteps(c, 40, withLife(m0));
      return c.totals()[0];
    };
    expect(total0(0.35)).toBeGreaterThan(total0(1) * 1.5);
    expect(total0(2.8)).toBeLessThan(total0(1));
  });

  it("an omitted decayMul is the shared decay, byte for byte", () => {
    const run = (m0: number | undefined): Uint8ClampedArray => {
      const c = createPairCulture({ size: 24, agents: 300, seed: 8 });
      const inp: PairCultureInputs = { ...inputs(0.4), motion: [{ ...PAIR_MOTION[0], decayMul: m0 }, PAIR_MOTION[1]] };
      runSteps(c, 30, inp);
      const out = new Uint8ClampedArray(24 * 24 * 4);
      c.pixelsInto(out, [[1, 0.5, 0.2], [0.2, 0.5, 1]]);
      return out;
    };
    expect(run(undefined)).toEqual(run(1));
  });

  it("a non-zero touch diagonal changes nothing", () => {
    const a = createPairCulture({ size: 24, agents: 300, seed: 5 });
    runSteps(a, 30, inputs(0, 0, 0));
    const b = createPairCulture({ size: 24, agents: 300, seed: 5 });
    runSteps(b, 30, inputs(0, 0, 0.9));
    expect(a.totals()).toEqual(b.totals());
  });
});

describe("physarum2Preview: contact pictures", () => {
  const SIZE = 6;
  const RED = [1, 0, 0] as const;
  const BLUE = [0, 0, 1] as const;
  const maps = (): [Float32Array, Float32Array] => [new Float32Array(SIZE * SIZE), new Float32Array(SIZE * SIZE)];
  const px = (out: Uint8ClampedArray, cell: number): number[] => [out[cell * 4]!, out[cell * 4 + 1]!, out[cell * 4 + 2]!, out[cell * 4 + 3]!];

  it("a cell only strain A touches takes A's hue, B's takes B's, an empty cell is black", () => {
    const t = maps();
    t[0][0] = 1;
    t[1][1] = 1;
    const out = new Uint8ClampedArray(SIZE * SIZE * 4);
    pairContactPixelsInto(t, SIZE, out, [RED, BLUE], [1, 1]);
    const a = px(out, 0);
    expect(a[0]).toBe(255);
    expect(a[1]).toBe(0);
    expect(a[2]).toBe(0);
    const b = px(out, 1);
    expect(b[0]).toBe(0);
    expect(b[2]).toBe(255);
    expect(px(out, 2)).toEqual([0, 0, 0, 255]);
  });

  it("equal strength in both strains turns the cell near white", () => {
    const t = maps();
    t[0][3] = 1;
    t[1][3] = 1;
    const out = new Uint8ClampedArray(SIZE * SIZE * 4);
    pairContactPixelsInto(t, SIZE, out, [RED, BLUE], [1, 1]);
    const [r, g, b] = px(out, 3);
    expect(r).toBeGreaterThan(240);
    expect(g).toBeGreaterThan(240);
    expect(b).toBeGreaterThan(240);
  });

  it("each channel is scaled to its own exposure", () => {
    const t = maps();
    t[0][0] = 0.5;
    t[1][1] = 0.5;
    const out = new Uint8ClampedArray(SIZE * SIZE * 4);
    pairContactPixelsInto(t, SIZE, out, [RED, BLUE], [0.5, 1]);
    // A is at its own bright end (full), B at half of its.
    expect(px(out, 0)[0]).toBe(255);
    expect(px(out, 1)[2]!).toBeLessThan(255);
  });

  it("pairOverlap: identical maps 1, disjoint 0, empty 0", () => {
    const same = maps();
    for (let i = 0; i < SIZE * SIZE; i++) {
      same[0][i] = 1 + (i % 3);
      same[1][i] = 1 + (i % 3);
    }
    expect(pairOverlap(same, SIZE, 3)).toBeCloseTo(1, 9);
    const apart = maps();
    apart[0][0] = 1; // block (0,0)
    apart[1][SIZE * SIZE - 1] = 1; // block (1,1)
    expect(pairOverlap(apart, SIZE, 3)).toBe(0);
    expect(pairOverlap(maps(), SIZE, 3)).toBe(0);
    const oneEmpty = maps();
    oneEmpty[0][0] = 1;
    expect(pairOverlap(oneEmpty, SIZE, 3)).toBe(0);
  });

  it("trailQuantile reads a sorted sample, and 0 for an empty map", () => {
    const t = new Float32Array(100);
    for (let i = 0; i < 100; i++) t[i] = i;
    expect(trailQuantile(t, 0.98, 1)).toBe(98);
    expect(trailQuantile(t, 0, 1)).toBe(0);
    expect(trailQuantile(t, 1, 1)).toBe(99);
    expect(trailQuantile(new Float32Array(0), 0.98)).toBe(0);
  });
});
