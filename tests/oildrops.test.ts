// Oil Drops' population (src/render/scenes/oildrops/drops.ts) under node:
// the radius distribution, contact without merging, inner drops staying
// inside their hosts, drops leaving and re-entering, pours, the jolt, and
// the two drive formulas' identity with nothing plugged in.
import { describe, expect, it } from "vitest";
import {
  CONTACT_OVERLAP,
  COUNT_MIN,
  COUNT_SPAN,
  createDropSim,
  createRng,
  DRIFT_SPEED,
  dropCount,
  driftSpeed,
  EDDY_BASE,
  eddyScale,
  eddyVelocity,
  MAX_DROPS,
  packDrops,
  DROP_FLOATS,
  R_MAX,
  R_MIN,
  RADIUS_QUANTILES,
  radiusAtShare,
  sampleRadius,
  stepDrops,
  type StepParams,
  shoveFactor,
  SHOVE_SPEED,
} from "../src/render/scenes/oildrops/drops.ts";
import { boilDepths, glitterAmount, GLITTER_REST, paintDrifts } from "../src/render/scenes/oildrops/index.ts";
import { NOISE_PERIOD } from "../src/render/noiseHash.ts";

const ASPECT = 9 / 16;

function params(over: Partial<StepParams> = {}): StepParams {
  return { aspect: ASPECT, count: 80, size: 1, nested: 0.5, paint: 0, speed: DRIFT_SPEED * 0.3, eddy: EDDY_BASE, shove: 0, pour: 0, ...over };
}

function run(sim: ReturnType<typeof createDropSim>, p: StepParams, frames: number, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) stepDrops(sim, dt, p);
}

/** Overlap of two drops as a share of the smaller radius; negative when apart. */
function overlapShare(a: { x: number; y: number; r: number; grow: number }, b: { x: number; y: number; r: number; grow: number }): number {
  const ra = a.r * a.grow;
  const rb = b.r * b.grow;
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  return (ra + rb - d) / Math.min(ra, rb);
}

describe("oil drops: radii", () => {
  it("reproduce the measured quantiles", () => {
    for (const [share, r] of RADIUS_QUANTILES) expect(radiusAtShare(share)).toBeCloseTo(r, 9);
    const rng = createRng(7);
    const rs: number[] = [];
    for (let i = 0; i < 20000; i++) rs.push(sampleRadius(rng, 1));
    rs.sort((a, b) => a - b);
    for (const r of rs) {
      expect(r).toBeGreaterThanOrEqual(R_MIN);
      expect(r).toBeLessThanOrEqual(R_MAX);
    }
    const median = rs[rs.length >> 1];
    expect(median).toBeGreaterThan(radiusAtShare(0.5) * 0.93);
    expect(median).toBeLessThan(radiusAtShare(0.5) * 1.07);
    const p90 = rs[Math.floor(rs.length * 0.9)];
    expect(p90).toBeGreaterThan(radiusAtShare(0.9) * 0.9);
    expect(p90).toBeLessThan(radiusAtShare(0.9) * 1.1);
  });

  it("scale with Size", () => {
    const a = createRng(3);
    const b = createRng(3);
    expect(sampleRadius(b, 2, 10)).toBeCloseTo(2 * sampleRadius(a, 1, 10), 9);
  });

  it("map the Drops setting to a population", () => {
    expect(dropCount(0)).toBe(COUNT_MIN);
    expect(dropCount(1)).toBe(COUNT_MIN + COUNT_SPAN);
    expect(dropCount(0.5)).toBeGreaterThan(60);
    expect(dropCount(0.5)).toBeLessThan(110);
  });
});

