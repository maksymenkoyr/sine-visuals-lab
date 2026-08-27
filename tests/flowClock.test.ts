import { describe, it, expect } from "vitest";
import { createFlowClock } from "../src/render/flowClock.ts";

describe("flow clock", () => {
  it("starts at zero and advances forward with zero energy", () => {
    const clock = createFlowClock();
    expect(clock.advance(0, 0)).toBeCloseTo(0);
    const phase = clock.advance(1, 0);
    expect(phase).toBeCloseTo(1);
  });

  it("is monotonic even when energy jumps between frames", () => {
    // This is the regression test for the original bug: `uTime * (0.15 +
    // bass * 0.5)` scaled *elapsed* time by a live audio value, so a sudden
    // bass change teleported the result. A phase accumulator instead can
    // only ever speed up or slow down the rate going forward — never jump.
    const clock = createFlowClock();
    let phase = 0;
    const dt = 1 / 60;
    const energies = [0, 0, 1, 1, 0, 1, 0.5, 0, 1];
    for (const e of energies) {
      const next = clock.advance(dt, e);
      const delta = next - phase;
      // Max possible rate is 1 + FLOW_ENERGY_GAIN (energy clamped to [0,1]);
      // bound the per-step delta generously above that so this only fails on
      // an actual discontinuity, not a rounding nit.
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeLessThanOrEqual(dt * 2);
      phase = next;
    }
  });

  it("clamps negative energy so it never runs the phase backwards", () => {
    const clock = createFlowClock();
    const a = clock.advance(1, -5);
    const b = clock.advance(1, -5);
    expect(b).toBeGreaterThan(a);
  });

  it("speeds up with higher energy", () => {
    const slow = createFlowClock();
    const fast = createFlowClock();
    const slowPhase = slow.advance(1, 0);
    const fastPhase = fast.advance(1, 1);
    expect(fastPhase).toBeGreaterThan(slowPhase);
  });
});
