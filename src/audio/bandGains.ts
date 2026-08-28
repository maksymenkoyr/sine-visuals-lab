import { NUM_BANDS, type FeatureFrame } from "./types.ts";
import { getBandSplit } from "./bandSplit.ts";
import { createPerSceneSetting } from "./sensitivity.ts";

/**
 * Per-scene band gain and tilt — the DJ-mixer-style controls this app
 * actually wants: not "which frequencies count as bass" (that's the fixed
 * crossover in bandSplit.ts) but "how hard does bass drive the visuals".
 * Two shapes of the same idea:
 *
 * - Low/Mid/High gain: a step per group, split at the crossover.
 * - Tilt: a smooth curve across the whole band ladder, leaning the picture
 *   toward the highs or the lows without a hard edge anywhere.
 *
 * Both are per-scene like sensitivity.ts/contrast, not global like
 * bandSplit.ts, since a gain is a preference for one scene's look, not a
 * description of the room. See deviceMenu.ts's Bands box for the UI.
 *
 * Why tilt exists at all: features.ts's per-band adaptive floor/peak means
 * every band self-normalizes to [0,1], so the natural roll-off of a real
 * spectrum never survives to the visuals — a hi-hat band bounces exactly as
 * hard as the kick band. Tilt is the one place that lean can be put back.
 */

// The store's real range: 0 is a full kill (a group stops driving anything),
// 4 is max boost. Matches Sensitivity/Contrast's ceiling so all the gain
// rows in the panel feel the same at their loud end.
export const BAND_GAIN_MIN = 0;
export const BAND_GAIN_MAX = 4;
export const BAND_GAIN_DEFAULT = 1;

// UI-only: the log-mapped slider's positions 1..100 span down to this floor,
// not all the way to 0 (log(0) is undefined) — position 0 snaps straight to
// BAND_GAIN_MIN instead. Kept here, next to the store range it's paired
// with, rather than in deviceMenu.ts.
export const BAND_GAIN_LOG_FLOOR = 0.25;

// Tilt is bipolar: positive leans toward the highs (the low end rolls off),
// negative leans toward the lows (the high end rolls off), 0 is flat.
export const BAND_TILT_MIN = -1;
export const BAND_TILT_MAX = 1;
export const BAND_TILT_DEFAULT = 0;

// The weight the far end of the ladder gets at full tilt; the favored end
// always stays at 1. Attenuate-only by design: a tilt can never push a band
// into applyBandGains's clip at 1, only pull a boosted group back out of it.
// The curve is exponential in band index — and since bandScale.ts's
// bandEdgesHz lays the bands out in log frequency, that's a constant number
// of dB per octave, which is what "spectral tilt" means everywhere else.
export const TILT_FAR_END_WEIGHT = 0.1;

export type BandGroup = "low" | "mid" | "high";

export interface BandGains {
  low: number;
  mid: number;
  high: number;
  tilt: number;
}

const stores: Record<BandGroup, ReturnType<typeof createPerSceneSetting>> = {
  low: createPerSceneSetting("vibe.bandGain.low", BAND_GAIN_MIN, BAND_GAIN_MAX, BAND_GAIN_DEFAULT),
  mid: createPerSceneSetting("vibe.bandGain.mid", BAND_GAIN_MIN, BAND_GAIN_MAX, BAND_GAIN_DEFAULT),
  high: createPerSceneSetting("vibe.bandGain.high", BAND_GAIN_MIN, BAND_GAIN_MAX, BAND_GAIN_DEFAULT),
};

const tiltStore = createPerSceneSetting("vibe.bandTilt", BAND_TILT_MIN, BAND_TILT_MAX, BAND_TILT_DEFAULT);

export function getBandGains(sceneId: string): BandGains {
  return {
    low: stores.low.get(sceneId),
    mid: stores.mid.get(sceneId),
    high: stores.high.get(sceneId),
    tilt: tiltStore.get(sceneId),
  };
}

