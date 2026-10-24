// Tempo, beat phase and music presence from the onset envelope (onsets.ts).
// Every UPDATE_HOPS envelope samples: the recent envelope's recency-weighted
// autocorrelation scores each candidate tempo; the scores are integrated over
// time along a smoothly drifting path, so one noisy window can't move the
// tempo but a real change wins within a couple of seconds; a comb over the
// envelope finds where the beats fall. Music counts as present only while the
// pulse stays periodic, so talking, knocks and room noise produce no beats
// and no tempo. Each update's working arrays are made once and reused.

import { MAX_BPM, MIN_BPM } from "../types.ts";
import { Fft, nextPowerOfTwo } from "./fft.ts";

/** Candidate tempos are this ratio apart. */
const STATE_RATIO = 1.01;
const WINDOW_S = 8;
/** Envelope history needed before the first estimate. */
const MIN_WINDOW_S = 3;
/** Older onsets count less, so after a tempo change the new tempo dominates before the window turns over. */
const RECENCY_S = 3;
/**
 * The envelope's moving average over this span is subtracted before the autocorrelation. A step
 * in its baseline (music starting, a breakdown ending, a noise floor settling) otherwise
 * correlates at every lag and reads as a strong pulse at every tempo.
 */
const DETREND_S = 1.5;
const UPDATE_HOPS = 16;
/**
 * Weight of the autocorrelation at twice and at half a tempo's period. A real beat also repeats
 * every two beats and splits into two; a 3:2 or 5:4 relative of it (a dotted or syncopated
 * spacing that hats or a kick pattern make periodic too) rarely splits evenly, so this is what
 * keeps drum & bass off 116 and trap off 112.
 */
const DOUBLE = 0.5;
const HALF = 0.5;
/** The held tempo is refined within this share of its candidate's period. */
const REFINE_REACH = 0.015;
/** Tempo evidence is integrated with this time constant. */
const EVIDENCE_S = 2;
/** Candidates this many states either side feed a state's evidence, so a drifting tempo keeps its history. */
const DRIFT_STATES = 1;
/**
 * A gentle log-normal prior around this tempo. Without it a peak at three beats' lag can outvote
 * the beat itself in a window that straddles a change, locking onto a 3:2 relative.
 */
const PRIOR_BPM = 120;
const PRIOR_OCTAVES = 1;
/** A rival tempo must have this much more evidence than the held one to replace it. */
const SWITCH_MARGIN = 1.2;
/** Weight of each older beat in the phase search, so the phase follows recent playing. */
const PHASE_MEMORY = 0.85;
/** The phase search's step, in envelope samples. */
const PHASE_STEP = 0.5;
/**
 * When the half-beat positions carry nearly as many onsets as the beats (smoothed over
 * OFFBEAT_S), the beat is really twice as fast: drum & bass's snares fall between the beats of
 * the half tempo the autocorrelation prefers. Below OFFBEAT_OFF the tempo is reported as found.
 * A lower OFFBEAT_ON fixed more drum & bass but doubled hip-hop, pop and ambient through laptop
 * speakers, whose missing bass makes the off-beat hats look strong.
 */
const OFFBEAT_ON = 0.75;
const OFFBEAT_OFF = 0.55;
const OFFBEAT_S = 2;
/** Periodicity (normalised autocorrelation at the beat) smoothed over CONFIDENCE_S decides presence. */
const CONFIDENCE_S = 1;
// Rooms with talking and no music reach between MUSIC_OFF and MUSIC_ON; music
// under the same talking mostly stays above MUSIC_ON.
const MUSIC_ON = 0.35;
const MUSIC_OFF = 0.22;
const MUSIC_ON_HOLD_S = 1;
const MUSIC_OFF_HOLD_S = 2;
/**
 * A pulse this clear (periodicity smoothed over only FAST_S) for FAST_HOLD_S counts at once, so a
 * strong beat is followed from about 4 s in, half a second sooner on average. Rooms with no music
 * never got past 0.31 even with the slow smoothing, so the slow path keeps guarding weak pulses.
 * Shortening the slow path instead, or starting from a shorter window, let noise through.
 */
const FAST_ON = 0.6;
const FAST_S = 0.3;
const FAST_HOLD_S = 0.5;
/**
 * Music stops counting as present at once when the envelope's mean over the last STOP_RECENT_S
 * falls under STOP_RATIO of its mean over the whole window, and the window starts afresh. It
 * still holds the whole window's playing when the playing stops, so without this the beats ran
 * on into the silence. While drums play the ratio stays above 0.34 on every bench track; after a
 * stop it falls to about 0.2. Detected hits can't stand in: a dense mix goes seconds without
 * one strong enough.
 */
const STOP_RECENT_S = 1.5;
const STOP_RATIO = 0.25;

