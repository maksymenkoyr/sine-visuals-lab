// Copied from audio-subsystem/v6 (2026-10-30, #798/#800); the bench check (bench-signals' probe app-song)
// holds it equal to v6. Edits from the copy: import paths, buffers made once for what the frame loop
// allocated, and resetV4State.
//
// v4's feature pipeline, vendored in song/v4/, wired the way the bench's v4 probe wires it
// (bench-signals/src/probes/v4.ts) so the five fields below equal the traces the bench stored:
// `clapLevel`, `hatLevel`, `chordLevel`, `keys` and `inDrop`.
//
// v4 keeps module-level state (its silence gate and auto-gain trackers), which a second capture in the
// same page would otherwise start from: resetV4State puts it back, and SongLayer calls it on construction.
//
// The probe also runs v4's stem splitter and wave peak. They are left out: they feed only AnimFrame's
// hats, lead and wavePeak, none of the five fields, and the traces stay equal without them (bench-signals
// `v6-check`), for a large share of the cost.
//
// `kickDb` and `loudness` stay in their own files (v21.ts, loudness.ts), not here.

import { createAnimClock, type AnimClock } from "./v4/app/render/animClock.ts";
import { createBandAnalyser, type BandAnalyser } from "../analyser.ts";
import { feedAutoGainMeasurement, resetAutoGainState, resolveAutoGain } from "./v4/src/autoGain.ts";
import { PHASE_BASS, type TempoHit } from "./v4/src/beatClock.ts";
import { FeatureExtractor } from "./v4/src/features.ts";
import { getHitShape } from "./v4/src/hitStrength.ts";
import { smoothingRateScale, SMOOTHING_DEFAULT } from "./v4/src/sensitivity.ts";
import { feedSilenceGateMeasurement, resetSilenceGateState, resolveSilenceGate } from "./v4/src/silenceGate.ts";
import { TempoAnalyzer, type TempoOnset } from "./v4/src/tempoAnalyzer.ts";
import { fft } from "./v4/fft.ts";

const RING = 32768;

/** An AnalyserNode as the Web Audio spec defines it (Blackman window, 1/N-scaled FFT, dB) over a ring of pushed samples. */
class SpecAnalyser {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  minDecibels = -100;
  maxDecibels = -30;
  private ring = new Float32Array(RING);
  private pos = 0;
  private smooth: Float64Array | null = null;
  private re = new Float64Array(0);
  private im = new Float64Array(0);
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  connect() {}
  disconnect() {}
  write(chunk: Float32Array) {
    for (const v of chunk) this.ring[this.pos++ & (RING - 1)] = v;
  }
  getFloatFrequencyData(out: Float32Array) {
    const n = this.fftSize;
    if (this.re.length !== n) {
      this.re = new Float64Array(n);
      this.im = new Float64Array(n);
    }
    const { re, im } = this;
    im.fill(0);
    for (let i = 0; i < n; i++) {
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n);
      re[i] = this.ring[(this.pos - n + i) & (RING - 1)] * w;
    }
    fft(re, im);
    if (!this.smooth || this.smooth.length !== n / 2) this.smooth = new Float64Array(n / 2);
    const tau = this.smoothingTimeConstant;
    for (let k = 0; k < n / 2 && k < out.length; k++) {
      const mag = Math.hypot(re[k], im[k]) / n;
      this.smooth[k] = tau * this.smooth[k] + (1 - tau) * mag;
      out[k] = 20 * Math.log10(this.smooth[k]);
    }
  }
}

/** A non-finite value reads as 0, as the probe's traces were stored. */
const finite = (v: number) => (Number.isFinite(v) ? v : 0);

/** Returns v4's module-level trackers to a freshly loaded module's, so a new capture does not start from the last one's. */
export function resetV4State(): void {
  resetSilenceGateState();
  resetAutoGainState();
}

export class V4Lanes {
  /** Clap hits: v4 hitStrength.high.loudness. */
  clapLevel = 0;
  /** Closed hats: v4 hits.high.ratio. */
  hatLevel = 0;
  /** Chord changes: v4 hits.mid.ratio. */
  chordLevel = 0;
  /** Keys loudness: v4 mid. */
  keys = 0;
  /** A drop is under way: v4 profile.loudness. */
  inDrop = 0;

  private readonly node = new SpecAnalyser();
  private readonly bands: BandAnalyser;
  private readonly ex = new FeatureExtractor();
  private readonly anim: AnimClock = createAnimClock();
  private readonly tempo: TempoAnalyzer;
  private readonly pending: TempoOnset[] = [];
  private readonly rateScale = smoothingRateScale(SMOOTHING_DEFAULT);
  private readonly hitPool: TempoHit[] = [];
  private readonly tempoHits: TempoHit[] = [];
  private readonly hit: { shape: ReturnType<typeof getHitShape>; beatRatio: number; tempoHits: TempoHit[]; wavePeak: number };

  constructor(sampleRate: number) {
    this.bands = createBandAnalyser(
      { sampleRate, createAnalyser: () => this.node } as unknown as AudioContext,
      { connect() {} } as unknown as AudioNode,
    );
    this.tempo = new TempoAnalyzer(sampleRate);
    this.hit = { shape: getHitShape(), beatRatio: 0, tempoHits: this.tempoHits, wavePeak: 0 };
  }

  /** Mono samples whose first one was captured at `time`. */
  push(samples: Float32Array, time: number): void {
    this.node.write(samples);
    this.tempo.push(samples, time);
    for (const o of this.tempo.drainOnsets()) this.pending.push(o);
  }

  frame(now: number, dt: number): void {
    const marks = resolveSilenceGate();
    const ag = resolveAutoGain();
    const ex = this.ex;
    const f = ex.update(this.bands.readBandsDb(), now, ag, this.rateScale, marks);
    feedAutoGainMeasurement(ex.bandSpanDb, ex.dtSec);
    feedSilenceGateMeasurement(f.level, ex.dtSec);
    f.bpm = this.tempo.bpm;
    const tempoHits = this.tempoHits;
    tempoHits.length = 0;
    for (let i = 0; i < this.pending.length; i++) {
      const o = this.pending[i];
      const h = this.hitPool[i] ?? (this.hitPool[i] = { agoSec: 0, weight: 0 });
      h.agoSec = now - o.time;
      h.weight = o.strength * (1 + PHASE_BASS * o.bass);
      tempoHits.push(h);
    }
    this.pending.length = 0;
    const hit = this.hit;
    hit.shape = getHitShape();
    hit.beatRatio = ex.fluxRatio;
    const a = this.anim.advance(dt, f, undefined, marks, hit);
    this.clapLevel = finite(a.hitStrength.high.loudness);
    this.hatLevel = finite(a.hits.high.ratio);
    this.chordLevel = finite(a.hits.mid.ratio);
    this.keys = finite(a.mid);
    this.inDrop = finite(a.profile.loudness);
  }
}
