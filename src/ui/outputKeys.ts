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
 *    macOS's own and never reach the page; Ctrl or Shift held makes it not
 *    ours, and so does Cmd unless it is the right Command key already down as
 *    Play (spaceIsCue). Play while Cue is held sends what the Cue shows as the
 *    new look, and Space's auto-repeat then carries that Play key's modifier —
 *    it must not read as the chord that cancels the Play.
 *  - Play is a bare press of a Play key (isPlayKey). Enter (Return on a Mac)
 *    is the main one on every platform: a big key, the same on a Mac and a PC
 *    keyboard, and no system anywhere does anything with Enter+Space, so
 *    Play while Cue is held is safe — every modifier next to Space is taken
 *    with Space by some system (⌘ Spotlight, ⌃ input source on a Mac; Alt the
 *    window menu, Win the input language on a PC). app.ts claims it in the
 *    capture phase too, so it doesn't also press the focused button. Option
 *    (Alt) plays everywhere as well — on a Mac Option+Space is free — and on a
 *    Mac so does the right Command key, the thumb key touching Space, though
 *    ⌘+Space may open Spotlight when it's pressed with Cue held. GitHub issue
 *    #341 is the task to tell people about these two and let them turn them
 *    off. A quick tap sends the look across at once, a longer hold charges and,
 *    on release, glides there over GLIDE_PER_HOLD times the hold
 *    (net/outputGlide.ts says what moves smoothly). A Play key held together
 *    with another key or a click is a chord, not a Play — Option+M
 *    (tuning/debug.ts), Option+click and every right-Command shortcut keep
 *    working — and losing window focus while it's down drops it too. The left
 *    Command key is left alone on purpose: it starts nearly every shortcut, so
 *    a bare press of it is far too easy to do by accident on a live output.
 *    Off a Mac the right Command position is the Windows / Super key, which
 *    opens the system's own menu, so it never plays there.
 *  - macOS delivers no key-up for any other key while Command is down, so a
 *    Space (or K) let go during a right-Command Play would leave the Cue held
 *    for good. app.ts lets the Cue go when the right Command key comes up:
 *    after a Play the output already shows what the Cue showed, so that's
 *    invisible.
 *
 * `createPlayKey` is the pure state machine for a Play key; it keeps no clock.
 */

/** The parts of a KeyboardEvent the predicates below read. */
export interface KeyLike {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** The right Command key, a Play key on a Mac. */
export const RIGHT_CMD = "MetaRight";

/** True for a Mac's user agent — iPadOS Safari's desktop agent included: an
 *  iPad keyboard has a right Command key too. */
export function isMacAgent(userAgent: string): boolean {
  return /Macintosh|Mac OS X/.test(userAgent);
}

/** A key-down that starts a Play: Enter (the main keyboard's or the
 *  keypad's), Option, or on a Mac the right Command key, with no other
 *  modifier held. */
export function isPlayKey(e: KeyLike, mac: boolean): boolean {
  if (e.key === "Enter") return !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
  if (e.key === "Alt") return !e.ctrlKey && !e.metaKey && !e.shiftKey;
  if (mac && e.code === RIGHT_CMD) return !e.ctrlKey && !e.altKey && !e.shiftKey;
  return false;
}

/** Whether a Space key-down is Cue's, given which key is holding a Play down
 *  (its `code`, or null). Option may ride along always (Enter sets no
 *  modifier); Command only while it is the right Command key held as Play. */
export function spaceIsCue(e: KeyLike, playHeldBy: string | null): boolean {
  if (e.code !== "Space" || e.ctrlKey || e.shiftKey) return false;
  return !e.metaKey || playHeldBy === RIGHT_CMD;
}

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
  /** A Play key went down at `nowMs`. No-op while already held (a second Play
   *  key, or auto-repeat). */
  down(nowMs: number): void;
  /** The Play key came up. Returns the hold length when it counts as a Play
   *  (nothing else happened in between), null when it was cancelled or never
   *  went down. */
  up(nowMs: number): number | null;
  /** Another key or a click while a Play key is down: this was a chord. */
  cancel(): void;
  /** Forget everything — the window lost focus, so the Play key's key-up will
   *  never arrive and the next press must start clean. */
  reset(): void;
  /** How long the Play key has been held and still counts, null when not. */
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
