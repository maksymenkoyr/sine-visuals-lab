import { describe, expect, it } from "vitest";
import { MAX_READ_BATCH, nextReadCost, READ_COST_SHARE, readBatchSize } from "../src/render/pictureReadback.ts";
import { PICTURE_SAMPLE_INTERVAL_MS } from "../src/render/pictureMeter.ts";

// The GL half of pictureReadback.ts needs a context; what can be checked
// without one is the rule that decides how many thumbnails one
// getBufferSubData call carries (issue #550's stalled reads).

describe("readBatchSize", () => {
  it("reads every thumbnail while calls are cheap, or the cost is unknown", () => {
    expect(readBatchSize(0, PICTURE_SAMPLE_INTERVAL_MS)).toBe(1);
    expect(readBatchSize(Number.NaN, PICTURE_SAMPLE_INTERVAL_MS)).toBe(1);
    expect(readBatchSize(1.5, PICTURE_SAMPLE_INTERVAL_MS)).toBe(1);
  });

  it("asks each call to carry more frames as calls get slower, never fewer", () => {
    let last = 1;
    for (let cost = 0; cost <= 200; cost += 0.5) {
      const n = readBatchSize(cost, PICTURE_SAMPLE_INTERVAL_MS);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });

  it("keeps the reads within their share of the main thread, up to the batch cap", () => {
    for (const cost of [3, 10, 25, 40]) {
      const n = readBatchSize(cost, PICTURE_SAMPLE_INTERVAL_MS);
      expect(n).toBeLessThanOrEqual(MAX_READ_BATCH);
      if (n < MAX_READ_BATCH) expect(cost / (n * PICTURE_SAMPLE_INTERVAL_MS)).toBeLessThanOrEqual(READ_COST_SHARE);
    }
  });

  it("never exceeds the pack buffer's slots", () => {
    expect(readBatchSize(10_000, PICTURE_SAMPLE_INTERVAL_MS)).toBe(MAX_READ_BATCH);
  });
});

describe("nextReadCost", () => {
  it("follows a slowdown faster than a recovery", () => {
    const up = nextReadCost(2, 42) - 2;
    const down = 42 - nextReadCost(42, 2);
    expect(up).toBeGreaterThan(down);
  });

  it("settles on a steady cost without overshooting it", () => {
    let c = 0;
    for (let i = 0; i < 40; i++) {
      c = nextReadCost(c, 35);
      expect(c).toBeLessThanOrEqual(35);
    }
    expect(c).toBeCloseTo(35, 1);
  });
});
