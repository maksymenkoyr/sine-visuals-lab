// Nebula's camera (src/render/scenes/nebula/flight.ts's header): the gas
// planes come far to near, everything the shader gets stays bounded however
// long the flight, and a plane takes a new seed only when it is reborn.

import { describe, it, expect } from "vitest";
import { advanceFlight, createFlight, layerUniforms, LAYERS } from "../src/render/scenes/nebula/flight.ts";
import { NOISE_PERIOD } from "../src/render/noiseHash.ts";

function planes(travel: number) {
  const f = createFlight();
  f.travel = travel;
  const u = layerUniforms(f);
  return Array.from({ length: LAYERS }, (_, k) => ({ z: u[k * 4], sx: u[k * 4 + 1], sy: u[k * 4 + 2], a: u[k * 4 + 3] }));
}

describe("Nebula flight", () => {
  it("hands the planes over far to near, spaced evenly in depth", () => {
    const ps = planes(2.3);
    for (let k = 1; k < LAYERS; k++) {
      expect(ps[k].z).toBeGreaterThan(ps[k - 1].z);
      expect(ps[k].z - ps[k - 1].z).toBeCloseTo(1 / LAYERS, 5);
    }
  });

  it("keeps depths, seeds and turns bounded after a very long flight", () => {
    for (const travel of [0, 0.5, 1e3 + 0.25, 1e7 + 0.75]) {
      for (const p of planes(travel)) {
        expect(p.z).toBeGreaterThanOrEqual(0);
        expect(p.z).toBeLessThan(1);
        for (const s of [p.sx, p.sy]) {
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThan(NOISE_PERIOD);
        }
        expect(p.a).toBeGreaterThanOrEqual(0);
        expect(p.a).toBeLessThan(Math.PI * 2);
      }
    }
  });

  it("keeps a plane's seed while it flies, and gives it a new one when it is reborn", () => {
    const seeds = (travel: number) => new Set(planes(travel).map((p) => `${p.sx},${p.sy}`));
    const a = seeds(3.1);
    const b = seeds(3.4);
    expect([...a].filter((s) => b.has(s)).length).toBe(LAYERS);
    // Planes are reborn at whole-number travel, one at a time: crossing 4 carries exactly one past the camera.
    const c = seeds(4.2);
    expect([...b].filter((s) => c.has(s)).length).toBe(LAYERS - 1);
  });

  it("wraps the turn and the churn clock into one revolution", () => {
    const f = createFlight();
    for (let i = 0; i < 1000; i++) advanceFlight(f, 0.25, 1, 3, 5);
    expect(Math.abs(f.turn)).toBeLessThan(Math.PI * 2);
    expect(f.churn).toBeGreaterThanOrEqual(0);
    expect(f.churn).toBeLessThan(Math.PI * 2);
    expect(f.travel).toBeCloseTo(250, 6);
  });
});
