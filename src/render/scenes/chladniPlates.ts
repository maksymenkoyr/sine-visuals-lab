import { DECAGON_MODES, HEXAGON_MODES, TRIANGLE_DUAL, TRIANGLE_MODES, type SeriesPlateMode } from "./chladniPlateModes.ts";

// Chladni's plates: the shapes the Plate setting picks, each with its own
// table of figures, and the bake that turns a non-square table into the
// texture atlas chladni.ts's shaders read. Pure, no GL.
//
// The shapes, in plate space [-1,1]^2 (y up):
// - Square: today's free square, cos(n pi x) cos(m pi y) +- the swapped pair.
//   Analytic in the shader, never baked; its table (buildModeTable) is the one
//   the scene always had.
// - Round: a true free round plate (Kirchhoff), disc of radius 1. A mode is
//   W(r) cos(n theta) with W = J_n(k r) + C I_n(k r); a free edge carries no
//   bending moment and no shear, two conditions on C, and k is where they
//   agree (freeEdgeDeterminant). Poisson's ratio ROUND_POISSON. The rigid
//   moves (lift and tilt, k = 0) are skipped.
// - Hexagon, Decagon (flat top and bottom, circumradius 1) and Triangle
//   (equilateral, apex up, bounding box centred): free-edge membranes, the
//   usual stand-in where no free-plate solution exists: laplacian(f) = -k^2 f
//   with zero slope across every edge. Solved offline by
//   tools/chladni-plate-modes.py into chladniPlateModes.ts (that tool's header
//   has the maths and its checks); the triangle's are exact (Lame's plane
//   waves), the other two are series checked to a small edge residual.
// - Clamped: the square with its edges held. Strictly the hinged (simply
//   supported) plate, whose modes are exact: sin(n pi (x+1)/2) sin(m pi
//   (y+1)/2) +- the swapped pair, zero all along the rim. A truly clamped
//   plate's modes have no closed form; these are its look (sand gathers on the
//   held rim too). Odd orders only, see clampedTable.
// Every non-square shape keeps its true shape on screen (chladni.ts's
// plateHalf). Every figure kept is even about the vertical (of a degenerate
// pair, the even member; odd modes are left out), so the blend of figures
// the plate shows is always mirror-symmetric, as the square's always is.
//
// A table row (PlateMode) is one figure: its frequency as a ratio (k^2, as
// for a plate), `cells` for the sim's step cap (nodal cells across the plate,
// as the square's m), and for a baked shape the atlas layer it lives in.
// Every table is on the square's scale: ratio = (k / K_FUNDAMENTAL)^2
// (plateRatio), K_FUNDAMENTAL being the square's (1, 2), so the ratios feed
// createPlateResponse exactly as the square's (n^2 + m^2) / FUNDAMENTAL_ORDER
// do, and the same ratio means the same line spacing on every plate (every
// outline spans the same 2 plate units, plateOutline). Each table covers the
// square's own range, PLATE_RATIO_MIN up to its top pair (K_TOP), and keeps
// PLATE_FIGURES figures spread evenly over it (spreadPick), so Pattern
// complexity reaches equally fine figures on every plate.
//
// The bake (bakePlate): every mode of a shape evaluated at the texel centres
// of an ATLAS_SIDE square grid over plate space, R = f, G,B = df/dx, df/dy,
// each scaled so its peak |f| inside the shape is 2, like one square mode, so
// the drive, the lift knee and the grain colour behave the same on every
// plate. Texels outside the shape hold its continuation, so the bilinear
// filter is right up to the edge: the round plate's own analytic formula, the
// hexagon's and decagon's mirror image across the nearest edge (exactly how a
// free edge continues; the triangle's plane waves already do so). Every
// figure is even about the vertical, so only the right half is evaluated and
// mirrored.

/** The Plate setting's options, in value order. */
export const PLATE_SHAPES = ["Square", "Round", "Hexagon", "Triangle", "Decagon", "Clamped"] as const;
export const SQUARE = 0;
export const ROUND = 1;
export const HEXAGON = 2;
export const TRIANGLE = 3;
export const DECAGON = 4;
export const CLAMPED = 5;

/** One plate mode (a figure). */
export interface PlateMode {
  /** Square and Clamped: the (n, m) orders and the symmetry-family sign. 0
   *  for the other shapes. */
  n: number;
  m: number;
  sign: 1 | -1;
  /** Resonant frequency as a multiple of the shape's lowest mode. */
  ratio: number;
  /** Nodal cells across the plate, for the sim's step cap. */
  cells: number;
  /** Atlas layer of a baked shape; -1 for the square's analytic modes. */
  layer: number;
  /** A few words on the figure. */
  desc: string;
}

/** Highest mode order the square table reaches. (8, 9) is already a fine
 *  lattice at TV distance; past that the nodal cells fall below grain size. */
export const MAX_ORDER = 9;
/** n^2 + m^2 of the square's fundamental (1, 2) mode. */
export const FUNDAMENTAL_ORDER = 5;

