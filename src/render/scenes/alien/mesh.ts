/**
 * The alien as a triangle mesh: body.ts's distance field, sampled once in
 * the rig's bind pose, turned into triangles, and skinned to the bones whose
 * shapes each vertex came from — so the GPU can pose it every frame from
 * the rig alone (glsl.ts's MESH_VERT) and draw its edges as a wireframe.
 *
 * Steps, per body.ts `PartSet`, each on its own grid (SET_CELLS: the head
 * finer than the body, the hands finer still):
 *   1. Sample the set's distance on a grid. Blocks of BLOCK cells whose
 *      centre sits further from the surface than the block's own reach are
 *      filled with that one reading instead (the field is close to
 *      1-Lipschitz, so no edge in such a block can change sign).
 *   2. Surface nets: one vertex per cell the surface crosses, at the mean of
 *      its crossing points; one quad per grid edge with a sign change,
 *      joining the four cells around it, wound so its normal points out of
 *      the body.
 *   3. Relax: RELAX_ITERS rounds of moving each vertex toward its
 *      neighbours' mean and back onto the surface along the gradient — this
 *      takes the vertices off the grid's lattice so the wireframe reads as a
 *      modelled mesh, not voxels.
 *   4. Split each quad along a hashed diagonal (an irregular triangle
 *      pattern like a scanned model's), and take each vertex's normal from
 *      the field's gradient.
 *   5. Skin: a vertex follows every bone of its set by how close that bone's
 *      own parts are, exp(-(dᵦ − dmin) / SKIN_SOFTNESS), the MAX_INFLUENCES
 *      heaviest kept — so a joint's crease bends with both bones and the
 *      middle of a limb follows one.
 *
 * The result is de-indexed (three vertices per triangle, in order): the
 * fragment shader draws each triangle's own edges from a barycentric
 * derived from gl_VertexID, which only works when no vertex is shared.
 *
 * Pure and DOM/GL-free — tests/alien.test.ts builds it under node. Built
 * once per page (`alienMesh()` caches it): a few hundred milliseconds of
 * sampling is fine on scene entry but not on every one.
 */
import { BONE_COUNT, createPose, createRigWorld, forwardKinematics, tPose, type RigWorld } from "../dancers/rig.ts";
import { PARTS, compileSet, setBounds, type CompiledSet, type PartSet } from "./body.ts";

/** Grid cell per set, in metres — about the triangle edge the wire draws there. */
export const SET_CELLS: Readonly<Record<PartSet, number>> = {
  body: 0.024,
  head: 0.014,
  handL: 0.0063,
  handR: 0.0063,
};
/** Cells per side of a culling block. */
const BLOCK = 6;
/** How much further than its half-diagonal a block centre must be from the
 *  surface before the block is skipped — slack for the field not being
 *  exactly 1-Lipschitz (the tapered cones, the smooth blends). */
const CULL_SLACK = 1.35;
const RELAX_ITERS = 3;
const RELAX_STEP = 0.5;
/** Metres over which a vertex's weight falls off from its nearest bone. */
export const SKIN_SOFTNESS = 0.018;
export const MAX_INFLUENCES = 4;
/** Weights below this share of the heaviest are dropped before normalising. */
const MIN_WEIGHT_SHARE = 0.02;

export interface AlienMesh {
  triCount: number;
  /** 9 floats per triangle: three bind-pose vertices. */
  position: Float32Array;
  /** 9 floats per triangle: unit normals. */
  normal: Float32Array;
  /** 12 bytes per triangle: MAX_INFLUENCES bone indices per vertex. */
  bones: Uint8Array;
  /** 12 bytes per triangle: matching weights, summing to 255 per vertex. */
  weights: Uint8Array;
  /** The bind pose the mesh was built in: what skinning measures from. */
  bind: RigWorld;
}

type Sdf = (x: number, y: number, z: number) => number;

interface Nets {
  /** xyz per vertex. */
  verts: number[];
  /** Four vertex indices per quad, wound outward. */
  quads: number[];
  /** A hash per quad, for picking its split diagonal. */
  quadHash: number[];
}

