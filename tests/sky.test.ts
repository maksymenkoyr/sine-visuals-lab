import { describe, it, expect } from "vitest";
import {
  floaterCountFromEnergy,
  stepBrush,
  sweepSlot,
  MAX_SWEEPS,
  waveLifeSec,
  floaterGain,
  dayRatePerSec,
  advanceDayOffset,
  sunElevation,
  nightSpeedup,
  advanceBrushPhase,
  driftCenter,
  drifterPuff,
  pickSwarmCenter,
  createWavePool,
  MAX_WAVE_BURSTS,
  WAVE_LIFE_SEC,
  WAVE_DEAD_T0,
  spawnFloaters,
  skyScene,
  liftByDrive,
  DRIFTER_SEEDS,
  SKY_SPLAT_SLOTS,
  SHADER_SEED_PERIOD,
  wrapShaderSeed,
  cloudNoiseFlows,
  CLOUD_FLOW_LEN,
} from "../src/render/scenes/sky/sky.ts";
import { NOISE_PERIOD } from "../src/render/noiseHash.ts";
import { computeAutoTarget, resolveSceneSetting } from "../src/render/autoTune.ts";
import { setSceneMaster, setSceneExpansion, SCENE_MASTER_DEFAULT, SCENE_EXPANSION_DEFAULT } from "../src/render/sceneSettings.ts";
import { NEUTRAL } from "../src/render/musicProfile.ts";
import { SIGNALS } from "../src/render/signals.ts";
import type { DriveChoice } from "../src/render/drives.ts";
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

