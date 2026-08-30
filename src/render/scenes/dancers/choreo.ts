/**
 * The choreographer: turns the per-frame clocks into the pose the rig solves,
 * with every discontinuity smoothed away. Stateful (it owns the clip player,
 * the beat gate, the drop blend and the camera bob), so it follows the
 * repo's createX()/advance() shape rather than being a pure function like
 * the moves — see beatClock.ts.
 *
 * Layering, bottom to top:
 *   1. `sway`, the free layer that needs no beat and no clips;
 *   2. the captured move the clip player is dancing (player.ts), picked on
 *      bar boundaries from moves.ts's effectiveIntensity — a held beat alone
 *      is enough to dance, and the section decides how big a move — scaled
 *      toward the sway by the `motion` setting;
 *   3. the beat gate: a slow-release follower of tempoLock. At 0 the output
 *      *is* sway, which is what masks a frozen beatPhase when the beat is
 *      lost; the slow release is what stops a one-bar bpm dropout from
 *      dumping the dancer;
 *   4. the drop pose, blended in on dropPulse with a slewed attack;
 *   5. jaw chatter on bass onsets;
 *   6. a per-channel slew — the backstop: whatever the layers above do, no
 *      channel changes faster than POSE_SLEW_RATE allows.
 */
import { B, createPose, lerpPose, mulBoneEuler, type Pose } from "./rig.ts";
import { dropPose, effectiveIntensity, sway, type MoveClocks } from "./moves.ts";
import type { ClipLibrary } from "./clipFormat.ts";
import { createClipPlayer, type BlendMode, type ClipPlayer } from "./player.ts";

export interface ChoreoParams {
  /** 0..1 how much of each move comes through (the `motion` setting): 1 is
   *  as captured, 0 keeps MOTION_FLOOR of it. */
  energy: number;
  /** 0..1 how much the camera bobs on the beat (the `bob` setting). */
  bob: number;
  /** 0..1 bias on how big a move the picker asks for (the `groove` setting). */
  groove: number;
  /** 0..1 how far bass hits open the jaw (the `jaw` setting). */
  jaw: number;
  /** Clip family to dance, or null for the whole library (the `style` setting). */
  family: string | null;
  /** How one move hands over to the next (the `blend` setting) — see player.ts. */
  blend: BlendMode;
}

export interface ChoreoFrame {
  pose: Pose;
  /** Name of the clip being danced, or null while swaying. */
  clip: string | null;
  /** Camera dolly toward the figure, in world units. */
  camDolly: number;
  /** Camera aim raised, in world units at the target. */
  camTilt: number;
  /** Camera roll, radians. */
  camRoll: number;
}

export interface Choreographer {
  advance(clocks: MoveClocks, dtSec: number, params: ChoreoParams): ChoreoFrame;
  /** Hands over the clip library once it has loaded; until then, sway. */
  setLibrary(library: ClipLibrary | null): void;
}

export const POSE_SLEW_RATE = 14; // per second — a snap settles in a few frames, a beat still reads as a beat
const CAM_SLEW_RATE = 30;
const DOLLY_MAX = 0.14;
const TILT_MAX = 0.035;
const ROLL_MAX = 0.02;
/** How fast the beat gate lets go once tempoLock drops — a few seconds, so a
 *  bpm dropout of a bar or two rides through (see advance()). */
const LOCK_RELEASE_RATE = 0.8;
/** How much of a move comes through at `motion` 0. */
const MOTION_FLOOR = 0.7;
const DROP_ATTACK_RATE = 12; // ~100 ms to full: a hit, not a teleport (tests/dancersChoreo.test.ts bounds it)
const DROP_RELEASE_RATE = 6;
const DROP_GAIN = 1.2;
const JAW_MAX = 0.4;

function slew(current: number, target: number, rate: number, dtSec: number): number {
  return current + (target - current) * Math.min(1, rate * dtSec);
}

export function createChoreographer(): Choreographer {
  const swayPose = createPose();
  const beatPose = createPose();
  const target = createPose();
  const pose = createPose();
  const drop = dropPose(createPose());
  let primed = false;
  let player: ClipPlayer | null = null;
  let danceLock = 0;
  let dropBlend = 0;
  const cam = { camDolly: 0, camTilt: 0, camRoll: 0 };

  return {
    setLibrary(library) {
      player = library && library.clips.length > 0 ? createClipPlayer(library) : null;
    },
    advance(clocks, dtSec, params) {
      sway(clocks, params.energy, swayPose);

      // The beat gate follows tempoLock up at once but lets go slowly: the
      // tracker dropping bpm to 0 for a bar (a break, a quiet intro bar, the
      // grid slipping on a fill) shouldn't dump the dancer to sway and make
      // it re-earn the beat over the couple of seconds tempoLock takes to
      // climb back. beatClock.ts's phase stalls while bpm is 0, so what the
      // release holds is the pose frozen where the beat left it, easing out.
      danceLock = Math.max(clocks.tempoLock, danceLock * (1 - Math.min(1, LOCK_RELEASE_RATE * dtSec)));

      const intensity = effectiveIntensity(clocks.sectionIntensity, danceLock, clocks.pulse, params.groove);
      const clip =
        player?.advance(clocks.barPhase, { intensity, family: params.family, dropPulse: clocks.dropPulse, bpm: clocks.bpm, blend: params.blend }, beatPose) ?? null;
      if (clip) {
        // `motion` scales the move toward the sway, not toward rest, so a
        // subdued dancer still stands like a dancer.
        lerpPose(swayPose, beatPose, MOTION_FLOOR + (1 - MOTION_FLOOR) * params.energy, beatPose);
      } else {
        beatPose.set(swayPose);
      }

      // The gate: no beat, no beat-locked motion.
      lerpPose(swayPose, beatPose, danceLock, target);

      const dropTarget = Math.min(1, clocks.dropPulse * DROP_GAIN);
      dropBlend = slew(dropBlend, dropTarget, dropTarget > dropBlend ? DROP_ATTACK_RATE : DROP_RELEASE_RATE, dtSec);
      if (dropBlend > 1e-3) lerpPose(target, drop, dropBlend * (0.5 + 0.5 * params.energy), target);

      mulBoneEuler(target, B.jaw, params.jaw * clocks.lowPulse * JAW_MAX, 0, 0);

      if (!primed) {
        pose.set(target);
        primed = true;
      } else {
        const k = Math.min(1, POSE_SLEW_RATE * dtSec);
        for (let i = 0; i < pose.length; i++) pose[i] += (target[i] - pose[i]) * k;
      }

      const bob = params.bob;
      cam.camDolly = slew(cam.camDolly, bob * clocks.beatPulse * DOLLY_MAX, CAM_SLEW_RATE, dtSec);
      cam.camTilt = slew(cam.camTilt, bob * clocks.beatPulse * TILT_MAX, CAM_SLEW_RATE, dtSec);
      cam.camRoll = slew(cam.camRoll, bob * clocks.lowPulse * ROLL_MAX, CAM_SLEW_RATE, dtSec);

      return { pose, clip: clip ? clip.name : null, ...cam };
    },
  };
}
