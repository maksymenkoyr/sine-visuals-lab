// A real metronome: always evenly spaced at the song's tempo, always lined
// up with its beats. Sits one layer above beatClock.ts/gridPulse.ts, fixing
// two things that made the Rhythm card's "Beat" jack (the beat grid) an
// unconvincing metronome:
//   - gridPulse.ts only switches onto the clock's own beat lines once
//     tempoLock clears GRID_LOCK_ON — below that line it passes the raw
//     detected hits (AnimFrame.onset) straight through, which is exactly
//     the uneven pulse a metronome must never show.
//   - beatClock.ts's own phase tracks every change in the tracker's tempo
//     estimate and stalls the instant bpm drops to 0 (a breakdown, a beat of
//     silence) — useful for the tracker itself, wrong for something a user
//     wants to keep counting along with.
//
// The fix is a flywheel: once this adopts a tempo, it keeps spinning at that
// tempo on its own, and only ever nudges itself toward the clock while the
// clock is confident (tempoLock at/above FOLLOW_LOCK). The instant the clock
// stops being confident, every correction stops too — the metronome free-runs
// at whatever bpm it last held, rather than falling back to raw hits
// (gridPulse.ts's behaviour) or drifting/stalling with the clock
// (beatClock.ts's own beatPhase). It only ever stops on its own terms (see
// STOP_AFTER_SEC/UNSURE_STOP_SEC below), never because a single beat went
// missing.
//
// This is deliberately a separate module from the Beat grid: gridPulse.ts's
// job is still "the tracker's beat when it's sure, the raw hits when it
// isn't" (see that file's own header) — a source for scenes that want to
// react to what's actually landing. This module's job is "a steady tick
// that never wavers" — a source for scenes that want to *keep time*. Neither
// replaces the other; src/render/signals.ts exposes both.

/** What this reads off beatClock.ts each tick — its smoothed bpm, its own
 *  unwrapped beat count, and tempoLock, the confidence the metronome gates
 *  every correction on. */
export interface MetronomeClockInput {
  bpm: number;
  beats: number;
  tempoLock: number;
}

export interface Metronome {
  /** False until the metronome has adopted a tempo, and again once it lets
   *  go (see STOP_AFTER_SEC/UNSURE_STOP_SEC) — never flips back on its own;
   *  only a fresh adoption (START_LOCK) restarts it. */
  readonly running: boolean;
  /** The tempo it's actually ticking at — held steady between corrections,
   *  0 while idle. Not the same object as `clock.bpm`, which keeps moving
   *  under it. */
  readonly bpm: number;
  /** Unwrapped beat count, free-running like beatClock's own `beats` —
   *  advances only while running, frozen while idle. */
  readonly beats: number;
  /** [0,1) position within the current beat. */
  readonly beatPhase: number;
  /** [0,1) position within the current bar, METRONOME_BEATS_PER_BAR beats. */
  readonly barPhase: number;
  /** 0..1, eases toward 1 while running and toward 0 while idle — a level
   *  for anything that wants to fade the metronome in/out rather than snap
   *  it, e.g. Beat wave/Bar wave riding this instead of a hard on/off. */
  readonly level: number;
  /** One-shot: true only on the advance() call whose beats crossed a whole
   *  beat while running. Never true on the tick that adopts a tempo, or the
   *  tick a re-sync jumps the phase (both arm silently — see advance()'s own
   *  doc). */
  readonly beatTick: boolean;
  /** One-shot, same rule as beatTick, on a METRONOME_BEATS_PER_BAR-beat
   *  boundary. */
  readonly barTick: boolean;
  /** Advances by dtSec. `clock` is beatClock's own reading this tick;
   *  `rawBpm` is the tracker's *unsmoothed* bpm (FeatureFrame.bpm passed
   *  through — AnimFrame.bpm), which actually reaches 0 once the tracker
   *  has released the tempo after silence, unlike beatClock's own smoothed
   *  `bpm` — see STOP_AFTER_SEC below for why this module reads that one
   *  instead. Call once per render tick, same placement as beatClock's own
   *  advance(). */
  advance(dtSec: number, clock: MetronomeClockInput, rawBpm: number): void;
}