/** The square: every (n, m) with 1 <= n < m <= maxOrder, ascending by
 *  n^2 + m^2 (its eigenfrequency proxy), signs alternating so neighbouring
 *  resonances come from both symmetry families. n == m is excluded (chladni.ts
 *  header). */
export function buildModeTable(maxOrder: number = MAX_ORDER): PlateMode[] {
  const pairs: { n: number; m: number }[] = [];
  for (let n = 1; n < maxOrder; n++) {
    for (let m = n + 1; m <= maxOrder; m++) pairs.push({ n, m });
  }
  pairs.sort((a, b) => a.n * a.n + a.m * a.m - (b.n * b.n + b.m * b.m) || a.n - b.n);
  return pairs.map((p, i) => ({
    n: p.n,
    m: p.m,
    sign: i % 2 === 0 ? -1 : 1,
    ratio: (p.n * p.n + p.m * p.m) / FUNDAMENTAL_ORDER,
    cells: p.m,
    layer: -1,
    desc: `(${p.n}, ${p.m})`,
  }));
}

export const MODE_TABLE: readonly PlateMode[] = buildModeTable();

/** Wave numbers of the square's (1, 2) mode and of its top pair
 *  (MAX_ORDER - 1, MAX_ORDER), in plate units: a square mode's k is
 *  pi sqrt(n^2 + m^2). Every table is on this scale (see the header). */
export const K_FUNDAMENTAL = Math.PI * Math.sqrt(FUNDAMENTAL_ORDER);
export const K_TOP = Math.PI * Math.hypot(MAX_ORDER - 1, MAX_ORDER);
/** A non-square table's lowest ratio: a little under the square's (1, 2), so
 *  a plate whose nearest figure sits just below it still has one there. */
export const PLATE_RATIO_MIN = 0.8;
/** Figures a non-square table keeps, as many as the square has. */
export const PLATE_FIGURES = MODE_TABLE.length;

/** A figure's frequency ratio on the square's scale, from its wave number. */
export function plateRatio(k: number): number {
  return (k / K_FUNDAMENTAL) ** 2;
}

/** Does a figure of wave number k lie on the square's range? */
function onSquareRange(k: number): boolean {
  return plateRatio(k) >= PLATE_RATIO_MIN && k <= K_TOP * (1 + 1e-9);
}

/** `count` of `rows` (sorted by frequency), evenly spaced by index. By Weyl's
 *  law a plate's figures come about evenly spaced in k^2, so this spreads
 *  them about evenly over the ratio range, as the square's are. Mirrors
 *  spread() in tools/chladni-plate-modes.py. */
export function spreadPick<T>(rows: readonly T[], count: number): T[] {
  if (rows.length <= count) return rows.slice();
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(rows[Math.floor((i * (rows.length - 1)) / (count - 1) + 0.5)]);
  return out;
}

/** Texels a side of a baked shape's atlas. Bilinear error on the finest
 *  figure is a small fraction of a pixel at 1080p (tests/chladniPlates.test.ts). */
export const ATLAS_SIDE = 256;

// ---- Outlines -------------------------------------------------------------

/** A shape's outline in plate space: a regular polygon (centre, apothem,
 *  sides, `turn` = angle of the first edge's outward normal, measured from +y
 *  toward +x) or, with sides 0, a circle of radius `apothem`. The square and
 *  Clamped are sides 4: exactly [-1,1]^2. */
export interface PlateOutline {
  sides: number;
  cx: number;
  cy: number;
  apothem: number;
  turn: number;
}

const SQ3 = Math.sqrt(3);

const OUTLINES: readonly PlateOutline[] = PLATE_SHAPES.map((_, shape): PlateOutline => {
  switch (shape) {
    case ROUND:
      return { sides: 0, cx: 0, cy: 0, apothem: 1, turn: 0 };
    case HEXAGON:
      return { sides: 6, cx: 0, cy: 0, apothem: Math.cos(Math.PI / 6), turn: 0 };
    case DECAGON:
      return { sides: 10, cx: 0, cy: 0, apothem: Math.cos(Math.PI / 10), turn: 0 };
    case TRIANGLE:
      // Side 2, apex up; the bounding box (height sqrt 3) centred.
      return { sides: 3, cx: 0, cy: -1 / (2 * SQ3), apothem: 1 / SQ3, turn: Math.PI };
    default:
      return { sides: 4, cx: 0, cy: 0, apothem: 1, turn: 0 };
  }
});

export function plateOutline(shape: number): PlateOutline {
  return OUTLINES[shape] ?? OUTLINES[SQUARE];
}

const normalsCache = new WeakMap<PlateOutline, Float64Array>();
/** A polygon's edge normals, x and y interleaved. */
function edgeNormals(o: PlateOutline): Float64Array {
  let n = normalsCache.get(o);
  if (!n) {
    n = new Float64Array(2 * o.sides);
    for (let i = 0; i < o.sides; i++) {
      const a = o.turn + (2 * Math.PI * i) / o.sides;
      n[2 * i] = Math.sin(a);
      n[2 * i + 1] = Math.cos(a);
    }
    normalsCache.set(o, n);
  }
  return n;
}

