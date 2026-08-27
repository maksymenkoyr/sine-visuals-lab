import { describe, it, expect } from "vitest";
import { SlewLimiter } from "../src/net/slewLimiter.ts";

// RoomConnectionBase itself opens a live WebSocket and touches localStorage
// in its constructor (via config.ts's module-level `location` read), so it
// isn't unit-testable in this project's node test environment (see
// vitest.config.ts) — that's also why SlewLimiter lives in its own module
// rather than room.ts. It's the pure logic behind the render-delay
// transition (RENDER_DELAY_MS's fast host-alone path in
// HostConnection.targetDelayMs), so that's what's covered here.
describe("SlewLimiter", () => {
  it("snaps to the target on the first call — nothing to slew from yet", () => {
    const slew = new SlewLimiter(0.05);
    expect(slew.next(120, 1000)).toBe(120);
  });

  it("converges toward a new target at the configured rate instead of stepping", () => {
    const slew = new SlewLimiter(0.05); // 5%/ms -> 120ms swing takes ~2400ms
    slew.next(0, 0); // establish baseline at 0

    const after1s = slew.next(120, 1000);
    expect(after1s).toBeGreaterThan(0);
    expect(after1s).toBeLessThan(120); // hasn't stepped straight to the target
    expect(after1s).toBeCloseTo(50, 5); // 0.05 * 1000ms

    const after2400ms = slew.next(120, 2400);
    expect(after2400ms).toBeCloseTo(120, 5); // fully converged by ~2.4s
  });

  it("converges monotonically toward the target without overshoot", () => {
    const slew = new SlewLimiter(0.05);
    slew.next(0, 0);

    let prev = 0;
    for (let ms = 100; ms <= 3000; ms += 100) {
      const v = slew.next(120, ms);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(120);
      prev = v;
    }
    expect(prev).toBeCloseTo(120, 5);
  });

  it("converges symmetrically when the target drops back down", () => {
    const slew = new SlewLimiter(0.05);
    slew.next(120, 0);
    const partway = slew.next(0, 1000);
    expect(partway).toBeCloseTo(70, 5); // 120 - 0.05*1000
    expect(slew.next(0, 3400)).toBeCloseTo(0, 5);
  });

  it("treats a non-advancing or reversed timestamp as zero elapsed time", () => {
    const slew = new SlewLimiter(0.05);
    slew.next(0, 1000);
    // A stale/duplicate timestamp shouldn't move the value at all.
    expect(slew.next(120, 1000)).toBe(0);
    expect(slew.next(120, 500)).toBe(0);
  });
});
