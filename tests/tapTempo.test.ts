import { beforeEach, describe, expect, it } from "vitest";
import {
  createTapGuide,
  estimateTapTempo,
  fitTaps,
  getTapRun,
  getTapTempo,
  releaseTapTempo,
  tapTempoAt,
  TAP_GAP_SEC,
  TAP_MIN_TAPS,
} from "../src/render/tapTempo.ts";
import { getBeatTrim, nudgeBeatOffset, resetBeatTrim, stepTempoMultiplier } from "../src/render/beatTrim.ts";
import { BPM_MAX, BPM_MIN } from "../src/audio/tempoComb.ts";
import { createAnimClock, type AnimFrame } from "../src/render/animClock.ts";
import { createBeatClock } from "../src/render/beatClock.ts";
import { createMetronome, RESYNC_RATIO } from "../src/render/metronome.ts";
import { createTempoSettle, RETUNE_UNSURE_SEC, TEMPO_SETTLE_SEC } from "../src/render/tempoSettle.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";

const DT = 1 / 60;

/** Seeded jitter in [-amp, amp] — the same small LCG shape the eval synth uses. */
function jitter(seed: number, amp: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 2 ** 32) * 2 * amp - amp;
  };
}

/** `count` taps at `bpm`, the first at `startMs`, each moved by `jit()` ms. */
function steadyTaps(bpm: number, count: number, startMs: number, jit: () => number = () => 0): number[] {
  const beatMs = 60000 / bpm;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(startMs + i * beatMs + jit());
  return out;
}

/** Signed distance from `x` to the nearest whole number. */
function wrapHalf(x: number): number {
  const w = (((x + 0.5) % 1) + 1) % 1;
  return w - 0.5;
}

describe("estimateTapTempo", () => {
  it("needs TAP_MIN_TAPS taps that fit", () => {
    expect(estimateTapTempo(steadyTaps(120, TAP_MIN_TAPS - 1, 1000))).toBeNull();
    expect(estimateTapTempo(steadyTaps(120, TAP_MIN_TAPS, 1000))!.bpm).toBeCloseTo(120, 6);
  });

  it("averages jitter out over the run, and puts the beat on the taps", () => {
    const taps = steadyTaps(128, 8, 5000, jitter(7, 15));
    const est = estimateTapTempo(taps)!;
    expect(est.bpm).toBeGreaterThan(127);
    expect(est.bpm).toBeLessThan(129);
    // The anchor is the fitted latest beat: within the jitter of the true one.
    const trueLast = 5000 + 7 * (60000 / 128);
    expect(Math.abs(est.anchorMs - trueLast)).toBeLessThan(15);
  });

  it("shrugs off a stray tap between two beats (a Ctrl+<key> chord)", () => {
    const beatMs = 60000 / 124;
    const real = steadyTaps(124, 6, 2000, jitter(3, 10));
    const taps = [...real.slice(0, 3), real[2]! + 0.45 * beatMs, ...real.slice(3)];
    const fit = fitTaps(taps);
    expect(fit.kept).toBe(real.length);
    const est = estimateTapTempo(taps)!;
    expect(Math.abs(est.bpm - 124)).toBeLessThan(1);
    expect(Math.abs(est.anchorMs - (2000 + 5 * beatMs))).toBeLessThan(10);
  });

  it("shrugs off a stray first tap, and a skipped beat", () => {
    const beatMs = 60000 / 100;
    const real = steadyTaps(100, 7, 3000);
    const skipped = real.filter((_, i) => i !== 3);
    const taps = [real[0]! - 0.6 * beatMs, ...skipped];
    const est = estimateTapTempo(taps)!;
    expect(est.bpm).toBeCloseTo(100, 6);
    expect(est.anchorMs).toBeCloseTo(real[6]!, 6);
  });

  it("halves or doubles a tempo outside the tracker's range, keeping the beat on a tap", () => {
    const fast = steadyTaps(BPM_MAX + 20, 6, 0);
    const slowBpm = BPM_MIN - 10;
    const slow = steadyTaps(slowBpm, 5, 0);
    const f = estimateTapTempo(fast)!;
    const s = estimateTapTempo(slow)!;
    expect(f.bpm).toBeCloseTo((BPM_MAX + 20) / 2, 6);
    expect(s.bpm).toBeCloseTo(slowBpm * 2, 6);
    expect(f.anchorMs).toBeCloseTo(fast[fast.length - 1]!, 6);
    expect(s.anchorMs).toBeCloseTo(slow[slow.length - 1]!, 6);
  });

  it("clamps a tempo just past an end of the range (the same tempo, tapped a little off)", () => {
    const justFast = BPM_MAX * (1 + RESYNC_RATIO / 2);
    const justSlow = BPM_MIN / (1 + RESYNC_RATIO / 2);
    expect(estimateTapTempo(steadyTaps(justFast, 6, 0))!.bpm).toBe(BPM_MAX);
    expect(estimateTapTempo(steadyTaps(justSlow, 6, 0))!.bpm).toBe(BPM_MIN);
  });
});