export interface TempoState {
  /** Beats per minute of the held tempo, 0 before the first estimate. */
  bpm: number;
  /** Periodicity of the recent onsets at that tempo, 0..1. */
  confidence: number;
  /** A steady pulse is playing; false for silence, talking, knocks and noise. */
  music: boolean;
  /** Time of the most recent beat on the fitted grid, on the audio clock. */
  beatTime: number;
  /** Time of the most recent bar start. */
  downbeatTime: number;
  /** How clearly one beat of the bar carries more bass than the others, 0..1. */
  downbeatConfidence: number;
  /** Counts estimates; changes whenever the state is refreshed. */
  updates: number;
}

export class TempoTracker {
  readonly state: TempoState = { bpm: 0, confidence: 0, music: false, beatTime: 0, downbeatTime: 0, downbeatConfidence: 0, updates: 0 };
  readonly beatsPerBar = 4;
  private readonly rate: number;
  private readonly flux: Float32Array;
  private readonly bass: Float32Array;
  private count = 0;
  private newestTime = 0;
  private sinceUpdate = 0;
  private readonly fft: Fft;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly bpms: Float64Array;
  private readonly prior: Float64Array;
  private evidence: Float64Array;
  private scratch: Float64Array;
  private readonly fluxWindow: Float32Array;
  private readonly bassWindow: Float32Array;
  private readonly prefix: Float64Array;
  private readonly acf: Float64Array;
  private readonly phaseScores: Float64Array;
  private readonly barSums: Float64Array;
  private readonly barCounts: Float64Array;
  private held = -1;
  private offbeat = 0;
  private doubled = false;
  private smoothConfidence = 0;
  private fastConfidence = 0;
  private fastTimer = 0;
  private musicTimer = 0;
  private stopped = false;

  /** `rate` is envelope samples per second. */
  constructor(rate: number) {
    this.rate = rate;
    const capacity = Math.ceil(WINDOW_S * rate);
    this.flux = new Float32Array(capacity);
    this.bass = new Float32Array(capacity);
    this.fft = new Fft(nextPowerOfTwo(2 * capacity));
    this.re = new Float64Array(this.fft.size);
    this.im = new Float64Array(this.fft.size);
    const states = Math.floor(Math.log(MAX_BPM / MIN_BPM) / Math.log(STATE_RATIO)) + 1;
    this.bpms = Float64Array.from({ length: states }, (_, i) => MIN_BPM * STATE_RATIO ** i);
    this.prior = this.bpms.map((b) => Math.exp(-0.5 * (Math.log2(b / PRIOR_BPM) / PRIOR_OCTAVES) ** 2));
    this.evidence = new Float64Array(states);
    this.scratch = new Float64Array(states);
    this.fluxWindow = new Float32Array(capacity);
    this.bassWindow = new Float32Array(capacity);
    this.prefix = new Float64Array(capacity + 1);
    this.acf = new Float64Array(capacity);
    // The longest period the phase search sees is the slowest tempo's, refined outwards.
    this.phaseScores = new Float64Array(Math.ceil(((60 * rate) / MIN_BPM) * (1 + REFINE_REACH) / PHASE_STEP) + 2);
    this.barSums = new Float64Array(this.beatsPerBar);
    this.barCounts = new Float64Array(this.beatsPerBar);
  }

  /** Feeds one envelope sample (onsets.ts's OnsetSink.envelope); returns true when the state was refreshed. */
  // @per-frame
  push(time: number, flux: number, low: number): boolean {
    const at = this.count % this.flux.length;
    this.flux[at] = flux;
    this.bass[at] = flux * low;
    this.count++;
    this.newestTime = time;
    if (++this.sinceUpdate < UPDATE_HOPS) return false;
    this.sinceUpdate = 0;
    this.update();
    return true;
  }

  private update(): void {
    const st = this.state;
    st.updates++;
    const dt = UPDATE_HOPS / this.rate;
    if (this.count < MIN_WINDOW_S * this.rate) return;
    const x = this.window(this.flux, this.fluxWindow);
    this.stopped = this.recentShare(x) < STOP_RATIO;
    const r = this.autocorrelation(x);
    let periodicity = 0;
    if (r) {
      this.integrate(r, dt);
      const best = this.choose();
      const lag = this.refine(r, (60 * this.rate) / this.bpms[best]);
      // Kicks on beats 1 and 3 alone repeat every two beats, not every beat.
      periodicity = Math.max(0, sampleAt(r, lag), 2 * lag < r.length - 1 ? sampleAt(r, 2 * lag) : 0);
      const ratio = this.findPhase(x, lag);
      this.offbeat += (ratio - this.offbeat) * (1 - Math.exp(-dt / OFFBEAT_S));
      const found = (60 * this.rate) / lag;
      if (2 * found > MAX_BPM) this.doubled = false;
      else if (this.offbeat > OFFBEAT_ON) this.doubled = true;
      else if (this.offbeat < OFFBEAT_OFF) this.doubled = false;
      // The fitted beat is a beat of the doubled grid too, so only the tempo changes.
      st.bpm = this.doubled ? 2 * found : found;
    }
    this.smoothConfidence += (periodicity - this.smoothConfidence) * (1 - Math.exp(-dt / CONFIDENCE_S));
    this.fastConfidence += (periodicity - this.fastConfidence) * (1 - Math.exp(-dt / FAST_S));
    st.confidence = this.smoothConfidence;
    this.updatePresence(dt);
  }

