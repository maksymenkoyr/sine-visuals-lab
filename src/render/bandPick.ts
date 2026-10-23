import { NUM_BANDS } from "../../audio-subsystem/src/types.ts";

/**
 * "Kick band": one low band, picked by itself, read as a single level.
 *
 * Why one band rather than the low-group average: a narrow band that clearly
 * pulses gives a cleaner kick than an average over the whole low group, which
 * smears the kick together with the bass line and any sustained low tone.
 * Node-based visualizers make users find that band by eye in a spectrum and
 * wire it up by hand. This does the same search live, so the reading follows
 * the music without anyone looking at a spectrum.
 *
 * Candidates are only the bands below the Bands split (`lowMid` from
 * getBandSplit() in audio-subsystem/src/bandSplit.ts), never mid or high bands.
 *
 * The score for each candidate is its standard deviation over roughly
 * PICK_TAU_SEC, computed from an exponential mean of v and of v² per band.
 * A band that goes up and down scores high; a band that sits still scores
 * near zero whatever its level is.
 *
 * Switching is deliberately sticky. A challenger must beat the current band's
 * score by SWITCH_MARGIN, and at least SWITCH_HOLD_SEC must have passed since
 * the last switch. Two equally pulsing bands therefore never trade places back
 * and forth. A switch crossfades the reading over SWITCH_FADE_SEC rather than
 * jumping.
 *
 * On silence (every candidate under SILENCE_LEVEL) the scores and the pick
 * freeze, the same way spectralCentroid.ts freezes through a gap between
 * tracks. Nothing pulses during silence, so there is nothing to learn, and
 * drifting would re-pick on the next track's first beat.
 *
 * If the Bands split moves below the current pick, the pick is re-chosen at
 * once inside the new range rather than holding a band that is no longer low.
 *
 * Computed on every screen from FeatureFrame.bands, which already crosses the
 * wire, so there is no protocol field. Same reasoning as spectralCentroid.ts's
 * header.
 */

const PICK_TAU_SEC = 4; // the window the per-band score is averaged over
const SWITCH_MARGIN = 1.25; // a challenger's score must beat the current one's by this factor
const SWITCH_HOLD_SEC = 2; // minimum time between two switches
export const SWITCH_FADE_SEC = 0.3; // crossfade length across a switch
const SILENCE_LEVEL = 0.03; // below this on every candidate there is no spectrum to learn from — matches spectralCentroid.ts

export interface BandPick {
  /** The picked band's level, 0..1, crossfaded across a switch. */
  readonly value: number;
  /** The band index currently picked. */
  readonly band: number;
  advance(dtSec: number, bands: ArrayLike<number>, lowMid: number): void;
}

export function createBandPick(): BandPick {
  const mean = new Float64Array(NUM_BANDS);
  const meanSq = new Float64Array(NUM_BANDS);
  let seeded = false;
  let current = 0;
  let previous = 0;
  let fade = 1;
  let sinceSwitch = 0;
  let value = 0;

  const score = (b: number): number => Math.sqrt(Math.max(0, meanSq[b] - mean[b] * mean[b]));

  return {
    get value(): number {
      return value;
    },
    get band(): number {
      return current;
    },
    advance(dtSec: number, bands: ArrayLike<number>, lowMid: number): void {
      const n = Math.min(NUM_BANDS, Math.max(1, Math.round(lowMid)));

      if (!seeded) {
        for (let b = 0; b < NUM_BANDS; b++) {
          mean[b] = bands[b];
          meanSq[b] = bands[b] * bands[b];
        }
        seeded = true;
      }

      let silent = true;
      for (let b = 0; b < n; b++) {
        if (bands[b] >= SILENCE_LEVEL) {
          silent = false;
          break;
        }
      }

      if (dtSec > 0 && !silent) {
        const a = 1 - Math.exp(-dtSec / PICK_TAU_SEC);
        for (let b = 0; b < n; b++) {
          const v = bands[b];
          mean[b] += (v - mean[b]) * a;
          meanSq[b] += (v * v - meanSq[b]) * a;
        }
        sinceSwitch += dtSec;
      }

      let best = 0;
      let bestScore = -1;
      for (let b = 0; b < n; b++) {
        const s = score(b);
        if (s > bestScore) {
          bestScore = s;
          best = b;
        }
      }

      if (current >= n) {
        previous = current = best;
        fade = 1;
        sinceSwitch = 0;
      } else if (
        !silent &&
        sinceSwitch >= SWITCH_HOLD_SEC &&
        best !== current &&
        score(best) > score(current) * SWITCH_MARGIN
      ) {
        previous = current;
        current = best;
        fade = 0;
        sinceSwitch = 0;
      }
      if (previous >= n) previous = current; // the split moved mid-crossfade: don't fade from a band that's no longer low

      if (dtSec > 0) fade = Math.min(1, fade + dtSec / SWITCH_FADE_SEC);
      const mix = bands[previous] * (1 - fade) + bands[current] * fade;
      value = Math.min(1, Math.max(0, mix));
    },
  };
}