describe("the tap store", () => {
  beforeEach(() => {
    releaseTapTempo();
    resetBeatTrim();
  });

  it("counts down to TAP_MIN_TAPS, then takes effect on every tap", () => {
    const taps = steadyTaps(120, TAP_MIN_TAPS + 1, 10000);
    const seq0 = getTapTempo().seq;
    for (let i = 0; i < TAP_MIN_TAPS - 1; i++) {
      const r = tapTempoAt(taps[i]!);
      expect(r.more).toBe(TAP_MIN_TAPS - 1 - i);
      expect(r.bpm).toBe(0);
    }
    expect(getTapTempo().seq).toBe(seq0);
    expect(tapTempoAt(taps[TAP_MIN_TAPS - 1]!).bpm).toBeCloseTo(120, 6);
    expect(getTapTempo().seq).toBe(seq0 + 1);
    tapTempoAt(taps[TAP_MIN_TAPS]!);
    expect(getTapTempo().seq).toBe(seq0 + 2);
    expect(getTapRun(taps[TAP_MIN_TAPS]!)).toEqual({ taps: TAP_MIN_TAPS + 1, more: 0 });
  });

  it("a gap longer than TAP_GAP_SEC starts a new run", () => {
    tapTempoAt(1000);
    tapTempoAt(1500);
    expect(getTapRun(1500)!.taps).toBe(2);
    expect(getTapRun(1500 + TAP_GAP_SEC * 1000 + 1)).toBeNull();
    expect(tapTempoAt(1500 + TAP_GAP_SEC * 1000 + 1).taps).toBe(1);
  });

  it("a tap tempo clears ×2/÷2 and the nudge", () => {
    stepTempoMultiplier(1);
    nudgeBeatOffset(10);
    expect(getBeatTrim().multiplier).toBe(2);
    for (const t of steadyTaps(120, TAP_MIN_TAPS - 1, 20000)) tapTempoAt(t);
    expect(getBeatTrim().multiplier).toBe(2); // not yet: nothing took effect
    tapTempoAt(20000 + (TAP_MIN_TAPS - 1) * 500);
    expect(getBeatTrim()).toMatchObject({ multiplier: 1, offsetMs: 0 });
  });
});

describe("the tap guide", () => {
  beforeEach(() => releaseTapTempo());

  it("adopts the store on its first poll, then hands back the tapped beat's phase", () => {
    for (const t of steadyTaps(120, TAP_MIN_TAPS, 1000)) tapTempoAt(t);
    const guide = createTapGuide();
    expect(guide.poll(5000)).toBeNull(); // tapped before this guide existed
    expect(guide.guided).toBe(false);
    const taps = steadyTaps(120, TAP_MIN_TAPS, 10000);
    for (const t of taps) tapTempoAt(t);
    const at = taps[taps.length - 1]! + 125; // a quarter beat after the last tap
    const seed = guide.poll(at)!;
    expect(seed.bpm).toBeCloseTo(120, 6);
    expect(seed.beatPhase).toBeCloseTo(0.25, 6);
    expect(guide.guided).toBe(true);
    expect(guide.poll(at + 16)).toBeNull(); // only once per tap
  });

  it("folds the tracker's reading onto the tapped tempo from 2×, ½×, 3/2× and 2/3×", () => {
    const guide = createTapGuide();
    guide.poll(0);
    expect(guide.fold(240)).toBe(240); // not guided yet: untouched
    for (const t of steadyTaps(120, TAP_MIN_TAPS, 1000)) tapTempoAt(t);
    guide.poll(4000);
    expect(guide.fold(241)).toBeCloseTo(120.5, 6);
    expect(guide.fold(60)).toBeCloseTo(120, 6);
    expect(guide.fold(180)).toBeCloseTo(120, 6);
    expect(guide.fold(80)).toBeCloseTo(120, 6);
    expect(guide.fold(123)).toBe(123); // drift stays the tracker's own
    expect(guide.fold(100)).toBe(100); // not the tapped tempo in any octave
    expect(guide.fold(0)).toBe(0);
  });

  it("ends once the metronome stops or ticks outside RESYNC_RATIO, and follows it inside", () => {
    const guide = createTapGuide();
    guide.poll(0);
    for (const t of steadyTaps(120, TAP_MIN_TAPS, 1000)) tapTempoAt(t);
    guide.poll(4000);
    guide.follow(true, 121);
    expect(guide.guided).toBe(true);
    expect(guide.fold(242)).toBeCloseTo(121, 6); // the family moved with it
    guide.follow(true, 121 * (1 + RESYNC_RATIO * 2));
    expect(guide.guided).toBe(false);

    for (const t of steadyTaps(120, TAP_MIN_TAPS, 10000)) tapTempoAt(t);
    guide.poll(13000);
    guide.follow(false, 0);
    expect(guide.guided).toBe(false);
  });

  it("releaseTapTempo ends it", () => {
    const guide = createTapGuide();
    guide.poll(0);
    for (const t of steadyTaps(120, TAP_MIN_TAPS, 1000)) tapTempoAt(t);
    guide.poll(4000);
    expect(guide.guided).toBe(true);
    releaseTapTempo();
    expect(guide.poll(4100)).toBeNull();
    expect(guide.guided).toBe(false);
  });
});