  private updatePresence(dt: number): void {
    const st = this.state;
    const c = this.smoothConfidence;
    if (st.music && this.stopped) {
      st.music = false;
      this.musicTimer = 0;
      // Tempo evidence is kept, so music that resumes is found at the same tempo quickly.
      this.count = 0;
      this.smoothConfidence = this.fastConfidence = 0;
      return;
    }
    this.fastTimer = !st.music && !this.stopped && this.fastConfidence > FAST_ON ? this.fastTimer + dt : 0;
    if (this.fastTimer >= FAST_HOLD_S) {
      st.music = true;
      this.fastTimer = this.musicTimer = 0;
      return;
    }
    const flipping = st.music ? c < MUSIC_OFF : c > MUSIC_ON && !this.stopped;
    this.musicTimer = flipping ? this.musicTimer + dt : 0;
    if (this.musicTimer >= (st.music ? MUSIC_OFF_HOLD_S : MUSIC_ON_HOLD_S)) {
      st.music = !st.music;
      this.musicTimer = 0;
    }
  }

  /** The envelope's mean over the last STOP_RECENT_S against its mean over the whole window. */
  private recentShare(x: Float32Array): number {
    const recent = Math.min(x.length, Math.round(STOP_RECENT_S * this.rate));
    let all = 0;
    let last = 0;
    for (let i = 0; i < x.length; i++) {
      all += x[i];
      if (i >= x.length - recent) last += x[i];
    }
    return all > 0 ? last / recent / (all / x.length) : 0;
  }

  /** The window oldest-first, lightly smoothed so a beat a sample early or late still lines up. */
  private window(source: Float32Array, into: Float32Array): Float32Array {
    const cap = source.length;
    const n = Math.min(this.count, cap);
    const first = this.count - n;
    for (let i = 0; i < n; i++) {
      const before = source[(first + Math.min(n - 1, Math.max(0, i - 1))) % cap];
      const here = source[(first + Math.min(n - 1, Math.max(0, i))) % cap];
      const after = source[(first + Math.min(n - 1, Math.max(0, i + 1))) % cap];
      into[i] = 0.25 * before + 0.5 * here + 0.25 * after;
    }
    return n === into.length ? into : into.subarray(0, n);
  }

