import { describe, it, expect } from "vitest";
import {
  createSwarm,
  stepSwarm,
  scatterPhases,
  rescatter,
  collapseTrap,
  collectEdges,
  swarmMetrics,
  createRng,
  EDGE_STRIDE,
  DEFAULT_SWARM_PARAMS,
} from "../src/render/scenes/swarm/swarmSim.ts";

const DT = 1 / 60;
const N = 128;

function run(seed: number, seconds: number, breathWave = 0.5) {
  const s = createSwarm(N, seed);
  for (let i = 0; i < Math.round(seconds / DT); i++) stepSwarm(s, DEFAULT_SWARM_PARAMS, DT, breathWave, 1);
  return s;
}

describe("swarm sim", () => {
  it("is deterministic for one seed", () => {
    const a = run(7, 200 * DT);
    const b = run(7, 200 * DT);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.theta)).toEqual(Array.from(b.theta));
    const c = run(8, 200 * DT);
    expect(Array.from(c.x)).not.toEqual(Array.from(a.x));
  });

  it("keeps total momentum with the trap off (equal and opposite pair forces)", () => {
    const s = createSwarm(N, 3);
    const p = { ...DEFAULT_SWARM_PARAMS, trap: 0, drag: 0 };
    for (let i = 0; i < 300; i++) stepSwarm(s, p, DT, 0.5, 1);
    let px = 0;
    let py = 0;
    let speed = 0;
    for (let i = 0; i < N; i++) {
      px += s.vx[i];
      py += s.vy[i];
      speed += Math.hypot(s.vx[i], s.vy[i]);
    }
    expect(speed).toBeGreaterThan(1); // it did move
    expect(Math.hypot(px, py)).toBeLessThan(1e-6 * speed + 1e-6);
  });

  it("settles into a locked core inside a rim, and the core contracts on the beat", () => {
    const s = run(1, 25, 0.5);
    const m = swarmMetrics(s);
    expect(m.lockedShare).toBeGreaterThan(0.55);
    expect(m.lockedShare).toBeLessThan(0.95);
    expect(m.r90).toBeGreaterThan(120);
    expect(m.r90).toBeLessThan(190);
    // Hold the beat wave high for two seconds: the attraction rises and the
    // locked core pulls in while the rim (set by repulsion) stays put.
    for (let i = 0; i < 120; i++) stepSwarm(s, DEFAULT_SWARM_PARAMS, DT, 1, 1);
    const hi = swarmMetrics(s);
    expect(hi.coreR90).toBeLessThan(hi.r90 - 30);
  });

  it("a hit scatters the phases (order drops at once)", () => {
    const s = run(2, 25, 0.5);
    const before = swarmMetrics(s).order;
    scatterPhases(s, 1, createRng(5));
    expect(before - swarmMetrics(s).order).toBeGreaterThan(0.3);
  });

  it("rescatter returns to the box at rest with the locks cleared", () => {
    const s = run(4, 5);
    rescatter(s, createRng(9), 400);
    for (let i = 0; i < N; i++) {
      expect(s.vx[i]).toBe(0);
      expect(s.lock[i]).toBe(0);
      expect(Math.abs(s.x[i])).toBeLessThanOrEqual(400);
      expect(Math.abs(s.y[i])).toBeLessThanOrEqual(280);
    }
  });

  it("the collapse ramp eases from the floor to 1", () => {
    expect(collapseTrap(0, 10)).toBeCloseTo(0.04, 6);
    expect(collapseTrap(10, 10)).toBeCloseTo(1, 6);
    expect(collapseTrap(99, 10)).toBe(1);
    expect(collapseTrap(5, 10)).toBeGreaterThan(0.04);
    expect(collapseTrap(5, 10)).toBeLessThan(1);
  });

  it("collects edges inside reach with colour coordinates in 0..1, capped by the buffer", () => {
    const s = run(6, 5);
    const big = new Float32Array(EDGE_STRIDE * 20000);
    const m = collectEdges(s, 150, big);
    expect(m).toBeGreaterThan(100);
    for (let e = 0; e < m; e++) {
      const b = e * EDGE_STRIDE;
      expect(Math.hypot(big[b + 2] - big[b], big[b + 3] - big[b + 1])).toBeLessThan(150 + 1e-3);
      expect(big[b + 4]).toBeGreaterThanOrEqual(0);
      expect(big[b + 4]).toBeLessThanOrEqual(1);
      expect(big[b + 6]).toBeGreaterThan(0);
      expect(big[b + 6]).toBeLessThanOrEqual(1);
    }
    expect(collectEdges(s, 150, new Float32Array(EDGE_STRIDE * 10))).toBe(10);
  });
});
