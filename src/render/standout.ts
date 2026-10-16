// A standout: a climb in a driver signal that rises clearly above the
// everyday climbs the same signal keeps making. Settings that should react to
// "a hit that stands out", not to every hit, read it here, so one sound counts
// the same in every scene:
//   - Caustics' Beat ripple sizes each ring by how far a climb stands out
//     (advanceStandoutAmount), with its Ring threshold setting as the
//     threshold;
//   - Physarum 2's Dose starts a colony, and Alien's Cut changes the loop,
//     once per standout (a StandoutTrigger), each with its own threshold row
//     under the setting's graph.
//
// How it listens, in order:
//   1. A light smoothing knocks out frame-to-frame noise, and a rise
//      deadband keeps only real rises: a slow swell, a held level or a
//      falling signal is not a climb.
//   2. A climb is measured whole, from the last dip to wherever the signal
//      has got to, so a hit (a one-frame climb) and a smooth bump (a climb
//      over many frames) are the same kind of thing.
//   3. Each finished climb teaches two sizes: the floor (the frequent,
//      background climbs) and the peak (the big ones). Both relax over time,
//      so after a quiet spell a modest hit stands out again.
//   4. A climb is then sized against them: (climb − bar) / (peak − bar),
//      clamped to 0..1, where the bar sits a threshold-set margin above the
//      floor (standoutBar). Background climbs come out near 0, a hit as big
//      as the recent big ones near 1. With the threshold Off (`null`) there
//      is no bar: a climb is sized by its own height.
// In signal-processing terms this is an adaptive threshold over a rise
// detector: the floor is a noise-floor estimate, the bar sits a margin above
// it.
//
// Three read-outs of the same climb:
//   - the amount (advanceStandoutAmount): every frame, what the climb gained
//     since the last one, so a climb's pieces add up to its size. For a
//     reaction that can be any size and can add up (Beat ripple's rings).
//   - flat (advanceStandout): yes once per climb, on the frame it has earned
//     FIRE_LEVEL. For a reaction with no size of its own (a cut).
//   - sized (advanceStandoutSized): once per climb, its size, on the frame
//     the size is settled. For a one-off reaction that can be any size (a
//     colony as big as the hit stood out).
// A setting that reacts once per hit lets the user pick flat or sized (its
// HitReadout, the panel's Reaction row; drives.ts's header, "Hit drivers").
//
// Wiring a new setting to it. A setting that does one thing per hit needs
// none of this: declaring `drive.hit` and reading `drives.fired` gets it the
// detector, the threshold row, the Reaction row and the graph's marks from
// the engine (drives.ts's header, "Hit drivers"). For a scene that runs the
// detector itself (`drive.hit.ownDetector`, as Dose and Cut do):
//   - declare `drive.threshold` with `default: STANDOUT_THRESHOLD_DEFAULT`
//     and the setting's own label and hint. That makes the threshold
//     scene-handled (drives.ts's header): the panel shows the On/Off switch
//     and slider under the graph, and the engine's generic gate stays out.
//   - keep a StandoutTrigger, and step it every frame — armed or not, so the
//     floor and peak keep learning — with `drives.value(key, …)`,
//     `standoutThreshold(drives, key)` and, through stepStandoutHit, the
//     setting's `drives.readout(key)`.
//   - publish `standoutLine(trigger.detector, "<reach to …>")` and each fire
//     through settingMarks.ts, so the graph draws the dotted line a climb
//     must reach and a dot for each fire.
//
// Pure, no DOM or GL: tests/standout.test.ts drives it directly.

import type { SceneDrives } from "./drives.ts";
import type { SettingMarkLine } from "./settingMarks.ts";

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// ---- Rise detection --------------------------------------------------------

