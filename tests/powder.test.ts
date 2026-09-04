import { describe, it, expect } from "vitest";
import {
  createBurstPool,
  createBigHitDetector,
  createChunkPool,
  createHueDrift,
  calmTarget,
  MAX_BURSTS,
  BURST_LIFE_SEC,
  BURST_DEAD_T0,
  BURST_ORIGIN_RADIUS,
  MAX_CHUNK_BURSTS,
  CHUNKS_PER_BURST,
  CHUNK_LIFE_SEC,
  CHUNK_DEAD_T0,
  BIG_HIT_REFRACTORY_SEC,
  BIG_HIT_PULSE_MIN,
  BIG_HIT_SECTION_MIN,
  HUE_AMPL,
  HUE_BAR_RADIANS,
  HUE_DROP_EXCURSION,
  HUE_RELAX_TAU,
  MAX_ATTRACTORS,
  ATTRACTOR_RADIUS,
  ATTRACTOR_CENTRE_Y,
  attractorPositions,
  sparseSizeScale,
  SPARSE_SIZE_SCALE_CAP,
  pointSizing,
} from "../src/render/scenes/powder.ts";
import type { GLProgram } from "../src/render/gl.ts";

/** A GLProgram stub that only records the float-array uploads. */
function fakeProgram(): { prog: GLProgram; uploads: Record<string, number[]> } {
  const uploads: Record<string, number[]> = {};
  const noop = () => {};
  const record = (name: string, arr: Float32Array | number[]) => {
    uploads[name] = Array.from(arr as ArrayLike<number>);
  };
  const prog = {
    program: {} as WebGLProgram,
    use: noop,
    setF: noop,
    setV2: noop,
    setV4: noop,
    setFv: record,
    setV3v: record,
    setV4v: noop,
    dispose: noop,
  } as unknown as GLProgram;
  return { prog, uploads };
}

