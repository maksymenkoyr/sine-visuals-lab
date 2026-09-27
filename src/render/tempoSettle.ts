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

export interface TempoSettle {
  /** The settled tempo — what the BPM card shows and the metronome ticks
   *  at. 0 = none ("--"). Unrounded — a caller that wants digits rounds it
   *  itself. */
  readonly bpm: number;
  /** Feed the tracker's raw bpm (FeatureFrame.bpm; 0 = none) every tick,
   *  with the real elapsed time since the last push — this module's own
   *  window is measured in accumulated `dtSec`, not wall time, so it settles
   *  the same way at any render rate or Smoothing setting. */
  push(rawBpm: number, dtSec: number): void;
}

interface Sample {
  /** This sample's own position on the accumulated-dtSec timeline. */
  t: number;
  bpm: number;
}

export function createTempoSettle(): TempoSettle {
  let now = 0;
  let held = 0;
  const samples: Sample[] = [];

  const settle: TempoSettle = {
    bpm: 0,
    push(rawBpm: number, dtSec: number): void {
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
      if (next === held || (held > 0 && next > 0 && Math.abs(next - held) < TEMPO_HOLD_BPM)) return;
      held = next;
      (settle as { bpm: number }).bpm = held;
    },
  };
  return settle;
}
