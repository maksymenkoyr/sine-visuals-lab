// Tracks the song's *macro* dynamics — a quiet verse building into a chorus,
// the hit of a drop — as distinct from per-beat energy. FeatureFrame.energy
// already reflects loudness frame to frame, but it moves on a beat's
// timescale (and is already auto-normalized per band by features.ts); it
// can't tell "a loud section just started" from "one loud beat." This layers
// a second, much slower adaptive floor/ceiling on top of a phrase-length
// trend of energy — the same leaky-min/max idea features.ts uses to
// normalize each band, stretched from a fraction of a second out to
// ~10-40s, the length of a verse or a build, so it settles into where the
// *current section* sits within the track's own observed dynamic range.
const FAST_LEVEL_RATE = 0.7; // ~1.4s time constant — rides out individual hits, tracks the phrase
const FLOOR_RISE_RATE = 0.05; // floor creeping up while it stays loud (~20s)
const FLOOR_FALL_RATE = 0.3; // floor dropping to follow a true quiet section (~3.3s)
const CEIL_RISE_RATE = 0.5; // ceiling jumping up into a loud section (~2s)
const CEIL_FALL_RATE = 0.08; // ceiling relaxing back down after it passes (~12s)
const MIN_RANGE = 0.12; // never let (ceil - floor) collapse near zero and blow up the ratio
const INTENSITY_SLEW = 1.2; // final smoothing so section changes read as a swell, not a snap

const DROP_RATE_THRESHOLD = 0.35; // d(intensity)/dt above this reads as "a drop just happened"
const DROP_PULSE_DECAY = 2.5;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export interface SectionIntensity {
  /** Smoothed [0,1] position of the current phrase's loudness within the
   *  song's own observed dynamic range — low in a quiet verse, high in a
   *  chorus or drop. Adapts to the track, not an absolute loudness level. */
  readonly intensity: number;
  /** This tick's target for `intensity`, before INTENSITY_SLEW — the section's
   *  raw position in the track's dynamic range, jumping frame to frame rather
   *  than easing. For the meters panel's RAW chip (src/ui/audioMeters.ts). */
  readonly rawIntensity: number;
  /** One-shot edge (like FeatureFrame.beat), true only on the tick intensity
   *  is rising fast enough to read as a drop/section change. */
  readonly dropOnset: boolean;
  /** Decaying [0,1] flash that jumps to 1 on dropOnset — smoother to animate
   *  against than the raw boolean, same shape as beatPulse. */
  readonly dropPulse: number;
  /** rateScale multiplies INTENSITY_SLEW only — sensitivity.ts's
   *  smoothingRateScale, defaulting to 1 (today's behavior). The fastLevel/
   *  floor/ceil trackers above stay at their own fixed rates regardless:
   *  they're the room/track measurement rawIntensity already exposes
   *  unsmoothed, not display easing. Non-finite (Smoothing's Off stop)
   *  assigns `target` to `intensity` directly, so it lands exactly on
   *  rawIntensity with none of the blend's floating-point rounding at
   *  "coefficient 1" — see the meters panel's RAW chip (audioMeters.ts). */
  advance(dtSec: number, energy: number, rateScale?: number): void;
}

export function createSectionIntensity(): SectionIntensity {
  let fastLevel = 0;
  let floor = 0;
  let ceil = 0.3; // non-zero seed so an early loud onset doesn't read as a "drop" from a degenerate 0-width range
  let intensity = 0;
  let dropPulse = 0;
  let wasDropping = false;

  const state: SectionIntensity = {
    intensity: 0,
    rawIntensity: 0,
    dropOnset: false,
    dropPulse: 0,
    advance(dtSec: number, energy: number, rateScale = 1): void {
      const e = clamp01(energy);
      fastLevel += (e - fastLevel) * Math.min(1, FAST_LEVEL_RATE * dtSec);

      const floorRate = fastLevel < floor ? FLOOR_FALL_RATE : FLOOR_RISE_RATE;
      floor += (fastLevel - floor) * Math.min(1, floorRate * dtSec);
      const ceilRate = fastLevel > ceil ? CEIL_RISE_RATE : CEIL_FALL_RATE;
      ceil += (fastLevel - ceil) * Math.min(1, ceilRate * dtSec);

      const range = Math.max(MIN_RANGE, ceil - floor);
      const target = clamp01((fastLevel - floor) / range);

      const prevIntensity = intensity;
      if (Number.isFinite(rateScale)) {
        intensity += (target - intensity) * Math.min(1, INTENSITY_SLEW * rateScale * dtSec);
      } else {
        intensity = target;
      }

      const rate = dtSec > 1e-4 ? (intensity - prevIntensity) / dtSec : 0;
      // dropOnset is a one-shot *edge*, not the level "rising fast right now":
      // intensity climbs above DROP_RATE_THRESHOLD for a run of consecutive
      // ticks during a single swell, and consumers (Storm's strike burst,
      // Caustics' rings) treat each true tick as its own drop. The latch fires
      // once per swell; release sits below the trigger so rate wobbling at the
      // threshold can't re-fire mid-swell.
      const dropping = rate > (wasDropping ? DROP_RATE_THRESHOLD * 0.5 : DROP_RATE_THRESHOLD);
      const dropOnset = dropping && !wasDropping;
      wasDropping = dropping;
      dropPulse *= Math.exp(-dtSec * DROP_PULSE_DECAY);
      if (dropOnset) dropPulse = 1;

      (state as { intensity: number }).intensity = intensity;
      (state as { rawIntensity: number }).rawIntensity = target;
      (state as { dropOnset: boolean }).dropOnset = dropOnset;
      (state as { dropPulse: number }).dropPulse = dropPulse;
    },
  };

  return state;
}
