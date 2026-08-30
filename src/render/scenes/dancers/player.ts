/**
 * The clip player's clock: turns the beat clock into "where in this clip's
 * loop are we". Clips are never advanced by wall time — their phase is a
 * function of bars elapsed (createBarCounter) and the current bar phase, so
 * the dancer can't drift off the beat however the tempo estimate wanders,
 * and a clip authored at 100 bpm simply plays faster at 128.
 *
 * Speed-warping a move by more than roughly ±30 % stops looking like the
 * move, so past HALF_TIME_RATIO the clip is spread over twice its bars
 * (every clip beat on every other music beat) and below DOUBLE_TIME_RATIO it
 * is played twice as fast — the same trick a dancer uses when the DJ speeds
 * up. Pure; tests/dancersPlayer.test.ts drives it.
 */
import type { ClipMeta } from "./clipFormat.ts";

export const BEATS_PER_BAR = 4;
/** bpm / nativeBpm above which the clip goes half-time. */
export const HALF_TIME_RATIO = 1.35;
/** bpm / nativeBpm below which the clip goes double-time. */
export const DOUBLE_TIME_RATIO = 0.7;

/** Music bars one loop of the clip spans at this tempo. */
export function clipCycleBars(clip: ClipMeta, bpm: number): number {
  const bars = clip.beats / BEATS_PER_BAR;
  if (!(bpm > 0) || !(clip.nativeBpm > 0)) return bars;
  const ratio = bpm / clip.nativeBpm;
  if (ratio > HALF_TIME_RATIO) return bars * 2;
  if (ratio < DOUBLE_TIME_RATIO) return bars * 0.5;
  return bars;
}

/** 0..1 phase around the clip's loop for `barsElapsed` (integer bars plus
 *  the current bar's phase) at tempo `bpm`. */
export function clipPhaseAt(clip: ClipMeta, bpm: number, barsElapsed: number): number {
  const cycle = clipCycleBars(clip, bpm);
  const x = barsElapsed / cycle;
  return x - Math.floor(x);
}

export interface BarCounter {
  /** Feeds this frame's barPhase and returns fractional bars elapsed since
   *  the counter started — monotonic, wrapping the bar count on every
   *  barPhase wrap. */
  advance(barPhase: number): number;
}

export function createBarCounter(): BarCounter {
  let bars = 0;
  let last = 0;
  return {
    advance(barPhase) {
      if (barPhase < last) bars++;
      last = barPhase;
      return bars + barPhase;
    },
  };
}
