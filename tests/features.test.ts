import { describe, it, expect } from "vitest";
import { FeatureExtractor } from "../src/audio/features.ts";
import { NUM_BANDS } from "../src/audio/types.ts";

const QUIET_DB = -90;
const LOUD_DB = -20;

function bandsFrame(baseDb: number, overrides: Record<number, number> = {}): Float32Array {
  const bands = new Float32Array(NUM_BANDS).fill(baseDb);
  for (const [i, v] of Object.entries(overrides)) bands[Number(i)] = v;
  return bands;
}

describe("FeatureExtractor", () => {
  it("responds selectively to the band that's actually loud", () => {
    const extractor = new FeatureExtractor();
    const dt = 1 / 60;
    let time = 0;
    let frame;

    // Establish a quiet floor first so there's a range to normalize against.
    for (let i = 0; i < 60; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(QUIET_DB), time);
    }

    // Now drive one band loud, others stay quiet.
    for (let i = 0; i < 60; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(QUIET_DB, { 5: LOUD_DB }), time);
    }

    expect(frame!.bands[5]).toBeGreaterThan(0.7);
    expect(frame!.bands[0]).toBeLessThan(0.3);
    expect(frame!.bands[NUM_BANDS - 1]).toBeLessThan(0.3);
  });

  it("locks onto the tempo of a periodic click track", () => {
    const extractor = new FeatureExtractor();
    const bpm = 120;
    const intervalSec = 60 / bpm;
    const dt = 1 / 60;
    let time = 0;
    let frame;
    let nextClickAt = intervalSec;

    // Prime the adaptive floor/peak with a couple of quiet seconds first.
    for (let i = 0; i < 120; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(QUIET_DB), time);
    }

    const endTime = time + 8; // ~16 clicks at 120bpm
    while (time < endTime) {
      time += dt;
      const isClick = time >= nextClickAt;
      if (isClick) nextClickAt += intervalSec;
      frame = extractor.update(bandsFrame(QUIET_DB, isClick ? { 0: LOUD_DB, 12: LOUD_DB } : {}), time);
    }

    expect(frame!.bpm).toBeGreaterThan(bpm - 5);
    expect(frame!.bpm).toBeLessThan(bpm + 5);
  });

  it("attacks fast: a step up reaches ~90% of its target within 2 frames at 60fps", () => {
    const extractor = new FeatureExtractor();
    const dt = 1 / 60;
    let time = 0;
    let frame;

    // Establish a steady quiet floor/peak first, as in the other tests.
    for (let i = 0; i < 120; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(QUIET_DB), time);
    }

    // Step one band loud and check how fast its envelope catches up —
    // release (RELEASE_PER_SEC) is deliberately slow, but attack should be
    // near-instant so transients don't lag the sound that caused them.
    time += dt;
    frame = extractor.update(bandsFrame(QUIET_DB, { 5: LOUD_DB }), time);
    time += dt;
    frame = extractor.update(bandsFrame(QUIET_DB, { 5: LOUD_DB }), time);

    expect(frame!.bands[5]).toBeGreaterThan(0.9);
  });

  it("converges after a sudden step up in level", () => {
    const extractor = new FeatureExtractor();
    const dt = 1 / 60;
    let time = 0;
    let frame;

    for (let i = 0; i < 120; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(QUIET_DB), time);
    }
    expect(frame!.energy).toBeLessThan(0.2);

    for (let i = 0; i < 120; i++) {
      time += dt;
      frame = extractor.update(bandsFrame(LOUD_DB), time);
    }
    expect(frame!.energy).toBeGreaterThan(0.6);
  });
});