export function getBandGain(sceneId: string, group: BandGroup): number {
  return stores[group].get(sceneId);
}

export function setBandGain(sceneId: string, group: BandGroup, value: number): void {
  stores[group].set(sceneId, value);
}

export function getBandTilt(sceneId: string): number {
  return tiltStore.get(sceneId);
}

export function setBandTilt(sceneId: string, value: number): void {
  tiltStore.set(sceneId, value);
}

/** Returns every group gain and the tilt to their defaults — the Bands
 *  card's one Reset chip covers all of them. */
export function resetBandGains(sceneId: string): void {
  for (const group of ["low", "mid", "high"] as const) {
    stores[group].set(sceneId, BAND_GAIN_DEFAULT);
  }
  tiltStore.set(sceneId, BAND_TILT_DEFAULT);
}

// Reused across calls to avoid a per-frame allocation in the render loop.
const scratchBands = new Float32Array(NUM_BANDS);

// The per-band tilt weights, rebuilt only when the tilt value changes so the
// pow() cost lands on slider movement, not on every frame.
const tiltWeights = new Float32Array(NUM_BANDS).fill(1);
let tiltWeightsFor = BAND_TILT_DEFAULT;

/** Weight for band `b` at a given tilt, in [TILT_FAR_END_WEIGHT, 1]. The
 *  favored end sits at exponent 0 (weight 1); the far end reaches the full
 *  exponent (TILT_FAR_END_WEIGHT) at |tilt| = 1. */
export function tiltWeight(b: number, tilt: number): number {
  if (tilt === 0) return 1;
  const t = b / (NUM_BANDS - 1);
  const exponent = tilt > 0 ? tilt * (1 - t) : -tilt * t;
  return Math.pow(TILT_FAR_END_WEIGHT, exponent);
}

function refreshTiltWeights(tilt: number): void {
  if (tilt === tiltWeightsFor) return;
  tiltWeightsFor = tilt;
  for (let b = 0; b < NUM_BANDS; b++) tiltWeights[b] = tiltWeight(b, tilt);
}

/**
 * Scales each band by its group's gain — low/mid/high, split at the current
 * (fixed, no-longer-user-facing) crossover from bandSplit.ts — and by the
 * tilt curve, in one pass, before anything downstream reads the frame.
 * Applied upstream of both animClock.advance (bandEnergy.ts's group levels/
 * pulses/onsets) and applySensitivity (the uBands shader uniform), so one
 * control governs both. Result is re-clamped to [0,1] since features.ts's
 * contract is that bands stay normalized (see clamp01 there) and a >1x gain
 * can otherwise punch through that; the tilt weight is always <= 1 so it
 * can only pull a value back under the clip, never into it.
 * energy/level/beat/bpm/beatPhase pass through untouched — this is a
 * per-band control, not a broadband one (that's Sensitivity/Contrast's
 * job), and level in particular must stay the raw, un-gained reading: it's
 * auto mode's input signal (see types.ts), so shaping it here would feed the
 * gain stage its own output, same as applySensitivity.
 */
export function applyBandGains(frame: FeatureFrame, gains: BandGains): FeatureFrame {
  if (
    gains.low === BAND_GAIN_DEFAULT &&
    gains.mid === BAND_GAIN_DEFAULT &&
    gains.high === BAND_GAIN_DEFAULT &&
    gains.tilt === BAND_TILT_DEFAULT
  ) {
    return frame;
  }

  refreshTiltWeights(gains.tilt);
  const { lowMid, midHigh } = getBandSplit();
  for (let b = 0; b < NUM_BANDS; b++) {
    const gain = b < lowMid ? gains.low : b < midHigh ? gains.mid : gains.high;
    scratchBands[b] = Math.min(1, frame.bands[b] * gain * tiltWeights[b]);
  }

  return {
    time: frame.time,
    bands: scratchBands,
    energy: frame.energy,
    beat: frame.beat,
    bpm: frame.bpm,
    beatPhase: frame.beatPhase,
    level: frame.level,
  };
}