/** How many beats make a bar, for barPhase/barTick — matches beatClock.ts's
 *  own (unexported) BEATS_PER_BAR. */
export const METRONOME_BEATS_PER_BAR = 4;

// ---- Idle -> running -----------------------------------------------------
// tempoLock the clock has to clear before the metronome trusts it enough to
// adopt its tempo/beat line. Tunable 0.45-0.6: raising it makes a fresh lock
// wait longer (fewer false starts on a noisy intro); lowering it starts
// sooner but risks adopting a tempo the comb hasn't actually settled on yet.
export const START_LOCK = 0.5;

// ---- Corrections while running -------------------------------------------
// tempoLock the clock has to hold for the metronome to accept *any*
// correction at all — below this it free-runs untouched (the flywheel).
// Deliberately the same value as START_LOCK today (one "is the clock worth
// listening to" line), but a separate constant since nothing here requires
// them to move together.
export const FOLLOW_LOCK = 0.5;
// Phase correction while confident: how fast the beat-line error (clock.beats
// - beats, wrapped to the nearest whole beat) is folded in, and the hard cap
// on how much that can move `beats` in one second — beats/s, so
// PHASE_FOLLOW_MAX_RATE is a slew rate, not a fraction. Kept far below
// BPM_MIN/60 (~1.17 beats/s) so adding/subtracting it from the tempo's own
// beats/s advance can never make `beats` run backward — see the interface
// doc's monotonic note and tests/metronome.test.ts's own assertion.
export const PHASE_FOLLOW_RATE = 2;
export const PHASE_FOLLOW_MAX_RATE = 0.25; // beats/s
// Tempo follow while confident: only actually pulls `bpm` toward clock.bpm
// while the two are already close (within RESYNC_RATIO) — see the re-sync
// paragraph below for what happens when they're not.
export const TEMPO_FOLLOW_RATE = 1;
// How far clock.bpm can drift from the metronome's own held bpm (as a
// fraction of that held bpm) before it's treated as "a different tempo" —
// below this, TEMPO_FOLLOW_RATE quietly tracks it; at/above it, the re-sync
// timer below starts running instead.
export const RESYNC_RATIO = 0.06;
// How long a confident tempo has to sit outside RESYNC_RATIO, continuously,
// before the metronome actually jumps to it — long enough that a passing
// half-tempo/double-tempo comb flicker never re-syncs the metronome, short
// enough that a real tempo change (a DJ mix, a genuinely different section)
// catches up in a few bars.
export const RESYNC_SEC = 2;

// ---- Running -> idle ------------------------------------------------------
// Stops STOP_AFTER_SEC after the tracker's own *raw* bpm (not the clock's
// smoothed one, which lags behind on its own decay) has read 0 — silence, or
// a track that's ended. Also stops after tempoLock has sat below UNSURE_LOCK
// for UNSURE_STOP_SEC straight — a tempo the tracker has been unsure about
// for a long stretch (not just one bad bar) rather than briefly. Tunable
// 8-16: raising UNSURE_STOP_SEC keeps the flywheel spinning longer through a
// rough patch; lowering it lets go sooner once the tracker looks lost.
export const STOP_AFTER_SEC = 1.5;
export const UNSURE_LOCK = 0.1;
export const UNSURE_STOP_SEC = 12;

// ---- Level ------------------------------------------------------------
export const LEVEL_RISE_RATE = 2; // 1/s, while running
export const LEVEL_FALL_RATE = 3; // 1/s, while idle

/** Wraps into [-0.5, 0.5) — the signed distance to the nearest whole beat.
 *  Same shape as beatClock.ts's own (unexported) wrapHalf. */
function wrapHalf(x: number): number {
  const w = (((x + 0.5) % 1) + 1) % 1;
  return w - 0.5;
}

