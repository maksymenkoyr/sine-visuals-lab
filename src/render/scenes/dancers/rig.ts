/**
 * The dancers' rig: a bone hierarchy solved on the CPU every frame and packed
 * into one vec4 array for the fragment shader. Skins (stickSkin.ts,
 * skeletonSkin.ts) never see joints or angles — only `boneLocal()`, which
 * turns a world point into a bone's own frame, so the rig ↔ skin contract is
 * just the BONES table plus RIG_GLSL below.
 *
 * Coordinates: world +Y up, the floor at FLOOR_Y, the figure faces +Z toward
 * a camera on the +Z side (screen-right = +X). Every bone's local +Y runs
 * head→tail over [0, length]; local +Z is the bone's front at rest. Hanging
 * limbs (arms, legs) carry a rest rotation of Rz(π) so their +Y points down
 * while +Z stays the front. Because `L_*` bones sit at +X, the figure reads
 * like a dance mirror (its left is on screen-right) — cosmetic for a
 * symmetric rig.
 *
 * A Pose is a flat Float32Array of channels (CH_* and boneChannel()): root
 * x/z offset, lift above the floor, then pitch/yaw/roll per bone in radians.
 * A bone's rotation is expressed in its parent's frame and applied before its
 * rest rotation:  worldRot(b) = worldRot(parent) · euler(pose, b) · rest(b).
 * moves.ts hides the sign conventions that fall out of that behind intent
 * helpers (armSwing, kneeFlex, …) so move authors never touch raw signs.
 *
 * Panorama: index.ts builds its ray from roomUv() with the local aspect, the
 * same approximation ferrofluid.ts and tunnel.ts accept, so a slice sees its
 * window of the one room-space figure.
 *
 * Pure and DOM/GL-free — tests/dancersRig.test.ts drives it directly.
 */

export type Vec3 = readonly [number, number, number];
/** x, y, z, w — the same layout uBones carries into GLSL. */
export type Quat = readonly [number, number, number, number];

export interface BoneSpec {
  name: string;
  /** Index into BONES, or -1 for the root. Parents always precede children. */
  parent: number;
  length: number;
  /** Head position in the parent's local frame. */
  offset: Vec3;
  /** Rotation from the parent-aligned frame into the bone's rest frame. */
  rest: Quat;
}

export const FLOOR_Y = 0;
/** Where the pelvis head sits at rest, before groundToFloor() re-pins it. */
const ROOT_REST_Y = 0.95;
/** Radius the floor pin assumes for the foot's own thickness. */
export const FOOT_RADIUS = 0.045;

const IDENTITY: Quat = [0, 0, 0, 1];

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const h = angle * 0.5;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}

/** Hanging-limb rest: +Y → down, +Z stays front, +X → -X. */
const HANG: Quat = quatFromAxisAngle([0, 0, 1], Math.PI);

function bone(name: string, parent: number, length: number, offset: Vec3, rest: Quat = IDENTITY): BoneSpec {
  return { name, parent, length, offset, rest };
}

/** The same bone reflected through the sagittal plane, for the R_ side. */
function mirror(spec: BoneSpec, parent: number): BoneSpec {
  return {
    ...spec,
    name: spec.name.replace(/^L_/, "R_"),
    parent,
    offset: [-spec.offset[0], spec.offset[1], spec.offset[2]],
  };
}

// Built imperatively so each child's `parent` is the real index of the bone
// just pushed — the table can't drift out of order.
function buildBones(): readonly BoneSpec[] {
  const list: BoneSpec[] = [];
  const push = (spec: BoneSpec): number => list.push(spec) - 1;

  const pelvis = push(bone("pelvis", -1, 0.12, [0, 0, 0]));
  const spine = push(bone("spine", pelvis, 0.28, [0, 0.12, 0]));
  const chest = push(bone("chest", spine, 0.28, [0, 0.28, 0]));
  const neck = push(bone("neck", chest, 0.1, [0, 0.28, 0]));
  const head = push(bone("head", neck, 0.22, [0, 0.1, 0]));
  // The jaw hangs down-forward off the skull's base; opening it is +pitch.
  push(bone("jaw", head, 0.08, [0, 0.03, 0.03], quatFromAxisAngle([1, 0, 0], Math.atan2(0.9, -0.4))));

  const armChain = (side: "L" | "R"): void => {
    const upper = bone("L_upperArm", chest, 0.3, [0.2, 0.26, 0], HANG);
    const fore = bone("L_forearm", -1, 0.27, [0, 0.3, 0]);
    const hand = bone("L_hand", -1, 0.16, [0, 0.27, 0]);
    const u = push(side === "L" ? upper : mirror(upper, chest));
    const f = push(side === "L" ? { ...fore, parent: u } : mirror(fore, u));
    push(side === "L" ? { ...hand, parent: f } : mirror(hand, f));
  };
  armChain("L");
  armChain("R");

  const legChain = (side: "L" | "R"): void => {
    const thigh = bone("L_thigh", pelvis, 0.44, [0.1, -0.02, 0], HANG);
    const shin = bone("L_shin", -1, 0.42, [0, 0.44, 0]);
    // The foot points forward: rotate +Y (down, in the shin's frame) toward +Z.
    const foot = bone("L_foot", -1, 0.22, [0, 0.42, 0], quatFromAxisAngle([1, 0, 0], Math.atan2(0.98, 0.2)));
    const t = push(side === "L" ? thigh : mirror(thigh, pelvis));
    const s = push(side === "L" ? { ...shin, parent: t } : mirror(shin, t));
    push(side === "L" ? { ...foot, parent: s } : mirror(foot, s));
  };
  legChain("L");
  legChain("R");

  for (let i = 0; i < list.length; i++) {
    if (list[i].parent >= i) throw new Error(`rig: bone ${list[i].name} listed before its parent`);
  }
  return list;
}

