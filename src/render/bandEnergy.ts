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
//
// The onset trigger is rate-of-rise (spectral flux), not absolute level —
// the same shape features.ts's broadband FLUX_* onset uses, scoped to a
// group's bands. A level-vs-adaptive-baseline trigger was tried first and
// had a fatal dead zone: features.ts's clamp01 caps every band at 1, so a
// threshold of the form baseline*mult+margin becomes unreachable once
// baseline climbs past (1-margin)/mult — around 0.6 for these groups. Loud,
// busy bass (a sustained sub note, a bassline that doesn't fully decay
// between kicks) drives baseline into that dead zone, silencing the
// detector exactly when there's the most bass to catch. Rate-of-rise
// doesn't have this problem: a sustained note has high level but ~zero
// rise, so it can't mask the kicks on top of it.

const LEVEL_SLEW_PER_SEC = 10; // smooths the continuous level so geometry-driving uniforms can't strobe

// A zero or non-finite dtSec (a stalled clock, a test) would otherwise turn
// a real rise into an infinite rate (division below) or, at the Smoothing
// row's Off stop, feed Infinity*0 into the level slew's Math.min and yield
// NaN. Clamped once here rather than per group.
const MIN_DT_SEC = 1e-4;

interface GroupSpec {
  lo: number; // inclusive band index
  hi: number; // exclusive band index
  fluxAdaptRate: number;
  pulseDecayRate: number;
  triggerMult: number;
  triggerMargin: number;
  refractorySec: number;
}

// Tuning differs per group on purpose, tied to the group's *role* rather
// than its band indices (so it doesn't change when the crossovers move):
//
// - fluxAdaptRate: how fast each group's flux baseline chases the rise it's
//   measuring. Kept low for bass (a kick has body — its own rise shouldn't
//   drag the baseline up fast enough to blunt itself) and higher for treble
//   (a hat is a click; the baseline should track a busy hi-hat pattern so a
//   new hit still has to stand out from recent ones).
// - triggerMult carries the actual discrimination; triggerMargin is only a
//   floor against near-silent noise. This split is structural, not just
//   caution: the group mean's absolute scale depends on how many bands the
//   user's crossovers put in it, so an absolute margin alone can't tell a
//   real hit from noise across every possible split — only a multiple of
//   the group's own recent flux can.
// - refractorySec is a hard minimum spacing, independent of the trigger,
//   because a kick physically cannot repeat as fast as a hat. Low's matches
//   features.ts's broadband ONSET_REFRACTORY_SEC; the others scale down
//   with how fast that group's transients can legitimately repeat.
const GROUP_TUNING: Record<"low" | "mid" | "high", Omit<GroupSpec, "lo" | "hi">> = {
  low: { fluxAdaptRate: 3, pulseDecayRate: 3.5, triggerMult: 1.6, triggerMargin: 1.5, refractorySec: 0.1 },
  mid: { fluxAdaptRate: 4, pulseDecayRate: 6, triggerMult: 1.6, triggerMargin: 1.5, refractorySec: 0.07 },
  high: { fluxAdaptRate: 6, pulseDecayRate: 10, triggerMult: 1.8, triggerMargin: 1.2, refractorySec: 0.05 },
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
  /** Previous raw() reading, for the rise below. Null until the first
   *  advance so construction (or a fresh instance) can't fire an onset off
   *  an assumed-zero starting point. */
  prevRaw: number | null;
  /** Leaky average of the recent rate-of-rise (band-mean per second), the
   *  reference a new rise has to clear — see triggerMult/triggerMargin. */
  fluxBaseline: number;
  /** Seconds since the last onset; compared against refractorySec. Starts
   *  at Infinity so nothing blocks the very first onset. */
  sinceOnsetSec: number;
  pulse: number;
  onset: boolean;
}

function makeGroupState(): GroupState {
  return { level: 0, prevRaw: null, fluxBaseline: 0, sinceOnsetSec: Infinity, pulse: 0, onset: false };
}

function advanceGroup(state: GroupState, spec: GroupSpec, dtSec: number, bands: Float32Array, rateScale: number): void {
  const raw = meanRange(bands, spec.lo, spec.hi);
  state.level += (raw - state.level) * Math.min(1, LEVEL_SLEW_PER_SEC * rateScale * dtSec);

  // Rate of rise, in band-mean per second — normalized by dt (not a raw
  // per-frame delta) so the trigger reads the same at 60Hz and 120Hz. A
  // faster clock takes smaller steps but samples more often; dividing by dt
  // turns both into the same physical rate. See the file header for why
  // this replaces a level-vs-baseline comparison. Detected on raw, not the
  // slewed level: level is display smoothing and is rateScale-dependent, so
  // triggering off it would leak the Smoothing dial into detection.
  const dt = Number.isFinite(dtSec) ? Math.max(MIN_DT_SEC, dtSec) : MIN_DT_SEC;
  const rise = state.prevRaw === null ? 0 : Math.max(0, (raw - state.prevRaw) / dt);
  state.prevRaw = raw;

  // Deliberately NOT scaled by rateScale, unlike the level slew and pulse
  // decay below: this is measurement feeding onset timing, not display
  // smoothing (same reasoning as features.ts's smoothingScale). It also has
  // to stay this way — rateScale is Infinity at the Smoothing row's Off
  // stop, which would make the baseline snap to equal the rise every tick
  // (Math.min(1, ...) saturates at 1) and permanently block every onset.
  state.fluxBaseline += (rise - state.fluxBaseline) * Math.min(1, spec.fluxAdaptRate * dt);

  state.sinceOnsetSec += dt;
  const threshold = state.fluxBaseline * spec.triggerMult + spec.triggerMargin;
  state.onset = rise > threshold && state.sinceOnsetSec > spec.refractorySec;
  if (state.onset) state.sinceOnsetSec = 0;

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
  /** One-shot edges (like FeatureFrame.beat, but per group) — true only on
   *  the exact tick that group's rate-of-rise cleared its adaptive flux
   *  threshold with that group's refractory elapsed. */
  lowOnset: boolean;
  midOnset: boolean;
  highOnset: boolean;
  /** rateScale multiplies the level slew and pulse decay rates — see
   *  sensitivity.ts's smoothingRateScale. Stops there deliberately: it does
   *  not reach the flux baseline or refractory, which are measurement, not
   *  display smoothing (see advanceGroup). Defaults to 1 (today's behavior)
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