/** <= 1 inside the outline, 1 on it (a polygon's or circle's gauge). Mirrors
 *  plateGauge in chladni.ts's CHLADNI_GLSL. */
export function plateGauge(o: PlateOutline, x: number, y: number): number {
  if (o.sides === 4) return Math.max(Math.abs(x), Math.abs(y));
  const qx = x - o.cx;
  const qy = y - o.cy;
  if (o.sides === 0) return Math.hypot(qx, qy) / o.apothem;
  const n = edgeNormals(o);
  let g = -Infinity;
  for (let i = 0; i < o.sides; i++) g = Math.max(g, qx * n[2 * i] + qy * n[2 * i + 1]);
  return g / o.apothem;
}

/** The outline's area in plate units (the square's is 4). */
export function plateArea(o: PlateOutline): number {
  if (o.sides === 4) return 4;
  if (o.sides === 0) return Math.PI * o.apothem * o.apothem;
  return o.sides * o.apothem * o.apothem * Math.tan(Math.PI / o.sides);
}

/** A point spread evenly over the outline from two uniform numbers in [0,1).
 *  Mirrors respawnOnPlate in CHLADNI_GLSL: a polygon picks one of its
 *  centre-to-edge triangles (all the same area) with the whole part of
 *  u * sides, then folds the unit square onto that triangle, so no draw is
 *  ever rejected. */
export function respawnPoint(o: PlateOutline, u: number, v: number): [number, number] {
  if (o.sides === 4) return [u * 2 - 1, v * 2 - 1];
  if (o.sides === 0) {
    const r = Math.sqrt(u) * o.apothem;
    const a = 2 * Math.PI * v;
    return [o.cx + r * Math.sin(a), o.cy + r * Math.cos(a)];
  }
  const s = u * o.sides;
  const i = Math.floor(s);
  let a = s - i;
  let b = v;
  if (a + b > 1) {
    a = 1 - a;
    b = 1 - b;
  }
  const half = Math.PI / o.sides;
  const r = o.apothem / Math.cos(half);
  const t = o.turn + 2 * half * i;
  return [o.cx + r * (a * Math.sin(t - half) + b * Math.sin(t + half)), o.cy + r * (a * Math.cos(t - half) + b * Math.cos(t + half))];
}

// ---- Bessel functions -------------------------------------------------------

/** J_0..J_maxOrder at x >= 0 into `out`, by Miller's backward recurrence
 *  (stable for every order, and keeps tiny high-order values' relative
 *  accuracy), normalised by J_0 + 2 sum J_2k = 1. */
export function besselJOrders(maxOrder: number, x: number, out: Float64Array): void {
  out.fill(0, 0, maxOrder + 1);
  if (x === 0) {
    out[0] = 1;
    return;
  }
  const top = Math.max(maxOrder, Math.ceil(x));
  let start = top + 30 + Math.ceil(Math.sqrt(40 * top));
  start += start % 2;
  let next = 0;
  let cur = 1e-300;
  let norm = 0;
  for (let n = start; n > 0; n--) {
    const prev = ((2 * n) / x) * cur - next;
    next = cur;
    cur = prev;
    // cur is J_{n-1}, next J_n (unnormalised).
    if (n - 1 <= maxOrder) out[n - 1] = cur;
    if (n <= maxOrder) out[n] = next;
    if ((n - 1) % 2 === 0 && n - 1 > 0) norm += 2 * cur;
    if (Math.abs(cur) > 1e250) {
      cur *= 1e-250;
      next *= 1e-250;
      norm *= 1e-250;
      for (let k = n - 1; k <= maxOrder; k++) out[k] *= 1e-250;
    }
  }
  norm += cur; // J_0
  for (let k = 0; k <= maxOrder; k++) out[k] /= norm;
}

/** I_n(x), the modified Bessel function, by its power series (all terms
 *  positive, so no cancellation). */
export function besselI(n: number, x: number): number {
  const h = x / 2;
  const q = h * h;
  let term = 1;
  let sum = 1;
  for (let m = 1; m < 300; m++) {
    term *= q / (m * (m + n));
    sum += term;
    if (term < 1e-17 * sum) break;
  }
  let pre = 1;
  for (let k = 1; k <= n; k++) pre *= h / k;
  return pre * sum;
}

// ---- Round: a free round plate ------------------------------------------

/** Poisson's ratio of the round plate, about brass's. */
export const ROUND_POISSON = 0.3;
/** The root scan: k from `from` to just past K_TOP in steps of `step` (roots
 *  of one order lie about pi apart), orders upward until one has no root
 *  below the top (a higher order's first root is higher still). */
const ROUND_K_SCAN = { from: 0.5, step: 0.02 };
const ROUND_ORDER_CAP = 64;

const jScratch = new Float64Array(ROUND_ORDER_CAP + 3);

