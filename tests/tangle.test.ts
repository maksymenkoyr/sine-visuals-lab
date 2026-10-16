import { describe, it, expect } from "vitest";
import {
  SIDE_BY_PRESET,
  pickSlot,
  cameraRotation,
  createGlide,
  startGlide,
  glideStep,
} from "../src/render/scenes/tangle/core.ts";

describe("tangle pickSlot", () => {
  const times = [1.0, 1.016, 1.033, 1.05, -Infinity, -Infinity, -Infinity];

  it("reads the frame just drawn when there is no delay", () => {
    expect(pickSlot(times, 3, 1.05, 0)).toBe(3);
  });

  it("reads the frame closest to the delayed moment", () => {
    expect(pickSlot(times, 3, 1.05, 0.017)).toBe(2);
    expect(pickSlot(times, 3, 1.05, 0.034)).toBe(1);
  });

  it("never reads a slot that was never written", () => {
    expect(pickSlot(times, 3, 1.05, 10)).toBe(0);
  });

  it("falls back to the frame just drawn on a fresh start", () => {
    const fresh = [5, -Infinity, -Infinity];
    expect(pickSlot(fresh, 0, 5, 0.05)).toBe(0);
  });
});

describe("tangle glide", () => {
  // A point that stays put between steps, pulled home by each step's blend.
  function travel(amount: number, steps: number): number[] {
    const g = createGlide();
    startGlide(g, amount, steps);
    let x = 0;
    const path: number[] = [];
    for (let i = 0; i < steps + 2; i++) {
      x += glideStep(g) * (1 - x);
      path.push(x);
    }
    return path;
  }

  it("moves a still point the whole amount in equal shares", () => {
    const path = travel(0.6, 4);
    for (let k = 0; k < 4; k++) expect(path[k]).toBeCloseTo((0.6 * (k + 1)) / 4, 10);
    expect(path[5]).toBeCloseTo(0.6, 10);
  });

  it("lands exactly home on a full pull", () => {
    const path = travel(1, 6);
    expect(path[5]).toBeCloseTo(1, 12);
  });

  it("is spent once its steps are taken", () => {
    const g = createGlide();
    expect(glideStep(g)).toBe(0);
    startGlide(g, 0.3, 2);
    glideStep(g);
    glideStep(g);
    expect(glideStep(g)).toBe(0);
  });

  it("keeps what is left of a stronger pull when a weaker one starts", () => {
    const g = createGlide();
    startGlide(g, 1, 4);
    glideStep(g);
    startGlide(g, 0.2, 4);
    expect(g.amount).toBeCloseTo(0.75, 10);
  });
});

describe("tangle cameraRotation", () => {
  it("is a rotation: orthonormal columns, determinant 1", () => {
    const m = cameraRotation(0.7, 0.35);
    const col = (i: number) => [m[i * 3], m[i * 3 + 1], m[i * 3 + 2]];
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // A Float32Array: good to about 1e-7.
    for (let i = 0; i < 3; i++) {
      expect(dot(col(i), col(i))).toBeCloseTo(1, 6);
      for (let j = i + 1; j < 3; j++) expect(dot(col(i), col(j))).toBeCloseTo(0, 6);
    }
    const [a, b, c] = [col(0), col(1), col(2)];
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
    expect(det).toBeCloseTo(1, 6);
  });

  it("is the identity at rest", () => {
    const m = cameraRotation(0, 0);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(m[i]).toBeCloseTo(v, 10));
  });
});

describe("tangle sides", () => {
  it("are even, so a row past a pole lands exactly half a turn round", () => {
    for (const side of Object.values(SIDE_BY_PRESET)) expect(side % 2).toBe(0);
  });
});
