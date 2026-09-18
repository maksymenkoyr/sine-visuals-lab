import { describe, expect, it } from "vitest";
import {
  advanceStretch,
  blendParams,
  createParamDrift,
  NODE_FALLBACK_SEC,
  NODES_PER_PHRASE,
  PARAM,
  PARAM_COUNT,
  rollLift,
  rollParams,
  STRETCH_DECAY_PER_SEC,
  VORTEX_COUNT,
} from "../src/render/scenes/ink.ts";

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
