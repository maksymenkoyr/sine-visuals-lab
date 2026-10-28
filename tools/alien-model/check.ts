// Reads tools/.cache/alien-model/alien.bin (the ALM1 mesh build.py writes; its
// layout is in build.py's header) and prints it beside today's mesh from
// mesh.ts: counts, file size, bounding box, then the checks the scene relies
// on. Every weight sums to 255, every bone index is a rig bone, and every
// eye flag is 0 or 127, or it exits 1. Triangles that face against their vertex normals, and slivers, are
// counted: both draw as dark specks in the wire.
//
//   node --experimental-strip-types tools/alien-model/check.ts
import { readFileSync } from "node:fs";
import { buildAlienMesh } from "../../src/render/scenes/alien/mesh.ts";
import { BONE_COUNT } from "../../src/render/scenes/dancers/rig.ts";

const PATH = "tools/.cache/alien-model/alien.bin";
// A triangle whose smallest angle is under this many degrees is a sliver.
const SLIVER_DEG = 4;

const buf = readFileSync(PATH);
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
if (buf.toString("latin1", 0, 4) !== "ALM1") throw new Error(`${PATH}: not an ALM1 mesh`);
const nv = view.getUint32(4, true);
const nt = view.getUint32(8, true);
let off = 12;
const take = <T>(make: (o: number) => T, bytes: number): T => {
  const out = make(off);
  off += bytes;
  return out;
};
const position = take((o) => new Float32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 12)), nv * 12);
const normal = take((o) => new Int8Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 4)), nv * 4);
const bones = take((o) => new Uint8Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 4)), nv * 4);
const weights = take((o) => new Uint8Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 4)), nv * 4);
const squeeze = take((o) => new Float32Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nv * 12)), nv * 12);
take(() => null, nv * 4);
const index = take((o) => new Uint16Array(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + nt * 6)), nt * 6);
if (off !== buf.byteLength) throw new Error(`${PATH}: ${buf.byteLength} bytes, the layout reads ${off}`);

function bounds(p: Float32Array): string {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[i + k]);
      hi[k] = Math.max(hi[k], p[i + k]);
    }
  }
  return ["x", "y", "z"].map((a, k) => `${a} ${lo[k].toFixed(3)}..${hi[k].toFixed(3)}`).join("  ");
}

const today = buildAlienMesh();
console.log(`new    ${nv} vertices, ${nt} triangles, ${buf.byteLength} bytes`);
console.log(`today  ${today.triCount * 3} vertices (de-indexed), ${today.triCount} triangles`);
console.log(`new    ${bounds(position)}`);
console.log(`today  ${bounds(today.position)}`);

let badSums = 0;
let badBones = 0;
for (let v = 0; v < nv; v++) {
  let s = 0;
  for (let k = 0; k < 4; k++) {
    s += weights[v * 4 + k];
    if (weights[v * 4 + k] > 0 && bones[v * 4 + k] >= BONE_COUNT) badBones++;
  }
  if (s !== 255) badSums++;
}
console.log(`weight sums off 255: ${badSums}; bone indices past BONE_COUNT ${BONE_COUNT}: ${badBones}`);

let eyes = 0;
let badFlags = 0;
for (let v = 0; v < nv; v++) {
  const flag = normal[v * 4 + 3];
  if (flag === 127) eyes++;
  else if (flag !== 0) badFlags++;
}
console.log(`eyes: ${eyes} vertices; eye flags not 0 or 127: ${badFlags}`);

let most = 0;
let moved = 0;
for (let v = 0; v < nv; v++) {
  const d = Math.hypot(squeeze[v * 3], squeeze[v * 3 + 1], squeeze[v * 3 + 2]);
  most = Math.max(most, d);
  if (d > 0) moved++;
}
console.log(`squeeze: ${moved} vertices move, the most ${(most * 100).toFixed(1)} cm`);

let against = 0;
let slivers = 0;
const minCos = Math.cos((SLIVER_DEG * Math.PI) / 180);
const p = (i: number, k: number): number => position[index[i] * 3 + k];
for (let t = 0; t < nt; t++) {
  const a = t * 3;
  const e1 = [p(a + 1, 0) - p(a, 0), p(a + 1, 1) - p(a, 1), p(a + 1, 2) - p(a, 2)];
  const e2 = [p(a + 2, 0) - p(a, 0), p(a + 2, 1) - p(a, 1), p(a + 2, 2) - p(a, 2)];
  const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  let dot = 0;
  for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) dot += fn[k] * normal[index[a + c] * 4 + k];
  if (dot < 0) against++;
  for (let c = 0; c < 3; c++) {
    const o = a + c;
    const u = [0, 1, 2].map((k) => p(a + ((c + 1) % 3), k) - p(o, k));
    const w = [0, 1, 2].map((k) => p(a + ((c + 2) % 3), k) - p(o, k));
    const cos = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(...u) * Math.hypot(...w) || 1);
    if (cos > minCos) {
      slivers++;
      break;
    }
  }
}
console.log(`triangles facing against their normals: ${against}; slivers under ${SLIVER_DEG} deg: ${slivers}`);
if (badSums || badBones || badFlags) process.exit(1);
