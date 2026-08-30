/**
 * The dance moves: pure functions from the music clocks to a Pose. Every
 * move is continuous in every phase it reads (no `fract` cliffs), which is
 * the first line of defence against the figure snapping; choreo.ts adds the
 * crossfades and slews on top.
 *
 * Move authors work through the intent helpers below (armSwing, kneeFlex, …)
 * rather than raw pitch/yaw/roll, because the signs those need fall out of
 * rig.ts's rest rotations and are easy to get backwards. The helpers *add*
 * to the pose so layers compose.
 *
 * The beat-locked moves form a ladder (MOVE_LADDER) that pickMoveLevel()
 * climbs as the section gets more intense; `sway` is the free layer under
 * all of them and the only thing left when there is no beat to lock to.
 */
import { B, CH_LIFT, CH_ROOT_X, CH_ROOT_Z, boneChannel, createPose, type Pose } from "./rig.ts";

/** The slice of AnimFrame (plus FeatureFrame.bpm) the moves read — see
 *  animClock.ts for what each clock means. */
export interface MoveClocks {
  beatPhase: number;
  barPhase: number;
  tempoLock: number;
  beatPulse: number;
  lowPulse: number;
  sectionIntensity: number;
  dropPulse: number;
  flowPhase: number;
  timeSec: number;
  bpm: number;
  /** The profile's `pulse` dial (musicProfile.ts): how steadily the beat is
   *  hitting, NEUTRAL 0.5 on cold start and silence. */
  pulse: number;
}

/** Writes a full pose into `out` (overwriting it). `energy` in [0,1] scales
 *  the motion; for `sway` that means energy 0 is exactly the rest stance,
 *  while the beat moves keep their shape (see shapeAmp) and only go still. */
export type Move = (c: MoveClocks, energy: number, out: Pose) => void;

export type Side = "L" | "R";
/** +1 for the L side (at +X), -1 for R — the sign that mirrors a lateral motion. */
const sideSign = (side: Side): number => (side === "L" ? 1 : -1);
const SIDES: readonly Side[] = ["L", "R"];

// ---- Pose algebra ----------------------------------------------------------

export function restPose(out: Pose): Pose {
  out.fill(0);
  return out;
}

export function lerpPose(a: Pose, b: Pose, t: number, out: Pose): void {
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
}

function add(pose: Pose, bone: number, pitch: number, yaw: number, roll: number): void {
  const ch = boneChannel(bone);
  pose[ch] += pitch;
  pose[ch + 1] += yaw;
  pose[ch + 2] += roll;
}

// ---- Intent helpers ---------------------------------------------------------
// Sign notes (see rig.ts): limbs hang with rest Rz(π), so in the parent's
// frame +pitch swings a hanging limb toward -Z (backward) and +roll toward +X.
// Child bones of a hanging limb live in a frame whose +Z is still the front,
// so +pitch on a forearm brings it forward; a knee bends the other way.

/** Swing an upper arm forward (+Z) and spread it away from the body. */
export function armSwing(pose: Pose, side: Side, forward: number, spread: number, twist = 0): void {
  add(pose, side === "L" ? B.L_upperArm : B.R_upperArm, -forward, twist, sideSign(side) * spread);
}
/** Bend an elbow so the forearm comes forward/up. */
export function elbowFlex(pose: Pose, side: Side, amount: number): void {
  add(pose, side === "L" ? B.L_forearm : B.R_forearm, amount, 0, 0);
}
export function wristBend(pose: Pose, side: Side, amount: number): void {
  add(pose, side === "L" ? B.L_hand : B.R_hand, amount, 0, 0);
}
/** Swing a thigh forward (+Z) and spread it outward from the hip. */
export function legSwing(pose: Pose, side: Side, forward: number, spread: number): void {
  add(pose, side === "L" ? B.L_thigh : B.R_thigh, -forward, 0, sideSign(side) * spread);
}
/** Bend a knee — the foot travels backward, behind the knee. */
export function kneeFlex(pose: Pose, side: Side, amount: number): void {
  add(pose, side === "L" ? B.L_shin : B.R_shin, -amount, 0, 0);
}
/** Lean the torso forward, twist it about the spine, and bend it sideways
 *  toward +X — spread across the spine and chest so it reads as a curve. */
