/**
 * The procedural side of the dance: the free sway the figure falls back to
 * when there is no beat (or no clip library yet), the resting stance, the
 * drop pose, and the intent helpers (armSwing, kneeFlex, …) they are written
 * with. The moves themselves come from captured clips — clipFormat.ts and
 * player.ts — since sine waves never read as a dance move.
 *
 * Move authors work through the intent helpers rather than raw rotations,
 * because the signs those need fall out of rig.ts's rest rotations and are
 * easy to get backwards. The helpers *compose onto* the pose so layers stack.
 *
 * effectiveIntensity() is what the clip picker climbs on: a held beat sets a
 * floor (a beat you can hear is a beat you step to) and the section decides
 * how far above it to go — see its comment for why sectionIntensity alone
 * was the wrong gauge.
 */
import { B, CH_LIFT, CH_ROOT_X, CH_ROOT_Z, createPose, lerpPose, mulBoneEuler, resetPose, type Pose } from "./rig.ts";

/** The slice of AnimFrame (plus FeatureFrame.bpm) the dance reads — see
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
 *  the motion; for `sway` energy 0 is exactly the rest stance. */
export type Move = (c: MoveClocks, energy: number, out: Pose) => void;

export type Side = "L" | "R";
/** +1 for the L side (at +X), -1 for R — the sign that mirrors a lateral motion. */
const sideSign = (side: Side): number => (side === "L" ? 1 : -1);
const SIDES: readonly Side[] = ["L", "R"];

// ---- Pose algebra ----------------------------------------------------------

export const restPose = resetPose;
export { lerpPose };

/** Layers yaw·pitch·roll onto what the bone already carries (rig.ts). */
const add = mulBoneEuler;

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

// ---- Procedural poses -------------------------------------------------------

/** A resting stance — slight knee bend and a little arm hang-away — that
 *  the sway builds on so the figure never locks its knees straight. */
export function stance(pose: Pose): void {
  for (const side of SIDES) {
    legSwing(pose, side, 0.02, 0.06);
    kneeFlex(pose, side, 0.08);
    armSwing(pose, side, 0.04, 0.12);
    elbowFlex(pose, side, 0.25);
  }
}

/** Free layer: a loose sway driven only by flowPhase, so it needs no beat.
 *  The clips fade in over this as the beat gate rises (choreo.ts). */
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

// ---- What the picker climbs on ---------------------------------------------

/** How far the `groove` setting can push the effective intensity. */
export const GROOVE_BIAS = 0.5;
/** Where a held beat alone puts the picker: a mid-low energy move at a
 *  NEUTRAL pulse dial, so a steady verse still dances. */
export const BEAT_FLOOR = 0.4;
/** How far the pulse dial moves that floor either way — a beat that hits
 *  hard and steadily asks for bigger moves, a barely-there one lets it go. */
export const PULSE_GAIN = 0.4;

/** Effective intensity — what the clip picker matches clip energy against.
 *
 *  sectionIntensity alone is the wrong gauge: it measures where this phrase
 *  sits within the track's *own* dynamic range and its floor creeps up
 *  through any steady section (sectionIntensity.ts), so on a song that
 *  isn't actively building it drifts back to ~0 within half a minute —
 *  which read as "the dancer stops dancing thirty seconds into every
 *  song". A beat you can hear is a beat you step to, so a held tempo sets a
 *  floor (BEAT_FLOOR, moved by the pulse dial) and the section only decides
 *  how far above it to go: a build or a chorus still asks for the big
 *  moves, and when the section settles the dancer settles back to a
 *  groove, never to standing still while the beat holds.
 *
 *  The groove setting biases the result and at its 0.5 default adds exactly
 *  nothing. */
export function effectiveIntensity(sectionIntensity: number, tempoLock: number, pulse: number, groove: number): number {
  const beatFloor = tempoLock * (BEAT_FLOOR + PULSE_GAIN * (pulse - 0.5));
  const drive = Math.max(sectionIntensity, beatFloor);
  return Math.min(1, Math.max(0, drive + (groove - 0.5) * GROOVE_BIAS));
}

/** Scratch pose factory for callers that blend several poses per frame. */
export const newPose = createPose;
