import { readFileSync } from "node:fs";
const W = new URL("../../../../src/render/scenes/dancers/", import.meta.url).pathname;
const { decodeClipLibrary, sampleClip } = await import(W + "clipFormat.ts");
const rig = await import(W + "rig.ts");

const bin = readFileSync(W + "clips.bin");
const lib = decodeClipLibrary(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const pose = rig.createPose();
const world = rig.createRigWorld();
const tail = new Float32Array(3);
for (const name of process.argv.slice(2)) {
  const clip = lib.byName.get(name);
  if (!clip) { console.log("no clip", name); continue; }
  let rx = [Infinity, -Infinity], rz = [Infinity, -Infinity], y = [Infinity, -Infinity], x = [Infinity, -Infinity], z = [Infinity, -Infinity];
  let headY = [Infinity, -Infinity];
  let seam = 0;
  for (let f = 0; f < clip.frames; f++) {
    sampleClip(clip, f / clip.frames, pose);
    rig.forwardKinematics(pose, world);
    rig.groundToFloor(world, pose[rig.CH_LIFT]);
    rx = [Math.min(rx[0], pose[0]), Math.max(rx[1], pose[0])];
    rz = [Math.min(rz[0], pose[1]), Math.max(rz[1], pose[1])];
    for (let b = 0; b < rig.BONE_COUNT; b++) {
      rig.boneTail(world, b, tail, 0);
      for (const p of [[world.pos[b * 3], world.pos[b * 3 + 1], world.pos[b * 3 + 2]], tail]) {
        x = [Math.min(x[0], p[0]), Math.max(x[1], p[0])];
        y = [Math.min(y[0], p[1]), Math.max(y[1], p[1])];
        z = [Math.min(z[0], p[2]), Math.max(z[1], p[2])];
      }
    }
    headY = [Math.min(headY[0], world.pos[rig.B.head * 3 + 1]), Math.max(headY[1], world.pos[rig.B.head * 3 + 1])];
  }
  const f = (a: number[]) => a.map((v) => v.toFixed(2)).join("..");
  console.log(name, "root x", f(rx), "z", f(rz), "| bones x", f(x), "y", f(y), "z", f(z), "| head base y", f(headY), "| fps", (clip.frames / (clip.beats * 60 / clip.nativeBpm)).toFixed(1), "sec", (clip.beats * 60 / clip.nativeBpm).toFixed(2));
}
