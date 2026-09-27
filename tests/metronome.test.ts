import { describe, it, expect } from "vitest";
import {
  createMetronome,
  METRONOME_BEATS_PER_BAR,
  FOLLOW_LOCK,
  PHASE_SNAP_BEATS,
  type Metronome,
  type MetronomeClockInput,
} from "../src/render/metronome.ts";
import { TEMPO_SETTLE_SEC } from "../src/render/tempoSettle.ts";

const DT = 1 / 60;

/** Steps `m` for `sec` seconds at DT, calling `clockAt(tSec)` for each
 *  tick's own MetronomeClockInput and `rawBpmAt(tSec)` for its rawBpm —
 *  both given the elapsed time *before* this tick's own advance, matching
 *  how a real caller would read the clock ahead of calling advance(). */
function run(
  m: Metronome,
  sec: number,
  clockAt: (t: number) => MetronomeClockInput,
  rawBpmAt: (t: number) => number = (t) => clockAt(t).bpm,
): { beatTicks: number[]; barTicks: number[] } {
  const beatTicks: number[] = [];
  const barTicks: number[] = [];
  let t = 0;
  const steps = Math.round(sec / DT);
  for (let i = 0; i < steps; i++) {
    m.advance(DT, clockAt(t), rawBpmAt(t));
    if (m.beatTick) beatTicks.push(t);
    if (m.barTick) barTicks.push(t);
    t += DT;
  }
  return { beatTicks, barTicks };
}

/** Wrapped distance between two beat counts to the nearest whole beat. */
function wrapDist(a: number, b: number): number {
  const w = (((a - b + 0.5) % 1) + 1) % 1;
  return Math.abs(w - 0.5);
}

