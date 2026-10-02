/**
 * Whether the laptop resumes the room it had or starts a new one.
 *
 * A reload keeps the same room, so a phone that has already scanned stays
 * paired and the QR on the laptop never has to be shown twice. Resuming is only
 * safe when all of these hold:
 * - a room was saved (src/net/sessions.ts, kind `host`);
 * - it is younger than HOST_ROOM_MAX_AGE_MS. `ts` is when the room was minted
 *   and a resume must not refresh it, so even a laptop that is never closed
 *   starts over with fresh keys eventually;
 * - this tab holds the `svl-host-room` Web Lock. Two tabs on one laptop share
 *   one localStorage, so without the lock a second tab would resume the same
 *   room and fight the first for the host seat. Taking the lock, and keeping it
 *   for the life of the tab, is the caller's job (src/app.ts); `lockHeld` is
 *   false when the browser has no Web Locks or another tab holds it.
 *
 * Pure so the rule can be tested; creating the room and minting keys is done
 * by the caller (createRoomCode in src/net/room.ts, newKey in
 * src/net/pairing.ts).
 */

import { HOST_ROOM_MAX_AGE_MS } from "./pairing.ts";
import type { HostRoomSession } from "./sessions.ts";

export type HostRoomPlan = { kind: "resume"; session: HostRoomSession } | { kind: "create" };

export function planHostRoom(saved: HostRoomSession | null, now: number, lockHeld: boolean): HostRoomPlan {
  if (saved && lockHeld && now - saved.ts < HOST_ROOM_MAX_AGE_MS) return { kind: "resume", session: saved };
  return { kind: "create" };
}
