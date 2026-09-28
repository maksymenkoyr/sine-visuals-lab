/**
 * Shared "warm start" rate for any leaky-average tracker that begins from a
 * guess rather than a real reading — a seed value, NEUTRAL, a freshly-reset
 * estimator — and eases exponentially toward its measurements afterward.
 * Every such tracker in this codebase picks a single steady-state rate that
 * has to do two jobs at once: it sets how fast the value can ever move once
 * warmed up (the averaging that keeps it from breathing with a single loud
 * bar or one quiet drum fill), and — because that's the only rate on offer —
 * it also sets how long a session takes to leave the seed behind and start
 * describing the real room or the real track. Those two jobs want opposite
 * numbers: a slow, stable steady-state rate and a fast start-up both, which
 * is why autoGain.ts's EASE_RATE used to sit at ~10s and take that long to
 * reach anything like the room's real span, and musicProfile.ts's dials
 * (PULSE_EASE_RATE and friends) plus its DYNAMICS_MEAN_RATE/DYNAMICS_MAD_RATE
 * trackers spent the first tens of seconds of every session still catching
 * up from NEUTRAL.
 *
 * warmRate splits the two jobs apart. For the first few seconds after a
 * tracker starts (or restarts), a plain cumulative average — "the mean of
 * everything seen so far" — already has exactly the rate a leaky exponential
 * ease needs to reproduce it: 1/(elapsed+T0), where elapsed is how long the
 * tracker has been running and T0 avoids a divide-by-zero (and an infinite
 * rate) on the very first sample. That rate starts high and falls smoothly
 * as `elapsed` grows, crossing the tracker's own steady-state rate at some
 * point — past that crossing, the cumulative-average rate would keep falling
 * forever (an unbounded-length average slows down more and more), which is
 * exactly the opposite of what a steady tracker wants, so warmRate hands
 * over to the fixed steady rate once it's the larger of the two. The result
 * is fast while a tracker is still finding its footing and identical to
 * today's behavior — the steady constant, untouched — from then on.
 *
 * Callers pass their own elapsed-seconds counter, not a wall-clock time: a
 * tracker that gets re-seeded (autoGain.ts's setAutoGainAuto(true), turning
 * auto back on after it was off) should warm up again, and only silence-free
 * seconds should count toward warming up a tracker that free-runs through
 * silence unchanged (musicProfile.ts holds every dial at NEUTRAL while there
 * is nothing to measure — see that file's header for its own signalSec
 * counter). autoGain.ts's feedAutoGainMeasurement and every ease() call in
 * musicProfile.ts's advance() are the current callers.
 */

/** Seconds added to the elapsed-time denominator so the very first sample
 *  (elapsed = 0) gets a finite rate — 1/WARM_T0_SEC — rather than dividing
 *  by zero. Small enough that the first tick still moves most of the way to
 *  its target, large enough that one single sample can't be mistaken for a
 *  settled average. */
export const WARM_T0_SEC = 0.5;

/**
 * The rate to ease with this tick, given a tracker's own steady-state rate
 * and how many seconds it has been warming up for. Never below `steadyRate`
 * — once the cumulative-average rate 1/(warmSec+WARM_T0_SEC) falls under it,
 * the steady rate takes over for good, so the long-run behavior this
 * replaces is exactly unchanged.
 *
 * `warmSec` is expected to be a small non-negative number of seconds, but
 * this stays total: a non-finite reading (NaN, Infinity) is treated as
 * "fully warm" — there's no sane elapsed time to react to, so the safest
 * fallback is the steady rate a caller already trusts — and a negative
 * reading is clamped to 0 (the freshest possible warm-up rate) rather than
 * propagated into a negative or inflated denominator.
 */
export function warmRate(steadyRate: number, warmSec: number): number {
  if (!Number.isFinite(warmSec)) return steadyRate;
  const elapsed = Math.max(0, warmSec);
  return Math.max(steadyRate, 1 / (elapsed + WARM_T0_SEC));
}
