import { createTempoSettle } from "./tempoSettle.ts";

// The metronome *is* the BPM card's number, ticking: evenly spaced at
// exactly the tempo audioMeters.ts's BPM card shows, silent whenever that
// card reads "--". The user asked for this directly — looking at the old
// Rhythm card: "we already have bpm. can we pull metronome from it" — after
// the old confidence-gated start (tempoLock held above a line for a while
// before this would run at all) left the Metronome on "--" for long
// stretches while the BPM card, right beside it, already had a number.
// tempoSettle.ts is the one settle rule both now read, so they can't
// disagree by construction; see that file's header for the rule itself.
//
// What this trades away: it ticks whenever the BPM card shows a number,
// including on music where that number is only ever a guess (a beatless
// pad, a loose room recording) — same as the card itself already does. It
// is not a claim that the tempo is *right*, only that it's the same number
// the user is already looking at.
//
// Once it has a tempo, this is still a flywheel: `beats` advances on its
// own every tick at whatever `bpm` currently is, and only ever nudges
// toward beatClock's own phase/tempo while beatClock is sure (tempoLock at
// or above FOLLOW_LOCK) *and* beatClock's own bpm still agrees with this
// module's (within RESYNC_RATIO) — the instant either condition fails, the
// correction stops and this free-runs at its last bpm rather than drifting
// or stalling with the clock (beatClock.ts's own beatPhase) or falling back
// to raw hits (gridPulse.ts's behaviour below GRID_LOCK_ON). A tempo change
// big enough to move tempoSettle's own held value (once it has confirmed
// it — see RETUNE_SURE_SEC there) retunes this the same tick —
// phase stays continuous across that retune, only the beats/sec rate
// changes.
//
// This is deliberately a separate module from the Beat grid: gridPulse.ts's
// job is still "the tracker's beat when it's sure of the tempo, the raw
// hits when it isn't" (see that file's own header) — a source for scenes
// that want to react to what's actually landing. This module's job is "a
// steady tick that never wavers" — a source for scenes that want to *keep
// time*. Neither replaces the other; src/render/signals.ts exposes both.

/** What this reads off beatClock.ts each tick — its smoothed bpm, its own
 *  unwrapped beat count, and tempoLock, the confidence the metronome gates
 *  every correction on. */
export interface MetronomeClockInput {
  bpm: number;
  beats: number;
  tempoLock: number;
}