/** The free edge's two conditions at r = 1 for W = J_n(k r) + C I_n(k r):
 *  zero bending moment (W'' + nu (W' - n^2 W)) and zero effective shear
 *  ((laplacian W)' - (1 - nu) n^2 (W' - W)). Returns their determinant over
 *  C (scaled by e^-k to stay tame; it is 0 at a mode) and the C that zeroes
 *  the moment. */
export function freeEdgeDeterminant(n: number, k: number): { det: number; c: number } {
  besselJOrders(n + 1, k, jScratch);
  const j = jScratch[n];
  const jp = n === 0 ? -jScratch[1] : (jScratch[n - 1] - jScratch[n + 1]) / 2;
  const i = besselI(n, k);
  const ip = n === 0 ? besselI(1, k) : (besselI(n - 1, k) + besselI(n + 1, k)) / 2;
  const nu = ROUND_POISSON;
  const nn = n * n;
  // Bessel's equations give the second derivatives.
  const jpp = -jp / k - (1 - nn / (k * k)) * j;
  const ipp = -ip / k + (1 + nn / (k * k)) * i;
  const mJ = k * k * jpp + nu * (k * jp - nn * j);
  const mI = k * k * ipp + nu * (k * ip - nn * i);
  // (laplacian W)' is -k^3 J' for the J part and +k^3 I' for the I part.
  const vJ = -k * k * k * jp - (1 - nu) * nn * (k * jp - j);
  const vI = k * k * k * ip - (1 - nu) * nn * (k * ip - i);
  return { det: (mJ * vI - mI * vJ) * Math.exp(-k), c: -mJ / mI };
}

interface RoundMode {
  n: number;
  k: number;
  c: number;
}

function roundRoots(): RoundMode[] {
  const out: RoundMode[] = [];
  const top = K_TOP * 1.01;
  for (let n = 0; n <= ROUND_ORDER_CAP; n++) {
    const before = out.length;
    let a = ROUND_K_SCAN.from;
    let fa = freeEdgeDeterminant(n, a).det;
    for (let b = a + ROUND_K_SCAN.step; b <= top; b += ROUND_K_SCAN.step) {
      const fb = freeEdgeDeterminant(n, b).det;
      if (fa * fb < 0) {
        let lo = a;
        let hi = b;
        let flo = fa;
        for (let it = 0; it < 50; it++) {
          const mid = (lo + hi) / 2;
          const fm = freeEdgeDeterminant(n, mid).det;
          if (flo * fm <= 0) hi = mid;
          else {
            lo = mid;
            flo = fm;
          }
        }
        const k = (lo + hi) / 2;
        out.push({ n, k, c: freeEdgeDeterminant(n, k).c });
      }
      a = b;
      fa = fb;
    }
    if (out.length === before) break;
  }
  out.sort((p, q) => p.k - q.k);
  return out.filter((m) => m.k <= K_TOP * (1 + 1e-9));
}

let roundCache: RoundMode[] | null = null;
/** Every mode of the round plate up to K_TOP, lowest first: n, k and C of
 *  W = J_n + C I_n. */
export function roundModes(): readonly RoundMode[] {
  if (!roundCache) roundCache = roundRoots();
  return roundCache;
}

let roundFigureCache: RoundMode[] | null = null;
/** The round plate's figures: PLATE_FIGURES of its modes on the square's
 *  range, spread over it. Every mode W(r) cos(n theta) is even about the
 *  vertical. */
function roundFigures(): readonly RoundMode[] {
  if (!roundFigureCache) roundFigureCache = spreadPick(roundModes().filter((m) => onSquareRange(m.k)), PLATE_FIGURES);
  return roundFigureCache;
}

/** W(r) and W'(r) of a round mode. */
export function roundRadial(mode: RoundMode, r: number): { w: number; dw: number } {
  const x = mode.k * r;
  besselJOrders(mode.n + 1, x, jScratch);
  const j = jScratch[mode.n];
  const jp = mode.n === 0 ? -jScratch[1] : (jScratch[mode.n - 1] - jScratch[mode.n + 1]) / 2;
  const i = besselI(mode.n, x);
  const ip = mode.n === 0 ? besselI(1, x) : (besselI(mode.n - 1, x) + besselI(mode.n + 1, x)) / 2;
  return { w: j + mode.c * i, dw: mode.k * (jp + mode.c * ip) };
}

// ---- Tables ---------------------------------------------------------------

/** Nodal cells across the plate for a mode of wave number k: the square's
 *  (n, m) has k = pi sqrt(n^2 + m^2) and m cells, about CELLS_PER_K k / pi. */
const CELLS_PER_K = 0.8;
const cellsOf = (k: number) => Math.max(1, (CELLS_PER_K * k) / Math.PI);

/** The held square's (n, m) has k = (pi / 2) sqrt(n^2 + m^2): its sines span
 *  the plate, 2 across, in n half-waves. */
const clampedK = (n: number, m: number) => (Math.PI / 2) * Math.hypot(n, m);

