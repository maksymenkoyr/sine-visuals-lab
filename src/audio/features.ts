// The band half of a frame: the log-spaced bands (`bands`, NUM_BANDS), their mean
// (`energy`) and the absolute input loudness (`level`), off the analyser's dB
// bands once per render tick (app.ts's currentVisual()). Hits, levels and
// tempo come from the audio engine (src/audio/engine/), which app.ts writes
// into the same frame (`engine`, `bpm`, `onset`, `pulseOnset`); this extractor
// leaves those empty. It also reads the room for the auto trackers:
// `bandSpanDb` feeds autoGain.ts and `level` the silence gate.

import { NUM_BANDS, type FeatureFrame } from "./types.ts";
import { ANALYSER_MIN_DB, ANALYSER_MAX_DB } from "./analyser.ts";

// Adaptive floor/ceiling per band: a leaky min/max that tracks the room's
// own quiet and loud levels. This is what makes a muffled laptop mic and a
// hot phone mic converge to similarly-scaled output. Values are exponential
// time constants (1/tau, per second) — bigger = faster to react.
//
// Blended in by update()'s `autoGain` amount (see src/audio/autoGain.ts for
// the persisted value) against a fixed mapping over the analyser's own dB
// window, matching app.ts's "before processing" feed — at 0 only the fixed
// mapping reaches the output.
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
  // The same envelope over the fixed mapping alone, kept regardless of the
  // blend so `fixedEnergy` can always say what `energy` would read with
  // auto-gain fully off — a local diagnostic, never part of the FeatureFrame
  // itself.
  private envFixed = new Float32Array(NUM_BANDS);
  private lastFixedEnergy = 0;

  /** `energy` as it would be with autoGain at 0 — see envFixed. */
  get fixedEnergy(): number {
    return this.lastFixedEnergy;
  }

  /** Mean per-band `peak - floor`, in dB — how much of the room/mic's actual
   *  range the trackers above have found, regardless of `autoGain`: they run
   *  unconditionally (see the `autoGain` param doc on update() below), so
   *  this reads the room, not the setting it's used to drive. A local
   *  diagnostic like fixedEnergy, never part of FeatureFrame — autoGain.ts's
   *  auto mode is the one consumer, easing the Auto-gain amount toward what
   *  this says the room needs. */
  get bandSpanDb(): number {
    let sum = 0;
    for (let b = 0; b < NUM_BANDS; b++) sum += this.peak[b] - this.floor[b];
    return sum / NUM_BANDS;
  }

  private lastTime: number | null = null;
  private lastDt = 1 / 60;

  /** The AudioContext-clock delta update() computed last call — what
   *  app.ts should feed autoGain.ts's feedAutoGainMeasurement() as dtSec,
   *  so that ease runs on the same clock bandSpanDb's trackers do rather
   *  than a rAF delta (unreliable at high refresh rates — see the
   *  render-cap-one-shots note). */
  get dtSec(): number {
    return this.lastDt;
  }

  /**
   * @param rawBandsDb per-band FFT magnitude in dB, from BandAnalyser.readBandsDb().
   * @param autoGain How much of the per-band adaptive floor/peak
   *   normalization below reaches the output, 0..1 (see autoGain.ts). Each
   *   band's target is a linear blend from the fixed mapping against the
   *   analyser's own dB window (ANALYSER_MIN_DB/MAX_DB — the same one
   *   app.ts's captureRawBands uses for the "before processing" display, so
   *   the two agree on scale) at 0, to the adaptive value at 1. The
   *   floor/peak trackers below keep running regardless — only what lands in
   *   `bands[]`/`energy` changes. Defaults to 1 (fully adaptive) so a call
   *   site that doesn't pass it keeps the original behavior.
   * @param smoothingScale Multiplies ATTACK_PER_SEC/RELEASE_PER_SEC below —
   *   sensitivity.ts's smoothingRateScale, defaulting to 1 (today's
   *   behavior). Non-finite (the Smoothing row's Off stop) assigns `target`
   *   to the envelope directly rather than computing a coefficient, so
   *   `bands`/`energy` land exactly on the adaptive-or-fixed mapping above —
   *   the same one app.ts's captureRawBands computes — with none of
   *   expBlend's floating-point rounding at "coefficient 1". Only this
   *   envelope is scaled; the floor/peak trackers above stay at their own
   *   fixed rates regardless — they're measurement, not display smoothing,
   *   and the meters panel's RAW chip already shows their output untouched.
   */
  update(rawBandsDb: Float32Array, time: number, autoGain = 1, smoothingScale = 1): FeatureFrame {
    const blend = clamp01(autoGain);
    const dt = this.lastTime === null ? 1 / 60 : Math.max(1e-4, time - this.lastTime);
    this.lastTime = time;
    this.lastDt = dt;

    const bands = new Float32Array(NUM_BANDS);
    let rawPowSum = 0;
    const fixedSpan = ANALYSER_MAX_DB - ANALYSER_MIN_DB;

    for (let b = 0; b < NUM_BANDS; b++) {
      const db = sanitizeDb(rawBandsDb[b]);
      rawPowSum += Math.pow(10, db / 10);

      // Leaky min/max adapts the [floor, peak] window to this room/mic. Kept
      // running even with autoGain off, since bandSpanDb reads the room.
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

      const fixed = clamp01((db - ANALYSER_MIN_DB) / fixedSpan);
      const target = fixed + (norm - fixed) * blend;
      if (Number.isFinite(smoothingScale)) {
        const rate = target > this.env[b] ? ATTACK_PER_SEC : RELEASE_PER_SEC;
        this.env[b] += (target - this.env[b]) * expBlend(rate, dt * smoothingScale);
      } else {
        this.env[b] = target;
      }
      bands[b] = this.env[b];

      // Same envelope (and the same Smoothing Off short-circuit) over the
      // fixed mapping alone, so the reference line tracks the real one.
      if (Number.isFinite(smoothingScale)) {
        const rateFixed = fixed > this.envFixed[b] ? ATTACK_PER_SEC : RELEASE_PER_SEC;
        this.envFixed[b] += (fixed - this.envFixed[b]) * expBlend(rateFixed, dt * smoothingScale);
      } else {
        this.envFixed[b] = fixed;
      }
    }

    // Averaged as power, then back to dB — not a mean of the dB values. Most
    // of the 24 bands sit at the noise floor for any ordinary sound, and a
    // mean of dB let those drag the result down to LEVEL_DB_FLOOR, so level
    // read ~0 for everything short of a loud broadband roar. Power averaging
    // lets the loud bands carry it, which is what loudness is.
    const meanRawDb = 10 * Math.log10(rawPowSum / NUM_BANDS);
    const level = clamp01((meanRawDb - LEVEL_DB_FLOOR) / (LEVEL_DB_CEIL - LEVEL_DB_FLOOR));

    let energy = 0;
    let fixedEnergy = 0;
    for (let b = 0; b < NUM_BANDS; b++) {
      energy += bands[b];
      fixedEnergy += this.envFixed[b];
    }
    energy = clamp01(energy / NUM_BANDS);
    this.lastFixedEnergy = clamp01(fixedEnergy / NUM_BANDS);

    // hats/lead need the analyser's full FFT bins, which this extractor never
    // sees (only the bands), so app.ts writes them in from stemSplit.ts before
    // the frame leaves currentVisual(). The engine's fields are app.ts's to
    // fill from src/audio/engineSource.ts, the same way.
    return { time, bands, energy, onset: false, pulseOnset: false, bpm: 0, onsetPhase: 0, level, hats: 0, lead: 0, engine: null };
  }
}