export interface Metronome {
  /** False whenever tempoSettle's own held value is 0 (the BPM card reads
   *  "--") — never gated on tempoLock; see this file's own header. */
  readonly running: boolean;
  /** The tempo it's actually ticking at — exactly tempoSettle's held value
   *  while running (unrounded), 0 while idle. Not the same object as
   *  `clock.bpm`, which keeps moving under it. */
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
   *  beat while running. Never true on the tick that adopts a tempo (both
   *  arm silently — see advance()'s own doc). */
  readonly beatTick: boolean;
  /** One-shot, same rule as beatTick, on a METRONOME_BEATS_PER_BAR-beat
   *  boundary. */
  readonly barTick: boolean;
  /** Advances by dtSec. `clock` is beatClock's own reading this tick;
   *  `rawBpm` is the tracker's *unsmoothed* bpm (FeatureFrame.bpm passed
   *  through — AnimFrame.bpm) — the same number tempoSettle.ts settles for
   *  the BPM card, pushed here every tick so the two can never disagree.
   *  Call once per render tick, same placement as beatClock's own
   *  advance(). */
  advance(dtSec: number, clock: MetronomeClockInput, rawBpm: number): void;
}

/** How many beats make a bar, for barPhase/barTick — matches beatClock.ts's
 *  own (unexported) BEATS_PER_BAR. */
export const METRONOME_BEATS_PER_BAR = 4;

// ---- Corrections while running -------------------------------------------
// tempoLock the clock has to hold for the metronome to accept *any*
// correction — below it, it free-runs untouched (the flywheel). As a clock
// loses the beat (a pads-only breakdown), its confidence slides down while
// its phase is already drifting, and a metronome still following it on the
// way down inherits that drift.
export const FOLLOW_LOCK = 0.75;
// Phase correction while confident: how fast the beat-line error (clock.beats
// - beats, wrapped to the nearest whole beat) is folded in, and the hard cap
// on how much that can move `beats` in one second — beats/s, so
// PHASE_FOLLOW_MAX_RATE is a slew rate, not a fraction. Kept far below
// BPM_MIN/60 (~1.17 beats/s) so adding/subtracting it from the tempo's own
// beats/s advance can never make `beats` run backward — see the interface
// doc's monotonic note and tests/metronome.test.ts's own assertion.
export const PHASE_FOLLOW_RATE = 2;
export const PHASE_FOLLOW_MAX_RATE = 0.25; // beats/s
// A beat-line error bigger than this (in beats), the first time the clock is
// confident after the metronome started or retuned, is snapped in one jump
// instead of slewed; every later correction only slews, so a clock whose
// phase jitters while confident can never make it jump repeatedly. The metronome now starts on the first
// settled tempo, long before the clock is sure where the beat is, so its
// starting phase is often far off; slewing half a beat at
// PHASE_FOLLOW_MAX_RATE took seconds of visibly uneven ticks (measured on
// the eval scoreboard's hiphop track). The jump is always forward — to the
// next point on the clock's beat line — so `beats` stays monotonic, and it
// arms tick detection silently like an adoption, so it never emits a tick
// of its own: one longer interval, then evenly spaced again.
export const PHASE_SNAP_BEATS = 0.15;
// Tempo follow while confident: only actually pulls `bpm` toward clock.bpm
// while the two are already close (within RESYNC_RATIO) — see the next
// constant's own doc for what happens when they're not.
export const TEMPO_FOLLOW_RATE = 1;
// How far clock.bpm can drift from the metronome's own held bpm (as a
// fraction of that held bpm) before the phase slew and tempo follow both
// stop entirely for this tick — below this, they quietly tighten the
// metronome onto the clock; at/above it, a mismatch this large means the
// clock is reading a different tempo altogether, and this module free-runs
// until tempoSettle.ts's own held value actually adopts that tempo (see
// this file's header) rather than chasing a beat line that may not last.
export const RESYNC_RATIO = 0.06;

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
  const settle = createTempoSettle();
  let running = false;
  let bpm = 0;
  let beats = 0;
  let level = 0;
  let lastBeatFloor = 0;
  let lastBarFloor = 0;
  // The last target this module actually adopted `bpm` from — compared
  // against tempoSettle's own current value each tick so a change is
  // caught (and adopted) exactly once, not re-applied every tick it happens
  // to still differ from `bpm` after the fine tempo-follow below has moved
  // `bpm` a little further on its own.
  let lastTarget = 0;

  // Whether this run has already had its one confident phase check (see
  // PHASE_SNAP_BEATS) — reset on every start and retune.
  let phaseChecked = false;

  // Arms tick detection against the *current* `beats` without emitting one —
  // called on adoption and on a phase snap, both of which move `beats` and
  // must never count that move itself as a tick.
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
      settle.push(rawBpm, dtSec, clock.tempoLock);
      const target = settle.bpm;
      let beatTick = false;
      let barTick = false;

      if (!running) {
        if (target > 0) {
          running = true;
          bpm = target;
          beats = clock.beats;
          phaseChecked = false;
          armTickDetection();
        }
      } else if (target === 0) {
        running = false;
        bpm = 0;
      } else {
        if (target !== lastTarget) {
          bpm = target;
          phaseChecked = false;
        }
        beats += dtSec * (bpm / 60);

        if (clock.tempoLock >= FOLLOW_LOCK && bpm > 0 && Math.abs(clock.bpm / bpm - 1) <= RESYNC_RATIO) {
          const err = wrapHalf(clock.beats - beats);
          const snap = !phaseChecked && Math.abs(err) > PHASE_SNAP_BEATS;
          phaseChecked = true;
          if (snap) {
            beats += err > 0 ? err : err + 1;
            armTickDetection();
          } else {
            const rawStep = err * PHASE_FOLLOW_RATE * dtSec;
            const cap = PHASE_FOLLOW_MAX_RATE * dtSec;
            beats += Math.max(-cap, Math.min(cap, rawStep));
          }
          bpm += (clock.bpm - bpm) * Math.min(1, TEMPO_FOLLOW_RATE * dtSec);
        }

        const beatFloor = Math.floor(beats);
        if (beatFloor > lastBeatFloor) beatTick = true;
        lastBeatFloor = beatFloor;
        const barFloor = Math.floor(beats / METRONOME_BEATS_PER_BAR);
        if (barFloor > lastBarFloor) barTick = true;
        lastBarFloor = barFloor;
      }
      lastTarget = target;

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