function clampedTable(): PlateMode[] {
  // Odd orders only: sin(n pi (x+1)/2) is even about the middle exactly when
  // n is odd, so every figure (and every blend of them) is symmetric about
  // both axes, as the square's are. Both symmetry families of each (n, m)
  // pair, and (n, n) once (its other family is zero). Frequency goes as
  // n^2 + m^2.
  const pairs: { n: number; m: number; sign: 1 | -1 }[] = [];
  for (let n = 1; clampedK(n, n) <= K_TOP; n += 2) {
    for (let m = n; clampedK(n, m) <= K_TOP; m += 2) {
      if (!onSquareRange(clampedK(n, m))) continue;
      pairs.push({ n, m, sign: 1 });
      if (m > n) pairs.push({ n, m, sign: -1 });
    }
  }
  pairs.sort((a, b) => a.n * a.n + a.m * a.m - (b.n * b.n + b.m * b.m) || a.n - b.n || b.sign - a.sign);
  return spreadPick(pairs, PLATE_FIGURES).map((p, layer) => ({
    ...p,
    ratio: plateRatio(clampedK(p.n, p.m)),
    cells: cellsOf(clampedK(p.n, p.m)),
    layer,
    desc: `(${p.n}, ${p.m}) held`,
  }));
}

function roundTable(): PlateMode[] {
  return roundFigures().map((m, layer) => {
    let rings = 0;
    let prev = roundRadial(m, 0.001).w;
    for (let s = 2; s <= 200; s++) {
      const w = roundRadial(m, s / 200).w;
      if (w * prev < 0) rings++;
      prev = w;
    }
    const parts: string[] = [];
    if (rings) parts.push(`${rings} ring${rings > 1 ? "s" : ""}`);
    if (m.n) parts.push(`${2 * m.n} spokes`);
    return { n: 0, m: 0, sign: 1, ratio: plateRatio(m.k), cells: cellsOf(m.k), layer, desc: parts.join(", ") };
  });
}

function generatedTable(rows: readonly { k: number; ratio: number; sym: string; domains: number }[]): PlateMode[] {
  return rows.map((r, layer) => ({
    n: 0,
    m: 0,
    sign: 1,
    ratio: r.ratio,
    cells: cellsOf(r.k),
    layer,
    desc: `${r.domains} cells, ${r.sym}`,
  }));
}

const tableCache = new Map<number, readonly PlateMode[]>();

/** The figure table of `shape` (an index into PLATE_SHAPES), lowest first,
 *  on the square's scale (see the header). */
export function plateModeTable(shape: number): readonly PlateMode[] {
  let t = tableCache.get(shape);
  if (!t) {
    if (shape === ROUND) t = roundTable();
    else if (shape === HEXAGON) t = generatedTable(HEXAGON_MODES);
    else if (shape === DECAGON) t = generatedTable(DECAGON_MODES);
    else if (shape === TRIANGLE) t = generatedTable(TRIANGLE_MODES);
    else if (shape === CLAMPED) t = clampedTable();
    else t = MODE_TABLE;
    tableCache.set(shape, t);
  }
  return t;
}

// ---- The bake ---------------------------------------------------------------

/** Evaluates every mode of a shape at one point: out[3k..3k+2] = f, df/dx,
 *  df/dy of mode k, unscaled. */
type ShapeSource = {
  count: number;
  /** 1 = every mode even about the vertical, -1 odd, per mode; null = mixed
   *  (evaluate the whole grid). */
  parity: Int8Array | null;
  at(x: number, y: number, out: Float64Array): void;
};

/** Radial samples per table over [0, RADIAL_MAX]. */
const RADIAL_SAMPLES = 512;

function roundSource(): ShapeSource {
  const modes = roundFigures();
  // The analytic continuation past the rim grows like I_n; a texel or two
  // beyond the rim is all the filter reads, so the radius is held there.
  const rMax = 1.05;
  const tables = modes.map((m) => {
    const w = new Float64Array(RADIAL_SAMPLES + 1);
    const dw = new Float64Array(RADIAL_SAMPLES + 1);
    for (let s = 0; s <= RADIAL_SAMPLES; s++) {
      const v = roundRadial(m, (s / RADIAL_SAMPLES) * rMax);
      w[s] = v.w;
      dw[s] = v.dw;
    }
    return { w, dw };
  });
  const nMax = Math.max(...modes.map((m) => m.n));
  const cosN = new Float64Array(nMax + 1);
  const sinN = new Float64Array(nMax + 1);
  return {
    count: modes.length,
    parity: Int8Array.from(modes, () => 1),
    at(x, y, out) {
      const r = Math.hypot(x, y);
      const rr = Math.min(r, rMax);
      const st = r > 0 ? x / r : 0;
      const ct = r > 0 ? y / r : 1;
      angles(ct, st, nMax, cosN, sinN);
      const t = (rr / rMax) * RADIAL_SAMPLES;
      const i = Math.min(RADIAL_SAMPLES - 1, Math.floor(t));
      const fr = t - i;
      const h = hermite(fr, rMax / RADIAL_SAMPLES);
      const rs = Math.max(r, 1e-9);
      for (let k = 0; k < modes.length; k++) {
        const { w, dw } = tables[k];
        const W = h[0] * w[i] + h[1] * dw[i] + h[2] * w[i + 1] + h[3] * dw[i + 1];
        const D = dw[i] + (dw[i + 1] - dw[i]) * fr;
        const n = modes[k].n;
        const c = cosN[n];
        const fth = -n * W * sinN[n];
        out[3 * k] = W * c;
        out[3 * k + 1] = D * c * st + (fth / rs) * ct;
        out[3 * k + 2] = D * c * ct - (fth / rs) * st;
      }
    },
  };
}

