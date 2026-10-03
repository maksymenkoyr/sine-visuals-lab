import { describe, it, expect } from "vitest";
import { createFlowClock, createScaledPhase, MAX_SCALED_STEP } from "../src/render/flowClock.ts";

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

describe("scaled phase", () => {
  it("accumulates the clock's step times a constant rate", () => {
    const sp = createScaledPhase();
    sp.advance(600, 1.5); // first call anchors at the clock's phase
    let phase = 600;
    let out = 0;
    for (let i = 0; i < 10; i++) {
      phase += 0.02;
      out = sp.advance(phase, 1.5);
    }
    expect(out).toBeCloseTo(10 * 0.02 * 1.5);
  });

  it("changing the rate late in a session only changes the speed, never the position", () => {
    // flowPhase * rate would move by 600 * 0.05 = 30 on the frame the rate
    // goes from 1 to 1.05; the accumulator moves by one step times 1.05.
    const sp = createScaledPhase();
    sp.advance(600, 1);
    const before = sp.advance(600.02, 1);
    const after = sp.advance(600.04, 1.05);
    expect(after - before).toBeCloseTo(0.02 * 1.05);
  });

  it("ignores backwards and oversized clock steps, and starts from zero", () => {
    const sp = createScaledPhase();
    expect(sp.advance(500, 1)).toBe(0);
    const a = sp.advance(500.02, 1);
    expect(sp.advance(3, 1)).toBe(a); // clock swapped for a younger one
    expect(sp.advance(3.02, 1)).toBeCloseTo(a + 0.02);
    const b = sp.advance(3.02 + MAX_SCALED_STEP + 5, 1); // long stall
    expect(b).toBeCloseTo(a + 0.02);
  });

  it("never runs backwards for a negative rate, and reset returns to zero", () => {
    const sp = createScaledPhase();
    sp.advance(10, -1);
    expect(sp.advance(10.02, -1)).toBe(0);
    sp.advance(10.04, 1);
    sp.reset();
    expect(sp.advance(50, 1)).toBe(0);
  });
});
