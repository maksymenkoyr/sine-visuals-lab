import { describe, it, expect } from "vitest";
import { nominalBandEdgesHz, bandEdgesHz, formatHz, MIN_HZ, MAX_HZ_CAP } from "../src/audio/bandScale.ts";
import { NUM_BANDS } from "../src/audio/types.ts";

describe("band scale", () => {
  it("nominal edges start at MIN_HZ, end at MAX_HZ_CAP, and have NUM_BANDS + 1 entries", () => {
    const edges = nominalBandEdgesHz();
    expect(edges.length).toBe(NUM_BANDS + 1);
    expect(edges[0]).toBeCloseTo(MIN_HZ);
    expect(edges[NUM_BANDS]).toBeCloseTo(MAX_HZ_CAP);
  });

  it("edges are strictly monotonically increasing", () => {
    const edges = nominalBandEdgesHz();
    for (let i = 1; i < edges.length; i++) {
      expect(edges[i]).toBeGreaterThan(edges[i - 1]);
    }
  });

  it("bandEdgesHz respects a custom ceiling", () => {
    const edges = bandEdgesHz(8000);
    expect(edges[0]).toBeCloseTo(MIN_HZ);
    expect(edges[NUM_BANDS]).toBeCloseTo(8000);
  });

  it("formatHz stays in Hz below 1000 and switches to kHz at/above it", () => {
    expect(formatHz(179)).toBe("179 Hz");
    expect(formatHz(999)).toBe("999 Hz");
    expect(formatHz(1000)).toBe("1.0 kHz");
    expect(formatHz(2200)).toBe("2.2 kHz");
    expect(formatHz(16000)).toBe("16 kHz");
  });
});