function hash3(i: number, j: number, k: number): number {
  let h = (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Steps 1–2 for one set: sample, then surface nets. */
function surfaceNets(sd: Sdf, min: readonly number[], max: readonly number[], h: number): Nets {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const at = (i: number, j: number, k: number): number => i + nx * (j + ny * k);
  const d = new Float32Array(nx * ny * nz).fill(NaN);

  for (let k0 = 0; k0 < nz - 1; k0 += BLOCK) {
    const k1 = Math.min(k0 + BLOCK, nz - 1);
    for (let j0 = 0; j0 < ny - 1; j0 += BLOCK) {
      const j1 = Math.min(j0 + BLOCK, ny - 1);
      for (let i0 = 0; i0 < nx - 1; i0 += BLOCK) {
        const i1 = Math.min(i0 + BLOCK, nx - 1);
        const centre = sd(min[0] + ((i0 + i1) / 2) * h, min[1] + ((j0 + j1) / 2) * h, min[2] + ((k0 + k1) / 2) * h);
        const reach = 0.5 * h * Math.hypot(i1 - i0, j1 - j0, k1 - k0);
        const skip = Math.abs(centre) > reach * CULL_SLACK + h;
        for (let k = k0; k <= k1; k++) {
          for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
              const idx = at(i, j, k);
              // A skipped block only fills corners nothing has measured; a
              // measured corner on a shared face keeps its exact value.
              if (skip) {
                if (Number.isNaN(d[idx])) d[idx] = centre;
              } else {
                d[idx] = sd(min[0] + i * h, min[1] + j * h, min[2] + k * h);
              }
            }
          }
        }
      }
    }
  }

  // One vertex per crossed cell.
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const cellAt = (i: number, j: number, k: number): number => i + cx * (j + cy * k);
  const verts: number[] = [];
  const corner = new Float32Array(8);
  // Cube edges as corner-index pairs; corner c is (c&1, c>>1&1, c>>2&1).
  const EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = d[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (let e = 0; e < 24; e += 2) {
          const a = EDGES[e], b = EDGES[e + 1];
          const da = corner[a], db = corner[b];
          if (da < 0 === db < 0) continue;
          const t = da / (da - db);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          n++;
        }
        cellVert[cellAt(i, j, k)] = verts.length / 3;
        verts.push(min[0] + (i + sx / n) * h, min[1] + (j + sy / n) * h, min[2] + (k + sz / n) * h);
      }
    }
  }

  // One quad per sign-changing grid edge whose four cells all exist.
  const quads: number[] = [];
  const quadHash: number[] = [];
  const pushQuad = (q: number[], insideLow: boolean, axis: number, i: number, j: number, k: number): void => {
    if (q.some((v) => v < 0)) return;
    // Wind it so the normal points from the inside end of the edge to the outside end.
    const ax = verts[q[2] * 3] - verts[q[0] * 3], ay = verts[q[2] * 3 + 1] - verts[q[0] * 3 + 1], az = verts[q[2] * 3 + 2] - verts[q[0] * 3 + 2];
    const bx = verts[q[3] * 3] - verts[q[1] * 3], by = verts[q[3] * 3 + 1] - verts[q[1] * 3 + 1], bz = verts[q[3] * 3 + 2] - verts[q[1] * 3 + 2];
    const nAxis = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx][axis];
    if (nAxis > 0 !== insideLow) q.reverse();
    quads.push(q[0], q[1], q[2], q[3]);
    quadHash.push(hash3(i * 3 + axis, j, k));
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const d0 = d[at(i, j, k)];
        // +X edge: cells (i, j-1..j, k-1..k).
        if (i < cx && j > 0 && k > 0 && j < cy && k < cz && d0 < 0 !== d[at(i + 1, j, k)] < 0) {
          pushQuad([cellVert[cellAt(i, j - 1, k - 1)], cellVert[cellAt(i, j, k - 1)], cellVert[cellAt(i, j, k)], cellVert[cellAt(i, j - 1, k)]], d0 < 0, 0, i, j, k);
        }
        // +Y edge: cells (i-1..i, j, k-1..k).
        if (j < cy && i > 0 && k > 0 && i < cx && k < cz && d0 < 0 !== d[at(i, j + 1, k)] < 0) {
          pushQuad([cellVert[cellAt(i - 1, j, k - 1)], cellVert[cellAt(i, j, k - 1)], cellVert[cellAt(i, j, k)], cellVert[cellAt(i - 1, j, k)]], d0 < 0, 1, i, j, k);
        }
        // +Z edge: cells (i-1..i, j-1..j, k).
        if (k < cz && i > 0 && j > 0 && i < cx && j < cy && d0 < 0 !== d[at(i, j, k + 1)] < 0) {
          pushQuad([cellVert[cellAt(i - 1, j - 1, k)], cellVert[cellAt(i, j - 1, k)], cellVert[cellAt(i, j, k)], cellVert[cellAt(i - 1, j, k)]], d0 < 0, 2, i, j, k);
        }
      }
    }
  }
  return { verts, quads, quadHash };
}

