// Chaikin Curves' seeds, computed on the CPU every frame and handed to the
// shader as a float texture (index.ts uploads it; glsl.ts reads it back
// with texelFetch). Pure, so tests/chaikin.test.ts can check the lattice
// without a GL context.
//
// The lattice. Seeds sit on a jittered grid in (U, θ), U = asinh(r /
// CORE_R) (launch.ts's header says why not plain ln r) — one row per `delta`
// of U, `cols` columns per turn, `delta = 2π / cols` — so away from the core
// a grid cell maps to a square on screen whose size grows with r: cells
// small at the centre, large at the edges, with no per-radius bookkeeping.
// Each row has its own random angular phase, so seeds don't line up into
// spokes. The zoom adds launch.ts's `z` to every seed's U (as a whole number
// of rows, `zRow`, plus `zFrac`); a seed is born at the centre when its U
// passes 0. Rows are addressed by a local index `i` (`zRow` rows behind the
// global one, which is what the hash sees, so a seed keeps its jitter as it
// flies out).
//
// Births. A seed is alive once its U is past launch.ts's front; across
// BIRTH_BAND_ROWS it fades in as a power-diagram weight (`W`, a seed's power
// distance being |p − s|² − W) that starts low enough to crush its cell to
// nothing and rises to 0, so a newborn cell grows out of its neighbours
// instead of popping.
//
// Kicks. A second, independent lattice of "child" seeds, half a row out, is
// alive only where a recent kick stamped it (childAlive): a band of radii,
// CHILD_BAND_LO to CHILD_BAND_HI as they stood when the kick landed, riding
// outward with the zoom since. Each child is gated by its own hash against
// the kick's strength, grows over CHILD_RISE and merges back into its
// neighbours by KICK_LIFE_SEC, by the same weight mechanism as births.
//
// Motion. If the frame carries a `move` (motion.ts: the Swell and Fireflies
// layers), each seed is offset from its lattice place by what it returns, in
// cells, and its weight changed, in cell areas. Both go through a soft cap,
// MAX_SHIFT and MAX_WEIGHT: the shader looks for a pixel's seed only in a few
// rows and columns around the pixel's own (glsl.ts's eachCandidate), so a
// seed that wandered further would be missed. A seed never moves inward past
// INWARD_FLOOR of its own U, so it can't cross the centre.
//
// The texture: TEX_W columns, one per lattice column (the setting's maximum
// Cells must fit), with the row's phase in column PHASE_COL; rows
// 0..MAX_ROWS-1 are cell rows from `rowLo` up, rows MAX_ROWS.. the child
// rows for the same local indices. A texel is (x, y, W, alive) in
// half-heights; alive 0 means no seed.
import { CORE_R, KICK_LIFE_SEC, KICK_SLOTS, ROW_PERIOD, latticeU } from "./launch.ts";

export const TEX_W = 128;
export const PHASE_COL = TEX_W - 1;
export const MAX_ROWS = 64;
export const TEX_H = MAX_ROWS * 2;
/** The first local row filled: a row below it has no seed past U = 0. */
export const ROW_LO = -1;

export const BIRTH_BAND_ROWS = 2;
/** Weight scale at birth, times the squared lattice scale: enough to crush
 *  a newborn's cell against the central cell as well as its neighbours. */
export const BIRTH_KAPPA = 0.25;
export const CHILD_KAPPA = 0.02;
/** The band a kick stamps, r 0.03 to 0.35 half-heights, in U. */
export const CHILD_BAND_LO = latticeU(0.03);
export const CHILD_BAND_HI = latticeU(0.35);
export const CHILD_BAND_SOFT = 0.3;
export const CHILD_RISE = 0.1;
export const CHILD_HOLD = 0.2;

/** Soft caps on a seed's move: cells of offset and cell areas of weight. */
export const MAX_SHIFT = 0.6;
export const MAX_WEIGHT = 0.6;
export const INWARD_FLOOR = 0.5;

/** A seed's move this frame, before the caps: offsets in cells along U and
 *  θ, and a weight change in cell areas. */
export interface SeedMove {
  du: number;
  dth: number;
  dw: number;
}

/** Fills `out` (zeroed by the caller) for the seed at lattice U `u`, angle
 *  `th`, global row `g`, local row `t` (0 = ROW_LO; a child gets its row's
 *  `t`) and column `c`. */
export type MoveSeed = (u: number, th: number, g: number, t: number, c: number, out: SeedMove) => void;

const softCap = (x: number, m: number): number => m * Math.tanh(x / m);

