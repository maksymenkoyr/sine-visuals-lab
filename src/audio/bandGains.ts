import { NUM_BANDS, type FeatureFrame } from "./types.ts";
import { getBandSplit } from "./bandSplit.ts";
import { createPerSceneSetting } from "./sensitivity.ts";

/**
 * Per-scene low/mid/high band gain — the DJ-mixer-style control this app
 * actually wants: not "which frequencies count as bass" (that's the fixed
 * crossover in bandSplit.ts) but "how hard does bass drive the visuals".
 * Per-scene like sensitivity.ts/contrast, not global like bandSplit.ts,
 * since a gain is a preference for one scene's look, not a description of
 * the room. See deviceMenu.ts's Bands box for the UI.
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

export type BandGroup = "low" | "mid" | "high";

export interface BandGains {
  low: number;
  mid: number;
  high: number;
}

const stores: Record<BandGroup, ReturnType<typeof createPerSceneSetting>> = {
  low: createPerSceneSetting("vibe.bandGain.low", BAND_GAIN_MIN, BAND_GAIN_MAX, BAND_GAIN_DEFAULT),
  mid: createPerSceneSetting("vibe.bandGain.mid", BAND_GAIN_MIN, BAND_GAIN_MAX, BAND_GAIN_DEFAULT),
  high: createPerSceneSetting("vibe.bandGain.high", BAND_GAIN_MIN, BAND_GAIN_MAX, BAND_GAIN_DEFAULT),
};

export function getBandGains(sceneId: string): BandGains {
  return {
    low: stores.low.get(sceneId),
    mid: stores.mid.get(sceneId),
    high: stores.high.get(sceneId),
  };
}

export function getBandGain(sceneId: string, group: BandGroup): number {
  return stores[group].get(sceneId);
}

export function setBandGain(sceneId: string, group: BandGroup, value: number): void {
  stores[group].set(sceneId, value);
}

export function resetBandGains(sceneId: string): void {
  for (const group of ["low", "mid", "high"] as const) {
    stores[group].set(sceneId, BAND_GAIN_DEFAULT);
  }
}

// Reused across calls to avoid a per-frame allocation in the render loop.
const scratchBands = new Float32Array(NUM_BANDS);

/**
 * Scales each band by its group's gain — low/mid/high, split at the current
 * (fixed, no-longer-user-facing) crossover from bandSplit.ts — before
 * anything downstream reads the frame. Applied upstream of both
 * animClock.advance (bandEnergy.ts's group levels/pulses/onsets) and
 * applySensitivity (the uBands shader uniform), so one control governs both.
 * Result is re-clamped to [0,1] since features.ts's contract is that bands
 * stay normalized (see clamp01 there) and a >1x gain can otherwise punch
 * through that. energy/level/beat/bpm/beatPhase pass through untouched —
 * this is a per-band control, not a broadband one (that's Sensitivity/
 * Contrast's job), and level in particular must stay the raw, un-gained
 * reading: it's auto mode's input signal (see types.ts), so shaping it here
 * would feed the gain stage its own output, same as applySensitivity.
 */
export function applyBandGains(frame: FeatureFrame, gains: BandGains): FeatureFrame {
  if (gains.low === BAND_GAIN_DEFAULT && gains.mid === BAND_GAIN_DEFAULT && gains.high === BAND_GAIN_DEFAULT) {
    return frame;
  }

  const { lowMid, midHigh } = getBandSplit();
  for (let b = 0; b < NUM_BANDS; b++) {
    const gain = b < lowMid ? gains.low : b < midHigh ? gains.mid : gains.high;
    scratchBands[b] = Math.min(1, frame.bands[b] * gain);
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
