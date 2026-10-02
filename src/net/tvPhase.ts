/**
 * What the TV page is doing right now, as one word, so what is on screen is
 * decided in one place (src/tv.ts) instead of by whichever handler ran last.
 *
 * - `pair`: no room yet. The pairing QR and code are up, and this is the only
 *   phase in which they are — a paired TV never shows them again unless the
 *   viewer asks for another pairing (its Reset button, or the double-OK gesture
 *   in tv.ts), so a photographed QR stops being useful once the screen has
 *   been adopted.
 * - `joining`: adopted (or resumed from the saved session), socket not open yet.
 * - `waiting`: in the room, but no fresh frames — the laptop is not sending.
 *   The room's roster says which of two very different things that is
 *   (`waitingLine`): the laptop is in the room but hears nothing yet (it sits
 *   on the gallery with no source picked), or it is not in the room at all. A
 *   saved room outlives the laptop's own (a different laptop, or one back
 *   after its room expired, starts a new one) and the TV never learns of it,
 *   which is why `joining` and `waiting` put the Reset button in focus.
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
 *  screen and `live` shows nothing; `waiting` is `waitingLine`'s. */
export const TV_PHASE_TEXT: { joining: string; waiting: string } = {
  joining: "Connecting...",
  waiting: "Waiting for laptop...",
};

/** Whether the room's roster lists a host: `null` until this socket has had a
 *  roster at all. */
export type HostInRoom = boolean | null;

/** The `waiting` pill. With no roster yet it is the plain line; then it says
 *  whether the laptop is there and silent, or gone. */
export function waitingLine(hostInRoom: HostInRoom): string {
  if (hostInRoom === null) return TV_PHASE_TEXT.waiting;
  return hostInRoom ? "The laptop is here but not listening. Start Mic or Share a tab on it" : "The laptop isn't in this room";
}

/** The roster's answer for `waitingLine`. */
export function hostInRoster(roster: ReadonlyArray<{ role: string }>): boolean {
  return roster.some((d) => d.role === "host");
}