export function torso(pose: Pose, lean: number, twist: number, sideBend: number): void {
  add(pose, B.spine, lean * 0.5, twist * 0.4, sideBend * 0.5);
  add(pose, B.chest, lean * 0.5, twist * 0.6, sideBend * 0.5);
}
/** Tilt the pelvis (the hips) sideways toward +X and twist it. */
export function hips(pose: Pose, sideTilt: number, twist: number): void {
  add(pose, B.pelvis, 0, twist, sideTilt);
}
/** Nod the head forward, turn it toward +X, and tilt it sideways. */
export function head(pose: Pose, nod: number, turn: number, tilt: number): void {
  add(pose, B.neck, nod * 0.4, turn * 0.3, tilt * 0.4);
  add(pose, B.head, nod * 0.6, turn * 0.7, tilt * 0.6);
}
export function jawOpen(pose: Pose, amount: number): void {
  add(pose, B.jaw, amount, 0, 0);
}
export function rootShift(pose: Pose, x: number, z: number): void {
  pose[CH_ROOT_X] += x;
  pose[CH_ROOT_Z] += z;
}
/** Hop: raise the whole figure off the floor. */
export function lift(pose: Pose, height: number): void {
  pose[CH_LIFT] += Math.max(0, height);
}

// ---- Moves -----------------------------------------------------------------

const TAU = Math.PI * 2;

/** 0 on the beat, 1 halfway to the next — the crouch of a bounce. */
const dip = (beatPhase: number): number => 0.5 - 0.5 * Math.cos(TAU * beatPhase);
/** A hop that peaks exactly on the beat and is gone by the half-beat. */
const hop = (beatPhase: number): number => Math.max(0, Math.cos(TAU * beatPhase)) ** 2;
/** Weight cycle: +1 on the L foot, -1 on the R, shifting every beat. */
const weight = (barPhase: number): number => Math.sin(TAU * 2 * barPhase);
/** Amplitude for a beat move's *shape* (where the arms sit, how wide the
 *  stance is): partly energy-independent so hands-up still reads as hands
 *  up at low energy, while the motion riding on it scales with `energy`. */
const shapeAmp = (energy: number): number => 0.4 + 0.6 * energy;

/** A resting stance — slight knee bend and a little arm hang-away — that
 *  every move builds on so the figure never locks its knees straight. */
export function stance(pose: Pose): void {
  for (const side of SIDES) {
    legSwing(pose, side, 0.02, 0.06);
    kneeFlex(pose, side, 0.08);
    armSwing(pose, side, 0.04, 0.12);
    elbowFlex(pose, side, 0.25);
  }
}

/** Free layer: a loose sway driven only by flowPhase, so it needs no beat.
 *  Everything beat-locked fades in over this as tempoLock rises. */
export const sway: Move = (c, energy, out) => {
  restPose(out);
  stance(out);
  const e = energy;
  const f = c.flowPhase;
  const s = Math.sin(f * 1.1);
  const s2 = Math.sin(f * 2.2 + 0.7);
  const s3 = Math.sin(f * 0.55 + 1.3);
  rootShift(out, 0.09 * e * s, 0.03 * e * s3);
  hips(out, 0.14 * e * s, 0.09 * e * s3);
  torso(out, 0.08 * e * (0.5 + 0.5 * s2), -0.22 * e * s3, -0.14 * e * s);
  head(out, 0.12 * e * s2, 0.24 * e * s3, 0.14 * e * s);
  // Weight drifts side to side: the unweighted knee softens.
  kneeFlex(out, "L", 0.4 * e * Math.max(0, s));
  kneeFlex(out, "R", 0.4 * e * Math.max(0, -s));
  for (const side of SIDES) {
    const k = sideSign(side);
    armSwing(out, side, 0.35 * e * Math.sin(f * 1.1 + k * 0.6), 0.1 * e * (0.5 + 0.5 * s2));
    elbowFlex(out, side, 0.4 * e * (0.5 + 0.5 * Math.sin(f * 1.7 + k)));
  }
};

