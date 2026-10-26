import { describe, it, expect } from "vitest";
import { createAnimClock, type AnimClock, type AnimFrame } from "../src/render/animClock.ts";
import { LOCK_MEANINGS } from "../src/render/lockMeaning.ts";
import { FOLLOW_LOCK } from "../src/render/metronome.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";
import type { SilenceGateMarks } from "../src/audio/silenceGate.ts";
import { UNIT_TAILS, type HitShape } from "../src/audio/hitStrength.ts";
import { engineReading } from "./engineReading.ts";

/** One engine hit of each kind given, with no other reading. */
const HIT = (kinds: { kick?: number; snare?: number; hat?: number }) => engineReading(kinds);

// A hit shape that leaves every hit's strength as it is, spread into the
// shapes a test does tune.
const NEUTRAL_SHAPE: HitShape = { amount: 1, knee: 1, loudness: 1, floor: 0, tail: UNIT_TAILS };

const DT = 1 / 60;

/** The signed distance to the nearest whole number. */
function wrapHalf(x: number): number {
  return x - Math.floor(x + 0.5);
}

function frame(overrides: Partial<FeatureFrame> = {}): FeatureFrame {
  return {
    time: 0,
    bands: new Float32Array(NUM_BANDS),
    energy: 0,
    level: 1,
    hats: 0,
    lead: 0,
    onset: false,
    pulseOnset: false,
    bpm: 0,
    onsetPhase: 0,
    engine: null,
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

  it("hats and lead ease up to the frame's values when no gate is given", () => {
    const clock = createAnimClock();
    let anim = clock.advance(DT, frame({ hats: 1, lead: 1 }));
    for (let i = 0; i < 59; i++) anim = clock.advance(DT, frame({ hats: 1, lead: 1 }));
    expect(anim.hats).toBeGreaterThan(0.9);
    expect(anim.lead).toBeGreaterThan(0.9);
  });

  it("a fully closed silence gate holds hats and lead at 0", () => {
    const clock = createAnimClock();
    const marks: SilenceGateMarks = { closed: 0.5, open: 0.6 };
    let anim = clock.advance(DT, frame({ hats: 1, lead: 1, level: 0 }), undefined, marks);
    for (let i = 0; i < 59; i++) anim = clock.advance(DT, frame({ hats: 1, lead: 1, level: 0 }), undefined, marks);
    expect(anim.hats).toBe(0);
    expect(anim.lead).toBe(0);
  });

  /** Hats rising for 10 ticks then falling for 30, every frame carrying `engine`. */
  function hatsBurst(clock: AnimClock, engine: FeatureFrame["engine"]): AnimFrame[] {
    const out: AnimFrame[] = [];
    for (let i = 0; i < 40; i++) out.push(clock.advance(DT, frame({ hats: i < 10 ? 1 : 0, engine })));
    return out;
  }

  it("a Hats peak while the engine hears music is a hit, sized by the peak", () => {
    const frames = hatsBurst(createAnimClock(), engineReading({ music: true }));
    const hits = frames.filter((a) => a.hatsOnset);
    expect(hits).toHaveLength(1);
    const hit = hits[0]!;
    expect(hit.hatsPulse).toBe(1);
    expect(hit.hatsHit).toBe(hit.hatsPeak);
    expect(hit.hatsPeak).toBeGreaterThan(0.3);
    expect(frames.at(-1)!.hatsPulse).toBeLessThan(0.1);
    expect(frames.at(-1)!.hatsHit).toBe(hit.hatsHit);
  });

  it("a Hats peak with no music heard is found but not counted", () => {
    const frames = hatsBurst(createAnimClock(), engineReading({ music: false }));
    expect(frames.some((a) => a.hatsPeak > 0)).toBe(true);
    expect(frames.some((a) => a.hatsOnset)).toBe(false);
    expect(frames.every((a) => a.hatsPulse === 0 && a.hatsHit === 0)).toBe(true);
  });

  it("hits.low/mid/high mirror bandEnergy's own per-lane diagnostics", () => {
    const clock = createAnimClock();
    const anim = clock.advance(DT, frame({ engine: HIT({ kick: 2, snare: 1.5, hat: 1.2 }) }));
    expect(anim.hits.low.ratio).toBe(2);
    expect(anim.hits.mid.ratio).toBe(1.5);
    expect(anim.hits.high.ratio).toBe(1.2);
  });

  it("hits.low is a snapshot copy, not a live alias — an old AnimFrame doesn't change under a later tick", () => {
    const clock = createAnimClock();
    const first = clock.advance(DT, frame({ engine: HIT({ kick: 2 }) }));
    clock.advance(DT, frame({ engine: HIT({ kick: 3 }) }));
    expect(first.hits.low.ratio).toBe(2);
  });

  it("Bass/Mid/Treble levels are the engine reading's", () => {
    const anim = createAnimClock().advance(DT, frame({ engine: engineReading({ low: 0.6, mid: 0.3, high: 0.2 }) }));
    expect([anim.low, anim.mid, anim.high]).toEqual([0.6, 0.3, 0.2]);
  });

  it("onset is any lane's engine hit that passed the gate, whatever frame.onset says", () => {
    const clock = createAnimClock();
    expect(clock.advance(DT, frame({ onset: true })).onset).toBe(false);
    expect(clock.advance(DT, frame({ engine: HIT({ hat: 1.3 }) })).onset).toBe(true);
    const shut: SilenceGateMarks = { closed: 0.5, open: 0.6 };
    expect(clock.advance(DT, frame({ engine: HIT({ kick: 4 }), level: 0 }), undefined, shut).onset).toBe(false);
  });

  it("gates a follower's hit on the level it came in with, not the frame's", () => {
    const marks: SilenceGateMarks = { closed: 0.1, open: 0.3 };
    const follower = frame({ level: 0.05, engine: { ...HIT({ snare: 3 }), hitLevel: 0.6 } });
    expect(createAnimClock().advance(DT, follower, undefined, marks).midOnset).toBe(true);
    expect(createAnimClock().advance(DT, frame({ level: 0.05, engine: HIT({ snare: 3 }) }), undefined, marks).midOnset).toBe(false);
  });

  it("beatRatio is the engine's surge, 0 without a reading", () => {
    const clock = createAnimClock();
    expect(clock.advance(DT, frame({ engine: engineReading({ surge: 0.7 }) })).beatRatio).toBe(0.7);
    expect(clock.advance(DT, frame()).beatRatio).toBe(0);
  });

  it("a graded beatPulse takes the strongest lane hit that passed", () => {
    const shape: HitShape = { amount: 1, knee: 1, loudness: 0, floor: 0, tail: UNIT_TAILS };
    const both = createAnimClock().advance(DT, frame({ engine: HIT({ kick: 1.2, hat: 3 }) }), undefined, undefined, { shape });
    const hatOnly = createAnimClock().advance(DT, frame({ engine: HIT({ hat: 3 }) }), undefined, undefined, { shape });
    expect(both.beatPulse).toBe(hatOnly.beatPulse);
    expect(both.hitStrength.beat.standout).toBeCloseTo(1 - Math.exp(-2), 9);
  });

  // Graded pulse height (src/audio/hitStrength.ts), threaded through
  // advance()'s optional `hit` — see animClock's own doc comment for why an
  // omitted `hit` must reproduce today's flat-1 beatPulse exactly.
  it("omitted `hit` -> beatPulse snaps to exactly 1 on onset (today's behavior)", () => {
    const clock = createAnimClock();
    const anim = clock.advance(DT, frame({ engine: HIT({ kick: 2 }) }));
    expect(anim.beatPulse).toBe(1);
  });

  it("with a shape at amount 1 and loudness 1, beatPulse on onset lands on frame.level", () => {
    const clock = createAnimClock();
    const shape: HitShape = { amount: 1, knee: 1, loudness: 1, floor: 0, tail: UNIT_TAILS };
    const anim = clock.advance(DT, frame({ engine: HIT({ kick: 2 }), level: 0.37 }), undefined, undefined, { shape });
    expect(anim.beatPulse).toBeCloseTo(0.37, 5);
  });

  it("the Beat tail stretches how long beatPulse rings out, and publishes hitTail", () => {
    const decayAfter = (beat: number, low = 1): { pulse: number; hitTail: HitShape["tail"] } => {
      const clock = createAnimClock();
      const shape: HitShape = { ...NEUTRAL_SHAPE, amount: 0, tail: { ...UNIT_TAILS, beat, low } };
      clock.advance(DT, frame({ engine: HIT({ snare: 2 }) }), undefined, undefined, { shape });
      let anim = clock.advance(DT, frame(), undefined, undefined, { shape });
      for (let i = 0; i < 9; i++) anim = clock.advance(DT, frame(), undefined, undefined, { shape });
      return { pulse: anim.beatPulse, hitTail: anim.hitTail };
    };
    const plain = decayAfter(1);
    const long = decayAfter(2);
    const short = decayAfter(0.5);
    expect(plain.hitTail).toEqual(UNIT_TAILS);
    expect(long.hitTail).toEqual({ ...UNIT_TAILS, beat: 0.5 });
    expect(long.pulse).toBeGreaterThan(plain.pulse);
    expect(short.pulse).toBeLessThan(plain.pulse);
    // Twice as long = exactly the square root of what a plain pulse kept.
    expect(long.pulse).toBeCloseTo(Math.sqrt(plain.pulse), 6);
    // Another lane's tail leaves beatPulse alone.
    const lowOnly = decayAfter(1, 4);
    expect(lowOnly.pulse).toBe(plain.pulse);
    expect(lowOnly.hitTail.low).toBe(0.25);
  });

  it("omitted `hit` leaves every lane's hitTail at 1", () => {
    expect(createAnimClock().advance(DT, frame()).hitTail).toEqual(UNIT_TAILS);
  });

  it("hitStrength.low mirrors bandEnergy's own graded hit when a shape is given", () => {
    const clock = createAnimClock();
    const shape: HitShape = { amount: 1, knee: 1, loudness: 0, floor: 0, tail: UNIT_TAILS };
    const anim = clock.advance(DT, frame({ engine: HIT({ kick: 2 }) }), undefined, undefined, { shape });
    expect(anim.hitStrength.low.strength).toBeGreaterThan(0);
    expect(anim.hitStrength.low.strength).toBeLessThanOrEqual(1);
    expect(anim.hitStrength.low.strength).toBe(anim.lowPulse);
  });
});

