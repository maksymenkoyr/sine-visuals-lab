import { describe, expect, it } from "vitest";
import {
  advanceStretch,
  blendParams,
  createParamDrift,
  FBM_LACUNARITY,
  FBM_OCTAVES,
  FBM_ROT_COS,
  FBM_ROT_SIN,
  NODE_FALLBACK_SEC,
  NODES_PER_PHRASE,
  NOISE_FLOW_LEN,
  NOISE_FLOW_RATES,
  noiseFlows,
  PARAM,
  PARAM_COUNT,
  rollLift,
  rollParams,
  SIN_FLOW_RATES,
  sinPhases,
  STRETCH_DECAY_PER_SEC,
  VORTEX_COUNT,
} from "../src/render/scenes/ink.ts";
import { NOISE_PERIOD, wrapFlow } from "../src/render/noiseHash.ts";

/** Deterministic LCG so a roll is reproducible across runs. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function liftOf(v: Float32Array): number[] {
  return [v[PARAM.lift], v[PARAM.lift + 1], v[PARAM.lift + 2]];
}

describe("ink parameter rolls", () => {
  it("fills every slot within its documented range", () => {
    const out = rollParams(seeded(7), 1, new Float32Array(PARAM_COUNT));
    for (let i = 0; i < VORTEX_COUNT; i++) {
      const o = i * 4;
      expect(out[o]).toBeGreaterThan(0.1);
      expect(out[o]).toBeLessThan(0.9);
      expect(Math.abs(out[o + 1])).toBeLessThanOrEqual(0.08);
      expect(Math.abs(out[o + 2])).toBeGreaterThanOrEqual(1.5);
      expect(out[o + 3]).toBeGreaterThanOrEqual(0.07);
    }
    expect(out[PARAM.warpAmpA]).toBeGreaterThan(0);
    expect(out[PARAM.coreScale]).toBeGreaterThan(0.8);
    expect(out[PARAM.armScale]).toBeGreaterThan(0.75);
  });

  it("morph 0 pins every roll to the same centre picture", () => {
    const a = rollParams(seeded(1), 0, new Float32Array(PARAM_COUNT));
    const b = rollParams(seeded(99), 0, new Float32Array(PARAM_COUNT));
    // Positions, radii and warps collapse to their centres; only the
    // strength sign and the colour phases stay random.
    for (let i = 0; i < VORTEX_COUNT; i++) {
      expect(a[i * 4]).toBeCloseTo(b[i * 4]);
      expect(a[i * 4 + 1]).toBeCloseTo(b[i * 4 + 1]);
      expect(Math.abs(a[i * 4 + 2])).toBeCloseTo(Math.abs(b[i * 4 + 2]));
    }
    expect(a[PARAM.coreScale]).toBeCloseTo(1);
    expect(b[PARAM.armScale]).toBeCloseTo(1);
  });

  it("a lift raises exactly one channel and keeps the mean at zero", () => {
    const out = rollLift(seeded(3), new Float32Array(PARAM_COUNT));
    const lift = liftOf(out);
    expect(lift.filter((x) => x === 1)).toHaveLength(1);
    expect(lift.reduce((a, b) => a + b, 0)).toBeCloseTo(0);
  });

  it("blend is prev at t=0, next at t=1, monotonic between", () => {
    const prev = rollParams(seeded(1), 1, new Float32Array(PARAM_COUNT));
    const next = rollParams(seeded(2), 1, new Float32Array(PARAM_COUNT));
    const out = new Float32Array(PARAM_COUNT);
    expect(Array.from(blendParams(prev, next, 0, out))).toEqual(Array.from(prev));
    expect(Array.from(blendParams(prev, next, 1, out))).toEqual(Array.from(next));
    let last = prev[0];
    for (let t = 0.1; t <= 1; t += 0.1) {
      const v = blendParams(prev, next, t, out)[0];
      if (next[0] > prev[0]) expect(v).toBeGreaterThanOrEqual(last);
      else expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
  });
});

describe("ink parameter drift", () => {
  it("re-targets once per bar wrap while locked, and eases on barPhase", () => {
    const drift = createParamDrift(seeded(11));
    const dt = 1 / 60;
    let phase = 0;
    let first: Float32Array | null = null;
    for (let i = 0; i < 60 * 8; i++) {
      phase = (phase + dt / 2) % 1; // a 2 s bar
      const v = drift.advance(dt, phase, 1, 1);
      if (!first) first = Float32Array.from(v);
    }
    // 8 s at a 2 s bar → 4 wraps seen after the first tick (the first
    // tick is the lock-in, so wraps count from the second bar onward).
    expect(drift.nodes).toBe(3);
    expect(Array.from(drift.advance(dt, phase, 1, 1))).not.toEqual(Array.from(first!));
  });

  it("falls back to the reference's timer cadence with no tempo lock", () => {
    const drift = createParamDrift(seeded(5));
    const dt = 1 / 60;
    const ticks = Math.round((NODE_FALLBACK_SEC * 3.5) / dt);
    for (let i = 0; i < ticks; i++) drift.advance(dt, 0, 0, 1);
    expect(drift.nodes).toBe(3);
  });

  it("never jumps: consecutive frames differ by a small step", () => {
    const drift = createParamDrift(seeded(21));
    const dt = 1 / 60;
    let prev = Float32Array.from(drift.advance(dt, 0, 0, 1));
    let maxStep = 0;
    for (let i = 0; i < 60 * 10; i++) {
      const v = drift.advance(dt, 0, 0, 1);
      for (let k = 0; k < VORTEX_COUNT * 4; k += 4) maxStep = Math.max(maxStep, Math.abs(v[k] - prev[k]));
      prev = Float32Array.from(v);
    }
    // A vortex slides at most its whole range (0.7) over a 1.4 s ease;
    // smoothstep peaks at 1.5× the mean rate → under 0.02 per frame.
    expect(maxStep).toBeLessThan(0.02);
  });

  it("re-rolls the lifted channel every NODES_PER_PHRASE nodes and on a drop", () => {
    // Seeds are chosen so the phrase re-roll lands on a different channel;
    // with three channels a re-roll can repeat, which is why the check is
    // "the lift changed at least once across two phrases", not per phrase.
    const drift = createParamDrift(seeded(2));
    const dt = 1 / 60;
    const lifts = new Set<string>();
    const ticksPerNode = Math.round(NODE_FALLBACK_SEC / dt) + 1;
    for (let n = 0; n < NODES_PER_PHRASE * 3; n++) {
      for (let i = 0; i < ticksPerNode; i++) drift.advance(dt, 0, 0, 1);
      lifts.add(liftOf(drift.advance(dt, 0, 0, 1)).join(","));
    }
    expect(lifts.size).toBeGreaterThan(1);

    const before = liftOf(drift.advance(dt, 0, 0, 1));
    // Keep dropping until a re-roll lands on another channel (at most a
    // handful of tries with three channels).
    let changed = false;
    for (let i = 0; i < 12 && !changed; i++) {
      const after = liftOf(drift.advance(dt, 0, 0, 1, true));
      changed = after.join(",") !== before.join(",");
      for (let k = 0; k < 200; k++) drift.advance(dt, 0, 0, 1);
    }
    expect(changed).toBe(true);
  });
});

describe("ink stretch envelope", () => {
  it("snaps to 1 on an onset and relaxes under 5 % within a second", () => {
    let env = advanceStretch(0, 1 / 60, true);
    expect(env).toBe(1);
    for (let i = 0; i < 60; i++) env = advanceStretch(env, 1 / 60, false);
    expect(env).toBeLessThan(0.05);
    expect(Math.exp(-STRETCH_DECAY_PER_SEC)).toBeLessThan(0.05);
  });
});

describe("noiseFlows keeps every shader-side offset bounded (mobile precision seams)", () => {
  // Regression guard for the tiled rendering on phones: the raw flow phase
  // used to reach the shader and be added to every fbm coordinate, so the
  // noise hash's inputs grew without bound and the field broke along
  // cell boundaries on mobile GPU compilers. Now each octave's offset is
  // reduced into [0, NOISE_PERIOD) in float64 before upload, and the
  // shader's integer hash is periodic in exactly that period.
  const HUGE_PHASE = 1e9;

  it("stays in [0, NOISE_PERIOD) for every entry, at any phase", () => {
    for (const ph of [0, 1, 123.456, -50, 1e4, HUGE_PHASE, -HUGE_PHASE]) {
      const flows = noiseFlows(ph);
      expect(flows.length).toBe(NOISE_FLOW_LEN);
      for (const v of flows) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(NOISE_PERIOD);
      }
    }
  });

  it("is congruent to the unwrapped offset, carried through the octave transform", () => {
    // Octave 0 of each call site is ph * rate; octave 1 is that offset
    // rotated by the fbm matrix and scaled by the lacunarity — the same
    // transform the shader applies to p between octaves. Check both against
    // an independent modulo at a phase where fp32 would have long since
    // lost sub-cell resolution.
    // Distance on the period's circle, so an offset sitting right on a wrap
    // (0 vs a hair under the period) still counts as equal.
    const circDist = (a: number, b: number) => {
      const d = wrapFlow(a - b);
      return Math.min(d, NOISE_PERIOD - d);
    };
    const ph = HUGE_PHASE + 0.123;
    const flows = noiseFlows(ph);
    NOISE_FLOW_RATES.forEach(([rx, ry], site) => {
      const ox = ph * rx;
      const oy = ph * ry;
      const base = site * FBM_OCTAVES * 2;
      expect(circDist(flows[base], ox)).toBeLessThan(1e-2);
      expect(circDist(flows[base + 1], oy)).toBeLessThan(1e-2);
      const ox1 = (FBM_ROT_COS * ox - FBM_ROT_SIN * oy) * FBM_LACUNARITY;
      const oy1 = (FBM_ROT_SIN * ox + FBM_ROT_COS * oy) * FBM_LACUNARITY;
      expect(circDist(flows[base + 2], ox1)).toBeLessThan(1e-2);
      expect(circDist(flows[base + 3], oy1)).toBeLessThan(1e-2);
    });
  });

  it("advances continuously across a wrap, so the field never jumps", () => {
    // Step the phase by a small delta straddling a wrap of the first call
    // site's octave-0 x entry: the wrapped value must move by exactly
    // delta * rate modulo the period.
    const rate = NOISE_FLOW_RATES[0][0];
    const period = NOISE_PERIOD / rate;
    const delta = 0.01;
    const before = noiseFlows(period * 3 - delta / 2)[0];
    const after = noiseFlows(period * 3 + delta / 2)[0];
    expect(wrapFlow(after - before)).toBeCloseTo(delta * rate, 4);
  });

  it("reuses the caller's buffer, so the per-frame upload allocates nothing", () => {
    const buf = noiseFlows(1);
    expect(noiseFlows(2, buf)).toBe(buf);
  });
});

describe("sinPhases keeps every sine argument within one turn", () => {
  it("stays in [0, 2π) and is congruent to ph * rate", () => {
    const TWO_PI = Math.PI * 2;
    for (const ph of [0, 1, -7.5, 1e4, 1e9]) {
      const phases = sinPhases(ph);
      expect(phases.length).toBe(SIN_FLOW_RATES.length);
      SIN_FLOW_RATES.forEach((rate, i) => {
        expect(phases[i]).toBeGreaterThanOrEqual(0);
        expect(phases[i]).toBeLessThan(TWO_PI);
        // sin of the wrapped and unwrapped arguments agree (float64 side).
        expect(Math.sin(phases[i])).toBeCloseTo(Math.sin(ph * rate), 4);
      });
    }
  });

  it("reuses the caller's buffer", () => {
    const buf = sinPhases(1);
    expect(sinPhases(2, buf)).toBe(buf);
  });
});
