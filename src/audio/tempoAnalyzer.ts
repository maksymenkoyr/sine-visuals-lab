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
 * The detector reads the same from a near or a far mic. Before the log
 * compression, every band magnitude is scaled by how far the input's held
 * level sits from LEVEL_REF_DB, the level synth.ts's tracks play at and the
 * level everything here was tuned at. Without that, a quiet input landed on
 * the near-linear stretch of log1p, where the same hits voted with
 * different strengths, so a far mic changed which tempo won. That old fixed
 * knee was also what kept a far mic's room noise out, so a noise floor takes
 * its place: no band's knee sits lower than NOISE_KNEE_DB above that band's
 * own floor (the minimum of its smoothed magnitude over NOISE_WIN_SEC). The
 * floor also settles on a song's sustained sound (a held bass line, pads,
 * a vocal), so only what rises out of it counts as a hit; on real songs that
 * fixed more wrong tempos than anything else here. The smoother starts at
 * the first hop's level rather than at zero, so that holds from the first
 * beat. Flux is measured against each band's maximum over the last
 * FLUX_REF_HOPS hops, not just the previous hop, so a room's echo of a hit
 * (a fainter copy a few tens of milliseconds later) can't climb past the
 * hit and fire again. REFRACTORY_SEC stays under a sixteenth note at
 * BPM_MAX: drum & bass puts a kick and a snare a sixteenth apart, and a
 * longer lockout dropped the snare whenever the kick was heard.
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
const ONSET_TIME_OFFSET_HOPS = 2.7;
const TEMPO_SWITCH_MARGIN = 1.25; // matches the measured prototype's own hardcoded hysteresis margin
const PERIOD_STEP_SEC = 0.0025;

// Level and room (see this module's header). The input's short-term power
// (a LEVEL_SHORT_SEC average) is peak-held with a slow LEVEL_RELEASE_SEC
// fall; LEVEL_FLOOR_DB caps the boost, so digital silence is never pulled up
// to music level. Each band's floor is the minimum of its magnitude, smoothed
// over NOISE_SMOOTH_SEC, across NOISE_SUBWINS rolling slices of
// NOISE_WIN_SEC.
const LEVEL_SHORT_SEC = 0.3;
const LEVEL_RELEASE_SEC = 10;
const LEVEL_REF_DB = -19.5;
const LEVEL_FLOOR_DB = -66;
const NOISE_SMOOTH_SEC = 0.5;
const NOISE_WIN_SEC = 6;
const NOISE_SUBWINS = 4;
const NOISE_KNEE_DB = 12;
const FLUX_REF_HOPS = 5;

const BASS_WEIGHT = 2; // how much harder the low bands count toward flux/onset "bass", not the tempo vote
const ONSET_K = 1.5; // onset threshold: baseline + ONSET_K * deviation
const REFRACTORY_SEC = 0.05;
const ONSET_WIN_SEC = 6;
const MAX_PAIR_ONSETS = 64; // hard cap on the onset window this hop's comb searches, mirrors features.ts's MAX_ONSETS

// What drainOnsets() hands back when nothing fired — shared and frozen, so a
// caller that tried to keep or mutate it would fail loudly instead of
// corrupting every later empty drain.
const NO_ONSETS = Object.freeze([]) as unknown as TempoOnset[];

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
  // input level (power, not dB)
  private hopSq = 0;
  private shortPow = 0;
  private heldPow = 0;
  private readonly levelShortA: number;
  private readonly levelRelease: number;
  private readonly refPow = Math.pow(10, LEVEL_REF_DB / 10);
  private readonly floorPow = Math.pow(10, LEVEL_FLOOR_DB / 10);
  // per-band floor (smoothMag -1 = no hop seen yet)
  private smoothMag = new Float64Array(NUM_BANDS).fill(-1);
  private subMin = new Float64Array(NUM_BANDS).fill(Infinity);
  private subMins = Array.from({ length: NOISE_SUBWINS }, () => new Float64Array(NUM_BANDS).fill(Infinity));
  private subHop = 0;
  private subPos = 0;
  private readonly subHops: number;
  private readonly noiseSmoothA: number;
  private readonly noiseKnee = Math.pow(10, NOISE_KNEE_DB / 20);
  // each band's log magnitude over the last FLUX_REF_HOPS hops (a ring)
  private prevLogs = Array.from({ length: FLUX_REF_HOPS }, () => new Float64Array(NUM_BANDS));
  private prevPos = 0;
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
    this.levelShortA = Math.min(1, this.hopSec / LEVEL_SHORT_SEC);
    this.levelRelease = Math.exp(-this.hopSec / LEVEL_RELEASE_SEC);
    this.noiseSmoothA = Math.min(1, this.hopSec / NOISE_SMOOTH_SEC);
    this.subHops = Math.max(1, Math.round(NOISE_WIN_SEC / NOISE_SUBWINS / this.hopSec));
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
      const s = samples[i]!;
      this.ring[this.ringPos] = s;
      this.hopSq += s * s;
      this.ringPos = (this.ringPos + 1) % FFT_SIZE;
      if (++this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        this.analyseHop(startTime + (i + 1) / this.sampleRate);
      }
    }
  }

  drainOnsets(): TempoOnset[] {
    // process() calls this ~375 times a second and most calls find nothing —
    // hand back a shared empty array rather than allocating a fresh one.
    // Callers only read it (tempoWorklet.ts posts the length).
    if (this.onsetsOut.length === 0) return NO_ONSETS;
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
    this.shortPow += (this.hopSq / this.hop - this.shortPow) * this.levelShortA;
    this.hopSq = 0;
    this.heldPow = Math.max(this.shortPow, this.heldPow * this.levelRelease, this.floorPow);
    // where LOG_C puts the log knee for input at LEVEL_REF_DB, moved with the input's level
    const musicKnee = Math.sqrt(this.heldPow / this.refPow) / LOG_C;
    const newSub = ++this.subHop >= this.subHops;
    if (newSub) this.subHop = 0;
    let flux = 0;
    let bassFlux = 0;
    for (let b = 0; b < NUM_BANDS; b++) {
      let s = 0;
      for (let k = this.binLo[b]!; k < this.binHi[b]!; k++) s += Math.hypot(re[k]!, im[k]!);
      const mag = s / (this.binHi[b]! - this.binLo[b]!) / FFT_SIZE;
      const sm = this.smoothMag[b]! < 0 ? mag : this.smoothMag[b]! + (mag - this.smoothMag[b]!) * this.noiseSmoothA;
      this.smoothMag[b] = sm;
      let floor = Math.min(this.subMin[b]!, sm);
      this.subMin[b] = floor;
      for (let w = 0; w < NOISE_SUBWINS; w++) floor = Math.min(floor, this.subMins[w]![b]!);
      const l = Math.log1p(mag / Math.max(musicKnee, this.noiseKnee * floor));
      let ref = 0;
      for (let j = 0; j < FLUX_REF_HOPS; j++) ref = Math.max(ref, this.prevLogs[j]![b]!);
      const d = Math.max(0, l - ref);
      this.prevLogs[this.prevPos]![b] = l;
      const isLow = b < this.lowBands;
      flux += d * (isLow ? BASS_WEIGHT : 1);
      if (isLow) bassFlux += d;
    }
    this.prevPos = (this.prevPos + 1) % FLUX_REF_HOPS;
    if (newSub) {
      const done = this.subMins[this.subPos]!;
      done.set(this.subMin);
      this.subPos = (this.subPos + 1) % NOISE_SUBWINS;
      this.subMin.fill(Infinity);
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