describe("the seeds", () => {
  it("tempoSettle.hold holds against a different reading until a retune confirms it", () => {
    const settle = createTempoSettle();
    for (let t = 0; t < 3; t += DT) settle.push(100, DT, 0);
    expect(settle.bpm).toBeCloseTo(100, 6);
    settle.hold(130);
    expect(settle.bpm).toBe(130);
    let moved = -1;
    for (let t = 0; t < RETUNE_UNSURE_SEC + TEMPO_SETTLE_SEC * 2; t += DT) {
      settle.push(100, DT, 0);
      if (moved < 0 && settle.bpm !== 130) moved = t;
    }
    // Unsure the whole time (lock 0): the window refills, then the unsure retune.
    expect(moved).toBeGreaterThanOrEqual(RETUNE_UNSURE_SEC);
    expect(settle.bpm).toBeCloseTo(100, 6);
  });

  it("beatClock.seed takes the tempo and moves the phase the short way", () => {
    const clock = createBeatClock();
    for (let i = 0; i < 100; i++) clock.advance(DT, 120, false);
    const before = clock.beats;
    clock.seed(90, 0.5);
    expect(clock.bpm).toBe(90);
    expect(clock.beatPhase).toBeCloseTo(0.5, 9);
    expect(Math.abs(clock.beats - before)).toBeLessThanOrEqual(0.5);
  });

  it("metronome.seed never runs the count backward: forward at once, or hold still", () => {
    const m = createMetronome();
    const clock = { bpm: 120, beats: 0, tempoLock: 0 };
    for (let t = 0; t < TEMPO_SETTLE_SEC * 2; t += DT) m.advance(DT, clock, 120);
    expect(m.running).toBe(true);

    const behind = m.beats;
    m.seed(120, (((behind % 1) + 0.3) % 1 + 1) % 1, 0); // the tap is 0.3 beat ahead
    m.advance(DT, clock, 120);
    expect(m.beats).toBeCloseTo(behind + 0.3 + DT * 2, 6);

    const ahead = m.beats;
    m.seed(120, (((ahead % 1) - 0.2) % 1 + 1) % 1, 0); // the tap is 0.2 beat behind
    let prev = ahead;
    let held = 0;
    for (let i = 0; i < 30; i++) {
      m.advance(DT, clock, 120);
      expect(m.beats).toBeGreaterThanOrEqual(prev);
      if (m.beats === prev) held++;
      prev = m.beats;
    }
    expect(held * DT * 2).toBeGreaterThanOrEqual(0.2 - DT * 2);
    expect(Math.abs(wrapHalf(m.beats - (ahead - 0.2 + 30 * DT * 2)))).toBeLessThan(1e-6);
  });

  it("metronome.seed starts an idle metronome at once", () => {
    const m = createMetronome();
    m.seed(140, 0.25, 7.25);
    expect(m.running).toBe(true);
    expect(m.bpm).toBe(140);
    m.advance(DT, { bpm: 0, beats: 0, tempoLock: 0 }, 0);
    expect(m.running).toBe(true);
    expect(m.beats).toBeCloseTo(7.25 + DT * (140 / 60), 9);
  });
});

