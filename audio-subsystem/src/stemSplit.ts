import { MAX_HZ_CAP } from "./bandScale.ts";

/**
 * Splits the live spectrum into a drum part and a held part, the way a stem
 * splitter separates drums from melody, and reads two levels off it: Hats
 * (the drum part of the treble range) and Lead (the held part of the mid
 * range: vocals, synths, guitar together).
 *
 * The idea in plain words. Picture the spectrum scrolling over time. A drum
 * hit is a vertical streak: many neighbouring frequencies light up at once,
 * for an instant. A held note is a horizontal streak: one frequency stays lit.
 * So for every FFT bin, each tick, two medians:
 *
 * - across time: the bin's median over the last HELD_WINDOW_SEC. A held note
 *   keeps it high; a hit is too short to move it.
 * - across frequency: the median of the bins within SPREAD_HALF_HZ of it,
 *   this tick. A broadband hit lifts it; a lone held partial doesn't, because
 *   its neighbours stay quiet.
 *
 * A soft mask (each median squared, over their sum) shares the bin's power
 * between the two parts, so drum + held always equals the bin itself. It is
 * the median-filtering harmonic/percussive split from the literature, made
 * causal: live, the time median can only look back, so a new held note counts
 * as held only once it fills half the window, while hits come through at once.
 *
 * It runs on the full FFT bins of the device that hears the sound, before the
 * per-band auto-gain in features.ts. That gain re-levels each band within a
 * second or so, which erases the held-versus-hit difference the split reads
 * (an earlier try, run on the auto-gained bands every device receives, came
 * out flat for exactly this reason). So the two levels are measured here and
 * travel to followers inside the feature frame (src/net/protocol.ts).
 *
 * Each level is the part's power in its range, in dB, against the recent peak
 * of all sound in that range: the peak jumps up with a loud moment and falls
 * back at PEAK_FALL_PER_SEC, and the level reads 1 at the peak and 0 at
 * NORM_SPAN_DB below it. That keeps a quiet mic and a hot line feed on the
 * same 0..1 scale without re-levelling held sound away. The reference is the
 * whole range, not the part itself, so a drum break with no melody keeps
 * Lead low: against its own peak, Lead's leftovers would climb back to full
 * within seconds of the melody stopping. In a silent room the peak sinks to
 * the mic's own hiss, so it never falls below PEAK_FLOOR_DB, and
 * src/render/animClock.ts multiplies both levels by the silence gate's dimmer
 * (audio-subsystem/src/silenceGate.ts), as it already does for hits.
 *
 * What it cannot do: tell instruments apart. It sorts by shape, so a piano
 * or guitar attack counts as drums for an instant and a long cymbal wash
 * leaks into the held part. A Kick level was tried the same way and left
 * out: in the low range a bass note's attack looks like a kick to this
 * split, and today's Bass hit (src/render/bandEnergy.ts) told the two apart
 * better.
 *
 * The ranges come from the caller each tick (src/app.ts hands in the Mid and
 * Treble ranges of the band split, audio-subsystem/src/bandSplit.ts), so Lead and Hats
 * cover the same frequencies as the Mid and Treble rows beside them. Store-
 * free, like features.ts: the caller resolves anything persisted.
 *
 * The caller runs it only on ticks where something reads Hats or Lead
 * (src/render/stemReaders.ts says who does). After ticks without a call, it
 * comes back through `reset()`: everything heard before is forgotten, and the
 * levels settle the way a fresh splitter's do, within STEM_SETTLE_SEC.
 */

/** How long a bin's sound must have held to count as held — the time median's window. */
const HELD_WINDOW_SEC = 0.3;
/** How long a fresh (or reset) splitter takes to read as one that ran all
 *  along: once a whole time-median window has filled. */
export const STEM_SETTLE_SEC = HELD_WINDOW_SEC;
/** Half-width of the across-frequency median. */
const SPREAD_HALF_HZ = 190;
/** The time median keeps one spectrum per this many seconds, so it spans the
 *  same stretch of sound at any frame rate. */
