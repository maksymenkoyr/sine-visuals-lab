import { describe, it, expect } from "vitest";
import { pickBestOffset, type ClockSample } from "../src/net/clock.ts";

/**
 * Simulates one ping/pong round trip in client-clock terms, given the true
 * server-minus-client offset and independent uplink/downlink delays.
 */
function simulateSample(t0: number, trueOffsetMs: number, uplinkMs: number, downlinkMs: number): ClockSample {
  const t1 = t0 + trueOffsetMs + uplinkMs; // server clock at receipt
  const t2 = t0 + uplinkMs + downlinkMs; // client clock at reply receipt
  return { t0, t1, t2 };
}

describe("pickBestOffset", () => {
  it("returns 0 for no samples", () => {
    expect(pickBestOffset([])).toBe(0);
  });

  it("recovers the true offset from a single clean symmetric sample", () => {
    const sample = simulateSample(1_000_000, 500, 10, 10);
    expect(pickBestOffset([sample])).toBeCloseTo(500, 6);
  });

  it("picks the lowest-RTT sample and ignores noisy/asymmetric ones", () => {
    const trueOffset = 500;
    const samples = [
      simulateSample(1_000_000, trueOffset, 300, 20), // congested uplink, big asymmetry
      simulateSample(1_000_200, trueOffset, 15, 400), // congested downlink, big asymmetry
      simulateSample(1_000_400, trueOffset, 250, 250), // symmetric but slow (jitter)
      simulateSample(1_000_600, trueOffset, 8, 9), // clean, low RTT — should win
      simulateSample(1_000_800, trueOffset, 180, 30),
    ];

    const estimate = pickBestOffset(samples);
    // The noisy samples alone would be off by ~140-190ms; the clean one is
    // accurate to within its own tiny asymmetry (<1ms here).
    expect(Math.abs(estimate - trueOffset)).toBeLessThan(2);
  });

  it("stays accurate when the client clock is behind (negative offset)", () => {
    const samples = [
      simulateSample(2_000_000, -250, 12, 12), // symmetric — exact
      simulateSample(2_000_200, -250, 100, 5), // asymmetric, higher RTT — should lose
    ];
    expect(pickBestOffset(samples)).toBeCloseTo(-250, 6);
  });
});
