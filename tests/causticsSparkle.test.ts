import { describe, it, expect } from "vitest";
import {
  advanceSparkleHits,
  createSparkleHits,
  PLUCK_TAU,
  SHAPE_BELL,
  SHAPE_BOUNCE,
  SHAPE_PLUCK,
  SHAPE_SWELL,
  SPARKLE_EFFECT_HINTS,
  SPARKLE_EFFECT_ROWS,
  SPARKLE_EFFECTS,
  SPARKLE_HITS,
  SPARKLE_PANEL_KEYS,
  SPARKLE_SHAPE_HINTS,
  SPARKLE_SHAPE_ROWS,
  SPARKLE_SHAPES,
  sparkleEnvelope,
  sparkleSoftCap,
  type SparkleShapeParams,
} from "../src/render/scenes/causticsSparkle.ts";
import { causticsScene } from "../src/render/scenes/caustics.ts";
import { BEAT_PULSE_DECAY_PER_SEC } from "../src/render/animClock.ts";

const BASE: SparkleShapeParams = {
  shape: SHAPE_PLUCK,
  length: 0.6,
  vibration: 0.5,
  speedHz: 39,
  vibDecay: 0.5,
  bounces: 4,
  attack: 0,
  decay: 0.5,
  rise: 0.75,
  release: 0.5,
};
const ALL_SHAPES = [SHAPE_PLUCK, SHAPE_BELL, SHAPE_SWELL, SHAPE_BOUNCE];

/** When in [0, length] a shape is strongest. */
function peakAt(p: SparkleShapeParams): number {
  let best = -Infinity;
  let bestT = 0;
  for (let t = 0; t <= p.length; t += 0.001) {
    const v = sparkleEnvelope(t, p);
    if (v > best) {
      best = v;
      bestT = t;
    }
  }
  return bestT;
}

describe("the curve dials", () => {
  it("at their middles (Attack 0) draw each shape as first built", () => {
    // The first-built formulas, written out: an exponential fade at each
    // shape's own time constant, and Swell's rise then cut.
    const L = BASE.length;
    const atk = (t: number): number => 1 - Math.exp(-t / 0.008);
    expect(sparkleEnvelope(0.1, BASE)).toBeCloseTo(atk(0.1) * Math.exp(-0.1 / (PLUCK_TAU * L)), 10);
    const swell = { ...BASE, shape: SHAPE_SWELL };
    expect(sparkleEnvelope(0.75 * L + 0.01, swell)).toBeCloseTo(Math.exp(-0.01 / (0.04 * L)), 10);
  });

  it("Attack swells up first, so the peak comes later", () => {
    for (const shape of [SHAPE_PLUCK, SHAPE_BELL, SHAPE_BOUNCE]) {
      expect(peakAt({ ...BASE, shape, attack: 0 })).toBeLessThan(0.05);
      expect(peakAt({ ...BASE, shape, attack: 1 })).toBeGreaterThan(0.3 * BASE.length);
    }
  });

  it("Hit decay stretches the fade", () => {
    const at = (decay: number): number => sparkleEnvelope(0.2, { ...BASE, decay });
    expect(at(1)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(0));
  });

  it("Rise moves Swell's peak, and Release softens its cut", () => {
    const swell = { ...BASE, shape: SHAPE_SWELL, length: 1 };
    expect(peakAt({ ...swell, rise: 0.3 })).toBeCloseTo(0.3, 2);
    expect(peakAt({ ...swell, rise: 0.8 })).toBeCloseTo(0.8, 2);
    const after = (release: number): number => sparkleEnvelope(0.8, { ...swell, rise: 0.7, release });
    expect(after(1)).toBeGreaterThan(5 * after(0));
  });
});

