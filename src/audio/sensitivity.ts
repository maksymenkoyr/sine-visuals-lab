import { NUM_BANDS, type FeatureFrame } from "./types.ts";

/**
 * Sensitivity, Expansion and Smoothing: three visual stages on top of
 * FeatureExtractor's normalized [0,1] output ("react harder" / "calm down",
 * "more punch" / "flatter", "snappier" / "smoother"). None is a setting:
 * autoTune.ts's resolveSensitivity, resolveExpansion and resolveSmoothing
 * pick each one per scene from the music, since each scene's shader weights
 * uEnergy/uBands differently. This file holds their ranges and curves.
 *
 * Smoothing is a multiplier on the pipeline's own easing, not the easing
 * itself — SMOOTHING_DEFAULT (1x) means "the designed amount", not "none".
 */

export const SENSITIVITY_MIN = 0.25;
export const SENSITIVITY_MAX = 4;
export const SENSITIVITY_DEFAULT = 1;

export const EXPANSION_MIN = 0.25;
export const EXPANSION_MAX = 4;
export const EXPANSION_DEFAULT = 1;

export const SMOOTHING_MIN = 0.25;
export const SMOOTHING_MAX = 4;
export const SMOOTHING_DEFAULT = 1;

/**
 * The sensitivity response curve applied to a single [0,1] level: out = in^(1/s).
 * Fixed at 0 and 1, so this reshapes detail in between rather than clipping
 * like a plain multiply would. s > 1 lifts quiet detail (more reactive);
 * s < 1 pushes it down (calmer). Shared by applySensitivity (render path) and
 * the device menu's level wash (UI path) so the two can't drift.
 */
export function shapeLevel(level: number, sensitivity: number): number {
  return Math.pow(level, 1 / sensitivity);
}

// Steepness at the far ends of the slider. 3 puts 4× at roughly the old
// pow-based curve's overall strength, so per-scene values saved under that
// curve still feel about right after the swap.
const EXPANSION_K = 3;

/**
 * The expansion response curve: a tanh S-curve pivoting at the midpoint
 * (0.5). Unlike shapeLevel (which lifts or lowers everything together), this
 * pushes values *above* the midpoint higher and values *below* it lower —
 * widening the gap between quiet and loud, so the visual response ramps
 * more sharply as the music gets louder — at intensity `expansion`.
 * Fixed at 0, 0.5, and 1. expansion > 1 widens the gap (more punch);
 * expansion < 1 narrows it (flatter, more compressed); 1 is identity.
 *
 * Chosen over a plain power curve (the old shapeDynamics) because a power
 * curve has infinite slope right at the pivot: a level drifting across 0.5
 * slams from one side to the other. tanh has a finite, steepest-at-the-middle
 * slope that tapers smoothly into both ends instead.
 */
export function shapeExpansion(level: number, expansion: number): number {
  const s = Math.log(expansion); // 0 at 1x -> identity
  if (Math.abs(s) < 1e-6) return level;
  const k = Math.abs(s) * EXPANSION_K;
  const half = Math.tanh(k / 2);
  if (s > 0) {
    // > 1x expands: steep-but-finite through the pivot, easing into 0 and 1.
    return 0.5 + Math.tanh(k * (level - 0.5)) / (2 * half);
  }
  // < 1x compresses: the exact inverse of the expand branch, so e.g. 2x
  // followed by 0.5x undoes back to the original level. shapeLevel's
  // Math.pow can feed this values slightly outside [0,1], which would send
  // atanh's argument out of (-1, 1) — clamp to keep it finite.
  const c = (2 * level - 1) * half;
  return 0.5 + Math.atanh(Math.min(1 - 1e-12, Math.max(-1 + 1e-12, c))) / k;
}

/**
 * Smoothing scales every visual envelope's decay/slew rate — how fast the
 * visuals chase the audio, independent of Sensitivity's gain and
 * Expansion's curve. The slow half (smoothing > 1) is linear: 4x smoothing means
 * quarter-rate, so a scene fully settles into a calm swell. The fast half
 * is square-rooted instead of linear: at 0.25x this is only 2x the rate,
 * not 4x. That asymmetry is deliberate, not stylistic — the level slew this
 * feeds (bandEnergy.ts's LEVEL_SLEW_PER_SEC) doubles as the strobe guard
 * that keeps geometry-driving uniforms from jumping most of the way to a
 * new value in one frame, so "snappier" gets a shorter leash than
 * "smoother". Continuous at 1x (both branches equal 1 there).
 *
 * At 0 this is 1/sqrt(0) = Infinity, and every stage it reaches treats a
 * non-finite scale as "assign the target directly". Auto never resolves
 * there (SMOOTHING_MIN); a DEV tuning override can.
 */
export function smoothingRateScale(smoothing: number): number {
  return smoothing >= 1 ? 1 / smoothing : 1 / Math.sqrt(smoothing);
}

// Reused across calls to avoid a per-frame allocation in the render loop.
const scratchBands = new Float32Array(NUM_BANDS);

/**
 * Applies the sensitivity gain and then the expansion curve to a frame's
 * [0,1] band/energy values. onset/pulseOnset/bpm/onsetPhase/time/level/hats/
 * lead/engine pass through untouched — both are a visual gain, not a beat-detection
 * threshold, and `level` specifically must stay the raw, un-gained reading:
 * it's auto mode's input signal for driving these very sliders (see
 * musicProfile.ts), so shaping it here would feed the gain stage its own
 * output.
 */
export function applySensitivity(frame: FeatureFrame, sensitivity: number, expansion: number): FeatureFrame {
  if (sensitivity === SENSITIVITY_DEFAULT && expansion === EXPANSION_DEFAULT) return frame;

  for (let b = 0; b < NUM_BANDS; b++) {
    scratchBands[b] = shapeExpansion(shapeLevel(frame.bands[b], sensitivity), expansion);
  }

  return {
    time: frame.time,
    bands: scratchBands,
    energy: shapeExpansion(shapeLevel(frame.energy, sensitivity), expansion),
    onset: frame.onset,
    pulseOnset: frame.pulseOnset,
    bpm: frame.bpm,
    onsetPhase: frame.onsetPhase,
    level: frame.level,
    hats: frame.hats,
    lead: frame.lead,
    engine: frame.engine,
    song: frame.song,
  };
}
