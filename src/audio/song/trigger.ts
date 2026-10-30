// Copied from audio-subsystem/v6 (2026-10-30, #798/#800); the bench check (bench-signals' probe app-song) holds it equal to v6. Edit: `Gate` is not exported.
// Turns a level into events: fires on the frame the level crosses up through a quantile of its own
// recent past. This is the live version of the bench's per-case threshold (rich/measure.ts
// coverEvents, which picks the threshold with the answer in hand); the index rule and the crossing
// rule are copied from there so a trigger and the bench agree on what a crossing is.

/** Frames a second the ring is sized for, so a fast display cannot overflow it. */
const MAX_FRAME_RATE = 240;
/** No firing until the window spans this long: a quantile of a few frames is noise. */
const MIN_HISTORY_S = 1;

/**
 * What must be true for a trigger's firing to count; the window keeps filling either way.
 * `playing`: song.playing is at PLAYING_GATE. `music`: v5's `music`, a steady pulse is heard.
 */
type Gate = "open" | "playing" | "music";

export interface TriggerSpec {
  windowS: number;
  quantile: number;
  gate: Gate;
  /** When set, the trigger reads the level's rise over this many seconds (./rise.ts), not the level. */
  riseS?: number;
}

export class Trigger {
  /** The level the last step compared against; Infinity while the window is still too short. */
  threshold = Infinity;
  private readonly windowS: number;
  private readonly quantile: number;
  private readonly times: Float64Array;
  private readonly values: Float64Array;
  /** The window's values kept in order, so a long window costs a shift per frame, not a sort. */
  private readonly sorted: Float64Array;
  private head = 0;
  private count = 0;
  private previous = -Infinity;

  constructor(windowS: number, quantile: number) {
    this.windowS = windowS;
    this.quantile = quantile;
    const size = Math.max(2, Math.ceil(windowS * MAX_FRAME_RATE));
    this.times = new Float64Array(size);
    this.values = new Float64Array(size);
    this.sorted = new Float64Array(size);
  }

  /** True on the frame `value` goes above the quantile of the earlier frames in the window. */
  step(value: number, now: number): boolean {
    const size = this.times.length;
    const oldest = () => (this.head - this.count + size) % size;
    while (this.count > 0 && (this.times[oldest()] < now - this.windowS || this.count === size)) {
      this.removeSorted(this.values[oldest()]);
      this.count--;
    }

    let fired = false;
    if (this.count > 0 && now - this.times[oldest()] >= MIN_HISTORY_S) {
      this.threshold = this.sorted[Math.round(this.quantile * (this.count - 1))];
      fired = value > this.threshold && this.previous <= this.threshold;
    } else {
      this.threshold = Infinity;
    }

    this.times[this.head] = now;
    this.values[this.head] = value;
    this.head = (this.head + 1) % size;
    this.insertSorted(value);
    this.count++;
    this.previous = value;
    return fired;
  }

  /** First index whose value is not below `v`. */
  private lowerBound(v: number): number {
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private insertSorted(v: number): void {
    const i = this.lowerBound(v);
    this.sorted.copyWithin(i + 1, i, this.count);
    this.sorted[i] = v;
  }

  private removeSorted(v: number): void {
    const i = this.lowerBound(v);
    this.sorted.copyWithin(i, i + 1, this.count);
  }
}
