import { NUM_BANDS, type FeatureFrame } from "./types.ts";
import { ANALYSER_MIN_DB, ANALYSER_MAX_DB } from "./analyser.ts";
// Only the type plus the pure dimmer function — never the store's
// get/set/reset — so this extractor stays store-free like the rest of it
// (see the `autoGain`/`smoothingScale` params below, both plain numbers a
// caller resolves from a store itself).
import { silenceGateDimmer, type SilenceGateMarks } from "./silenceGate.ts";
// Only the shared diagnostic shape — this extractor owns computing its own
// OnsetDiag, not any gate logic (that's silenceGate.ts's job now).
import type { OnsetDiag } from "./onsetDiag.ts";

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

// Onset detection over the summed positive spectral flux. Left as a plain
// Math.min(1, rate*dt) coefficient, unlike the envelope above: at rate 3 it's
// 0.05 at 60fps versus expBlend's 0.0488 — it never saturates at any
// realistic frame rate, so there's no frame-rate bug here to fix.
const FLUX_ADAPTIVE_RATE = 3; // how fast the local flux baseline adapts
// Exported so the meters panel's hit-history hint (audioMeters.ts's
// hitsRuleHint) can spell out the exact rule from these numbers instead of
// a hand-typed copy that can drift from them.
export const FLUX_THRESHOLD_MULT = 1.6;
export const FLUX_THRESHOLD_MARGIN = 0.03;
export const ONSET_REFRACTORY_SEC = 0.1; // ~600 BPM ceiling, prevents double-triggers

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
// Onsets are kept by age, not count: with no silence gate (or the gate off —
// see src/audio/silenceGate.ts, which is what actually stops a mic's noise
// floor from firing spurious onsets between real hits in a near-silent room)
// the adaptive window can still collapse and every wobble clears the
// threshold, and a fixed count of the most recent onsets would then hold
// only a couple of real beats. Each onset still carries a weight — how far
// its flux cleared the threshold, capped — so pairs of weak noise onsets
// barely vote against pairs of real hits even then.
const ONSET_WINDOW_SEC = 6;
const MAX_ONSETS = 48; // hard cap for the O(n²) pair walk
const ONSET_WEIGHT_CAP = 4;
const MAX_PAIR_GAP_SEC = 4;
// Exported so src/render/signals.ts's "Tempo" drive source can map
// tempoBpm into 0..1 against the same window this tracker actually
// searches, rather than a second, hand-typed copy of these numbers.
export const BPM_MIN = 70;
export const BPM_MAX = 180;
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

// A confident tempo used to stick forever: `bpm` was only ever assigned
// inside registerOnset, so once locked it never fell back to 0, however long
// the onsets stopped coming — render/beatClock.ts's tempoLock (its own
// confidence in this reading) had nothing to ease back down toward. Past
// TEMPO_DECAY_SEC of silence since the last real onset, update() below
// clears both `bpm` and the onset history that would otherwise have kept
// combScore remembering the old tempo the moment a new onset arrived.
const TEMPO_DECAY_SEC = 3;

// A bias toward tempos people actually tap along to, folded into
// combScore's own score. Without it, a candidate exactly 3/4 or 4/3 of the
// true tempo can out-score it outright: a busy 16th-note hat pattern makes
// every third 16th (a 4:3 ratio of the beat) land on a whole number of
// *its own* period just as exactly as the real beat does, and once that
// candidate wins, TEMPO_SWITCH_MARGIN's hysteresis then keeps it for the
// rest of the track. tempoPrior() is a log-normal bump centered on
// TEMPO_PRIOR_BPM (TEMPO_PRIOR_OCTAVES wide) that favors the tempo octave
// most music actually sits in, just enough to break that kind of tie
// without overriding a real tempo confidently outside it.
const TEMPO_PRIOR_BPM = 120;
const TEMPO_PRIOR_OCTAVES = 1;

