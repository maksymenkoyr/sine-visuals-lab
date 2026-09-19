/**
 * The shared diagnostic shape every onset detector's per-frame reading
 * takes — FeatureExtractor.onsetDiag (features.ts) and each of
 * bandEnergy.ts's lowDiag/midDiag/highDiag — so the meters panel
 * (src/ui/audioMeters.ts's hits history) can render all four the same way.
 * This file owns no gate of its own: the actual silence gate a detector
 * weights its firing comparison by lives in src/audio/silenceGate.ts (two
 * marks, a smoothstepped dimmer) — see that file's header for how `gated`
 * below comes about. verdictOf turns a detector's own `fired` flag plus its
 * OnsetDiag into one of four mutually exclusive outcomes, in priority
 * order: a hit that both cleared the gated comparison and landed inside the
 * refractory is "blocked", not "miss". (`gated` and `blocked` can't both be
 * true for the same reading — a detector is either stopped by the silence
 * gate or checking its refractory, never both — so this ordering and a
 * blocked-before-gated one used for display priority elsewhere never
 * actually disagree.)
 */

export interface OnsetDiag {
  /** This frame's trigger reading over its firing threshold — 1 is a bare
   *  trigger, above 1 fired, below 1 a near-miss. Same reading
   *  FeatureExtractor.fluxRatio has always exposed for the broadband
   *  detector; bandEnergy.ts carries the equivalent per band-group. Always
   *  the raw, ungated score — see silenceGate.ts's header for why the gate
   *  never touches this. */
  ratio: number;
  /** Cleared the raw threshold, but the silence gate's dimmer (see
   *  silenceGate.ts) stopped the gated comparison from clearing it too. */
  gated: boolean;
  /** Cleared the gated comparison, but landed inside the refractory window
   *  since this detector's last onset. */
  blocked: boolean;
  /** Seconds since this detector's last onset actually fired. */
  sinceOnsetSec: number;
}

export type OnsetVerdict = "fired" | "gated" | "blocked" | "miss";

/** fired > gated > blocked > miss — see file header for why the two
 *  mutually-exclusive flags never make that ordering ambiguous. */
export function verdictOf(fired: boolean, d: OnsetDiag): OnsetVerdict {
  if (fired) return "fired";
  if (d.gated) return "gated";
  if (d.blocked) return "blocked";
  return "miss";
}
