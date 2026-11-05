// Copied from audio-subsystem/v6 (2026-10-30, #798/#800); the bench check (bench-signals' probe app-song) holds it equal to v6.
// Overall loudness, as v3's `low` band reads it (the bench's `v3.bands/low`): a 90 Hz, two-octave
// band-pass whose block peak is smoothed. The arithmetic is copied from the frozen v3 snapshot in
// ../../../bench/systems/v3/src/ (bands.ts, channels.ts) so the trace matches v3's to the last bit.
// It reads samples only and shares nothing with the v5 engine.

/** v3 analyses audio in blocks of this many frames, whatever size the chunks arrive in. */
const BLOCK_SIZE = 512;
/** v3's DEFAULT_BANDS entry named "low". */
const LOW = { hz: 90, octaves: 2, gain: 1, smoothing: 0.5 };
/** `smoothing` is the share of the old level kept per this many seconds, which keeps it independent of block size. */
const SMOOTHING_PERIOD_S = 1 / 60;

function smoothingFactor(smoothing: number, blockSeconds: number): number {
  const s = Math.min(0.999, Math.max(0, smoothing));
  return s ** (blockSeconds / SMOOTHING_PERIOD_S);
}

/** Band-pass biquad with 0 dB at its centre. */
class BandPass {
  private readonly b0: number;
  private readonly a1: number;
  private readonly a2: number;
  private z1 = 0;
  private z2 = 0;

  constructor(hz: number, octaves: number, sampleRate: number) {
    const f = Math.min(Math.max(hz, 1), sampleRate * 0.49);
    const w = (2 * Math.PI * f) / sampleRate;
    const bw = Math.max(0.01, octaves);
    const alpha = Math.sin(w) * Math.sinh(((Math.LN2 / 2) * bw * w) / Math.sin(w));
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  /** Filters `x`, keeping state across calls, and returns the largest output magnitude. */
  peak(x: Float32Array): number {
    let { z1, z2 } = this;
    const { b0, a1, a2 } = this;
    let max = 0;
    for (let i = 0; i < x.length; i++) {
      const y = b0 * x[i] + z1;
      z1 = -a1 * y + z2;
      z2 = -b0 * x[i] - a2 * y;
      const m = Math.abs(y);
      if (m > max) max = m;
    }
    this.z1 = z1;
    this.z2 = z2;
    return max;
  }
}

export class Loudness {
  /** The smoothed level, 0..1; moves once per completed block. */
  value = 0;
  private readonly filter: BandPass;
  private readonly smoothing: number;
  private readonly block = new Float32Array(BLOCK_SIZE);
  private fill = 0;

  constructor(sampleRate: number) {
    this.filter = new BandPass(LOW.hz, LOW.octaves, sampleRate);
    this.smoothing = smoothingFactor(LOW.smoothing, BLOCK_SIZE / sampleRate);
  }

  push(samples: Float32Array): void {
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(BLOCK_SIZE - this.fill, samples.length - offset);
      this.block.set(samples.subarray(offset, offset + take), this.fill);
      this.fill += take;
      offset += take;
      if (this.fill === BLOCK_SIZE) {
        const raw = Math.min(1, this.filter.peak(this.block) * LOW.gain);
        this.value = this.value * this.smoothing + raw * (1 - this.smoothing);
        this.fill = 0;
      }
    }
  }
}