// How fast the smoothing chases the raw driver signal. This has to stay
// short: anim.lowPulse/beatPulse jump to 1 in a single tick and decay at a
// fixed rate (BEAT_PULSE_DECAY_PER_SEC, animClock.ts) that a one-pole filter
// is chasing at the same time it's rising — the filter's own peak response to
// that race is what a lone hit's total amount is capped by (see
// tests/standout.test.ts's own numbers), so a tau much above this starts
// visibly undershooting "one full standout" for an ordinary beat, not just
// for noise. What's left still knocks down noise faster than any real driver
// moves: a beat's own attack is exactly one render tick wide, but the audio
// analysis feeding FeatureFrame can jitter sample-to-sample faster than that,
// and this is still several times that timescale.
const SMOOTH_TAU_SEC = 0.005;

// A rise slower than this (driver units per second) is a swell or a fade-in,
// not a hit, and counts for nothing. 0.5/s means a signal climbing from 0 to 1
// over two seconds or slower nets ~0 (see tests/standout.test.ts's ramp
// case), while a real hit's rise — order 1 unit within roughly one smoothing
// time constant, i.e. hundreds of units/sec — clears it by well over two
// orders of magnitude and is barely dented by the subtraction (see the
// "single hit" test's ~10% tolerance).
const RISE_DEADBAND_PER_SEC = 0.5;

// ---- Learning the everyday climbs -------------------------------------------
//
// Why a climb is sized by how much it stands out from the recent climbs, not
// by its absolute height: in real music the hit detectors behind a driver
// fire on everything — hats, ghost notes, small transients — and every one of
// them makes the driver jump. Sized by absolute height (Beat ripple's first
// try), each sent a fresh ring every fraction of a second, burying the ring
// the real hit sent.
//
// Why whole climbs, not frame steps: a smooth source (a level, a drawn line)
// climbs over many frames, and sized per frame each step was too small to
// count, so the trackers never learned that source and every climbing frame
// counted on its own. Per climb, the amount grows as the climb does (each
// frame returns only what the climb's size has gained since the last frame,
// so a slow bump starts counting the moment it crosses the bar), and the
// finished climb's total is what the trackers learn from.
//
// The two trackers, updated when a climb ends (a climb past EVENT_MIN):
//   - the peak follows the *big* climbs: it jumps straight to a bigger one
//     and eases down slowly toward a smaller one;
//   - the floor is the running average of the *background* climbs only —
//     those below BACKGROUND_FRACTION of the peak (or below the floor
//     itself). A hit near the peak never raises the floor, so a steady
//     four-on-the-floor of equal kicks keeps standing out however long it
//     runs.
// SPREAD_MIN keeps the sizing ratio from amplifying tiny differences when
// every recent climb is about the same size (a noise-only passage).
const EVENT_MIN = 0.05; // a climb smaller than this doesn't move the trackers (the smoothing's own one-frame tail, sub-noise jitter)
const BACKGROUND_FRACTION = 0.6; // a climb below this share of the peak counts as background
const FLOOR_RATE = 0.2; // per background climb, toward that climb
const PEAK_DOWN = 0.05; // per climb, toward a smaller climb
const FLOOR_RELAX_SEC = 3; // floor decays toward 0 with this time constant
const PEAK_RELAX_SEC = 6; // peak decays toward the floor with this time constant
const SPREAD_MIN = 0.3;

// ---- The threshold ---------------------------------------------------------
//
// The threshold (0..1) → the bar. The margin runs linearly from
// THRESHOLD_MARGIN_AT_0 times the floor (none: every climb counts whatever
// the floor) to THRESHOLD_MARGIN_AT_1 times. Above the default a fixed
// minimum also grows, up to THRESHOLD_MIN_AT_1, so raising the setting still
// does something on a clean source whose floor is 0.
// STANDOUT_THRESHOLD_DEFAULT lands exactly on Beat ripple's behaviour before
// its Ring threshold was a setting (and before the range was widened on
// 2026-10-03): a 1.5× margin and no minimum.
export const STANDOUT_THRESHOLD_DEFAULT = 0.25;
const THRESHOLD_MARGIN_AT_0 = 0;
const THRESHOLD_MARGIN_AT_1 = 6;
const THRESHOLD_MIN_AT_1 = 0.5;

/** How far a climb must rise above its starting dip before it counts, for
 *  this floor and threshold. Only for a threshold that is on —
 *  advanceStandoutAmount/standoutMarks use a bar of 0 while it's off. */
