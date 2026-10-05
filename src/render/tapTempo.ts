import { BPM_MAX, BPM_MIN } from "../audio/tempoComb.ts";
import { resetBeatTrim } from "./beatTrim.ts";
import { RESYNC_RATIO } from "./metronome.ts";

/**
 * Tap tempo: tap Ctrl (src/app.ts) or the Tempo card's Tap button
 * (src/ui/audioMeters.ts) on every beat, and the tracker takes the tapped
 * tempo and beat — as a correction it then keeps refining, not a clock that
 * replaces it. The sibling of beatTrim.ts's beat keys (B, [ ], , .): the
 * same kind of session-only store, the same "counter, not edge flag" so
 * every clock that reads it notices on its own next tick, and the same
 * reach — only this window's own clocks. The pop-out output window and a
 * paired TV run their own anim clock off the feature frames and never see
 * a beat key or a tap.
 *
 * THE ESTIMATE (fitTaps). A run of taps ends after a gap longer than
 * TAP_GAP_SEC; only the latest TAP_MAX_TAPS count. The run is fitted by
 * least squares of tap time against beat number: the slope is the beat
 * length and the line itself says where the beats fall, so every tap in the
 * run pulls on both and timing jitter averages out over the whole run
 * rather than gap by gap (a median of the gaps alone gives no phase, and a
 * mean of the gaps only ever hears the first and last tap). What makes the
 * fit robust is the numbering. Each tap is numbered by walking from a
 * starting tap at the median gap, measured from the last tap kept (so a
 * small error in the median never adds up along the run); a tap more than
 * TAP_TOLERANCE of a beat off that grid is a stray and is left out — the
 * Ctrl of a Ctrl+<key> chord, a double press — and a skipped beat just takes
 * the next number. Every tap is tried as the start and the numbering that
 * keeps the most taps wins, so a stray first tap can't throw off the rest;
 * then every tap is numbered again against that first line (the closest
 * tap wins a number) and the line fitted once more. Taps are beats, not bar
 * starts: B still says where the 1 is. A tempo outside the tracker's own
 * range (BPM_MIN..BPM_MAX) is halved or doubled into it rather than clamped:
 * the tracker can't hold a tempo outside it, and halving or doubling keeps
 * every tapped beat on a beat line, where a clamp would tick off the taps.
 *
 * THE STORE. Once TAP_MIN_TAPS taps fit, and again on every tap after that,
 * the fitted tempo and the time of the latest tapped beat take effect:
 * `seq` goes up, and beatTrim.ts's ×2/÷2 and nudge go back to none
 * (resetBeatTrim — the tap is exactly what was tapped; B's bar anchor
 * stays). releaseTapTempo() (Shift+B, with the beat trim) hands the tempo
 * back to the tracker.
 *
 * WHERE IT MEETS THE TRACKER (createTapGuide, run by animClock.ts). The
 * tracker is three layers: the raw estimate (tempoComb.ts, in the audio
 * worklet or features.ts), which picks the octave; beatClock.ts, a smoothed
 * tempo and a phase comb over the hits; and metronome.ts over
 * tempoSettle.ts, the Tempo card's number and the steady tick. The
 * narrowest place to steer all three is where the raw reading enters the
 * render side, in animClock.ts, as a seed and a hint:
 *  - the seed: beatClock.seed() and metronome.seed() take the tapped tempo
 *    and beat on the next tick (the Tempo card shows the metronome's
 *    tempo, so it reads the tap at once), and tempoSettle.hold() holds it
 *    as a tempo the tracker is sure of;
 *  - the hint, fold(): while guided, a raw reading that sits at one of the
 *    ratios in TAP_FAMILY of the guided tempo — within metronome.ts's
 *    RESYNC_RATIO, its own line for "the same tempo" — is divided back onto
 *    it. The tracker's octave or ratio choice lands on the tap's, while
 *    everything finer still comes from the music: the clock eases to the
 *    reading's exact tempo, the comb corrects the phase, the metronome
 *    follows both, and the guided tempo follows the metronome as it drifts.
 * Not inside the estimator itself: it runs on the audio thread, and its
 * reading rides the wire to every paired device, which the beat keys never
 * touch. Guidance ends (follow()) when the metronome stops — the tracker
 * hears no tempo at all — or retunes to a tempo outside the family, so the
 * existing retune rule (tempoSettle.ts's RETUNE_SURE_SEC/RETUNE_UNSURE_SEC)
 * decides when the music has really moved on; there is no timer of its own.
 *
 * One limit: tapped at half the tempo of music whose kicks fall on every
 * beat of the faster tempo, the comb sees as many kicks between the tapped
 * beats as on them, and may pull the beat half a beat off the taps. ÷2 ([)
 * on the faster tempo is the tool for that.
 */

