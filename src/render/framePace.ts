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
 *  the previous anchor plus one interval, not `nowMs`. The gate then keeps its
 *  own steady grid and an accepted tick that landed a little late doesn't push
 *  the next frame out with it, so a 144 Hz panel really renders ~60 fps rather
 *  than every third vsync. A first frame (`lastRenderMs` 0), a stall or a tab
 *  resume (more than two intervals behind) snaps to `nowMs` instead, so the
 *  gate never replays a backlog as a burst of back-to-back renders. */
export function nextRenderAnchor(nowMs: number, lastRenderMs: number, targetIntervalMs: number): number {
  return nowMs - lastRenderMs > 2 * targetIntervalMs ? nowMs : lastRenderMs + targetIntervalMs;
}