export function standoutBar(floor: number, threshold: number): number {
  const t = clamp01(threshold);
  const margin = THRESHOLD_MARGIN_AT_0 + (THRESHOLD_MARGIN_AT_1 - THRESHOLD_MARGIN_AT_0) * t;
  const minimum = THRESHOLD_MIN_AT_1 * Math.max(0, (t - STANDOUT_THRESHOLD_DEFAULT) / (1 - STANDOUT_THRESHOLD_DEFAULT));
  return margin * floor + minimum;
}

/** A setting's threshold as the panel holds it: the slider while the row's
 *  switch is On, `null` while it's Off, and the shared default when there is
 *  no engine at all (PASSTHROUGH_DRIVES: a test, a bare render). For a
 *  setting that declares `drive.threshold` with STANDOUT_THRESHOLD_DEFAULT. */
export function standoutThreshold(drives: Pick<SceneDrives, "threshold">, key: string): number | null {
  const t = drives.threshold(key);
  return t === undefined ? STANDOUT_THRESHOLD_DEFAULT : t;
}

// ---- The detector ----------------------------------------------------------

export interface StandoutState {
  smoothed: number;
  init: boolean;
  /** The size of the frequent, background climbs. */
  floor: number;
  /** The size of the big climbs. */
  peak: number;
  /** Whether the signal is climbing right now. */
  climbing: boolean;
  /** The level the current climb started from (the last dip). */
  base: number;
  /** How much of a full standout the current climb has earned so far. */
  earnedThisClimb: number;
  /** Whether advanceStandoutSized has already reported the current (or
   *  last) climb. */
  sizedSent: boolean;
  /** The bar and the climb above it that earns a full standout, frozen at
   *  the climb's start. */
  climbBar: number;
  climbSpread: number;
  /** The threshold the last advance used, while it was on — standoutMarks
   *  reads it to recompute the bar between climbs. Meaningless (but kept,
   *  not reset) while `thresholdOn` is false. */
  threshold: number;
  /** Whether the last advance had a real threshold (On) or `null` (Off) —
   *  standoutMarks reads it to decide whether there's a bar to draw at all. */
  thresholdOn: boolean;
}

export function createStandoutState(): StandoutState {
  return {
    smoothed: 0,
    init: false,
    floor: 0,
    peak: 0,
    climbing: false,
    base: 0,
    earnedThisClimb: 0,
    sizedSent: false,
    climbBar: 0,
    climbSpread: SPREAD_MIN,
    threshold: STANDOUT_THRESHOLD_DEFAULT,
    thresholdOn: true,
  };
}

function learnClimb(state: StandoutState, climb: number): void {
  if (climb < EVENT_MIN) return;
  if (climb < BACKGROUND_FRACTION * state.peak || climb < state.floor) {
    state.floor += (climb - state.floor) * FLOOR_RATE;
  }
  state.peak = climb > state.peak ? climb : state.peak + (climb - state.peak) * PEAK_DOWN;
}

/** One frame of the detector, as an amount: how much more of a full
 *  standout the current climb earned this frame (>= 0). A climb's amounts
 *  sum to its size, 0..1 — the graded form, for a reaction that should be
 *  as strong as the hit stood out (Beat ripple launches this much ring).
 *  Advances `state` in place. The first call seeds the smoothing from
 *  `signal` and returns 0, so startup never reads as a climb from a falsely
 *  zeroed average.
 *
 *  `threshold` is `null` for the threshold row's Off switch: every climb
 *  counts, sized by nothing but its own height (the bar is 0, the spread 1,
 *  so a climb's size is just `clamp01(climb)`). The floor and peak keep
 *  learning either way, so switching back on doesn't start them from
 *  scratch. */
