/**
 * Pure time-domain measurements over a sample buffer — no AudioContext
 * involved, so these are unit-testable the same way features.ts's math is:
 * feed a plain Float32Array, assert on the number back. The buffers come from
 * AnalyserNode.getFloatTimeDomainData() — waveformAnalyser.ts's scope buffer
 * and inputHealthTap.ts's per-channel taps are the callers — which are the
 * only places in the pipeline that read raw samples; everything else in
 * src/audio/ only ever sees frequency-domain (dB) data.
 *
 * This is what a spectrum analysis fundamentally cannot show: clipping is a
 * time-domain event, a sample pinned at the rails.
 */

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

/** True if any sample rides at or past CLIP_THRESHOLD of full scale — the
 *  one thing a spectrum view can't show at all. */
export function isClipping(samples: Float32Array, threshold = CLIP_THRESHOLD): boolean {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= threshold) return true;
  }
  return false;
}

/** The lowest and highest sample — one column of downsampleForDisplay, without
 *  its arrays. What a room host puts on the wire for its followers' Waveform
 *  row (src/net/protocol.ts's wave tail). */
export function minMax(samples: Float32Array): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
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
