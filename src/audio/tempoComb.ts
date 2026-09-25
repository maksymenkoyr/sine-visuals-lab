/**
 * The pair-comb tempo estimator — shared by features.ts's render-tick onset
 * pipeline (registerOnset, recency 0: every onset in the window votes
 * equally regardless of age) and tempoAnalyzer.ts's fixed-hop pipeline
 * (recencySec > 0, so a stale pairing fades out as a tempo changes). Given a
 * rolling set of timestamped, weighted onsets, this scores every candidate
 * tempo period by how many *pairwise onset gaps* land on a whole number of
 * its beats, rather than by the mode of adjacent gaps (see features.ts's own
 * history for why: a decaying percussion tail's extra onset makes adjacent
 * gaps alternate short/long, and neither reading is the true tempo) or an
 * autocorrelation of the flux envelope (tried and rejected for
 * tempoAnalyzer.ts — it locks onto half/double time under a busy pattern
 * more readily than a comb over exact onset times does, and can't recover
 * from a tempo step as fast as recency weighting here lets it).
 *
 * A pair's vote is worth the *weaker* of its two onsets (a real hit paired
 * with a noise blip is still a noise gap), optionally decayed by how long
 * ago the later onset fired (opts.recencySec — see the recency doc below),
 * and every candidate period is biased by tempoPrior toward the tempo octave
 * most music actually sits in, breaking ties a busy subdivision (e.g. a
 * hi-hat pattern whose 4:3 ratio of the true beat fits its own gaps just as
 * exactly) would otherwise win outright. Hysteresis (opts.switchMargin)
 * keeps the estimate on the currently-held tempo unless a rival clearly
 * outscores it, and the returned bpm is refined past the candidate-period
 * grid by averaging every gap that actually fits the winner.
 */

export const BPM_MIN = 70;
export const BPM_MAX = 180;

// How long a caller should hold its own bpm/onset history after the last
// onset before letting it decay back to 0 — shared by features.ts's
// registerOnset and tempoAnalyzer.ts's analyseHop so a locked tempo doesn't
// stick around forever once the onsets sustaining it actually stop (see
// features.ts's own header comment on why: without this, beatClock.ts's
// tempoLock had nothing to ease back down toward). Not itself read by
// estimateTempo below — each caller applies it to its own state.
export const TEMPO_DECAY_SEC = 3;

const TEMPO_PRIOR_BPM = 120;
const TEMPO_PRIOR_OCTAVES = 1;

function tempoPrior(bpm: number): number {
  const octaves = Math.log2(bpm / TEMPO_PRIOR_BPM) / TEMPO_PRIOR_OCTAVES;
  return Math.exp(-0.5 * octaves * octaves);
}

// How far apart two onsets may sit and still form a pair candidate — beyond
// this, a gap is too long to usefully constrain any tempo in the searched
// range, and only wastes the O(n^2) pair walk. Ascending onset order means a
// pair loop can break (not continue) the moment a gap exceeds this.
const MAX_PAIR_GAP_SEC = 4;

export interface TempoOnsetVote {
  time: number;
  weight: number;
}

export interface TempoCombOptions {
  /** How far off a whole number of beats a pair's gap may land and still
   *  count for a candidate period, in seconds — see features.ts's
   *  COMB_TOL_SEC for why this is in seconds, not beats. */
  tolSec: number;
  /** Tighter tolerance for the post-hoc beat-length refinement than for
   *  picking the winning period — see features.ts's REFINE_TOL_SEC. */
  refineTolSec: number;
  /** > 0: a pair's vote decays by how long ago (against `now`) its later
   *  onset fired, with this as the exponential time constant — lets the
   *  estimate follow a tempo step faster than an unweighted window would,
   *  since stale pairings from before the step stop outvoting fresh ones.
   *  0 (features.ts's call): no decay, every onset in the window votes
   *  equally regardless of age — today's render-tick behaviour. */
  recencySec: number;
  /** A rival period must outscore the currently-held tempo by this factor
   *  to replace it — see features.ts's TEMPO_SWITCH_MARGIN. */
  switchMargin: number;
  /** Step size the candidate-period grid search advances by. */
  periodStepSec: number;
  bpmMin: number;
  bpmMax: number;
}

/** Returns a refined bpm, or null when there isn't enough evidence yet (fewer
 *  than three onsets) or no candidate period scored above zero — in either
 *  case the caller should leave its own held bpm exactly as it was, not
 *  reset it. `onsets` must be ascending by time. `currentBpm` is the caller's
 *  held tempo (0 for none) — only used for the hysteresis check above. */
export function estimateTempo(onsets: TempoOnsetVote[], now: number, currentBpm: number, opts: TempoCombOptions): number | null {
  const n = onsets.length;
  if (n < 3) return null;

  const gaps: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const gap = onsets[j]!.time - onsets[i]!.time;
      if (gap > MAX_PAIR_GAP_SEC) break; // ascending, so later j are further still
      gaps.push(gap);
      const recency = opts.recencySec > 0 ? Math.exp(-(now - onsets[j]!.time) / opts.recencySec) : 1;
      weights.push(Math.min(onsets[i]!.weight, onsets[j]!.weight) * recency);
    }
  }

  const combScore = (period: number): number => {
    let score = 0;
    for (let g = 0; g < gaps.length; g++) {
      const k = Math.round(gaps[g]! / period);
      if (k < 1) continue;
      const err = Math.abs(gaps[g]! - k * period);
      if (err >= opts.tolSec) continue;
      score += ((1 - err / opts.tolSec) * weights[g]!) / k;
    }
    // See tempoPrior's own doc above — hysteresis below calls this same
    // function for the current tempo too, so the prior weights that
    // comparison exactly the same way, on purpose.
    return score * tempoPrior(60 / period);
  };

  const periodMin = 60 / opts.bpmMax;
  const periodMax = 60 / opts.bpmMin;
  let bestPeriod = 0;
  let bestScore = 0;
  for (let period = periodMin; period <= periodMax + 1e-9; period += opts.periodStepSec) {
    const score = combScore(period);
    if (score > bestScore) {
      bestScore = score;
      bestPeriod = period;
    }
  }
  if (bestPeriod === 0) return null;

  // Hysteresis: stay on the current tempo unless the rival clearly wins. The
  // refinement below still follows genuine drift, since it re-measures the
  // beat length from whatever gaps fit.
  if (currentBpm > 0) {
    const current = 60 / currentBpm;
    if (current >= periodMin && current <= periodMax && bestScore < combScore(current) * opts.switchMargin) {
      bestPeriod = current;
    }
  }

  // Refine past the candidate grid: the mean beat length implied by every
  // gap that fits the winner.
  let sum = 0;
  let total = 0;
  for (let g = 0; g < gaps.length; g++) {
    const k = Math.round(gaps[g]! / bestPeriod);
    if (k < 1 || Math.abs(gaps[g]! - k * bestPeriod) >= opts.refineTolSec) continue;
    sum += (gaps[g]! / k) * weights[g]!;
    total += weights[g]!;
  }
  return total > 0 ? 60 / (sum / total) : null;
}