export const BONES: readonly BoneSpec[] = buildBones();
export const BONE_COUNT = BONES.length;

export type BoneName =
  | "pelvis" | "spine" | "chest" | "neck" | "head" | "jaw"
  | "L_upperArm" | "L_forearm" | "L_hand" | "R_upperArm" | "R_forearm" | "R_hand"
  | "L_thigh" | "L_shin" | "L_foot" | "R_thigh" | "R_shin" | "R_foot";

/** Bone index by name — `B.head`, `B.L_shin`. The GLSL side gets the same
 *  numbers as `const int B_HEAD`, `B_L_SHIN` via RIG_GLSL. */
export const B: Readonly<Record<BoneName, number>> = Object.fromEntries(
  BONES.map((spec, i) => [spec.name, i]),
) as Record<BoneName, number>;

// ---- Pose ------------------------------------------------------------------

export const CH_ROOT_X = 0;
export const CH_ROOT_Z = 1;
/** Height of the lowest foot above the floor — a hop. Never negative. */
export const CH_LIFT = 2;
const CH_BONES = 3;
export const POSE_LENGTH = CH_BONES + BONE_COUNT * 3;

/** Channel index of a bone's pitch (about X); +1 is yaw (Y), +2 is roll (Z). */
export function boneChannel(boneIndex: number): number {
  return CH_BONES + boneIndex * 3;
}

export type Pose = Float32Array;

export function createPose(): Pose {
  return new Float32Array(POSE_LENGTH);
}

// ---- Quaternion helpers (x, y, z, w) ---------------------------------------

type Q = Float32Array; // 4 floats, scratch-friendly

