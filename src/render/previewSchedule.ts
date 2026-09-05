/**
 * Picks which gallery preview tiles to redraw on a given tick — see
 * src/ui/gallery.ts's tick(). Replaces a modulo round-robin (which desyncs
 * the moment the eligible-tile list's length changes — e.g. a tile
 * scrolling in/out, or the draft section expanding) with a stateless
 * "most overdue relative to its own target interval" ordering.
 *
 * Each candidate carries its own target interval rather than sharing one
 * global rate, which is what lets gallery.ts give a focused tile every tick
 * while a merely-visible one gets redrawn every few, without two separate
 * scheduling mechanisms: a fast-target tile racks up overdue-ness quickly
 * and gets served often, a slow-target one accumulates more gradually but
 * is never starved outright — it eventually outranks tiles that were just
 * served, the same way a slow rung on a fair-queuing wheel still gets a
 * turn.
 */

export interface ScheduleCandidate {
  /** Wall-clock ms this tile last drew, or 0 if it has never drawn — treated
   *  as maximally overdue so a freshly-eligible tile draws on its first
   *  chance rather than waiting out a full interval first. */
  lastDrawMs: number;
  /** How often this tile wants to be redrawn. Smaller means higher
   *  priority — see gallery.ts's focused/near/far bands. */
  targetIntervalMs: number;
}

function overdueRatio(c: ScheduleCandidate, nowMs: number): number {
  if (c.lastDrawMs === 0) return Infinity;
  return (nowMs - c.lastDrawMs) / Math.max(1, c.targetIntervalMs);
}

/**
 * Returns the indices (into `candidates`) of up to `budget` tiles to redraw
 * this tick, most-overdue first. Only tiles that are actually due — elapsed
 * time at or past their own target interval — are ever returned: if fewer
 * than `budget` are due, the rest of the budget simply goes unspent this
 * tick rather than forcing an early redraw of something already fresh. That
 * makes the collapsed-gallery case (every tile's target interval equals the
 * tick's own gate interval, so all of them come due together) behave
 * exactly as a flat "draw everything, every tick" would.
 *
 * Ties keep candidate order (stable sort), so results are deterministic.
 */
export function selectDueTiles(
  candidates: readonly ScheduleCandidate[],
  nowMs: number,
  budget: number,
): number[] {
  return candidates
    .map((c, index) => ({ index, ratio: overdueRatio(c, nowMs) }))
    .filter((c) => c.ratio >= 1)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, Math.max(0, budget))
    .map((c) => c.index);
}
