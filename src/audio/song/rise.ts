// Copied from audio-subsystem/v6 (2026-10-30, #798/#800); the bench check (bench-signals' probe app-song) holds it equal to v6.
// A level's rise: the level minus its lowest value over the last `spanS` seconds. A Trigger on a level fires when the level
// crosses up through a quantile of its own past, which needs the level to dip under that mark between hits; under a sustained
// bass the low band never does. The rise is near zero while the level sits high and jumps on a hit, so a Trigger on it fires
// on hits whatever the level is standing at (#798).

/** Frames a second the ring is sized for, so a fast display cannot overflow it. */
const MAX_FRAME_RATE = 240;

export class Rise {
  private readonly spanS: number;
  /** A monotonic deque: values rise from front to back, so the front is the window's minimum. */
  private readonly times: Float64Array;
  private readonly values: Float64Array;
  private head = 0;
  private count = 0;

  constructor(spanS: number) {
    this.spanS = spanS;
    const size = Math.max(4, Math.ceil(spanS * MAX_FRAME_RATE) + 2);
    this.times = new Float64Array(size);
    this.values = new Float64Array(size);
  }

  /** `value` minus the lowest value in (now - spanS, now], itself included, so never below 0. */
  step(value: number, now: number): number {
    const size = this.times.length;
    const front = () => (this.head - this.count + size) % size;
    // A value at least as high as the new one can never be the minimum again.
    while (this.count > 0 && this.values[(this.head - 1 + size) % size] >= value) {
      this.head = (this.head - 1 + size) % size;
      this.count--;
    }
    this.times[this.head] = now;
    this.values[this.head] = value;
    this.head = (this.head + 1) % size;
    this.count++;
    while (this.count > 1 && this.times[front()] <= now - this.spanS) this.count--;
    return value - this.values[front()];
  }
}