function wrap01(x: number): number {
  const w = x % 1;
  return w < 0 ? w + 1 : w;
}

export function createMetronome(): Metronome {
  let running = false;
  let bpm = 0;
  let beats = 0;
  let level = 0;
  let lastBeatFloor = 0;
  let lastBarFloor = 0;
  let resyncTimer = 0;
  let rawBpmZeroTimer = 0;
  let unsureTimer = 0;

  // Arms tick detection against the *current* `beats` without emitting one —
  // called on adoption and on a re-sync jump, both of which move `beats`
  // (or assign it fresh) and must never count that move itself as a tick.
  function armTickDetection(): void {
    lastBeatFloor = Math.floor(beats);
    lastBarFloor = Math.floor(beats / METRONOME_BEATS_PER_BAR);
  }

  const metronome: Metronome = {
    running: false,
    bpm: 0,
    beats: 0,
    beatPhase: 0,
    barPhase: 0,
    level: 0,
    beatTick: false,
    barTick: false,
    advance(dtSec: number, clock: MetronomeClockInput, rawBpm: number): void {
      let beatTick = false;
      let barTick = false;

      if (!running) {
        if (clock.tempoLock >= START_LOCK && clock.bpm > 0) {
          running = true;
          bpm = clock.bpm;
          beats = clock.beats;
          armTickDetection();
          resyncTimer = 0;
          rawBpmZeroTimer = 0;
          unsureTimer = 0;
        }
      } else {
        beats += dtSec * (bpm / 60);

        if (clock.tempoLock >= FOLLOW_LOCK) {
          const err = wrapHalf(clock.beats - beats);
          const rawStep = err * PHASE_FOLLOW_RATE * dtSec;
          const cap = PHASE_FOLLOW_MAX_RATE * dtSec;
          beats += Math.max(-cap, Math.min(cap, rawStep));

          const ratioDev = bpm > 0 ? Math.abs(clock.bpm / bpm - 1) : 0;
          if (ratioDev <= RESYNC_RATIO) {
            bpm += (clock.bpm - bpm) * Math.min(1, TEMPO_FOLLOW_RATE * dtSec);
            resyncTimer = 0;
          } else {
            resyncTimer += dtSec;
            if (resyncTimer >= RESYNC_SEC) {
              bpm = clock.bpm;
              beats += wrapHalf(clock.beats - beats);
              resyncTimer = 0;
              armTickDetection();
            }
          }
        } else {
          resyncTimer = 0;
        }

        rawBpmZeroTimer = rawBpm > 0 ? 0 : rawBpmZeroTimer + dtSec;
        unsureTimer = clock.tempoLock < UNSURE_LOCK ? unsureTimer + dtSec : 0;

        if (rawBpmZeroTimer >= STOP_AFTER_SEC || unsureTimer >= UNSURE_STOP_SEC) {
          running = false;
          bpm = 0;
        } else {
          const beatFloor = Math.floor(beats);
          if (beatFloor > lastBeatFloor) beatTick = true;
          lastBeatFloor = beatFloor;
          const barFloor = Math.floor(beats / METRONOME_BEATS_PER_BAR);
          if (barFloor > lastBarFloor) barTick = true;
          lastBarFloor = barFloor;
        }
      }

      const levelRate = running ? LEVEL_RISE_RATE : LEVEL_FALL_RATE;
      level += ((running ? 1 : 0) - level) * Math.min(1, levelRate * dtSec);

      (metronome as { running: boolean }).running = running;
      (metronome as { bpm: number }).bpm = bpm;
      (metronome as { beats: number }).beats = beats;
      (metronome as { beatPhase: number }).beatPhase = wrap01(beats);
      (metronome as { barPhase: number }).barPhase = wrap01(beats / METRONOME_BEATS_PER_BAR);
      (metronome as { level: number }).level = level;
      (metronome as { beatTick: boolean }).beatTick = beatTick;
      (metronome as { barTick: boolean }).barTick = barTick;
    },
  };

  return metronome;
}
