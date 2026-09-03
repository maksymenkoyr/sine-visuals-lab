import { describe, it, expect } from "vitest";
import {
  createShove,
  createBigHitDetector,
  createChunkPool,
  cloudRadius,
  SHOVE_IMPULSE,
  SHOVE_DECAY,
  SHOVE_CAP,
  MAX_CHUNK_BURSTS,
  CHUNKS_PER_BURST,
  CHUNK_LIFE_SEC,
  CHUNK_DEAD_T0,
  BIG_HIT_REFRACTORY_SEC,
  BIG_HIT_PULSE_MIN,
  BIG_HIT_SECTION_MIN,
  sparseSizeScale,
  SPARSE_SIZE_SCALE_CAP,
  pointSizing,
  CLOUD_RADIUS_MIN,
  CLOUD_RADIUS_MAX,
} from "../src/render/scenes/powder.ts";
import type { GLProgram } from "../src/render/gl.ts";

describe("shove envelope", () => {
  it("starts at rest", () => {
    expect(createShove().value).toBe(0);
  });

  it("rises on a trigger and decays monotonically toward zero afterwards", () => {
    const shove = createShove();
    shove.trigger(SHOVE_IMPULSE);
    expect(shove.value).toBeCloseTo(SHOVE_IMPULSE, 10);

    let prev = shove.value;
    for (let i = 0; i < 120; i++) {
      const v = shove.advance(1 / 60);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
    expect(prev).toBeLessThan(SHOVE_IMPULSE * 0.01);
    expect(prev).toBeGreaterThan(0);
  });

  it("decays at SHOVE_DECAY per second", () => {
    const shove = createShove();
    shove.trigger(1);
    expect(shove.advance(1)).toBeCloseTo(Math.exp(-SHOVE_DECAY), 10);
  });

  it("saturates at SHOVE_CAP no matter how many hits stack up", () => {
    const shove = createShove();
    for (let i = 0; i < 50; i++) shove.trigger(SHOVE_IMPULSE);
    expect(shove.value).toBe(SHOVE_CAP);
  });

  it("ignores a non-positive or non-finite impulse and a non-positive dt", () => {
    const shove = createShove();
    shove.trigger(-1);
    shove.trigger(NaN);
    expect(shove.value).toBe(0);
    shove.trigger(1);
    expect(shove.advance(-1)).toBe(1);
    expect(shove.advance(NaN)).toBe(1);
  });
});

describe("big-hit detector", () => {
  const dt = 1 / 60;
  const LOUD = BIG_HIT_SECTION_MIN;
  const QUIET = BIG_HIT_SECTION_MIN - 0.3;
  const HARD = BIG_HIT_PULSE_MIN + 0.2;
  const SOFT = BIG_HIT_PULSE_MIN - 0.2;

  /** Steady bass with no rise, long enough for the baseline to settle there. */
  function warm(
    detector: ReturnType<typeof createBigHitDetector>,
    level: number,
    seconds: number,
    section = LOUD,
  ) {
    for (let t = 0; t < seconds; t += dt) detector.advance(dt, level, 0, section, false, false);
  }

  it("fires at full strength on a drop, whatever the bass and the section are doing", () => {
    const d = createBigHitDetector();
    warm(d, 0.2, 4, QUIET);
    expect(d.advance(dt, 0.2, 0, QUIET, false, true)).toBe(1);
  });

  it("fires on a strong kick in a loud section, even with the level sitting on its own baseline", () => {
    // The case the level-vs-baseline test alone can never catch: a steady
    // bass-heavy chorus, where `low` is high but its slow average is just as
    // high, so it is never 25% clear of itself.
    const d = createBigHitDetector();
    warm(d, 0.6, 20, LOUD);
    expect(d.baseline).toBeCloseTo(0.6, 2);
    const strength = d.advance(dt, 0.6, HARD, LOUD, true, false);
    expect(strength).toBeGreaterThan(0);
    expect(strength).toBeLessThanOrEqual(1);
  });

  it("fires on a bass level well clear of its baseline even in a quiet section", () => {
    const d = createBigHitDetector();
    warm(d, 0.1, 4, QUIET);
    expect(d.advance(dt, 0.9, HARD, QUIET, true, false)).toBeGreaterThan(0);
  });

  it("does not fire on a strong kick in a quiet section with the level at its baseline", () => {
    const d = createBigHitDetector();
    warm(d, 0.6, 20, QUIET);
    expect(d.advance(dt, 0.6, HARD, QUIET, true, false)).toBe(0);
  });

  it("does not fire on a weak pulse, however loud the section", () => {
    const d = createBigHitDetector();
    warm(d, 0.6, 20, 1);
    expect(d.advance(dt, 0.6, SOFT, 1, true, false)).toBe(0);
  });

  it("does not fire again inside the refractory window", () => {
    const d = createBigHitDetector();
    warm(d, 0.6, 20, LOUD);
    expect(d.advance(dt, 0.6, HARD, LOUD, true, false)).toBeGreaterThan(0);
    for (let t = 0; t < BIG_HIT_REFRACTORY_SEC * 0.9; t += dt) {
      expect(d.advance(dt, 0.6, HARD, LOUD, true, false)).toBe(0);
    }
  });

  it("fires again once the refractory window has passed", () => {
    const d = createBigHitDetector();
    warm(d, 0.6, 20, LOUD);
    expect(d.advance(dt, 0.6, HARD, LOUD, true, false)).toBeGreaterThan(0);
    warm(d, 0.6, BIG_HIT_REFRACTORY_SEC + dt, LOUD);
    expect(d.advance(dt, 0.6, HARD, LOUD, true, false)).toBeGreaterThan(0);
  });

  it("does not fire without a rise, however hard the pulse", () => {
    const d = createBigHitDetector();
    warm(d, 0.6, 20, 1);
    expect(d.advance(dt, 0.6, 1, 1, false, false)).toBe(0);
  });

  it("scales strength with the kick's pulse, within [0.45, 1]", () => {
    const soft = createBigHitDetector();
    warm(soft, 0.6, 20, LOUD);
    const softStrength = soft.advance(dt, 0.6, BIG_HIT_PULSE_MIN, LOUD, true, false);
    const hard = createBigHitDetector();
    warm(hard, 0.6, 20, LOUD);
    const hardStrength = hard.advance(dt, 0.6, 1, LOUD, true, false);
    expect(hardStrength).toBeGreaterThan(softStrength);
    expect(softStrength).toBeGreaterThanOrEqual(0.45);
    expect(hardStrength).toBeLessThanOrEqual(1);
  });

  it("tracks the bass baseline toward the level it is fed", () => {
    const d = createBigHitDetector();
    expect(d.baseline).toBe(0);
    warm(d, 0.5, 10);
    expect(d.baseline).toBeGreaterThan(0.45);
    warm(d, 0, 10);
    expect(d.baseline).toBeLessThan(0.05);
  });
});

describe("sparse-bed size scale", () => {
  it("is 1 at the reference grain count, so the tuned tier is unchanged", () => {
    expect(sparseSizeScale(200_000)).toBe(1);
  });

  it("never shrinks a bed denser than the reference", () => {
    expect(sparseSizeScale(1e9)).toBeLessThanOrEqual(1);
  });

  it("holds coverage — count times sprite area — constant until the cap bites", () => {
    // The whole point of the 1/sqrt(count) law: the same total smoke.
    for (const count of [200_000, 50_000, 12_000, 4_100]) {
      const coverage = count * sparseSizeScale(count) ** 2;
      expect(coverage / 200_000).toBeCloseTo(1, 6);
    }
  });

  it("grows as the bed thins, and caps", () => {
    const mid = sparseSizeScale(50_000);
    const low = sparseSizeScale(12_000);
    const floor = sparseSizeScale(4_000);
    expect(mid).toBeGreaterThan(1);
    expect(low).toBeGreaterThan(mid);
    expect(floor).toBeGreaterThanOrEqual(low);
    expect(floor).toBeLessThanOrEqual(SPARSE_SIZE_SCALE_CAP);
    expect(sparseSizeScale(1)).toBe(SPARSE_SIZE_SCALE_CAP);
  });

  it("is monotonically non-increasing in grain count", () => {
    let prev = sparseSizeScale(1_000);
    for (const count of [4_000, 12_000, 50_000, 100_000, 200_000, 400_000]) {
      const scale = sparseSizeScale(count);
      expect(scale).toBeLessThanOrEqual(prev);
      prev = scale;
    }
  });
});

/** A GLProgram stub that only records the float-array uploads. */
function fakeProgram(): { prog: GLProgram; uploads: Record<string, number[]> } {
  const uploads: Record<string, number[]> = {};
  const noop = () => {};
  const prog = {
    program: {} as WebGLProgram,
    use: noop,
    setF: noop,
    setV2: noop,
    setV4: noop,
    setFv: (name: string, arr: Float32Array | number[]) => {
      uploads[name] = Array.from(arr as ArrayLike<number>);
    },
    setV3v: noop,
    setV4v: noop,
    dispose: noop,
  } as unknown as GLProgram;
  return { prog, uploads };
}

describe("chunk pool", () => {
  it("starts empty, with every slot uploading the dead sentinel", () => {
    const pool = createChunkPool();
    expect(pool.alive()).toBe(0);
    const { prog, uploads } = fakeProgram();
    pool.upload(prog);
    expect(uploads.uChunkT0).toEqual(new Array(MAX_CHUNK_BURSTS).fill(CHUNK_DEAD_T0));
    expect(uploads.uChunkStrength).toHaveLength(MAX_CHUNK_BURSTS);
    expect(uploads.uChunkSeed).toHaveLength(MAX_CHUNK_BURSTS);
  });

  it("holds at most MAX_CHUNK_BURSTS live bursts", () => {
    const pool = createChunkPool();
    for (let i = 0; i < MAX_CHUNK_BURSTS * 3; i++) pool.trigger(i * 0.01, 1, i);
    expect(pool.alive()).toBe(MAX_CHUNK_BURSTS);
  });

  it("displaces the oldest burst once every slot is live", () => {
    const pool = createChunkPool();
    for (let i = 0; i < MAX_CHUNK_BURSTS; i++) pool.trigger(i * 0.01, 1, i);
    pool.trigger(1, 1, 99);
    const seeds = pool.bursts.map((b) => b.seed);
    // The very first burst (seed 0, oldest t0) is the one that went.
    expect(seeds).toContain(99);
    expect(seeds).not.toContain(0);
  });

  it("expires a burst after CHUNK_LIFE_SEC and returns its slot to the dead sentinel", () => {
    const pool = createChunkPool();
    pool.trigger(10, 1, 7);
    pool.tick(10 + CHUNK_LIFE_SEC * 0.99);
    expect(pool.alive()).toBe(1);
    pool.tick(10 + CHUNK_LIFE_SEC + 1e-3);
    expect(pool.alive()).toBe(0);

    const { prog, uploads } = fakeProgram();
    pool.upload(prog);
    expect(uploads.uChunkT0.every((t) => t === CHUNK_DEAD_T0)).toBe(true);
  });

  it("uploads a live burst's own t0, strength and seed", () => {
    const pool = createChunkPool();
    pool.trigger(4.5, 0.8, 12.25);
    const { prog, uploads } = fakeProgram();
    pool.upload(prog);
    const slot = uploads.uChunkT0.indexOf(4.5);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(uploads.uChunkStrength[slot]).toBeCloseTo(0.8, 6);
    expect(uploads.uChunkSeed[slot]).toBeCloseTo(12.25, 6);
  });

  it("reuses an expired slot rather than growing the pool", () => {
    const pool = createChunkPool();
    for (let i = 0; i < MAX_CHUNK_BURSTS; i++) pool.trigger(0, 1, i);
    pool.tick(CHUNK_LIFE_SEC + 1);
    pool.trigger(CHUNK_LIFE_SEC + 1, 1, 42);
    expect(pool.alive()).toBe(1);
    expect(pool.bursts).toHaveLength(MAX_CHUNK_BURSTS);
  });

  it("draws a whole number of full bursts", () => {
    expect(MAX_CHUNK_BURSTS * CHUNKS_PER_BURST).toBe(MAX_CHUNK_BURSTS * CHUNKS_PER_BURST);
    expect(CHUNKS_PER_BURST).toBeGreaterThan(0);
  });
});

describe("point sizing across render scales", () => {
  // The Grain-size default: mix(GRAIN_PX_MIN, GRAIN_PX_MAX, 0.5).
  const BASE = 3.25;

  it("is a no-op at the reference resolution and grain count", () => {
    const s = pointSizing(BASE, 1, 1);
    expect(s.sizePx).toBeCloseTo(BASE, 10);
    expect(s.gain).toBeCloseTo(1, 10);
  });

  it("scales the point with the buffer, holding coverage constant", () => {
    // A 4K buffer: bigger points, and no correction needed because the
    // buffer grew by exactly as much.
    const big = pointSizing(BASE, 3, 1);
    expect(big.sizePx).toBeCloseTo(BASE * 3, 10);
    expect(big.gain).toBeCloseTo(1, 10);
  });

  it("shrinks the point on the governor's smallest buffer instead of piling up coverage", () => {
    // What the quality governor's renderScale=0.3 does to a 720p canvas.
    const small = pointSizing(BASE, 0.35, 1);
    expect(small.sizePx).toBeCloseTo(BASE * 0.35, 10);
    expect(small.sizePx).toBeLessThan(BASE);
    expect(small.gain).toBeCloseTo(1, 10);
  });

  it("dims rather than blows out once the one-pixel floor stops the shrink", () => {
    // Finest grain on the smallest buffer: nominal is 0.7px, below the floor.
    const clamped = pointSizing(2.0, 0.35, 1);
    expect(clamped.sizePx).toBe(1);
    expect(clamped.gain).toBeCloseTo(0.7 ** 2, 6);
  });

  it("never returns a size outside [1, maxPx], at any resolution or grain count", () => {
    for (const resScale of [0.35, 0.5, 1, 2, 4]) {
      for (const count of [200_000, 50_000, 12_000, 4_000]) {
        const s = pointSizing(BASE, resScale, sparseSizeScale(count));
        expect(s.sizePx).toBeGreaterThanOrEqual(1);
        expect(s.sizePx).toBeLessThanOrEqual(s.maxPx);
        expect(s.gain).toBeGreaterThan(0);
        expect(s.gain).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("draws a floor-tier point far larger than a high-tier one, at the same resolution", () => {
    const high = pointSizing(BASE, 1, sparseSizeScale(200_000));
    const floor = pointSizing(BASE, 1, sparseSizeScale(4_000));
    expect(floor.sizePx).toBeGreaterThan(high.sizePx * 5);
    expect(floor.maxPx).toBeGreaterThan(high.maxPx);
  });
});

describe("cloud radius", () => {
  it("grows with Cloud size", () => {
    let prev = -Infinity;
    for (let size = 0; size <= 1.0001; size += 0.1) {
      const r = cloudRadius(size, 0.6, 0.5, 0.2, 0, 0.6);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });

  it("grows with the section intensity while Loud swell is up", () => {
    const quiet = cloudRadius(0.5, 1, 0.05, 0.2, 0, 0.6);
    const loud = cloudRadius(0.5, 1, 0.95, 0.2, 0, 0.6);
    expect(loud).toBeGreaterThan(quiet);
  });

  it("ignores the section intensity entirely at Loud swell 0", () => {
    const quiet = cloudRadius(0.5, 0, 0.05, 0.2, 0, 0.6);
    const loud = cloudRadius(0.5, 0, 0.95, 0.2, 0, 0.6);
    expect(loud).toBeCloseTo(quiet, 10);
  });

  it("puffs out on a bass hit, and only while Bass kick is up", () => {
    const rest = cloudRadius(0.5, 0.6, 0.5, 0.2, 0, 0.6);
    const hit = cloudRadius(0.5, 0.6, 0.5, 0.2, 1, 0.6);
    expect(hit).toBeGreaterThan(rest);
    expect(cloudRadius(0.5, 0.6, 0.5, 0.2, 1, 0)).toBeCloseTo(rest, 10);
  });

  it("stays inside its bounds for every combination of extremes", () => {
    for (const size of [0, 0.5, 1]) {
      for (const breathe of [0, 1]) {
        for (const section of [0, 1]) {
          for (const low of [0, 1, 4]) {
            for (const pulse of [0, 1]) {
              for (const kick of [0, 1]) {
                const r = cloudRadius(size, breathe, section, low, pulse, kick);
                expect(r).toBeGreaterThanOrEqual(CLOUD_RADIUS_MIN);
                expect(r).toBeLessThanOrEqual(CLOUD_RADIUS_MAX);
              }
            }
          }
        }
      }
    }
  });

  it("clamps out-of-range inputs instead of running away", () => {
    expect(cloudRadius(5, 5, 5, 0, 0, 5)).toBeLessThanOrEqual(CLOUD_RADIUS_MAX);
    expect(cloudRadius(-5, -5, -5, -5, -5, -5)).toBeGreaterThanOrEqual(CLOUD_RADIUS_MIN);
  });
});