export function advanceStandoutAmount(
  state: StandoutState,
  dtSec: number,
  signal: number,
  threshold: number | null = STANDOUT_THRESHOLD_DEFAULT,
): number {
  if (threshold === null) {
    state.thresholdOn = false;
  } else {
    state.thresholdOn = true;
    state.threshold = threshold;
  }
  if (!state.init) {
    state.smoothed = signal;
    state.init = true;
    return 0;
  }
  const prev = state.smoothed;
  const rate = 1 - Math.exp(-dtSec / SMOOTH_TAU_SEC);
  state.smoothed = prev + (signal - prev) * rate;
  const rising = state.smoothed - prev > RISE_DEADBAND_PER_SEC * dtSec;

  state.floor *= Math.exp(-dtSec / FLOOR_RELAX_SEC);
  state.peak = state.floor + (state.peak - state.floor) * Math.exp(-dtSec / PEAK_RELAX_SEC);

  if (!rising) {
    if (state.climbing) {
      state.climbing = false;
      learnClimb(state, prev - state.base);
    }
    return 0;
  }
  if (!state.climbing) {
    // A new climb from the last dip. The bar and spread are frozen here, as
    // the trackers stood *before* this climb, so a climb bigger than
    // anything recent reads as a full standout rather than as merely equal
    // to a peak it is itself raising.
    state.climbing = true;
    state.base = prev;
    state.earnedThisClimb = 0;
    state.sizedSent = false;
    if (state.thresholdOn) {
      state.climbBar = standoutBar(state.floor, state.threshold);
      state.climbSpread = Math.max(state.peak - state.climbBar, SPREAD_MIN);
    } else {
      state.climbBar = 0;
      state.climbSpread = 1;
    }
  }
  const climb = state.smoothed - state.base;
  const target = clamp01((climb - state.climbBar) / state.climbSpread);
  const earned = Math.max(0, target - state.earnedThisClimb);
  state.earnedThisClimb = Math.max(state.earnedThisClimb, target);
  return earned;
}

/** How much of a full standout a climb must have earned before
 *  advanceStandout says yes. A background blip that only just clears the
 *  line earns a sliver; a hit that really stands out earns most of a full
 *  one in a single step, so half is a clean divide. */
const FIRE_LEVEL = 0.5;
/** With the threshold Off a climb is sized by its own height alone (no bar,
 *  no spread), so the level is just "an audible climb" — the same size the
 *  trackers already ignore below (EVENT_MIN). */
const FIRE_LEVEL_OFF = 0.1;

/** One frame of the detector, as a yes/no: true on the frame a climb has
 *  earned FIRE_LEVEL of a full standout, once per climb — the rest of that
 *  climb (and every climb that stays under) answers false. Same arguments
 *  as advanceStandoutAmount. */
export function advanceStandout(
  state: StandoutState,
  dtSec: number,
  signal: number,
  threshold: number | null = STANDOUT_THRESHOLD_DEFAULT,
): boolean {
  const level = threshold === null ? FIRE_LEVEL_OFF : FIRE_LEVEL;
  const before = state.climbing ? state.earnedThisClimb : 0;
  advanceStandoutAmount(state, dtSec, signal, threshold);
  return state.climbing && state.earnedThisClimb >= level && before < level;
}

/** How a setting that reacts once per hit takes that hit: `flat`, a full
 *  reaction for every climb that earns FIRE_LEVEL (advanceStandout); or
 *  `sized`, one reaction per climb that clears the line, as big as it stood
 *  out (advanceStandoutSized). */
export type HitReadout = "flat" | "sized";

/** The smallest size advanceStandoutSized reports: a climb that earned less
 *  is a sliver of background, not a reaction. The same "an audible climb"
 *  as FIRE_LEVEL_OFF. */
const SIZED_MIN = FIRE_LEVEL_OFF;

/** One frame of the detector, as a sized event: the climb's size (0..1) on
 *  the frame that size is settled, once per climb, and 0 on every other
 *  frame. A climb is settled when it has earned a full standout (it can't
 *  grow further) or when it stops climbing, so a hit that stands out fully
 *  reports on the frame it lands, a smaller hit one frame later (when its
 *  pulse starts falling), and a smooth bump at its top. A climb that earned
 *  less than SIZED_MIN reports nothing. Same arguments as
 *  advanceStandoutAmount, `null` included: with the threshold Off a climb is
 *  sized by its own height. */
