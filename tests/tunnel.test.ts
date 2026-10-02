import { describe, it, expect } from "vitest";
import { advanceTunnelCamera, createTunnelCamera } from "../src/render/scenes/tunnel.ts";

describe("tunnel camera", () => {
  it("starts where time * speed would have put it, then moves at that speed", () => {
    const cam = createTunnelCamera();
    const z0 = advanceTunnelCamera(cam, 10, 120);
    expect(z0).toBeCloseTo(10 * (1.2 + 120 * 0.004));
    const z1 = advanceTunnelCamera(cam, 10.05, 120);
    expect(z1 - z0).toBeCloseTo(0.05 * (1.2 + 120 * 0.004));
  });

  it("a tempo change late in a session changes the speed, not the position", () => {
    const cam = createTunnelCamera();
    let t = 300;
    advanceTunnelCamera(cam, t, 90);
    let z = advanceTunnelCamera(cam, (t += 1 / 60), 90);
    // 90 -> 180 BPM: time * speed would have jumped by 300 * 0.004 * 90 = 108.
    const after = advanceTunnelCamera(cam, (t += 1 / 60), 180);
    expect(after - z).toBeLessThan(0.1);
    // ...and the camera does speed up toward the new tempo.
    z = after;
    for (let i = 0; i < 180; i++) z = advanceTunnelCamera(cam, (t += 1 / 60), 180);
    const step = advanceTunnelCamera(cam, (t += 1 / 60), 180) - z;
    expect(step * 60).toBeCloseTo(1.2 + 180 * 0.004, 1);
  });

  it("never runs backwards, and a long gap or a swapped clock moves it by at most one capped step", () => {
    const cam = createTunnelCamera();
    const z = advanceTunnelCamera(cam, 50, 120);
    expect(advanceTunnelCamera(cam, 5, 120)).toBe(z); // clock restarted younger
    const far = advanceTunnelCamera(cam, 5 + 600, 120); // tab hidden for ten minutes
    expect(far - z).toBeLessThanOrEqual(0.1 * (1.2 + 120 * 0.004) + 1e-9);
  });
});