/** Two-step groove: weight shifts every beat, the free knee drives forward,
 *  hips and shoulders counter-twist, arms swing in depth against the legs. */
export const groove: Move = (c, energy, out) => {
  restPose(out);
  stance(out);
  const e = energy;
  const a = shapeAmp(energy);
  const w = weight(c.barPhase);
  const d = dip(c.beatPhase);
  rootShift(out, 0.14 * e * w, 0.0);
  hips(out, 0.25 * e * w, 0.3 * e * w);
  torso(out, 0.1 * e + 0.1 * e * d, -0.6 * e * w, -0.2 * e * w);
  head(out, 0.25 * e * d, 0.3 * e * w, 0.1 * e * w);
  for (const side of SIDES) {
    const k = sideSign(side);
    const free = Math.max(0, -k * w); // this leg is unweighted when the weight is on the other
    kneeFlex(out, side, 0.15 * a + 0.4 * e * d + 1.2 * e * free);
    legSwing(out, side, 0.9 * e * free, 0.06 * a);
    armSwing(out, side, 0.9 * e * k * w, 0.2 * a);
    elbowFlex(out, side, 0.6 * a + 0.9 * e * (0.5 + 0.5 * k * w));
  }
};

/** Bounce: both knees pump on the beat, arms tucked up and pumping, a small
 *  hop landing on every beat. */
export const bounce: Move = (c, energy, out) => {
  restPose(out);
  stance(out);
  const e = energy;
  const a = shapeAmp(energy);
  const d = dip(c.beatPhase);
  const w = weight(c.barPhase);
  // The camera is in front, so what sells this is vertical (the squat and
  // the hop) and lateral (the arms flaring) motion — depth-only motion
  // barely reads from there.
  const up = 1.0 - d; // 1 on the beat, 0 in the crouch
  lift(out, 0.18 * e * hop(c.beatPhase));
  rootShift(out, 0.08 * e * w, 0.0);
  hips(out, 0.12 * e * w, 0.0);
  torso(out, 0.4 * e * d, 0.2 * e * w, 0.08 * e * w);
  head(out, 0.4 * e * d, 0.0, 0.12 * e * w);
  for (const side of SIDES) {
    const k = sideSign(side);
    legSwing(out, side, 0.6 * e * d, 0.1 * a);
    kneeFlex(out, side, 0.15 * a + 1.4 * e * d);
    // Arms punch up and out on the beat, fold back in on the crouch.
    armSwing(out, side, 0.5 * a + 0.5 * e * up, 0.3 * a + 0.7 * e * up);
    elbowFlex(out, side, 1.3 * a + 0.9 * e * up * (0.5 + 0.5 * k * w) - 0.6 * e * up);
  }
};

/** Hands up: arms overhead waving on the bar, wide stance, head thrown back,
 *  weight rocking side to side with a hop on each beat. */
export const handsUp: Move = (c, energy, out) => {
  restPose(out);
  stance(out);
  const e = energy;
  const a = shapeAmp(energy);
  const d = dip(c.beatPhase);
  const w = weight(c.barPhase);
  const bar = Math.sin(TAU * c.barPhase);
  lift(out, 0.16 * e * hop(c.beatPhase));
  rootShift(out, 0.16 * e * w, 0.0);
  hips(out, 0.2 * e * w, 0.15 * e * bar);
  torso(out, -0.06 * a, 0.25 * e * Math.sin(TAU * 2 * c.barPhase), 0.3 * e * bar);
  head(out, -0.3 * a, 0.2 * e * bar, 0.12 * e * w);
  for (const side of SIDES) {
    const k = sideSign(side);
    legSwing(out, side, 0.2 * e * d, 0.28 * a);
    kneeFlex(out, side, 0.1 * a + 0.6 * e * d);
    armSwing(out, side, 0.35 * a, 2.5 * a + 0.6 * e * Math.sin(TAU * c.barPhase + k * 1.57));
    elbowFlex(out, side, 0.35 * a + 0.6 * e * Math.sin(TAU * 2 * c.barPhase + k * 1.5));
    wristBend(out, side, 0.6 * e * Math.sin(TAU * 4 * c.barPhase + k));
  }
};

