import { NUM_BANDS, type FeatureFrame } from "./types.ts";
import { ANALYSER_MIN_DB, ANALYSER_MAX_DB } from "./analyser.ts";

// Adaptive floor/ceiling per band: a leaky min/max that tracks the room's
// own quiet and loud levels. This is what makes a muffled laptop mic and a
// hot phone mic converge to similarly-scaled output. Values are exponential
// time constants (1/tau, per second) — bigger = faster to react.
//
// Bypassable via update()'s `autoGain` param (see src/audio/autoGain.ts for
// the persisted on/off switch) — off falls back to a fixed mapping against
// the analyser's own dB window, matching app.ts's "before processing" feed.
const FLOOR_RISE_RATE = 0.8; // floor creeping up while it's quiet (~1.25s)
const FLOOR_FALL_RATE = 8; // floor dropping to follow a true drop in level (~0.1s)
const PEAK_RISE_RATE = 25; // ceiling jumping up on a loud hit (~0.04s, fast attack)
const PEAK_FALL_RATE = 1.5; // ceiling relaxing back down between hits (~0.67s)
// How long the ceiling holds at a fresh peak before PEAK_FALL_RATE is allowed
// to relax it — standard peak-hold-meter behavior. Without this the ceiling
// starts sagging immediately after every hit, so the gap between beats reads
// as louder than it is (the room didn't get quieter, the ceiling just gave
// up). 0.3s comfortably spans the gap between beats up to 200bpm while still
// following a genuine drop in level within a second.
const PEAK_HOLD_SEC = 0.3;
const MIN_RANGE_DB = 12; // never let (peak - floor) collapse below this

