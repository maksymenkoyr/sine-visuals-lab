import { NUM_BANDS } from "./types.ts";
import { MAX_HZ_CAP, bandEdgesHz } from "./bandScale.ts";
import { estimateTempo, TEMPO_DECAY_SEC, BPM_MIN, BPM_MAX } from "./tempoComb.ts";

/**
 * Fixed-hop tempo analysis over raw audio samples, independent of the
 * render loop — the thing the render-tick tracker (features.ts's FeatureExtractor,
 * fed one FFT frame per render tick) could never be: at 30fps a hit is only
 * evaluated twice as coarsely as at 60fps, and at 15fps the render tick is
 * long enough to miss or badly mistime a hit outright. Analysing samples at
 * a fixed hop, off the AudioWorklet thread (see tempoWorklet.ts), keeps the
 * onset times exact regardless of what the render thread is doing.
 *
 * Pipeline per hop: a windowed FFT -> log-compressed per-band magnitude ->
 * positive spectral flux (the low bands, `lowBands`, weighted harder than
 * the rest — a kick is what most patterns actually keep time by) -> onset
 * picking against an adaptive baseline+deviation threshold, with each
 * onset's exact time back-dated by ONSET_TIME_OFFSET_HOPS hops. That offset
 * cancels the envelope's own peak lag: a positive-flux peak lands a little
 * after the transient that caused it (the window needs to slide past the
 * attack before the bin energy actually peaks), and ONSET_TIME_OFFSET_HOPS
 * was calibrated by fitting synthesized tracks' own bass onsets back onto
 * their scripted true beat times (tests/tempoEval/synth.ts) until the
 * measured offset centred on zero.
 *
 * Every picked onset then votes in tempoComb.ts's estimateTempo — the same
 * pair-comb features.ts's render-tick pipeline uses, but here with
 * RECENCY_SEC > 0 (a stale pairing fades out, so the estimate follows a
 * tempo step faster than an unweighted window would) and a tight
 * PAIR_TOL_SEC (exact audio-sample onset times need far less slop than
 * render-tick-quantised ones do). Deliberately, the tempo vote's weight is
 * the onset's own broadband strength alone — `bass` is still reported per
 * onset (for the beat clock's own phase comb, which does weight bass
 * harder — see beatClock.ts's PHASE_BASS) but never folds into which tempo
 * wins here: a syncopated kick (hip-hop's off-the-grid-but-on-the-groove
 * pattern) would otherwise pull the winning period away from the beat grid
 * the kick is deliberately not on.
 *
 * An autocorrelation estimator over the same flux envelope was tried and
 * rejected: it locked onto half-time under drum & bass's busy pattern (the
 * 120bpm-centred prior it was scored against made 174bpm's own half look
 * closer to home), and couldn't recover from a stepped/ramping tempo as
 * fast as the pair comb's recency weighting does.
 *
 * DOM-free and dependency-light by construction (only types.ts,
 * bandScale.ts and tempoComb.ts) — this must run inside an
 * AudioWorkletGlobalScope (tempoWorklet.ts) and, unchanged, under Vitest
 * (tests/tempoAnalyzer.test.ts, tests/tempoEval/run.ts's analyzer path).
 */

export interface TempoOnset {
  time: number;
  strength: number;
  bass: number;
}

const FFT_SIZE = 2048;
const HALF = FFT_SIZE / 2;
const LOG_C = 1e4;

// The pair-comb settings this hop-based pipeline actually won on, measured
// against tests/tempoEval/synth.ts's synthesized tracks (see this module's
// own header, and tests/tempoEval.test.ts's analyzer-path table for the
// current numbers) — house/hip-hop/drum & bass/ramp all scored strongly
// right after warm-up at this setting; a looser tolerance cost ramp's
// tracking, a shorter recency made the estimate chase noise between real
// tempo changes.
const PAIR_TOL_SEC = 0.03;
const PAIR_REFINE_TOL_SEC = PAIR_TOL_SEC / 2;
const RECENCY_SEC = 3;
const ONSET_TIME_OFFSET_HOPS = 2.3;
const TEMPO_SWITCH_MARGIN = 1.25; // matches the measured prototype's own hardcoded hysteresis margin
const PERIOD_STEP_SEC = 0.0025;

const BASS_WEIGHT = 2; // how much harder the low bands count toward flux/onset "bass", not the tempo vote
const ONSET_K = 1.5; // onset threshold: baseline + ONSET_K * deviation
const REFRACTORY_SEC = 0.1;
const ONSET_WIN_SEC = 6;
const MAX_PAIR_ONSETS = 64; // hard cap on the onset window this hop's comb searches, mirrors features.ts's MAX_ONSETS

