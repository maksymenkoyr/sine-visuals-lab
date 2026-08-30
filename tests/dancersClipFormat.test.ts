import { describe, it, expect } from "vitest";
import {
  MIRROR_BONE,
  MIRROR_SUFFIX,
  buildLibrary,
  decodeClipLibrary,
  encodeClipLibrary,
  mirrorClip,
  sampleClip,
  type Clip,
} from "../src/render/scenes/dancers/clipFormat.ts";
import {
  B,
  BONE_COUNT,
  CH_LIFT,
  CH_ROOT_X,
  CH_ROOT_Z,
  POSE_LENGTH,
  boneChannel,
  boneTail,
  createPose,
  createRigWorld,
  forwardKinematics,
  setBoneEuler,
} from "../src/render/scenes/dancers/rig.ts";

/** A deterministic clip: every frame a different, valid pose. */
function makeClip(name: string, frames: number): Clip {
  const data = new Float32Array(frames * POSE_LENGTH);
  const pose = createPose();
  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    pose[CH_ROOT_X] = 0.1 * Math.sin(t * 6.28);
    pose[CH_ROOT_Z] = 0.05 * Math.cos(t * 6.28);
    pose[CH_LIFT] = 0.02 * (1 + Math.sin(t * 12.56));
    for (let b = 0; b < BONE_COUNT; b++) setBoneEuler(pose, b, Math.sin(t * 6.28 + b) * 0.8, Math.cos(t * 6.28 + b * 0.3) * 0.5, Math.sin(b) * 0.4);
    data.set(pose, f * POSE_LENGTH);
  }
  return { name, family: "test", beats: 8, nativeBpm: 120, frames, energy: 0.5, bigness: 0.4, mirrorOf: -1, source: "synthetic", data };
}

describe("dancers clip format", () => {
  it("round-trips a library through the binary within quantisation error", () => {
    const clips = [makeClip("a", 32), makeClip("b", 16)];
    const bytes = encodeClipLibrary(clips);
    const lib = decodeClipLibrary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    // Originals come back in order, each followed later by its mirror.
    expect(lib.clips.map((c) => c.name)).toEqual(["a", "b", `a${MIRROR_SUFFIX}`, `b${MIRROR_SUFFIX}`]);
    for (const original of clips) {
      const back = lib.byName.get(original.name)!;
      expect(back.frames).toBe(original.frames);
      expect(back.beats).toBe(original.beats);
      expect(back.nativeBpm).toBe(original.nativeBpm);
      for (let i = 0; i < original.data.length; i++) {
        const tol = i % POSE_LENGTH < 3 ? 0.001 : 1 / 32767 + 1e-6;
        expect(Math.abs(back.data[i] - original.data[i])).toBeLessThanOrEqual(tol);
      }
    }
  });

  it("refuses a library built for a different rig", () => {
    const bytes = encodeClipLibrary([makeClip("a", 4)]);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    view.setUint32(4, BONE_COUNT + 1, true);
    expect(() => decodeClipLibrary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toThrow(/bones/);
    expect(() => decodeClipLibrary(new ArrayBuffer(4))).toThrow(/not a clip library/);
  });

  it("mirrors L/R bones onto each other and is an involution", () => {
    for (let b = 0; b < BONE_COUNT; b++) expect(MIRROR_BONE[MIRROR_BONE[b]]).toBe(b);
    expect(MIRROR_BONE[B.L_hand]).toBe(B.R_hand);
    expect(MIRROR_BONE[B.spine]).toBe(B.spine);
    const clip = makeClip("a", 8);
    const twice = mirrorClip(mirrorClip(clip, 0), 0);
    for (let i = 0; i < clip.data.length; i++) expect(twice.data[i]).toBeCloseTo(clip.data[i], 6);
  });

  it("a mirrored frame puts each hand where the other hand was, reflected in x", () => {
    const clip = makeClip("a", 8);
    const mirrored = mirrorClip(clip, 0);
    const world = createRigWorld();
    const tail = new Float32Array(3);
    const lHand = new Float32Array(3);
    forwardKinematics(clip.data.subarray(3 * POSE_LENGTH, 4 * POSE_LENGTH), world);
    boneTail(world, B.L_hand, tail, 0);
    lHand.set(tail);
    forwardKinematics(mirrored.data.subarray(3 * POSE_LENGTH, 4 * POSE_LENGTH), world);
    boneTail(world, B.R_hand, tail, 0);
    expect(tail[0]).toBeCloseTo(-lHand[0], 4);
    expect(tail[1]).toBeCloseTo(lHand[1], 4);
    expect(tail[2]).toBeCloseTo(lHand[2], 4);
  });

  it("samples between frames and wraps the loop around", () => {
    const clip = makeClip("a", 16);
    const out = createPose();
    sampleClip(clip, 0, out);
    expect([...out]).toEqual([...clip.data.subarray(0, POSE_LENGTH)]);
    sampleClip(clip, 1, out); // exactly one loop later is frame 0 again
    expect([...out]).toEqual([...clip.data.subarray(0, POSE_LENGTH)]);
    sampleClip(clip, -0.25, out); // negative phases wrap too
    const q = createPose();
    sampleClip(clip, 0.75, q);
    expect([...out]).toEqual([...q]);
    // Halfway between the last frame and frame 0.
    sampleClip(clip, 1 - 0.5 / 16, out);
    const last = clip.data.subarray(15 * POSE_LENGTH, 16 * POSE_LENGTH);
    expect(out[CH_ROOT_X]).toBeCloseTo((last[CH_ROOT_X] + clip.data[CH_ROOT_X]) / 2, 6);
    const ch = boneChannel(B.head);
    expect(Math.hypot(out[ch], out[ch + 1], out[ch + 2], out[ch + 3])).toBeCloseTo(1, 5);
  });

  it("rejects duplicate names when building a library", () => {
    expect(() => buildLibrary([makeClip("a", 4), makeClip("a", 4)])).toThrow(/duplicate/);
  });
});