function gradient(sd: Sdf, x: number, y: number, z: number, eps: number, out: number[]): void {
  out[0] = sd(x + eps, y, z) - sd(x - eps, y, z);
  out[1] = sd(x, y + eps, z) - sd(x, y - eps, z);
  out[2] = sd(x, y, z + eps) - sd(x, y, z - eps);
}

/** Step 3: tangential smoothing, each round projected back onto the surface. */
function relax(nets: Nets, sd: Sdf, h: number): void {
  const n = nets.verts.length / 3;
  const nbrs: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let q = 0; q < nets.quads.length; q += 4) {
    for (let e = 0; e < 4; e++) {
      const a = nets.quads[q + e], b = nets.quads[q + ((e + 1) & 3)];
      nbrs[a].add(b);
      nbrs[b].add(a);
    }
  }
  const v = nets.verts;
  const next = new Float64Array(v.length);
  const g = [0, 0, 0];
  for (let it = 0; it < RELAX_ITERS; it++) {
    for (let i = 0; i < n; i++) {
      let mx = 0, my = 0, mz = 0;
      for (const j of nbrs[i]) {
        mx += v[j * 3];
        my += v[j * 3 + 1];
        mz += v[j * 3 + 2];
      }
      const c = nbrs[i].size || 1;
      let x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
      if (nbrs[i].size) {
        x += (mx / c - x) * RELAX_STEP;
        y += (my / c - y) * RELAX_STEP;
        z += (mz / c - z) * RELAX_STEP;
      }
      // Newton step back onto the zero set.
      const dist = sd(x, y, z);
      gradient(sd, x, y, z, h * 0.25, g);
      const gl2 = (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) / (h * h * 0.25);
      if (gl2 > 1e-9) {
        const s = dist / gl2 / (h * 0.5);
        x -= g[0] * s;
        y -= g[1] * s;
        z -= g[2] * s;
      }
      next[i * 3] = x;
      next[i * 3 + 1] = y;
      next[i * 3 + 2] = z;
    }
    for (let i = 0; i < v.length; i++) v[i] = next[i];
  }
}

