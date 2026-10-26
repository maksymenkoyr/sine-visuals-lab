// Code Rain's explorer: the scripted walk the camera takes through the rain.
// It alternates two kinds of leg, drawn from a seeded generator so a mount
// always walks the same way: a walk, which eases in, curves gently, bobs with
// each step and eases to a stop; and a look round, standing still while the
// gaze sweeps one way, then the other, and lifts into the rain. The next walk
// sets off where the look round ended, so the path follows the gaze.
//
// `step` takes explorer seconds, not real ones: index.ts scales them by the
// Speed setting, so one number makes the explorer walk and look faster, and
// moves the camera itself (body heading x WALK_PACE x pace), so a drop's
// Turn bends the path without swinging it round the origin.
// The gaze and pitch relax towards each leg's targets (GAZE_TAU), so a leg
// boundary never jerks the camera.

/** Walking pace, world units per explorer second: ~5 glyph widths, which
 *  reads as walking rather than drifting. */
export const WALK_PACE = 1.3;
/** Steps a second, and the bob's height in world units (a step is half a
 *  bob cycle up, half down). */
const STEP_HZ = 1.7;
const BOB = 0.035;
/** Leg lengths, explorer seconds: [shortest, longest]. */
const WALK_DUR = [7, 13] as const;
const LOOK_DUR = [4.5, 8] as const;
/** Pace eases in and out over this long at each end of a walk. */
const EASE_SEC = 1.6;
/** A walk's curve: peak turn rate, radians per explorer second. */
const CURL_MAX = 0.22;
/** The glance while walking: amplitude, radians, and period. */
const GLANCE = (9 * Math.PI) / 180;
const GLANCE_PERIOD = 5.3;
/** A look round's sweeps, radians: the first goes 50-110 degrees one way,
 *  the second as far the other, and the walk then leaves 20-90 degrees off. */
const SWEEP_MIN = (50 * Math.PI) / 180;
const SWEEP_SPREAD = (60 * Math.PI) / 180;
const LEAVE_MIN = (20 * Math.PI) / 180;
const LEAVE_SPREAD = (70 * Math.PI) / 180;
/** How far a look round lifts the gaze, radians: up into the rain, up to
 *  the most; one look in LOOK_DOWN_SHARE drops it instead. */
const LIFT_MIN = (10 * Math.PI) / 180;
const LIFT_SPREAD = (18 * Math.PI) / 180;
const LOOK_DOWN_SHARE = 0.25;
/** Gaze and pitch follow their targets with this time constant, explorer s. */
const GAZE_TAU = 0.7;

interface ExplorerPose {
  /** Height above the ground line: the step bob. */
  y: number;
  /** Where the explorer walks and where it looks, radians (0 = -z). */
  body: number;
  gaze: number;
  /** Pitch on top of the Tilt setting, radians (+ looks up). */
  pitch: number;
  /** 0 standing, 1 at full pace. */
  pace: number;
}

export interface Explorer {
  step(dt: number): ExplorerPose;
}

interface Leg {
  look: boolean;
  dur: number;
  /** Walk: turn rate at the leg's middle. */
  curl: number;
  /** Look: the body heading it started from, its two sweeps, where the next
   *  walk leaves, and the lift. */
  from: number;
  sweepA: number;
  sweepB: number;
  leave: number;
  lift: number;
}

function smoothstep(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/** The look round's gaze offset from its start heading at progress u:
 *  out to sweepA, across to sweepB, then round to leave. */
function sweepAt(leg: Leg, u: number): number {
  if (u < 0.3) return leg.sweepA * smoothstep(u / 0.3);
  if (u < 0.68) return leg.sweepA + (leg.sweepB - leg.sweepA) * smoothstep((u - 0.3) / 0.38);
  return leg.sweepB + (leg.leave - leg.sweepB) * smoothstep((u - 0.68) / 0.32);
}

export function createExplorer(rng: () => number): Explorer {
  const pose: ExplorerPose = { y: 0, body: 0, gaze: 0, pitch: 0, pace: 0 };
  let leg: Leg;
  let legTime = 0;
  let stepPhase = 0;
  let walkTime = 0;

  const between = (r: readonly [number, number]): number => r[0] + (r[1] - r[0]) * rng();
  const side = (): number => (rng() < 0.5 ? -1 : 1);

  function nextLeg(look: boolean): Leg {
    if (!look) return { look, dur: between(WALK_DUR), curl: side() * CURL_MAX * (0.25 + 0.75 * rng()), from: 0, sweepA: 0, sweepB: 0, leave: 0, lift: 0 };
    const s = side();
    const sweepA = s * (SWEEP_MIN + SWEEP_SPREAD * rng());
    const sweepB = -s * (SWEEP_MIN + SWEEP_SPREAD * rng());
    const leave = side() * (LEAVE_MIN + LEAVE_SPREAD * rng());
    const lift = (rng() < LOOK_DOWN_SHARE ? -0.6 : 1) * (LIFT_MIN + LIFT_SPREAD * rng());
    return { look, dur: between(LOOK_DUR), curl: 0, from: pose.body, sweepA, sweepB, leave, lift };
  }

  // A mount starts mid-walk, already at pace, so the first frame moves.
  leg = nextLeg(false);
  legTime = EASE_SEC;

  return {
    step(dt: number): ExplorerPose {
      legTime += dt;
      if (legTime >= leg.dur) {
        legTime -= leg.dur;
        if (leg.look) pose.body = leg.from + leg.leave;
        leg = nextLeg(!leg.look);
      }
      const u = legTime / leg.dur;
      let gazeTarget: number;
      let pitchTarget: number;
      if (leg.look) {
        pose.pace = 0;
        gazeTarget = leg.from + sweepAt(leg, u);
        pitchTarget = leg.lift * Math.sin(Math.PI * smoothstep(u * 1.15));
      } else {
        pose.pace = smoothstep(legTime / EASE_SEC) * smoothstep((leg.dur - legTime) / EASE_SEC);
        pose.body += leg.curl * Math.sin(Math.PI * u) * pose.pace * dt;
        walkTime += dt * pose.pace;
        gazeTarget = pose.body + GLANCE * Math.sin((walkTime * 2 * Math.PI) / GLANCE_PERIOD);
        pitchTarget = 0;
      }
      const k = 1 - Math.exp(-dt / GAZE_TAU);
      pose.gaze += (gazeTarget - pose.gaze) * k;
      pose.pitch += (pitchTarget - pose.pitch) * k;
      stepPhase += STEP_HZ * Math.PI * pose.pace * dt;
      pose.y = BOB * pose.pace * Math.abs(Math.sin(stepPhase));
      return pose;
    },
  };
}
