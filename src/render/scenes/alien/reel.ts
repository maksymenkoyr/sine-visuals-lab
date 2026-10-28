/**
 * The alien's loops and the rules the music plays them by.
 *
 * A loop is one captured dance (a clip from the dancers' library,
 * ../dancers/clipFormat.ts) seen through one fixed camera — LOOPS pairs
 * them, each from its own angle. The scene (index.ts) draws them live.
 *
 * **Move: music pays for frames.** The loop on screen plays at `speed` × its
 * captured speed, where the target speed is the Move setting times what its wire
 * reads. The speed eases toward that target over SPEED_EASE_SEC
 * (`easeSpeed`), so the dance doesn't twitch with every flicker of the
 * level. Silence reads 0: the speed eases down and the loop holds on the
 * frame it reached.
 *
 * **Cut: a trigger, not a timer.** A loop repeats until the Cut signal makes
 * a climb that stands out from its everyday ones (src/render/standout.ts, the
 * same detector Caustics' Beat ripple and Physarum 2's Dose read), and then
 * the reel cuts to another loop, picked at random among the others, unless
 * the shot on screen is younger than MIN_SHOT_SEC. Nothing else ever changes
 * the loop. Each loop keeps its own place, so cutting back finds the alien
 * where it was left. (Before that, a cut was the signal rising over a fixed
 * line: on a hit signal nearly every hit cleared it, and a hysteresis band
 * either cut every beat or, under a sustained bassline, never; the scene
 * record has the measurements.)
 *
 * **Bounce: squash and stretch.** On top of the dance the alien squashes
 * toward the floor under him and springs back past rest (`stepBounce`, a
 * damped spring chasing the Bounce signal), the cartoon squash-and-stretch
 * done on the figure itself (MESH_VERT in glsl.ts). Bounce smoothness
 * (`bounceSpring`) softens that spring: slower and more damped, so the squash
 * eases in and glides back without a wobble. A softer spring alone would
 * never reach a short hit's depth, so the target is scaled up to match: one
 * Bass hit squashes as deep at any smoothness.
 *
 * Pure and DOM/GL-free — tests/alien.test.ts drives it directly.
 */
import type { Vec3 } from "../dancers/rig.ts";
import { GROUP_TUNING } from "../../bandEnergy.ts";
import { createStandoutTrigger, stepStandoutTrigger, type StandoutTrigger } from "../../standout.ts";

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
  // The loops below frame the Blender model's height, so his head stays in
  // through every dance; the loops above still frame the old, shorter model
  // (the scene record's Known issues). Wider than those: most of these dances
  // are in the legs. The library's stillest clips are left out.
  // Front, knees up, a little to his left: the arm routine.
  { clip: "macarena", camera: { eye: [0.55, 1.6, 2.5], target: [0, 1.6, 0], focal: 2.3 } },
  // Three-quarter from his left and above, knees up.
  { clip: "chicken", camera: { eye: [1.6, 1.7, 2.0], target: [0, 1.25, 0.1], focal: 2.0 } },
  // Side on, full body: the glide reads only in profile.
  { clip: "moonwalk", camera: { eye: [3.0, 1.0, 0.3], target: [0, 1.15, 0], focal: 1.95 } },
  // Front from low, full body, for the kicks.
  { clip: "russian", camera: { eye: [0, 0.6, 3.1], target: [0, 1.0, 0.1], focal: 2.6 } },
  // Three-quarter from his right, full body at hip height.
  { clip: "charleston", camera: { eye: [-2.1, 1.1, 2.3], target: [0, 1.15, 0.1], focal: 2.1 } },
  // High above his left front, looking down past the head at the feet.
  { clip: "charleston2", camera: { eye: [0.8, 2.7, 2.4], target: [0, 1.05, 0], focal: 1.9 } },
  // Front from a little above, full body.
  { clip: "salsa", camera: { eye: [0, 1.8, 3.5], target: [0, 1.15, 0], focal: 2.4 } },
  // Close from his left at hip height, knees up: hands on the head, hips swaying.
  { clip: "lambada", camera: { eye: [1.3, 1.0, 1.8], target: [0, 1.4, 0], focal: 1.9 } },
  // Front, a little to his right, low: he drops to the floor and comes back up.
  { clip: "armup", camera: { eye: [-0.6, 0.9, 2.7], target: [0, 1.0, 0.2], focal: 2.0 } },
  // Low at his left front, full body: a second toprock, from further back than toprock2's.
  { clip: "toprock3", camera: { eye: [0.9, 0.4, 2.5], target: [0, 1.05, 0.2], focal: 1.9 } },
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

/** The shortest a shot lasts before the next standout can cut. */
export const MIN_SHOT_SEC = 2;