function expBlend(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

// Attack/release envelope applied to the normalized band value, so visuals
// punch on transients but don't strobe on FFT-frame-to-frame noise. Attack is
// fast (exactly 2 frames to ~90% via expBlend, independent of frame rate —
// see expBlend above, not a per-frame Math.min(1, rate*dt) which would
// saturate at 1.0 for any rate*dt >= 1 and so run frame-rate-dependent above
// ~70fps) since a slow attack is pure perceived lag; release stays slow —
// that's what actually prevents strobing.
const ATTACK_PER_SEC = 70;
const RELEASE_PER_SEC = 6;

// Onset detection over the summed positive spectral flux. Left as a plain
// Math.min(1, rate*dt) coefficient, unlike the envelope above: at rate 3 it's
// 0.05 at 60fps versus expBlend's 0.0488 — it never saturates at any
// realistic frame rate, so there's no frame-rate bug here to fix.
const FLUX_ADAPTIVE_RATE = 3; // how fast the local flux baseline adapts
const FLUX_THRESHOLD_MULT = 1.6;
const FLUX_THRESHOLD_MARGIN = 0.03;
const ONSET_REFRACTORY_SEC = 0.1; // ~600 BPM ceiling, prevents double-triggers

// BPM estimation — a comb over the gaps between every pair of recent onsets
// (see registerOnset). Candidate periods step through the tempo window;
// COMB_TOL_SEC is how far off a whole number of beats a gap may land and
// still count for a candidate — in seconds, not beats, because onset
// times are quantised to frames and the same jitter must not cost a fast
// tempo more credibility than a slow one (in beats it did, and 170bpm
// lost to its half). A gap of k beats votes with weight 1/k:
// the beat-to-beat gap is the fundamental evidence, and a fast candidate
// that only fits the true gaps as its 2nd/3rd multiples (a sub-harmonic
// grid, e.g. a click plus a loud echo a third of a beat later) must not
// out-vote the tempo whose single beat is actually being hit.
// Onsets are kept by age, not count: a mic's noise floor fires spurious
// onsets between real hits (the adaptive window collapses in near-silence
// and every wobble clears the threshold), and a fixed count of the most
// recent onsets would then hold only a couple of real beats. Each onset
// carries a weight — how far its flux cleared the threshold, capped — so
// pairs of weak noise onsets barely vote against pairs of real hits.
const ONSET_WINDOW_SEC = 6;
const MAX_ONSETS = 48; // hard cap for the O(n²) pair walk
const ONSET_WEIGHT_CAP = 4;
const MAX_PAIR_GAP_SEC = 4;
const BPM_MIN = 70;
const BPM_MAX = 180;
const PERIOD_STEP_SEC = 0.005;
const COMB_TOL_SEC = 0.05; // ~one and a half frames at 30fps
// Tighter for the final beat-length measurement than for picking the
// winner: a slightly-off onset still helps choose the tempo, but
// averaging it in would shift the number shown.
const REFINE_TOL_SEC = 0.025;
// A rival tempo must out-score the current one by this factor to replace
// it — without it, two near-equal candidates (a tempo and something close
// to a simple ratio of it) can trade places on every onset.
const TEMPO_SWITCH_MARGIN = 1.25;

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
  // Absolute AudioContext.currentTime a band's peak may next decay at — see
  // PEAK_HOLD_SEC. Float64, not Float32: this stores an unbounded, ever-growing
  // clock reading (unlike the other per-band arrays, which hold bounded [0,1]
  // or dB values), and Float32 precision degrades to ~8ms after a day of
  // uptime, comparable to PEAK_HOLD_SEC itself. -Infinity so the very first
  // frames are never spuriously held.
  private peakHoldUntil = new Float64Array(NUM_BANDS).fill(-Infinity);
  private env = new Float32Array(NUM_BANDS);
  private prevNorm = new Float32Array(NUM_BANDS);

  private fluxBaseline = 0;
  private lastTime: number | null = null;
  private lastOnsetTime = -Infinity;
  private onsets: { time: number; weight: number }[] = [];
  private bpm = 0;
  private lastBeatTime = 0;

  /**
   * @param rawBandsDb per-band FFT magnitude in dB, from BandAnalyser.readBandsDb().
   * @param autoGain When false, bypasses the per-band adaptive floor/peak
   *   normalization below in favor of a fixed mapping against the analyser's
   *   own dB window (ANALYSER_MIN_DB/MAX_DB) — the same one
   *   app.ts's captureRawBands uses for the "before processing" display, so
   *   the two agree on scale. The floor/peak trackers, flux, and onset/BPM
   *   detection below keep running on the adaptive `norm` regardless — only
   *   what lands in `bands[]`/`energy` changes — so turning this off doesn't
   *   degrade beat detection, which is calibrated against the adaptive value.
   *   Defaults to true so every existing call site keeps today's behavior.
   */
  update(rawBandsDb: Float32Array, time: number, autoGain = true): FeatureFrame {
    const dt = this.lastTime === null ? 1 / 60 : Math.max(1e-4, time - this.lastTime);
    this.lastTime = time;

    const bands = new Float32Array(NUM_BANDS);
    let flux = 0;
    let rawPowSum = 0;
    const fixedSpan = ANALYSER_MAX_DB - ANALYSER_MIN_DB;

    for (let b = 0; b < NUM_BANDS; b++) {
      const db = sanitizeDb(rawBandsDb[b]);
      rawPowSum += Math.pow(10, db / 10);

      // Leaky min/max adapts the [floor, peak] window to this room/mic. Kept
      // running even with autoGain off, since onset/BPM detection below
      // always reads `norm`.
      const floorRate = db < this.floor[b] ? FLOOR_FALL_RATE : FLOOR_RISE_RATE;
      this.floor[b] += (db - this.floor[b]) * expBlend(floorRate, dt);

      // Ceiling rises immediately on a new peak (and refreshes the hold
      // window); otherwise it only starts relaxing back down once the hold
      // window has elapsed, rather than sagging in every gap between hits.
      if (db > this.peak[b]) {
        this.peak[b] += (db - this.peak[b]) * expBlend(PEAK_RISE_RATE, dt);
        this.peakHoldUntil[b] = time + PEAK_HOLD_SEC;
      } else if (time >= this.peakHoldUntil[b]) {
        this.peak[b] += (db - this.peak[b]) * expBlend(PEAK_FALL_RATE, dt);
      }

      const range = Math.max(MIN_RANGE_DB, this.peak[b] - this.floor[b]);
      const norm = clamp01((db - this.floor[b]) / range);

      const target = autoGain ? norm : clamp01((db - ANALYSER_MIN_DB) / fixedSpan);
      const rate = target > this.env[b] ? ATTACK_PER_SEC : RELEASE_PER_SEC;
      this.env[b] += (target - this.env[b]) * expBlend(rate, dt);
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
      this.registerOnset(time, flux / threshold);
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

  /** @param strength flux over the firing threshold — 1 is a bare trigger. */
  private registerOnset(time: number, strength: number): void {
    this.lastBeatTime = time;
    this.onsets.push({ time, weight: Math.min(ONSET_WEIGHT_CAP, Math.max(1, strength)) });
    while (this.onsets.length > MAX_ONSETS || this.onsets[0].time < time - ONSET_WINDOW_SEC) this.onsets.shift();
    if (this.onsets.length < 3) return;

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
    const onsets = this.onsets;
    const n = onsets.length;
    // A pair's vote is worth the weaker of its two onsets: a real hit
    // paired with a noise blip is still a noise gap.
    const gaps: number[] = [];
    const weights: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const gap = onsets[j].time - onsets[i].time;
        if (gap > MAX_PAIR_GAP_SEC) break; // ascending, so later j are further still
        gaps.push(gap);
        weights.push(Math.min(onsets[i].weight, onsets[j].weight));
      }
    }

    const combScore = (period: number): number => {
      let score = 0;
      for (let g = 0; g < gaps.length; g++) {
        const k = Math.round(gaps[g] / period);
        if (k < 1) continue;
        const err = Math.abs(gaps[g] - k * period);
        if (err >= COMB_TOL_SEC) continue;
        score += ((1 - err / COMB_TOL_SEC) * weights[g]) / k;
      }
      return score;
    };

    const periodMin = 60 / BPM_MAX;
    const periodMax = 60 / BPM_MIN;
    let bestPeriod = 0;
    let bestScore = 0;
    for (let period = periodMin; period <= periodMax + 1e-9; period += PERIOD_STEP_SEC) {
      const score = combScore(period);
      if (score > bestScore) {
        bestScore = score;
        bestPeriod = period;
      }
    }
    if (bestPeriod === 0) return;

    // Hysteresis: stay on the current tempo unless the rival clearly wins.
    // The refinement below still follows genuine drift, since it re-measures
    // the beat length from whatever gaps fit.
    if (this.bpm > 0) {
      const current = 60 / this.bpm;
      if (current >= periodMin && current <= periodMax && bestScore < combScore(current) * TEMPO_SWITCH_MARGIN) {
        bestPeriod = current;
      }
    }

    // Refine past the candidate grid: the mean beat length implied by every
    // gap that fits the winner.
    let sum = 0;
    let total = 0;
    for (let g = 0; g < gaps.length; g++) {
      const k = Math.round(gaps[g] / bestPeriod);
      if (k < 1 || Math.abs(gaps[g] - k * bestPeriod) >= REFINE_TOL_SEC) continue;
      sum += (gaps[g] / k) * weights[g];
      total += weights[g];
    }
    if (total > 0) this.bpm = 60 / (sum / total);
  }
}
