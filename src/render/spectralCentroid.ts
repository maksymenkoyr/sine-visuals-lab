import { NUM_BANDS } from "../audio/types.ts";

/**
 * A fast, per-frame counterpart to musicProfile.ts's `brightness` dial: the
 * same spectral-centroid measurement (see that file's brightness comment —
 * a band-index-weighted centroid, which is a log-frequency centroid since
 * the bands themselves are log-spaced; don't "fix" it into a linear-Hz
 * centroid), but range-adapted and slewed instead of eased over ~5s, so
 * it's usable to drive a scene's color/motion moment-to-moment rather than
 * only to slowly bias an `auto:` weight table.
 *
 * Its own module rather than reusing musicProfile.ts's calculation: the two
 * serve different jobs (track descriptor vs. live signal) with different
 * smoothing shapes. Recomputed here from FeatureFrame.bands rather than
 * threaded through the wire frame — the same reasoning musicProfile.ts's
 * own header gives for its attack/flux calculation: the centroid is a pure
 * function of `bands`, which already crosses the wire, so there's nothing a
 * new protocol field would buy.
 *
 * The raw centroid (`raw` below) sits in a narrow band on most real music
 * and barely moves on its own — a bass-heavy mix rarely swings past ~0.4, a
 * bright one rarely below ~0.5 — which reads as a dead signal. `centroid`
 * instead reports where the current raw reading sits against a leaky
 * floor/peak of its own recent history (same asymmetric shape as
 * features.ts's per-band AGC, just tracking one scalar instead of 24
 * bands): 0.5 means "about this track's own recent middle," not "an
 * absolute mid-spectrum reading." That self-relative framing is what makes
 * it move visibly on any track, bright or dark.
 *
 * On silence there's no spectrum to locate, so — like musicProfile.ts's
 * `loudness` dial — everything here freezes at its last reading instead of
 * drifting toward a neutral value: collapsing the adaptive window during a
 * gap between tracks would otherwise slam the ranged output to an extreme
 * the instant the next track starts.
 */

const SILENCE_PEAK = 0.03; // below this peak-band level there's no spectrum to locate — matches musicProfile.ts

// Leaky floor/peak over the raw centroid, same asymmetric shape as
// features.ts's per-band AGC (floor creeps up slowly, drops fast to follow
// a genuine dark passage; peak jumps up fast on a bright passage, relaxes
// slowly between them) — just tracking one scalar instead of 24 bands, and
// run at a fixed rate regardless of rateScale, the same split features.ts
// makes between its (unscaled) floor/peak and its (smoothingScale-scaled)
// attack/release envelope.
const FLOOR_RISE_RATE = 0.4; // ~2.5s
const FLOOR_FALL_RATE = 3; // ~0.33s
const PEAK_RISE_RATE = 4; // ~0.25s
const PEAK_FALL_RATE = 0.6; // ~1.67s
const MIN_CENTROID_SPAN = 0.08; // never let (peak - floor) collapse below this

const OUTPUT_SLEW_RATE = 8; // ~0.125s — smooths the ranged output so it's safe to drive geometry/color with

function expBlend(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Band-index-weighted spectral centroid, normalized to [0,1] across the
 *  band ladder — a log-frequency centroid, since the bands themselves are
 *  log-spaced (see the file header). Returns null below SILENCE_PEAK: no
 *  spectrum to locate, not a meaningless reading.
 *
 *  Exported as the one shared implementation of this formula: `advance()`
 *  below calls it for `raw`, and spectrumStrip.ts's live centroid marker
 *  calls it directly against whatever buffer it's currently drawing (raw
 *  mic or processed, per its own RAW chip), so the marker can never drift
 *  out of sync with the exact bars it's pointing at. That's also why it
 *  takes a plain buffer rather than reading `raw`/`centroid` above: this is
 *  a stateless measurement, and the marker's buffer is neither of those —
 *  it's a third one entirely (see spectrumStrip.ts's own header for which). */
export function bandIndexCentroid(bands: Float32Array): number | null {
  let bandSum = 0;
  let weightedSum = 0;
  let peakBand = 0;
  for (let b = 0; b < NUM_BANDS; b++) {
    const v = bands[b];
    bandSum += v;
    weightedSum += b * v;
    if (v > peakBand) peakBand = v;
  }
  if (peakBand <= SILENCE_PEAK || bandSum <= 1e-4) return null;
  return Math.min(1, Math.max(0, weightedSum / bandSum / (NUM_BANDS - 1)));
}

export interface SpectralCentroid {
  /** Ranged against this track's own recent floor/peak and slewed — the
   *  field to drive a scene's color/motion from. 0.5 is this track's own
   *  recent middle, not an absolute mid-spectrum reading. */
  centroid: number;
  /** The same measurement musicProfile.ts's `brightness` dial eases toward,
   *  unsmoothed — for meters that want the honest absolute reading. */
  raw: number;
  /** rateScale multiplies the output slew only — see sensitivity.ts's
   *  smoothingRateScale. Defaults to 1 (today's behavior). Non-finite
   *  (Smoothing's Off stop) makes `centroid` land exactly on the ranged
   *  target, matching features.ts's own envelope handling at that stop. */
  advance(dtSec: number, bands: Float32Array, rateScale?: number): void;
}

export function createSpectralCentroid(): SpectralCentroid {
  let floor = 0.5;
  let peak = 0.5;
  let primed = false;

  const state: SpectralCentroid = {
    centroid: 0.5,
    raw: 0.5,
    advance(dtSec: number, bands: Float32Array, rateScale = 1): void {
      const dt = Math.max(1e-4, dtSec);

      const raw = bandIndexCentroid(bands);
      if (raw === null) return; // freeze through silence
      state.raw = raw;

      if (!primed) {
        // No history to range against yet — seed the window and hold the
        // output at its initial neutral rather than jumping to an edge of a
        // window that's only this one sample wide (see the attack dial's
        // own priming frame in musicProfile.ts for the same shape).
        floor = raw;
        peak = raw;
        primed = true;
        return;
      }

      const floorRate = raw < floor ? FLOOR_FALL_RATE : FLOOR_RISE_RATE;
      floor += (raw - floor) * expBlend(floorRate, dt);
      const peakRate = raw > peak ? PEAK_RISE_RATE : PEAK_FALL_RATE;
      peak += (raw - peak) * expBlend(peakRate, dt);

      const range = Math.max(MIN_CENTROID_SPAN, peak - floor);
      const rangedTarget = Math.min(1, Math.max(0, (raw - floor) / range));

      if (Number.isFinite(rateScale)) {
        state.centroid += (rangedTarget - state.centroid) * expBlend(OUTPUT_SLEW_RATE, dt * rateScale);
      } else {
        state.centroid = rangedTarget;
      }
    },
  };

  return state;
}