export interface Reel {
  /** Index into LOOPS of the loop on screen. */
  loop: number;
  /** The Cut rule: a standout in the Cut signal, at most once per
   *  MIN_SHOT_SEC. Its detector is what the panel's dotted line reads. */
  cut: StandoutTrigger;
  /** Cuts so far — a running count for probes and tests. */
  cuts: number;
}

export function createReel(): Reel {
  return { loop: 0, cut: createStandoutTrigger(MIN_SHOT_SEC), cuts: 0 };
}

/** What one tick of the music hands the reel's cut rule. */
export interface CutInput {
  dtSec: number;
  /** Whether the Cut setting is on. Off, the rule still listens, so the
   *  everyday climbs are already learned when it comes back on. */
  cutOn: boolean;
  cutSignal: number;
  /** Cut threshold, as standout.ts's standoutThreshold reads it: the slider,
   *  or null while its switch is Off (every climb out of near-silence cuts). */
  cutThreshold: number | null;
}

/** Another loop than `current`, uniformly among the rest. */
export function pickOther(current: number, count: number, rand: number): number {
  if (count < 2) return current;
  const step = 1 + Math.min(count - 2, Math.floor(rand * (count - 1)));
  return (current + step) % count;
}

/** Advances the cut rule one tick. Returns true on the tick it cut. */
export function stepCut(reel: Reel, input: CutInput, rand: () => number = Math.random): boolean {
  const dt = Math.max(0, input.dtSec);
  if (!stepStandoutTrigger(reel.cut, dt, input.cutSignal, input.cutThreshold, input.cutOn)) return false;
  reel.loop = pickOther(reel.loop, LOOPS.length, rand());
  reel.cuts++;
  return true;
}

/** The deepest squash, as a share of the alien's height, at Bounce 1 with
 *  its signal at 1. */
export const BOUNCE_MAX = 0.14;
/** The spring's natural frequency (Hz) and damping ratio at smoothness 0:
 *  under 1, so it overshoots past rest into a stretch before it settles. */
const BOUNCE_HZ = 3.2;
const BOUNCE_DAMPING = 0.32;
/** The same at smoothness 1: slower, and critically damped, so the squash
 *  glides back to rest without overshooting. */
const SMOOTH_HZ = 1.8;
const SMOOTH_DAMPING = 1;
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

export interface BounceSpring {
  hz: number;
  damping: number;
  /** Scales the target so one Bass hit squashes as deep as at smoothness 0. */
  gain: number;
}

// The slider sits still most of the time: one cached spring is enough.
let lastSpring: { smooth: number; spring: BounceSpring } | null = null;

/** The spring at `smooth` (0..1): frequency eased from BOUNCE_HZ to
 *  SMOOTH_HZ, damping from BOUNCE_DAMPING to SMOOTH_DAMPING, and the gain
 *  that keeps a hit's depth, measured on one Bass hit (a pulse decaying at
 *  the low band's own rate). Smoothness 0 is the spring exactly as before. */
export function bounceSpring(smooth: number): BounceSpring {
  const s = Math.max(0, Math.min(1, smooth));
  if (lastSpring && lastSpring.smooth === s) return lastSpring.spring;
  const hz = BOUNCE_HZ * Math.pow(SMOOTH_HZ / BOUNCE_HZ, s);
  const damping = BOUNCE_DAMPING + (SMOOTH_DAMPING - BOUNCE_DAMPING) * s;
  const gain = s === 0 ? 1 : hitPeak(BOUNCE_HZ, BOUNCE_DAMPING) / hitPeak(hz, damping);
  lastSpring = { smooth: s, spring: { hz, damping, gain } };
  return lastSpring.spring;
}

/** The deepest squash one unit Bass hit drives a spring to. */
function hitPeak(hz: number, damping: number): number {
  const b = createBounce();
  const h = 1 / 240;
  let peak = 0;
  for (let t = 0; t < 2; t += h) {
    springStep(b, Math.exp(-t * GROUP_TUNING.low.pulseDecayRate), h, hz, damping);
    peak = Math.max(peak, b.squash);
  }
  return peak;
}

function springStep(b: Bounce, target: number, h: number, hz: number, damping: number): void {
  const w = 2 * Math.PI * hz;
  const accel = w * w * (target - b.squash) - 2 * damping * w * b.velocity;
  b.velocity += accel * h;
  b.squash += b.velocity * h;
}

/** One tick of the spring chasing `target` (the squash the signal asks
 *  for) at Bounce smoothness `smooth`, in small fixed substeps so a long
 *  frame can't blow it up. */
export function stepBounce(b: Bounce, target: number, dtSec: number, smooth = 0): void {
  const { hz, damping, gain } = bounceSpring(smooth);
  let left = Math.min(0.25, Math.max(0, dtSec));
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 240);
    springStep(b, target * gain, h, hz, damping);
    left -= h;
  }
}
