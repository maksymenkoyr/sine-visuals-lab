import { describe, it, expect } from "vitest";
import { createAnimClock, WAVE_PEAK_FALL_PER_SEC } from "../src/render/animClock.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";
import type { SilenceGateMarks } from "../src/audio/silenceGate.ts";
import type { HitShape } from "../src/audio/hitStrength.ts";
import { smoothingRateScale, SMOOTHING_DEFAULT } from "../src/audio/sensitivity.ts";

// Reused wherever a test needs to pass `hit` just to reach `wavePeak` —
// its own fields don't matter when no onset fires this tick.
const NEUTRAL_SHAPE: HitShape = { amount: 1, knee: 1, loudness: 1, floor: 0, tail: 1 };

const DT = 1 / 60;

function frame(overrides: Partial<FeatureFrame> = {}): FeatureFrame {
  return {
    time: 0,
    bands: new Float32Array(NUM_BANDS),
    energy: 0,
    level: 1,
    onset: false,
    pulseOnset: false,
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
    const anim = clock.advance(DT, frame({ level: 0 }), undefined, marks);
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
    const shape: HitShape = { amount: 1, knee: 1, loudness: 1, floor: 0, tail: 1 };
    const anim = clock.advance(DT, frame({ onset: true, level: 0.37 }), undefined, undefined, { shape });
    expect(anim.beatPulse).toBeCloseTo(0.37, 5);
  });

  it("Tail stretches how long beatPulse rings out, and publishes hitTail", () => {
    const decayAfter = (tail: number): { pulse: number; hitTail: number } => {
      const clock = createAnimClock();
      const shape: HitShape = { ...NEUTRAL_SHAPE, amount: 0, tail };
      clock.advance(DT, frame({ onset: true }), undefined, undefined, { shape });
      let anim = clock.advance(DT, frame(), undefined, undefined, { shape });
      for (let i = 0; i < 9; i++) anim = clock.advance(DT, frame(), undefined, undefined, { shape });
      return { pulse: anim.beatPulse, hitTail: anim.hitTail };
    };
    const plain = decayAfter(1);
    const long = decayAfter(2);
    const short = decayAfter(0.5);
    expect(plain.hitTail).toBe(1);
    expect(long.hitTail).toBe(0.5);
    expect(long.pulse).toBeGreaterThan(plain.pulse);
    expect(short.pulse).toBeLessThan(plain.pulse);
    // Twice as long = exactly the square root of what a plain pulse kept.
    expect(long.pulse).toBeCloseTo(Math.sqrt(plain.pulse), 6);
  });

  it("omitted `hit` leaves hitTail at 1", () => {
    expect(createAnimClock().advance(DT, frame()).hitTail).toBe(1);
  });

  it("hitStrength.low mirrors bandEnergy's own graded hit when a shape is given", () => {
    const clock = createAnimClock();
    const shape: HitShape = { amount: 1, knee: 1, loudness: 0, floor: 0, tail: 1 };
    const quietBands = new Float32Array(NUM_BANDS).fill(0.1);
    for (let i = 0; i < 30; i++) clock.advance(DT, frame({ bands: quietBands, level: 1 }), undefined, undefined, { shape });
    const loudBands = new Float32Array(NUM_BANDS).fill(0.6);
    const anim = clock.advance(DT, frame({ bands: loudBands, level: 1 }), undefined, undefined, { shape });
    expect(anim.hitStrength.low.strength).toBeGreaterThan(0);
    expect(anim.hitStrength.low.strength).toBeLessThanOrEqual(1);
  });

  it("beats is beatClock's own free-running unwrapped count, straight through", () => {
    const clock = createAnimClock();
    const anim = clock.advance(DT, frame({ bpm: 120, onset: true }));
    expect(anim.beats).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(anim.beats)).toBe(true);
  });

  // Regression for the silence-gate-starves-tempo bug (see
  // src/audio/types.ts's FeatureFrame.pulseOnset and this file's own
  // beat.advance() call for the fix): on the render-tick path (no
  // hit.tempoHits), the beat clock's phase comb must follow
  // frame.pulseOnset, never the gated frame.onset — feeding it one without
  // the other must produce opposite outcomes, not just "both work".
  it("render-tick path: the phase comb locks on pulseOnset hits even while onset never fires", () => {
    const clock = createAnimClock();
    const bpm = 120; // one beat every 0.5s
    const periodSec = 60 / bpm;
    let t = 0;
    let lastAnim = clock.advance(DT, frame({ bpm, time: t }));
    for (let i = 0; i < 600; i++) {
      t += DT;
      const dueBeat = Math.floor(t / periodSec) > Math.floor((t - DT) / periodSec);
      lastAnim = clock.advance(DT, frame({ bpm, time: t, onset: false, pulseOnset: dueBeat }));
      // The gated visual hit never fires in this scenario, so beatPulse
      // (raw frame.onset passthrough) must stay exactly 0 throughout.
      expect(lastAnim.beatPulse).toBe(0);
    }
    expect(lastAnim.tempoLock).toBeGreaterThan(0.5);
  });

  it("render-tick path: onset-only hits (no pulseOnset) never lock the phase comb", () => {
    const clock = createAnimClock();
    const bpm = 120;
    const periodSec = 60 / bpm;
    let t = 0;
    let lastAnim = clock.advance(DT, frame({ bpm, time: t }));
    for (let i = 0; i < 600; i++) {
      t += DT;
      const dueBeat = Math.floor(t / periodSec) > Math.floor((t - DT) / periodSec);
      lastAnim = clock.advance(DT, frame({ bpm, time: t, onset: dueBeat, pulseOnset: false }));
    }
    expect(lastAnim.tempoLock).toBeLessThan(0.1);
  });
});

describe("AnimFrame.wavePeak", () => {
  it("omitted hit.wavePeak holds nothing — reads exactly 0 (no local mic)", () => {
    const clock = createAnimClock();
    const anim = clock.advance(DT, frame());
    expect(anim.wavePeak).toBe(0);
  });

  it("peak-holds a louder reading, falling at WAVE_PEAK_FALL_PER_SEC times the tick's smoothing rateScale", () => {
    const clock = createAnimClock();
    const dtSec = 0.1;
    const rateScale = smoothingRateScale(SMOOTHING_DEFAULT);
    let anim = clock.advance(dtSec, frame(), SMOOTHING_DEFAULT, undefined, { shape: NEUTRAL_SHAPE, wavePeak: 0.5 });
    expect(anim.wavePeak).toBe(0.5);
    // The next tick's own instant peak (0.1) is quieter than the held 0.5,
    // so the reading falls toward it rather than snapping down to it.
    anim = clock.advance(dtSec, frame(), SMOOTHING_DEFAULT, undefined, { shape: NEUTRAL_SHAPE, wavePeak: 0.1 });
    expect(anim.wavePeak).toBeCloseTo(0.5 - WAVE_PEAK_FALL_PER_SEC * rateScale * dtSec, 10);
    expect(anim.wavePeak).toBeLessThan(0.5);
    expect(anim.wavePeak).toBeGreaterThan(0.1);
  });

  it("a louder instant peak replaces the held one immediately, not eased toward", () => {
    const clock = createAnimClock();
    let anim = clock.advance(DT, frame(), SMOOTHING_DEFAULT, undefined, { shape: NEUTRAL_SHAPE, wavePeak: 0.2 });
    expect(anim.wavePeak).toBe(0.2);
    anim = clock.advance(DT, frame(), SMOOTHING_DEFAULT, undefined, { shape: NEUTRAL_SHAPE, wavePeak: 0.9 });
    expect(anim.wavePeak).toBe(0.9);
  });
});
