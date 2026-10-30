// Copied from audio-subsystem/v6 (2026-10-30, #798/#800); the bench check (bench-signals' probe app-song) holds it equal to v6. Edit: import paths (the app's own stemSplit.ts and bandScale.ts, which equal v6's copies).
// Hats: the app's stem splitter (./app/stemSplit.ts, copied from the app) fed from the samples push() gets, the way the app
// feeds it from its AnalyserNode: a Blackman-windowed, 1/N-scaled FFT in dB, no smoothing of its own, because the app smooths
// its own. This is the closed-hat level the rich-song test found far better than v4's (#798); the level is the splitter's,
// unslewed, 0..1. The FFT is v4's (./v4/fft.ts, the bench's), so the level equals the bench probe's trace (bench-signals
// src/probes/app.ts `app.hatsSplit`).

import { bandEdgesHz, MAX_HZ_CAP } from "../bandScale.ts";
import { createStemSplitter, type StemSplitter } from "../stemSplit.ts";
import { fft } from "./v4/fft.ts";

const FFT_SIZE = 2048;
const RING = 32768;
/** src/audio/bandSplit.ts BAND_SPLIT in the app: Lead covers the bands between these two edges. Hats does not use it, but the splitter wants it. */
const LEAD_LOW_EDGE = 6;
const LEAD_HIGH_EDGE = 16;

export class HatsSplit {
  private readonly ring = new Float32Array(RING);
  private pos = 0;
  private readonly binsDb = new Float32Array(FFT_SIZE / 2);
  private readonly split: StemSplitter;
  private readonly ranges: { lead: { lo: number; hi: number } };
  private readonly re = new Float64Array(FFT_SIZE);
  private readonly im = new Float64Array(FFT_SIZE);
  private readonly window = new Float64Array(FFT_SIZE);

  constructor(sampleRate: number) {
    const binHz = sampleRate / 2 / (FFT_SIZE / 2);
    const edges = bandEdgesHz(Math.min(MAX_HZ_CAP, sampleRate / 2 - binHz));
    this.ranges = { lead: { lo: edges[LEAD_LOW_EDGE], hi: edges[LEAD_HIGH_EDGE] } };
    this.split = createStemSplitter(FFT_SIZE / 2, binHz);
    for (let i = 0; i < FFT_SIZE; i++) {
      this.window[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE) + 0.08 * Math.cos((4 * Math.PI * i) / FFT_SIZE);
    }
  }

  push(samples: Float32Array): void {
    for (const v of samples) this.ring[this.pos++ & (RING - 1)] = v;
  }

  /** The Hats level at `now`, 0..1. */
  level(now: number): number {
    const n = FFT_SIZE;
    for (let i = 0; i < n; i++) {
      this.re[i] = this.ring[(this.pos - n + i) & (RING - 1)] * this.window[i];
      this.im[i] = 0;
    }
    fft(this.re, this.im);
    for (let k = 0; k < n / 2; k++) this.binsDb[k] = 20 * Math.log10(Math.hypot(this.re[k], this.im[k]) / n);
    return this.split.update(this.binsDb, now, this.ranges).hats;
  }
}
