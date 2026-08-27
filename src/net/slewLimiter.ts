/** Slew-limits a value that can jump, so consumers see it drift smoothly
 *  instead of stepping. Used to move the render delay (see room.ts) without
 *  visibly rewinding the render clock when the target changes — e.g. a TV
 *  joining a solo host steps the target from 0 to RENDER_DELAY_MS, and
 *  snapping to that directly would make uTime jump backward. */
export class SlewLimiter {
  private value: number | null = null;
  private lastMs: number | null = null;

  constructor(private readonly ratePerMs: number) {}

  /** Advances toward `targetMs` given the current wall-clock time and
   *  returns the (possibly still-converging) value. First call snaps
   *  straight to the target — there's nothing to slew from yet. */
  next(targetMs: number, nowMs: number): number {
    if (this.value === null || this.lastMs === null) {
      this.value = targetMs;
      this.lastMs = nowMs;
      return this.value;
    }
    const dtMs = Math.max(0, nowMs - this.lastMs);
    this.lastMs = nowMs;
    const maxStep = dtMs * this.ratePerMs;
    const diff = targetMs - this.value;
    this.value += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;
    return this.value;
  }
}
