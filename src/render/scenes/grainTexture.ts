// The grain-texture sizing the grain scenes share (Chladni, Powder, Physarum,
// Physarum 2): the side of the square state texture a grain count needs, and the
// grain count the brightness and size scaling is anchored to. Pure, no GL, so no
// scene's body pulls another's in to reach them.

/** Side of the square position texture that holds `count` grains. */
export function grainTextureSide(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
}

/** Per-grain brightness gain so a sparse floor-quality bed reads about as
 *  bright as a dense high-quality one. Anchored at the top quality tier's
 *  grain count = gain 1, so no preset renders dimmer than the best one. */
export const REFERENCE_GRAINS = 200_000;
