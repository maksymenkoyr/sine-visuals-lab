import { describe, it, expect } from "vitest";
import {
  createBeatTrimmer,
  BEAT_OFFSET_MAX_MS,
  type BeatTrimmer,
  type BeatTrimSettings,
  type TempoMultiplier,
} from "../src/render/beatTrim.ts";
import { createMetronome, type Metronome } from "../src/render/metronome.ts";
import { TEMPO_SETTLE_SEC } from "../src/render/tempoSettle.ts";
import { METRONOME_BEATS_PER_BAR } from "../src/render/metronome.ts";

const DT = 1 / 60;
const IDENTITY: BeatTrimSettings = { multiplier: 1, offsetMs: 0, resyncSeq: 0 };

/** Same shape as beatClock.ts's own (unexported) wrap01 — see beatTrim.ts's
 *  own duplicate for why this is copied rather than imported. */
function wrap01(x: number): number {
  const w = x % 1;
  return w < 0 ? w + 1 : w;
}

describe("beatTrim identity (no correction requested)", () => {
  it("is bit-identical to the raw input on every call, with ticks matching plain floor crossings", () => {
    const t = createBeatTrimmer();
    // A small deterministic PRNG (no external dependency) for jittery but
    // monotonic bpm/spacing, exercising more than one fixed step size.
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    let inBeats = rand() * 3;
    const r0 = t.advance(inBeats, 120, IDENTITY);
    expect(Object.is(r0.beats, inBeats)).toBe(true);
    expect(Object.is(r0.beatPhase, wrap01(inBeats))).toBe(true);
    expect(Object.is(r0.barPhase, wrap01(inBeats / METRONOME_BEATS_PER_BAR))).toBe(true);
    expect(r0.beatTick).toBe(false); // armed on the very first call — no floor to compare against
    expect(r0.barTick).toBe(false);

    let prevFloor = Math.floor(inBeats);
    let prevBarFloor = Math.floor(inBeats / METRONOME_BEATS_PER_BAR);
    for (let i = 0; i < 2000; i++) {
      const bpm = 100 + rand() * 60;
      inBeats += rand() * 0.05;
      const r = t.advance(inBeats, bpm, IDENTITY);
      expect(Object.is(r.beats, inBeats)).toBe(true);
      expect(Object.is(r.beatPhase, wrap01(inBeats))).toBe(true);
      expect(Object.is(r.barPhase, wrap01(inBeats / METRONOME_BEATS_PER_BAR))).toBe(true);
      expect(Object.is(r.bpm, bpm)).toBe(true);
      const floorNow = Math.floor(inBeats);
      const barFloorNow = Math.floor(inBeats / METRONOME_BEATS_PER_BAR);
      expect(r.beatTick).toBe(floorNow > prevFloor);
      expect(r.barTick).toBe(barFloorNow > prevBarFloor);
      prevFloor = floorNow;
      prevBarFloor = barFloorNow;
    }
  });

  it("a trimmer created after a resync was already requested does not apply it retroactively", () => {
    const t = createBeatTrimmer();
    // resyncSeq already at 5 — as if requestBarResync() had fired 5 times
    // before this trimmer was ever constructed.
    const s: BeatTrimSettings = { multiplier: 1, offsetMs: 0, resyncSeq: 5 };
    const r = t.advance(3.3, 120, s);
    expect(Object.is(r.beats, 3.3)).toBe(true);
    expect(r.beatTick).toBe(false);
    expect(r.barTick).toBe(false);
    // And it stays identity afterward, since resyncSeq never changes again.
    const r2 = t.advance(3.9, 121, s);
    expect(Object.is(r2.beats, 3.9)).toBe(true);
    expect(Object.is(r2.bpm, 121)).toBe(true);
  });
});