const hermiteWeights = new Float64Array(4);
/** Cubic Hermite weights at fraction t of a table step of `step`: value =
 *  w0 v0 + w1 d0 + w2 v1 + w3 d1 (d = the tabulated derivative). The radial
 *  tables carry their own derivative, so f is smooth across samples and its
 *  slope agrees with the gradient channel. */
function hermite(t: number, step: number): Float64Array {
  const t2 = t * t;
  const t3 = t2 * t;
  hermiteWeights[0] = 2 * t3 - 3 * t2 + 1;
  hermiteWeights[1] = (t3 - 2 * t2 + t) * step;
  hermiteWeights[2] = -2 * t3 + 3 * t2;
  hermiteWeights[3] = (t3 - t2) * step;
  return hermiteWeights;
}

/** cos(n theta), sin(n theta) for n = 0..nMax from cos theta, sin theta. */
function angles(c: number, s: number, nMax: number, cosN: Float64Array, sinN: Float64Array): void {
  cosN[0] = 1;
  sinN[0] = 0;
  for (let n = 1; n <= nMax; n++) {
    cosN[n] = cosN[n - 1] * c - sinN[n - 1] * s;
    sinN[n] = sinN[n - 1] * c + cosN[n - 1] * s;
  }
}

function seriesSource(rows: readonly SeriesPlateMode[], outline: PlateOutline): ShapeSource {
  // Reflected into the polygon first, so r never passes the circumradius.
  const rMax = outline.apothem / Math.cos(Math.PI / outline.sides);
  let nuMax = 0;
  for (const m of rows) for (const nu of m.nus) nuMax = Math.max(nuMax, nu);
  const orders = new Float64Array(nuMax + 2);
  // Per mode, coef_t J_nu_t(k r) and its r-derivative for every term t,
  // sample-major so one texel's terms sit together.
  const stride = RADIAL_SAMPLES + 1;
  const tables = rows.map((m) => {
    const terms = m.nus.length;
    const j = new Float64Array(stride * terms);
    const dj = new Float64Array(stride * terms);
    const top = Math.max(...m.nus) + 1;
    for (let s = 0; s <= RADIAL_SAMPLES; s++) {
      besselJOrders(top, m.k * (s / RADIAL_SAMPLES) * rMax, orders);
      for (let t = 0; t < terms; t++) {
        const nu = m.nus[t];
        j[s * terms + t] = m.coefs[t] * orders[nu];
        dj[s * terms + t] = m.coefs[t] * m.k * (nu === 0 ? -orders[1] : (orders[nu - 1] - orders[nu + 1]) / 2);
      }
    }
    return { j, dj };
  });
  const cosN = new Float64Array(nuMax + 1);
  const sinN = new Float64Array(nuMax + 1);
  const normals = Array.from({ length: outline.sides }, (_, i) => {
    const a = outline.turn + (2 * Math.PI * i) / outline.sides;
    return [Math.sin(a), Math.cos(a)] as const;
  });
  const flips: number[] = [];
  return {
    count: rows.length,
    parity: Int8Array.from(rows, (m) => (m.kind === "cos" ? 1 : -1)),
    at(x0, y0, out) {
      // Outside: the mirror image across the nearest edge, repeated until
      // inside (a free edge continues as its own reflection).
      let x = x0;
      let y = y0;
      flips.length = 0;
      for (let it = 0; it < 6; it++) {
        let best = -1;
        let over = 0;
        for (let e = 0; e < normals.length; e++) {
          const d = x * normals[e][0] + y * normals[e][1] - outline.apothem;
          if (d > over) {
            over = d;
            best = e;
          }
        }
        if (best < 0) break;
        x -= 2 * over * normals[best][0];
        y -= 2 * over * normals[best][1];
        flips.push(best);
      }
      const r = Math.hypot(x, y);
      const st = r > 0 ? x / r : 0;
      const ct = r > 0 ? y / r : 1;
      angles(ct, st, nuMax, cosN, sinN);
      const t = Math.min(1, r / rMax) * RADIAL_SAMPLES;
      const i = Math.min(RADIAL_SAMPLES - 1, Math.floor(t));
      const fr = t - i;
      const h = hermite(fr, rMax / RADIAL_SAMPLES);
      const h0 = h[0];
      const h1 = h[1];
      const h2 = h[2];
      const h3 = h[3];
      const rs = Math.max(r, 1e-9);
      for (let k = 0; k < rows.length; k++) {
        const m = rows[k];
        const { j, dj } = tables[k];
        const odd = m.kind === "sin";
        const terms = m.nus.length;
        const a0 = i * terms;
        const a1 = a0 + terms;
        let f = 0;
        let fRad = 0;
        let fAng = 0;
        for (let q = 0; q < terms; q++) {
          const nu = m.nus[q];
          const J = h0 * j[a0 + q] + h1 * dj[a0 + q] + h2 * j[a1 + q] + h3 * dj[a1 + q];
          const D = dj[a0 + q] + (dj[a1 + q] - dj[a0 + q]) * fr;
          const a = odd ? sinN[nu] : cosN[nu];
          const da = odd ? nu * cosN[nu] : -nu * sinN[nu];
          f += J * a;
          fRad += D * a;
          fAng += J * da;
        }
        let gx = fRad * st + (fAng / rs) * ct;
        let gy = fRad * ct - (fAng / rs) * st;
        // Undo the reflections on the gradient, last one first.
        for (let q = flips.length - 1; q >= 0; q--) {
          const [nx, ny] = normals[flips[q]];
          const d = gx * nx + gy * ny;
          gx -= 2 * d * nx;
          gy -= 2 * d * ny;
        }
        out[3 * k] = f;
        out[3 * k + 1] = gx;
        out[3 * k + 2] = gy;
      }
    },
  };
}

