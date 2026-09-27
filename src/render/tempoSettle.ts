/**
 * The settle rule behind "what tempo does this song have, right now": the
 * raw estimate flits between candidates (half/double-time, a fill), but a
 * song's tempo hardly ever changes — so the settled reading is the value
 * that most of the last TEMPO_SETTLE_SEC of pushes agree on (within
 * TEMPO_SETTLE_TOL of the window's median, at least TEMPO_SETTLE_SHARE of
 * them). A majority rather than an unbroken run: on a real mic the estimate
 * can blip for an onset or two, and a run that resets on every blip never
 * settles at all. Once held, a value only moves for an agreeing value at
 * least TEMPO_HOLD_BPM away — enough to stop 124/125 flicker, small enough
 * that an early reading a couple of bpm off is corrected rather than held —
 * except going to 0, which is always allowed the instant the window agrees
 * on it (no tempo, rather than a stale one held forever).
 *
 * Moving a held tempo the tracker has been sure of to a *different* one
 * has to be confirmed first: the new value must stay the window's agreed
 * reading for RETUNE_SURE_SEC while the beat tracker is sure (the `lock`
 * push() is given, beatClock's tempoLock, at or above RETUNE_LOCK), or for
 * RETUNE_UNSURE_SEC however unsure it is. "Sure of" means the tracker's lock
 * reached RETUNE_LOCK at least once while the window agreed with the held
 * value; a held value it never was sure of is only a guess, and moves the
 * instant the window agrees on another. The first tempo (from "--") is also
 * shown the instant the window agrees. Measured reasons, both on the eval
 * scoreboard (tests/tempoEval.test.ts): in house's drums-out breakdown the
 * raw estimate wandered onto a wrong candidate for a second or two with lock
 * near zero, and an unconfirmed retune made the metronome follow it and
 * back; at the start of hiphop the first agreed reading was a wrong guess,
 * and confirming the correction (without the "never sure of it" exception)
 * held that guess for seconds after the tracker had moved on.
 *
 * One pure module rather than two copies, because two callers now need the
 * identical number: src/ui/audioMeters.ts's BPM card shows it (rounded for
 * display; see its own createTempoBlock), and src/render/metronome.ts ticks
 * at it unrounded — "the metronome *is* the BPM card's number, ticking" only
 * holds if both read this same settle.
 */

export const TEMPO_SETTLE_SEC = 1.5;
export const TEMPO_SETTLE_TOL = 0.03;
export const TEMPO_SETTLE_SHARE = 0.6;
export const TEMPO_HOLD_BPM = 2;
export const RETUNE_LOCK = 0.6;
export const RETUNE_SURE_SEC = 1;
export const RETUNE_UNSURE_SEC = 5;

export interface TempoSettle {
  /** The settled tempo — what the BPM card shows and the metronome ticks
   *  at. 0 = none ("--"). Unrounded — a caller that wants digits rounds it
   *  itself. */
  readonly bpm: number;
  /** Feed the tracker's raw bpm (FeatureFrame.bpm; 0 = none) every tick,
   *  with the real elapsed time since the last push — this module's own
   *  window is measured in accumulated `dtSec`, not wall time, so it settles
   *  the same way at any render rate or Smoothing setting. `lock` is the
   *  beat tracker's confidence (beatClock's tempoLock, 0..1) — it only
   *  decides how soon a held tempo may move to a different one (see
   *  RETUNE_SURE_SEC above); omitted, it counts as sure. */
  push(rawBpm: number, dtSec: number, lock?: number): void;
}

interface Sample {
  /** This sample's own position on the accumulated-dtSec timeline. */
  t: number;
  bpm: number;
}

export function createTempoSettle(): TempoSettle {
  let now = 0;
  let held = 0;
  // A different tempo waiting to be confirmed (0 = none), and how long it
  // has been the agreed reading: in total, and with the tracker sure.
  let heldSure = false;
  let pending = 0;
  let pendingSec = 0;
  let pendingSureSec = 0;
  const samples: Sample[] = [];

  const settle: TempoSettle = {
    bpm: 0,
    push(rawBpm: number, dtSec: number, lock = 1): void {
      now += dtSec;
      samples.push({ t: now, bpm: rawBpm });
      while (samples.length && samples[0]!.t < now - TEMPO_SETTLE_SEC) samples.shift();

      if (samples.length < 2 || now - samples[0]!.t < TEMPO_SETTLE_SEC * 0.8) return;

      const sorted = samples.map((s) => s.bpm).sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1]!;
      const tol = Math.max(1, median * TEMPO_SETTLE_TOL);
      let agree = 0;
      let sum = 0;
      for (const v of sorted) {
        if (Math.abs(v - median) > tol) continue;
        agree++;
        sum += v;
      }
      if (agree < samples.length * TEMPO_SETTLE_SHARE) return;

      const next = median > 0 ? sum / agree : 0;
      if (next === held || (held > 0 && next > 0 && Math.abs(next - held) < TEMPO_HOLD_BPM)) {
        if (held > 0 && lock >= RETUNE_LOCK) heldSure = true;
        pending = 0;
        return;
      }
      if (held > 0 && next > 0 && heldSure) {
        if (pending > 0 && Math.abs(next - pending) < TEMPO_HOLD_BPM) {
          pendingSec += dtSec;
          if (lock >= RETUNE_LOCK) pendingSureSec += dtSec;
        } else {
          pendingSec = 0;
          pendingSureSec = 0;
        }
        pending = next;
        if (pendingSureSec < RETUNE_SURE_SEC && pendingSec < RETUNE_UNSURE_SEC) return;
      }
      pending = 0;
      heldSure = false;
      held = next;
      (settle as { bpm: number }).bpm = held;
    },
  };
  return settle;
}