export function advanceStandoutSized(
  state: StandoutState,
  dtSec: number,
  signal: number,
  threshold: number | null = STANDOUT_THRESHOLD_DEFAULT,
): number {
  const wasClimbing = state.climbing;
  advanceStandoutAmount(state, dtSec, signal, threshold);
  if (state.sizedSent) return 0;
  const settled = state.climbing ? state.earnedThisClimb >= 1 : wasClimbing;
  if (!settled) return 0;
  state.sizedSent = true;
  return state.earnedThisClimb >= SIZED_MIN ? state.earnedThisClimb : 0;
}

/** Where the detector puts the line right now, as signal heights on the same
 *  axis the driver is plotted on — for the panel's graph (settingMarks.ts).
 *  `reach` is the level the signal has to climb to for a climb to start
 *  counting, `full` the level that makes it a full standout, both measured
 *  from where the current climb started (or, between climbs, from where the
 *  signal is now — the dip a next climb would start from). `null` while the
 *  threshold is Off: there's no bar when every climb counts. */
export function standoutMarks(state: StandoutState): { reach: number; full: number } | null {
  if (!state.thresholdOn) return null;
  if (state.climbing) {
    return { reach: state.base + state.climbBar, full: state.base + state.climbBar + state.climbSpread };
  }
  const bar = standoutBar(state.floor, state.threshold);
  const spread = Math.max(state.peak - bar, SPREAD_MIN);
  return { reach: state.smoothed + bar, full: state.smoothed + bar + spread };
}

/** The dotted line for the setting's graph, ready for publishSettingMarks:
 *  the `reach` mark under `label`, or no line while the threshold is Off.
 *  Only the one line — a second "full" line made Beat ripple's graph harder
 *  to read, and each fire's dot already shows how strong it was. */
export function standoutLine(state: StandoutState, label: string): SettingMarkLine[] {
  const marks = standoutMarks(state);
  return marks ? [{ value: marks.reach, label }] : [];
}

// ---- The trigger -----------------------------------------------------------
//
// The event form: a detector plus the shortest time between two fires, for a
// setting that does one thing per standout (start a colony, cut the loop). A
// standout that lands too soon after the last fire, or while the caller has
// the trigger disarmed (its setting switched off), is dropped, not saved for
// later: that climb is spent, and the next one has to stand out on its own.

export interface StandoutTrigger {
  /** The detector underneath — standoutLine/standoutMarks read it. */
  readonly detector: StandoutState;
  /** The shortest time between two fires, in seconds. */
  readonly minGapSec: number;
  /** Seconds since the last fire (Infinity before the first, so the first
   *  standout always fires). */
  sinceFireSec: number;
}

export function createStandoutTrigger(minGapSec: number): StandoutTrigger {
  return { detector: createStandoutState(), minGapSec, sinceFireSec: Infinity };
}

/** One frame of the trigger: true on the frame it fires. Call it every
 *  frame, with `armed` false while the setting is off, so the detector keeps
 *  learning the signal and an off-then-on switch doesn't start it from
 *  scratch. */
export function stepStandoutTrigger(
  trigger: StandoutTrigger,
  dtSec: number,
  signal: number,
  threshold: number | null,
  armed = true,
): boolean {
  return stepStandoutHit(trigger, dtSec, signal, threshold, "flat", armed) > 0;
}

/** stepStandoutTrigger with a read-out: 0 on a frame it doesn't fire, and on
 *  a frame it does, 1 for `flat` or the climb's size for `sized`
 *  (advanceStandoutSized). The gap and `armed` work the same either way. */
export function stepStandoutHit(
  trigger: StandoutTrigger,
  dtSec: number,
  signal: number,
  threshold: number | null,
  readout: HitReadout,
  armed = true,
): number {
  trigger.sinceFireSec += Math.max(0, dtSec);
  const size =
    readout === "sized"
      ? advanceStandoutSized(trigger.detector, dtSec, signal, threshold)
      : advanceStandout(trigger.detector, dtSec, signal, threshold)
        ? 1
        : 0;
  if (size <= 0 || !armed || trigger.sinceFireSec < trigger.minGapSec) return 0;
  trigger.sinceFireSec = 0;
  return size;
}