describe("beatTrim resync (\"this beat is the 1\")", () => {
  for (const n of [1, 2, 3]) {
    for (const sign of [-1, 1] as const) {
      const pressAt = n + sign * 0.1;
      it(`pressed at beat ${n}${sign > 0 ? "+0.1" : "-0.1"} makes the nearest beat bar-1, beats never run backward`, () => {
        const t = createBeatTrimmer();
        const base: BeatTrimSettings = { multiplier: 1, offsetMs: 0, resyncSeq: 0 };
        let prev = -Infinity;
        for (const x of [0, pressAt / 2, pressAt]) {
          const r = t.advance(x, 120, base);
          expect(r.beats).toBeGreaterThanOrEqual(prev);
          prev = r.beats;
        }
        const resynced: BeatTrimSettings = { ...base, resyncSeq: 1 };
        let r = t.advance(pressAt, 120, resynced);
        expect(r.beats).toBeGreaterThanOrEqual(prev);
        expect(r.beatTick).toBe(false); // the resync tick itself never fires a spurious tick
        expect(r.barTick).toBe(false);
        prev = r.beats;

        // Mirrors advance()'s own resync formula rather than a hard-coded
        // constant, so this test tracks the algorithm, not a magic number:
        // out = in*1 + j (m===1 throughout this test) is a multiple of
        // METRONOME_BEATS_PER_BAR exactly when in === n0, by construction
        // of j itself (advance()'s own resync case) — so the aligned input
        // point doesn't depend on j's actual value, only on n0.
        const n0 = Math.round(pressAt); // === n, since pressAt is within 0.1 of it
        const alignedIn = n0;

        let sawZeroAtTarget = false;
        let sawZeroOneBarLater = false;
        const end = alignedIn + METRONOME_BEATS_PER_BAR + 1;
        const steps = Math.round((end - pressAt) / 0.01);
        for (let i = 0; i <= steps; i++) {
          const x = pressAt + i * 0.01;
          r = t.advance(x, 120, resynced);
          expect(r.beats).toBeGreaterThanOrEqual(prev - 1e-9);
          prev = r.beats;
          if (Math.abs(x - alignedIn) < 0.005) sawZeroAtTarget ||= r.barPhase < 0.02 || r.barPhase > 0.98;
          if (Math.abs(x - (alignedIn + METRONOME_BEATS_PER_BAR)) < 0.005) {
            sawZeroOneBarLater ||= r.barPhase < 0.02 || r.barPhase > 0.98;
          }
        }
        // Pressed just before the beat: that same beat still cleanly
        // becomes bar-1. Pressed just after: it's already gone by, so only
        // the *next* bar boundary (one bar later) lands clean.
        if (alignedIn >= pressAt) expect(sawZeroAtTarget).toBe(true);
        expect(sawZeroOneBarLater).toBe(true);
      });
    }
  }
});

describe("beatTrim tempo multiplier", () => {
  it("×2 doubles bpm, lands whole output beats on every input half-beat, never steps backward", () => {
    const t = createBeatTrimmer();
    t.advance(0, 120, IDENTITY);
    const s: BeatTrimSettings = { ...IDENTITY, multiplier: 2 };
    let prevBeats = -Infinity;
    let ticks = 0;
    for (let i = 0; i <= 40; i++) {
      const inBeats = 10 + i * 0.5; // every input half-beat
      const r = t.advance(inBeats, 120, s);
      expect(r.beats).toBeGreaterThanOrEqual(prevBeats);
      expect(r.bpm).toBe(240);
      expect(Number.isInteger(r.beats)).toBe(true);
      if (r.beatTick) ticks++;
      prevBeats = r.beats;
    }
    expect(ticks).toBe(40); // one per half-beat step, minus the armed switch tick
  });

  it("÷2 halves bpm, lands whole output beats every other input beat (spacing 2), never steps backward", () => {
    const t = createBeatTrimmer();
    t.advance(0, 120, IDENTITY);
    const s: BeatTrimSettings = { ...IDENTITY, multiplier: 0.5 };
    let prevBeats = -Infinity;
    const wholeAtInput: number[] = [];
    for (let i = 0; i <= 20; i++) {
      const inBeats = 10 + i; // every input beat
      const r = t.advance(inBeats, 120, s);
      expect(r.beats).toBeGreaterThanOrEqual(prevBeats);
      expect(r.bpm).toBe(60);
      if (Number.isInteger(r.beats)) wholeAtInput.push(inBeats);
      prevBeats = r.beats;
    }
    expect(wholeAtInput.length).toBeGreaterThanOrEqual(9); // roughly every other beat over 21 samples
    for (let i = 1; i < wholeAtInput.length; i++) {
      expect(wholeAtInput[i]! - wholeAtInput[i - 1]!).toBe(2);
    }
  });

  it("a round trip through every multiplier (1 to 2 to 1 to ½ to 1) never steps beats backward", () => {
    const t = createBeatTrimmer();
    let s: BeatTrimSettings = { ...IDENTITY };
    const sequence: Array<{ mult: TempoMultiplier; holdBeats: number }> = [
      { mult: 1, holdBeats: 4 },
      { mult: 2, holdBeats: 4 },
      { mult: 1, holdBeats: 4 },
      { mult: 0.5, holdBeats: 8 },
      { mult: 1, holdBeats: 4 },
    ];
    let inBeats = 0;
    let prevBeats = -Infinity;
    for (const { mult, holdBeats } of sequence) {
      s = { ...s, multiplier: mult };
      const steps = Math.round(holdBeats / 0.05);
      for (let i = 0; i < steps; i++) {
        inBeats += 0.05;
        const r = t.advance(inBeats, 120, s);
        expect(r.beats).toBeGreaterThanOrEqual(prevBeats);
        prevBeats = r.beats;
      }
    }
  });
});

