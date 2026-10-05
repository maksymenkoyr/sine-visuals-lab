/**
 * Code Rain's figure: a dancer drawn as a dense sheet of tiny raining glyphs
 * (the scene's stand-in for the reference's "ghosts", which were film stills
 * drawn in glyphs). The dance is the Dancers scene's own choreographer and
 * rig (src/render/scenes/dancers/), reused as is: this module solves the pose
 * every frame and flattens it into 2D capsules on the figure's own plane,
 * which glsl.ts's FIGURE_FRAG unions into a silhouette.
 *
 * Coordinates: the rig's world x/y (metres, +Y up, floor at 0, facing the
 * camera), flattened by dropping z — an orthographic front view, which is
 * what a billboard can show. The capsule radii are the Dancers' cheap skin's
 * (CAPSULE_RADII) widened by BODY_WIDEN / TORSO_WIDEN so the silhouette reads
 * as a body rather than a skeleton.
 *
 * Pure and GL-free: the clip library arrives through setLibrary(), and
 * until then (or under node) the dancer sways.
 */
import { BONES, B, CH_LIFT, boneTail, createRigWorld, forwardKinematics, groundToFloor, quatRotate, type BoneName } from "../dancers/rig.ts";
import { CAPSULE_RADII, SKULL_OFFSET, SKULL_RADIUS } from "../dancers/fastRenderers.ts";
import { createChoreographer } from "../dancers/choreo.ts";
import type { MoveClocks } from "../dancers/moves.ts";
import type { ClipLibrary } from "../dancers/clipFormat.ts";
import type { AnimFrame } from "../../animClock.ts";

const BODY_WIDEN = 1.9;
const TORSO_WIDEN = 3.2;
const TORSO: ReadonlySet<BoneName> = new Set(["pelvis", "spine", "chest"]);

/** Bones drawn as capsules (the cheap skin's list: radius 0 skips one). */
const DRAWN: readonly number[] = BONES.map((_, i) => i).filter((i) => (CAPSULE_RADII[BONES[i].name as BoneName] ?? 0) > 0);
export const FIGURE_CAPSULES = DRAWN.length;

/** The silhouette's top, in rig metres, with room for the raised arms. */
export const FIGURE_HEIGHT = 2.1;

export interface FigureFrame {
  /** FIGURE_CAPSULES vec4s: (ax, ay, bx, by) per capsule. */
  caps: Float32Array;
  /** FIGURE_CAPSULES radii. */
  radii: Float32Array;
  /** The skull: (cx, cy, r). */
  skull: Float32Array;
}

export interface Figure {
  advance(anim: AnimFrame, bpm: number, dtSec: number, motion: number): FigureFrame;
  setLibrary(library: ClipLibrary | null): void;
}

export function createFigure(): Figure {
  const choreographer = createChoreographer();
  const world = createRigWorld();
  const tail = new Float32Array(3);
  const out: FigureFrame = {
    caps: new Float32Array(FIGURE_CAPSULES * 4),
    radii: new Float32Array(FIGURE_CAPSULES),
    skull: new Float32Array(3),
  };
  DRAWN.forEach((b, i) => {
    const name = BONES[b].name as BoneName;
    out.radii[i] = (CAPSULE_RADII[name] ?? 0) * (TORSO.has(name) ? TORSO_WIDEN : BODY_WIDEN);
  });
  const clocks: MoveClocks = {
    beatPhase: 0, barPhase: 0, tempoLock: 0, beatPulse: 0, lowPulse: 0,
    sectionIntensity: 0, dropPulse: 0, flowPhase: 0, timeSec: 0, bpm: 0, pulse: 0.5,
  };

  return {
    setLibrary(library) {
      choreographer.setLibrary(library);
    },
    advance(anim, bpm, dtSec, motion) {
      clocks.beatPhase = anim.beatPhase;
      clocks.barPhase = anim.barPhase;
      clocks.tempoLock = anim.tempoLock;
      clocks.beatPulse = anim.beatPulse;
      clocks.lowPulse = anim.lowPulse;
      clocks.sectionIntensity = anim.sectionIntensity;
      clocks.dropPulse = anim.dropPulse;
      clocks.flowPhase = anim.flowPhase;
      clocks.timeSec = anim.timeSec;
      clocks.bpm = bpm;
      clocks.pulse = anim.profile.pulse;
      const frame = choreographer.advance(clocks, dtSec, {
        energy: motion,
        bob: 0,
        groove: 0.5,
        jaw: 0,
        family: null,
        blend: "crossfade",
      });
      forwardKinematics(frame.pose, world);
      groundToFloor(world, frame.pose[CH_LIFT]);
      DRAWN.forEach((b, i) => {
        boneTail(world, b, tail, 0);
        out.caps[i * 4] = world.pos[b * 3];
        out.caps[i * 4 + 1] = world.pos[b * 3 + 1];
        out.caps[i * 4 + 2] = tail[0];
        out.caps[i * 4 + 3] = tail[1];
      });
      // The skull: a circle SKULL_OFFSET up the head bone, as the cheap skin
      // draws its sphere.
      quatRotate(world.rot, B.head * 4, 0, SKULL_OFFSET, 0, tail, 0);
      out.skull[0] = world.pos[B.head * 3] + tail[0];
      out.skull[1] = world.pos[B.head * 3 + 1] + tail[1];
      out.skull[2] = SKULL_RADIUS * 1.15;
      return out;
    },
  };
}

