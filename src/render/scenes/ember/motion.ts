/**
 * Ember's clocks, kept out of the shader so they can be tested: the swell
 * that takes the fire from bare crest lines to a full glowing body and back,
 * and the kick lift that throws the fronts upward.
 *
 * The swell's shape is measured, not designed: `SWELL_SHAPE` is the
 * reference loop's mean frame brightness in even steps across its period
 * (the `/ref` bundle `vg2cB1EeJpo`, folded on its loop length; the numbers
 * are in docs/scenes/ember.md's Measurements), rescaled to 0..1. The
 * reference is silent and loops on a timer, so the period here is ours: a
 * whole number of bars at the tempo the beat clock holds, falling back to
 * that many bars at `REST_BPM` with no tempo. At `REST_BPM`, the Swell
 * length setting's default spans the reference's own period.
 */

/** Mean brightness across one loop of the reference, darkest = 0, brightest = 1. */
export const SWELL_SHAPE = [0.23, 0, 0.1, 0.41, 0.7, 0.86, 0.85, 0.83, 0.93, 1, 0.9, 0.7, 0.69, 0.78, 0.77, 0.61] as const;

/** The tempo the swell keeps with no tempo held. */
export const REST_BPM = 120;
const BEATS_PER_BAR = 4;

/** How long a kick's lift takes to arrive, and how long it takes to fall back. */
const LIFT_ATTACK_SEC = 0.06;
const LIFT_FALL_SEC = 0.55;

/** The swell at phase `c` (wraps), interpolated smoothly between the measured steps. */
export function swellAt(c: number): number {
  const n = SWELL_SHAPE.length;
  const x = (c - Math.floor(c)) * n;
  const i = Math.floor(x) % n;
  const f = x - Math.floor(x);
  const s = f * f * (3 - 2 * f);
  return SWELL_SHAPE[i] + (SWELL_SHAPE[(i + 1) % n] - SWELL_SHAPE[i]) * s;
}

/** Swell cycles per second: `bars` bars at the held tempo, eased toward the
 *  rest tempo as the lock fades, so losing the beat never jumps the phase. */
export function swellRate(bars: number, tempoBpm: number, tempoLock: number): number {
  const lock = tempoBpm > 0 ? Math.min(1, Math.max(0, tempoLock)) : 0;
  const bpm = REST_BPM + (tempoBpm - REST_BPM) * lock;
  return bpm / 60 / (BEATS_PER_BAR * Math.max(1, bars));
}

export interface LiftState {
  /** What the kicks asked for, falling back to 0. */
  target: number;
  /** What the shader gets: `target`, reached over the attack time. */
  level: number;
}

export function createLiftState(): LiftState {
  return { target: 0, level: 0 };
}

/** One frame: a kick of `size` (0 for none) raises the target, which falls
 *  away; the shown level chases it, so a kick throws the fire, never snaps it. */
export function advanceLift(s: LiftState, dtSec: number, size: number): number {
  const dt = Math.max(0, dtSec);
  s.target = Math.max(s.target * Math.exp(-dt / LIFT_FALL_SEC), size);
  s.level += (s.target - s.level) * (1 - Math.exp(-dt / LIFT_ATTACK_SEC));
  return s.level;
}
