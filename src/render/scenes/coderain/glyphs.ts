/**
 * Code Rain's glyphs: a hand-drawn set of stroke glyphs and the atlas they
 * are rasterised into. Drawn for this scene from the shapes of half-width
 * katakana, digits and a few symbols — straight strokes on a 4×6 grid, no
 * font and no sprite sheet — then mirrored left-right the way the film's
 * code rain mirrors its katakana (the digits and symbols stay as they are).
 *
 * The atlas is a single-channel texture, `ATLAS_COLS` × `ATLAS_COLS` tiles of
 * `TILE_PX` square, one glyph per tile, filled in plain JS (no DOM, so it is
 * testable under node) as stroke coverage plus a faint halo. The tile is the
 * glyph *cell*: the shader maps a cell of a rain column straight onto a tile,
 * so the margin around the strokes is the gap between neighbouring glyphs.
 * Generous margins also keep the lower mip levels from bleeding one glyph
 * into the next until the glyphs are a few pixels tall anyway.
 */

/** One glyph: polylines of (x, y) pairs on the 4×6 grid, y down. */
export type GlyphStrokes = readonly (readonly number[])[];

/** Katakana-shaped glyphs (mirrored when rasterised). */
const KANA: readonly GlyphStrokes[] = [
  [[0, 1, 4, 1, 3, 3], [2, 2, 2, 4, 1, 6]],
  [[4, 0, 0, 3], [2, 1.5, 2, 6]],
  [[2, 0, 2, 1], [0, 3, 0, 1, 4, 1, 4, 3, 2, 6]],
  [[0, 1, 4, 1], [2, 1, 2, 5], [0, 5, 4, 5]],
  [[0, 2, 4, 2], [3, 0, 3, 6, 2, 5], [3, 2, 0, 5]],
  [[0, 2, 4, 2, 4, 5, 3, 6], [2, 0, 1, 6]],
  [[0, 2, 4, 1.5], [0, 4, 4, 3.5], [1.5, 0, 2.5, 6]],
  [[1.5, 0, 0, 2.5], [1, 1, 4, 1, 3, 4, 0.5, 6]],
  [[1, 0, 0, 2], [0.5, 1.5, 4, 1.5], [2.5, 1.5, 2.5, 4, 1, 6]],
  [[0, 1, 4, 1, 4, 5, 0, 5]],
  [[0, 2, 4, 2], [1, 0, 1, 3.5], [3, 0, 3, 4, 1.5, 6]],
  [[0, 1, 1, 1.5], [0, 3, 1, 3.5], [0, 6, 4, 1.5]],
  [[0, 1, 4, 1, 0, 6], [2, 3.5, 4, 6]],
  [[0, 2.5, 4, 1.5, 3, 3], [1, 0, 1, 5, 4, 5]],
  [[0, 1, 1, 3], [4, 1, 1, 6]],
  [[1.5, 0, 0, 2.5], [1, 1, 4, 1, 3, 4, 0.5, 6], [1, 3, 3, 4]],
  [[3.5, 0, 1, 1], [0, 2.5, 4, 2.5], [2, 1, 2, 4.5, 1, 6]],
  [[0, 1, 0.6, 2.5], [1.8, 1, 2.4, 2.5], [4, 1, 1, 6]],
  [[0.5, 0.5, 3.5, 0.5], [0, 2.5, 4, 2.5], [2, 2.5, 2, 4, 1, 6]],
  [[1, 0, 1, 6], [1, 2.5, 3.5, 4]],
  [[0, 2, 4, 2], [2, 0, 2, 4, 1, 6]],
  [[0.5, 1.5, 3.5, 1.5], [0, 5, 4, 5]],
  [[0, 1, 4, 1, 0.5, 6], [1.5, 3, 3.5, 5]],
  [[2, 0, 2, 1], [0, 1, 4, 1, 0, 5], [2, 3, 2, 6], [2.5, 3.5, 4, 5]],
  [[4, 0, 0, 6]],
  [[1.5, 1, 0, 5], [2.5, 1, 4, 5]],
  [[0, 1, 0, 5, 4, 5], [0, 3, 3, 2]],
  [[0, 1, 4, 1, 3, 4, 0.5, 6]],
  [[0, 4, 1.5, 2, 4, 5.5]],
  [[0, 2, 4, 2], [2, 0, 2, 6, 1.5, 5.5], [1, 3.5, 0, 5], [3, 3.5, 4, 5]],
  [[0, 1, 4, 1, 2, 4], [1, 2.5, 3, 5.5]],
  [[1, 0.5, 3, 1.5], [1, 2.5, 3, 3.5], [0.5, 4.5, 3.5, 5.8]],
  [[1.5, 0, 0, 5.5, 4, 5], [3, 3.5, 4, 6]],
  [[4, 0, 0, 6], [0.5, 2, 3.5, 5]],
  [[0.5, 1, 3.5, 1], [0, 3, 4, 3], [2, 1, 2, 5.5, 4, 5.5]],
  [[0, 2, 4, 1.5, 3, 3], [1, 0, 2, 6]],
  [[0.5, 2, 3, 2, 3, 5], [0, 5, 4, 5]],
  [[0, 1, 4, 1, 4, 5, 0, 5], [0, 3, 4, 3]],
  [[0.5, 0.5, 3.5, 0.5], [0, 2, 4, 2, 3, 4.5, 1, 6]],
  [[1, 0, 1, 3], [3, 0, 3, 4, 1.5, 6]],
  [[1, 0, 1, 4, 0, 6], [2.5, 0, 2.5, 6, 4, 4]],
  [[1, 0, 1, 6, 4, 3]],
  [[0, 1, 4, 1, 4, 5, 0, 5, 0, 1]],
  [[0, 2.5, 0, 1, 4, 1, 3.5, 4, 1.5, 6]],
  [[0, 1, 1.2, 2], [0, 6, 4, 1.5]],
];

