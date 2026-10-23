import { NUM_BANDS } from "./types.ts";

/**
 * Single source of truth for the log-frequency band ladder shared by the
 * analyser (bins -> bands), the band-split UI (crossover sliders), and the
 * spectrum strip (axis labels). All three need the same 40 Hz -> ceiling
 * mapping to agree on what band index N "means" in Hz.
 */
export const MIN_HZ = 40;
export const MAX_HZ_CAP = 16000;

/** The 40 Hz -> ceiling log ladder, length NUM_BANDS + 1. */
export function bandEdgesHz(maxHz: number): Float32Array {
  const edges = new Float32Array(NUM_BANDS + 1);
  for (let i = 0; i <= NUM_BANDS; i++) {
    const t = i / NUM_BANDS;
    edges[i] = MIN_HZ * Math.pow(maxHz / MIN_HZ, t);
  }
  return edges;
}

/** Edge table against the nominal ceiling, for use before a real AudioContext
 *  (and its actual sample rate) exists. */
export function nominalBandEdgesHz(): Float32Array {
  return bandEdgesHz(MAX_HZ_CAP);
}

/** "179 Hz" / "2.2 kHz" — for slider readouts and strip axis labels. */
export function formatHz(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz`;
  return `${Math.round(hz)} Hz`;
}