describe("sparkleEnvelope", () => {
  it("is 0 before the hit and after its length, for every shape", () => {
    for (const shape of ALL_SHAPES) {
      const p = { ...BASE, shape };
      expect(sparkleEnvelope(-0.01, p)).toBe(0);
      expect(sparkleEnvelope(p.length + 0.01, p)).toBe(0);
      expect(Math.abs(sparkleEnvelope(p.length, p))).toBeLessThan(1e-9);
    }
  });

  it("Pluck at the default length fades like the treble pulse the glints used to ride", () => {
    expect(PLUCK_TAU * BASE.length).toBeCloseTo(1 / BEAT_PULSE_DECAY_PER_SEC, 2);
    const at = (t: number): number => sparkleEnvelope(t, BASE);
    expect(at(0.1)).toBeCloseTo(Math.exp(-0.1 * BEAT_PULSE_DECAY_PER_SEC), 1);
  });

  it("only Bell swings below zero, and only while it vibrates", () => {
    const samples = (p: SparkleShapeParams): number[] => Array.from({ length: 600 }, (_, i) => sparkleEnvelope((p.length * i) / 600, p));
    for (const shape of [SHAPE_PLUCK, SHAPE_SWELL, SHAPE_BOUNCE]) expect(Math.min(...samples({ ...BASE, shape }))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...samples({ ...BASE, shape: SHAPE_BELL }))).toBeLessThan(-0.05);
    expect(Math.min(...samples({ ...BASE, shape: SHAPE_BELL, vibration: 0 }))).toBeGreaterThanOrEqual(0);
  });

  it("Bell trembles at its speed: sign changes per second track speedHz", () => {
    const crossings = (speedHz: number): number => {
      const p = { ...BASE, shape: SHAPE_BELL, length: 2, vibDecay: 1, speedHz };
      let n = 0;
      let prev = sparkleEnvelope(0.5, p);
      for (let t = 0.5; t < 1.5; t += 0.0005) {
        const v = sparkleEnvelope(t, p);
        if (Math.sign(v) !== Math.sign(prev)) n++;
        prev = v;
      }
      return n;
    };
    // Twice per cycle once the hit itself has faded.
    expect(crossings(20)).toBeGreaterThanOrEqual(36);
    expect(crossings(40)).toBeGreaterThanOrEqual(2 * crossings(20) - 4);
  });

  it("Bell's vibration decay sets how long the trembling lasts", () => {
    const tailSwing = (vibDecay: number): number => {
      const p = { ...BASE, shape: SHAPE_BELL, length: 1, vibDecay };
      let m = 0;
      for (let t = 0.5; t < 0.8; t += 0.001) m = Math.max(m, Math.abs(sparkleEnvelope(t, p)));
      return m;
    };
    expect(tailSwing(1)).toBeGreaterThan(5 * tailSwing(0.1));
  });

  it("Swell peaks late, the others at the hit", () => {
    const at = (shape: number): number => peakAt({ ...BASE, shape, length: 1 });
    expect(at(SHAPE_SWELL)).toBeGreaterThan(0.6);
    expect(at(SHAPE_PLUCK)).toBeLessThan(0.1);
    expect(at(SHAPE_BELL)).toBeLessThan(0.1);
  });
});

describe("sparkleSoftCap", () => {
  it("passes -1..1 through and bends larger sums toward 1.5, keeping the sign", () => {
    expect(sparkleSoftCap(0.7)).toBe(0.7);
    expect(sparkleSoftCap(-0.4)).toBe(-0.4);
    expect(sparkleSoftCap(10)).toBeLessThan(1.5);
    expect(sparkleSoftCap(10)).toBeGreaterThan(1.4);
    expect(sparkleSoftCap(-10)).toBeCloseTo(-sparkleSoftCap(10), 10);
  });
});

describe("advanceSparkleHits", () => {
  it("starts a hit at its size, ages it, and clears it after the length", () => {
    const st = createSparkleHits();
    expect(advanceSparkleHits(st, 1 / 60, false, 1, BASE)).toBe(0);
    advanceSparkleHits(st, 1 / 60, true, 0.5, BASE);
    expect(st.age.filter((a) => a >= 0).length).toBe(1);
    const e1 = advanceSparkleHits(st, 0.05, false, 1, BASE);
    expect(e1).toBeCloseTo(0.5 * sparkleEnvelope(0.05, BASE), 6);
    for (let i = 0; i < 60; i++) advanceSparkleHits(st, 1 / 60, false, 1, BASE);
    expect(st.age.every((a) => a < 0)).toBe(true);
  });

  it("sums hits in flight and gives each hit its own seed", () => {
    const st = createSparkleHits();
    advanceSparkleHits(st, 0.01, true, 1, BASE);
    advanceSparkleHits(st, 0.01, true, 1, BASE);
    const both = advanceSparkleHits(st, 0.01, false, 1, BASE);
    expect(both).toBeCloseTo(sparkleSoftCap(sparkleEnvelope(0.02, BASE) + sparkleEnvelope(0.01, BASE)), 5);
    expect(new Set(Array.from(st.seed.slice(0, 2))).size).toBe(2);
  });

  it("overwrites the oldest slot once every slot is playing", () => {
    const st = createSparkleHits();
    const long = { ...BASE, length: 10 };
    for (let i = 0; i < SPARKLE_HITS + 3; i++) advanceSparkleHits(st, 0.01, true, 1, long);
    expect(st.age.every((a) => a >= 0)).toBe(true);
    expect(Math.max(...st.age)).toBeLessThan(SPARKLE_HITS * 0.01);
  });
});

describe("the Sparkle panel's tables", () => {
  const keys = new Set((causticsScene.settings ?? []).map((s) => s.key));

  it("has a hint and a row list per option", () => {
    expect(SPARKLE_EFFECT_HINTS.length).toBe(SPARKLE_EFFECTS.length);
    expect(SPARKLE_EFFECT_ROWS.length).toBe(SPARKLE_EFFECTS.length);
    expect(SPARKLE_SHAPE_HINTS.length).toBe(SPARKLE_SHAPES.length);
    expect(SPARKLE_SHAPE_ROWS.length).toBe(SPARKLE_SHAPES.length);
  });

  it("names only real caustics settings", () => {
    for (const key of SPARKLE_PANEL_KEYS) expect(keys.has(key), key).toBe(true);
  });

  it("the scene's enum settings offer exactly these options", () => {
    const find = (key: string) => (causticsScene.settings ?? []).find((s) => s.key === key);
    expect(find("sparkleEffect")?.options).toEqual(SPARKLE_EFFECTS);
    expect(find("sparkleShape")?.options).toEqual(SPARKLE_SHAPES);
    expect(causticsScene.panel?.[0]?.settings).toEqual(SPARKLE_PANEL_KEYS);
  });
});
