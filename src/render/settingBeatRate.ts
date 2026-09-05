import { BEAT_GRIDS, beatGridBeats, type BeatGridIndex } from "../audio/beatGrid.ts";
import { createGridPulse, type GridPulse } from "./gridPulse.ts";

/**
 * Two ways a single scene setting can pick its own beat, layered on top of
 * (not replacing) the scene-wide Beat grid row (src/audio/beatGrid.ts,
 * applied to anim.onset/beatPulse by gridPulse.ts):
 *
 * - **Override** (`SceneSetting.rate.kind === "override"`): pins one
 *   setting's beat reaction to a specific grid stop regardless of what the
 *   scene's own Beat grid row is set to. At rest — `null`, "Scene" in the
 *   panel — the setting reads `anim.onset`/`anim.beatPulse` untouched,
 *   which already reflects the scene's own choice; there's nothing extra to
 *   compute, so this is a genuine layering, not a parallel mechanism. Away
 *   from rest, `createBeatOverrideGate` runs its own `GridPulse` (the exact
 *   module the scene-wide grid itself uses) against beatClock's raw beat
 *   count, so a setting parked on "1 bar" reacts once a bar even while the
 *   scene at large is set to Hits, and vice versa.
 * - **Phase** (`kind: "phase"`): for an effect that's a continuous position
 *   (a bar-locked zoom, say) rather than a discrete trigger. The Beat grid
 *   row has nothing to defer to here — gridPulse.ts only ever reshapes
 *   onset/beatPulse, never beatPhase/barPhase — so this picks its own cycle
 *   length directly via `gridPhase`, off beatClock's own free-running beat
 *   count. `rest` is the BeatRate that reproduces the setting's pre-rate
 *   behavior bit for bit (1 for a setting driven off the bare beat, 4 for
 *   one already locked to the bar — BEATS_PER_BAR in beatClock.ts).
 *
 * Both are manual-only: a chosen beat is a musical intent, not something
 * autoTune.ts should resolve from the track.
 */

// ---- phase form -----------------------------------------------------------

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

// ---- override form ----------------------------------------------------

/** A per-setting pin onto one of `BEAT_GRIDS`' stops, or `null` for
 *  "Scene" — the rest state, meaning "whatever the scene's own Beat grid
 *  row currently resolves to". */
export type BeatOverride = BeatGridIndex | null;

export function isBeatOverride(value: number): value is BeatGridIndex {
  return Number.isInteger(value) && value >= 0 && value < BEAT_GRIDS.length;
}

/** One setting's own override gate: a thin wrapper around `GridPulse` (the
 *  same mechanism the scene-wide grid uses) that only runs at all once the
 *  override actually differs from "Scene". */
export interface BeatOverrideGate {
  advance(input: {
    dtSec: number;
    /** beatClock's raw, unwrapped beat count (AnimFrame.beats). */
    beats: number;
    tempoLock: number;
    /** This tick's raw broadband onset (FeatureFrame.onset) — the same
     *  fallback the scene-wide grid itself falls back to before a grid
     *  stop's tempo lock catches up. */
    rawOnset: boolean;
    override: BeatOverride;
    /** anim.onset/anim.beatPulse — already shaped by the scene's own Beat
     *  grid row. Read verbatim, bit for bit, whenever `override` is
     *  `null`. */
    sceneOnset: boolean;
    scenePulse: number;
  }): { onset: boolean; pulse: number };
}

// Matches animClock.ts's BEAT_PULSE_DECAY_PER_SEC — an overridden setting's
// own pulse should decay at the same rate the shared one does.
const PULSE_DECAY_PER_SEC = 6;

export function createBeatOverrideGate(): BeatOverrideGate {
  const grid: GridPulse = createGridPulse();
  let pulse = 0;

  return {
    advance({ dtSec, beats, tempoLock, rawOnset, override, sceneOnset, scenePulse }) {
      if (override === null) return { onset: sceneOnset, pulse: scenePulse };
      const onset = grid.advance(beats, tempoLock, beatGridBeats(override), rawOnset);
      pulse *= Math.exp(-dtSec * PULSE_DECAY_PER_SEC);
      if (onset) pulse = 1;
      return { onset, pulse };
    },
  };
}
