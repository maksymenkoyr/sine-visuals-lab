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

// BPM estimation — a comb over the gaps between every pair of recent onsets
// (see registerOnset). Candidate periods step through the tempo window;
// COMB_TOL_BEATS is how far off an integer number of beats a gap may land
// and still count for a candidate; ONE_BEAT_BONUS breaks the tie between a
// tempo and its double (both fit a clean track's gaps) toward the one whose
// single beat is actually being hit.
const MAX_ONSET_HISTORY = 16;
const MAX_PAIR_GAP_SEC = 4;
const BPM_MIN = 70;
const BPM_MAX = 180;
const PERIOD_STEP_SEC = 0.005;
const COMB_TOL_BEATS = 0.12;
const ONE_BEAT_BONUS = 0.5;

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

    // The gap between every pair of recent onsets, then a comb: each
    // candidate period is scored by how many gaps land on a whole number of
    // its beats. This is what survives a messy detector — extra onsets (a
    // click's tail firing just past the refractory) and missed ones only
    // add gaps that fit no candidate well, while the true spacing and all
    // its multiples keep fitting the true period. Two earlier schemes
    // failed on a plain 100bpm metronome: the mode of adjacent gaps (the
    // tail made them alternate 0.14s/0.46s, and 0.46s is 130bpm), then the
    // mode of all pair gaps folded into range by halving — folding is only
    // right for power-of-two multiples, so three-beat gaps voted for 133
    // and it read 115.
    const times = this.onsetTimes;
    const n = times.length;
    const gaps: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const gap = times[j] - times[i];
        if (gap > MAX_PAIR_GAP_SEC) break; // ascending, so later j are further still
        gaps.push(gap);
      }
    }

    const periodMin = 60 / BPM_MAX;
    const periodMax = 60 / BPM_MIN;
    let bestPeriod = 0;
    let bestScore = 0;
    for (let period = periodMin; period <= periodMax + 1e-9; period += PERIOD_STEP_SEC) {
      let score = 0;
      for (const gap of gaps) {
        const beats = gap / period;
        const k = Math.round(beats);
        if (k < 1) continue;
        const err = Math.abs(beats - k);
        if (err >= COMB_TOL_BEATS) continue;
        score += (1 - err / COMB_TOL_BEATS) * (k === 1 ? 1 + ONE_BEAT_BONUS : 1);
      }
      if (score > bestScore) {
        bestScore = score;
        bestPeriod = period;
      }
    }
    if (bestPeriod === 0) return;

    // Refine past the candidate grid: the mean beat length implied by every
    // gap that fits the winner.
    let sum = 0;
    let count = 0;
    for (const gap of gaps) {
      const beats = gap / bestPeriod;
      const k = Math.round(beats);
      if (k < 1 || Math.abs(beats - k) >= COMB_TOL_BEATS) continue;
      sum += gap / k;
      count++;
    }
    if (count > 0) this.bpm = 60 / (sum / count);
  }
}
