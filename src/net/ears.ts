/**
 * Whether this page listens to its own input, or draws from another device's
 * frames. The room stores the choice per device (`ears`, server/roomDevices.ts
 * has what the two values mean); this file turns that record, the page's role
 * and a choice the page has just made into one yes/no that src/app.ts asks
 * wherever it decides to open a microphone, show the start prompt, send frames
 * or read them. It is pure: no DOM, no connection, so the rule is tested
 * without a page (tests/ears.test.ts).
 *
 * A solo page has no room and always listens. In a room, the room's record for
 * this device decides, once the roster has listed it. Two cases need an answer
 * before that: the instant before the first roster (the role's default, the
 * same one the room gives a newcomer: the laptop that hosts listens, a phone,
 * an iPad or a TV follows), and the moment after the user taps a choice but
 * before the room has echoed it back (`pending`, which wins, so the tap acts
 * inside the gesture that iPad Safari needs to open the microphone).
 */

import type { Ears } from "../../server/roomDevices.ts";

/** app.ts's `Mode`: no room, the laptop that opened one, or any other member. */
export type PageMode = "solo" | "host" | "renderer";

/** Whether this page analyses its own input. */
export function listensOwn(mode: PageMode, self: { ears: Ears } | null, pending: Ears | null): boolean {
  if (mode === "solo") return true;
  if (pending !== null) return pending === "own";
  if (self) return self.ears === "own";
  return mode === "host";
}

/** What the page does when the answer above changes: open its own input and
 *  feed others, let go of it for a feed's frames, or nothing. */
export type EarsChange = "start-own" | "stop-own" | "none";

export function earsChange(was: boolean, now: boolean): EarsChange {
  if (was === now) return "none";
  return now ? "start-own" : "stop-own";
}