describe("floaterCountFromEnergy", () => {
  it("stays within [0.45, 1] and rises with loudness", () => {
    for (let e = 0; e <= 1; e += 0.1) {
      const v = floaterCountFromEnergy(e);
      expect(v).toBeGreaterThanOrEqual(0.45);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(floaterCountFromEnergy(1)).toBeGreaterThan(floaterCountFromEnergy(0));
    expect(floaterCountFromEnergy(0.5)).toBeGreaterThan(floaterCountFromEnergy(0.2));
  });

  it("never returns 0 (a Scene stamp is always visible; the gate owns off)", () => {
    expect(floaterCountFromEnergy(0)).toBeGreaterThan(0);
  });

  it("tolerates NaN/undefined inputs without throwing", () => {
    expect(() => floaterCountFromEnergy(NaN)).not.toThrow();
    expect(floaterCountFromEnergy(NaN)).toBeGreaterThanOrEqual(0);
    expect(floaterCountFromEnergy(undefined as unknown as number)).toBeGreaterThanOrEqual(0);
  });
});

describe("stepBrush", () => {
  it("holds the position at stride 0 (Brush move = 0), only the heading wanders", () => {
    const next = stepBrush([0.4, 0.6], 1.2, 0, 7);
    expect(next.x).toBeCloseTo(0.4, 10);
    expect(next.y).toBeCloseTo(0.6, 10);
    expect(next.heading).not.toBe(1.2);
  });

  it("steps exactly `stride` from the centre (no wrap reachable there)", () => {
    const next = stepBrush([0.5, 0.5], 1.2, 0.2, 3);
    expect(Math.hypot(next.x - 0.5, next.y - 0.5)).toBeCloseTo(0.2, 10);
  });

  it("stays wrapped into [0, 1) when stepping near an edge", () => {
    let pos: [number, number] = [0.98, 0.02];
    let heading = 2.4;
    for (let seed = 0; seed < 40; seed++) {
      const next = stepBrush(pos, heading, 0.5, seed);
      expect(next.x).toBeGreaterThanOrEqual(0);
      expect(next.x).toBeLessThan(1);
      expect(next.y).toBeGreaterThanOrEqual(0);
      expect(next.y).toBeLessThan(1);
      pos = [next.x, next.y];
      heading = next.heading;
    }
  });

  it("is deterministic per seed and NaN-safe", () => {
    const a = stepBrush([0.3, 0.3], 0.5, 0.2, 11);
    const b = stepBrush([0.3, 0.3], 0.5, 0.2, 11);
    expect(a).toEqual(b);
    const safe = stepBrush([NaN, NaN], NaN, NaN, NaN);
    expect(Number.isFinite(safe.x)).toBe(true);
    expect(Number.isFinite(safe.y)).toBe(true);
    expect(Number.isFinite(safe.heading)).toBe(true);
    expect(safe.x).toBeGreaterThanOrEqual(0);
    expect(safe.x).toBeLessThan(1);
  });
});

describe("day cycle", () => {
  it("holds still at Day drift 0 and speeds up monotonically above it", () => {
    expect(dayRatePerSec(0)).toBe(0);
    let prev = 0;
    for (let d = 0.05; d <= 1.0001; d += 0.05) {
      const r = dayRatePerSec(d);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });

  it("spans roughly a half-hour day at the slow end to a one-minute day at the fast end", () => {
    expect(1 / dayRatePerSec(1)).toBeCloseTo(60, 6);
    expect(1 / dayRatePerSec(0.001)).toBeGreaterThan(1700);
    expect(1 / dayRatePerSec(0.001)).toBeLessThan(1810);
  });

  it("advanceDayOffset wraps into [0, 1) and never moves at drift 0", () => {
    expect(advanceDayOffset(0.3, 10, 0)).toBe(0.3);
    let off = 0;
    for (let i = 0; i < 500; i++) {
      off = advanceDayOffset(off, 1, 1);
      expect(off).toBeGreaterThanOrEqual(0);
      expect(off).toBeLessThan(1);
    }
    // A one-minute day: 60 seconds lands back where it started.
    expect(advanceDayOffset(0.2, 60, 1)).toBeCloseTo(0.2, 6);
  });

  it("advanceDayOffset survives non-finite and negative inputs", () => {
    expect(Number.isFinite(advanceDayOffset(NaN, NaN, NaN))).toBe(true);
    expect(advanceDayOffset(0.5, -3, 1)).toBe(0.5);
  });

  it("nightSpeedup: normal pace while the sun is up, hurried once it's well below the horizon", () => {
    expect(nightSpeedup(0.5)).toBe(1); // noon
    expect(nightSpeedup(0.71)).toBe(1); // the default early evening
    expect(nightSpeedup(0.75)).toBe(1); // sunset itself
    expect(nightSpeedup(0)).toBeCloseTo(12, 6); // midnight
    expect(nightSpeedup(0.765)).toBeGreaterThan(1); // just after sunset, mid-ramp
    expect(nightSpeedup(0.765)).toBeLessThan(12);
  });

  it("a drifted day spends most of its time in daylight, skipping quickly through the night", () => {
    let phase = 0.25; // start at sunrise
    let offset = 0;
    let daySec = 0;
    let nightSec = 0;
    const dt = 0.05;
    // Walk one full cycle at Day drift = 1 (a one-minute day before the speedup).
    while (offset < 0.999) {
      const before = offset;
      if (sunElevation(phase) >= 0) daySec += dt;
      else nightSec += dt;
      offset = advanceDayOffset(offset, dt, 1, phase);
      if (offset < before) break; // wrapped
      phase = (0.25 + offset) % 1;
    }
    expect(nightSec).toBeLessThan(daySec * 0.25);
    expect(nightSec / (daySec + nightSec)).toBeLessThan(0.1);
  });

  it("sunElevation: sunrise and sunset on the horizon, noon highest, midnight lowest", () => {
    expect(sunElevation(0.25)).toBeCloseTo(0, 6);
    expect(sunElevation(0.75)).toBeCloseTo(0, 6);
    expect(sunElevation(0.5)).toBeCloseTo(1, 6);
    expect(sunElevation(0)).toBeCloseTo(-1, 6);
  });

  it("the default Time of day sits in early evening, on the key the scene's earlier fixed look became", () => {
    const spec = (skyScene.settings ?? []).find((s) => s.key === "timeOfDay");
    expect(spec).toBeDefined();
    const t = spec!.default;
    expect(t).toBeGreaterThan(0.5); // afternoon/evening, not morning
    expect(sunElevation(t)).toBeCloseTo(0.25, 1); // DAY_KEY_E's early-evening key
  });

  it("Time of day is a clock position, so the Master and Expansion dials never move it", () => {
    const spec = (skyScene.settings ?? []).find((s) => s.key === "timeOfDay")!;
    expect(spec.masterScale).toBe(false);
    try {
      setSceneMaster(0.6);
      setSceneExpansion(1.5);
      expect(resolveSceneSetting("sky", spec)).toBeCloseTo(spec.default, 9);
    } finally {
      setSceneMaster(SCENE_MASTER_DEFAULT);
      setSceneExpansion(SCENE_EXPANSION_DEFAULT);
    }
  });
});

describe("floater sustain and visibility", () => {
  it("waveLifeSec grows with Sustain from under a second to several seconds", () => {
    let prev = waveLifeSec(0);
    expect(prev).toBeLessThan(1);
    for (let s = 0.1; s <= 1.0001; s += 0.1) {
      const cur = waveLifeSec(s);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
    expect(waveLifeSec(1)).toBeGreaterThan(5);
  });

  it("the default Sustain keeps waves close to the tuned couple of seconds", () => {
    const spec = (skyScene.settings ?? []).find((s) => s.key === "floaterSustain");
    expect(spec).toBeDefined();
    const life = waveLifeSec(spec!.default);
    expect(life).toBeGreaterThan(1.4);
    expect(life).toBeLessThan(2.2);
  });

  it("floaterGain hides floaters at 0 and makes the default 20% stronger than the tuned contrast", () => {
    expect(floaterGain(0)).toBe(0);
    const spec = (skyScene.settings ?? []).find((s) => s.key === "floaterVisibility");
    expect(spec).toBeDefined();
    expect(floaterGain(spec!.default)).toBeCloseTo(1.2, 6);
    expect(floaterGain(1)).toBeGreaterThan(floaterGain(spec!.default));
  });

  it("both clamp out-of-range and non-finite input", () => {
    expect(waveLifeSec(-1)).toBe(waveLifeSec(0));
    expect(waveLifeSec(9)).toBe(waveLifeSec(1));
    expect(Number.isFinite(waveLifeSec(NaN))).toBe(true);
    expect(floaterGain(9)).toBe(floaterGain(1));
    expect(floaterGain(NaN)).toBe(0);
  });

  it("the wave pool retires each wave on its own life, and uploads it", () => {
    const pool = createWavePool();
    pool.trigger(0, 1, 1, 0.5, 0.5, 1);
    pool.trigger(0, 1, 2, 0.5, 0.5, 5);
    pool.tick(2);
    expect(pool.alive()).toBe(1);
    expect(pool.bursts.find((b) => b.t0 !== WAVE_DEAD_T0)?.seed).toBe(2);
    const { prog, uploads } = fakeProgram();
    pool.upload(prog);
    expect(uploads.uBurstLife).toContain(5);
    pool.tick(5.01);
    expect(pool.alive()).toBe(0);
  });
});

describe("sweepSlot", () => {
  it("cycles through every ring slot in order, so the oldest sweep is the one overwritten", () => {
    const slots = Array.from({ length: MAX_SWEEPS * 2 }, (_, i) => sweepSlot(i));
    for (let i = 0; i < slots.length; i++) expect(slots[i]).toBe(i % MAX_SWEEPS);
  });

  it("stays in range for negative, fractional and non-finite counts", () => {
    for (const v of [-4, 2.7, NaN, Infinity]) {
      const s = sweepSlot(v);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(MAX_SWEEPS);
    }
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
  it("stays within the documented bounds ([0.04, 0.96] x [0.06, 0.94]) for any seed/time", () => {
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1.7, 12, -3]) {
      for (let t = 0; t < 200; t += 3.3) {
        const [x, y] = driftCenter(seed, t);
        expect(x).toBeGreaterThanOrEqual(0.04);
        expect(x).toBeLessThanOrEqual(0.96);
        expect(y).toBeGreaterThanOrEqual(0.06);
        expect(y).toBeLessThanOrEqual(0.94);
      }
    }
  });

  it("spreads consecutive integer seeds over the frame, not clumped at the centre", () => {
    const pts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => driftCenter(s, 0));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.55);
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

describe("drifterPuff", () => {
  it("stays in [0, 1], goes fully off and fully on over a cycle, and survives NaN", () => {
    let lo = 1;
    let hi = 0;
    for (let t = 0; t < 60; t += 0.25) {
      const v = drifterPuff(3, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBe(0);
    expect(hi).toBe(1);
    expect(Number.isFinite(drifterPuff(NaN, NaN))).toBe(true);
  });
});

describe("pickSwarmCenter", () => {
  const brush: [number, number] = [0.4, 0.6];

  it("stays in a ring around the brush and is deterministic per seed", () => {
    for (let seed = 0; seed < 20; seed++) {
      const [x, y] = pickSwarmCenter(seed, brush, []);
      const d = Math.hypot(x - brush[0], y - brush[1]);
      expect(d).toBeLessThanOrEqual(0.1 + 1e-9); // STAMP_JITTER
      expect(x).toBeGreaterThanOrEqual(0.03);
      expect(x).toBeLessThanOrEqual(0.97);
      expect(y).toBeGreaterThanOrEqual(0.03);
      expect(y).toBeLessThanOrEqual(0.97);
      expect(pickSwarmCenter(seed, brush, [])).toEqual([x, y]);
    }
  });

  it("keeps clear of the obstacles — a cloud on the brush nudges the stamp off it", () => {
    for (let seed = 0; seed < 10; seed++) {
      const [x, y] = pickSwarmCenter(seed, brush, [brush]);
      expect(Math.hypot(x - brush[0], y - brush[1])).toBeGreaterThan(0);
    }
  });

  it("survives no obstacles and non-finite inputs", () => {
    const [x, y] = pickSwarmCenter(NaN, [NaN, NaN], []);
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

  it("uploads the seed wrapped to SHADER_SEED_PERIOD, leaving the pool's own seed whole", () => {
    const pool = createWavePool();
    pool.trigger(1, 0.8, SHADER_SEED_PERIOD + 5);
    pool.trigger(2, 0.8, 3);
    const { prog, uploads } = fakeProgram();
    pool.upload(prog);
    expect(uploads.uBurstSeed[uploads.uBurstT0.indexOf(1)]).toBeCloseTo(5, 6);
    expect(uploads.uBurstSeed[uploads.uBurstT0.indexOf(2)]).toBeCloseTo(3, 6);
    expect(pool.bursts.map((b) => b.seed)).toContain(SHADER_SEED_PERIOD + 5);
  });

  it("wrapShaderSeed keeps a long session's seeds small, and is exact for the first period", () => {
    expect(wrapShaderSeed(0)).toBe(0);
    expect(wrapShaderSeed(255)).toBe(255);
    expect(wrapShaderSeed(256)).toBe(0);
    expect(wrapShaderSeed(1e9 + 0.5)).toBeGreaterThanOrEqual(0);
    expect(wrapShaderSeed(1e9 + 0.5)).toBeLessThan(SHADER_SEED_PERIOD);
    expect(wrapShaderSeed(-1)).toBe(SHADER_SEED_PERIOD - 1);
    expect(wrapShaderSeed(NaN)).toBe(0);
  });

  it("uploads a live wave's spawn position, defaulting to the screen centre", () => {
    const pool = createWavePool();
    pool.trigger(1, 1, 3, 0.2, 0.7);
    pool.trigger(2, 1, 4);
    const { prog, uploads } = fakeProgram();
    pool.upload(prog);
    const a = uploads.uBurstT0.indexOf(1);
    const b = uploads.uBurstT0.indexOf(2);
    expect(uploads.uBurstX[a]).toBeCloseTo(0.2, 6);
    expect(uploads.uBurstY[a]).toBeCloseTo(0.7, 6);
    expect(uploads.uBurstX[b]).toBe(0.5);
    expect(uploads.uBurstY[b]).toBe(0.5);
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

describe("cloudNoiseFlows", () => {
  it("equals the raw per-octave drift for a short session", () => {
    const f = cloudNoiseFlows(10);
    // octave 0: bump (0.05, 0.03) per second, wisp (-0.085, 0), wrapped into [0, NOISE_PERIOD)
    expect(f[0]).toBeCloseTo(0.5, 5);
    expect(f[1]).toBeCloseTo(0.3, 5);
    expect(f[2]).toBeCloseTo(NOISE_PERIOD - 0.85, 4);
    expect(f[3]).toBe(0);
    // octave 1 sees the same offset scaled by the fbm lacunarity
    expect(f[4]).toBeCloseTo(0.5 * 2.02, 5);
    expect(f[5]).toBeCloseTo(0.3 * 2.02, 5);
  });

  it("keeps every offset inside the lattice period however long the session runs", () => {
    for (const t of [0, 1, 3600, 86400, 1e6, 1e9, 123456.789]) {
      const f = cloudNoiseFlows(t);
      expect(f.length).toBe(CLOUD_FLOW_LEN);
      for (const v of f) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(NOISE_PERIOD);
      }
    }
  });

  it("is deterministic, reuses a given buffer, and survives non-finite time", () => {
    const buf = new Float32Array(CLOUD_FLOW_LEN);
    expect(cloudNoiseFlows(77.7, buf)).toBe(buf);
    expect(Array.from(buf)).toEqual(Array.from(cloudNoiseFlows(77.7)));
    for (const v of cloudNoiseFlows(NaN)) expect(v).toBe(0);
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

// The patch-bay table (src/render/drives.ts's header owns the system). Every
// jack's default now reacts to the music (drives.ts's header's "Nothing
// plugged in" paragraph): Floaters and Light waves keep a Scene composite
// (a genuine mix of more than one signal), and every other ambient jack
// below defaults to one plain catalogue signal, lifted on top of its own
// slider (liftByDrive/skyLift) rather than the old "steady"/no-reaction
// Scene mix. The second test pins the boundary the other way: the settings
// drives.ts calls response-shape/timeline params carry no jack at all.
describe("sky's patch-bay drives", () => {
  const driveKeys = (skyScene.settings ?? []).filter((s) => s.drive).map((s) => s.key);
  const specFor = (key: string) => (skyScene.settings ?? []).find((s) => s.key === key)!;
  // Every ambient jack's own new default — the reading its coupling lifts
  // the slider toward (SETTINGS' own per-setting comments in sky.ts).
  const CATALOGUE_DEFAULTS: Record<string, DriveChoice> = {
    cloudCover: "anim.sectionIntensity",
    flowSpeed: "anim.energy",
    turbulence: "anim.low",
    cloudBrightness: "anim.mid",
    floaterVisibility: "anim.high",
    brushOpacity: "anim.energy",
  };

  it("exactly these settings carry a jack", () => {
    expect(driveKeys.sort()).toEqual(
      ["brushOpacity", "cloudBrightness", "cloudCover", "flowSpeed", "floaterDensity", "floaterVisibility", "lightWaves", "turbulence"].sort(),
    );
  });

  it("floaterDensity and lightWaves stay Scene-default with a label and catalogue-honest sceneSources", () => {
    for (const key of ["floaterDensity", "lightWaves"]) {
      const spec = specFor(key);
      expect(spec.drive!.default, `${key}.drive.default`).toBe("scene");
      expect(spec.drive!.sceneLabel, `${key}.drive.sceneLabel`).toBeTruthy();
      for (const src of spec.drive!.sceneSources ?? []) {
        expect(Object.keys(SIGNALS), `${key}.drive.sceneSources`).toContain(src);
      }
    }
  });

  it("every other ambient jack defaults to exactly its own plain catalogue signal, with no sceneLabel", () => {
    for (const [key, id] of Object.entries(CATALOGUE_DEFAULTS)) {
      const spec = specFor(key);
      expect(spec.drive!.default, `${key}.drive.default`).toBe(id);
      expect(spec.drive!.sceneLabel, `${key}.drive.sceneLabel`).toBeUndefined();
    }
  });

  it("brush move, floater sustain, time of day and day drift carry no jack (motion shape/lifetime/day timeline, per drives.ts's boundary)", () => {
    for (const key of ["brushMove", "floaterSustain", "timeOfDay", "dayDrift"]) {
      const spec = (skyScene.settings ?? []).find((s) => s.key === key);
      expect(spec, key).toBeDefined();
      expect(spec!.drive, key).toBeUndefined();
    }
  });

  it("wave strength and wave frequency no longer exist — Floaters owns spawn alone", () => {
    const keys = (skyScene.settings ?? []).map((s) => s.key);
    expect(keys).not.toContain("waveStrength");
    expect(keys).not.toContain("waveFrequency");
  });

  it("floaters has no hand-authored reads — its live pill comes from the drive choice", () => {
    const spec = (skyScene.settings ?? []).find((s) => s.key === "floaterDensity");
    expect(spec!.reads).toBeUndefined();
  });
});

// liftByDrive: the coupling the ambient amounts above use instead of a bare
// `slider * drive` — drives.ts's header's "Nothing plugged in" paragraph.
describe("liftByDrive", () => {
  it("is identity at drive 0, monotone increasing in drive, and never exceeds 1", () => {
    for (const amount of [0, 0.2, 0.5, 0.8, 1]) {
      expect(liftByDrive(amount, 0)).toBeCloseTo(amount, 10);
      let prev = liftByDrive(amount, 0);
      for (const drive of [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2]) {
        const v = liftByDrive(amount, drive);
        expect(v).toBeGreaterThanOrEqual(prev);
        expect(v).toBeLessThanOrEqual(1);
        prev = v;
      }
    }
  });

  it("fails closed to a finite number on non-finite input", () => {
    expect(Number.isFinite(liftByDrive(NaN, 1))).toBe(true);
    expect(Number.isFinite(liftByDrive(0.5, NaN))).toBe(true);
  });
});

// The floater stamp gate (spawnFloaters in sky.ts): Floaters is the one
// param — the count grade passes through only while the Floaters amount
// product (resolved amount x its drive, the exact number the shader's
// off-gate checks) and the grade itself are above 0; render() stamps
// nothing otherwise, and a live stamp stops drawing through the shader
// gate. floaterCountFromEnergy is the Scene grade, so it never trips this.
describe("floater stamp gate", () => {
  const setting = (key: string) => (skyScene.settings ?? []).find((s) => s.key === key)!;

  it("passes the count grade through while both inputs are above 0", () => {
    expect(spawnFloaters(0.5, 0.42)).toBe(0.42);
    expect(spawnFloaters(0.05, 1)).toBe(1);
  });

  it("returns 0 when the amount product or the count is 0", () => {
    expect(spawnFloaters(0, 0.42)).toBe(0);
    expect(spawnFloaters(0.5, 0)).toBe(0);
    expect(spawnFloaters(0, 0)).toBe(0);
  });

  it("fails closed on NaN or negative readings", () => {
    expect(spawnFloaters(NaN, 0.42)).toBe(0);
    expect(spawnFloaters(0.5, NaN)).toBe(0);
    expect(spawnFloaters(-1, 0.42)).toBe(0);
    expect(spawnFloaters(0.5, -1)).toBe(0);
  });

  it("the spawn amount rests above the gate at its default (the shipped look can't self-silence), and the Scene grade never reads 0", () => {
    expect(setting("floaterDensity").default).toBeGreaterThan(0);
    expect(floaterCountFromEnergy(0)).toBeGreaterThan(0);
  });
});

describe("SKY_SPLAT_SLOTS", () => {
  it("has a splat slot for every cloud drifter (the sim silently drops slots past it)", () => {
    expect(DRIFTER_SEEDS.length).toBeLessThanOrEqual(SKY_SPLAT_SLOTS);
  });
});