/** Taps that have to fit before a tap tempo takes effect. */
export const TAP_MIN_TAPS = 4;
/** Only the latest taps of a run are fitted, so a long run keeps up with a
 *  tempo the tapper changes. */
export const TAP_MAX_TAPS = 16;
/** A gap longer than this starts a new run. Long enough to skip a beat at
 *  BPM_MIN. */
export const TAP_GAP_SEC = 2;
/** How far off the beat grid (as a share of a beat) a tap may land and
 *  still count; further than this it is a stray. */
export const TAP_TOLERANCE = 0.25;
/** The ratios a tracker's reading may sit at against the tapped tempo and
 *  still be the tapped tempo, heard in another octave or ratio. */
const TAP_FAMILY: readonly number[] = [1, 2, 0.5, 1.5, 2 / 3];

interface Numbered {
  /** The tap's beat number in the run. */
  n: number;
  t: number;
}

interface Line {
  /** Time of beat 0. */
  a: number;
  /** Beat length. */
  b: number;
}

/** Least squares of time against beat number; null without two distinct
 *  numbers or a forward-running line. */
function fitLine(pts: readonly Numbered[]): Line | null {
  const m = pts.length;
  if (m < 2) return null;
  let sumN = 0;
  let sumT = 0;
  for (const p of pts) {
    sumN += p.n;
    sumT += p.t;
  }
  const meanN = sumN / m;
  const meanT = sumT / m;
  let snn = 0;
  let snt = 0;
  for (const p of pts) {
    snn += (p.n - meanN) * (p.n - meanN);
    snt += (p.n - meanN) * (p.t - meanT);
  }
  if (snn === 0) return null;
  const b = snt / snn;
  if (!(b > 0)) return null;
  return { a: meanT - b * meanN, b };
}

/** Numbers the taps outward from taps[start], one gap at a time, against a
 *  beat of `beat` — see the file header. */
function numberFrom(taps: readonly number[], start: number, beat: number): Numbered[] {
  const later: Numbered[] = [{ n: 0, t: taps[start]! }];
  let n = 0;
  let t = taps[start]!;
  for (let j = start + 1; j < taps.length; j++) {
    const x = (taps[j]! - t) / beat;
    const k = Math.round(x);
    if (k < 1 || Math.abs(x - k) > TAP_TOLERANCE) continue;
    n += k;
    t = taps[j]!;
    later.push({ n, t });
  }
  const earlier: Numbered[] = [];
  n = 0;
  t = taps[start]!;
  for (let j = start - 1; j >= 0; j--) {
    const x = (t - taps[j]!) / beat;
    const k = Math.round(x);
    if (k < 1 || Math.abs(x - k) > TAP_TOLERANCE) continue;
    n -= k;
    t = taps[j]!;
    earlier.push({ n, t });
  }
  earlier.reverse();
  return earlier.concat(later);
}

/** Numbers every tap against `line`, keeping the closest tap per number and
 *  dropping any further than TAP_TOLERANCE from it. */
function numberAgainst(taps: readonly number[], line: Line): Numbered[] {
  const best = new Map<number, { t: number; off: number }>();
  for (const t of taps) {
    const x = (t - line.a) / line.b;
    const n = Math.round(x);
    const off = Math.abs(x - n);
    if (off > TAP_TOLERANCE) continue;
    const prev = best.get(n);
    if (!prev || off < prev.off) best.set(n, { t, off });
  }
  const out: Numbered[] = [];
  best.forEach((v, n) => out.push({ n, t: v.t }));
  out.sort((p, q) => p.n - q.n);
  return out;
}

