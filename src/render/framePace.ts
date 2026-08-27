import type { Tier } from "./tier.ts";

/** Caps scene.render()'s rate independently of rAF — a 120Hz phone gets no
 *  visible benefit from raymarching twice as often, only twice the cost.
 *  30fps on floor tier, 60 elsewhere. Everything else in app.ts's/tv.ts's
 *  loop() (feature extraction, beat/flow decay, host broadcast) still runs
 *  on every rAF tick regardless of this cap. */
export const RENDER_FPS_CAP = 60;
export const RENDER_FPS_CAP_FLOOR = 30;

export function targetFrameIntervalMs(tier: Tier): number {
  return 1000 / (tier === "floor" ? RENDER_FPS_CAP_FLOOR : RENDER_FPS_CAP);
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
const GATE_TOLERANCE_MS = 2;

/** Whether enough time has passed since the last *rendered* frame (not
 *  every rAF tick) to render another one. Pure and separately testable so
 *  the tolerance above can be verified against real refresh-rate cadences
 *  without a browser. */
export function shouldRenderFrame(nowMs: number, lastRenderMs: number, targetIntervalMs: number): boolean {
  return nowMs - lastRenderMs >= targetIntervalMs - GATE_TOLERANCE_MS;
}
