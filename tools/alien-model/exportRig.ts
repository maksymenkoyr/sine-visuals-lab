// Writes the dancers' rig, solved in the alien's bind pose, to
// tools/.cache/alien-model/rig.json: the skeleton tools/alien-model/build.py
// builds its Blender armature from, so the model it exports skins to the same
// bones the captured clips drive. Rig metres and axes: +Y up, the figure
// faces +Z. Per bone, in BONES order: name, parent index, head, tail and
// world rotation (x, y, z, w).
//
// It is mesh.ts's bindPose(), ungrounded: skinning measures from that exact
// pose, and groundToFloor() re-pins the feet every frame anyway.
//
//   node --experimental-strip-types tools/alien-model/exportRig.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { bindPose } from "../../src/render/scenes/alien/mesh.ts";
import { B, BONE_COUNT, BONES, FLOOR_Y, FOOT_RADIUS, boneTail } from "../../src/render/scenes/dancers/rig.ts";

const OUT_DIR = "tools/.cache/alien-model";

const world = bindPose();
const tail = new Float32Array(3);
const round = (v: number): number => Math.round(v * 1e6) / 1e6;
const bones = BONES.map((spec, i) => {
  boneTail(world, i, tail, 0);
  return {
    name: spec.name,
    parent: spec.parent,
    head: Array.from(world.pos.subarray(i * 3, i * 3 + 3), round),
    tail: Array.from(tail, round),
    rot: Array.from(world.rot.subarray(i * 4, i * 4 + 4), round),
  };
});

if (bones.length !== BONE_COUNT) throw new Error(`rig.json: ${bones.length} bones, BONE_COUNT is ${BONE_COUNT}`);
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/rig.json`, `${JSON.stringify({ floorY: FLOOR_Y, footRadius: FOOT_RADIUS, bones }, null, 1)}\n`);

// groundToFloor()'s rule: the lowest foot head or tail sits FOOT_RADIUS above the floor.
const lowest = Math.min(...[B.L_foot, B.R_foot].flatMap((f) => [bones[f].head[1], bones[f].tail[1]]));
console.log(`${bones.length} bones (BONE_COUNT ${BONE_COUNT}) -> ${OUT_DIR}/rig.json`);
console.log(`lowest foot point y ${lowest.toFixed(4)}; less FOOT_RADIUS ${(lowest - FOOT_RADIUS).toFixed(4)} m from FLOOR_Y ${FLOOR_Y}`);
