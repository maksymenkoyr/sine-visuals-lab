import { describe, it, expect } from "vitest";
import {
  waveStrengthFromDrop,
  waveFallbackIntervalSec,
  advanceBrushPhase,
  driftCenter,
  createWavePool,
  MAX_WAVE_BURSTS,
  WAVE_LIFE_SEC,
  WAVE_DEAD_T0,
  skyScene,
} from "../src/render/scenes/sky.ts";
import { computeAutoTarget } from "../src/render/autoTune.ts";
import { NEUTRAL } from "../src/render/musicProfile.ts";
import type { GLProgram } from "../src/render/gl.ts";

/** A GLProgram stub that only records the float-array uploads — same
 *  pattern as tests/powder.test.ts's fakeProgram. */
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
    setV3v: noop,
    setV4v: noop,
    dispose: noop,
  } as unknown as GLProgram;
  return { prog, uploads };
}

describe("waveStrengthFromDrop", () => {
  it("stays within [0, 1]", () => {
    for (let p = 0; p <= 1; p += 0.1) {
      for (let s = 0; s <= 1; s += 0.1) {
        const v = waveStrengthFromDrop(p, s);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is monotone non-decreasing in both dropPulse and sectionIntensity", () => {
    expect(waveStrengthFromDrop(1, 0.5)).toBeGreaterThan(waveStrengthFromDrop(0, 0.5));
    expect(waveStrengthFromDrop(0.5, 1)).toBeGreaterThan(waveStrengthFromDrop(0.5, 0));
  });

  it("is never 0 even at dropPulse 0, sectionIntensity 0 (a drop always gives some wave)", () => {
    expect(waveStrengthFromDrop(0, 0)).toBeGreaterThan(0);
  });

  it("tolerates NaN/undefined inputs without throwing", () => {
    expect(() => waveStrengthFromDrop(NaN, NaN)).not.toThrow();
    expect(waveStrengthFromDrop(NaN, NaN)).toBeGreaterThanOrEqual(0);
    expect(waveStrengthFromDrop(undefined as unknown as number, 0.5)).toBeGreaterThanOrEqual(0);
  });
});

describe("waveFallbackIntervalSec", () => {
  it("is monotone non-increasing in frequency (higher frequency, shorter gap)", () => {
    let prev = waveFallbackIntervalSec(0);
    for (let f = 0.1; f <= 1; f += 0.1) {
      const cur = waveFallbackIntervalSec(f);
      expect(cur).toBeLessThanOrEqual(prev + 1e-9);
      prev = cur;
    }
  });

  it("stays positive across the whole range", () => {
    for (let f = 0; f <= 1; f += 0.1) expect(waveFallbackIntervalSec(f)).toBeGreaterThan(0);
  });

  it("clamps an out-of-range or non-finite frequency", () => {
    expect(waveFallbackIntervalSec(-5)).toBe(waveFallbackIntervalSec(0));
    expect(waveFallbackIntervalSec(5)).toBe(waveFallbackIntervalSec(1));
    expect(Number.isFinite(waveFallbackIntervalSec(NaN))).toBe(true);
  });
});

describe("advanceBrushPhase", () => {
  it("is strictly increasing for a positive dt (never wraps, unlike anim.barPhase)", () => {
    let phase = 0;
    for (let i = 0; i < 2000; i++) {
      const next = advanceBrushPhase(phase, 1 / 60);
      expect(next).toBeGreaterThan(phase);
      phase = next;
    }
    // 2000 frames at 60fps is ~33s — comfortably past a full turn (2*PI) at
    // BRUSH_TURNS_PER_SEC's ~22s-per-turn rate.
    expect(phase).toBeGreaterThan(Math.PI * 2);
  });

  it("does not advance for a zero or negative dt", () => {
    expect(advanceBrushPhase(3, 0)).toBe(3);
    expect(advanceBrushPhase(3, -1)).toBe(3);
  });

  it("tolerates non-finite input without throwing or producing NaN", () => {
    expect(Number.isFinite(advanceBrushPhase(NaN, 1 / 60))).toBe(true);
    expect(Number.isFinite(advanceBrushPhase(1, NaN))).toBe(true);
  });
});

describe("driftCenter", () => {
  it("stays within the documented bounds ([0.20, 0.80] x [0.28, 0.72]) for any seed/time", () => {
    for (const seed of [0, 1.7, 5.3, 12, -3]) {
      for (let t = 0; t < 200; t += 3.3) {
        const [x, y] = driftCenter(seed, t);
        expect(x).toBeGreaterThanOrEqual(0.2);
        expect(x).toBeLessThanOrEqual(0.8);
        expect(y).toBeGreaterThanOrEqual(0.28);
        expect(y).toBeLessThanOrEqual(0.72);
      }
    }
  });

  it("is deterministic for the same (seed, t) and moves as t advances", () => {
    const a = driftCenter(1.7, 10);
    const b = driftCenter(1.7, 10);
    expect(a).toEqual(b);
    const c = driftCenter(1.7, 40);
    expect(a).not.toEqual(c);
  });

  it("different seeds trace different paths", () => {
    const a = driftCenter(1.7, 10);
    const b = driftCenter(5.3, 10);
    expect(a).not.toEqual(b);
  });

  it("survives a non-finite seed or time", () => {
    const [x, y] = driftCenter(NaN, NaN);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });
});

describe("wave pool", () => {
  it("starts empty, with every slot uploading the dead sentinel", () => {
    const pool = createWavePool();
    expect(pool.alive()).toBe(0);
    const { prog, uploads } = fakeProgram();
    pool.upload(prog);
    expect(uploads.uBurstT0).toEqual(new Array(MAX_WAVE_BURSTS).fill(WAVE_DEAD_T0));
    expect(uploads.uBurstAmp).toHaveLength(MAX_WAVE_BURSTS);
    expect(uploads.uBurstSeed).toHaveLength(MAX_WAVE_BURSTS);
  });

  it("holds at most MAX_WAVE_BURSTS live waves", () => {
    const pool = createWavePool();
    for (let i = 0; i < MAX_WAVE_BURSTS * 3; i++) pool.trigger(i * 0.01, 1, i);
    expect(pool.alive()).toBe(MAX_WAVE_BURSTS);
  });

  it("displaces the oldest wave once every slot is live", () => {
    const pool = createWavePool();
    for (let i = 0; i < MAX_WAVE_BURSTS; i++) pool.trigger(i * 0.01, 1, i);
    pool.trigger(1, 1, 99);
    const seeds = pool.bursts.map((b) => b.seed);
    expect(seeds).toContain(99);
    expect(seeds).not.toContain(0);
  });

  it("expires a wave after WAVE_LIFE_SEC and returns its slot to the dead sentinel", () => {
    const pool = createWavePool();
    pool.trigger(10, 1, 7);
    pool.tick(10 + WAVE_LIFE_SEC * 0.99);
    expect(pool.alive()).toBe(1);
    pool.tick(10 + WAVE_LIFE_SEC + 1e-3);
    expect(pool.alive()).toBe(0);

    const { prog, uploads } = fakeProgram();
    pool.upload(prog);
    expect(uploads.uBurstT0.every((t) => t === WAVE_DEAD_T0)).toBe(true);
  });

  it("uploads a live wave's own t0, strength and seed", () => {
    const pool = createWavePool();
    pool.trigger(4.5, 0.8, 12.25);
    const { prog, uploads } = fakeProgram();
    pool.upload(prog);
    const slot = uploads.uBurstT0.indexOf(4.5);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(uploads.uBurstAmp[slot]).toBeCloseTo(0.8, 6);
    expect(uploads.uBurstSeed[slot]).toBeCloseTo(12.25, 6);
  });

  it("clamps an out-of-range strength to [0, 1]", () => {
    const pool = createWavePool();
    pool.trigger(1, 5, 0);
    expect(pool.bursts[0].strength).toBe(1);
    pool.trigger(2, -5, 1);
    expect(pool.bursts.find((b) => b.seed === 1)?.strength).toBe(0);
  });

  it("reuses an expired slot rather than growing the pool", () => {
    const pool = createWavePool();
    for (let i = 0; i < MAX_WAVE_BURSTS; i++) pool.trigger(0, 1, i);
    pool.tick(WAVE_LIFE_SEC + 1);
    pool.trigger(WAVE_LIFE_SEC + 1, 1, 42);
    expect(pool.alive()).toBe(1);
    expect(pool.bursts).toHaveLength(MAX_WAVE_BURSTS);
  });
});

describe("sky's auto settings reproduce their default at NEUTRAL", () => {
  it("every setting with an auto table resolves to spec.default when every dial sits at NEUTRAL", () => {
    const settings = skyScene.settings ?? [];
    const withAuto = settings.filter((s) => s.auto);
    expect(withAuto.length).toBeGreaterThan(0);
    for (const spec of withAuto) {
      expect(computeAutoTarget(spec, NEUTRAL, 1)).toBe(spec.default);
    }
  });
});

describe("sky's SETTINGS follow the auto weight-authoring convention", () => {
  it("every auto weight has |w| in [0.15, 0.5] and each setting's sum of |w| stays under 0.8", () => {
    const settings = skyScene.settings ?? [];
    for (const s of settings) {
      if (!s.auto) continue;
      let sum = 0;
      for (const [dial, w] of Object.entries(s.auto)) {
        expect(Math.abs(w!), `${s.key}.auto.${dial}`).toBeGreaterThanOrEqual(0.15);
        expect(Math.abs(w!), `${s.key}.auto.${dial}`).toBeLessThanOrEqual(0.5);
        sum += Math.abs(w!);
      }
      expect(sum, `${s.key} sum of |auto weights|`).toBeLessThan(0.8);
    }
  });
});

describe("sky scene registration", () => {
  it("has no variant (a plain slider set, no style enum)", () => {
    const variants = (skyScene.settings ?? []).filter((s) => s.variant);
    expect(variants).toHaveLength(0);
  });

  it("id is 'sky' and every setting group is one of the settings ladder's groups", () => {
    expect(skyScene.id).toBe("sky");
    for (const s of skyScene.settings ?? []) {
      expect(["Form", "Motion", "Look", "Camera", "Post"]).toContain(s.group);
    }
  });
});
