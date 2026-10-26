import { MAX_HZ_CAP } from "./bandScale.ts";

/**
 * Reads two levels off the live spectrum, the way a stem splitter separates
 * drums from melody: Hats (how hard the hi-hats and cymbals hit) and Lead (the
 * held part of the mid range: vocals, synths, guitar together).
 *
 * Lead in plain words. Picture the spectrum scrolling over time. A drum
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
 * Lead is the held part's power in its range, in dB, against the recent peak
 * of all sound in that range: the peak jumps up with a loud moment and falls
 * back at PEAK_FALL_PER_SEC, and the level reads 1 at the peak and 0 at
 * NORM_SPAN_DB below it. That keeps a quiet mic and a hot line feed on the
 * same 0..1 scale without re-levelling held sound away. The reference is the
 * whole range, not the part itself, so a drum break with no melody keeps
 * Lead low: against its own peak, Lead's leftovers would climb back to full
 * within seconds of the melody stopping. In a silent room the peak sinks to
 * the mic's own hiss, so it never falls below PEAK_FLOOR_DB.
 *
 * Hats in plain words. Hi-hats and cymbals are the part of a mix that still
 * hits hard above HATS_LO_HZ; a snare, a voice or a synth puts most of its
 * sound lower. So Hats sums the power above that edge and keeps what jumps
 * out of the band's own floor: the quietest moments (HATS_FLOOR_SHARE) of the
 * last HATS_FLOOR_SEC. A hit jumps out at once, while a steady hiss, a held
 * bright tone or the long wash of a cymbal becomes the floor. The band is
 * summed before the floor is taken: a single bin of steady noise swings by
 * about its own size from tick to tick, so taken bin by bin, a hiss would
 * read as a stream of hits. (The median split above can't make Hats: noise
 * in the treble lights neighbouring bins too, so it counts as half drum
 * whether hats play or not.)
 *
 * Hats is the hit's amplitude, not its dB, against the loudest recent hit,
 * which falls back at HATS_REF_FALL_PER_SEC: on a dB scale the stretch
 * between two hats still reads most of the way up. The reference never sinks
 * below HATS_SELF_FLOOR times the band's floor, so only a hit that stands
 * well clear of what the band was already doing reads high, and a hiss's
 * small swings or a sound that barely lifts the band stay low. Nor does it
 * sink more than HATS_BELOW_ALL_DB under the peak of all the sound (which
 * follows a quieter stretch at ALL_PEAK_FALL_PER_SEC), so a break without
 * hats stays near 0. Those and HATS_LO_HZ were picked by how closely Hats
 * followed the bright part of Demucs's drum stem on real songs, through a tab
 * share and through a laptop mic.
 *
 * src/render/animClock.ts multiplies both levels by the silence gate's dimmer
 * (src/audio/silenceGate.ts), as it already does for hits.
 *
 * What it cannot do: tell instruments apart. It sorts by shape, so a piano
 * or guitar attack counts as drums for an instant, a long cymbal wash leaks
 * into the held part, and a noise sweep, a sung "s" or a bright snare above
 * HATS_LO_HZ reads as Hats. A Kick level was tried the same way and left
 * out: in the low range a bass note's attack looks like a kick to this
 * split, and today's Bass hit (src/render/bandEnergy.ts) told the two apart
 * better.
 *
 * Lead's range comes from the caller each tick (app.ts hands in the Mid range
 * of src/audio/bandSplit.ts's BAND_SPLIT), so it covers the same frequencies
 * as the Mid row beside it. Hats has its own band rather than the Treble
 * row's: that row starts low enough to be mostly voices and synths. Store-
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
/** Hats listens from here to MAX_HZ_CAP — see the header. */
const HATS_LO_HZ = 7000;
/** How far back the hat band's floor looks. Short, so a bright sound that
 *  swells and holds (a noise sweep, a sung "s") counts only while it rises. */
const HATS_FLOOR_SEC = 0.1;
/** The floor is this share of the way up that stretch's sorted levels. */
const HATS_FLOOR_SHARE = 0.2;
/** How fast the loudest recent hit, Hats' reference, relaxes (1/tau, per second). */
const HATS_REF_FALL_PER_SEC = 1;
/** Hats' reference is never under this many times the hat band's floor... */
const HATS_SELF_FLOOR = 8;
/** ...nor more than this many dB under the peak of all the sound. */
const HATS_BELOW_ALL_DB = 30;
/** How fast the peak of all the sound follows a quieter stretch (1/tau, per second). */
const ALL_PEAK_FALL_PER_SEC = 0.1;
const MAX_DT_SEC = 1;

/** A frequency range in Hz, low edge inclusive, high edge exclusive. */
interface HzRange {
  lo: number;
  hi: number;
}

export interface StemRanges {
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
  const leadPeak: PeakState = { peak: PEAK_FLOOR_DB };
  const out: StemLevels = { hats: 0, lead: 0 };

