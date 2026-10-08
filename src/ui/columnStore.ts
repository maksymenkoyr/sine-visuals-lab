/**
 * The time store under every meter trace (audioMeters.ts's createColumnRing):
 * it keeps time, not pixels, so a trace keeps recording while its canvas has
 * no width (a folded card, the panel closed) and a card's span chip
 * (historySpan.ts) can squeeze more of it into the same width without
 * losing what's already there.
 *
 * push() max-holds each series into fixed BUCKET_MS buckets, kept for
 * `maxSpanSec`. Past FINE_SPAN_SEC only coarse buckets of COARSE_PER fine
 * ones are kept — enough for the longest span at a panel's width, and it
 * keeps a long span's resample to a few buckets per pixel. resample() turns
 * the buckets into one column per pixel over a span, each column the max of
 * its buckets (a max of maxes, so a column means the same at any span),
 * aligned to absolute bucket numbers so the picture scrolls whole columns
 * rather than shimmering.
 *
 * A frame that outlasts a bucket closes several at once — routine once a
 * scene is GPU-bound, since push() follows rAF, uncapped by the render-rate
 * cap (see app.ts's loop()). Rather than close those extra buckets empty,
 * the sample that closed the burst is held across all of them: the reading
 * was there for that whole stretch, we just weren't asked for it more
 * often. Past CARRY_MS the hold would be a lie — rAF was paused (a hidden
 * tab), not slow — so those buckets stay empty. An empty bucket, or a
 * series a push had no reading for (null), reads NaN, which a trace draws
 * as a gap rather than a zero.
 */

export const BUCKET_MS = 16;
const COARSE_PER = 16;
const FINE_SPAN_SEC = 60;
export const CARRY_MS = 250;

export interface ColumnStore {
  /** One sample per series, `null` where this tick has no reading for it. */
  push(values: readonly (number | null)[], nowMs: number): void;
  /** Starts the next bucket fresh at the next push(), so a stretch with
   *  nothing to sample isn't read as a stall's catch-up burst. */
  resetColumn(): void;
  /** Fills `out` (pixel-major, seriesCount floats per column, `width`
   *  columns, oldest first) with the last `spanSec`, the newest column
   *  including the bucket still filling. */
  resample(out: Float32Array, width: number, spanSec: number): void;
}

