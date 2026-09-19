import { describe, it, expect } from "vitest";
import { createAnimClock } from "../src/render/animClock.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";
import type { SilenceGateMarks } from "../src/audio/silenceGate.ts";

const DT = 1 / 60;

function frame(overrides: Partial<FeatureFrame> = {}): FeatureFrame {
  return {
    time: 0,
    bands: new Float32Array(NUM_BANDS),
    energy: 0,
    level: 1,
    onset: false,
    bpm: 0,
    onsetPhase: 0,
    ...overrides,
  };
}

describe("createAnimClock", () => {
  it("passes FeatureFrame.bpm straight through", () => {
    const clock = createAnimClock();
    const anim = clock.advance(DT, frame({ bpm: 128 }));
    expect(anim.bpm).toBe(128);
  });

  it("gateDimmer is 1 when advance() is called with no gate marks", () => {
    const clock = createAnimClock();
    const anim = clock.advance(DT, frame({ level: 0 }));
    expect(anim.gateDimmer).toBe(1);
  });

  it("gateDimmer drops below 1 when the marks sit above the frame's level", () => {
    const clock = createAnimClock();
    const marks: SilenceGateMarks = { closed: 0.1, open: 0.5 };
    const anim = clock.advance(DT, frame({ level: 0 }), undefined, undefined, marks);
    expect(anim.gateDimmer).toBeLessThan(1);
  });

  it("hits.low/mid/high mirror bandEnergy's own per-group diagnostics", () => {
    const clock = createAnimClock();
    const quietBands = new Float32Array(NUM_BANDS).fill(0.1);
    for (let i = 0; i < 30; i++) clock.advance(DT, frame({ bands: quietBands, level: 1 }));
    const loudBands = new Float32Array(NUM_BANDS).fill(0.6);
    const anim = clock.advance(DT, frame({ bands: loudBands, level: 1 }));
    expect(anim.hits.low.ratio).toBeGreaterThan(0);
    expect(anim.hits.mid.ratio).toBeGreaterThan(0);
    expect(anim.hits.high.ratio).toBeGreaterThan(0);
  });

  it("hits.low is a snapshot copy, not a live alias — an old AnimFrame doesn't change under a later tick", () => {
    const clock = createAnimClock();
    const bands = new Float32Array(NUM_BANDS).fill(0.1);
    const first = clock.advance(DT, frame({ bands, level: 1 }));
    const firstRatio = first.hits.low.ratio;
    const loudBands = new Float32Array(NUM_BANDS).fill(0.9);
    clock.advance(DT, frame({ bands: loudBands, level: 1 }));
    expect(first.hits.low.ratio).toBe(firstRatio);
  });
});
