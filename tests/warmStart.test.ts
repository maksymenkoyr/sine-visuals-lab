import { describe, it, expect } from "vitest";
import { WARM_T0_SEC, warmRate } from "../src/audio/warmStart.ts";

// Pure function, no module state to reset between tests — unlike
// autoGain.test.ts/silenceGate.test.ts's own describe blocks.
describe("warmRate", () => {
  it("at warmSec 0, the rate is 1/WARM_T0_SEC", () => {
    expect(warmRate(0.1, 0)).toBeCloseTo(1 / WARM_T0_SEC);
    expect(warmRate(0.25, 0)).toBeCloseTo(1 / WARM_T0_SEC);
  });

  it("is never below steadyRate, however long it's been warming up", () => {
    for (const steadyRate of [0.05, 0.1, 0.25, 1]) {
      for (const warmSec of [0, 1, 5, 30, 1000]) {
        expect(warmRate(steadyRate, warmSec)).toBeGreaterThanOrEqual(steadyRate);
      }
    }
  });

  it("equals steadyRate once warmSec is large enough that the cumulative-average rate has fallen under it", () => {
    const steadyRate = 0.1;
    // 1/(warmSec+T0) crosses 0.1 around warmSec=9.5 -- well past that, the
    // steady rate must be exactly what comes back, not just close to it.
    expect(warmRate(steadyRate, 1000)).toBe(steadyRate);
  });

  it("is monotonically non-increasing as warmSec grows", () => {
    let prev = warmRate(0.1, 0);
    for (let warmSec = 0.1; warmSec <= 60; warmSec += 0.1) {
      const value = warmRate(0.1, warmSec);
      expect(value).toBeLessThanOrEqual(prev + 1e-9);
      prev = value;
    }
  });

  it("treats a non-finite warmSec as fully warm -- returns steadyRate exactly", () => {
    expect(warmRate(0.1, Number.NaN)).toBe(0.1);
    expect(warmRate(0.1, Number.POSITIVE_INFINITY)).toBe(0.1);
    expect(warmRate(0.1, Number.NEGATIVE_INFINITY)).toBe(0.1);
  });

  it("clamps a negative warmSec to 0 rather than inflating the rate further", () => {
    expect(warmRate(0.1, -5)).toBeCloseTo(1 / WARM_T0_SEC);
    expect(warmRate(0.1, -1)).toBeCloseTo(warmRate(0.1, 0));
  });
});