  const hatsLo = Math.ceil(HATS_LO_HZ / binHz);
  const hatsHi = Math.min(bins, Math.ceil(MAX_HZ_CAP / binHz));
  // The hat band's summed power at each snapshot over the last
  // HATS_FLOOR_SEC, in arrival order and sorted.
  const bandCutoff = HATS_FLOOR_SEC + SNAPSHOT_SEC / 2;
  const bandCap = Math.ceil(bandCutoff / SNAPSHOT_GAP_SEC) + 1;
  const bandValues = new Float64Array(bandCap);
  const bandTimes = new Float64Array(bandCap);
  const bandSorted = new Float64Array(bandCap);
  let bandOldest = 0;
  let bandCount = 0;
  let hatsRef = 0;
  let allPeak = 0;
  const belowAll = Math.pow(10, -HATS_BELOW_ALL_DB / 10);

  function dropOldest(): void {
    const row = oldest * bins;
    for (let k = 0; k < bins; k++) sortedRemove(held, k * cap, count, history[row + k]);
    count--;
    oldest = (oldest + 1) % cap;
  }

  function dropOldestBand(): void {
    sortedRemove(bandSorted, 0, bandCount, bandValues[bandOldest]);
    bandCount--;
    bandOldest = (bandOldest + 1) % bandCap;
  }

  return {
    reset() {
      // The sorted windows need no clearing: every read is bounded by `count`.
      oldest = 0;
      count = 0;
      lastSnapSec = -Infinity;
      lastSec = null;
      bandOldest = 0;
      bandCount = 0;
      hatsRef = 0;
      allPeak = 0;
      leadPeak.peak = PEAK_FLOOR_DB;
      out.hats = 0;
      out.lead = 0;
    },
    update(binsDb, nowSec, ranges) {
      const dt = lastSec === null ? 0 : Math.min(MAX_DT_SEC, Math.max(0, nowSec - lastSec));
      lastSec = nowSec;
      let all = 0;
      for (let k = 0; k < bins; k++) {
        const db = binsDb[k];
        const p = Number.isFinite(db) ? Math.pow(10, db / 10) : 0;
        power[k] = Number.isFinite(p) ? p : 0;
        all += power[k];
      }

      // The time medians: age out what left the window, then add this
      // spectrum. On a tick too soon after the last snapshot (a fast
      // display), the window goes without it.
      const snap = nowSec - lastSnapSec >= SNAPSHOT_GAP_SEC;
      const cutoff = HELD_WINDOW_SEC - SNAPSHOT_SEC / 2;
      while (count > 0 && nowSec - snapTimes[oldest] >= cutoff) dropOldest();
      if (snap) {
        if (count === cap) dropOldest();
        const slot = (oldest + count) % cap;
        history.set(power, slot * bins);
        for (let k = 0; k < bins; k++) sortedInsert(held, k * cap, count, power[k]);
        snapTimes[slot] = nowSec;
        count++;
        lastSnapSec = nowSec;
      }

      const lo = Math.max(0, Math.ceil(ranges.lead.lo / binHz));
      const hi = Math.min(bins - spread - 1, Math.ceil(ranges.lead.hi / binHz));
      // The across-frequency window, slid one bin at a time: seeded as bin
      // lo-1's window minus its top bin, so the first step below completes it.
      let n = 0;
      for (let j = Math.max(0, lo - spread - 1); j < lo + spread; j++) sortedInsert(across, 0, n++, power[j]);
      let leadPow = 0;
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
        if (hz >= ranges.lead.lo && hz < ranges.lead.hi) {
          leadPow += p * (1 - drum);
          midPow += p;
        }
      }
      out.lead = normalize(leadPeak, leadPow, midPow, dt);

      let band = 0;
      for (let k = hatsLo; k < hatsHi; k++) band += power[k];
      while (bandCount > 0 && nowSec - bandTimes[bandOldest] >= bandCutoff) dropOldestBand();
      // Read against the floor before joining it, so a hit can't raise its own floor.
      const floor = bandCount > 0 ? bandSorted[Math.floor(HATS_FLOOR_SHARE * bandCount)] : band;
      const hit = Math.max(0, band - floor);
      if (snap) {
        if (bandCount === bandCap) dropOldestBand();
        const slot = (bandOldest + bandCount) % bandCap;
        bandValues[slot] = band;
        bandTimes[slot] = nowSec;
        sortedInsert(bandSorted, 0, bandCount, band);
        bandCount++;
      }
      allPeak = all > allPeak ? all : allPeak + (all - allPeak) * (1 - Math.exp(-ALL_PEAK_FALL_PER_SEC * dt));
      hatsRef = Math.max(hit, hatsRef * Math.exp(-HATS_REF_FALL_PER_SEC * dt));
      const ref = Math.max(hatsRef, HATS_SELF_FLOOR * floor, allPeak * belowAll);
      out.hats = ref > 0 ? Math.min(1, Math.sqrt(hit / ref)) : 0;
      return out;
    },
  };
}