export function createColumnStore(seriesCount: number, maxSpanSec: number): ColumnStore {
  const S = seriesCount;
  // Interleaved, S floats per bucket, indexed by absolute bucket number
  // modulo capacity. No coarse level when maxSpanSec fits in the fine one.
  const fineCap = Math.ceil((Math.min(maxSpanSec, FINE_SPAN_SEC) * 1000) / BUCKET_MS) + 1;
  const fine = new Float32Array(fineCap * S).fill(Number.NaN);
  const coarseCap = maxSpanSec > FINE_SPAN_SEC ? Math.ceil((maxSpanSec * 1000) / (BUCKET_MS * COARSE_PER)) + 1 : 0;
  const coarse = new Float32Array(coarseCap * S).fill(Number.NaN);
  // Absolute number of the fine bucket being accumulated in colVals; every
  // fine bucket below it is closed. coarseTop is the newest coarse bucket
  // written (partially, while its fine buckets are still closing) — any
  // coarse bucket past it is blank, whatever its slot still holds.
  let next = 0;
  let coarseTop = -1;
  // NaN means "nothing folded in yet this bucket", not "zero".
  let colVals: number[] = new Array(S).fill(Number.NaN);
  let colStartMs: number | null = null;
  // What the last resample() drew, so the next can skip the columns that
  // can't have changed.
  let lastOut: Float32Array | null = null;
  let lastWidth = 0;
  let lastSpan = 0;
  let lastLastCol = 0;

  function maxInto(dst: Float32Array, di: number, v: number): void {
    if (Number.isNaN(v)) return;
    const d = dst[di];
    if (Number.isNaN(d) || v > d) dst[di] = v;
  }

  function commitBucket(vals: readonly number[]): void {
    fine.set(vals, (next % fineCap) * S);
    if (coarseCap > 0) {
      const cj = Math.floor(next / COARSE_PER);
      if (cj > coarseTop) {
        for (let j = Math.max(coarseTop + 1, cj - coarseCap + 1); j <= cj; j++) {
          const o = (j % coarseCap) * S;
          coarse.fill(Number.NaN, o, o + S);
        }
        coarseTop = cj;
      }
      const o = (cj % coarseCap) * S;
      for (let s = 0; s < S; s++) maxInto(coarse, o + s, vals[s]);
    }
    next++;
  }

  /** `n` blank buckets, possibly more than the whole store. The coarse level
   *  needs nothing here: a coarse bucket past coarseTop already reads blank. */
  function skipBuckets(n: number): void {
    if (n >= fineCap) fine.fill(Number.NaN);
    else
      for (let i = 0; i < n; i++) {
        const o = ((next + i) % fineCap) * S;
        fine.fill(Number.NaN, o, o + S);
      }
    next += n;
  }

  return {
    push(values, nowMs) {
      for (let i = 0; i < S; i++) {
        const v = values[i];
        if (v === null) continue;
        colVals[i] = Number.isNaN(colVals[i]) ? v : Math.max(colVals[i], v);
      }
      if (colStartMs === null) colStartMs = nowMs;
      const elapsed = nowMs - colStartMs;
      if (elapsed < BUCKET_MS) return;
      const n = Math.floor(elapsed / BUCKET_MS);
      // This push's sample is a reading for now, so it lands in the newest
      // bucket; the ones before it in the same burst hold it or go blank
      // (see the header).
      if (elapsed > CARRY_MS) skipBuckets(n - 1);
      else for (let k = 1; k < n; k++) commitBucket(colVals);
      commitBucket(colVals);
      colVals = colVals.map(() => Number.NaN);
      colStartMs = nowMs - (elapsed % BUCKET_MS);
    },
    resetColumn() {
      colStartMs = null;
    },
    resample(out, width, spanSec) {
      if (width <= 0) return;
      const span = Math.min(spanSec, maxSpanSec);
      const useCoarse = coarseCap > 0 && span > FINE_SPAN_SEC;
      const buf = useCoarse ? coarse : fine;
      const cap = useCoarse ? coarseCap : fineCap;
      // The bucket colVals belongs to, the newest closed (or, coarse,
      // partly written) one, and the oldest whose slot isn't reused yet.
      const liveIdx = useCoarse ? Math.floor(next / COARSE_PER) : next;
      const newest = useCoarse ? coarseTop : next - 1;
      const oldest = Math.max(0, newest - cap + 1);
      const perCol = (span * 1000) / (width * BUCKET_MS * (useCoarse ? COARSE_PER : 1));
      const lastCol = Math.floor(liveIdx / perCol);
      // Until the picture scrolls a column, only the newest one can change
      // (every bucket left of it is closed), so a redraw into the same
      // `out` rebuilds just that one.
      const same = out === lastOut && width === lastWidth && span === lastSpan && lastCol === lastLastCol;
      lastOut = out;
      lastWidth = width;
      lastSpan = span;
      lastLastCol = lastCol;
      if (same) out.fill(Number.NaN, (width - 1) * S, width * S);
      else out.fill(Number.NaN, 0, width * S);
      for (let x = same ? width - 1 : 0; x < width; x++) {
        const c = lastCol - (width - 1) + x;
        const lo = Math.floor(c * perCol);
        // At least one bucket per column, so a span shorter than the width
        // in buckets stretches rather than leaving gaps; the newest column
        // takes everything up to now, and at least the newest closed bucket
        // (the one still filling is empty just after a bucket closes).
        let hi = Math.max(lo + 1, Math.floor((c + 1) * perCol));
        let from = Math.max(lo, oldest);
        if (x === width - 1) {
          hi = Math.max(hi, newest + 1);
          from = Math.max(oldest, Math.min(from, newest));
        }
        const o = x * S;
        for (let k = from; k < hi && k <= newest; k++) {
          const bo = (k % cap) * S;
          for (let s = 0; s < S; s++) maxInto(out, o + s, buf[bo + s]);
        }
      }
      const o = (width - 1) * S;
      for (let s = 0; s < S; s++) {
        const v = colVals[s];
        if (Number.isNaN(v)) continue;
        const d = out[o + s];
        if (Number.isNaN(d) || v > d) out[o + s] = v;
      }
    },
  };
}
