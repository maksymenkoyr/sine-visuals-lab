// Copied from audio-subsystem/v6 (2026-10-30, #798/#800); the bench check (bench-signals' probe app-song) holds it equal to v6.
// Whether music is playing, as v1's `audio_FadeInOut` reads it: a level that rises while the input
// is loud against its own slowly falling peak and fades in silence. Copied from the frozen v1
// snapshot in ../../../bench/systems/v1/src/ (index.ts, dsp.ts, stats.ts, components.ts), cut down
// to the one feature that component reads, so the trace matches v1's to the last bit.

/** v1 analyses the input in hops of this many samples and keeps a window of FFT_SIZE of them. */
const HOP = 512;
const WINDOW = 2048;
/** The peak the level is ranged against falls by this share every hop. */
const PEAK_DECAY = 0.9995;
/** Stands in for a zero peak; the float32 minimum, as in v1. */
const PEAK_FLOOR = 1.1754943508222875e-38;
/** v1 caps the step it gives its components at this many seconds. */
const MAX_DT_S = 0.5;
// v1's default reactivity (0.5) makes its mix factor 1, so the branch that blends the level
// towards 1 never runs and is left out.

export class Playing {
  private readonly pending = new Float32Array(HOP);
  private pendingLen = 0;
  private readonly window = new Float32Array(WINDOW);
  private newest = 0;
  private peak = PEAK_FLOOR;
  private value = 0;

  // The sample rate does not matter here: v1 counts its hop in samples.
  constructor(_sampleRate: number) {}

  push(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      this.pending[this.pendingLen++] = samples[i];
      if (this.pendingLen === HOP) {
        this.analyse();
        this.pendingLen = 0;
      }
    }
  }

  /** Steps the fade by `dt` seconds and returns it, 0..1. */
  update(dt: number): number {
    const cdt = Math.min(MAX_DT_S, dt);
    const l = this.newest / this.peak;
    let v = this.value;
    if (l > 0.05) v += l * 0.15 * cdt * 60;
    else v *= 1 - 0.005 * cdt * 60;
    this.value = Math.min(v, 1);
    return this.value;
  }

  private analyse(): void {
    const buf = this.window;
    buf.copyWithin(0, HOP);
    buf.set(this.pending, WINDOW - HOP);
    // The signed maximum of the window, starting from 0.
    let vu = 0;
    for (let i = 0; i < WINDOW; i++) {
      const x = Number.isFinite(buf[i]) ? buf[i] : 0;
      if (x > vu) vu = x;
    }
    this.newest = vu;
    let acc = Math.max(this.peak * PEAK_DECAY, vu);
    if (acc === 0) acc = PEAK_FLOOR;
    this.peak = acc;
  }
}
