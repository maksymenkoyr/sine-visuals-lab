/**
 * The alien's loops and the rules the music plays them by.
 *
 * A loop is one captured dance (a clip from the dancers' library,
 * ../dancers/clipFormat.ts) seen through one fixed camera — LOOPS pairs
 * each dance with one of the cameras in VIEWS. The scene (index.ts) draws
 * them live.
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
 * the shot on screen is younger than MIN_SHOT_SEC. Nothing else changes the
 * loop but the Dance setting: while it holds one dance (`chipLoop`), the
 * scene skips the cut. The View setting can hold one camera (`chipView`) for
 * every dance. Each loop keeps its own place, so cutting back finds the alien
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

export interface LoopView {
  /** Its chip on the View row (card.ts). */
  name: string;
  camera: LoopCamera;
}

// Saved looks store the View chip by index (sceneLooks.ts), so a new view
// goes at the end and none leaves, even when no dance uses it any more.
export const VIEWS: readonly LoopView[] = [
  // Front, a little below the face, close: head and torso fill the frame,
  // arms reaching out of it — the reference's hero framing.
  { name: "Close front", camera: { eye: [0, 1.3, 1.75], target: [0, 1.62, 0], focal: 3.2 } },
  // Three-quarter from his right and above: knees up.
  { name: "High right", camera: { eye: [-1.6, 1.95, 1.85], target: [0, 1.35, 0.1], focal: 3.0 } },
  // From the floor at his left front, close, looking up: he looms over the lens.
  { name: "Floor up", camera: { eye: [0.7, 0.2, 1.6], target: [0, 1.0, 0.05], focal: 1.7 } },
  // The views below frame the Blender model's height, so his head stays in;
  // the views above still frame the old, shorter model (the scene record's
  // Known issues). Wider than those: most dances are in the legs.
  // Front, knees up, a little to his left: made for an arm routine.
  { name: "Front knees", camera: { eye: [0.55, 1.6, 2.5], target: [0, 1.6, 0], focal: 2.3 } },
  // Three-quarter from his left and above, knees up.
  { name: "High left", camera: { eye: [1.6, 1.7, 2.0], target: [0, 1.25, 0.1], focal: 2.0 } },
  // Side on, full body: a glide reads only in profile.
  { name: "Side", camera: { eye: [3.0, 1.0, 0.3], target: [0, 1.15, 0], focal: 1.95 } },
  // Front from low, full body, for kicks.
  { name: "Low front", camera: { eye: [0, 0.6, 3.1], target: [0, 1.0, 0.1], focal: 2.6 } },
  // Three-quarter from his right, full body at hip height.
  { name: "Right", camera: { eye: [-2.1, 1.1, 2.3], target: [0, 1.15, 0.1], focal: 2.1 } },
  // High above his left front, looking down past the head at the feet.
  { name: "Above", camera: { eye: [0.8, 2.7, 2.4], target: [0, 1.05, 0], focal: 1.9 } },
  // Front from a little above, full body.
  { name: "Front", camera: { eye: [0, 1.8, 3.5], target: [0, 1.15, 0], focal: 2.4 } },
  // Close from his left at hip height, knees up.
  { name: "Close left", camera: { eye: [1.3, 1.0, 1.8], target: [0, 1.4, 0], focal: 1.9 } },
  // Front, a little to his right, low: made for a drop to the floor.
  { name: "Low right", camera: { eye: [-0.6, 0.9, 2.7], target: [0, 1.0, 0.2], focal: 2.0 } },
  // Low at his left front, full body.
  { name: "Low left", camera: { eye: [0.9, 0.4, 2.5], target: [0, 1.05, 0.2], focal: 1.9 } },
];

export interface LoopSpec {
  /** A clip name in the dancers' library (tools/clip-cuts.json). */
  clip: string;
  /** The loop's chip on the Dance row (card.ts). */
  dance: string;
  /** The name of the view in VIEWS the loop is seen through. */
  view: string;
}

// Saved looks store the Dance chip by index (sceneLooks.ts), so a new loop
// goes at the end. The dances after the first four came in on 2026-10-29,
// each through the view where the measured model fills the most of the
// frame without touching its edges, a view used less often winning a near
// tie (the scene record's Measurements).
export const LOOPS: readonly LoopSpec[] = [
  { clip: "toprock2", dance: "Toprock 2", view: "Floor up" },
  { clip: "charleston", dance: "Charleston", view: "Right" },
  { clip: "charleston2", dance: "Charleston 2", view: "Above" },
  { clip: "toprock3", dance: "Toprock 3", view: "Low left" },
  { clip: "break-flips", dance: "Break flips", view: "Front" },
  { clip: "egyptian-twist", dance: "Egyptian", view: "High left" },
  { clip: "egyptian-twist2", dance: "Egyptian 2", view: "High left" },
  { clip: "egyptian-twist3", dance: "Egyptian 3", view: "High left" },
  { clip: "chicken-a", dance: "Chicken", view: "Low left" },
  { clip: "chicken-b", dance: "Chicken 2", view: "Low left" },
  { clip: "dance-111", dance: "Freestyle", view: "Side" },
  { clip: "mickey", dance: "Mickey", view: "Right" },
  { clip: "mickey2", dance: "Mickey 2", view: "Side" },
  { clip: "mickey3", dance: "Mickey 3", view: "Low left" },
  { clip: "salsa-a07", dance: "Salsa", view: "Front" },
  { clip: "salsa-a08", dance: "Salsa 2", view: "Front" },
  { clip: "salsa-a09", dance: "Salsa 3", view: "Front" },
  { clip: "salsa-a12", dance: "Salsa 4", view: "Above" },
  { clip: "salsa-a13", dance: "Salsa 5", view: "Right" },
  { clip: "salsa-b01", dance: "Salsa 6", view: "Low left" },
  { clip: "salsa-b02", dance: "Salsa 7", view: "Right" },
  { clip: "salsa-b03", dance: "Salsa 8", view: "Low left" },
  { clip: "salsa-b04", dance: "Salsa 9", view: "Right" },
  { clip: "salsa-b05", dance: "Salsa 10", view: "Right" },
  { clip: "salsa-b06", dance: "Salsa 11", view: "Front" },
  { clip: "salsa-b07", dance: "Salsa 12", view: "Right" },
  { clip: "salsa-b13", dance: "Salsa 13", view: "Side" },
  { clip: "salsa-b15", dance: "Salsa 14", view: "Front" },
  { clip: "lindy-hop", dance: "Lindy hop", view: "Above" },
  { clip: "ballet-cartwheel", dance: "Cartwheel", view: "Side" },
  { clip: "ballet-side-steps", dance: "Side steps", view: "Side" },
  { clip: "ballet-grand-jete", dance: "Grand jeté", view: "Low left" },
  { clip: "modern-fold-in3", dance: "Fold in", view: "Low left" },
  { clip: "modern-lean-back", dance: "Lean back", view: "Above" },
];

/** Index into VIEWS of each loop's own view. */
export const LOOP_VIEW: readonly number[] = LOOPS.map((l) => VIEWS.findIndex((v) => v.name === l.view));

/** The loop a Dance chip holds, or null for Any, which leaves it to the reel. */
export function chipLoop(value: number): number | null {
  const i = Math.round(value) - 1;
  return i >= 0 && i < LOOPS.length ? i : null;
}

/** The view a View chip holds, or null for Own, the loop's own view. */
export function chipView(value: number): number | null {
  const i = Math.round(value) - 1;
  return i >= 0 && i < VIEWS.length ? i : null;
}

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
