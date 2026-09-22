import { describe, it, expect } from "vitest";
import { createAnimClock } from "../src/render/animClock.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";
import type { SilenceGateMarks } from "../src/audio/silenceGate.ts";
import type { HitShape } from "../src/audio/hitStrength.ts";

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

  // Graded pulse height (src/audio/hitStrength.ts), threaded through
  // advance()'s optional `hit` — see animClock's own doc comment for why an
  // omitted `hit` must reproduce today's flat-1 beatPulse exactly.
  it("omitted `hit` -> beatPulse snaps to exactly 1 on onset (today's behavior)", () => {
    const clock = createAnimClock();
    const anim = clock.advance(DT, frame({ onset: true }));
    expect(anim.beatPulse).toBe(1);
  });

  it("with a shape at amount 1 and loudness 1, beatPulse on onset lands on frame.level", () => {
    const clock = createAnimClock();
    const shape: HitShape = { amount: 1, knee: 1, loudness: 1, floor: 0 };
    const anim = clock.advance(DT, frame({ onset: true, level: 0.37 }), undefined, undefined, undefined, { shape });
    expect(anim.beatPulse).toBeCloseTo(0.37, 5);
  });

  it("hitStrength.low mirrors bandEnergy's own graded hit when a shape is given", () => {
    const clock = createAnimClock();
    const shape: HitShape = { amount: 1, knee: 1, loudness: 0, floor: 0 };
    const quietBands = new Float32Array(NUM_BANDS).fill(0.1);
    for (let i = 0; i < 30; i++) clock.advance(DT, frame({ bands: quietBands, level: 1 }), undefined, undefined, undefined, { shape });
    const loudBands = new Float32Array(NUM_BANDS).fill(0.6);
    const anim = clock.advance(DT, frame({ bands: loudBands, level: 1 }), undefined, undefined, undefined, { shape });
    expect(anim.hitStrength.low.strength).toBeGreaterThan(0);
    expect(anim.hitStrength.low.strength).toBeLessThanOrEqual(1);
  });

  // The sensitivity line (src/audio/bandLine.ts), threaded through
  // advance()'s optional `line` — see animClock's own doc comment for why an
  // omitted `line` must reproduce a driveless frame exactly.
  it("omitted `line` -> lineDrive is 0 and lineExcess is null", () => {
    const clock = createAnimClock();
    const bands = new Float32Array(NUM_BANDS).fill(0.5);
    const anim = clock.advance(DT, frame({ bands }));
    expect(anim.lineDrive).toBe(0);
    expect(anim.lineExcess).toBeNull();
  });

  it("a flat-0 line at strength 1 makes lineDrive equal frame.energy", () => {
    const clock = createAnimClock();
    const bands = Float32Array.from({ length: NUM_BANDS }, (_, i) => (i % 7) / 10);
    const energy = Array.from(bands).reduce((a, b) => a + b, 0) / NUM_BANDS;
    const line = new Float32Array(NUM_BANDS).fill(0);
    const anim = clock.advance(DT, frame({ bands, energy }), undefined, undefined, undefined, undefined, {
      heights: line,
      strength: 1,
    });
    expect(anim.lineDrive).toBeCloseTo(energy, 5);
    expect(anim.lineExcess).not.toBeNull();
  });
});
