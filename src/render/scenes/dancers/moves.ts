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
 */
import { B, CH_LIFT, CH_ROOT_X, CH_ROOT_Z, boneChannel, createPose, type Pose } from "./rig.ts";

/** The slice of AnimFrame the moves read — see animClock.ts for each field. */
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
}

/** Writes a full pose into `out` (overwriting it). `energy` in [0,1] scales
 *  every amplitude, so energy 0 is the rest pose for every move. */
export type Move = (c: MoveClocks, energy: number, out: Pose) => void;

export type Side = "L" | "R";
/** +1 for the L side (at +X), -1 for R — the sign that mirrors a lateral motion. */
const sideSign = (side: Side): number => (side === "L" ? 1 : -1);

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
export function lift(pose: Pose, height: number): void {
  pose[CH_LIFT] += Math.max(0, height);
}

// ---- Moves -----------------------------------------------------------------

const TAU = Math.PI * 2;

/** A resting stance — slight knee bend and a little arm hang-away — that
 *  every move builds on so the figure never locks its knees straight. */
export function stance(pose: Pose): void {
  for (const side of ["L", "R"] as const) {
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
  rootShift(out, 0.05 * e * s, 0.02 * e * s3);
  hips(out, 0.07 * e * s, 0.05 * e * s3);
  torso(out, 0.04 * e * (0.5 + 0.5 * s2), -0.1 * e * s3, -0.08 * e * s);
  head(out, 0.06 * e * s2, 0.12 * e * s3, 0.08 * e * s);
  // Weight drifts side to side: the unweighted knee softens.
  kneeFlex(out, "L", 0.22 * e * Math.max(0, s));
  kneeFlex(out, "R", 0.22 * e * Math.max(0, -s));
  for (const side of ["L", "R"] as const) {
    const k = sideSign(side);
    armSwing(out, side, 0.18 * e * Math.sin(f * 1.1 + k * 0.6), 0.06 * e * (0.5 + 0.5 * s2));
    elbowFlex(out, side, 0.2 * e * (0.5 + 0.5 * Math.sin(f * 1.7 + k)));
  }
};

export const MOVE_NAMES = ["sway"] as const;
export type MoveName = (typeof MOVE_NAMES)[number];
export const MOVES: Readonly<Record<MoveName, Move>> = { sway };

/** Scratch pose factory for callers that blend several moves per frame. */
export const newPose = createPose;
export { TAU };
