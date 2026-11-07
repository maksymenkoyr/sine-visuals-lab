// Nebula's temporal resolve on the JS side (src/render/scenes/nebula/history.ts header): the
// sub-pixel offsets cover a pixel evenly and repeat, and the last camera reaches the shader as a
// small offset that puts a gas parcel where that camera saw it, across the flow's and the
// camera's wraps alike.

import { describe, it, expect } from "vitest";
import { advanceFlight, cameraUniforms, cameraWorld, createFlight, PERIOD, PERIOD_Z, type Flight } from "../src/render/scenes/nebula/flight.ts";
import {
  captureCamera,
  createCameraFrame,
  frameNoiseAt,
  JITTER_CYCLE,
  jitterAt,
  MAX_JUMP,
  prevCamUniforms,
  type CameraFrame,
} from "../src/render/scenes/nebula/history.ts";

function frameOf(f: Flight): CameraFrame {
  const out = createCameraFrame();
  captureCamera(cameraWorld(f), cameraUniforms(f, 1), f.flowX, f.flowY, out);
  return out;
}

describe("Nebula temporal resolve", () => {
  it("offsets the rays within the pixel and averages to its centre over a cycle", () => {
    let sx = 0;
    let sy = 0;
    const seen = new Set<string>();
    for (let i = 0; i < JITTER_CYCLE; i++) {
      const [x, y] = jitterAt(i);
      expect(Math.abs(x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(y)).toBeLessThanOrEqual(0.5);
      sx += x;
      sy += y;
      seen.add(`${x.toFixed(4)},${y.toFixed(4)}`);
    }
    expect(seen.size).toBe(JITTER_CYCLE);
    expect(Math.abs(sx / JITTER_CYCLE)).toBeLessThan(0.1);
    expect(Math.abs(sy / JITTER_CYCLE)).toBeLessThan(0.1);
    expect([...jitterAt(JITTER_CYCLE + 3)]).toEqual([...jitterAt(3)]);
  });

  it("keeps the march's start shift in 0..1 however many frames have run", () => {
    for (const n of [0, 1, 7, 999_999]) {
      expect(frameNoiseAt(n)).toBeGreaterThanOrEqual(0);
      expect(frameNoiseAt(n)).toBeLessThan(1);
    }
  });

  it("puts a gas parcel where the last camera saw it", () => {
    const f = createFlight();
    advanceFlight(f, 40, 0.22, 1, 1);
    const prev = frameOf(f);
    advanceFlight(f, 1 / 60, 0.22 * 3.5, 1, 4);
    const cur = frameOf(f);
    const u = new Float32Array(16);
    prevCamUniforms(prev, cur, PERIOD, u);
    const flowStep = [cur.flow[0] - prev.flow[0], cur.flow[1] - prev.flow[1], 0];
    // Two units ahead of this camera, in world space.
    const ahead = [0, 1, 2].map((k) => 2 * cur.basis[8 + k]);
    const parcel = [0, 1, 2].map((k) => cur.world[k] + ahead[k]);
    for (let k = 0; k < 3; k++) {
      // The shader's q: the ray's offset plus uPrevCam[0], against the parcel a frame ago seen from the last camera.
      expect(ahead[k] + u[k]).toBeCloseTo(parcel[k] - flowStep[k] - prev.world[k], 5);
    }
    expect([...u.subarray(4, 7)]).toEqual([...prev.basis.subarray(0, 3)]);
    expect([...u.subarray(8, 11)]).toEqual([...prev.basis.subarray(4, 7)]);
    expect([...u.subarray(12, 15)]).toEqual([...prev.basis.subarray(8, 11)]);
  });

  it("reads a flow that wrapped as the short step it was", () => {
    const prev = createCameraFrame();
    const cur = createCameraFrame();
    prev.flow = [PERIOD - 0.001, 0.5];
    cur.flow = [0.002, 0.5];
    const u = new Float32Array(16);
    prevCamUniforms(prev, cur, PERIOD, u);
    expect(u[0]).toBeCloseTo(-0.003, 6);
  });

  it("sees no jump where the camera's position wraps into its repeat", () => {
    const f = createFlight();
    f.travel = PERIOD_Z * 3 - 0.001;
    const prev = frameOf(f);
    advanceFlight(f, 1 / 60, 0.22, 1, 0);
    const cur = frameOf(f);
    expect(prevCamUniforms(prev, cur, PERIOD)).toBeLessThan(0.01);
  });

  it("reports a long move, so the history restarts", () => {
    const f = createFlight();
    const prev = frameOf(f);
    f.travel += 2 * MAX_JUMP;
    expect(prevCamUniforms(prev, frameOf(f), PERIOD)).toBeGreaterThan(MAX_JUMP);
  });
});