const MASK = ROW_PERIOD - 1;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** The same integer hash as noiseHash.ts's NOISE_HASH_GLSL (`uhash`). */
function uhash(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function cellBits(cx: number, cy: number, seed: number): number {
  return uhash(((cx & MASK) ^ ((cy & MASK) << 16) ^ Math.imul(seed, 0x9e3779b9)) >>> 0);
}

export const unit24 = (bits: number): number => (bits >>> 8) / 16777216;

export interface Kicks {
  /** Zoom distance each slot's kick has ridden since it landed (U). */
  dz: Float32Array;
  age: Float32Array;
  amp: Float32Array;
}

/** How alive a child seed at U `u` is: the strongest live kick whose band
 *  it was in when the kick landed, and whose strength beats its gate. */
export function childAlive(u: number, gate: number, kicks: Kicks): number {
  let a = 0;
  for (let k = 0; k < KICK_SLOTS; k++) {
    const amp = kicks.amp[k];
    if (amp <= 0 || gate >= amp) continue;
    const age = kicks.age[k];
    const env = smoothstep(0, CHILD_RISE, age) * (1 - smoothstep(CHILD_HOLD, KICK_LIFE_SEC, age));
    const u0 = u - kicks.dz[k];
    const band =
      smoothstep(CHILD_BAND_LO - CHILD_BAND_SOFT, CHILD_BAND_LO, u0) *
      (1 - smoothstep(CHILD_BAND_HI, CHILD_BAND_HI + CHILD_BAND_SOFT, u0));
    a = Math.max(a, env * band);
  }
  return a;
}

export interface SeedFrame {
  /** Columns per turn (whole). */
  cols: number;
  jitter: number;
  zRow: number;
  zFrac: number;
  /** launch.ts's front, in U. */
  frontU: number;
  /** Rows to fill from ROW_LO (at most MAX_ROWS). */
  rows: number;
  kicks: Kicks;
  move?: MoveSeed;
}

/** How many rows from ROW_LO cover a screen whose farthest point is `rMax`
 *  half-heights from the centre, with the zoom's fraction and jitter. */
export function rowsFor(rMax: number, cols: number): number {
  const delta = (2 * Math.PI) / cols;
  return Math.min(MAX_ROWS, Math.ceil(latticeU(rMax) / delta) + 3 - ROW_LO);
}

/** Fills `out` (TEX_W × TEX_H × 4 floats) with this frame's seeds. */
export function fillSeeds(out: Float32Array, f: SeedFrame): void {
  out.fill(0);
  const cols = Math.min(Math.round(f.cols), PHASE_COL);
  const delta = (2 * Math.PI) / cols;
  const band = BIRTH_BAND_ROWS * delta;
  let anyKick = false;
  let kickHi = -Infinity;
  for (let k = 0; k < KICK_SLOTS; k++) {
    if (f.kicks.amp[k] <= 0) continue;
    anyKick = true;
    kickHi = Math.max(kickHi, CHILD_BAND_HI + CHILD_BAND_SOFT + f.kicks.dz[k]);
  }
  const rows = Math.min(f.rows, MAX_ROWS);
  for (let t = 0; t < rows; t++) {
    const i = t + ROW_LO;
    const g = (((i - f.zRow) % ROW_PERIOD) + ROW_PERIOD) % ROW_PERIOD;
    fillRow(out, t, t, i, g, 1, 0, cols, delta, band, f, false);
    // Children only where a band can reach and past the front.
    const rowTopU = (i + 2 + f.zFrac) * delta;
    if (anyKick && rowTopU > f.frontU && (i + f.zFrac) * delta < kickHi) {
      fillRow(out, t + MAX_ROWS, t, i, g, 2, 0.5, cols, delta, band, f, true);
    }
  }
}

const move: SeedMove = { du: 0, dth: 0, dw: 0 };

function fillRow(
  out: Float32Array,
  t: number,
  row: number,
  i: number,
  g: number,
  stream: number,
  off: number,
  cols: number,
  delta: number,
  band: number,
  f: SeedFrame,
  child: boolean,
): void {
  const ph = unit24(cellBits(0, g, stream + 101));
  const rowBase = t * TEX_W * 4;
  out[rowBase + PHASE_COL * 4] = ph;
  for (let c = 0; c < cols; c++) {
    const bits = cellBits(c, g, stream);
    const hx = (bits >>> 16) / 65536;
    const hy = (bits & 65535) / 65536;
    const u = (i + off + 0.5 + f.jitter * (hx - 0.5) + f.zFrac) * delta;
    if (u <= 0) continue;
    let a = smoothstep(f.frontU, f.frontU + band, u);
    if (a <= 0) continue;
    let kappa = BIRTH_KAPPA;
    if (child) {
      a *= childAlive(u, unit24(cellBits(c, g, 204)), f.kicks);
      if (a <= 0) continue;
      kappa = CHILD_KAPPA;
    }
    const th = (c + ph + 0.5 + f.jitter * (hy - 0.5)) * delta;
    let um = u;
    let thm = th;
    let dw = 0;
    if (f.move) {
      move.du = 0;
      move.dth = 0;
      move.dw = 0;
      f.move(u, th, g, row, c, move);
      um = Math.max(u + softCap(move.du, MAX_SHIFT) * delta, INWARD_FLOOR * u);
      thm = th + softCap(move.dth, MAX_SHIFT) * delta;
      dw = softCap(move.dw, MAX_WEIGHT) * delta * delta;
    }
    const R = CORE_R * Math.sinh(um);
    const S = CORE_R * Math.cosh(u);
    const o = rowBase + c * 4;
    out[o] = R * Math.cos(thm);
    out[o + 1] = R * Math.sin(thm);
    out[o + 2] = (dw - (1 - a) * kappa) * S * S;
    out[o + 3] = a;
  }
}
