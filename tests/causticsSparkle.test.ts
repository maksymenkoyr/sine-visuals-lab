import { describe, it, expect } from "vitest";
import {
  ADAPT_MAX_LENGTH,
  ADAPT_RING_CHECK_SEC,
  adaptiveLength,
  advanceSparkleHits,
  createSparkleHits,
  EFFECT_DROPLETS,
  EFFECT_GRAIN,
  PLUCK_TAU,
  SHAPE_BELL,
  SHAPE_BOUNCE,
  SHAPE_PLUCK,
  SHAPE_SWELL,
  SPARKLE_EFFECTS,
  SPARKLE_HITS,
  SPARKLE_MODES,
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

  it("sums hits in flight, each at the length it landed with", () => {
    const st = createSparkleHits();
    advanceSparkleHits(st, 0.01, true, 1, BASE);
    advanceSparkleHits(st, 0.01, true, 1, { ...BASE, length: 0.3 });
    const both = advanceSparkleHits(st, 0.01, false, 1, BASE);
    expect(both).toBeCloseTo(sparkleSoftCap(sparkleEnvelope(0.02, BASE) + sparkleEnvelope(0.01, BASE, 0.3)), 5);
    expect(Array.from(st.length.slice(0, 2))).toEqual([Math.fround(0.6), Math.fround(0.3)]);
  });

  it("overwrites the oldest slot once every slot is playing", () => {
    const st = createSparkleHits();
    const long = { ...BASE, length: 10 };
    for (let i = 0; i < SPARKLE_HITS + 3; i++) advanceSparkleHits(st, 0.01, true, 1, long);
    expect(st.age.every((a) => a >= 0)).toBe(true);
    expect(Math.max(...st.age)).toBeLessThan(SPARKLE_HITS * 0.01);
  });
});

describe("the scene's Sparkle settings", () => {
  const find = (key: string) => (causticsScene.settings ?? []).find((s) => s.key === key);

  it("offer exactly these options", () => {
    expect(find("sparkleFx")?.options).toEqual(SPARKLE_EFFECTS);
    expect(find("sparkleShape")?.options).toEqual(SPARKLE_SHAPES);
    expect(find("sparkleAdapt")?.options).toEqual(SPARKLE_MODES);
  });

  it("append Droplets after the effects saved Looks already name, and keep Grain the default", () => {
    expect(SPARKLE_EFFECTS.slice(0, 3)).toEqual(["Grain", "Prism", "Run"]);
    expect(SPARKLE_EFFECTS[EFFECT_DROPLETS]).toBe("Droplets");
    expect(find("sparkleFx")?.default).toBe(EFFECT_GRAIN);
  });

  it("start on Basic Pluck, with Flare and Tighten off, so the default look stays", () => {
    expect(find("sparkleAdapt")?.default).toBe(0);
    expect(find("sparkleShape")?.default).toBe(SHAPE_PLUCK);
    expect(find("flare")?.default).toBe(0);
    expect(find("tighten")?.default).toBe(0);
  });

  it("keep the old fine dials, and Droplets' own, on the dev server only", () => {
    for (const key of ["sparkleShape", "sparkleLength", "sparkleBright", "sparkleDensity", "sparkleSpread", "sparkleSustain", "sparkleWarp"]) {
      expect(find(key)?.dev, key).toBe(true);
    }
    for (const key of ["dropAmount", "dropThrow", "dropFan", "dropWeight", "dropLife", "dropGlow"]) expect(find(key)?.dev, key).toBe(true);
    for (const key of ["sparkle", "sparkleFx", "sparkleGrain", "dropSize", "sparkleAdapt", "flare", "tighten"]) expect(find(key)?.dev, key).toBeUndefined();
  });
});

// Made-up treble: hits every `gap` seconds, standing out by `standouts` in
// turn, each with a treble level that falls with time constant `levelTau`
// after it (short for a closed hat, long for held treble). Every hit is size
// 1, as the scene's flat treble pulse plays it. Returns the sparkle reading
// every frame.
function play(adaptive: boolean, gap: number, standouts: number[], levelTau: number, seconds = 6): { t: number; v: number }[] {
  const st = createSparkleHits();
  const dt = 1 / 120;
  const out: { t: number; v: number }[] = [];
  let lastHit = -Infinity;
  let k = 0;
  for (let t = 0; t < seconds; t += dt) {
    const fired = t >= k * gap;
    const standout = fired ? standouts[k % standouts.length] : -1;
    if (fired) {
      lastHit = t;
      k++;
    }
    const level = 0.8 * Math.exp(-(t - lastHit) / levelTau);
    out.push({ t, v: advanceSparkleHits(st, dt, fired, 1, BASE, adaptive, level, standout) });
  }
  return out;
}

