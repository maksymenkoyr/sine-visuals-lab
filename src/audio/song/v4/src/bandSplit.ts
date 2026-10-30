// Copied from audio-subsystem/v6/src/song/v4 (2026-10-30, #798/#800), which is v4's code with the browser-storage reads and writes cut; the bench check (bench-signals' probe app-song) holds it equal to v6. Edits: unused code removed, and the storage it no longer reads (the saved split, its reload hook, the setters) with it: the split is always the default.

/**
 * The low/mid/high crossover for bandEnergy.ts. In the app it is a saved,
 * tunable setting; the song layer never reads the saved one, so it is the
 * default, which reproduces bandEnergy.ts's hardcoded split exactly.
 */
export interface BandSplit {
  /** Band index where "low" ends and "mid" begins. */
  lowMid: number;
  /** Band index where "mid" ends and "high" begins. */
  midHigh: number;
}

// LOW_BANDS = [0..5], MID_BANDS = [6..15], HIGH_BANDS = [16..23].
const LOW_MID_DEFAULT = 6;
const MID_HIGH_DEFAULT = 16;

const SPLIT: BandSplit = { lowMid: LOW_MID_DEFAULT, midHigh: MID_HIGH_DEFAULT };

export function getBandSplit(): BandSplit {
  return SPLIT;
}

/** Bumped on every change, so a consumer can cheaply detect one; the split never changes here. */
export function bandSplitVersion(): number {
  return 0;
}
