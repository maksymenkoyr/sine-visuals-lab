/**
 * The choreographer: turns the per-frame clocks into the pose the rig solves,
 * with every discontinuity smoothed away. Stateful (it remembers the last
 * pose and camera bob), so it follows the repo's createX()/advance() shape
 * rather than being a pure function like the moves — see beatClock.ts.
 *
 * The final per-channel slew is the backstop: whatever the moves and blends
 * upstream do, no channel can change faster than POSE_SLEW_RATE allows.
 */
import { createPose, type Pose } from "./rig.ts";
import { sway, type MoveClocks } from "./moves.ts";

export interface ChoreoParams {
  /** 0..1 amplitude of every move (the `energy` setting). */
  energy: number;
  /** 0..1 how much the camera bobs on the beat (the `bob` setting). */
  bob: number;
}

export interface ChoreoFrame {
  pose: Pose;
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

const POSE_SLEW_RATE = 14; // per second — a snap settles in a few frames, a beat still reads as a beat
const CAM_SLEW_RATE = 30;
const DOLLY_MAX = 0.14;
const TILT_MAX = 0.035;
const ROLL_MAX = 0.02;

function slew(current: number, target: number, rate: number, dtSec: number): number {
  return current + (target - current) * Math.min(1, rate * dtSec);
}

export function createChoreographer(): Choreographer {
  const target = createPose();
  const pose = createPose();
  let primed = false;
  const cam = { camDolly: 0, camTilt: 0, camRoll: 0 };

  return {
    advance(clocks, dtSec, params) {
      sway(clocks, params.energy, target);

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

      return { pose, ...cam };
    },
  };
}
