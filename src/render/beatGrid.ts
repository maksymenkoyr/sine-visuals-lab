/**
 * Generalizes beatClock.ts's beat/bar phase to an arbitrary rate, so a scene
 * setting can be told to react once every few beats, or several times a
 * beat, instead of only on beatClock's own two hardcoded lines — the beat
 * itself (rate 1) and the bar (rate 4, BEATS_PER_BAR). See
 * sceneSettings.ts's `SceneSetting.rate` field for how a setting opts in,
 * and the device menu's rate chip strip for where a user picks one.
 *
 * The rule that makes this safe to bolt onto an existing beat-driven setting
 * one at a time: at a setting's own *rest* rate (`SceneSetting.rate.rest`)
 * the setting keeps reading whatever it read before this file existed,
 * untouched, bit for bit — this file's own grid never runs there. That's a
 * scene-side decision (only the scene knows whether its rest behavior was
 * `anim.onset`, `anim.beatPulse`, or `anim.barPhase`), so this file doesn't
 * enforce it directly; it just makes sure every rate away from rest has
 * somewhere principled to land.
 *
 * Away from rest, a setting switches from reacting to the actual sound to
 * reacting to the *predicted* beat line instead — which is what "every 2
 * beats" or "once a bar" has to mean once the rate isn't 1. Concretely: the
 * grid is `beats / rate`, where `beats` is beatClock's own free-running,
 * never-reset count (exposed unwrapped there for exactly this reason) — the
 * same arithmetic BeatClock.barPhase already does with a hardcoded divisor
 * of BEATS_PER_BAR. `gridPhase` wraps that to [0,1); `advanceBeatGate` also
 * fires a onset/pulse pair whenever it wraps. Two consequences worth being
 * deliberate about, not surprised by:
 *
 * - A rate away from rest needs a tracked tempo to mean anything. At bpm 0,
 *   beatClock's phase stalls (see its own file's `advance`), so this file's
 *   grid stalls right along with it rather than falling back to the real
 *   source — a setting parked on a non-default rate simply goes quiet on
 *   untracked material, the same way Tempo breathe already does today.
 * - A grid crossing can never be dropped by the render-rate cap the way a
 *   raw one-shot AnimFrame edge can (see renderLatch.ts): `beats` only ever
 *   increases, so `advanceBeatGate` compares this call's grid index against
 *   the last call's and catches any change, even one spanning several
 *   crossings while ticks were skipped. Nothing here needs the render latch.
 */

export const BEAT_RATES = [0.5, 1, 2, 4, 8] as const;
export type BeatRate = (typeof BEAT_RATES)[number];

/** Chip text, in BEAT_RATES order. */
export const BEAT_RATE_LABELS: Record<BeatRate, string> = {
  0.5: "½",
  1: "1",
  2: "2",
  4: "4",
  8: "8",
};

/** Chip tooltip — spells out what the number means once it isn't "1". */
export const BEAT_RATE_TITLES: Record<BeatRate, string> = {
  0.5: "Twice a beat",
  1: "Every beat",
  2: "Every 2 beats",
  4: "Once a bar",
  8: "Once every 2 bars",
};

export function isBeatRate(value: number): value is BeatRate {
  return (BEAT_RATES as readonly number[]).includes(value);
}

function wrap01(x: number): number {
  const w = x % 1;
  return w < 0 ? w + 1 : w;
}

/** [0,1) position within one cycle of `rate` beats, off beatClock's own
 *  unwrapped beat count — matches BeatClock.barPhase bit for bit at rate 4. */
export function gridPhase(beats: number, rate: BeatRate): number {
  return wrap01(beats / rate);
}

// Matches animClock.ts's BEAT_PULSE_DECAY_PER_SEC — a gate's pulse should
// decay at the same rate the shared uBeatPulse does, so a setting parked at
// rate 1 in spirit (even though it's reading the grid, not the real source)
// still reads like the beat-driven look it's standing in for.
const PULSE_DECAY_PER_SEC = 6;

export interface BeatGate {
  /** True only on the tick this rate's own grid line was just crossed. */
  onset: boolean;
  /** Decaying [0,1] pulse, jumps to 1 on `onset`. */
  pulse: number;
  /** [0,1) position within the current cycle — see gridPhase. */
  phase: number;
}

export interface BeatGateState {
  prevGridIndex: number;
  pulse: number;
}

export function createBeatGateState(): BeatGateState {
  return { prevGridIndex: 0, pulse: 0 };
}

/** Advances one setting's own rate grid by one tick. Pass beatClock's raw
 *  `beats` every call regardless of rate — only the division changes; pass
 *  the wall-clock `dtSec` since the last call (a scene reading AnimFrame's
 *  latched fields already has this as `anim.dtSec`). Pure aside from `st`. */
export function advanceBeatGate(st: BeatGateState, dtSec: number, beats: number, rate: BeatRate): BeatGate {
  const gridIndex = Math.floor(beats / rate);
  const onset = gridIndex !== st.prevGridIndex;
  st.prevGridIndex = gridIndex;

  st.pulse *= Math.exp(-dtSec * PULSE_DECAY_PER_SEC);
  if (onset) st.pulse = 1;

  return { onset, pulse: st.pulse, phase: gridPhase(beats, rate) };
}

// Glue for the identity every onset/pulse-form setting rests on (see the
// file header): read the setting's own pre-rate source bit for bit at its
// own rest rate, switch to this file's grid away from it. `rest`/`rate` are
// a specific setting's own values (SceneSetting.rate.rest and whatever the
// user picked); `restOnset`/`restPulse` are whatever the setting read before
// it had a `rate` at all. Two functions, not one returning both fields,
// because a scene typically only needs whichever one its own source was — an
// onset to gate a trigger (Beat surge, say), or a pulse to gate a continuous
// multiplier (Beat flash). Call at most one of these against a given `st`
// per tick: each call that reaches advanceBeatGate (i.e. rate !== rest)
// advances that gate's pulse decay by `dtSec`, so calling both against the
// same state in one tick would decay it twice. A setting wanting both an
// onset and a pulse from its own gate should read them off one
// advanceBeatGate call directly instead of going through this pair.
export function gatedOnset(
  st: BeatGateState,
  dtSec: number,
  beats: number,
  rate: BeatRate,
  rest: BeatRate,
  restOnset: boolean,
): boolean {
  return rate === rest ? restOnset : advanceBeatGate(st, dtSec, beats, rate).onset;
}

export function gatedPulse(
  st: BeatGateState,
  dtSec: number,
  beats: number,
  rate: BeatRate,
  rest: BeatRate,
  restPulse: number,
): number {
  return rate === rest ? restPulse : advanceBeatGate(st, dtSec, beats, rate).pulse;
}