const SNAPSHOT_SEC = 1 / 60;
/** A tick slightly early (frame-time jitter) still takes its snapshot. */
const SNAPSHOT_GAP_SEC = SNAPSHOT_SEC * 0.9;
/** How far below its recent peak a level reaches 0. */
const NORM_SPAN_DB = 30;
/** How fast a level's peak relaxes after a loud moment (1/tau, per second). */
const PEAK_FALL_PER_SEC = 1.5;
/** The lowest a level's peak may sink in silence — see the header. */
const PEAK_FLOOR_DB = -90;
const MAX_DT_SEC = 1;

/** A frequency range in Hz, low edge inclusive, high edge exclusive. */
interface HzRange {
  lo: number;
  hi: number;
}

export interface StemRanges {
  hats: HzRange;
  lead: HzRange;
}

/** Both levels in [0,1]. */
export interface StemLevels {
  hats: number;
  lead: number;
}

export interface StemSplitter {
  /** One tick: `binsDb` is the analyser's FFT bins in dB (getFloatFrequencyData;
   *  -Infinity reads as an empty bin), `nowSec` the capture's clock. Returns
   *  the same object every call, mutated in place. */
  update(binsDb: ArrayLike<number>, nowSec: number, ranges: StemRanges): StemLevels;
  /** Forgets everything heard, so the next update starts like a fresh splitter's first. */
  reset(): void;
}

