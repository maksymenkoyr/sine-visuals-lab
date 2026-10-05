/**
 * The alien's three loops and the rules the music plays them by.
 *
 * A loop is one captured dance (a clip from the dancers' library,
 * ../dancers/clipFormat.ts) seen through one fixed camera — LOOPS pairs
 * them, each from its own angle. tools/alien-bake.mjs renders every loop to
 * a video (manifest.json beside them says how many frames, at what rate);
 * the scene (index.ts) plays those videos.
 *
 * **Move: music pays for frames.** The loop on screen plays at `speed` × its
 * baked rate, where the target speed is the Move setting times what its wire
 * reads. The speed eases toward that target over SPEED_EASE_SEC
 * (`easeSpeed`), so the dance doesn't twitch with every flicker of the
 * level. Silence reads 0: the speed eases down and the loop holds on the
 * frame it reached.
 *
 * **Cut: a trigger, not a timer.** A loop repeats until the Cut signal rises
 * over its line — below it one tick, above it the next — and then the reel
 * cuts to another loop, picked at random among the others, unless the shot
 * on screen is younger than MIN_SHOT_SEC. Nothing else ever changes the
 * loop. Each loop keeps its own place, so cutting back finds the alien where
 * it was left. (A hysteresis band was tried before the minimum shot: it
 * either cut every beat or, under a sustained bassline, never; the scene
 * record has the measurements.)
 *
 * **Bounce: squash and stretch.** On top of the dance the whole picture
 * squashes toward the floor under the alien and springs back past rest
 * (`stepBounce`, a damped spring chasing the Bounce signal), the cartoon
 * squash-and-stretch done as a filter on the baked frame.
 *
 * Pure and DOM/GL-free — tests/alien.test.ts drives it directly.
 */
import type { Vec3 } from "../dancers/rig.ts";

export interface LoopCamera {
  eye: Vec3;
  /** The point the camera looks at. */
  target: Vec3;
  /** Focal length as a multiple of the frame's half-height. */
  focal: number;
}

export interface LoopSpec {
  /** A clip name in the dancers' library (tools/clip-cuts.json). */
  clip: string;
  camera: LoopCamera;
}

export const LOOPS: readonly LoopSpec[] = [
  // Front, a little below the face, close: head and torso fill the frame,
  // arms reaching out of it — the reference's hero framing.
  { clip: "expressive", camera: { eye: [0, 1.3, 1.75], target: [0, 1.62, 0], focal: 3.2 } },
  // Three-quarter from his right and above: knees up.
  { clip: "twist", camera: { eye: [-1.6, 1.95, 1.85], target: [0, 1.35, 0.1], focal: 3.0 } },
  // From the floor at his left front, close, looking up: he looms over the lens.
  { clip: "toprock2", camera: { eye: [0.7, 0.2, 1.6], target: [0, 1.0, 0.05], focal: 1.7 } },
];

/** Seconds a clip's loop lasts as it was captured. */
export function clipSeconds(clip: { beats: number; nativeBpm: number }): number {
  return clip.nativeBpm > 0 ? (clip.beats * 60) / clip.nativeBpm : 0;
}

/** Seconds the speed takes to get most of the way to a new target. */
export const SPEED_EASE_SEC = 0.4;

/** One tick of the speed easing toward `target` (exponential, frame-rate
 *  independent). */
export function easeSpeed(speed: number, target: number, dtSec: number): number {
  const k = 1 - Math.exp(-Math.max(0, dtSec) / SPEED_EASE_SEC);
  return speed + (Math.max(0, target) - speed) * k;
}

/** The shortest a shot lasts before the next rise over the line can cut. */
export const MIN_SHOT_SEC = 2;
/** The lowest line a cut uses, so with the line switched off a cut still
 *  needs the signal to rise out of near-silence. */
export const CUT_LINE_FLOOR = 0.02;

export interface Reel {
  /** Index into LOOPS of the loop on screen. */
  loop: number;
  /** The Cut signal on the previous tick (NaN before the first). */
  prevSignal: number;
  /** Seconds the shot on screen has lasted. */
  shotSec: number;
  /** Cuts so far — a running count for probes and tests. */
  cuts: number;
}

export function createReel(): Reel {
  return { loop: 0, prevSignal: NaN, shotSec: 0, cuts: 0 };
}

/** What one tick of the music hands the reel's cut rule. */
export interface CutInput {
  dtSec: number;
  /** Whether the Cut setting is on. */
  cutOn: boolean;
  cutSignal: number;
  cutLine: number;
}

/** Another loop than `current`, uniformly among the rest. */
export function pickOther(current: number, count: number, rand: number): number {
  if (count < 2) return current;
  const step = 1 + Math.min(count - 2, Math.floor(rand * (count - 1)));
  return (current + step) % count;
}

/** Advances the cut rule one tick. Returns true on the tick it cut. */
export function stepCut(reel: Reel, input: CutInput, rand: () => number = Math.random): boolean {
  reel.shotSec += Math.max(0, input.dtSec);
  const line = Math.max(CUT_LINE_FLOOR, input.cutLine);
  // NaN on the first tick compares false: no crossing without a tick before it.
  const rose = reel.prevSignal <= line && input.cutSignal > line;
  reel.prevSignal = input.cutSignal;
  if (!input.cutOn || !rose || reel.shotSec < MIN_SHOT_SEC) return false;
  reel.loop = pickOther(reel.loop, LOOPS.length, rand());
  reel.shotSec = 0;
  reel.cuts++;
  return true;
}

/** The deepest squash, as a share of the picture's height, at Bounce 1 with
 *  its signal at 1. */
export const BOUNCE_MAX = 0.14;
/** The spring's natural frequency (Hz) and damping ratio: under 1, so it
 *  overshoots past rest into a stretch before it settles. */
const BOUNCE_HZ = 3.2;
const BOUNCE_DAMPING = 0.32;
/** Sideways spread per unit of squash — the body keeps roughly its volume. */
export const BOUNCE_WIDEN = 0.5;

export interface Bounce {
  /** Squash now: positive is shorter and wider, negative taller and thinner. */
  squash: number;
  velocity: number;
}

export function createBounce(): Bounce {
  return { squash: 0, velocity: 0 };
}

/** One tick of the spring chasing `target` (the squash the signal asks
 *  for), in small fixed substeps so a long frame can't blow it up. */
export function stepBounce(b: Bounce, target: number, dtSec: number): void {
  const w = 2 * Math.PI * BOUNCE_HZ;
  let left = Math.min(0.25, Math.max(0, dtSec));
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 240);
    const accel = w * w * (target - b.squash) - 2 * BOUNCE_DAMPING * w * b.velocity;
    b.velocity += accel * h;
    b.squash += b.velocity * h;
    left -= h;
  }
}
