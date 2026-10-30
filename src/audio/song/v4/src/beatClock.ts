// The beat clock the song layer's anim clock (../app/render/animClock.ts) runs is the app's own, which equals the one in
// audio-subsystem/v6/src/song/v4 (2026-10-30, #798/#800) line for line, comments aside; the bench check (bench-signals'
// probe app-song) holds the readings equal to v6. What the app's file lacks is v4's two names below, kept here so the
// copied files that import them stay as copied.

export { type BeatClock, createBeatClock } from "../../../../render/beatClock.ts";

/** A bass-weighted hit counts this much more towards the phase comb's vote; v4's value, which the app has since moved. */
export const PHASE_BASS = 4;

/** One fixed-hop onset, already an exact audio-clock time relative to "now". */
export interface TempoHit {
  /** Seconds ago (from this tick's clockSec) the onset actually fired. */
  agoSec: number;
  weight: number;
}
