import { buildAlienMesh } from "../../../../src/render/scenes/alien/mesh.ts";

const t0 = performance.now();
const m = buildAlienMesh();
const t1 = performance.now();
console.log("tris", m.triCount, "ms", (t1 - t0).toFixed(0));
let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
for (let i = 0; i < m.position.length; i += 3) {
  minX = Math.min(minX, m.position[i]); maxX = Math.max(maxX, m.position[i]);
  minY = Math.min(minY, m.position[i + 1]); maxY = Math.max(maxY, m.position[i + 1]);
}
console.log("x", minX.toFixed(3), maxX.toFixed(3), "y", minY.toFixed(3), maxY.toFixed(3));
let bad = 0;
for (let v = 0; v < m.triCount * 3; v++) {
  let s = 0;
  for (let k = 0; k < 4; k++) s += m.weights[v * 4 + k];
  if (s !== 255) bad++;
}
console.log("weight sums off", bad);
// Outward check: normal agrees with the triangle's winding.
let flipped = 0;
for (let t = 0; t < m.triCount; t++) {
  const p = m.position, o = t * 9;
  const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
  const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
  const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const n = m.normal;
  const dot = nx * (n[o] + n[o + 3] + n[o + 6]) + ny * (n[o + 1] + n[o + 4] + n[o + 7]) + nz * (n[o + 2] + n[o + 5] + n[o + 8]);
  if (dot < 0) flipped++;
}
console.log("tris facing against their normals", flipped);