function triangleSource(): ShapeSource {
  const rows = TRIANGLE_MODES;
  const [k1x, k1y, k2x, k2y] = TRIANGLE_DUAL;
  let span = 0;
  for (const m of rows) for (let w = 0; w < m.waves.length; w += 4) span = Math.max(span, Math.abs(m.waves[w]), Math.abs(m.waves[w + 1]));
  const width = 2 * span + 1;
  // e^{i a k1.p} and e^{i b k2.p} for a, b in [-span, span]: one complex
  // product per wave instead of a cos and a sin.
  const e1r = new Float64Array(width);
  const e1i = new Float64Array(width);
  const e2r = new Float64Array(width);
  const e2i = new Float64Array(width);
  const powers = (ph: number, re: Float64Array, im: Float64Array) => {
    const c = Math.cos(ph);
    const s = Math.sin(ph);
    re[span] = 1;
    im[span] = 0;
    for (let a = 1; a <= span; a++) {
      re[span + a] = re[span + a - 1] * c - im[span + a - 1] * s;
      im[span + a] = im[span + a - 1] * c + re[span + a - 1] * s;
      re[span - a] = re[span + a];
      im[span - a] = -im[span + a];
    }
  };
  return {
    count: rows.length,
    parity: Int8Array.from(rows, (m) => m.parity),
    at(x, y, out) {
      powers(k1x * x + k1y * y, e1r, e1i);
      powers(k2x * x + k2y * y, e2r, e2i);
      for (let k = 0; k < rows.length; k++) {
        const w = rows[k].waves;
        let f = 0;
        let gx = 0;
        let gy = 0;
        for (let q = 0; q < w.length; q += 4) {
          const a = span + w[q];
          const b = span + w[q + 1];
          const cs = e1r[a] * e2r[b] - e1i[a] * e2i[b];
          const sn = e1r[a] * e2i[b] + e1i[a] * e2r[b];
          f += w[q + 2] * cs + w[q + 3] * sn;
          const d = -w[q + 2] * sn + w[q + 3] * cs;
          gx += d * (w[q] * k1x + w[q + 1] * k2x);
          gy += d * (w[q] * k1y + w[q + 1] * k2y);
        }
        out[3 * k] = f;
        out[3 * k + 1] = gx;
        out[3 * k + 2] = gy;
      }
    },
  };
}

function clampedSource(): ShapeSource {
  const modes = plateModeTable(CLAMPED);
  let top = 0;
  for (const m of modes) top = Math.max(top, m.m);
  // sin and cos of order * pi/2 * (t + 1) for every order, along each axis.
  const sx = new Float64Array(top + 1);
  const cx = new Float64Array(top + 1);
  const sy = new Float64Array(top + 1);
  const cy = new Float64Array(top + 1);
  return {
    count: modes.length,
    parity: Int8Array.from(modes, () => 1),
    at(x, y, out) {
      const hx = (Math.PI / 2) * (x + 1);
      const hy = (Math.PI / 2) * (y + 1);
      angles(Math.cos(hx), Math.sin(hx), top, cx, sx);
      angles(Math.cos(hy), Math.sin(hy), top, cy, sy);
      for (let k = 0; k < modes.length; k++) {
        const { n, m, sign } = modes[k];
        const a = (n * Math.PI) / 2;
        const b = (m * Math.PI) / 2;
        out[3 * k] = sx[n] * sy[m] + sign * sx[m] * sy[n];
        out[3 * k + 1] = a * cx[n] * sy[m] + sign * b * cx[m] * sy[n];
        out[3 * k + 2] = b * sx[n] * cy[m] + sign * a * sx[m] * cy[n];
      }
    },
  };
}

