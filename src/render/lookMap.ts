/**
 * The Map (#625): each pad is a place on a field. Busier pictures sit further
 * right and brighter ones higher up, going by each pad's measured picture (the
 * busy and bright readings on each MapItem). Places that would land on
 * top of each other are nudged apart, so every pad stays readable. A pad whose
 * picture is not measured yet sits on a ring round the middle, in list order,
 * until it is.
 *
 * A puck on the field follows the music (the desk draws it, not this file). Between the
 * two places nearest the puck, the scene settings of two looks of one scene
 * blend by how close the puck is to each: blendValues is that mix, nearestTwo
 * is how the puck picks its two places.
 *
 * Pure geometry and arithmetic on purpose: the desk draws it, and the tests
 * pin the placement rules without a browser.
 */

export interface MapItem {
  id: string;
  sceneId: string;
  /** 0..1, null before measured */
  busy: number | null;
  /** 0..1, null before measured */
  bright: number | null;
}

export interface MapPoint {
  id: string;
  x: number;
  y: number;
}

/** Margin kept clear at the field's edges, and the least distance between two places, both in field units (0..1). */
export const MAP_MARGIN = 0.08;
export const MAP_MIN_GAP = 0.14;

/** Radius of the ring that unmeasured pads sit on, round the field's centre. */
const RING_RADIUS = 0.3;
/** Enough passes for a crowd of places to settle; the nudge is a relaxation, not a solver. */
const RELAX_PASSES = 60;
/** Pads that land on the same spot part along a direction set by their index, so the result does not depend on chance. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function clampField(v: number): number {
  return Math.min(1 - MAP_MARGIN, Math.max(MAP_MARGIN, v));
}

/** Measured items at (busy, bright); unmeasured ones on a ring round the centre in list order; then pushed apart until no two are closer than MAP_MIN_GAP (a fixed number of passes), clamped inside the margin. y grows upward (bright = high y). */
export function placeLooks(items: readonly MapItem[]): MapPoint[] {
  const span = 1 - 2 * MAP_MARGIN;
  const toField = (v: number): number => MAP_MARGIN + clamp01(v) * span;
  const unmeasured = items.filter((it) => it.busy === null || it.bright === null).length;
  let ringAt = 0;
  const points: MapPoint[] = items.map((it) => {
    if (it.busy !== null && it.bright !== null) {
      return { id: it.id, x: toField(it.busy), y: toField(it.bright) };
    }
    const angle = -Math.PI / 2 + (2 * Math.PI * ringAt++) / unmeasured;
    return { id: it.id, x: 0.5 + RING_RADIUS * Math.cos(angle), y: 0.5 + RING_RADIUS * Math.sin(angle) };
  });
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]!;
        const b = points[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= MAP_MIN_GAP) continue;
        if (d < 1e-9) {
          dx = Math.cos(j * GOLDEN_ANGLE);
          dy = Math.sin(j * GOLDEN_ANGLE);
          d = 1;
        }
        const half = (MAP_MIN_GAP - d) / 2;
        const ux = (dx / d) * half;
        const uy = (dy / d) * half;
        a.x -= ux;
        a.y -= uy;
        b.x += ux;
        b.y += uy;
      }
    }
    for (const p of points) {
      p.x = clampField(p.x);
      p.y = clampField(p.y);
    }
  }
  return points;
}

/** The two places nearest the puck and the second one's share (0 at the first, rising to 0.5 halfway between them). */
export function nearestTwo(
  points: readonly MapPoint[],
  puck: { x: number; y: number },
): { a: string; b: string | null; share: number } | null {
  if (points.length === 0) return null;
  const ranked = points
    .map((p) => ({ id: p.id, d: Math.hypot(p.x - puck.x, p.y - puck.y) }))
    .sort((u, v) => u.d - v.d);
  const first = ranked[0]!;
  const second = ranked[1];
  if (!second) return { a: first.id, b: null, share: 0 };
  const share = first.d === 0 ? 0 : Math.min(0.5, first.d / (first.d + second.d));
  return { a: first.id, b: second.id, share };
}

/** a's values moved toward b's by share, key by key; a key only one side has keeps that side's value. Never mutates. */
export function blendValues(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
  share: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  const aKeys = new Set(Object.keys(a));
  const bKeys = new Set(Object.keys(b));
  for (const k of aKeys) {
    const av = a[k]!;
    out[k] = bKeys.has(k) ? av + (b[k]! - av) * share : av;
  }
  for (const k of bKeys) {
    if (!aKeys.has(k)) out[k] = b[k]!;
  }
  return out;
}
