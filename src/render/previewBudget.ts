/**
 * Adaptive per-tick draw budget for gallery preview tiles — how many tiles
 * src/ui/gallery.ts's tick() is allowed to redraw on a given tick.
 *
 * Modelled on governor.ts's shape — an EWMA of a cost signal, and
 * deliberately asymmetric step-down/step-up streaks so a drop reacts fast
 * and a recovery is cautious — but far smaller: it moves one integer, and a
 * wrong guess costs preview frame rate rather than a visible quality pop.
 * In particular it needs none of governor.ts's authority-probe machinery:
 * that exists because a rendered-frame-interval signal can't tell "this
 * page is GPU-bound" from "something outside this page (energy saver, a
 * refresh-rate cap) is pacing rAF" apart. This controller's signal is the
 * gallery's own JS-side draw-loop duration, timed directly around the
 * drawTo() calls it actually made — a pace nothing external can impose —
 * so there's no ambiguity to probe for.
 *
 * Never touches *which* tiles get the budget (previewSchedule.ts) or the
 * per-scene quality knobs snapshotted once in reducedPreviewQuality()
 * (gallery.ts) — those are allocation-time constants for a reason (meshGrid/
 * ambience size grids and powder/chladni/storm size particle buffers off
 * them); this only moves how many tiles are asked to draw per tick.
 */

// Budget for the draw loop itself, not the whole rAF frame — the gallery
// tick shares that frame with feature extraction and everything else in
// app.ts's loop(). Kept well under a 60Hz frame's ~16.7ms so preview
// drawing is never the reason a frame gets dropped.
const TARGET_DRAW_MS = 4;
const OVER_BUDGET_MULT = 1.5;
const UNDER_BUDGET_MULT = 0.6;
const EWMA_ALPHA = 0.15;
// Step down after a short streak (react fast to real overload); step up
// only after a long comfortable streak — the same asymmetry governor.ts
// uses, for the same reason: a level that was just cut shouldn't get
// bumped back the moment one comfortable tick shows up.
const STEP_DOWN_TICKS = 4;
const STEP_UP_TICKS = 40;
// A safety net against unbounded growth during a long stretch where the
// ceiling passed to budgetFor() stayed small (e.g. the draft section never
// opened) — budgetFor() clamps to the real ceiling anyway, this just keeps
// the internal counter from drifting arbitrarily far past anything a
// ceiling could ever ask for.
const MAX_LEVEL = 32;

export interface PreviewBudgetController {
  /** Call once per tick with how long the draw loop actually took (ms) and
   *  how many tiles it drew. A tick that drew nothing (tilesDrawn === 0,
   *  e.g. every tile already fresh) is skipped — it has no cost signal to
   *  learn from, not evidence of a comfortable budget. */
  recordTick(drawMs: number, tilesDrawn: number): void;
  /** The current step, clamped into [1, ceiling]. Ceiling is supplied per
   *  call rather than fixed at construction because it tracks
   *  eligible.length, which changes as tiles scroll in/out or the draft
   *  section expands. */
  budgetFor(ceiling: number): number;
}

export function createPreviewBudgetController(initialLevel: number): PreviewBudgetController {
  let level = Math.max(1, Math.round(initialLevel));
  // Seeded at "exactly on target" for this level, not 0 — governor.ts seeds
  // its own EWMA at targetFrameMs for the same reason: starting cold at 0
  // would bias the first several ticks low regardless of the true cost,
  // delaying a real overload's detection by however long the EWMA takes to
  // climb out of that hole.
  let ewmaPerTileMs = TARGET_DRAW_MS / level;
  let overStreak = 0;
  let underStreak = 0;

  return {
    recordTick(drawMs: number, tilesDrawn: number): void {
      if (tilesDrawn <= 0) return;
      const perTileMs = drawMs / tilesDrawn;
      ewmaPerTileMs += (perTileMs - ewmaPerTileMs) * EWMA_ALPHA;
      const projectedMs = ewmaPerTileMs * level;

      if (projectedMs > TARGET_DRAW_MS * OVER_BUDGET_MULT) {
        overStreak++;
        underStreak = 0;
        if (overStreak >= STEP_DOWN_TICKS) {
          level = Math.max(1, level - 1);
          overStreak = 0;
        }
      } else if (projectedMs < TARGET_DRAW_MS * UNDER_BUDGET_MULT) {
        underStreak++;
        overStreak = 0;
        if (underStreak >= STEP_UP_TICKS) {
          level = Math.min(MAX_LEVEL, level + 1);
          underStreak = 0;
        }
      } else {
        overStreak = 0;
        underStreak = 0;
      }
    },

    budgetFor(ceiling: number): number {
      return Math.max(1, Math.min(ceiling, level));
    },
  };
}
