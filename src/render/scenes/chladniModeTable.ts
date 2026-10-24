// Chladni's plate shapes and the square's table of figures: what the scene's
// card needs for its Plate and Pattern settings, kept apart from
// chladniPlates.ts so a page that loads the card doesn't also load the other
// shapes' solved modes (chladniPlateModes.ts). chladniPlates.ts re-exports all
// of it.

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
