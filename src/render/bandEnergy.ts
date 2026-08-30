import { NUM_BANDS } from "../audio/types.ts";
import { getBandSplit, bandSplitVersion } from "../audio/bandSplit.ts";

// Splits the 24 log-spaced bands into low/mid/high groups and derives, per
// group: a slewed continuous level (safe to drive geometry with — it can't
// strobe) and a decaying onset pulse plus one-shot edge (the same
// beatPulse/beat shape already used for the whole spectrum in app.ts, just
// scoped to a frequency range) so a kick and a hat can drive visibly
// different things instead of both hiding inside one broadband uEnergy.
//
// The low/mid boundary and mid/high boundary are user-tunable (config panel
// Bands box, src/audio/bandSplit.ts) rather than hardcoded, so "how low does
// a kick have to be" is something a user can place against the actual music.

const LEVEL_SLEW_PER_SEC = 10; // smooths the continuous level so geometry-driving uniforms can't strobe

interface GroupSpec {
  lo: number; // inclusive band index
  hi: number; // exclusive band index
  baselineRate: number;
  pulseDecayRate: number;
  triggerMult: number;
  triggerMargin: number;
}

// Baseline/decay rates differ per group on purpose: bass hits are slower and
// sustain longer (a kick has body), so its baseline adapts slowly and its
// pulse decays slowly; treble is transient (a hat is a click), so it adapts
// and decays fast. These are tied to the group's *role*, not its band
// indices, so they don't change when the crossovers move.
const GROUP_TUNING: Record<"low" | "mid" | "high", Omit<GroupSpec, "lo" | "hi">> = {
  low: { baselineRate: 2, pulseDecayRate: 3.5, triggerMult: 1.5, triggerMargin: 0.05 },
  mid: { baselineRate: 3, pulseDecayRate: 6, triggerMult: 1.5, triggerMargin: 0.04 },
  high: { baselineRate: 4, pulseDecayRate: 10, triggerMult: 1.6, triggerMargin: 0.03 },
};

function groupSpecsFromSplit(): Record<"low" | "mid" | "high", GroupSpec> {
  const { lowMid, midHigh } = getBandSplit();
  return {
    low: { ...GROUP_TUNING.low, lo: 0, hi: lowMid },
    mid: { ...GROUP_TUNING.mid, lo: lowMid, hi: midHigh },
    high: { ...GROUP_TUNING.high, lo: midHigh, hi: NUM_BANDS },
  };
}

function meanRange(bands: Float32Array, lo: number, hi: number): number {
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += bands[i];
  return sum / (hi - lo);
}

interface GroupState {
  level: number;
  baseline: number;
  pulse: number;
  wasAbove: boolean;
  onset: boolean;
}

function makeGroupState(): GroupState {
  return { level: 0, baseline: 0, pulse: 0, wasAbove: false, onset: false };
}

function advanceGroup(state: GroupState, spec: GroupSpec, dtSec: number, bands: Float32Array, rateScale: number): void {
  const raw = meanRange(bands, spec.lo, spec.hi);
  state.level += (raw - state.level) * Math.min(1, LEVEL_SLEW_PER_SEC * rateScale * dtSec);
  state.baseline += (raw - state.baseline) * Math.min(1, spec.baselineRate * dtSec);

  const threshold = state.baseline * spec.triggerMult + spec.triggerMargin;
  const above = raw > threshold;
  state.onset = above && !state.wasAbove;
  state.wasAbove = above;

  state.pulse *= Math.exp(-dtSec * spec.pulseDecayRate * rateScale);
  if (state.onset) state.pulse = 1;
}

export interface BandEnergy {
  low: number;
  mid: number;
  high: number;
  lowPulse: number;
  midPulse: number;
  highPulse: number;
  /** One-shot edges (like FeatureFrame.onset, but per group) — true only on
   *  the exact tick that group's level newly crossed its adaptive threshold. */
  lowOnset: boolean;
  midOnset: boolean;
  highOnset: boolean;
  /** rateScale multiplies the level slew and pulse decay rates — see
   *  sensitivity.ts's smoothingRateScale. Defaults to 1 (today's behavior)
   *  so existing callers don't need to change. */
  advance(dtSec: number, bands: Float32Array, rateScale?: number): void;
}

export function createBandEnergy(): BandEnergy {
  const low = makeGroupState();
  const mid = makeGroupState();
  const high = makeGroupState();

  // Rebuilt lazily whenever the persisted split changes (dragging the Bands
  // sliders), rather than read fresh every frame — cheap version check, no
  // per-frame allocation in the steady state.
  let specs = groupSpecsFromSplit();
  let seenVersion = bandSplitVersion();

  const result: BandEnergy = {
    low: 0,
    mid: 0,
    high: 0,
    lowPulse: 0,
    midPulse: 0,
    highPulse: 0,
    lowOnset: false,
    midOnset: false,
    highOnset: false,
    advance(dtSec: number, bands: Float32Array, rateScale = 1): void {
      const currentVersion = bandSplitVersion();
      if (currentVersion !== seenVersion) {
        specs = groupSpecsFromSplit();
        seenVersion = currentVersion;
      }

      advanceGroup(low, specs.low, dtSec, bands, rateScale);
      advanceGroup(mid, specs.mid, dtSec, bands, rateScale);
      advanceGroup(high, specs.high, dtSec, bands, rateScale);

      result.low = low.level;
      result.mid = mid.level;
      result.high = high.level;
      result.lowPulse = low.pulse;
      result.midPulse = mid.pulse;
      result.highPulse = high.pulse;
      result.lowOnset = low.onset;
      result.midOnset = mid.onset;
      result.highOnset = high.onset;
    },
  };

  return result;
}

// Re-exported for tests that want to synthesize a bands array without
// hardcoding NUM_BANDS everywhere.
export { NUM_BANDS };
