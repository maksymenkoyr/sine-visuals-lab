// Nebula's camera and stars (src/render/scenes/nebula/flight.ts and stars.ts headers): everything
// the shader gets stays bounded however long the flight, the view doesn't jump when the camera's
// position wraps into its repeat, and the star field is the same on every mount.

import { describe, it, expect } from "vitest";
import {
  advanceFlight,
  cameraUniforms,
  createFlight,
  hueWander,
  pathUniforms,
  PERIOD,
  PERIOD_Z,
} from "../src/render/scenes/nebula/flight.ts";
import { buildStars, STAR_COUNT, STAR_STRIDE } from "../src/render/scenes/nebula/stars.ts";

function camAt(travel: number, turn = 1) {
  const f = createFlight();
  f.travel = travel;
  const u = cameraUniforms(f, turn);
  const v = (k: number) => [u[k * 4], u[k * 4 + 1], u[k * 4 + 2]];
  return { pos: v(0), right: v(1), up: v(2), fwd: v(3) };
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe("Nebula flight", () => {
  it("repeats the gas along the flight a whole number of times per star repeat", () => {
    expect(Number.isInteger(PERIOD_Z / PERIOD)).toBe(true);
  });

  it("keeps the camera's position inside one repeat after a very long flight", () => {
    for (const travel of [0, 7.5, 1e3 + 0.25, 1e7 + 0.75, 1e9 + 0.5]) {
      const { pos } = camAt(travel);
      expect(pos[0]).toBeGreaterThanOrEqual(0);
      expect(pos[0]).toBeLessThan(PERIOD);
      expect(pos[1]).toBeGreaterThanOrEqual(0);
      expect(pos[1]).toBeLessThan(PERIOD);
      expect(pos[2]).toBeGreaterThanOrEqual(0);
      expect(pos[2]).toBeLessThan(PERIOD_Z);
    }
  });

  it("hands the shader an orthonormal view, rolled or not", () => {
    for (const turn of [0, 1, 3]) {
      for (const travel of [0, 13.7, 4e4]) {
        const { right, up, fwd } = camAt(travel, turn);
        for (const v of [right, up, fwd]) expect(dot(v, v)).toBeCloseTo(1, 5);
        expect(dot(right, up)).toBeCloseTo(0, 5);
        expect(dot(right, fwd)).toBeCloseTo(0, 5);
        expect(dot(up, fwd)).toBeCloseTo(0, 5);
        // The camera flies forward along +z.
        expect(fwd[2]).toBeGreaterThan(0.8);
      }
    }
  });

  it("doesn't jump when its position wraps into the next repeat", () => {
    const before = camAt(PERIOD_Z - 1e-4);
    const after = camAt(PERIOD_Z + 1e-4);
    // z goes from just under the repeat to just over 0: the same point of a periodic field.
    expect(before.pos[2]).toBeGreaterThan(PERIOD_Z - 1e-3);
    expect(after.pos[2]).toBeLessThan(1e-3);
    for (const k of ["right", "up", "fwd"] as const) {
      for (let i = 0; i < 3; i++) expect(after[k][i]).toBeCloseTo(before[k][i], 3);
    }
  });

  it("keeps the path phases within one turn", () => {
    for (const travel of [0, 3.3, 1e6 + 0.1, 1e9]) {
      const f = createFlight();
      f.travel = travel;
      const u = pathUniforms(f);
      for (const v of u) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(Math.PI * 2 + 1e-6);
      }
    }
  });

  it("starts the colours at the scene's own and keeps the wander bounded", () => {
    const f = createFlight();
    expect(hueWander(f)).toBeCloseTo(0, 6);
    for (let i = 0; i < 2000; i++) {
      advanceFlight(f, 0.25, 1, 50, 0.05);
      expect(Math.abs(hueWander(f))).toBeLessThanOrEqual(180);
    }
    expect(f.churn).toBeGreaterThanOrEqual(0);
    expect(f.churn).toBeLessThan(Math.PI * 2);
    expect(f.travel).toBeCloseTo(500, 6);
  });
});

describe("Nebula stars", () => {
  it("scatters the same stars inside one repeat on every build", () => {
    const a = buildStars();
    const b = buildStars();
    expect(a.length).toBe(STAR_COUNT * STAR_STRIDE);
    expect(Array.from(a)).toEqual(Array.from(b));
    // One assert per property: a per-value expect over every star runs past the test timeout.
    let outOfRange = 0;
    for (let i = 0; i < a.length; i += STAR_STRIDE) {
      for (let k = 0; k < 3; k++) if (!(a[i + k] >= 0 && a[i + k] < PERIOD)) outOfRange++;
      for (let k = 3; k < 6; k++) if (!(a[i + k] >= 0 && a[i + k] < 1)) outOfRange++;
    }
    expect(outOfRange).toBe(0);
  });

  it("has no NaN in any star", () => {
    expect(buildStars().some(Number.isNaN)).toBe(false);
  });
});