/** Step 5 for one vertex: up to MAX_INFLUENCES (bone, byte weight) pairs. */
function skinWeights(set: CompiledSet, x: number, y: number, z: number, bones: Uint8Array, weights: Uint8Array, o: number): void {
  const byBone = new Map<number, number>();
  // Past this margin a bone's weight is under MIN_WEIGHT_SHARE of the nearest's.
  set.near(x, y, z, -Math.log(MIN_WEIGHT_SHARE) * SKIN_SOFTNESS, (part, pd) => {
    const prev = byBone.get(part.bone);
    if (prev === undefined || pd < prev) byBone.set(part.bone, pd);
  });
  let dmin = Infinity;
  for (const pd of byBone.values()) dmin = Math.min(dmin, pd);
  const ranked = [...byBone.entries()]
    .map(([bone, pd]) => ({ bone, w: Math.exp(-(pd - dmin) / SKIN_SOFTNESS) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, MAX_INFLUENCES)
    .filter((e, _i, all) => e.w >= all[0].w * MIN_WEIGHT_SHARE);
  const total = ranked.reduce((s, e) => s + e.w, 0);
  let left = 255;
  for (let i = 0; i < MAX_INFLUENCES; i++) {
    const e = ranked[i];
    bones[o + i] = e ? e.bone : 0;
    const w = !e ? 0 : i === ranked.length - 1 ? left : Math.round((e.w / total) * 255);
    weights[o + i] = w;
    left -= w;
  }
}

/** The bind pose: rig.ts's T-pose, solved, root at its rest height. */
export function bindPose(): RigWorld {
  const world = createRigWorld();
  forwardKinematics(tPose(createPose()), world);
  return world;
}

export function buildAlienMesh(): AlienMesh {
  const bind = bindPose();
  const built: { compiled: CompiledSet; nets: Nets; sd: Sdf }[] = [];
  for (const set of Object.keys(SET_CELLS) as PartSet[]) {
    const cell = SET_CELLS[set];
    const parts = PARTS.filter((p) => p.set === set);
    const compiled = compileSet(parts, bind);
    const sd: Sdf = (x, y, z) => compiled.sd(x, y, z);
    const box = setBounds(parts, bind, cell * 2);
    const nets = surfaceNets(sd, box.min, box.max, cell);
    relax(nets, sd, cell);
    built.push({ compiled, nets, sd });
  }

  const triCount = built.reduce((s, b) => s + (b.nets.quads.length / 4) * 2, 0);
  const position = new Float32Array(triCount * 9);
  const normal = new Float32Array(triCount * 9);
  const bones = new Uint8Array(triCount * 12);
  const weights = new Uint8Array(triCount * 12);
  const g = [0, 0, 0];
  let t = 0;
  for (const { compiled, nets, sd } of built) {
    const nv = nets.verts.length / 3;
    const vn = new Float32Array(nv * 3);
    const vb = new Uint8Array(nv * MAX_INFLUENCES);
    const vw = new Uint8Array(nv * MAX_INFLUENCES);
    for (let i = 0; i < nv; i++) {
      const x = nets.verts[i * 3], y = nets.verts[i * 3 + 1], z = nets.verts[i * 3 + 2];
      gradient(sd, x, y, z, 0.002, g);
      const len = Math.hypot(g[0], g[1], g[2]) || 1;
      vn[i * 3] = g[0] / len;
      vn[i * 3 + 1] = g[1] / len;
      vn[i * 3 + 2] = g[2] / len;
      skinWeights(compiled, x, y, z, vb, vw, i * MAX_INFLUENCES);
    }
    const emit = (a: number, b: number, c: number): void => {
      for (const v of [a, b, c]) {
        position.set(nets.verts.slice(v * 3, v * 3 + 3), t * 3);
        normal.set(vn.subarray(v * 3, v * 3 + 3), t * 3);
        bones.set(vb.subarray(v * MAX_INFLUENCES, v * MAX_INFLUENCES + MAX_INFLUENCES), t * 4);
        weights.set(vw.subarray(v * MAX_INFLUENCES, v * MAX_INFLUENCES + MAX_INFLUENCES), t * 4);
        t++;
      }
    };
    for (let q = 0; q < nets.quads.length; q += 4) {
      const [a, b, c, d] = nets.quads.slice(q, q + 4);
      if (nets.quadHash[q / 4] & 1) {
        emit(a, b, c);
        emit(a, c, d);
      } else {
        emit(a, b, d);
        emit(b, c, d);
      }
    }
  }
  if (BONE_COUNT > 255) throw new Error("alien mesh: bone indices no longer fit a byte");
  return { triCount, position, normal, bones, weights, bind };
}

let cached: AlienMesh | null = null;

/** The one mesh every alien scene instance draws — built on first use. */
export function alienMesh(): AlienMesh {
  if (!cached) cached = buildAlienMesh();
  return cached;
}