function tempoPrior(bpm: number): number {
  const octaves = Math.log2(bpm / TEMPO_PRIOR_BPM) / TEMPO_PRIOR_OCTAVES;
  return Math.exp(-0.5 * octaves * octaves);
}

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
  // auto-gain fully off — a local diagnostic (the Signal card's history
  // trace in src/ui/audioMeters.ts), never part of the FeatureFrame itself.
  private envFixed = new Float32Array(NUM_BANDS);
  private lastFixedEnergy = 0;
  private prevNorm = new Float32Array(NUM_BANDS);

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

  /** How hard the broadband onset detector's flux cleared its adaptive
   *  threshold this frame: 1 is a bare trigger, above 1 fired, below 1 is a
   *  near-miss. See registerOnset's own doc for the same ratio (there
   *  clamped for the tempo comb) — this is the unclamped instant reading. */
  get fluxRatio(): number {
    return this.lastFluxRatio;
  }

  /** This frame's full onset diagnostic — see onsetDiag.ts's OnsetDiag.
   *  Mutated in place every update() (like bandEnergy.ts's own group
   *  diags), so this is an alias, not a snapshot: read it before the next
   *  update() call. A local diagnostic like fixedEnergy/bandSpanDb above,
   *  never part of FeatureFrame — the Rhythm card's hits history in
   *  audioMeters.ts is the one consumer. */
  get onsetDiag(): Readonly<OnsetDiag> {
    return this.diag;
  }

  /** How much of this frame's flux the silence gate let through before the
   *  firing comparison — see silenceGate.ts's silenceGateDimmer. 1 with no
   *  `gate` argument (or whenever the gate is off), down toward 0 the
   *  quieter the room reads. A local diagnostic like fluxRatio above, never
   *  part of FeatureFrame — the Gate card's Dimmer row and History trace
   *  (audioMeters.ts) are the one reader. */
  get gateDimmer(): number {
    return this.lastGateDimmer;
  }

  /** True on the tick a hit's flux cleared its threshold but the gate's
   *  dimmer stopped `onset` from firing — see update()'s own comment on why
   *  this needs a one-shot spacing separate from the refractory a suppressed
   *  hit deliberately doesn't start. A local diagnostic like fluxRatio
   *  above, never part of FeatureFrame — the Gate card's History trace
   *  (audioMeters.ts) marks where a hit was stopped. */
  get suppressed(): boolean {
    return this.lastSuppressed;
  }

  private fluxBaseline = 0;
  private lastTime: number | null = null;
  private lastDt = 1 / 60;
  private lastOnsetTime = -Infinity;
  private onsets: { time: number; weight: number }[] = [];
  private bpm = 0;
  private lastOnsetPhaseTime = 0;
  // flux/threshold from the most recent update(), stored unconditionally —
  // including on frames that don't fire, so a near-miss is visible too. A
  // local diagnostic like fixedEnergy/bandSpanDb above, never part of
  // FeatureFrame: the onset flag it explains is a boolean by design, but a
  // tuning session wants to see how hard a hit cleared the bar (or how
  // close it came) — the Rhythm card's hits history in audioMeters.ts.
  private lastFluxRatio = 0;
  private lastGateDimmer = 1;
  private lastSuppressed = false;
  // Separate from lastOnsetTime — a suppressed hit must never set that one
  // (see update()) — so `suppressed` gets its own one-shot spacing instead
  // of staying true for as long as flux keeps clearing the threshold.
  private lastSuppressedTime = -Infinity;
  // The rest of the onset diagnostic beyond fluxRatio/gateDimmer/suppressed
  // above — see onsetDiag's own doc. Mutated in place every update(), not
  // replaced (like bandEnergy.ts's own group diags) — no per-frame
  // allocation.
  private diag: OnsetDiag = { ratio: 0, gated: false, blocked: false, sinceOnsetSec: Infinity };

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
   *   floor/peak trackers, flux, and onset/BPM detection below keep running
   *   on the adaptive `norm` regardless — only what lands in
   *   `bands[]`/`energy` changes — so turning this down doesn't degrade beat
   *   detection, which is calibrated against the adaptive value. Defaults to
   *   1 (fully adaptive) so a call site that doesn't pass it keeps the
   *   original behavior.
   * @param smoothingScale Multiplies ATTACK_PER_SEC/RELEASE_PER_SEC below —
   *   sensitivity.ts's smoothingRateScale, defaulting to 1 (today's
   *   behavior). Non-finite (the Smoothing row's Off stop) assigns `target`
   *   to the envelope directly rather than computing a coefficient, so
   *   `bands`/`energy` land exactly on the adaptive-or-fixed mapping above —
   *   the same one app.ts's captureRawBands computes — with none of
   *   expBlend's floating-point rounding at "coefficient 1". Only this
   *   envelope is scaled; the floor/peak trackers above and the flux
   *   baseline below stay at their own fixed rates regardless — they're
   *   measurement, not display smoothing, and the meters panel's RAW chip
   *   already shows their output untouched.
   * @param gate Silence-gate marks (src/audio/silenceGate.ts) to weight the
   *   broadband onset's firing comparison by this tick's `level` — see
   *   silenceGateDimmer for exactly what it multiplies (only the comparison,
   *   never the baseline/ratio/refractory) and why. `undefined` (every
   *   existing call site and test that doesn't pass one) means no gating at
   *   all, today's behavior.
   */
  update(rawBandsDb: Float32Array, time: number, autoGain = 1, smoothingScale = 1, gate?: SilenceGateMarks): FeatureFrame {
    const blend = clamp01(autoGain);
    const dt = this.lastTime === null ? 1 / 60 : Math.max(1e-4, time - this.lastTime);
    this.lastTime = time;
    this.lastDt = dt;

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

      flux += Math.max(0, norm - this.prevNorm[b]);
      this.prevNorm[b] = norm;
    }

    // Averaged as power, then back to dB — not a mean of the dB values. Most
    // of the 24 bands sit at the noise floor for any ordinary sound, and a
    // mean of dB let those drag the result down to LEVEL_DB_FLOOR, so level
    // read ~0 for everything short of a loud broadband roar. Power averaging
    // lets the loud bands carry it, which is what loudness is. Computed here,
    // ahead of the onset decision below, specifically so that decision can
    // read this tick's own level rather than last tick's.
    const meanRawDb = 10 * Math.log10(rawPowSum / NUM_BANDS);
    const level = clamp01((meanRawDb - LEVEL_DB_FLOOR) / (LEVEL_DB_CEIL - LEVEL_DB_FLOOR));

    this.fluxBaseline += (flux - this.fluxBaseline) * Math.min(1, FLUX_ADAPTIVE_RATE * dt);
    const threshold = this.fluxBaseline * FLUX_THRESHOLD_MULT + FLUX_THRESHOLD_MARGIN;
    // Unconditional, not just on a fire — see fluxRatio's own doc. threshold
    // is always > 0 (FLUX_THRESHOLD_MARGIN keeps it off zero at a silent
    // baseline), so this never divides by zero.
    this.lastFluxRatio = flux / threshold;
    this.diag.ratio = this.lastFluxRatio;
    // The gate only ever weights the comparison below — fluxBaseline just
    // above and lastFluxRatio's score are both computed on raw, ungated flux,
    // and stay that way (see silenceGate.ts's header for why gating the
    // baseline too would defeat the gate entirely).
    const dimmer = gate ? silenceGateDimmer(level, gate) : 1;
    this.lastGateDimmer = dimmer;
    const sinceOnsetSec = time - this.lastOnsetTime;
    const canFire = sinceOnsetSec > ONSET_REFRACTORY_SEC;
    const wouldFire = canFire && flux > threshold;
    // Cleared even after the dimmer — used for the real firing decision
    // below and, unconditionally, for onsetDiag.blocked (see its own doc):
    // a hit that cleared the gated comparison but still landed inside the
    // refractory reads as "blocked" rather than a plain miss.
    const dimmedClears = flux * dimmer > threshold;
    const onset = wouldFire && dimmedClears;
    this.diag.blocked = dimmedClears && !canFire;
    this.diag.sinceOnsetSec = sinceOnsetSec;

    // A hit the silence gate or the refractory stopped doesn't reach
    // registerOnset either — it doesn't get to vote on the tempo.
    if (onset) {
      this.lastOnsetTime = time;
      this.registerOnset(time, flux / threshold);
    }

    // A hit the gate stopped: wouldFire was true (flux alone cleared the
    // threshold) but the dimmed comparison didn't. Since a suppressed hit
    // deliberately doesn't touch lastOnsetTime/the refractory above, flux can
    // stay over threshold for several frames in a row — this gets its own
    // one-shot spacing (against whichever of lastOnsetTime/lastSuppressedTime
    // is more recent) so the flag reads as one event per stopped hit rather
    // than chattering true for as long as the room stays that loud.
    this.lastSuppressed = false;
    if (wouldFire && !onset && time - Math.max(this.lastOnsetTime, this.lastSuppressedTime) > ONSET_REFRACTORY_SEC) {
      this.lastSuppressed = true;
      this.lastSuppressedTime = time;
    }
    this.diag.gated = this.lastSuppressed;

    // Let a held tempo go once the onsets that were sustaining it actually
    // stop — see TEMPO_DECAY_SEC's own doc above. Clearing `onsets` too
    // means the next real onset starts a fresh comb rather than immediately
    // re-finding the stale tempo off leftover history.
    if (this.bpm > 0 && time - this.lastOnsetTime > TEMPO_DECAY_SEC) {
      this.bpm = 0;
      this.onsets = [];
    }

    let energy = 0;
    let fixedEnergy = 0;
    for (let b = 0; b < NUM_BANDS; b++) {
      energy += bands[b];
      fixedEnergy += this.envFixed[b];
    }
    energy = clamp01(energy / NUM_BANDS);
    this.lastFixedEnergy = clamp01(fixedEnergy / NUM_BANDS);

    const onsetPhase = this.bpm > 0 ? (((time - this.lastOnsetPhaseTime) / (60 / this.bpm)) % 1 + 1) % 1 : 0;

    return { time, bands, energy, onset, bpm: this.bpm, onsetPhase, level };
  }

  /** @param strength flux over the firing threshold — 1 is a bare trigger. */
  private registerOnset(time: number, strength: number): void {
    this.lastOnsetPhaseTime = time;
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
      // See tempoPrior's own doc above — hysteresis below calls this same
      // function for the current tempo too, so the prior weights that
      // comparison exactly the same way, on purpose.
      return score * tempoPrior(60 / period);
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