  /**
   * Autocorrelation of the detrended, recency-weighted window, normalised so lag 0 is 1; null
   * when the window is silent. Each lag is divided by the weights' own overlap at that lag, so
   * favouring recent playing doesn't make long lags look weaker.
   */
  private autocorrelation(x: Float32Array): Float64Array | null {
    const { re, im, fft, prefix } = this;
    const n = x.length;
    const half = Math.max(1, Math.round((DETREND_S * this.rate) / 2));
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i];
    const q = Math.exp(-1 / (RECENCY_S * this.rate));
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - half);
      const b = Math.min(n, i + half + 1);
      re[i] = (x[i] - (prefix[b] - prefix[a]) / (b - a)) * q ** (n - 1 - i);
    }
    fft.transform(re, im);
    for (let i = 0; i < fft.size; i++) {
      re[i] = re[i] * re[i] + im[i] * im[i];
      im[i] = 0;
    }
    fft.transform(re, im, true);
    if (re[0] < 1e-12) return null;
    const out = n === this.acf.length ? this.acf : this.acf.subarray(0, n);
    const zero = re[0] / overlap(q, n, 0);
    for (let lag = 0; lag < n; lag++) out[lag] = re[lag] / overlap(q, n, lag) / zero;
    return out;
  }

  /** How strongly the onsets repeat at `lag`, its double and its half (see DOUBLE and HALF). */
  private salience(r: Float64Array, lag: number): number {
    let s = Math.max(0, sampleAt(r, lag)) + HALF * Math.max(0, sampleAt(r, lag / 2));
    if (2 * lag < r.length - 1) s += DOUBLE * Math.max(0, sampleAt(r, 2 * lag));
    return s;
  }

  /** The lag near `lag` where the salience peaks, to a tenth of an envelope sample. */
  private refine(r: Float64Array, lag: number): number {
    let best = lag;
    let top = -1;
    for (let l = lag * (1 - REFINE_REACH); l <= lag * (1 + REFINE_REACH); l += 0.1) {
      const s = this.salience(r, l);
      if (s > top) {
        top = s;
        best = l;
      }
    }
    return best;
  }

  private integrate(r: Float64Array, dt: number): void {
    const keep = Math.exp(-dt / EVIDENCE_S);
    const e = this.evidence;
    const next = this.scratch;
    const n = e.length;
    for (let i = 0; i < n; i++) {
      const s = this.salience(r, (60 * this.rate) / this.bpms[i]);
      let carried = 0;
      for (let j = Math.max(0, i - DRIFT_STATES); j <= Math.min(n - 1, i + DRIFT_STATES); j++) carried = Math.max(carried, e[j]);
      next[i] = keep * carried + (1 - keep) * s * this.prior[i];
    }
    this.scratch = e;
    this.evidence = next;
  }

  /** The state with the most evidence, unless the held one is within SWITCH_MARGIN of it. */
  private choose(): number {
    const e = this.evidence;
    let best = 0;
    for (let i = 1; i < e.length; i++) if (e[i] > e[best]) best = i;
    if (this.held >= 0) {
      // The held tempo may have drifted by a state or two; follow it to its local maximum.
      let h = this.held;
      for (let j = Math.max(0, h - DRIFT_STATES); j <= Math.min(e.length - 1, h + DRIFT_STATES); j++) if (e[j] > e[h]) h = j;
      if (e[best] < e[h] * SWITCH_MARGIN) best = h;
    }
    this.held = best;
    return best;
  }

  /**
   * Finds the beat grid that best covers the onsets, and the bar position with the most bass.
   * Returns how strong the half-beat positions are against the beats.
   */
  private findPhase(x: Float32Array, period: number): number {
    const st = this.state;
    const newest = x.length - 1;
    const scores = this.phaseScores;
    let steps = 0;
    let bestScore = -1;
    let bestPhase = 0;
    for (let phase = 0; phase < period; phase += PHASE_STEP) {
      let score = 0;
      let w = 1;
      for (let pos = newest - phase; pos >= 0; pos -= period) {
        score += w * sampleAt(x, pos);
        w *= PHASE_MEMORY;
      }
      scores[steps++] = score;
      if (score > bestScore) {
        bestScore = score;
        bestPhase = phase;
      }
    }
    // Refine between phase steps; the comb wraps, so neighbours wrap too.
    const k = Math.round(bestPhase / PHASE_STEP);
    const a = scores[(k - 1 + steps) % steps];
    const c = scores[(k + 1) % steps];
    const denom = a - 2 * bestScore + c;
    const offScore = scores[(k + Math.round(period)) % steps];
    if (denom < 0) bestPhase += (0.5 * PHASE_STEP * (a - c)) / denom;
    const lastBeat = newest - bestPhase;
    st.beatTime = this.newestTime - (newest - lastBeat) / this.rate;

    const bass = this.window(this.bass, this.bassWindow);
    const perBar = this.beatsPerBar;
    const sums = this.barSums;
    const counts = this.barCounts;
    sums.fill(0);
    counts.fill(0);
    for (let j = 0, pos = lastBeat; pos >= 0; j++, pos -= period) {
      sums[j % perBar] += sampleAt(bass, pos);
      counts[j % perBar]++;
    }
    for (let m = 0; m < perBar; m++) sums[m] /= Math.max(1, counts[m]);
    let best = 0;
    for (let m = 1; m < perBar; m++) if (sums[m] > sums[best]) best = m;
    let runnerUp = 0;
    for (let m = 0; m < perBar; m++) if (m !== best) runnerUp = Math.max(runnerUp, sums[m]);
    // Against the runner-up, not the mean: kicks on beats 1 and 3 alike say nothing about which is first.
    st.downbeatConfidence = sums[best] > 0 ? (sums[best] - runnerUp) / sums[best] : 0;
    st.downbeatTime = this.newestTime - (newest - (lastBeat - best * period)) / this.rate;
    return bestScore > 0 ? offScore / bestScore : 0;
  }
}

/** How much the recency weights overlap at `lag` over an `n`-sample window (autocorrelation's divisor). */
function overlap(q: number, n: number, lag: number): number {
  return (q ** lag - q ** (2 * n - lag)) / (1 - q * q);
}

/** Linear interpolation at a fractional index. */
function sampleAt(x: ArrayLike<number>, pos: number): number {
  const i = Math.floor(pos);
  if (i < 0) return x[0];
  if (i >= x.length - 1) return x[x.length - 1];
  const f = pos - i;
  return x[i] * (1 - f) + x[i + 1] * f;
}
