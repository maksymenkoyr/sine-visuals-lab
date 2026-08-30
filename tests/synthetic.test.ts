import { describe, it, expect } from "vitest";
import { createSyntheticFeed } from "../src/audio/synthetic.ts";
import { NUM_BANDS } from "../src/audio/types.ts";

const DT = 1 / 60;
const DURATION_SEC = 10;

describe("createSyntheticFeed", () => {
  it("stays within [0,1] and finite across a simulated run", () => {
    const feed = createSyntheticFeed();
    for (let t = 0; t < DURATION_SEC; t += DT) {
      const frame = feed.frame(t);
      expect(frame.bands.length).toBe(NUM_BANDS);
      for (const b of frame.bands) {
        expect(Number.isFinite(b)).toBe(true);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(1);
      }
      expect(frame.energy).toBeGreaterThanOrEqual(0);
      expect(frame.energy).toBeLessThanOrEqual(1);
    }
  });

  it("fires exactly once per beat period at 120bpm over 10s", () => {
    const feed = createSyntheticFeed({ bpm: 120 });
    let beats = 0;
    let lastBeatTime = -Infinity;
    const period = 60 / 120;
    for (let t = 0; t < DURATION_SEC; t += DT) {
      const frame = feed.frame(t);
      if (frame.onset) {
        expect(t - lastBeatTime).toBeGreaterThan(period - DT * 2);
        lastBeatTime = t;
        beats++;
      }
    }
    expect(beats).toBe(20); // 10s at 120bpm = 20 beats
  });

  it("wraps onsetPhase to below 0.1 right after a beat fires", () => {
    const feed = createSyntheticFeed({ bpm: 120 });
    for (let t = 0; t < DURATION_SEC; t += DT) {
      const frame = feed.frame(t);
      if (frame.onset) expect(frame.onsetPhase).toBeLessThan(0.1);
    }
  });

  it("is deterministic in time", () => {
    const a = createSyntheticFeed({ bpm: 120, phaseOffsetSec: 0.3 });
    const b = createSyntheticFeed({ bpm: 120, phaseOffsetSec: 0.3 });
    for (const t of [0, 0.37, 1.234, 5.5]) {
      expect(Array.from(a.frame(t).bands)).toEqual(Array.from(b.frame(t).bands));
    }
  });

  it("produces different band vectors for feeds with different phase offsets", () => {
    const a = createSyntheticFeed({ bpm: 120, phaseOffsetSec: 0 });
    const b = createSyntheticFeed({ bpm: 120, phaseOffsetSec: 0.17 });
    const t = 1.234;
    expect(Array.from(a.frame(t).bands)).not.toEqual(Array.from(b.frame(t).bands));
  });
});
