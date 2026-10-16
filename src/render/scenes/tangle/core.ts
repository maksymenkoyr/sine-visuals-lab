// Pure helpers for Tangle (index.ts), kept free of GL so tests/tangle.test.ts
// can run them under node: the sim's texture side per quality preset, which
// frame of the history a delayed colour channel reads, and the camera's
// rotation.
import type { QualityPreset } from "../../quality.ts";

/** Side of the position texture per quality preset. The noise is laid out
 *  in uv, so the shapes keep their size at every side; a smaller side only
 *  draws each line from fewer duplicate segments. */
export const SIDE_BY_PRESET: Record<QualityPreset, number> = { high: 256, mid: 192, low: 128, floor: 96 };

/** The history slot whose frame time lies closest to `now - delaySec`, among
 *  the slots written so far (a slot never written holds -Infinity). Falls
 *  back to `head` — the frame just drawn — when nothing older exists, so a
 *  fresh start shows white lines rather than black ones. */
export function pickSlot(times: ArrayLike<number>, head: number, now: number, delaySec: number): number {
  if (delaySec <= 0) return head;
  const target = now - delaySec;
  let best = head;
  let bestErr = Math.abs(times[head] - target);
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (!Number.isFinite(t)) continue;
    const err = Math.abs(t - target);
    if (err < bestErr) {
      best = i;
      bestErr = err;
    }
  }
  return best;
}

/** A pull home toward the sphere spread over several warp steps. `amount`
 *  is the share of the way home the positions should travel in all (1 =
 *  all the way), `steps` how many steps it takes. Each step's blend is
 *  amount / (steps − k·amount), which moves a still point by equal shares of
 *  the start-to-home distance and lands it exactly home on the last step
 *  when amount is 1. */
export interface Glide {
  amount: number;
  steps: number;
  taken: number;
}

export function createGlide(): Glide {
  return { amount: 0, steps: 1, taken: 1 };
}

/** Starts a pull, keeping whatever is left of a stronger one in flight. */
export function startGlide(g: Glide, amount: number, steps: number): void {
  const left = g.taken < g.steps ? g.amount * (1 - g.taken / g.steps) : 0;
  g.amount = Math.min(1, Math.max(amount, left));
  g.steps = Math.max(1, Math.round(steps));
  g.taken = 0;
}

/** This step's blend toward home (0 once the glide is spent), advancing it. */
export function glideStep(g: Glide): number {
  if (g.taken >= g.steps || g.amount <= 0) return 0;
  const b = g.amount / (g.steps - g.taken * g.amount);
  g.taken++;
  return Math.min(1, b);
}

/** World-to-view rotation for a camera circling the centre at `yaw` about
 *  the vertical and tilted by `pitch` — column-major, ready for
 *  uniformMatrix3fv. The view looks down -z from +z. */
export function cameraRotation(yaw: number, pitch: number, out: Float32Array = new Float32Array(9)): Float32Array {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // R = Rx(pitch) · Ry(yaw); rows of R, written as columns.
  const r00 = cy;
  const r01 = 0;
  const r02 = -sy;
  const r10 = sp * sy;
  const r11 = cp;
  const r12 = sp * cy;
  const r20 = cp * sy;
  const r21 = -sp;
  const r22 = cp * cy;
  out[0] = r00;
  out[1] = r10;
  out[2] = r20;
  out[3] = r01;
  out[4] = r11;
  out[5] = r21;
  out[6] = r02;
  out[7] = r12;
  out[8] = r22;
  return out;
}
