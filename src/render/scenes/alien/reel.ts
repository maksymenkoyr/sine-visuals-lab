/**
 * The alien's three loops and the two things the music does to them.
 *
 * A loop is one captured dance (a clip from the dancers' library,
 * ../dancers/clipFormat.ts) seen through one fixed camera — LOOPS pairs
 * them, each from its own angle. Think of each as a short video the scene
 * owns: a playhead, measured in the clip's own frames, that only moves when
 * it is paid for.
 *
 * **Play: music pays for frames.** Every tick the playhead of the loop on
 * screen advances by `speed × clipFps × dt` frames, where `speed` is the
 * Play setting times what its wire reads (index.ts) and clipFps is the
 * clip's frames over its captured length — so a reading of 1 plays the
 * dance as it was performed, 0.5 at half speed, and silence (Level reads 0)
 * buys no frames: the alien holds the pose it was in. Nothing here looks at
 * the beat or the clock; the energy is the only currency.
 *
 * **Cut: a line the signal has to cross.** When the Cut signal rises over
 * its line — below it one tick, above it the next — the reel cuts to
 * another loop, picked at random among the others, unless the shot on
 * screen is younger than MIN_SHOT_SEC. That minimum is what keeps a busy
 * signal from cutting on every beat; a hysteresis band was tried first and
 * either cut every beat or, under a sustained bassline that never fell back
 * through it, not at all (the scene record has the measurements). Each loop
 * keeps its own playhead, so cutting back to a loop finds the alien where
 * it was left.
 *
 * Pure and DOM/GL-free — tests/alien.test.ts drives it directly.
 */
import type { Vec3 } from "../dancers/rig.ts";

export interface LoopCamera {
  eye: Vec3;
  /** The point the camera looks at. */
  target: Vec3;
  /** Focal length as a multiple of the screen's half-height. */
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

/** The shortest a shot lasts before the next rise over the line can cut. */
export const MIN_SHOT_SEC = 2;
/** The lowest line a cut uses, so with the line switched off a cut still
 *  needs the signal to rise out of near-silence. */
export const CUT_LINE_FLOOR = 0.02;

export interface Reel {
  /** Index into LOOPS of the loop on screen. */
  loop: number;
  /** Each loop's own playhead, in its clip's frames, in [0, frames). */
  heads: number[];
  /** The Cut signal on the previous tick (NaN before the first). */
  prevSignal: number;
  /** Seconds the shot on screen has lasted. */
  shotSec: number;
  /** Cuts so far — a running count for probes and tests. */
  cuts: number;
}

export function createReel(): Reel {
  return { loop: 0, heads: LOOPS.map(() => 0), prevSignal: NaN, shotSec: 0, cuts: 0 };
}

/** What one tick of the music hands the reel. */
export interface ReelInput {
  dtSec: number;
  /** How fast to play: 1 is the dance as captured; 0 holds the frame. */
  speed: number;
  /** Whether the Cut setting is on. */
  cutOn: boolean;
  cutSignal: number;
  cutLine: number;
  /** Each loop's clip length in frames, and its frames per second at 1×,
   *  in LOOPS order — 0 frames while the clip library hasn't arrived. */
  frames: readonly number[];
  fps: readonly number[];
}

/** Frames per second a clip plays at when Play reads 1. */
export function clipFps(clip: { frames: number; beats: number; nativeBpm: number }): number {
  const seconds = (clip.beats * 60) / clip.nativeBpm;
  return seconds > 0 ? clip.frames / seconds : 0;
}

/** Another loop than `current`, uniformly among the rest. */
export function pickOther(current: number, count: number, rand: number): number {
  if (count < 2) return current;
  const step = 1 + Math.min(count - 2, Math.floor(rand * (count - 1)));
  return (current + step) % count;
}

/** Advances one tick: cut first (so the new loop is the one paid for this
 *  tick), then pay the loop on screen. Returns true on the tick it cut. */
export function advanceReel(reel: Reel, input: ReelInput, rand: () => number = Math.random): boolean {
  let cut = false;
  reel.shotSec += Math.max(0, input.dtSec);
  const line = Math.max(CUT_LINE_FLOOR, input.cutLine);
  // NaN on the first tick compares false: no crossing without a tick before it.
  const rose = reel.prevSignal <= line && input.cutSignal > line;
  reel.prevSignal = input.cutSignal;
  if (input.cutOn && rose && reel.shotSec >= MIN_SHOT_SEC) {
    reel.loop = pickOther(reel.loop, LOOPS.length, rand());
    reel.shotSec = 0;
    reel.cuts++;
    cut = true;
  }
  const frames = input.frames[reel.loop] ?? 0;
  const fps = input.fps[reel.loop] ?? 0;
  if (frames > 0 && input.speed > 0 && input.dtSec > 0) {
    const head = reel.heads[reel.loop] + input.speed * fps * input.dtSec;
    reel.heads[reel.loop] = head - Math.floor(head / frames) * frames;
  }
  return cut;
}