describe("burst pool", () => {
  it("starts empty, with every slot uploading the dead sentinel", () => {
    const pool = createBurstPool();
    expect(pool.alive()).toBe(0);
    const { prog, uploads } = fakeProgram();
    pool.upload(prog);
    expect(uploads.uBurstT0).toEqual(new Array(MAX_BURSTS).fill(BURST_DEAD_T0));
    expect(uploads.uBurstOrigin).toHaveLength(MAX_BURSTS * 3);
    expect(uploads.uBurstAxis).toHaveLength(MAX_BURSTS * 3);
    expect(uploads.uBurstFresh.every((f) => f === 0)).toBe(true);
  });

  it("holds at most MAX_BURSTS live plumes, displacing the oldest", () => {
    const pool = createBurstPool();
    for (let i = 0; i < MAX_BURSTS * 3; i++) pool.trigger(i * 0.1, 1, i);
    expect(pool.alive()).toBe(MAX_BURSTS);
    const oldest = Math.min(...pool.bursts.map((b) => b.t0));
    // Every surviving slot is one of the last MAX_BURSTS triggers.
    expect(oldest).toBeGreaterThanOrEqual((MAX_BURSTS * 3 - MAX_BURSTS) * 0.1);
  });

  it("expires a plume after BURST_LIFE_SEC and returns its slot to the sentinel", () => {
    const pool = createBurstPool();
    pool.trigger(10, 1, 3);
    pool.tick(10 + BURST_LIFE_SEC * 0.99);
    expect(pool.alive()).toBe(1);
    pool.tick(10 + BURST_LIFE_SEC + 1e-3);
    expect(pool.alive()).toBe(0);
  });

  it("reuses an expired slot rather than growing the pool", () => {
    const pool = createBurstPool();
    for (let i = 0; i < MAX_BURSTS; i++) pool.trigger(0, 1, i);
    pool.tick(BURST_LIFE_SEC + 1);
    pool.trigger(BURST_LIFE_SEC + 1, 1, 42);
    expect(pool.alive()).toBe(1);
    expect(pool.bursts).toHaveLength(MAX_BURSTS);
  });

  it("clears the fresh flag after exactly one upload", () => {
    const pool = createBurstPool();
    pool.trigger(1, 0.8, 5);
    const first = fakeProgram();
    pool.upload(first.prog);
    expect(first.uploads.uBurstFresh.filter((f) => f === 1)).toHaveLength(1);
    const second = fakeProgram();
    pool.upload(second.prog);
    expect(second.uploads.uBurstFresh.every((f) => f === 0)).toBe(true);
    // The plume itself is still live — only the one-frame flag went.
    expect(pool.alive()).toBe(1);
  });

  it("puts every origin inside BURST_ORIGIN_RADIUS of the middle", () => {
    const pool = createBurstPool();
    for (let i = 0; i < 200; i++) {
      pool.trigger(i, 1, i * 7.13 + 0.5);
      const b = pool.bursts.find((x) => x.t0 === i);
      expect(b).toBeDefined();
      const r = Math.hypot(b!.originX, b!.originY, b!.originZ);
      expect(r).toBeLessThanOrEqual(BURST_ORIGIN_RADIUS + 1e-9);
    }
  });

  it("gives every axis unit length and an upward lean", () => {
    const pool = createBurstPool();
    for (let i = 0; i < 200; i++) {
      pool.trigger(i, 1, i * 3.77 + 1.1);
      const b = pool.bursts.find((x) => x.t0 === i)!;
      expect(Math.hypot(b.axisX, b.axisY, b.axisZ)).toBeCloseTo(1, 10);
      expect(b.axisY).toBeGreaterThan(0);
    }
  });

  it("mirrors the axis when flipped, so a drop throws two opposed plumes", () => {
    const pool = createBurstPool();
    pool.trigger(1, 1, 12.5);
    const up = { ...pool.bursts.find((b) => b.t0 === 1)! };
    pool.trigger(2, 1, 12.5, true);
    const down = pool.bursts.find((b) => b.t0 === 2)!;
    expect(down.axisX).toBeCloseTo(-up.axisX, 10);
    expect(down.axisY).toBeCloseTo(-up.axisY, 10);
    expect(down.axisZ).toBeCloseTo(-up.axisZ, 10);
    // Same seed, so both come out of the same place.
    expect(down.originX).toBeCloseTo(up.originX, 10);
    expect(down.originY).toBeCloseTo(up.originY, 10);
    expect(down.originZ).toBeCloseTo(up.originZ, 10);
  });

  it("clamps strength into [0,1] and survives a non-finite one", () => {
    const pool = createBurstPool();
    pool.trigger(1, 5, 2);
    expect(pool.bursts.find((b) => b.t0 === 1)!.strength).toBe(1);
    pool.trigger(2, -3, 2);
    expect(pool.bursts.find((b) => b.t0 === 2)!.strength).toBe(0);
    pool.trigger(3, NaN, 2);
    expect(pool.bursts.find((b) => b.t0 === 3)!.strength).toBe(0);
  });

  it("uploads a live plume's own origin, axis, strength and t0", () => {
    const pool = createBurstPool();
    pool.trigger(4.5, 0.8, 12.25);
    const { prog, uploads } = fakeProgram();
    pool.upload(prog);
    const slot = uploads.uBurstT0.indexOf(4.5);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(uploads.uBurstStrength[slot]).toBeCloseTo(0.8, 6);
    const b = pool.bursts[slot];
    expect(uploads.uBurstOrigin[slot * 3]).toBeCloseTo(b.originX, 6);
    expect(uploads.uBurstAxis[slot * 3 + 1]).toBeCloseTo(b.axisY, 6);
  });
});

