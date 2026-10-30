// Copied from audio-subsystem/v6 (2026-10-30, #798/#800); the bench check (bench-signals' probe app-song) holds it equal to v6. Edit: an import path.
// Kick loudness and the build-up, as v2.1 reads them (the bench's `v2.1.decibels_low` and
// `v2.1.buildup`). v2.1 is Swift on Accelerate; this is a rewrite of its AudioAnalyzer.swift,
// SpectrumAnalyzer.swift, RollingStats.swift and Smoothing.swift (frozen snapshot in
// ../../../bench/systems/v2.1/Sources/AudioReactive/), cut down to the low band's dB and the
// follower chain behind `buildup`. Float32 vDSP against doubles here leaves small differences, so
// bench-signals/src/rich/v6-check.ts holds this one to a correlation, not to equality.

import { Fft } from "../engine/fft.ts";

const WINDOW = 2048;
const HOP = 512;
/** The silence rule and the level map: v2.1's private constants of the same names. */
const SILENCE_DB = -60;
const MIN_SPREAD_DB = 1;
const LEVEL_SPREAD = 2.5;
const NORMALIZATION_S = 2;
/** v2.1 reads a band's dB before any hop has arrived as this. */
const FLOOR_DB = -120;
/** The default sensitivity (0.5) puts the level exponent at 1.8 - 1.2 * 0.5. */
const SENSITIVITY = 0.5;
const LEVEL_EXPONENT = 1.8 - 1.2 * SENSITIVITY;
const LEVEL_RISE_S = 0.02;
const LEVEL_FALL_S = 0.25;
const BUILDUP_RISE_S = 8;
const BUILDUP_FALL_S = 4;
/** Bin of the unit sine that fixes the power scale, as in SpectrumAnalyzer.calibrate. */
const CALIBRATION_BIN = 16;

/** AudioFrame.swift Band ranges in Hz; `full` is the mean of the partial bands' dB. */
const PARTIAL_BANDS: readonly (readonly [number, number])[] = [
  [30, 160],
  [160, 800],
  [800, 4000],
  [4000, 16000],
];
const LOW = 0;

class Follower {
  value = 0;
  private readonly rise: number;
  private readonly fall: number;

  constructor(rise: number, fall: number) {
    this.rise = rise;
    this.fall = fall;
  }

  step(target: number, dt: number): number {
    const seconds = target > this.value ? this.rise : this.fall;
    const amount = seconds > 0 ? 1 - Math.exp(-dt / seconds) : 1;
    this.value += (target - this.value) * amount;
    return this.value;
  }
}

/** Mean and spread of the last `capacity` values (RollingStats.swift, without its drift repair). */
class RollingStats {
  count = 0;
  private readonly capacity: number;
  private readonly values: Float64Array;
  private next = 0;
  private sum = 0;
  private sumOfSquares = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.values = new Float64Array(capacity);
  }

  get mean(): number {
    return this.count === 0 ? 0 : this.sum / this.count;
  }

  get standardDeviation(): number {
    if (this.count <= 1) return 0;
    const m = this.mean;
    return Math.sqrt(Math.max(this.sumOfSquares / this.count - m * m, 0));
  }

  add(value: number): void {
    if (this.count === this.capacity) {
      const leaving = this.values[this.next];
      this.sum -= leaving;
      this.sumOfSquares -= leaving * leaving;
    } else this.count++;
    this.values[this.next] = value;
    this.sum += value;
    this.sumOfSquares += value * value;
    this.next = (this.next + 1) % this.capacity;
  }
}

const powerDb = (power: number) => 10 * Math.log10(Math.max(power, 1e-12));
const amplitudeDb = (amplitude: number) => 20 * Math.log10(Math.max(amplitude, 1e-6));

export class V21 {
  /** Mean bin power of the low band in the latest hop, dB. */
  lowDb = FLOOR_DB;
  /** Slow follower of the whole spectrum's level; rises over several seconds of sustained energy. */
  buildup = 0;
  private readonly binWidth: number;
  private readonly fft = new Fft(WINDOW);
  private readonly window = new Float64Array(WINDOW);
  private readonly recent = new Float64Array(WINDOW);
  private readonly re = new Float64Array(WINDOW);
  private readonly im = new Float64Array(WINDOW);
  private readonly power = new Float64Array(WINDOW / 2);
  private scale = 1;
  private readonly hop = new Float32Array(HOP);
  private hopFill = 0;
  private silent = true;
  // Index 0 is the low band and the last is the full band; only these two are read.
  private readonly stats: RollingStats[];
  private readonly levels = [0, 0];
  private readonly followers = [new Follower(LEVEL_RISE_S, LEVEL_FALL_S), new Follower(LEVEL_RISE_S, LEVEL_FALL_S)];
  private readonly buildupFollower = new Follower(BUILDUP_RISE_S, BUILDUP_FALL_S);

