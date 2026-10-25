/**
 * The low/mid/high crossover over the band ladder (bandScale.ts): which of
 * FeatureFrame.bands count as Bass, Mid and Treble for src/render/bandEnergy.ts's
 * loudness, the strip's tints, Lead and Hats' ranges and the band faders' lane
 * weights. Fixed: the engine's own crossovers (engine/bands.ts's DEFAULT_BANDS)
 * are the ones its bench measured, and a split that moved the ladder's ranges
 * without them would name a different Bass than the engine hears.
 */
export interface BandSplit {
  /** Band index where "low" ends and "mid" begins. */
  lowMid: number;
  /** Band index where "mid" ends and "high" begins. */
  midHigh: number;
}

export const BAND_SPLIT: Readonly<BandSplit> = { lowMid: 6, midHigh: 16 };