interface PeakState {
  peak: number;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Both medians slide: each keeps its window sorted and, per step, drops the
// value leaving and inserts the one arriving, instead of re-sorting the whole
// window for every bin on every tick.

/** Index of the first entry >= v in the sorted run buf[off, off + n). */
function lowerBound(buf: Float64Array, off: number, n: number, v: number): number {
  let a = off;
  let b = off + n;
  while (a < b) {
    const m = (a + b) >> 1;
    if (buf[m] < v) a = m + 1;
    else b = m;
  }
  return a;
}

function sortedInsert(buf: Float64Array, off: number, n: number, v: number): void {
  const i = lowerBound(buf, off, n, v);
  buf.copyWithin(i + 1, i, off + n);
  buf[i] = v;
}

/** Drops one copy of `v`, which must be in the run. */
function sortedRemove(buf: Float64Array, off: number, n: number, v: number): void {
  const i = lowerBound(buf, off, n, v);
  buf.copyWithin(i, i + 1, off + n);
}

/** Median of a sorted run; an even count averages the two middle values. */
function sortedMedian(buf: Float64Array, off: number, n: number): number {
  if (n === 0) return 0;
  const mid = off + (n >> 1);
  return n % 2 === 1 ? buf[mid] : 0.5 * (buf[mid - 1] + buf[mid]);
}

/** `partPow` against the recent peak of `rangePow` (all sound in its range). */
function normalize(state: PeakState, partPow: number, rangePow: number, dt: number): number {
  const rangeDb = 10 * Math.log10(rangePow + 1e-15);
  if (rangeDb > state.peak) state.peak = rangeDb;
  else state.peak += (rangeDb - state.peak) * (1 - Math.exp(-PEAK_FALL_PER_SEC * dt));
  if (state.peak < PEAK_FLOOR_DB) state.peak = PEAK_FLOOR_DB;
  return clamp01((10 * Math.log10(partPow + 1e-15) - state.peak + NORM_SPAN_DB) / NORM_SPAN_DB);
}

export function createStemSplitter(binCount: number, binHz: number): StemSplitter {
  const spread = Math.max(1, Math.round(SPREAD_HALF_HZ / binHz));
  // The time medians are kept for every bin a range could ever reach (the
  // band ladder stops at MAX_HZ_CAP), so moving the band split never meets a
  // bin with no history.
  const bins = Math.min(binCount, Math.ceil(MAX_HZ_CAP / binHz) + spread + 1);
  // Snapshots come at most every SNAPSHOT_GAP_SEC, so this many fit in the window.
  const cap = Math.ceil(HELD_WINDOW_SEC / SNAPSHOT_GAP_SEC) + 1;
  const history = new Float64Array(cap * bins); // snapshot slot s, bin k at s * bins + k
  const snapTimes = new Float64Array(cap);
  const held = new Float64Array(bins * cap); // bin k's sorted window at k * cap
  let oldest = 0;
  let count = 0;
  let lastSnapSec = -Infinity;
  let lastSec: number | null = null;
  const power = new Float64Array(bins);
  const across = new Float64Array(2 * spread + 1);
  const hatsPeak: PeakState = { peak: PEAK_FLOOR_DB };
  const leadPeak: PeakState = { peak: PEAK_FLOOR_DB };
  const out: StemLevels = { hats: 0, lead: 0 };

  function dropOldest(): void {
    const row = oldest * bins;
    for (let k = 0; k < bins; k++) sortedRemove(held, k * cap, count, history[row + k]);
    count--;
    oldest = (oldest + 1) % cap;
  }

  return {
    reset() {
      // The sorted windows need no clearing: every read is bounded by `count`.
      oldest = 0;
      count = 0;
      lastSnapSec = -Infinity;
      lastSec = null;
      hatsPeak.peak = PEAK_FLOOR_DB;
      leadPeak.peak = PEAK_FLOOR_DB;
      out.hats = 0;
      out.lead = 0;
    },
    update(binsDb, nowSec, ranges) {
      const dt = lastSec === null ? 0 : Math.min(MAX_DT_SEC, Math.max(0, nowSec - lastSec));
      lastSec = nowSec;
      for (let k = 0; k < bins; k++) {
        const db = binsDb[k];
        const p = Number.isFinite(db) ? Math.pow(10, db / 10) : 0;
        power[k] = Number.isFinite(p) ? p : 0;
      }

      // The time medians: age out what left the window, then add this
      // spectrum. On a tick too soon after the last snapshot (a fast
      // display), the window goes without it.
      const cutoff = HELD_WINDOW_SEC - SNAPSHOT_SEC / 2;
      while (count > 0 && nowSec - snapTimes[oldest] >= cutoff) dropOldest();
      if (nowSec - lastSnapSec >= SNAPSHOT_GAP_SEC) {
        if (count === cap) dropOldest();
        const slot = (oldest + count) % cap;
        history.set(power, slot * bins);
        for (let k = 0; k < bins; k++) sortedInsert(held, k * cap, count, power[k]);
        snapTimes[slot] = nowSec;
        count++;
        lastSnapSec = nowSec;
      }

      const lo = Math.max(0, Math.ceil(Math.min(ranges.hats.lo, ranges.lead.lo) / binHz));
      const hi = Math.min(bins - spread - 1, Math.ceil(Math.max(ranges.hats.hi, ranges.lead.hi) / binHz));
      // The across-frequency window, slid one bin at a time: seeded as bin
      // lo-1's window minus its top bin, so the first step below completes it.
      let n = 0;
      for (let j = Math.max(0, lo - spread - 1); j < lo + spread; j++) sortedInsert(across, 0, n++, power[j]);
      let hatsPow = 0;
      let leadPow = 0;
      let treblePow = 0;
      let midPow = 0;
      for (let k = lo; k < hi; k++) {
        if (k - spread - 1 >= 0) sortedRemove(across, 0, n--, power[k - spread - 1]);
        sortedInsert(across, 0, n++, power[k + spread]);
        const s = sortedMedian(across, 0, n);
        const h = sortedMedian(held, k * cap, count);
        const s2 = s * s;
        const h2 = h * h;
        const drum = s2 + h2 > 0 ? s2 / (s2 + h2) : 0;
        const p = power[k];
        const hz = k * binHz;
        if (hz >= ranges.hats.lo && hz < ranges.hats.hi) {
          hatsPow += p * drum;
          treblePow += p;
        }
        if (hz >= ranges.lead.lo && hz < ranges.lead.hi) {
          leadPow += p * (1 - drum);
          midPow += p;
        }
      }

      out.hats = normalize(hatsPeak, hatsPow, treblePow, dt);
      out.lead = normalize(leadPeak, leadPow, midPow, dt);
      return out;
    },
  };
}
