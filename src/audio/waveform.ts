/**
 * Pure time-domain measurements over a sample buffer — no AudioContext
 * involved, so these are unit-testable the same way features.ts's math is:
 * feed a plain Float32Array, assert on the number back. The buffer itself
 * comes from AnalyserNode.getFloatTimeDomainData() via stereo.ts, which is
 * the one place in the pipeline that actually reads raw samples — everything
 * else in src/audio/ only ever sees frequency-domain (dB) data.
 *
 * This is what a spectrum analysis fundamentally cannot show: clipping is a
 * time-domain event (a sample pinned at the rails), and "punchy vs.
 * compressed" (crest factor) is a relationship between a signal's peak and
 * its average that a band's energy value alone doesn't carry.
 */

// A silent (or near-silent) buffer has ~zero rms, which would blow crest and
// zeroCrossingRate up toward +Infinity/NaN. Below this, report the "nothing
// to measure" value instead — the same reasoning as features.ts's DB_FLOOR
// guard against poisoning downstream trackers with a non-finite value.
const SILENCE_RMS = 1e-6;

// Samples at or beyond this fraction of full scale (±1.0) count as clipped.
// Not exactly 1.0: a true digital clip rides the rail for several consecutive
// samples but float rounding on the way in rarely lands on the exact integer
// boundary.
const CLIP_THRESHOLD = 0.98;

export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
}

export function peak(samples: Float32Array): number {
  let m = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > m) m = a;
  }
  return m;
}

/** Peak / rms — 1.0 for a signal with no dynamic range (a square wave, or a
 *  brick-walled master), ~1.41 (sqrt 2) for a sine, higher for something
 *  peaky and sparse (a single transient in an otherwise quiet buffer). 0 on
 *  a silent buffer rather than a divide-by-zero NaN — see SILENCE_RMS. */
export function crest(samples: Float32Array): number {
  const r = rms(samples);
  if (r < SILENCE_RMS) return 0;
  return peak(samples) / r;
}

/** Fraction of adjacent-sample sign changes, [0,1] — cheap noisy-vs-tonal
 *  signal: a low sustained tone crosses zero rarely, hiss or a cymbal wash
 *  crosses constantly. Undefined (returns 0) for fewer than 2 samples. */
export function zeroCrossingRate(samples: Float32Array): number {
  if (samples.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) crossings++;
  }
  return crossings / (samples.length - 1);
}

/** True if any sample rides at or past CLIP_THRESHOLD of full scale — the
 *  one thing a spectrum view can't show at all. */
export function isClipping(samples: Float32Array, threshold = CLIP_THRESHOLD): boolean {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= threshold) return true;
  }
  return false;
}

export interface Envelope {
  min: Float32Array; // length targetPoints
  max: Float32Array; // length targetPoints
}

/**
 * Downsamples a sample buffer to targetPoints columns for display, taking
 * the min and max of each bucket rather than picking (or averaging) one
 * sample per bucket. Naive decimation can step right over a single-sample
 * transient between the picked indices; min/max can't — whichever bucket it
 * falls in, it becomes that bucket's min or max.
 */
export function downsampleForDisplay(samples: Float32Array, targetPoints: number): Envelope {
  const min = new Float32Array(targetPoints);
  const max = new Float32Array(targetPoints);
  if (samples.length === 0 || targetPoints <= 0) return { min, max };

  for (let col = 0; col < targetPoints; col++) {
    const lo = Math.floor((col / targetPoints) * samples.length);
    const hi = Math.max(lo + 1, Math.floor(((col + 1) / targetPoints) * samples.length));
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = lo; i < hi && i < samples.length; i++) {
      const v = samples[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    min[col] = mn === Infinity ? 0 : mn;
    max[col] = mx === -Infinity ? 0 : mx;
  }
  return { min, max };
}
