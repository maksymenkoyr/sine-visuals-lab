// Which gallery tile plays its live preview (src/ui/gallery.ts's tick), the
// owner's rule: with a pointer, only the tile under it (or holding keyboard
// focus) plays and the rest rest on their stills; without hover (phone,
// tablet, TV) the one tile nearest the middle of the screen plays.

export function playingTile<T>(opts: {
  canHover: boolean;
  hovered: T | null;
  focused: T | null;
  candidates: readonly { tile: T; centerDist: number }[];
}): T | null {
  const { candidates } = opts;
  if (opts.canHover) {
    const pick = opts.hovered ?? opts.focused;
    return pick !== null && candidates.some((c) => c.tile === pick) ? pick : null;
  }
  let best: T | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (c.centerDist < bestDist) {
      bestDist = c.centerDist;
      best = c.tile;
    }
  }
  return best;
}