describe("oil drops: the population", () => {
  it("fills the frame to the target and keeps it there", () => {
    const sim = createDropSim(1);
    const p = params({ count: 80 });
    run(sim, p, 1);
    expect(sim.drops.length).toBeGreaterThanOrEqual(80);
    // The fill places every sampled radius; only the inner drops overshoot.
    expect(sim.drops.length).toBeLessThanOrEqual(80 * 1.3);
    run(sim, p, 600);
    expect(sim.drops.length).toBeGreaterThan(60);
    expect(sim.drops.length).toBeLessThanOrEqual(MAX_DROPS);
  });

  it("never lets free drops merge: contact stays at the allowed overlap", () => {
    const sim = createDropSim(2);
    const p = params({ count: 200, speed: DRIFT_SPEED });
    run(sim, p, 900);
    const free = sim.drops.filter((d) => d.host < 0 && d.grow >= 1);
    let worst = -Infinity;
    for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) worst = Math.max(worst, overlapShare(free[i], free[j]));
    expect(worst).toBeLessThan(CONTACT_OVERLAP + 0.3);
  });

  it("keeps every inner drop inside its host", () => {
    const sim = createDropSim(4);
    const p = params({ count: 150, nested: 1, shove: 0 });
    run(sim, p, 400);
    stepDrops(sim, 1 / 60, { ...p, shove: 2 });
    run(sim, p, 100);
    const inner = sim.drops.filter((d) => d.host >= 0);
    expect(inner.length).toBeGreaterThan(0);
    for (const d of inner) {
      const h = sim.drops[d.host];
      expect(h.host).toBe(-1);
      expect(Math.hypot(d.x - h.x, d.y - h.y) + d.r * d.grow).toBeLessThanOrEqual(h.r * h.grow + 1e-9);
    }
  });

  it("drops the drops that leave and lets new ones in from the inflow side", () => {
    const sim = createDropSim(5);
    const p = params({ count: 80, speed: DRIFT_SPEED * 2 });
    run(sim, p, 3000, 1 / 30);
    for (const d of sim.drops) {
      expect(d.x).toBeGreaterThan(-0.3);
      expect(d.x).toBeLessThan(1.3);
      expect(d.y).toBeGreaterThan(-0.3);
      expect(d.y).toBeLessThan(ASPECT + 0.3);
    }
    expect(sim.drops.length).toBeGreaterThan(40);
  });

  it("stands still at zero speed and with no jolt", () => {
    const sim = createDropSim(6);
    const p = params({ count: 60, speed: 0 });
    run(sim, p, 120);
    const before = sim.drops.filter((d) => d.host < 0).map((d) => [d.x, d.y]);
    run(sim, p, 60);
    const after = sim.drops.filter((d) => d.host < 0);
    expect(after.length).toBe(before.length);
    after.forEach((d, i) => {
      expect(Math.hypot(d.x - before[i][0], d.y - before[i][1])).toBeLessThan(1e-3);
    });
  });

  it("jolts small drops further than big ones and relaxes", () => {
    expect(shoveFactor(0.003)).toBeGreaterThan(shoveFactor(0.05));
    const sim = createDropSim(8);
    const p = params({ count: 60, speed: 0 });
    run(sim, p, 60);
    const before = sim.drops.filter((d) => d.host < 0).map((d) => [d.x, d.y]);
    stepDrops(sim, 1 / 60, { ...p, shove: 1 });
    expect(Math.hypot(sim.shoveX, sim.shoveY)).toBeCloseTo(SHOVE_SPEED, 6);
    run(sim, p, 120);
    const moved = sim.drops.filter((d) => d.host < 0).map((d, i) => Math.hypot(d.x - before[i][0], d.y - before[i][1]));
    expect(Math.max(...moved)).toBeGreaterThan(0.005);
    expect(Math.hypot(sim.shoveX, sim.shoveY)).toBeLessThan(SHOVE_SPEED * 0.01);
  });

  it("pours a cluster that grows in and never overfills the buffer", () => {
    const sim = createDropSim(9);
    const p = params({ count: 60, speed: 0 });
    run(sim, p, 30);
    const n0 = sim.drops.length;
    stepDrops(sim, 1 / 60, { ...p, pour: 1 });
    expect(sim.drops.length).toBeGreaterThan(n0 + 4);
    const poured = sim.drops.filter((d) => d.grow < 1);
    expect(poured.length).toBeGreaterThan(4);
    run(sim, p, 120);
    expect(sim.drops.every((d) => d.grow === 1)).toBe(true);
    for (let i = 0; i < 80; i++) stepDrops(sim, 1 / 60, { ...p, pour: 2 });
    expect(sim.drops.length).toBeLessThanOrEqual(MAX_DROPS);
  });

  it("packs biggest first, host before inner drop, within the buffer", () => {
    const sim = createDropSim(10);
    const p = params({ count: 200, nested: 1 });
    run(sim, p, 60);
    const out = new Float32Array(MAX_DROPS * DROP_FLOATS);
    const order: number[] = [];
    const n = packDrops(sim, out, order);
    expect(n).toBe(sim.drops.length);
    for (let i = 1; i < n; i++) expect(out[i * DROP_FLOATS + 2]).toBeLessThanOrEqual(out[(i - 1) * DROP_FLOATS + 2] + 1e-9);
    const pos = new Map(order.map((idx, slot) => [idx, slot]));
    for (let i = 0; i < sim.drops.length; i++) {
      const d = sim.drops[i];
      if (d.host >= 0) expect(pos.get(d.host)!).toBeLessThan(pos.get(i)!);
    }
  });

  it("re-deals families when the Paint option changes", () => {
    const sim = createDropSim(11);
    run(sim, params({ paint: 0 }), 10);
    expect(sim.drops.every((d) => d.family <= 2)).toBe(true);
    run(sim, params({ paint: 1 }), 1);
    expect(sim.drops.every((d) => d.family >= 2)).toBe(true);
  });
});

describe("oil drops: the flow", () => {
  it("eddies run at about the drift speed", () => {
    const out: [number, number] = [0, 0];
    const speeds: number[] = [];
    for (let i = 0; i < 2000; i++) {
      eddyVelocity((i * 0.618) % 1, ((i * 0.377) % 1) * ASPECT, 12.3, out);
      speeds.push(Math.hypot(out[0], out[1]));
    }
    speeds.sort((a, b) => a - b);
    const median = speeds[speeds.length >> 1];
    expect(median).toBeGreaterThan(0.4);
    expect(median).toBeLessThan(2.5);
  });

  it("gives the slider alone the pace with nothing plugged in", () => {
    expect(driftSpeed(0.3, 1, 0)).toBeCloseTo(DRIFT_SPEED * 0.3, 12);
    expect(driftSpeed(0.3, 1, 1)).toBeGreaterThan(driftSpeed(0.3, 1, 0) * 10);
    expect(eddyScale(1, 0)).toBe(EDDY_BASE);
    expect(eddyScale(1, 1)).toBeGreaterThan(EDDY_BASE);
    expect(glitterAmount(1, 0)).toBe(GLITTER_REST);
    expect(glitterAmount(1, 1)).toBeGreaterThan(GLITTER_REST);
  });

  it("wraps the paint's slide and boil inside the lattice period", () => {
    for (const x of [0, 3.7, 86_400 * 3]) {
      for (const v of paintDrifts(x, -x)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(NOISE_PERIOD);
      }
      for (const v of boilDepths(x)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(NOISE_PERIOD);
      }
    }
  });
});
