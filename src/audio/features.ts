import { NUM_BANDS, type FeatureFrame } from "./types.ts";

// Adaptive floor/ceiling per band: a leaky min/max that tracks the room's
// own quiet and loud levels. This is what makes a muffled laptop mic and a
// hot phone mic converge to similarly-scaled output. Values are exponential
// time constants (1/tau, per second) — bigger = faster to react.
const FLOOR_RISE_RATE = 0.8; // floor creeping up while it's quiet (~1.25s)
const FLOOR_FALL_RATE = 8; // floor dropping to follow a true drop in level (~0.1s)
const PEAK_RISE_RATE = 25; // ceiling jumping up on a loud hit (~0.04s, fast attack)
const PEAK_FALL_RATE = 1.5; // ceiling relaxing back down between hits (~0.67s)
const MIN_RANGE_DB = 12; // never let (peak - floor) collapse below this

function expBlend(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

// Attack/release envelope applied to the normalized band value, so visuals
// punch on transients but don't strobe on FFT-frame-to-frame noise. Attack is
// fast (~1-2 frames to 90% at 60fps) since a slow attack is pure perceived
// lag; release stays slow — that's what actually prevents strobing.
const ATTACK_PER_SEC = 70;
const RELEASE_PER_SEC = 6;

// Onset detection over the summed positive spectral flux.
const FLUX_ADAPTIVE_RATE = 3; // how fast the local flux baseline adapts
const FLUX_THRESHOLD_MULT = 1.6;
const FLUX_THRESHOLD_MARGIN = 0.03;
const ONSET_REFRACTORY_SEC = 0.1; // ~600 BPM ceiling, prevents double-triggers

// BPM estimation from recent inter-onset intervals.
const MAX_ONSET_HISTORY = 12;
const BPM_MIN = 70;
const BPM_MAX = 180;
const IOI_BUCKET_SEC = 0.02;

// getFloatFrequencyData returns -Infinity for a bin with exactly zero
// energy (true silence) — it is NOT clamped by the analyser's
// minDecibels/maxDecibels, unlike the byte API. Left unsanitized, that
// -Infinity poisons the leaky floor/peak trackers into +/-Infinity and
// eventually NaN, which then renders as a permanently black scene.
const DB_FLOOR = -100;

function sanitizeDb(db: number): number {
  return Number.isFinite(db) ? Math.max(db, DB_FLOOR) : DB_FLOOR;
}

// Absolute loudness window for FeatureFrame.level — fixed, unlike the
// per-band floor/peak above. Deliberately not room-adaptive: the whole point
// is a signal that still tells quiet from loud after the AGC above has
// re-adapted and erased that difference from `bands`/`energy`.
const LEVEL_DB_FLOOR = -70; // effectively silence for a typical mic
const LEVEL_DB_CEIL = -15; // a loud room

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Fold a raw inter-onset interval into the [BPM_MIN, BPM_MAX] window by
 * repeatedly doubling/halving — a detector firing on every other beat (or
 * twice per beat) still yields the right tempo class.
 */
function intervalToBpmBucket(intervalSec: number): number | null {
  if (intervalSec <= 0) return null;
  let bpm = 60 / intervalSec;
  while (bpm < BPM_MIN) bpm *= 2;
  while (bpm > BPM_MAX) bpm /= 2;
  return bpm;
}

export class FeatureExtractor {
  private floor = new Float32Array(NUM_BANDS).fill(-100);
  private peak = new Float32Array(NUM_BANDS).fill(-40);
  private env = new Float32Array(NUM_BANDS);
  private prevNorm = new Float32Array(NUM_BANDS);

  private fluxBaseline = 0;
  private lastTime: number | null = null;
  private lastOnsetTime = -Infinity;
  private onsetTimes: number[] = [];
  private bpm = 0;
  private lastBeatTime = 0;

  /** @param rawBandsDb per-band FFT magnitude in dB, from BandAnalyser.readBandsDb(). */
  update(rawBandsDb: Float32Array, time: number): FeatureFrame {
    const dt = this.lastTime === null ? 1 / 60 : Math.max(1e-4, time - this.lastTime);
    this.lastTime = time;

    const bands = new Float32Array(NUM_BANDS);
    let flux = 0;
    let rawPowSum = 0;

    for (let b = 0; b < NUM_BANDS; b++) {
      const db = sanitizeDb(rawBandsDb[b]);
      rawPowSum += Math.pow(10, db / 10);

      // Leaky min/max adapts the [floor, peak] window to this room/mic.
      const floorRate = db < this.floor[b] ? FLOOR_FALL_RATE : FLOOR_RISE_RATE;
      this.floor[b] += (db - this.floor[b]) * expBlend(floorRate, dt);
      const peakRate = db > this.peak[b] ? PEAK_RISE_RATE : PEAK_FALL_RATE;
      this.peak[b] += (db - this.peak[b]) * expBlend(peakRate, dt);

      const range = Math.max(MIN_RANGE_DB, this.peak[b] - this.floor[b]);
      const norm = clamp01((db - this.floor[b]) / range);

      const rate = norm > this.env[b] ? ATTACK_PER_SEC : RELEASE_PER_SEC;
      this.env[b] += (norm - this.env[b]) * Math.min(1, rate * dt);
      bands[b] = this.env[b];

      flux += Math.max(0, norm - this.prevNorm[b]);
      this.prevNorm[b] = norm;
    }

    this.fluxBaseline += (flux - this.fluxBaseline) * Math.min(1, FLUX_ADAPTIVE_RATE * dt);
    const threshold = this.fluxBaseline * FLUX_THRESHOLD_MULT + FLUX_THRESHOLD_MARGIN;
    const canFire = time - this.lastOnsetTime > ONSET_REFRACTORY_SEC;
    const beat = canFire && flux > threshold;

    if (beat) {
      this.lastOnsetTime = time;
      this.registerOnset(time);
    }

    let energy = 0;
    for (let b = 0; b < NUM_BANDS; b++) energy += bands[b];
    energy = clamp01(energy / NUM_BANDS);

    const beatPhase = this.bpm > 0 ? (((time - this.lastBeatTime) / (60 / this.bpm)) % 1 + 1) % 1 : 0;

    // Averaged as power, then back to dB — not a mean of the dB values. Most
    // of the 24 bands sit at the noise floor for any ordinary sound, and a
    // mean of dB let those drag the result down to LEVEL_DB_FLOOR, so level
    // read ~0 for everything short of a loud broadband roar. Power averaging
    // lets the loud bands carry it, which is what loudness is.
    const meanRawDb = 10 * Math.log10(rawPowSum / NUM_BANDS);
    const level = clamp01((meanRawDb - LEVEL_DB_FLOOR) / (LEVEL_DB_CEIL - LEVEL_DB_FLOOR));

    return { time, bands, energy, beat, bpm: this.bpm, beatPhase, level };
  }

  private registerOnset(time: number): void {
    this.lastBeatTime = time;
    this.onsetTimes.push(time);
    if (this.onsetTimes.length > MAX_ONSET_HISTORY) this.onsetTimes.shift();
    if (this.onsetTimes.length < 3) return;

    // Bucket recent inter-onset intervals (tempo-folded) and take the mode —
    // robust to a few spurious/missed onsets without needing full autocorrelation.
    const buckets = new Map<number, number>();
    for (let i = 1; i < this.onsetTimes.length; i++) {
      const bpm = intervalToBpmBucket(this.onsetTimes[i] - this.onsetTimes[i - 1]);
      if (bpm === null) continue;
      const key = Math.round(60 / bpm / IOI_BUCKET_SEC);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    let bestKey = 0;
    let bestCount = 0;
    for (const [key, count] of buckets) {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    }
    if (bestKey > 0) {
      const intervalSec = bestKey * IOI_BUCKET_SEC;
      this.bpm = 60 / intervalSec;
    }
  }
}