/** Digits and symbols (drawn as they read, not mirrored). */
const PLAIN: readonly GlyphStrokes[] = [
  [[1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0]],
  [[1, 1, 2, 0, 2, 6], [1, 6, 3, 6]],
  [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2.5, 0, 6, 4, 6]],
  [[0, 0, 4, 0, 2, 2.5, 4, 3.5, 4, 5, 3, 6, 0, 6]],
  [[3, 6, 3, 0, 0, 4, 4, 4]],
  [[4, 0, 0.5, 0, 0, 2.5, 3, 2.5, 4, 3.5, 4, 5, 3, 6, 0, 6]],
  [[0, 0, 4, 0, 1.5, 6]],
  [[3, 3, 1, 3, 0, 2, 0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5, 0, 4, 1, 3]],
  [[4, 3, 1, 3, 0, 2, 0, 1, 1, 0, 3, 0, 4, 1, 4, 6]],
  [[2, 1.5, 2, 2], [2, 4, 2, 4.5]],
  [[2, 5.4, 2, 6]],
  [[0, 2, 4, 2], [0, 4, 4, 4]],
  [[2, 1, 2, 5], [0.5, 2, 3.5, 4], [3.5, 2, 0.5, 4]],
  [[2, 1, 2, 5], [0, 3, 4, 3]],
  [[0.5, 3, 3.5, 3]],
  [[4, 0.5, 0, 3, 4, 5.5]],
  [[0, 0.5, 4, 3, 0, 5.5]],
  [[2, 0, 2, 6]],
  [[0, 0, 4, 0, 0, 6, 4, 6]],
];

export const GLYPHS: readonly GlyphStrokes[] = [...KANA, ...PLAIN];
/** How many of GLYPHS (from the front) are mirrored: the kana. */
export const MIRRORED_COUNT = KANA.length;
/** The digits follow the kana; the symbols follow the digits. */
export const DIGIT_COUNT = 9;
/** How often a cell draws a kana, a digit, or (the rest) a symbol — the
 *  reference's rain is mostly kana. */