export interface TapFit {
  /** How many taps the fit kept (strays left out). */
  kept: number;
  /** Fitted beat length, 0 without a fit. Same unit as the taps. */
  beat: number;
  /** Fitted time of the latest kept tap: a beat. */
  anchor: number;
}

/** Fits a run of tap times (ascending, any unit) — see the file header. */
export function fitTaps(taps: readonly number[]): TapFit {
  if (taps.length < 2) return { kept: taps.length, beat: 0, anchor: 0 };
  const gaps: number[] = [];
  for (let i = 1; i < taps.length; i++) gaps.push(taps[i]! - taps[i - 1]!);
  gaps.sort((p, q) => p - q);
  const median = gaps[gaps.length >> 1]!;
  if (!(median > 0)) return { kept: 1, beat: 0, anchor: 0 };

  let best: { pts: Numbered[]; line: Line; err: number } | null = null;
  for (let start = 0; start < taps.length; start++) {
    const first = fitLine(numberFrom(taps, start, median));
    if (!first) continue;
    const pts = numberAgainst(taps, first);
    const line = fitLine(pts);
    if (!line) continue;
    let err = 0;
    for (const p of pts) {
      const r = p.t - (line.a + line.b * p.n);
      err += r * r;
    }
    if (!best || pts.length > best.pts.length || (pts.length === best.pts.length && err < best.err)) {
      best = { pts, line, err };
    }
  }
  if (!best) return { kept: 1, beat: 0, anchor: 0 };
  const lastN = best.pts[best.pts.length - 1]!.n;
  return { kept: best.pts.length, beat: best.line.b, anchor: best.line.a + best.line.b * lastN };
}

export interface TapEstimate {
  bpm: number;
  /** A tapped beat's time, ms. */
  anchorMs: number;
}

function estimateFromFit(fit: TapFit): TapEstimate | null {
  if (fit.kept < TAP_MIN_TAPS || !(fit.beat > 0)) return null;
  let bpm = 60000 / fit.beat;
  while (bpm > BPM_MAX) bpm /= 2;
  while (bpm < BPM_MIN) bpm *= 2;
  return { bpm, anchorMs: fit.anchor };
}

/** The tempo and beat a run of tap times (ms, ascending) says, or null
 *  until TAP_MIN_TAPS of them fit — see the file header. */
export function estimateTapTempo(tapsMs: readonly number[]): TapEstimate | null {
  return estimateFromFit(fitTaps(tapsMs));
}

// ---- The store (see the file header) ----

let run: number[] = [];
let runMore = TAP_MIN_TAPS;
let seq = 0;
let tappedBpm = 0;
let anchorMs = 0;
let releaseSeq = 0;

export interface TapTempoState {
  /** Goes up every time a tap tempo takes effect. */
  seq: number;
  /** The tapped tempo, 0 before the first. */
  bpm: number;
  /** A tapped beat's time, on performance.now()'s clock. */
  anchorMs: number;
  /** Goes up on every releaseTapTempo(). */
  releaseSeq: number;
}

/** This tick's store — a fresh snapshot, like beatTrim.ts's getBeatTrim(). */
export function getTapTempo(): TapTempoState {
  return { seq, bpm: tappedBpm, anchorMs, releaseSeq };
}

export interface TapResult {
  /** Taps in this run so far. */
  taps: number;
  /** How many more fitting taps it needs; 0 once it took effect. */
  more: number;
  /** The tempo that took effect with this tap, 0 if none did. */
  bpm: number;
}

/** One tap at `timeMs` (a keydown's or pointerdown's timeStamp — the press,
 *  not the release, is the beat). */