  constructor(sampleRate: number) {
    this.binWidth = sampleRate / WINDOW;
    // vDSP's periodic Blackman window.
    for (let i = 0; i < WINDOW; i++) {
      const p = (2 * Math.PI * i) / WINDOW;
      this.window[i] = 0.42 - 0.5 * Math.cos(p) + 0.08 * Math.cos(2 * p);
    }
    const hopRate = sampleRate / HOP;
    const statsWindow = Math.max(Math.round(NORMALIZATION_S * hopRate), 2);
    this.stats = [new RollingStats(statsWindow), new RollingStats(statsWindow)];
    // vDSP's real DFT carries a packing-dependent scale, so v2.1 measures a unit sine instead of
    // trusting a formula; doing the same here makes the scale agree whatever the transform's.
    for (let n = 0; n < WINDOW; n++) this.recent[n] = Math.sin((2 * Math.PI * CALIBRATION_BIN * n) / WINDOW);
    this.transform();
    this.scale = this.power[CALIBRATION_BIN] > 0 ? 1 / this.power[CALIBRATION_BIN] : 1;
    this.recent.fill(0);
  }

  push(samples: Float32Array): void {
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(HOP - this.hopFill, samples.length - offset);
      this.hop.set(samples.subarray(offset, offset + take), this.hopFill);
      this.hopFill += take;
      offset += take;
      if (this.hopFill === HOP) {
        this.analyseHop();
        this.hopFill = 0;
      }
    }
  }

  /** Moves the followers forward by `dt` seconds, once per rendered frame after the hops that arrived in it. */
  advance(dt: number): void {
    const fullLevel = this.followers[1].step(this.levels[1] ** LEVEL_EXPONENT, dt);
    this.followers[0].step(this.levels[0] ** LEVEL_EXPONENT, dt);
    this.buildup = this.buildupFollower.step(fullLevel, dt);
  }

  private analyseHop(): void {
    const hop = this.hop;
    this.recent.copyWithin(0, HOP);
    for (let i = 0; i < HOP; i++) this.recent[WINDOW - HOP + i] = hop[i];
    this.transform();

    let sq = 0;
    for (let i = 0; i < HOP; i++) sq += hop[i] * hop[i];
    this.silent = amplitudeDb(Math.sqrt(sq / HOP)) < SILENCE_DB;

    const dbs = PARTIAL_BANDS.map(([lo, hi]) => powerDb(this.meanPower(lo, hi)));
    // Equal weight in dB follows overall activity; a power average would just mirror the low band.
    const full = dbs.reduce((a, b) => a + b, 0) / dbs.length;
    this.lowDb = dbs[LOW];

    [dbs[LOW], full].forEach((loudness, i) => {
      if (this.silent) {
        this.levels[i] = 0;
        return;
      }
      // Judged against history before this hop is added, so a hit is not diluted by itself.
      const stats = this.stats[i];
      const spread = Math.max(stats.standardDeviation, MIN_SPREAD_DB);
      const deviation = stats.count > 0 ? (loudness - stats.mean) / spread : 0;
      this.levels[i] = Math.min(Math.max((deviation + LEVEL_SPREAD) / (2 * LEVEL_SPREAD), 0), 1);
      stats.add(loudness);
    });
  }

  private transform(): void {
    for (let i = 0; i < WINDOW; i++) {
      this.re[i] = this.recent[i] * this.window[i];
      this.im[i] = 0;
    }
    this.fft.transform(this.re, this.im);
    for (let k = 0; k < WINDOW / 2; k++) this.power[k] = (this.re[k] * this.re[k] + this.im[k] * this.im[k]) * this.scale;
  }

  /** Mean power across the range in Hz, weighting partly covered edge bins by their overlap. */
  private meanPower(lowHz: number, highHz: number): number {
    const bins = WINDOW / 2;
    const lower = Math.max(lowHz / this.binWidth, 0);
    const upper = Math.min(highHz / this.binWidth, bins - 0.5);
    if (!(upper > lower)) return 0;
    const first = Math.floor(lower + 0.5);
    const last = Math.min(Math.floor(upper + 0.5), bins - 1);
    let total = 0;
    for (let bin = first; bin <= last; bin++) {
      const overlap = Math.min(upper, bin + 0.5) - Math.max(lower, bin - 0.5);
      if (overlap > 0) total += this.power[bin] * overlap;
    }
    return total / (upper - lower);
  }
}