function frame(bpm: number): FeatureFrame {
  return { time: 0, bands: new Float32Array(NUM_BANDS), energy: 0, level: 1, onset: false, pulseOnset: false, bpm, onsetPhase: 0 };
}

describe("animClock with a tap", () => {
  beforeEach(() => {
    releaseTapTempo();
    resetBeatTrim();
  });

  /** Runs `clock` for `sec` at a raw tracker reading of `rawBpm`, tapping
   *  each of `taps` (ms on the same clock) just before the first tick at or
   *  after it. Returns every tick's time and frame. */
  function drive(
    clock: ReturnType<typeof createAnimClock>,
    t0: number,
    sec: number,
    rawBpm: number,
    taps: number[] = [],
  ): { t: number; anim: AnimFrame }[] {
    const out: { t: number; anim: AnimFrame }[] = [];
    let next = 0;
    const steps = Math.round(sec / DT);
    for (let i = 1; i <= steps; i++) {
      const t = t0 + i * DT;
      while (next < taps.length && taps[next]! <= t * 1000) tapTempoAt(taps[next++]!);
      out.push({ t, anim: clock.advance(DT, frame(rawBpm), undefined, undefined, undefined, t * 1000) });
    }
    return out;
  }

  it("takes the tapped tempo and beat at once, holds the octave, and lets go once the tracker retunes elsewhere", () => {
    const clock = createAnimClock();
    // The tracker reads half of what the music is (the slow octave).
    let ticks = drive(clock, 0, 4, 72);
    expect(ticks[ticks.length - 1]!.anim.metronomeBpm).toBeCloseTo(72, 6);

    const taps = steadyTaps(144, TAP_MIN_TAPS, 4200);
    const lastTap = taps[taps.length - 1]!;
    ticks = drive(clock, 4, 16, 72, taps);
    const after = ticks.filter((k) => k.t * 1000 > lastTap);
    const first = after[0]!.anim;
    expect(first.metronomeBpm).toBeCloseTo(144, 6);
    expect(first.tapGuided).toBe(true);
    expect(first.bpm).toBeCloseTo(144, 6); // the raw 72, folded
    // Within one beat of the last tap, the metronome's beat sits on the taps.
    const beatSec = 60 / 144;
    for (const k of after.filter((x) => x.t * 1000 > lastTap + beatSec * 1000)) {
      const expected = (k.t * 1000 - lastTap) / (beatSec * 1000);
      expect(Math.abs(wrapHalf(k.anim.metronomePhase - expected))).toBeLessThan(0.02);
    }
    // Ticks never run backward, and it stays on the tap's octave.
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.anim.metronomeBeats).toBeGreaterThanOrEqual(ticks[i - 1]!.anim.metronomeBeats);
    expect(ticks[ticks.length - 1]!.anim.metronomeBpm).toBeCloseTo(144, 6);
    expect(ticks[ticks.length - 1]!.anim.tapGuided).toBe(true);

    // The music moves to a tempo outside the tap's family: the retune rule
    // moves the metronome, and the guidance ends with it.
    ticks = drive(clock, 20, RETUNE_UNSURE_SEC + TEMPO_SETTLE_SEC * 2, 120);
    const end = ticks[ticks.length - 1]!.anim;
    expect(end.metronomeBpm).toBeCloseTo(120, 6);
    expect(end.tapGuided).toBe(false);
  });

  it("Shift+B (releaseTapTempo) hands the tempo back to the tracker", () => {
    const clock = createAnimClock();
    drive(clock, 0, 4, 72);
    drive(clock, 4, 4, 72, steadyTaps(144, TAP_MIN_TAPS, 4200));
    releaseTapTempo();
    const ticks = drive(clock, 8, RETUNE_UNSURE_SEC + TEMPO_SETTLE_SEC * 2, 72);
    expect(ticks[0]!.anim.tapGuided).toBe(false);
    expect(ticks[ticks.length - 1]!.anim.metronomeBpm).toBeCloseTo(72, 6);
  });

  it("a clock not given tapNowMs never follows a tap", () => {
    const clock = createAnimClock();
    for (let i = 0; i < 240; i++) clock.advance(DT, frame(72));
    for (const t of steadyTaps(144, TAP_MIN_TAPS, 4200)) tapTempoAt(t);
    let anim: AnimFrame | null = null;
    for (let i = 0; i < 60; i++) anim = clock.advance(DT, frame(72));
    expect(anim!.tapGuided).toBe(false);
    expect(anim!.metronomeBpm).toBeCloseTo(72, 6);
  });
});