export function tapTempoAt(timeMs: number): TapResult {
  const last = run.length > 0 ? run[run.length - 1]! : -Infinity;
  if (timeMs < last || timeMs - last > TAP_GAP_SEC * 1000) run = [];
  run.push(timeMs);
  if (run.length > TAP_MAX_TAPS) run.shift();
  const fit = fitTaps(run);
  const est = estimateFromFit(fit);
  if (!est) {
    runMore = Math.max(1, TAP_MIN_TAPS - fit.kept);
    return { taps: run.length, more: runMore, bpm: 0 };
  }
  runMore = 0;
  seq += 1;
  tappedBpm = est.bpm;
  anchorMs = est.anchorMs;
  resetBeatTrim();
  return { taps: run.length, more: 0, bpm: est.bpm };
}

/** The run being tapped right now, for the Tempo card's feedback: null once
 *  its last tap is older than TAP_GAP_SEC (the next tap starts over). */
export function getTapRun(nowMs: number): { taps: number; more: number } | null {
  if (run.length === 0 || nowMs - run[run.length - 1]! > TAP_GAP_SEC * 1000) return null;
  return { taps: run.length, more: runMore };
}

/** Hands the tempo back to the tracker (Shift+B) and forgets the run. */
export function releaseTapTempo(): void {
  releaseSeq += 1;
  run = [];
  runMore = TAP_MIN_TAPS;
}

// ---- The guide (see the file header's "where it meets the tracker") ----

export interface TapSeed {
  bpm: number;
  /** [0,1) beat phase at the instant poll() was given. */
  beatPhase: number;
}

export interface TapGuide {
  /** True from a tap taking effect until the tracker moves on (or Shift+B). */
  readonly guided: boolean;
  /** Reads the store once per tick. A tap tempo that took effect since the
   *  last call comes back as the tempo and the beat phase at `atMs` (on
   *  performance.now()'s clock) for the caller to seed; otherwise null. The
   *  very first call only adopts the store's counters, like a beat trimmer:
   *  a tap from before this guide existed is not applied. */
  poll(atMs: number): TapSeed | null;
  /** `rawBpm` (the tracker's reading; 0 = none), divided back onto the
   *  guided tempo when it sits at a ratio in TAP_FAMILY of it. Unchanged
   *  whenever not guided. */
  fold(rawBpm: number): number;
  /** Call after the metronome advanced: guidance ends once it isn't running
   *  or ticks outside RESYNC_RATIO of the guided tempo; otherwise the guided
   *  tempo follows it. */
  follow(running: boolean, metronomeBpm: number): void;
}

function wrap01(x: number): number {
  const w = x % 1;
  return w < 0 ? w + 1 : w;
}

export function createTapGuide(): TapGuide {
  let lastSeq: number | null = null;
  let lastRelease = 0;
  let ref = 0;

  function setGuided(on: boolean): void {
    (guide as { guided: boolean }).guided = on;
  }

  const guide: TapGuide = {
    guided: false,
    poll(atMs: number): TapSeed | null {
      const s = getTapTempo();
      if (lastSeq === null) {
        lastSeq = s.seq;
        lastRelease = s.releaseSeq;
        return null;
      }
      if (s.releaseSeq !== lastRelease) {
        lastRelease = s.releaseSeq;
        setGuided(false);
      }
      if (s.seq === lastSeq) return null;
      lastSeq = s.seq;
      if (!(s.bpm > 0)) return null;
      ref = s.bpm;
      setGuided(true);
      return { bpm: s.bpm, beatPhase: wrap01(((atMs - s.anchorMs) * s.bpm) / 60000) };
    },
    fold(rawBpm: number): number {
      if (!guide.guided || !(rawBpm > 0)) return rawBpm;
      for (const ratio of TAP_FAMILY) {
        if (Math.abs(rawBpm / (ref * ratio) - 1) <= RESYNC_RATIO) return rawBpm / ratio;
      }
      return rawBpm;
    },
    follow(running: boolean, metronomeBpm: number): void {
      if (!guide.guided) return;
      if (!running || !(Math.abs(metronomeBpm / ref - 1) <= RESYNC_RATIO)) {
        setGuided(false);
        return;
      }
      ref = metronomeBpm;
    },
  };
  return guide;
}