/** Runs `clock` for `sec` on frames timed from `t0` (the frame clock, offset by
 *  `clockOffset`), the engine hearing `bpm` with beats on whole multiples of
 *  its period and refreshing every UPDATE_FRAMES ticks. Returns the last frame. */
const UPDATE_FRAMES = 10;
function hear(clock: AnimClock, t0: number, sec: number, bpm: number, music = true, clockOffset = 0): AnimFrame {
  const period = 60 / bpm;
  let anim: AnimFrame | null = null;
  const steps = Math.round(sec / DT);
  for (let i = 1; i <= steps; i++) {
    const t = t0 + i * DT;
    const updates = Math.floor((t0 / DT + i) / UPDATE_FRAMES);
    const beatTime = Math.floor(t / period) * period + clockOffset;
    const engine = engineReading({ music, confidence: music ? 0.9 : 0, beatTime, downbeatTime: beatTime, updates });
    anim = clock.advance(DT, frame({ time: t + clockOffset, bpm: music ? bpm : 0, engine }));
  }
  return anim!;
}

describe("the beat clock on the engine's reading", () => {
  it("follows the engine's tempo and beat, and Lock climbs past the metronome's follow line", () => {
    const clock = createAnimClock();
    const anim = hear(clock, 0, 8, 120);
    expect(anim.tempoBpm).toBeCloseTo(120, 6);
    expect(Math.abs(wrapHalf(anim.beatPhase - (8 * 120) / 60))).toBeLessThan(0.02);
    expect(anim.tempoLock).toBeGreaterThan(FOLLOW_LOCK);
  });

  it("with no music: no tempo, the beat holds still, and Lock falls to 0", () => {
    const clock = createAnimClock();
    hear(clock, 0, 8, 120);
    hear(clock, 8, 4, 120, false);
    const still = hear(clock, 12, 0.5, 120, false);
    const later = hear(clock, 12.5, 1, 120, false);
    expect(later.tempoBpm).toBe(0);
    expect(later.beats).toBe(still.beats);
    expect(later.tempoLock).toBeLessThan(0.01);
  });

  it("a frame without a reading leaves the clock still at 0", () => {
    const clock = createAnimClock();
    let anim: AnimFrame | null = null;
    for (let i = 0; i < 120; i++) anim = clock.advance(DT, frame({ time: i * DT, bpm: 0 }));
    expect(anim!.beats).toBe(0);
    expect(anim!.tempoBpm).toBe(0);
    expect(anim!.tempoLock).toBe(0);
  });

  // A TV's frames are on room time, a solo capture's on its AudioContext's;
  // the reading's beat times only count against the frame's own time.
  it("reads beat times against the frame's own clock, wherever that clock starts", () => {
    const solo = hear(createAnimClock(), 0, 6, 128);
    const tv = hear(createAnimClock(), 0, 6, 128, true, 1234.567);
    expect(Math.abs(wrapHalf(tv.beatPhase - solo.beatPhase))).toBeLessThan(1e-6);
  });

  it("tempoLock is the meaning the clock was made with; lockReadings has every meaning", () => {
    for (const lockMeaning of LOCK_MEANINGS) {
      const clock = createAnimClock({ lockMeaning });
      const anim = hear(clock, 0, 3, 120);
      expect(anim.tempoLock, lockMeaning).toBe(clock.lockReadings()[lockMeaning]);
    }
    const clock = createAnimClock();
    const anim = hear(clock, 0, 3, 120);
    expect(anim.tempoLock).toBe(clock.lockReadings().stability);
  });
});