/** The drop: a crouch with arms flung up and out, head thrown back, jaw
 *  open. A pose, not a move — choreo.ts blends toward it on dropPulse. */
export function dropPose(out: Pose): Pose {
  restPose(out);
  for (const side of SIDES) {
    legSwing(out, side, 0.5, 0.35);
    kneeFlex(out, side, 1.1);
    armSwing(out, side, 0.3, 2.6, 0.2);
    elbowFlex(out, side, 0.2);
  }
  torso(out, 0.3, 0, 0);
  head(out, -0.55, 0, 0);
  jawOpen(out, 0.35);
  return out;
}

/** Beat-locked moves in intensity order; index 0 is "sway only". */
export const MOVE_LADDER: readonly (Move | null)[] = [null, groove, bounce, handsUp];
export const MOVE_NAMES: readonly string[] = ["sway", "groove", "bounce", "handsUp"];

// The picker climbs a rung when intensity passes an UP threshold and only
// drops back below the matching DOWN threshold — the gap is what stops a
// track hovering near a threshold from flickering between moves.
const LEVEL_UP = [0.3, 0.55, 0.8];
const LEVEL_DOWN = [0.2, 0.45, 0.7];
/** How far the `groove` setting can push the effective intensity. */
export const GROOVE_BIAS = 0.5;
/** Where a held beat alone puts the picker: inside the groove rung at a
 *  NEUTRAL pulse dial, and below bounce, so a steady verse grooves. */
export const BEAT_FLOOR = 0.4;
/** How far the pulse dial moves that floor either way — a beat that hits
 *  hard and steadily lifts it into bounce, a barely-there one lets it go. */
export const PULSE_GAIN = 0.4;

/** Effective intensity — what the picker climbs on.
 *
 *  sectionIntensity alone is the wrong gauge: it measures where this phrase
 *  sits within the track's *own* dynamic range and its floor creeps up
 *  through any steady section (sectionIntensity.ts), so on a song that
 *  isn't actively building it drifts back to ~0 within half a minute —
 *  which read as "the dancer stops dancing thirty seconds into every
 *  song". A beat you can hear is a beat you step to, so a held tempo sets a
 *  floor under the picker (BEAT_FLOOR, moved by the pulse dial) and the
 *  section only decides how far above the groove to go: a build or a chorus
 *  still climbs to bounce/hands-up, and when the section settles the dancer
 *  settles back to the groove, never below it while the beat holds.
 *
 *  The groove setting biases the result and at its 0.5 default adds exactly
 *  nothing. */
export function effectiveIntensity(sectionIntensity: number, tempoLock: number, pulse: number, groove: number): number {
  const beatFloor = tempoLock * (BEAT_FLOOR + PULSE_GAIN * (pulse - 0.5));
  const drive = Math.max(sectionIntensity, beatFloor);
  return Math.min(1, Math.max(0, drive + (groove - 0.5) * GROOVE_BIAS));
}

/** The rung of MOVE_LADDER to dance at, given the previous rung. Pure. */
export function pickMoveLevel(prev: number, intensity: number): number {
  let level = prev;
  while (level < LEVEL_UP.length && intensity >= LEVEL_UP[level]) level++;
  while (level > 0 && intensity < LEVEL_DOWN[level - 1]) level--;
  return level;
}

/** Scratch pose factory for callers that blend several moves per frame. */
export const newPose = createPose;
export { TAU };
