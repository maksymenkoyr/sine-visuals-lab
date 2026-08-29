/**
 * The choreographer: turns the per-frame clocks into the pose the rig solves,
 * with every discontinuity smoothed away. Stateful (it remembers which rung
 * of the move ladder it is on, the crossfade in flight, the drop blend and
 * the camera bob), so it follows the repo's createX()/advance() shape rather
 * than being a pure function like the moves — see beatClock.ts.
 *
 * Layering, bottom to top:
 *   1. `sway`, the free layer that needs no beat;
 *   2. the beat-locked move for the current rung, crossfaded from the
 *      previous rung over one bar — rung changes latch only on a bar
 *      boundary so a new move lands on a downbeat;
 *   3. the tempoLock gate: at tempoLock 0 the output *is* sway, which is
 *      what masks a frozen beatPhase when the beat is lost;
 *   4. the drop pose, blended in on dropPulse with a slewed attack;
 *   5. jaw chatter on bass onsets;
 *   6. a per-channel slew — the backstop: whatever the layers above do, no
 *      channel changes faster than POSE_SLEW_RATE allows.
 */
import { B, boneChannel, createPose, type Pose } from "./rig.ts";
import {
  MOVE_LADDER,
  dropPose,
  effectiveIntensity,
  lerpPose,
  pickMoveLevel,
  sway,
  type MoveClocks,
} from "./moves.ts";

export interface ChoreoParams {
  /** 0..1 amplitude of every move (the `motion` setting). */
  energy: number;
  /** 0..1 how much the camera bobs on the beat (the `bob` setting). */
  bob: number;
  /** 0..1 bias on how eagerly the picker climbs the ladder (the `groove` setting). */
  groove: number;
  /** 0..1 how far bass hits open the jaw (the `jaw` setting). */
  jaw: number;
}

export interface ChoreoFrame {
  pose: Pose;
  /** Rung of MOVE_LADDER currently danced (after any crossfade lands). */
  level: number;
  /** Camera dolly toward the figure, in world units. */
  camDolly: number;
  /** Camera aim raised, in world units at the target. */
  camTilt: number;
  /** Camera roll, radians. */
  camRoll: number;
}

export interface Choreographer {
  advance(clocks: MoveClocks, dtSec: number, params: ChoreoParams): ChoreoFrame;
}

export const POSE_SLEW_RATE = 14; // per second — a snap settles in a few frames, a beat still reads as a beat
const CAM_SLEW_RATE = 30;
const DOLLY_MAX = 0.14;
const TILT_MAX = 0.035;
const ROLL_MAX = 0.02;
/** Without a beat to latch to, the picker re-evaluates on this timer instead. */
const FREE_LATCH_SEC = 2;
const FADE_MIN_SEC = 0.6;
const FADE_MAX_SEC = 3;
const DROP_ATTACK_RATE = 12; // ~100 ms to full: a hit, not a teleport (tests/dancersChoreo.test.ts bounds it)
const DROP_RELEASE_RATE = 6;
const DROP_GAIN = 1.2;
const JAW_MAX = 0.4;

function slew(current: number, target: number, rate: number, dtSec: number): number {
  return current + (target - current) * Math.min(1, rate * dtSec);
}

const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

export function createChoreographer(): Choreographer {
  const swayPose = createPose();
  const inPose = createPose();
  const outPose = createPose();
  const beatPose = createPose();
  const target = createPose();
  const pose = createPose();
  const drop = dropPose(createPose());
  let primed = false;

  let level = 0;
  let outgoing = 0;
  let fade = 1; // 0..1 progress of the crossfade from `outgoing` to `level`
  let lastBarPhase = 0;
  let freeTimer = 0;
  let dropBlend = 0;
  const cam = { camDolly: 0, camTilt: 0, camRoll: 0 };
  const jawCh = boneChannel(B.jaw);

  const evalLevel = (rung: number, clocks: MoveClocks, energy: number, out: Pose): void => {
    const move = MOVE_LADDER[rung];
    if (move) move(clocks, energy, out);
    else out.set(swayPose);
  };

  return {
    advance(clocks, dtSec, params) {
      const energy = params.energy;
      sway(clocks, energy, swayPose);

      // Rung changes latch on the downbeat (or a timer when there's no beat).
      const wrapped = clocks.barPhase < lastBarPhase;
      lastBarPhase = clocks.barPhase;
      freeTimer += dtSec;
      const locked = clocks.tempoLock >= 0.5;
      if ((locked && wrapped) || (!locked && freeTimer >= FREE_LATCH_SEC)) {
        freeTimer = 0;
        const next = pickMoveLevel(level, effectiveIntensity(clocks.sectionIntensity, params.groove));
        if (next !== level) {
          outgoing = level;
          level = next;
          fade = 0;
        }
      }

      const barSec = clocks.bpm > 0 ? 240 / clocks.bpm : 1.5;
      fade = Math.min(1, fade + dtSec / Math.min(FADE_MAX_SEC, Math.max(FADE_MIN_SEC, barSec)));
      evalLevel(level, clocks, energy, inPose);
      if (fade < 1) {
        evalLevel(outgoing, clocks, energy, outPose);
        lerpPose(outPose, inPose, smoothstep(fade), beatPose);
      } else {
        beatPose.set(inPose);
      }

      // The gate: no beat, no beat-locked motion.
      lerpPose(swayPose, beatPose, clocks.tempoLock, target);

      const dropTarget = Math.min(1, clocks.dropPulse * DROP_GAIN);
      dropBlend = slew(dropBlend, dropTarget, dropTarget > dropBlend ? DROP_ATTACK_RATE : DROP_RELEASE_RATE, dtSec);
      if (dropBlend > 1e-3) lerpPose(target, drop, dropBlend * (0.5 + 0.5 * energy), target);

      target[jawCh] += params.jaw * clocks.lowPulse * JAW_MAX;

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

      return { pose, level, ...cam };
    },
  };
}