function sourceFor(shape: number): ShapeSource {
  if (shape === ROUND) return roundSource();
  if (shape === HEXAGON) return seriesSource(HEXAGON_MODES, plateOutline(HEXAGON));
  if (shape === DECAGON) return seriesSource(DECAGON_MODES, plateOutline(DECAGON));
  if (shape === TRIANGLE) return triangleSource();
  if (shape === CLAMPED) return clampedSource();
  throw new Error(`chladni: the square plate is analytic, not baked`);
}

export interface PlateBake {
  side: number;
  layers: number;
  /** side * side * layers RGBA texels, layer-major then row (y) then column
   *  (x): R = f, G = df/dx, B = df/dy, A = 0, each layer scaled to peak
   *  |f| = 2 inside the shape. Row j, column i is plate point
   *  (-1 + 2 (i + 0.5) / side, -1 + 2 (j + 0.5) / side). */
  data: Float32Array;
  /** The scale each layer's raw mode was multiplied by. */
  scales: Float64Array;
}

/** Evaluates every figure of `shape` (not the square) on the atlas grid. */
export function bakePlate(shape: number, side: number = ATLAS_SIDE): PlateBake {
  const src = sourceFor(shape);
  const outline = plateOutline(shape);
  const layers = src.count;
  const layerSize = side * side * 4;
  const data = new Float32Array(layerSize * layers);
  const peaks = new Float64Array(layers);
  const vals = new Float64Array(3 * layers);
  const mirrored = src.parity !== null && side % 2 === 0;
  const firstColumn = mirrored ? side / 2 : 0;
  // Which texel centres lie on the plate.
  const mask = new Uint8Array(side * side);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) mask[j * side + i] = plateGauge(outline, -1 + (2 * (i + 0.5)) / side, -1 + (2 * (j + 0.5)) / side) <= 1 ? 1 : 0;
  }
  for (let j = 0; j < side; j++) {
    const y = -1 + (2 * (j + 0.5)) / side;
    for (let i = firstColumn; i < side; i++) {
      const x = -1 + (2 * (i + 0.5)) / side;
      src.at(x, y, vals);
      const inside = mask[j * side + i] === 1 || (mirrored && mask[j * side + side - 1 - i] === 1);
      for (let k = 0; k < layers; k++) {
        const f = vals[3 * k];
        const o = k * layerSize + (j * side + i) * 4;
        data[o] = f;
        data[o + 1] = vals[3 * k + 1];
        data[o + 2] = vals[3 * k + 2];
        if (inside) peaks[k] = Math.max(peaks[k], Math.abs(f));
        if (mirrored) {
          // f(-x, y) = p f(x, y): df/dx flips the other way, df/dy with f.
          const p = src.parity![k];
          const m = k * layerSize + (j * side + (side - 1 - i)) * 4;
          data[m] = p * f;
          data[m + 1] = -p * vals[3 * k + 1];
          data[m + 2] = p * vals[3 * k + 2];
        }
      }
    }
  }
  const scales = new Float64Array(layers);
  for (let k = 0; k < layers; k++) {
    const s = peaks[k] > 0 ? 2 / peaks[k] : 1;
    scales[k] = s;
    const base = k * layerSize;
    for (let t = 0; t < side * side; t++) {
      const o = base + t * 4;
      data[o] *= s;
      data[o + 1] *= s;
      data[o + 2] *= s;
    }
  }
  return { side, layers, data, scales };
}

/** One baked mode's f and gradient at a plate point, by the same bilinear
 *  filter the GPU applies (texel centres, clamped at the grid's edge). For
 *  tests and offline checks. */
export function sampleBake(bake: PlateBake, layer: number, x: number, y: number): [number, number, number] {
  const { side, data } = bake;
  const fx = Math.max(0, Math.min(side - 1, ((x + 1) * side) / 2 - 0.5));
  const fy = Math.max(0, Math.min(side - 1, ((y + 1) * side) / 2 - 0.5));
  const i = Math.min(side - 2, Math.floor(fx));
  const j = Math.min(side - 2, Math.floor(fy));
  const tx = fx - i;
  const ty = fy - j;
  const out: [number, number, number] = [0, 0, 0];
  const base = layer * side * side * 4;
  for (let c = 0; c < 3; c++) {
    const at = (ii: number, jj: number) => data[base + (jj * side + ii) * 4 + c];
    out[c] = (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
  }
  return out;
}

/** A baked shape's raw evaluator, unscaled, for tests: f, df/dx, df/dy of
 *  every mode at one point. */
const testSources = new Map<number, ShapeSource>();
export function plateFieldAt(shape: number, x: number, y: number): Float64Array {
  let src = testSources.get(shape);
  if (!src) {
    src = sourceFor(shape);
    testSources.set(shape, src);
  }
  const out = new Float64Array(3 * src.count);
  src.at(x, y, out);
  return out;
}
