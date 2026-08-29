import { describe, it, expect } from "vitest";
import {
  B,
  BONES,
  BONE_COUNT,
  FLOOR_Y,
  FOOT_RADIUS,
  POSE_LENGTH,
  RIG_GLSL,
  VEC4_PER_BONE,
  boneChannel,
  boneTail,
  createBoneBuffer,
  createPose,
  createRigWorld,
  forwardKinematics,
  groundToFloor,
  packBones,
} from "../src/render/scenes/dancers/rig.ts";

const tail = new Float32Array(3);

function lowestFootPoint(world: ReturnType<typeof createRigWorld>): number {
  let lowest = Infinity;
  for (const f of [B.L_foot, B.R_foot]) {
    lowest = Math.min(lowest, world.pos[f * 3 + 1]);
    boneTail(world, f, tail, 0);
    lowest = Math.min(lowest, tail[1]);
  }
  return lowest;
}

// Deterministic pseudo-random angles so a failure reproduces.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("dancers rig table", () => {
  it("lists every parent before its child and gives every bone a length", () => {
    BONES.forEach((spec, i) => {
      expect(spec.parent).toBeLessThan(i);
      expect(spec.length).toBeGreaterThan(0);
    });
    expect(BONE_COUNT).toBe(BONES.length);
  });

  it("mirrors every L_ bone as an R_ bone across the sagittal plane", () => {
    for (const spec of BONES) {
      if (!spec.name.startsWith("L_")) continue;
      const twin = BONES[B[spec.name.replace(/^L_/, "R_") as keyof typeof B]];
      expect(twin.length).toBe(spec.length);
      expect(twin.offset[0]).toBeCloseTo(-spec.offset[0]);
      expect(twin.offset[1]).toBeCloseTo(spec.offset[1]);
      expect(twin.offset[2]).toBeCloseTo(spec.offset[2]);
    }
  });

  it("emits one GLSL index constant per bone and the packed array's real size", () => {
    expect(RIG_GLSL).toContain(`uniform vec4 uBones[${BONE_COUNT * VEC4_PER_BONE}];`);
    const consts = RIG_GLSL.match(/const int B_[A-Z_]+ = \d+;/g) ?? [];
    expect(consts.length).toBe(BONE_COUNT);
    expect(RIG_GLSL).toContain(`const int B_HEAD = ${B.head};`);
    expect(RIG_GLSL).toContain(`const int B_L_UPPER_ARM = ${B.L_upperArm};`);
  });
});

describe("dancers forward kinematics", () => {
  it("at rest, chains every child's head onto its parent's tail and stands the figure up", () => {
    const world = createRigWorld();
    forwardKinematics(createPose(), world);
    BONES.forEach((spec, i) => {
      if (spec.parent < 0) return;
      // Bones offset from the parent's tail exactly (the spine chain, the limbs' distal joints).
      if (spec.offset[0] === 0 && spec.offset[2] === 0 && spec.offset[1] === BONES[spec.parent].length) {
        boneTail(world, spec.parent, tail, 0);
        expect(world.pos[i * 3]).toBeCloseTo(tail[0], 6);
        expect(world.pos[i * 3 + 1]).toBeCloseTo(tail[1], 6);
        expect(world.pos[i * 3 + 2]).toBeCloseTo(tail[2], 6);
      }
    });
    boneTail(world, B.head, tail, 0);
    const skullTop = tail[1];
    boneTail(world, B.L_foot, tail, 0);
    const toeTip = tail;
    expect(skullTop).toBeGreaterThan(1.8);
    expect(skullTop).toBeLessThan(2.1);
    // Legs hang, feet point forward (+Z), the skull sits above the pelvis.
    expect(toeTip[2]).toBeGreaterThan(0.15);
    expect(world.pos[B.L_hand * 3 + 1]).toBeLessThan(world.pos[B.chest * 3 + 1]);
  });

  it("pins the lowest foot to the floor for any pose, and lifts the whole figure by `lift`", () => {
    const rand = lcg(7);
    const world = createRigWorld();
    const pose = createPose();
    for (let trial = 0; trial < 200; trial++) {
      for (let b = 0; b < BONE_COUNT; b++) {
        const ch = boneChannel(b);
        pose[ch] = (rand() - 0.5) * 2;
        pose[ch + 1] = (rand() - 0.5) * 2;
        pose[ch + 2] = (rand() - 0.5) * 2;
      }
      forwardKinematics(pose, world);
      groundToFloor(world, 0);
      expect(lowestFootPoint(world)).toBeCloseTo(FLOOR_Y + FOOT_RADIUS, 5);
      forwardKinematics(pose, world);
      groundToFloor(world, 0.3);
      expect(lowestFootPoint(world)).toBeCloseTo(FLOOR_Y + FOOT_RADIUS + 0.3, 5);
    }
  });

  it("packs (position, length) and a unit rotation per bone in VEC4_PER_BONE vec4s", () => {
    const world = createRigWorld();
    const pose = createPose();
    pose[boneChannel(B.L_upperArm)] = 0.7;
    pose[boneChannel(B.spine) + 1] = -0.4;
    forwardKinematics(pose, world);
    groundToFloor(world, 0);
    const buf = createBoneBuffer();
    expect(buf.length).toBe(BONE_COUNT * VEC4_PER_BONE * 4);
    packBones(world, buf);
    for (let b = 0; b < BONE_COUNT; b++) {
      const o = b * VEC4_PER_BONE * 4;
      expect(buf[o]).toBe(world.pos[b * 3]);
      expect(buf[o + 1]).toBe(world.pos[b * 3 + 1]);
      expect(buf[o + 2]).toBe(world.pos[b * 3 + 2]);
      expect(buf[o + 3]).toBeCloseTo(BONES[b].length, 6); // float32 round-trip
      const len = Math.hypot(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it("sizes a pose as root x/z + lift + three angles per bone", () => {
    expect(POSE_LENGTH).toBe(3 + BONE_COUNT * 3);
    expect(createPose().length).toBe(POSE_LENGTH);
  });
});