describe("metronome", () => {
  it("starts as soon as tempoSettle has a value, independent of the clock's own lock", () => {
    const m = createMetronome();
    let startedAt = -1;
    let t = 0;
    const steps = Math.round((TEMPO_SETTLE_SEC * 2) / DT);
    for (let i = 0; i < steps; i++) {
      // The clock itself is never confident and its own beats meaningless —
      // only rawBpm (what tempoSettle.ts reads) should matter to starting.
      m.advance(DT, { bpm: 0, beats: 0, tempoLock: 0 }, 120);
      if (m.running && startedAt < 0) startedAt = t;
      t += DT;
    }
    expect(startedAt).toBeGreaterThan(0);
    expect(startedAt).toBeLessThanOrEqual(TEMPO_SETTLE_SEC);
    expect(m.bpm).toBeCloseTo(120, 3);
  });

  it("ticks evenly at the settled tempo, every interval within one frame of 60/bpm", () => {
    const m = createMetronome();
    run(m, TEMPO_SETTLE_SEC * 1.3, () => ({ bpm: 120, beats: 0, tempoLock: 0 }), () => 120);
    expect(m.running).toBe(true);
    expect(m.bpm).toBeCloseTo(120, 3);

    const { beatTicks } = run(m, 4, () => ({ bpm: 120, beats: m.beats, tempoLock: 0 }), () => 120);
    expect(beatTicks.length).toBeGreaterThan(4);
    for (let i = 1; i < beatTicks.length; i++) {
      expect(Math.abs(beatTicks[i]! - beatTicks[i - 1]! - 0.5)).toBeLessThanOrEqual(DT + 1e-9);
    }
  });

  it("stops once tempoSettle's own value reads 0", () => {
    const m = createMetronome();
    run(m, TEMPO_SETTLE_SEC * 1.3, () => ({ bpm: 120, beats: 0, tempoLock: 1 }), () => 120);
    expect(m.running).toBe(true);

    let stoppedAt = -1;
    let t = 0;
    const steps = Math.round((TEMPO_SETTLE_SEC * 1.5) / DT);
    for (let i = 0; i < steps; i++) {
      m.advance(DT, { bpm: 0, beats: m.beats, tempoLock: 0 }, 0);
      if (!m.running && stoppedAt < 0) stoppedAt = t;
      t += DT;
    }
    expect(stoppedAt).toBeGreaterThan(0);
    expect(stoppedAt).toBeLessThanOrEqual(TEMPO_SETTLE_SEC * 1.5);
    expect(m.bpm).toBe(0);
  });

  it("a settled tempo change retimes without a tick glitch", () => {
    const m = createMetronome();
    run(m, TEMPO_SETTLE_SEC * 1.3, () => ({ bpm: 120, beats: 0, tempoLock: 1 }), () => 120);
    expect(m.bpm).toBeCloseTo(120, 3);

    // An independent clock (not fed back from m.beats itself, which would
    // read one tick stale and manufacture a spurious phase error) at the
    // same tempo and already-adopted phase.
    let beforeBeats = m.beats;
    let beforeLastT = 0;
    const before = run(
      m,
      2,
      (t) => {
        beforeBeats += ((t - beforeLastT) * 120) / 60;
        beforeLastT = t;
        return { bpm: 120, beats: beforeBeats, tempoLock: 1 };
      },
      () => 120,
    );
    for (let i = 1; i < before.beatTicks.length; i++) {
      expect(before.beatTicks[i]! - before.beatTicks[i - 1]!).toBeCloseTo(0.5, 2);
    }

    // A sustained change to 140bpm — tempoSettle needs a full TEMPO_SETTLE_SEC
    // window before it adopts; watch every tick across the whole transition
    // for a doubled or missing tick at the jump.
    let sustainedBeats = m.beats;
    let lastT = 0;
    const { beatTicks } = run(
      m,
      TEMPO_SETTLE_SEC * 1.5 + 3,
      (t) => {
        sustainedBeats += ((t - lastT) * 140) / 60;
        lastT = t;
        return { bpm: 140, beats: sustainedBeats, tempoLock: 1 };
      },
      () => 140,
    );
    expect(m.bpm).toBeCloseTo(140, 1);
    const tail = beatTicks.slice(-4);
    expect((tail[tail.length - 1]! - tail[0]!) / (tail.length - 1)).toBeCloseTo(60 / 140, 2);
    for (let i = 1; i < beatTicks.length; i++) {
      const gap = beatTicks[i]! - beatTicks[i - 1]!;
      expect(gap).toBeGreaterThan(0.1);
      expect(gap).toBeLessThan(1.2);
    }
  });

  it("flywheel: keeps a constant interval while lock drops to 0", () => {
    const m = createMetronome();
    run(m, TEMPO_SETTLE_SEC * 1.3, () => ({ bpm: 120, beats: 0, tempoLock: 1 }), () => 120);
    expect(m.running).toBe(true);
    expect(m.bpm).toBeCloseTo(120, 3);

    // Lock collapses to 0 and the clock's own bpm/beats wander arbitrarily
    // underneath — rawBpm keeps tempoSettle's own target at 120, so nothing
    // here should move bpm or bend beats toward this nonsense clock.
    let fakeBeats = 0;
    const { beatTicks } = run(
      m,
      5,
      () => {
        fakeBeats += 3; // nonsense, unrelated to any real tempo
        return { bpm: 200, beats: fakeBeats, tempoLock: 0 };
      },
      () => 120,
    );
    expect(m.running).toBe(true);
    expect(m.bpm).toBeCloseTo(120, 3);

    expect(beatTicks.length).toBeGreaterThan(5);
    for (let i = 1; i < beatTicks.length; i++) {
      expect(beatTicks[i]! - beatTicks[i - 1]!).toBeCloseTo(0.5, 2);
    }
  });

  it("follows the clock's phase while locked and the tempos agree", () => {
    const m = createMetronome();
    run(m, TEMPO_SETTLE_SEC * 1.3, () => ({ bpm: 120, beats: 0, tempoLock: 1 }), () => 120);
    expect(m.running).toBe(true);

    // An independent clock at the same 120bpm, permanently 0.3 beat ahead in
    // phase — confident and agreeing on tempo, so the metronome should slew
    // its own phase toward it over time.
    let clockBeats = m.beats + 0.3;
    let lastT = 0;
    run(
      m,
      20,
      (t) => {
        clockBeats += ((t - lastT) * 120) / 60;
        lastT = t;
        return { bpm: 120, beats: clockBeats, tempoLock: 1 };
      },
      () => 120,
    );
    expect(wrapDist(clockBeats, m.beats)).toBeLessThan(0.02);
  });

  for (const offset of [0.4, -0.4]) {
    it(`corrects a ${offset > 0 ? "behind" : "ahead"} phase once, the first time the clock is sure, with no double tick — then only slews`, () => {
      const m = createMetronome();
      // Starts while the clock is unsure, so it keeps its own phase.
      let clockBeats = 0;
      let lastT = 0;
      let lock = 0;
      let shift = 0;
      const clock = (t: number): MetronomeClockInput => {
        clockBeats += ((t - lastT) * 120) / 60 + shift;
        shift = 0;
        lastT = t;
        return { bpm: 120, beats: clockBeats, tempoLock: lock };
      };
      run(m, TEMPO_SETTLE_SEC * 1.3, clock, () => 120);
      expect(m.running).toBe(true);
      const offBy = () => wrapDist(clockBeats, m.beats);
      expect(offBy()).toBeLessThan(0.02);
      // Knock the clock off the metronome's line by more than the snap
      // threshold, and let it turn sure.
      shift = offset;
      lock = 1;
      expect(Math.abs(offset)).toBeGreaterThan(PHASE_SNAP_BEATS);
      const t0 = lastT + DT;
      let prevBeats = m.beats;
      const ticks: number[] = [];
      for (let i = 0; i < 3 / DT; i++) {
        const t = t0 + i * DT;
        m.advance(DT, clock(t), 120);
        expect(m.beats).toBeGreaterThanOrEqual(prevBeats);
        prevBeats = m.beats;
        if (m.beatTick) ticks.push(t);
      }
      expect(offBy()).toBeLessThan(0.02);
      // One shorter or longer interval at most, never a near-double.
      for (let k = 1; k < ticks.length; k++) {
        const beatsApart = ((ticks[k]! - ticks[k - 1]!) * 120) / 60;
        expect(beatsApart).toBeGreaterThan(0.5);
        expect(beatsApart).toBeLessThan(1.5);
      }
      // A second jump of the clock, while it stays sure, is slewed, not
      // corrected at once.
      shift = 0.4;
      m.advance(DT, clock(lastT + DT), 120);
      expect(offBy()).toBeGreaterThan(0.3);
    });
  }

  it("ignores the clock's phase and tempo while confident but disagreeing on tempo", () => {
    const m = createMetronome();
    run(m, TEMPO_SETTLE_SEC * 1.3, () => ({ bpm: 120, beats: 0, tempoLock: 1 }), () => 120);
    expect(m.bpm).toBeCloseTo(120, 3);

    // Confident (tempoLock=1) but a different tempo (well past RESYNC_RATIO)
    // and an arbitrary phase — rawBpm keeps tempoSettle's own target at 120,
    // so nothing here should move bpm or bend beats toward this clock.
    let fakeBeats = 0;
    const { beatTicks } = run(
      m,
      3,
      () => {
        fakeBeats += 3;
        return { bpm: 200, beats: fakeBeats, tempoLock: 1 };
      },
      () => 120,
    );
    expect(m.bpm).toBeCloseTo(120, 3);
    for (let i = 1; i < beatTicks.length; i++) {
      expect(beatTicks[i]! - beatTicks[i - 1]!).toBeCloseTo(0.5, 2);
    }
  });

  it("beats are monotonic while running, under ordinary (non-resync) corrections", () => {
    const m = createMetronome();
    run(m, TEMPO_SETTLE_SEC * 1.3, () => ({ bpm: 120, beats: 0, tempoLock: 1 }), () => 120);
    let beats = m.beats;
    let prev = m.beats;
    let violated = false;
    for (let i = 0; i < 600; i++) {
      // A small, ever-jittering but always-confident, always-close-to-120bpm
      // clock — close enough to 120 that tempoSettle never adopts a new
      // target, so only the per-tick phase/tempo follow is exercised.
      const bpmNow = 120 + 3 * Math.sin(i * 0.37);
      beats += (DT * bpmNow) / 60;
      m.advance(DT, { bpm: bpmNow, beats, tempoLock: FOLLOW_LOCK + 0.1 }, bpmNow);
      if (m.beats < prev - 1e-9) violated = true;
      prev = m.beats;
    }
    expect(violated).toBe(false);
  });

  it("fires a bar tick exactly every METRONOME_BEATS_PER_BAR beat ticks", () => {
    const m2 = createMetronome();
    // Stop warm-up on the exact tick it adopts — armTickDetection() has
    // just baselined its floors against clock.beats (0 here), so this
    // test's own beatCount%4 bookkeeping starts aligned with the
    // metronome's real absolute beat floor, with no extra advance since.
    for (let i = 0; i < 600 && !m2.running; i++) {
      m2.advance(DT, { bpm: 150, beats: 0, tempoLock: 0 }, 150);
    }
    expect(m2.running).toBe(true);
    let beatCount = 0;
    let barCount = 0;
    let sawMismatch = false;
    for (let i = 0; i < 600; i++) {
      m2.advance(DT, { bpm: 150, beats: 0, tempoLock: 0 }, 150);
      if (m2.beatTick) {
        beatCount++;
        if (beatCount % METRONOME_BEATS_PER_BAR === 0 && !m2.barTick) sawMismatch = true;
      }
      if (m2.barTick) {
        barCount++;
        if (beatCount % METRONOME_BEATS_PER_BAR !== 0) sawMismatch = true;
      }
    }
    expect(beatCount).toBeGreaterThan(METRONOME_BEATS_PER_BAR * 2);
    expect(barCount).toBe(Math.floor(beatCount / METRONOME_BEATS_PER_BAR));
    expect(sawMismatch).toBe(false);
  });

  it("does not react to clock noise before ever starting — only rawBpm/tempoSettle matter", () => {
    const m = createMetronome();
    run(m, 1, () => ({ bpm: 999, beats: 12345, tempoLock: 1 }), () => 0);
    expect(m.running).toBe(false);
    expect(m.bpm).toBe(0);
  });
});
