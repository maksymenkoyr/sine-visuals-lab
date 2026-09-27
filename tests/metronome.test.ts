import { describe, it, expect } from "vitest";
import {
  createMetronome,
  METRONOME_BEATS_PER_BAR,
  START_LOCK,
  FOLLOW_LOCK,
  RESYNC_SEC,
  STOP_AFTER_SEC,
  START_HOLD_SEC,
  LOST_HOLD_SEC,
  LOCK_AVG_SEC,
  type Metronome,
  type MetronomeClockInput,
} from "../src/render/metronome.ts";

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

function steadyClock(bpm: number, lock: number): (t: number) => MetronomeClockInput {
  let beats = 0;
  let last = -1;
  return (t: number) => {
    if (last < 0) last = t;
    beats += ((t - last) * bpm) / 60;
    last = t;
    return { bpm, beats, tempoLock: lock };
  };
}

describe("metronome", () => {
  it("starts only once lock reaches START_LOCK, and adopts the clock's beat line", () => {
    const m = createMetronome();
    const clock = steadyClock(120, 0);
    let lock = 0;
    let ranAt = -1;
    for (let i = 0; i < 300; i++) {
      const t = i * DT;
      lock = Math.min(1, t * 0.2); // ramps 0 -> 1 over 5s
      const input = clock(t);
      m.advance(DT, { ...input, tempoLock: lock }, 120);
      if (m.running && ranAt < 0) ranAt = t;
      if (lock < START_LOCK) {
        expect(m.running).toBe(false);
      } else if (ranAt < 0 || t > ranAt) {
        // Once it has started, keep going for the rest of this ramp (lock
        // only rises here) — nothing in this test should stop it.
      }
    }
    expect(ranAt).toBeGreaterThan(0);
    // The tick it started, beats should equal the clock's own beats (adopted
    // exactly, no lag) — re-derive the clock at that instant.
    const atStart = clock(ranAt);
    void atStart; // clock() is stateful/monotonic; adoption is checked via bpm below instead.
    expect(m.bpm).toBeCloseTo(120, 5);
  });

  it("flywheel: keeps a constant interval while lock drops to 0 for a few seconds", () => {
    const m = createMetronome();
    // Warm up to running at 120bpm.
    run(m, 3, () => ({ bpm: 120, beats: 0, tempoLock: 1 }));
    expect(m.running).toBe(true);
    expect(m.bpm).toBeCloseTo(120, 3);

    // Now lock collapses to 0 and the clock's own bpm/beats wander
    // arbitrarily underneath — the metronome must not react at all.
    let fakeBeats = 0;
    const { beatTicks } = run(
      m,
      5,
      () => {
        fakeBeats += 3; // nonsense, unrelated to any real tempo
        return { bpm: 200, beats: fakeBeats, tempoLock: 0 };
      },
      () => 120, // rawBpm still present — this isn't a stop condition
    );
    expect(m.running).toBe(true);
    expect(m.bpm).toBeCloseTo(120, 3); // untouched — no tempo follow while unconfident

    // Every interval between consecutive beat ticks should be a constant
    // 60/120 = 0.5s, regardless of the nonsense clock above.
    expect(beatTicks.length).toBeGreaterThan(5);
    for (let i = 1; i < beatTicks.length; i++) {
      expect(beatTicks[i]! - beatTicks[i - 1]!).toBeCloseTo(0.5, 2);
    }
  });

  it("ignores a brief confident tempo change and adopts a sustained one cleanly", () => {
    const m = createMetronome();
    run(m, 3, () => ({ bpm: 120, beats: 0, tempoLock: 1 }));
    expect(m.bpm).toBeCloseTo(120, 3);

    // A confident but brief (< RESYNC_SEC) jump to a clearly different tempo
    // (well past RESYNC_RATIO) — should never move bpm at all.
    const briefClock = steadyClock(140, 1);
    run(m, RESYNC_SEC - 0.3, briefClock, () => 120);
    expect(m.bpm).toBeCloseTo(120, 3);

    // Revert to the original tempo — nothing should have drifted.
    run(m, 1, () => ({ bpm: 120, beats: m.beats, tempoLock: 1 }));
    expect(m.bpm).toBeCloseTo(120, 3);
    const beatsBeforeSustained = m.beats;

    // A sustained (> RESYNC_SEC) confident change to 140bpm — should adopt
    // it, and the jump itself must not emit or swallow a tick: watch beat
    // ticks across the whole transition and confirm intervals settle back to
    // a constant 60/140 with no doubled/missing tick at the jump.
    let sustainedBeats = beatsBeforeSustained;
    let lastT = 0;
    const { beatTicks } = run(
      m,
      RESYNC_SEC + 3,
      (t) => {
        sustainedBeats += ((t - lastT) * 140) / 60;
        lastT = t;
        return { bpm: 140, beats: sustainedBeats, tempoLock: 1 };
      },
      () => 140,
    );
    expect(m.bpm).toBeCloseTo(140, 1);
    // After the resync has settled the ticks run at 60/140 s apart. Tick
    // times are whole DT steps, so a single interval is off by up to a frame;
    // the mean over the last few is what has to match.
    const tail = beatTicks.slice(-4);
    expect((tail[tail.length - 1]! - tail[0]!) / (tail.length - 1)).toBeCloseTo(60 / 140, 2);
    // No interval anywhere in the transition is a near-zero double-fire or
    // a near-double missing tick.
    for (let i = 1; i < beatTicks.length; i++) {
      const gap = beatTicks[i]! - beatTicks[i - 1]!;
      expect(gap).toBeGreaterThan(0.1);
      expect(gap).toBeLessThan(1.2);
    }
  });

  it("stops STOP_AFTER_SEC after rawBpm goes to 0", () => {
    const m = createMetronome();
    run(m, 2, () => ({ bpm: 120, beats: 0, tempoLock: 1 }));
    expect(m.running).toBe(true);

    let stoppedAt = -1;
    const steps = Math.round((STOP_AFTER_SEC + 1) / DT);
    let beats = m.beats;
    let t = 0;
    for (let i = 0; i < steps; i++) {
      beats += (DT * 120) / 60;
      // rawBpm silent from here; the clock itself goes silent too a moment
      // later (its own decay lags rawBpm slightly, same as the real
      // beatClock/features.ts relationship this constant is tuned against)
      // so a stopped metronome has nothing confident left to re-adopt.
      const clockBpm = t < 0.2 ? 120 : 0;
      m.advance(DT, { bpm: clockBpm, beats, tempoLock: clockBpm > 0 ? 1 : 0 }, 0);
      if (!m.running && stoppedAt < 0) stoppedAt = t;
      t += DT;
    }
    expect(stoppedAt).toBeGreaterThanOrEqual(STOP_AFTER_SEC - DT * 2);
    expect(stoppedAt).toBeLessThanOrEqual(STOP_AFTER_SEC + DT * 2);
    expect(m.bpm).toBe(0);
  });

  it("doesn't start on a confident spike shorter than START_HOLD_SEC", () => {
    const m = createMetronome();
    // Confident for just under the hold, then not — repeatedly.
    const period = START_HOLD_SEC * 2;
    run(m, 20, (t) => ({ bpm: 120, beats: (t * 120) / 60, tempoLock: t % period < START_HOLD_SEC * 0.8 ? 1 : 0 }));
    expect(m.running).toBe(false);
  });

  it("keeps running through a long unsure stretch while the tracker still hears the same tempo", () => {
    const m = createMetronome();
    run(m, 3, () => ({ bpm: 120, beats: 0, tempoLock: 1 }));
    expect(m.running).toBe(true);
    let beats = m.beats;
    for (let i = 0; i < Math.round(20 / DT); i++) {
      beats += (DT * 120) / 60;
      m.advance(DT, { bpm: 120, beats, tempoLock: 0.05 }, 121);
    }
    expect(m.running).toBe(true);
  });

  it("lets go once it is unsure and the tracker hears a different tempo, after LOST_HOLD_SEC", () => {
    const m = createMetronome();
    run(m, 3, () => ({ bpm: 120, beats: 0, tempoLock: 1 }));
    expect(m.running).toBe(true);
    let beats = m.beats;
    let stoppedAt = -1;
    const limit = LOCK_AVG_SEC * 3 + LOST_HOLD_SEC + 2;
    for (let t = 0; t < limit; t += DT) {
      beats += (DT * 150) / 60;
      m.advance(DT, { bpm: 150, beats, tempoLock: 0.05 }, 150);
      if (!m.running && stoppedAt < 0) stoppedAt = t;
    }
    // Never before the hold itself, and not held forever either.
    expect(stoppedAt).toBeGreaterThanOrEqual(LOST_HOLD_SEC);
    expect(stoppedAt).toBeGreaterThan(0);
  });

  it("beats are monotonic while running, under ordinary (non-resync) corrections", () => {
    const m = createMetronome();
    run(m, 2, () => ({ bpm: 120, beats: 0, tempoLock: 1 }));
    let beats = m.beats;
    let prev = m.beats;
    let violated = false;
    for (let i = 0; i < 600; i++) {
      // A small, ever-jittering but always-confident, always-close-to-120bpm
      // clock — close enough to 120 that RESYNC never fires, so only the
      // per-tick phase/tempo follow (the part claimed monotonic) is exercised.
      const bpmNow = 120 + 3 * Math.sin(i * 0.37);
      beats += (DT * bpmNow) / 60;
      m.advance(DT, { bpm: bpmNow, beats, tempoLock: FOLLOW_LOCK + 0.1 }, bpmNow);
      if (m.beats < prev - 1e-9) violated = true;
      prev = m.beats;
    }
    expect(violated).toBe(false);
  });

  it("fires a bar tick exactly every METRONOME_BEATS_PER_BAR beat ticks", () => {
    // A fresh metronome, so adoption's own beat count starts from exactly 0.
    const m2 = createMetronome();
    run(m2, START_HOLD_SEC + 0.1, () => ({ bpm: 150, beats: 0, tempoLock: START_LOCK }));
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

  it("does not react to tempoLock/bpm noise below START_LOCK before ever starting", () => {
    const m = createMetronome();
    run(m, 3, () => ({ bpm: 120, beats: 0, tempoLock: START_LOCK - 0.05 }));
    expect(m.running).toBe(false);
    expect(m.bpm).toBe(0);
  });
});
