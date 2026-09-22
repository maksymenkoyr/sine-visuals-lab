/**
 * Beat grid: which pulses a `{ source: "beat", grid }` drive
 * (src/render/drives.ts, one setting's `SceneSetting.drive` choice) fires
 * on. "Hits" is the raw broadband onset detector (features.ts) — every
 * kick, snare, hat or fill that clears its threshold, which on a busy mix
 * reads as chaos. The grid stops instead fire from beatClock.ts's
 * phase-locked clock, one pulse per note value, so a setting's beat surge
 * lands like a metronome on the tempo the tracker has locked to, and only
 * then — until it locks, a grid stop falls back to hits (see
 * src/render/gridPulse.ts).
 *
 * Note values name the pulse's length in a 4/4 bar the way a DAW's
 * quantise menu does: 1/4 is one beat, 1/8 half a beat, 1/2 two beats, 1
 * bar four, 2 bars eight. The tracker has no downbeat detector, so a bar
 * starts on whichever beat it happened to lock on — steady, not
 * necessarily musically "on the one".
 *
 * This module only owns the note-value vocabulary now — the choice itself
 * is stored per setting, variant-scoped, in src/render/driveStore.ts (one
 * GridPulse per setting that picks a grid, not one per scene). It used to
 * be its own per-scene store here (a single grid for the whole scene, the
 * same createPerSceneSetting shape as Sensitivity/Expansion/Smoothing);
 * driveStore.ts's header covers the one-time migration that carried a
 * scene's old stored grid onto each of its `beat`-default drive settings.
 * Never auto-tuned: a rhythmic choice, not a level.
 */
export const BEAT_GRIDS = [
  { id: "hits", label: "Hits", beats: null },
  { id: "eighth", label: "1/8", beats: 0.5 },
  { id: "quarter", label: "1/4", beats: 1 },
  { id: "half", label: "1/2", beats: 2 },
  { id: "bar", label: "1 bar", beats: 4 },
  { id: "twoBars", label: "2 bars", beats: 8 },
] as const;

export type BeatGridIndex = number;

export const BEAT_GRID_DEFAULT = 0;

/** Beats per grid pulse for a stored index, or null for Hits. Out-of-range
 *  or non-integer indices round and clamp the way an enum setting does. */
export function beatGridBeats(index: number): number | null {
  const i = Math.min(BEAT_GRIDS.length - 1, Math.max(0, Math.round(index)));
  return BEAT_GRIDS[i].beats;
}

export function beatGridLabel(index: number): string {
  const i = Math.min(BEAT_GRIDS.length - 1, Math.max(0, Math.round(index)));
  return BEAT_GRIDS[i].label;
}

/** The legacy per-scene store key (`vibe.beatGrid`, `{[sceneId]: index}`) —
 *  kept as a bare string, not a live store, purely so driveStore.ts's
 *  one-time migration can read whatever a browser still has under it
 *  without this module offering a get/set API that would suggest it's
 *  still where a grid choice lives. */
export const LEGACY_BEAT_GRID_STORAGE_KEY = "vibe.beatGrid";
