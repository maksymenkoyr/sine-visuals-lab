/**
 * What the TV page is doing right now, as one word, so what is on screen is
 * decided in one place (src/tv.ts) instead of by whichever handler ran last.
 *
 * - `pair`: no room yet. The pairing QR and code are up, and this is the only
 *   phase in which they are — a paired TV never shows them again unless the
 *   viewer asks for another pairing (the double-OK gesture in tv.ts), so a
 *   photographed QR stops being useful once the screen has been adopted.
 * - `joining`: adopted (or resumed from the saved session), socket not open yet.
 * - `waiting`: in the room, but no fresh frames — the laptop is not sending.
 *   A saved room outlives the laptop's own (a different laptop, or one back
 *   after its room expired, starts a new one) and the TV never learns of it,
 *   so after WAITING_HINT_AFTER_MS the line also says how to leave (`waitingLine`).
 * - `live`: frames are arriving; nothing but the corner links is drawn over the
 *   visualization.
 *
 * Pure so the transitions are testable. `freshFrames` is the caller's call
 * (tv.ts: a sample exists and the last frame is recent) — it only counts once
 * the socket is open, since a buffer left over from before a drop is not news.
 */

export type TvPhase = "pair" | "joining" | "waiting" | "live";

export function tvPhase(s: { paired: boolean; connected: boolean; freshFrames: boolean }): TvPhase {
  if (!s.paired) return "pair";
  if (!s.connected) return "joining";
  return s.freshFrames ? "live" : "waiting";
}

/** The pill shown in the phases that have a line of text. `pair` has the QR
 *  screen and `live` shows nothing. */
export const TV_PHASE_TEXT: { joining: string; waiting: string } = {
  joining: "Connecting...",
  waiting: "Waiting for laptop...",
};

/** How long a screen waits for the laptop before its line also says how to pair
 *  another phone. Long enough that a laptop that is simply starting up never
 *  sees it, short enough that nobody stares at a dead room. */
export const WAITING_HINT_AFTER_MS = 30_000;

/** The `waiting` line once the wait has lasted a while: the gesture that
 *  forgets the room and brings the QR back (tv.ts has the double press). */
export const WAITING_HINT_TEXT = "Press OK twice to pair another phone";

/** The `waiting` pill after `waitedMs` in that phase. */
export function waitingLine(waitedMs: number): string {
  return waitedMs >= WAITING_HINT_AFTER_MS ? `${TV_PHASE_TEXT.waiting} ${WAITING_HINT_TEXT}` : TV_PHASE_TEXT.waiting;
}