/** How far the glints dim between hits over the last two seconds: 1 is a
 *  full flash and back to dark. */
function dims(samples: { t: number; v: number }[]): number {
  const end = samples[samples.length - 1].t;
  const v = samples
    .filter((s) => s.t > end - 2)
    .map((s) => Math.max(0, s.v))
    .sort((a, b) => a - b);
  const p10 = v[Math.floor(v.length * 0.1)];
  const p90 = v[Math.floor(v.length * 0.9)];
  return (p90 - p10) / p90;
}

// The owner asked for Adaptive to change the picture visibly, not to be a
// fine adjustment (2026-10-26): each case pins a clear gap against Basic.
describe("Adaptive against Basic", () => {
  const SIXTEENTH = 60 / 124 / 4;
  const OFFBEAT = 60 / 124;

  it("busy hats strobe as separate flashes instead of a steady glow", () => {
    const basic = dims(play(false, SIXTEENTH, [0.45], 0.04));
    const adaptive = dims(play(true, SIXTEENTH, [0.45], 0.04));
    expect(basic).toBeLessThan(0.45);
    expect(adaptive - basic).toBeGreaterThan(0.3);
  });

  it("sparse hats glow on through the gap", () => {
    const area = (adaptive: boolean): number => play(adaptive, OFFBEAT, [0.45], 0.05).reduce((s, x) => s + Math.max(0, x.v), 0);
    expect(area(true)).toBeGreaterThan(1.5 * area(false));
    expect(adaptiveLength(OFFBEAT, 0)).toBeLessThanOrEqual(ADAPT_MAX_LENGTH);
  });

  it("accents flare and ghost notes fade, where Basic plays every hit the same", () => {
    // Each hit's jump: the reading 20 ms after it, less the reading just
    // before it — the flash the eye sees, whatever tail it lands on.
    const jumps = (adaptive: boolean): [number, number] => {
      const s = play(adaptive, OFFBEAT, [0.8, 0.3], 0.05);
      const at = (t: number): number => s.reduce((best, x) => (Math.abs(x.t - t) < Math.abs(best.t - t) ? x : best)).v;
      const jump = (k: number): number => at(k * OFFBEAT + 0.02) - at(k * OFFBEAT - 0.005);
      return [jump(10), jump(11)];
    };
    const [basicLoud, basicSoft] = jumps(false);
    const [loud, soft] = jumps(true);
    expect(basicLoud / basicSoft).toBeLessThan(1.3);
    expect(loud / soft).toBeGreaterThan(3);
  });

  it("a wire's edge, with no stand-out, plays at full size", () => {
    const st = createSparkleHits();
    advanceSparkleHits(st, 1 / 120, true, 1, BASE, true, 0, -1);
    expect(st.size[0]).toBe(1);
  });

  it("held treble trembles, a closed hat doesn't, and Basic Pluck never does", () => {
    // Flickers between one hit and the next: reversals of at least 0.1.
    const flickers = (s: { t: number; v: number }[]): number => {
      const gap = s.filter((x) => x.t > 10 * OFFBEAT + 0.15 && x.t < 11 * OFFBEAT - 0.01).map((x) => x.v);
      let n = 0;
      let extreme = gap[0];
      let rising = gap[1] > gap[0];
      for (const v of gap) {
        if (rising ? v > extreme : v < extreme) extreme = v;
        else if (Math.abs(v - extreme) >= 0.1) {
          n++;
          rising = !rising;
          extreme = v;
        }
      }
      return n;
    };
    expect(flickers(play(true, OFFBEAT, [0.8], 1.5))).toBeGreaterThan(10);
    expect(flickers(play(true, OFFBEAT, [0.8], 0.04))).toBe(0);
    expect(flickers(play(false, OFFBEAT, [0.8], 1.5))).toBe(0);
  });

  it("the next hit cuts a tremble short", () => {
    const st = createSparkleHits();
    const dt = 1 / 120;
    advanceSparkleHits(st, dt, true, 1, BASE, true, 1);
    for (let t = 0; t < ADAPT_RING_CHECK_SEC + 0.05; t += dt) advanceSparkleHits(st, dt, false, 1, BASE, true, 1);
    expect(st.ring).toBe(1);
    advanceSparkleHits(st, dt, true, 1, BASE, true, 1);
    expect(st.ring).toBe(-1);
  });
});