function qMul(a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number, out: Q, oi: number): void {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  out[oi] = aw * bx + ax * bw + ay * bz - az * by;
  out[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** out = q ⊗ v ⊗ q⁻¹ — rotates v by the unit quaternion at q[qi..]. */
export function quatRotate(q: ArrayLike<number>, qi: number, vx: number, vy: number, vz: number, out: Float32Array, oi: number): void {
  const x = q[qi], y = q[qi + 1], z = q[qi + 2], w = q[qi + 3];
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  // v + w*t + cross(q.xyz, t)
  out[oi] = vx + w * tx + (y * tz - z * ty);
  out[oi + 1] = vy + w * ty + (z * tx - x * tz);
  out[oi + 2] = vz + w * tz + (x * ty - y * tx);
}

/** Yaw · pitch · roll: roll (about Z) is applied to the bone first, then
 *  pitch (X), then yaw (Y) — so a limb spreads, then swings, then twists. */
export function quatFromEuler(pitch: number, yaw: number, roll: number, out: Q, oi: number): void {
  const cx = Math.cos(pitch * 0.5), sx = Math.sin(pitch * 0.5);
  const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5);
  const cz = Math.cos(roll * 0.5), sz = Math.sin(roll * 0.5);
  // qy * qx * qz
  out[oi] = cy * sx * cz + sy * cx * sz;
  out[oi + 1] = sy * cx * cz - cy * sx * sz;
  out[oi + 2] = cy * cx * sz - sy * sx * cz;
  out[oi + 3] = cy * cx * cz + sy * sx * sz;
}

// ---- Forward kinematics -----------------------------------------------------

/** World-space head position (xyz) and rotation (xyzw) per bone. */
export interface RigWorld {
  pos: Float32Array; // BONE_COUNT * 3
  rot: Float32Array; // BONE_COUNT * 4
}

export function createRigWorld(): RigWorld {
  return { pos: new Float32Array(BONE_COUNT * 3), rot: new Float32Array(BONE_COUNT * 4) };
}

const scratchEuler = new Float32Array(4);
const scratchQ = new Float32Array(4);
const scratchV = new Float32Array(3);
const restQ = new Float32Array(BONE_COUNT * 4);
for (let i = 0; i < BONE_COUNT; i++) restQ.set(BONES[i].rest, i * 4);

/** Solves every bone's world transform from a Pose. The root sits at
 *  ROOT_REST_Y until groundToFloor() pins the feet. */
export function forwardKinematics(pose: Pose, out: RigWorld): void {
  for (let b = 0; b < BONE_COUNT; b++) {
    const spec = BONES[b];
    const ch = boneChannel(b);
    quatFromEuler(pose[ch], pose[ch + 1], pose[ch + 2], scratchEuler, 0);
    const p = spec.parent;
    if (p < 0) {
      out.pos[b * 3] = pose[CH_ROOT_X] + spec.offset[0];
      out.pos[b * 3 + 1] = ROOT_REST_Y + spec.offset[1];
      out.pos[b * 3 + 2] = pose[CH_ROOT_Z] + spec.offset[2];
      qMul(scratchEuler, 0, restQ, b * 4, out.rot, b * 4);
    } else {
      quatRotate(out.rot, p * 4, spec.offset[0], spec.offset[1], spec.offset[2], scratchV, 0);
      out.pos[b * 3] = out.pos[p * 3] + scratchV[0];
      out.pos[b * 3 + 1] = out.pos[p * 3 + 1] + scratchV[1];
      out.pos[b * 3 + 2] = out.pos[p * 3 + 2] + scratchV[2];
      qMul(out.rot, p * 4, scratchEuler, 0, scratchQ, 0);
      qMul(scratchQ, 0, restQ, b * 4, out.rot, b * 4);
    }
  }
}

/** World position of a bone's tail (head + length along its local +Y). */
export function boneTail(world: RigWorld, boneIndex: number, out: Float32Array, oi: number): void {
  quatRotate(world.rot, boneIndex * 4, 0, BONES[boneIndex].length, 0, out, oi);
  out[oi] += world.pos[boneIndex * 3];
  out[oi + 1] += world.pos[boneIndex * 3 + 1];
  out[oi + 2] += world.pos[boneIndex * 3 + 2];
}

const FEET = [B.L_foot, B.R_foot];
const scratchTail = new Float32Array(3);

/** Shifts the whole figure vertically so its lowest foot rests on the floor,
 *  plus `lift` — knee bends become real bounce, and feet never sink. */
export function groundToFloor(world: RigWorld, lift: number): void {
  let lowest = Infinity;
  for (const f of FEET) {
    lowest = Math.min(lowest, world.pos[f * 3 + 1]);
    boneTail(world, f, scratchTail, 0);
    lowest = Math.min(lowest, scratchTail[1]);
  }
  const shift = FLOOR_Y + FOOT_RADIUS - lowest + Math.max(0, lift);
  for (let b = 0; b < BONE_COUNT; b++) world.pos[b * 3 + 1] += shift;
}

// ---- Upload packing ---------------------------------------------------------

/** vec4s per bone in uBones: (pos.xyz, length) then the rotation (x,y,z,w). */
export const VEC4_PER_BONE = 2;

export function createBoneBuffer(): Float32Array {
  return new Float32Array(BONE_COUNT * VEC4_PER_BONE * 4);
}

export function packBones(world: RigWorld, out: Float32Array): void {
  for (let b = 0; b < BONE_COUNT; b++) {
    const o = b * VEC4_PER_BONE * 4;
    out[o] = world.pos[b * 3];
    out[o + 1] = world.pos[b * 3 + 1];
    out[o + 2] = world.pos[b * 3 + 2];
    out[o + 3] = BONES[b].length;
    out[o + 4] = world.rot[b * 4];
    out[o + 5] = world.rot[b * 4 + 1];
    out[o + 6] = world.rot[b * 4 + 2];
    out[o + 7] = world.rot[b * 4 + 3];
  }
}

// ---- GLSL side --------------------------------------------------------------

function glslConstName(name: string): string {
  return `B_${name.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`;
}

/** Declarations every skin builds on: the uBones array, one `const int B_*`
 *  per bone (generated from BONES, so the numbers can't drift), and the
 *  bone-space helpers. Spliced into the fragment shader by index.ts. */
export const RIG_GLSL = `
const int BONE_COUNT = ${BONE_COUNT};
uniform vec4 uBones[${BONE_COUNT * VEC4_PER_BONE}];
${BONES.map((spec, i) => `const int ${glslConstName(spec.name)} = ${i};`).join("\n")}

// Rotates v by the conjugate of unit quaternion q (world -> bone frame).
vec3 quatRotInv(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v - q.w * t + cross(q.xyz, t);
}
vec3 boneLocal(int i, vec3 p) {
  return quatRotInv(uBones[i * ${VEC4_PER_BONE} + 1], p - uBones[i * ${VEC4_PER_BONE}].xyz);
}
float boneLen(int i) { return uBones[i * ${VEC4_PER_BONE}].w; }
// Capsule from the bone's head along its local +Y to its tail.
float sdCapsuleY(vec3 q, float len, float r) {
  q.y -= clamp(q.y, 0.0, len);
  return length(q) - r;
}
`;
