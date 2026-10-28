// Prints, per loop, the phase where the head bends furthest from the neck:
// the moment to shoot (bakeframes.mjs) when checking how the neck meets the
// skull. Run from the repo root:
//   node --experimental-strip-types docs/scenes/alien/scripts/nodcheck.ts
import { readFileSync } from "node:fs";
import { decodeClipLibrary, sampleClip } from "../../../../src/render/scenes/dancers/clipFormat.ts";
import { B, createPose, createRigWorld, forwardKinematics } from "../../../../src/render/scenes/dancers/rig.ts";
import { LOOPS } from "../../../../src/render/scenes/alien/reel.ts";

const bin = readFileSync("public/media/dancers/clips-v1.bin");
const lib = decodeClipLibrary(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const pose = createPose();
const world = createRigWorld();
for (let l = 0; l < LOOPS.length; l++) {
  const clip = lib.byName.get(LOOPS[l].clip);
  let best = 0, at = 0;
  for (let i = 0; i < 400; i++) {
    sampleClip(clip, i / 400, pose);
    forwardKinematics(pose, world);
    const h = world.rot.subarray(B.head * 4, B.head * 4 + 4);
    const n = world.rot.subarray(B.neck * 4, B.neck * 4 + 4);
    const d = Math.abs(h[0] * n[0] + h[1] * n[1] + h[2] * n[2] + h[3] * n[3]);
    const deg = (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
    if (deg > best) [best, at] = [deg, i / 400];
  }
  console.log(`loop ${l} ${LOOPS[l].clip}: head bends ${best.toFixed(1)} deg from the neck at phase ${at.toFixed(3)}`);
}