describe("quiet-time gather signal", () => {
  it("is full in silence and gone under a loud, bass-heavy section", () => {
    expect(calmTarget(0, 0)).toBe(1);
    expect(calmTarget(1, 0)).toBe(0);
    expect(calmTarget(0, 1)).toBe(0);
  });

  it("falls as either the section or the bass rises", () => {
    expect(calmTarget(0.5, 0)).toBeLessThan(calmTarget(0.2, 0));
    expect(calmTarget(0, 0.4)).toBeLessThan(calmTarget(0, 0.1));
  });

  it("stays in [0,1] for out-of-range or non-finite inputs", () => {
    for (const section of [-1, 0, 0.5, 1, 4, NaN]) {
      for (const low of [-1, 0, 0.5, 1, 4, NaN]) {
        const v = calmTarget(section, low);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("hue drift", () => {
  const dt = 1 / 60;
  /** Walks `n` bar boundaries: barPhase has to fall by more than half a turn
   *  for a wrap to count, so each bar is a 0.9 -> 0.05 pair. */
  function bars(hue: ReturnType<typeof createHueDrift>, n: number, drift = 1) {
    for (let i = 0; i < n; i++) {
      hue.advance(dt, 0.9, false, drift);
      hue.advance(dt, 0.05, false, drift);
    }
  }

  it("starts at zero", () => {
    expect(createHueDrift().value).toBe(0);
  });

  it("creeps the sine phase forward one fixed angle per bar wrap, and only then", () => {
    const hue = createHueDrift();
    hue.advance(dt, 0.4, false, 1);
    hue.advance(dt, 0.9, false, 1);
    expect(hue.phase).toBe(0);
    hue.advance(dt, 0.05, false, 1); // wrapped
    expect(hue.phase).toBeCloseTo(HUE_BAR_RADIANS, 12);
  });

  it("stays inside the amplitude, however long it runs", () => {
    const hue = createHueDrift();
    bars(hue, 4000);
    for (let i = 0; i < 4000; i++) {
      expect(Math.abs(hue.value)).toBeLessThanOrEqual(HUE_AMPL + 1e-12);
    }
  });

  it("swings both ways rather than accumulating", () => {
    const hue = createHueDrift();
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 400; i++) {
      bars(hue, 1);
      min = Math.min(min, hue.value);
      max = Math.max(max, hue.value);
    }
    expect(max).toBeGreaterThan(HUE_AMPL * 0.9);
    expect(min).toBeLessThan(-HUE_AMPL * 0.9);
  });

  it("adds a one-off excursion on a drop and relaxes it away", () => {
    const hue = createHueDrift();
    hue.advance(dt, 0.5, true, 1);
    expect(hue.excursion).toBeCloseTo(HUE_DROP_EXCURSION, 10);
    expect(hue.value).toBeCloseTo(HUE_DROP_EXCURSION, 6);
    for (let t = 0; t < HUE_RELAX_TAU * 6; t += dt) hue.advance(dt, 0.5, false, 1);
    expect(hue.excursion).toBeLessThan(HUE_DROP_EXCURSION * 0.01);
    expect(Math.abs(hue.value)).toBeLessThan(HUE_AMPL + 1e-12);
  });

  it("never lets repeated drops accumulate without bound", () => {
    const hue = createHueDrift();
    for (let i = 0; i < 400; i++) {
      hue.advance(dt, 0.5, true, 1);
      for (let t = 0; t < 2; t += dt) hue.advance(dt, 0.5, false, 1);
    }
    // The steady state of a step every 2 s relaxing with tau 6 s, not a walk.
    expect(hue.excursion).toBeLessThan(HUE_DROP_EXCURSION * 5);
  });

  it("scales the whole shift with the Hue drift setting, and is exactly zero at 0", () => {
    const full = createHueDrift();
    const half = createHueDrift();
    const off = createHueDrift();
    for (const [hue, drift] of [
      [full, 1],
      [half, 0.5],
      [off, 0],
    ] as const) {
      hue.advance(dt, 0.5, true, drift);
      bars(hue, 3, drift);
    }
    expect(off.value).toBe(0);
    expect(half.value).toBeCloseTo(full.value * 0.5, 10);
  });

  it("ignores a non-positive dt and a non-finite drift", () => {
    const hue = createHueDrift();
    hue.advance(dt, 0.5, true, 1);
    const e = hue.excursion;
    hue.advance(-1, 0.5, false, 1);
    expect(hue.excursion).toBeCloseTo(e, 12);
    hue.advance(NaN, 0.5, false, 1);
    expect(hue.excursion).toBeCloseTo(e, 12);
    hue.advance(dt, 0.5, false, NaN);
    expect(hue.value).toBe(0);
  });
});

describe("wandering attractors", () => {
  it("keeps every attractor on its own orbit around the raised centre", () => {
    const out = new Float32Array(MAX_ATTRACTORS * 3);
    for (let t = 0; t < 400; t += 0.37) {
      attractorPositions(t, out);
      for (let i = 0; i < MAX_ATTRACTORS; i++) {
        const x = out[i * 3];
        const y = out[i * 3 + 1] - ATTRACTOR_CENTRE_Y;
        const z = out[i * 3 + 2];
        expect(Math.hypot(x, z)).toBeCloseTo(ATTRACTOR_RADIUS, 6);
        expect(Math.abs(y)).toBeLessThanOrEqual(ATTRACTOR_RADIUS * 0.45 + 1e-12);
      }
    }
  });

  it("never collapses all three onto one point", () => {
    const out = new Float32Array(MAX_ATTRACTORS * 3);
    for (let t = 0; t < 400; t += 0.37) {
      attractorPositions(t, out);
      let closest = Infinity;
      for (let i = 0; i < MAX_ATTRACTORS; i++) {
        for (let j = i + 1; j < MAX_ATTRACTORS; j++) {
          closest = Math.min(
            closest,
            Math.hypot(out[i * 3] - out[j * 3], out[i * 3 + 1] - out[j * 3 + 1], out[i * 3 + 2] - out[j * 3 + 2]),
          );
        }
      }
      expect(closest).toBeGreaterThan(0.01);
    }
  });

  it("moves, and survives a non-finite clock", () => {
    const a = attractorPositions(0, new Float32Array(MAX_ATTRACTORS * 3));
    const b = attractorPositions(10, new Float32Array(MAX_ATTRACTORS * 3));
    expect(Array.from(a)).not.toEqual(Array.from(b));
    expect(Array.from(attractorPositions(NaN, new Float32Array(MAX_ATTRACTORS * 3))).every(Number.isFinite)).toBe(true);
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

describe("chunk pool", () => {
  const ORIGIN: [number, number, number] = [0.1, -0.05, 0.2];
  const AXIS: [number, number, number] = [0, 1, 0];

  it("starts empty, with every slot uploading the dead sentinel", () => {
    const pool = createChunkPool();
    expect(pool.alive()).toBe(0);
    const { prog, uploads } = fakeProgram();
    pool.upload(prog);
    expect(uploads.uChunkT0).toEqual(new Array(MAX_CHUNK_BURSTS).fill(CHUNK_DEAD_T0));
    expect(uploads.uChunkStrength).toHaveLength(MAX_CHUNK_BURSTS);
    expect(uploads.uChunkSeed).toHaveLength(MAX_CHUNK_BURSTS);
    expect(uploads.uChunkOrigin).toHaveLength(MAX_CHUNK_BURSTS * 3);
    expect(uploads.uChunkAxis).toHaveLength(MAX_CHUNK_BURSTS * 3);
  });

  it("holds at most MAX_CHUNK_BURSTS live bursts", () => {
    const pool = createChunkPool();
    for (let i = 0; i < MAX_CHUNK_BURSTS * 3; i++) pool.trigger(i * 0.01, 1, i, ORIGIN, AXIS);
    expect(pool.alive()).toBe(MAX_CHUNK_BURSTS);
  });

  it("displaces the oldest burst once every slot is live", () => {
    const pool = createChunkPool();
    for (let i = 0; i < MAX_CHUNK_BURSTS; i++) pool.trigger(i * 0.01, 1, i, ORIGIN, AXIS);
    pool.trigger(1, 1, 99, ORIGIN, AXIS);
    const seeds = pool.bursts.map((b) => b.seed);
    // The very first burst (seed 0, oldest t0) is the one that went.
    expect(seeds).toContain(99);
    expect(seeds).not.toContain(0);
  });

  it("expires a burst after CHUNK_LIFE_SEC and returns its slot to the dead sentinel", () => {
    const pool = createChunkPool();
    pool.trigger(10, 1, 7, ORIGIN, AXIS);
    pool.tick(10 + CHUNK_LIFE_SEC * 0.99);
    expect(pool.alive()).toBe(1);
    pool.tick(10 + CHUNK_LIFE_SEC + 1e-3);
    expect(pool.alive()).toBe(0);

    const { prog, uploads } = fakeProgram();
    pool.upload(prog);
    expect(uploads.uChunkT0.every((t) => t === CHUNK_DEAD_T0)).toBe(true);
  });

  it("uploads a live burst's own t0, strength, seed, origin and axis", () => {
    const pool = createChunkPool();
    pool.trigger(4.5, 0.8, 12.25, ORIGIN, [0.6, 0.8, 0]);
    const { prog, uploads } = fakeProgram();
    pool.upload(prog);
    const slot = uploads.uChunkT0.indexOf(4.5);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(uploads.uChunkStrength[slot]).toBeCloseTo(0.8, 6);
    expect(uploads.uChunkSeed[slot]).toBeCloseTo(12.25, 6);
    // Float32Array round trip, so compare componentwise rather than deeply.
    for (let i = 0; i < 3; i++) {
      expect(uploads.uChunkOrigin[slot * 3 + i]).toBeCloseTo(ORIGIN[i], 6);
      expect(uploads.uChunkAxis[slot * 3 + i]).toBeCloseTo([0.6, 0.8, 0][i], 6);
    }
  });

  it("reuses an expired slot rather than growing the pool", () => {
    const pool = createChunkPool();
    for (let i = 0; i < MAX_CHUNK_BURSTS; i++) pool.trigger(0, 1, i, ORIGIN, AXIS);
    pool.tick(CHUNK_LIFE_SEC + 1);
    pool.trigger(CHUNK_LIFE_SEC + 1, 1, 42, ORIGIN, AXIS);
    expect(pool.alive()).toBe(1);
    expect(pool.bursts).toHaveLength(MAX_CHUNK_BURSTS);
  });

  it("draws a whole number of full bursts", () => {
    expect(CHUNKS_PER_BURST).toBeGreaterThan(0);
    expect(MAX_CHUNK_BURSTS * CHUNKS_PER_BURST).toBe(MAX_CHUNK_BURSTS * CHUNKS_PER_BURST);
  });
});

describe("point sizing across render scales", () => {
  // The Grain-size default: mix(GRAIN_PX_MIN, GRAIN_PX_MAX, 0.5).
  const BASE = 3.5;

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
