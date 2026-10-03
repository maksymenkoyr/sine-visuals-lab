import { GLIDE_MAX_MS, GLIDE_MIN_MS } from "../net/outputGlide.ts";

/**
 * The keyboard gestures of the pop-out output (src/ui/outputControls.ts is
 * the on-screen half, src/app.ts wires both):
 *
 *  - Space is Cue, held like a DJ mixer's: the preview is on the output only
 *    while the key is down, and releasing it (or losing window focus) puts
 *    the output back (net/outputSync.ts's createCueController). app.ts takes
 *    it in the capture phase while an output window is open, so it can't also
 *    press whichever button or checkbox has focus. Cmd+Space / Ctrl+Space are
 *    macOS's own and never reach the page; Cmd, Ctrl or Shift held makes it
 *    not ours. Option is let through: Play while Cue is held sends what the
 *    Cue shows as the new look, and Space's auto-repeat then carries Option —
 *    it must not read as the chord that cancels the Play.
 *  - Option (Alt) is Play, on a bare press only: a quick tap sends the look
 *    across at once, a longer hold charges and, on release, glides there over
 *    GLIDE_PER_HOLD times the hold (net/outputGlide.ts says what moves
 *    smoothly). Option held together with another key or a click is a chord,
 *    not a Play — Option+M (tuning/debug.ts) and Option+click keep working —
 *    and losing window focus while it's down drops it too. Command is left
 *    alone on purpose: it starts nearly every shortcut, so a bare Command
 *    press is far too easy to do by accident on a live output.
 *
 * `createPlayKey` is the pure state machine for Option; it keeps no clock.
 */

/** Held shorter than this is a tap: an instant send. */
export const PLAY_TAP_MAX_MS = 250;
/** A hold of H ms glides over H * GLIDE_PER_HOLD (3 s held -> 6 s). */
export const GLIDE_PER_HOLD = 2;

/** The glide length a hold earns, or null for a tap (send at once). */
export function glideMsForHold(holdMs: number): number | null {
  if (holdMs < PLAY_TAP_MAX_MS) return null;
  return Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, holdMs * GLIDE_PER_HOLD));
}

export interface PlayKey {
  /** Option went down at `nowMs`. No-op while already held (a second Option
   *  key, or auto-repeat). */
  down(nowMs: number): void;
  /** Option came up. Returns the hold length when it counts as a Play
   *  (nothing else happened in between), null when it was cancelled or never
   *  went down. */
  up(nowMs: number): number | null;
  /** Another key or a click while Option is down: this was a chord. */
  cancel(): void;
  /** Forget everything — the window lost focus, so Option's key-up will never
   *  arrive and the next press must start clean. */
  reset(): void;
  /** How long Option has been held and still counts, null when not. */
  holdMs(nowMs: number): number | null;
}

export function createPlayKey(): PlayKey {
  let downAt: number | null = null;
  let cancelled = false;
  return {
    down(nowMs) {
      if (downAt !== null) return;
      downAt = nowMs;
      cancelled = false;
    },
    up(nowMs) {
      const at = downAt;
      const was = cancelled;
      downAt = null;
      cancelled = false;
      return at === null || was ? null : Math.max(0, nowMs - at);
    },
    cancel() {
      if (downAt !== null) cancelled = true;
    },
    reset() {
      downAt = null;
      cancelled = false;
    },
    holdMs(nowMs) {
      return downAt === null || cancelled ? null : Math.max(0, nowMs - downAt);
    },
  };
}