describe("beatTrim nudge", () => {
  it("a +100ms offset at 120 BPM shifts phase forward by exactly 0.2 beat", () => {
    const t = createBeatTrimmer();
    const s: BeatTrimSettings = { ...IDENTITY, offsetMs: 100 };
    const r = t.advance(10, 120, s);
    expect(r.beats).toBeCloseTo(10.2, 12);
  });

  it("clamps to BEAT_OFFSET_MAX_MS either way and never fires a tick a later nudge just crossed back under", () => {
    const t = createBeatTrimmer();
    t.advance(9.9, 120, IDENTITY);
    const atTick = t.advance(10.01, 120, IDENTITY);
    expect(atTick.beatTick).toBe(true);

    // A "later" nudge right after: outF would fall back under the beat it
    // just crossed without the running-max clamp on tick detection.
    const later: BeatTrimSettings = { ...IDENTITY, offsetMs: -50 };
    const afterNudge = t.advance(10.02, 120, later);
    expect(afterNudge.beatTick).toBe(false); // the clamp protects the tick...
    expect(afterNudge.beats).toBeLessThan(atTick.beats); // ...but not the raw phase, by design

    const maxed: BeatTrimSettings = { ...IDENTITY, offsetMs: -99999 };
    expect(Math.abs(maxed.offsetMs) > BEAT_OFFSET_MAX_MS).toBe(true); // sanity on the fixture itself
  });
});

describe("beatTrim adoptFrom/rearm", () => {
  it("adoptFrom copies another trimmer's anchor; rearm suppresses the adoption tick", () => {
    const source = createBeatTrimmer();
    source.advance(0, 120, IDENTITY);
    source.advance(3.1, 120, IDENTITY);
    const resynced: BeatTrimSettings = { ...IDENTITY, resyncSeq: 1 };
    const afterResync = source.advance(3.1, 120, resynced);

    const target = createBeatTrimmer();
    target.advance(0, 120, IDENTITY); // bootstrapped independently, no resync of its own
    target.adoptFrom(source);
    target.rearm();
    const adopted = target.advance(3.1, 120, resynced);
    expect(adopted.barPhase).toBeCloseTo(afterResync.barPhase, 9);
    expect(adopted.beatTick).toBe(false);
    expect(adopted.barTick).toBe(false);

    // Continuing forward, the target now ticks exactly where the source
    // does — the adopted anchor, not just this one instant, matches.
    for (let i = 1; i <= 20; i++) {
      const x = 3.1 + i * 0.1;
      const rs = source.advance(x, 120, resynced);
      const rt = target.advance(x, 120, resynced);
      expect(rt.beatTick).toBe(rs.beatTick);
      expect(rt.beats).toBeCloseTo(rs.beats, 9);
    }
  });
});

describe("metronome trimmer wiring mirrors animClock.ts's own pattern (identity)", () => {
  it("ticks and beats match the raw metronome's own beatTick/barTick/beats exactly through start/stop/restart", () => {
    const metronome: Metronome = createMetronome();
    const clockTrim: BeatTrimmer = createBeatTrimmer();
    const metroTrim: BeatTrimmer = createBeatTrimmer();
    const s: BeatTrimSettings = { ...IDENTITY };
    let wasRunning = false;
    // Stands in for beatClock.ts's own `beats` — free-running and NEVER
    // reset (see its own doc comment) — across the whole test, including
    // through an idle stretch and a restart. A fixture that reset this on
    // every settle phase (matching metronome.test.ts's own single-start
    // convention) would make the raw metronome itself jump *backward* on
    // restart (metronome.ts's own `beats = clock.beats` adoption), which
    // real beatClock.beats can never do — not a scenario this wiring needs
    // to survive.
    let fakeClockBeats = 0;

    function tick(bpm: number, tempoLock: number, rawBpm: number): void {
      fakeClockBeats += DT * (bpm > 0 ? bpm / 60 : 0);
      const clockInput = { bpm, beats: fakeClockBeats, tempoLock };
      metronome.advance(DT, clockInput, rawBpm);
      clockTrim.advance(fakeClockBeats, bpm, s);
      if (metronome.running && !wasRunning) {
        metroTrim.adoptFrom(clockTrim);
        metroTrim.rearm();
      }
      const mt = metroTrim.advance(metronome.beats, metronome.bpm, s);
      wasRunning = metronome.running;
      expect(Object.is(mt.beats, metronome.beats)).toBe(true);
      expect(mt.beatTick).toBe(metronome.beatTick);
      expect(mt.barTick).toBe(metronome.barTick);
    }

    const settleSteps = Math.round((TEMPO_SETTLE_SEC * 1.5) / DT);
    const runSteps = Math.round(3 / DT);

    for (let i = 0; i < settleSteps; i++) tick(120, 1, 120);
    expect(metronome.running).toBe(true);
    for (let i = 0; i < runSteps; i++) tick(120, 1, 120);

    for (let i = 0; i < settleSteps; i++) tick(0, 0, 0);
    expect(metronome.running).toBe(false);

    for (let i = 0; i < settleSteps; i++) tick(140, 1, 140);
    expect(metronome.running).toBe(true);
    for (let i = 0; i < runSteps; i++) tick(140, 1, 140);
  });
});
