import type { QualityPreset } from "./quality.ts";

/** Caps scene.render()'s rate independently of rAF — a 120Hz phone gets no
 *  visible benefit from raymarching twice as often, only twice the cost.
 *  30fps on the floor preset, 60 elsewhere. Everything else in app.ts's/tv.ts's
 *  loop() (feature extraction, beat/flow decay, host broadcast) still runs
 *  on every rAF tick regardless of this cap. */
export const RENDER_FPS_CAP = 60;
export const RENDER_FPS_CAP_FLOOR = 30;

export function targetFrameIntervalMs(preset: QualityPreset): number {
  return 1000 / (preset === "floor" ? RENDER_FPS_CAP_FLOOR : RENDER_FPS_CAP);
}

// A panel refreshing at exactly the cap delivers rAF ticks whose spacing
// straddles the interval by a fraction of a millisecond either way. Gating
// on an exact comparison (`elapsed < targetIntervalMs`) turns half of those
// ticks into skipped renders — a 60Hz display's real render rate silently
// becomes ~40fps with visible judder — and a skipped render doesn't only
// cost that frame: it makes the *next* rendered frame's measured interval
// look like it took twice the budget, which is exactly what governor.ts's
// EWMA watches. Without this tolerance, ordinary jitter on perfectly
// healthy hardware reads as sustained GPU overload and the governor
// downgrades quality for no real reason.
//
// Accepting a tick that lands within this much of the cap keeps a 60Hz
// panel rendering every tick. It has to stay well under the gap to the next
// refresh rate up (16.67 -> 13.33ms at 75Hz) so the cap still halves
// anything genuinely faster — 2ms admits up to ~68.5fps through the 60fps
// gate, which only ever matters for the 60Hz-with-jitter case this exists
// to fix.
//
// The tolerance only admits ticks; what the gate is measured *from* is
// nextRenderAnchor()'s job. Stamping "now" on every render would restart the
// phase at each frame, and on a display faster than the cap (75, 90, 120,
// 144 Hz) that quantizes the rate to a whole number of vsyncs: at 144 Hz
// (6.9 ms) a 16.7 ms interval is never reached after two ticks, so every
// render waited for the third and 60 fps became 48.
export const GATE_TOLERANCE_MS = 2;

/** Whether enough time has passed since the last *rendered* frame (not
 *  every rAF tick) to render another one. Pure and separately testable so
 *  the tolerance above can be verified against real refresh-rate cadences
 *  without a browser. */
export function shouldRenderFrame(nowMs: number, lastRenderMs: number, targetIntervalMs: number): boolean {
  return nowMs - lastRenderMs >= targetIntervalMs - GATE_TOLERANCE_MS;
}

/** What to store as `lastRenderMs` after a tick that passed shouldRenderFrame:
 *  the previous anchor plus one interval, not `nowMs` — but never ahead of
 *  `nowMs`. The gate then keeps its own steady grid and an accepted tick that
 *  landed a little late doesn't push the next frame out with it, so a 144 Hz
 *  panel really renders ~60 fps rather than every third vsync. The clamp is
 *  for a panel a hair faster than the cap (60.06 Hz): an accepted tick that
 *  arrives early would otherwise leave the anchor in the future and the grid
 *  would drift until a frame was dropped. A first frame (`lastRenderMs` 0), a stall or a tab
 *  resume (more than two intervals behind) snaps to `nowMs` instead, so the
 *  gate never replays a backlog as a burst of back-to-back renders. */
export function nextRenderAnchor(nowMs: number, lastRenderMs: number, targetIntervalMs: number): number {
  return nowMs - lastRenderMs > 2 * targetIntervalMs ? nowMs : Math.min(nowMs, lastRenderMs + targetIntervalMs);
}

// A late frame leaves the grid behind it: the anchor steps one interval while
// the frame landed later than that, so on a display faster than the cap the
// next tick or two would pass the gate at once and draw back to back — on a
// 120 Hz panel, one 33 ms frame and then two 8 ms ones. Those extra
// frames are a stutter of their own, landing just when the machine is
// busiest. So a tick closer than CATCH_UP_GAP intervals to the last drawn
// frame doesn't draw: the grid restarts from that late frame, and the next
// frame comes one interval after it.
//
// It has to sit above one tick of a display twice as fast as the cap (half an
// interval: the catch-up on a 120 Hz panel under the 60 cap) and below the
// shortest gap a healthy display draws at the cap, which is one tick of a
// 100 Hz panel (0.6 of an interval). Other refresh rates the cap doesn't
// divide also draw some gaps shorter than an interval, all of them longer
// than that one.
export const CATCH_UP_GAP = 0.55;

/** One loop's render gate: shouldRenderFrame()'s grid, moved on by
 *  nextRenderAnchor(), and the catch-up rule above. Each loop that draws on
 *  rAF owns one. */
export interface RenderGate {
  /** Whether this tick draws. Call once per tick, and draw when it says yes:
   *  the gate counts the frame as drawn. */
  pass(nowMs: number, intervalMs: number): boolean;
  /** What pass() would answer, without moving the gate. */
  due(nowMs: number, intervalMs: number): boolean;
  /** Drawing starts over: the next tick draws, measured from nothing. */
  reset(): void;
}

export function createRenderGate(): RenderGate {
  /** nextRenderAnchor()'s grid: what shouldRenderFrame() measures from. */
  let anchorMs = 0;
  /** When the last frame was really drawn; 0 before the first. */
  let drawnMs = 0;
  const catchUp = (nowMs: number, intervalMs: number) => drawnMs > 0 && nowMs - drawnMs < CATCH_UP_GAP * intervalMs;
  return {
    pass(nowMs, intervalMs) {
      if (!shouldRenderFrame(nowMs, anchorMs, intervalMs)) return false;
      if (catchUp(nowMs, intervalMs)) {
        anchorMs = drawnMs;
        return false;
      }
      anchorMs = nextRenderAnchor(nowMs, anchorMs, intervalMs);
      drawnMs = nowMs;
      return true;
    },
    due(nowMs, intervalMs) {
      return shouldRenderFrame(nowMs, anchorMs, intervalMs) && !catchUp(nowMs, intervalMs);
    },
    reset() {
      anchorMs = 0;
      drawnMs = 0;
    },
  };
}