export const KANA_SHARE = 0.82;
export const DIGIT_SHARE = 0.13;
export const GLYPH_COUNT = GLYPHS.length;

export const TILE_PX = 64;
export const ATLAS_COLS = 8;
export const ATLAS_PX = TILE_PX * ATLAS_COLS;
if (GLYPH_COUNT > ATLAS_COLS * ATLAS_COLS) throw new Error("coderain: more glyphs than atlas tiles");

/** Where the 4×6 grid sits in a tile, in tile pixels: the strokes span
 *  x ∈ [GRID_X0, GRID_X0 + 4·GRID_PX_X], y ∈ [GRID_Y0, GRID_Y0 + 6·GRID_PX_Y].
 *  The grid is stretched wider than it is tall so the glyphs come out about
 *  square and nearly fill their cell, as the reference's do (its row pitch
 *  was 1.0–1.17× a glyph's ink width). */
const GRID_PX_X = 12.6;
const GRID_PX_Y = 8.6;
const GRID_X0 = (TILE_PX - 4 * GRID_PX_X) / 2;
const GRID_Y0 = (TILE_PX - 6 * GRID_PX_Y) / 2;
/** Stroke half-width, in tile pixels — a stroke about an eighth of the
 *  glyph's height, bold like the reference's. */
const STROKE_R = 3.9;
/** The halo: its height relative to a stroke's core, and its e-fold in tile
 *  pixels. Measured on the reference, the glow is faint and tight (halo/core
 *  0.02–0.03 at 4 px, e-fold ~2 px on ~25 px glyphs). */
const HALO = 0.12;
const HALO_EFOLD = 4;

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const ex = px - (ax + t * dx);
  const ey = py - (ay + t * dy);
  return Math.sqrt(ex * ex + ey * ey);
}

/** Distance from a tile pixel to a glyph's nearest stroke, in tile pixels
 *  (x is mirrored for a mirrored glyph). */
export function glyphDistance(g: GlyphStrokes, px: number, py: number, mirror = false): number {
  let d = Infinity;
  for (const line of g) {
    for (let i = 0; i + 3 < line.length; i += 2) {
      const ax = GRID_X0 + (mirror ? 4 - line[i] : line[i]) * GRID_PX_X;
      const bx = GRID_X0 + (mirror ? 4 - line[i + 2] : line[i + 2]) * GRID_PX_X;
      d = Math.min(d, segDist(px, py, ax, GRID_Y0 + line[i + 1] * GRID_PX_Y, bx, GRID_Y0 + line[i + 3] * GRID_PX_Y));
    }
  }
  return d;
}

/** The atlas as R8 texels, row 0 at the top (upload with UNPACK_FLIP_Y off
 *  and sample with v pointing down the glyph). */
export function buildGlyphAtlas(): Uint8Array {
  const out = new Uint8Array(ATLAS_PX * ATLAS_PX);
  const aa = 0.6; // edge softness, tile pixels
  for (let gi = 0; gi < GLYPH_COUNT; gi++) {
    const g = GLYPHS[gi];
    const mirror = gi < MIRRORED_COUNT;
    const ox = (gi % ATLAS_COLS) * TILE_PX;
    const oy = Math.floor(gi / ATLAS_COLS) * TILE_PX;
    for (let ty = 0; ty < TILE_PX; ty++) {
      for (let tx = 0; tx < TILE_PX; tx++) {
        const d = glyphDistance(g, tx + 0.5, ty + 0.5, mirror);
        const core = Math.max(0, Math.min(1, (STROKE_R + aa - d) / (2 * aa)));
        const halo = HALO * Math.exp(-Math.max(0, d - STROKE_R) / HALO_EFOLD);
        out[(oy + ty) * ATLAS_PX + ox + tx] = Math.round(255 * Math.min(1, Math.max(core, halo)));
      }
    }
  }
  return out;
}
