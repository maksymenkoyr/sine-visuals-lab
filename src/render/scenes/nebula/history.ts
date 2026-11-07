/**
 * Nebula's temporal resolve, on the JS side. The gas is marched into a small target (index.ts's
 * `GAS_HEIGHT`) with a different sub-pixel offset and a different march start every frame, and
 * glsl.ts's RESOLVE_BODY folds each frame into a history `HISTORY_SCALE` times taller, moved for the
 * camera's motion since the last frame. Averaged over frames, the march's grain cancels and the
 * offsets fill in detail finer than the target's pixels: a march at the history's own size cost
 * several times as much (docs/scenes/nebula.md, 2026-11-07).
 *
 * Here: the offset sequence, and the last frame's camera as RESOLVE_BODY's `uPrevCam` wants it,
 * relative to this frame's so nothing that grows with the session reaches the GPU.
 */

/** History pixels per gas-target pixel on each axis, capped by the canvas (index.ts). */
export const HISTORY_SCALE = 2;
/** Frames before the sub-pixel offsets repeat. */
export const JITTER_CYCLE = 8;
/** A camera move longer than this in one frame (world units) is a cut, not motion: the history restarts. */
export const MAX_JUMP = 0.5;

/** One frame's camera: the unwrapped position (flight.ts's cameraWorld), the basis vectors
 *  (cameraUniforms' right, up, forward) and the gas's flow offset, which wraps at `period`. */
export interface CameraFrame {
  world: [number, number, number];
  basis: Float32Array;
  flow: [number, number];
}

export function createCameraFrame(): CameraFrame {
  return { world: [0, 0, 0], basis: new Float32Array(12), flow: [0, 0] };
}

/** Copies this frame's camera into `out`: `cam` is cameraUniforms' 16 floats. */
export function captureCamera(world: readonly number[], cam: Float32Array, flowX: number, flowY: number, out: CameraFrame): void {
  out.world = [world[0], world[1], world[2]];
  out.basis.set(cam.subarray(4, 16));
  out.flow = [flowX, flowY];
}

function halton(i: number, base: number): number {
  let f = 1;
  let r = 0;
  for (let n = i; n > 0; n = Math.floor(n / base)) {
    f /= base;
    r += f * (n % base);
  }
  return r;
}

/** This frame's sub-pixel offset of the gas target's rays, in its pixels, within ±0.5: Halton (2, 3),
 *  whose first points cover the pixel evenly. */
export function jitterAt(frame: number, out = new Float32Array(2)): Float32Array {
  const i = (frame % JITTER_CYCLE) + 1;
  out[0] = halton(i, 2) - 0.5;
  out[1] = halton(i, 3) - 0.5;
  return out;
}

/** This frame's shift of the march's per-pixel start offsets, 0..1: the golden ratio's steps never
 *  line up with the offsets' own pattern. */
export function frameNoiseAt(frame: number): number {
  return (frame * 0.618034) % 1;
}

function unwrap(d: number, period: number): number {
  return d - period * Math.round(d / period);
}

/**
 * RESOLVE_BODY's `uPrevCam`: [0] where this camera stands seen from the last one, less the gas's own
 * flow over the frame (a gas parcel streamed along with it); [1], [2], [3] the last camera's right,
 * up and forward. Returns the length of the move, so the caller can restart the history on a cut.
 */
export function prevCamUniforms(prev: CameraFrame, cur: CameraFrame, period: number, out = new Float32Array(16)): number {
  const dfx = unwrap(cur.flow[0] - prev.flow[0], period);
  const dfy = unwrap(cur.flow[1] - prev.flow[1], period);
  const dx = cur.world[0] - prev.world[0] - dfx;
  const dy = cur.world[1] - prev.world[1] - dfy;
  const dz = cur.world[2] - prev.world[2];
  out.set([dx, dy, dz, 0], 0);
  out.set(prev.basis.subarray(0, 3), 4);
  out[7] = 0;
  out.set(prev.basis.subarray(4, 7), 8);
  out[11] = 0;
  out.set(prev.basis.subarray(8, 11), 12);
  out[15] = 0;
  return Math.hypot(cur.world[0] - prev.world[0], cur.world[1] - prev.world[1], dz);
}