export class TempoAnalyzer {
  readonly sampleRate: number;
  readonly hop: number;
  readonly hopSec: number;
  bpm = 0;
  // FFT
  private win = new Float64Array(FFT_SIZE);
  private rev = new Uint16Array(FFT_SIZE);
  private cos = new Float64Array(HALF);
  private sin = new Float64Array(HALF);
  private re = new Float64Array(FFT_SIZE);
  private im = new Float64Array(FFT_SIZE);
  private binLo = new Int32Array(NUM_BANDS);
  private binHi = new Int32Array(NUM_BANDS);
  private lowBands: number;
  // sample ring
  private ring = new Float32Array(FFT_SIZE);
  private ringPos = 0;
  private sinceHop = 0;
  private prevLog = new Float64Array(NUM_BANDS);
  // onset picking
  private m = 0;
  private dev = 0;
  private hist = [0, 0, 0];
  private histBass = [0, 0, 0];
  private lastOnset = -Infinity;
  private onsetsOut: TempoOnset[] = [];
  private pairOnsets: { time: number; weight: number }[] = [];

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.hop = Math.round(sampleRate * (512 / 48000));
    this.hopSec = this.hop / sampleRate;
    for (let n = 0; n < FFT_SIZE; n++) this.win[n] = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / FFT_SIZE) + 0.08 * Math.cos((4 * Math.PI * n) / FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      let r = 0;
      let x = i;
      for (let b = 0; b < 11; b++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.rev[i] = r;
    }
    for (let i = 0; i < HALF; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / FFT_SIZE);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / FFT_SIZE);
    }
    const binHz = sampleRate / FFT_SIZE;
    const maxHz = Math.min(MAX_HZ_CAP, sampleRate / 2 - binHz);
    const edges = bandEdgesHz(maxHz);
    let low = 0;
    for (let b = 0; b < NUM_BANDS; b++) {
      const lo = Math.min(HALF - 1, Math.max(0, Math.round(edges[b]! / binHz)));
      const hi = Math.min(HALF - 1, Math.max(0, Math.round(edges[b + 1]! / binHz)));
      this.binLo[b] = lo;
      this.binHi[b] = Math.max(lo + 1, hi);
      if (edges[b + 1]! <= 180) low = b + 1;
    }
    this.lowBands = low;
  }

  /** Feed consecutive mono samples; `startTime` is the audio time of samples[0]. */
  push(samples: Float32Array, startTime: number): void {
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.ringPos] = samples[i]!;
      this.ringPos = (this.ringPos + 1) % FFT_SIZE;
      if (++this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        this.analyseHop(startTime + (i + 1) / this.sampleRate);
      }
    }
  }

  drainOnsets(): TempoOnset[] {
    const out = this.onsetsOut;
    this.onsetsOut = [];
    return out;
  }

  private analyseHop(endTime: number): void {
    const { re, im, win, rev, cos, sin } = this;
    for (let n = 0; n < FFT_SIZE; n++) {
      const j = rev[n]!;
      re[j] = this.ring[(this.ringPos + n) % FFT_SIZE]! * win[n]!;
      im[j] = 0;
    }
    for (let size = 2; size <= FFT_SIZE; size <<= 1) {
      const half = size >> 1;
      const step = FFT_SIZE / size;
      for (let i = 0; i < FFT_SIZE; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j;
          const b = a + half;
          const tr = re[b]! * cos[k]! - im[b]! * sin[k]!;
          const ti = re[b]! * sin[k]! + im[b]! * cos[k]!;
          re[b] = re[a]! - tr;
          im[b] = im[a]! - ti;
          re[a] = re[a]! + tr;
          im[a] = im[a]! + ti;
        }
      }
    }
    let flux = 0;
    let bassFlux = 0;
    for (let b = 0; b < NUM_BANDS; b++) {
      let s = 0;
      for (let k = this.binLo[b]!; k < this.binHi[b]!; k++) s += Math.hypot(re[k]!, im[k]!);
      const mag = s / (this.binHi[b]! - this.binLo[b]!) / FFT_SIZE;
      const l = Math.log1p(LOG_C * mag);
      const d = Math.max(0, l - this.prevLog[b]!);
      this.prevLog[b] = l;
      const isLow = b < this.lowBands;
      flux += d * (isLow ? BASS_WEIGHT : 1);
      if (isLow) bassFlux += d;
    }

    this.pickOnset(flux, bassFlux, endTime);

    if (this.bpm > 0 && endTime - this.lastOnset > TEMPO_DECAY_SEC) {
      this.bpm = 0;
      this.pairOnsets = [];
    }
  }

  private pickOnset(flux: number, bassFlux: number, endTime: number): void {
    const a = Math.min(1, this.hopSec / 1.0);
    const h = this.hist;
    h[0] = h[1]!;
    h[1] = h[2]!;
    h[2] = flux;
    const hb = this.histBass;
    hb[0] = hb[1]!;
    hb[1] = hb[2]!;
    hb[2] = bassFlux;
    const thr = this.m + ONSET_K * this.dev + 0.05;
    const peak = h[1]! > h[0]! && h[1]! >= h[2]!;
    const t = endTime - ONSET_TIME_OFFSET_HOPS * this.hopSec;
    if (peak && h[1]! > thr && t - this.lastOnset > REFRACTORY_SEC) {
      this.lastOnset = t;
      const strength = Math.min(4, h[1]! / Math.max(1e-6, thr));
      const bass = h[1]! > 0 ? Math.min(1, (hb[1]! * BASS_WEIGHT) / h[1]!) : 0;
      this.onsetsOut.push({ time: t, strength, bass });
      // Tempo vote weight is broadband strength alone — bass deliberately
      // excluded here, see this module's header.
      this.registerPair(t, strength);
    }
    this.m += (flux - this.m) * a;
    this.dev += (Math.abs(flux - this.m) - this.dev) * a;
  }

  private registerPair(time: number, weight: number): void {
    this.pairOnsets.push({ time, weight });
    while (this.pairOnsets.length > MAX_PAIR_ONSETS || this.pairOnsets[0]!.time < time - ONSET_WIN_SEC) this.pairOnsets.shift();

    const result = estimateTempo(this.pairOnsets, time, this.bpm, {
      tolSec: PAIR_TOL_SEC,
      refineTolSec: PAIR_REFINE_TOL_SEC,
      recencySec: RECENCY_SEC,
      switchMargin: TEMPO_SWITCH_MARGIN,
      periodStepSec: PERIOD_STEP_SEC,
      bpmMin: BPM_MIN,
      bpmMax: BPM_MAX,
    });
    if (result !== null) this.bpm = result;
  }
}
