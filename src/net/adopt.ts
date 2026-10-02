/**
 * The phone's half of adding a TV to a room.
 *
 * An unpaired TV waits in a throwaway slot of its own (a plain keyless room
 * holding just its socket) and shows a QR carrying that slot's code and a
 * one-shot nonce. The phone scans it and POSTs the room it controls, the room
 * key and the nonce to the slot. The Durable Object delivers that only to the
 * waiting screen that holds the nonce (the TV presents it when it joins the
 * slot; server/roomRules.ts, "Pairing slot"), so a bystander sitting in the
 * slot (its code is on the TV) never receives the room key. The TV checks the
 * nonce again and joins the room; the server keeps nothing from the request
 * itself, and a POST whose nonce no waiting screen holds reaches nobody (the
 * route is in server/worker.ts, the delivered `adopt` message in
 * src/net/roomMessages.ts).
 *
 * `origin` is a parameter, not read from src/net/config.ts, so this module
 * tests in node with a fake `fetch`. The caller passes WORKER_ORIGIN: in dev the
 * Worker is a different origin from the page. The outcome is deliberately
 * coarse; it only has to pick the sentence the phone shows:
 * - ok: a waiting screen held the nonce and was told.
 * - no-screen: no waiting screen took it (the TV rotated, was closed, or the
 *   slot code or nonce was misread).
 * - ambiguous: a code-only adopt found more than one socket waiting in the slot,
 *   so the room delivered nothing (server/roomCore.ts `adopt`).
 * - throttled: this address has sent too many adopts lately.
 * - error: anything else, including the network being down.
 */

import { ROOM_CODE_RE } from "./pairing.ts";

export type AdoptOutcome = "ok" | "no-screen" | "ambiguous" | "throttled" | "error";

export async function postAdopt(
  origin: string,
  slot: string,
  body: { room: string; k: string; n?: string },
  fetchFn: typeof fetch = fetch,
): Promise<AdoptOutcome> {
  // The slot goes into the path, so it must be a plain room code.
  if (!ROOM_CODE_RE.test(slot)) return "error";
  try {
    const res = await fetchFn(`${origin.replace(/\/+$/, "")}/api/room/${slot}/adopt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 200) return "ok";
    if (res.status === 404) return "no-screen";
    if (res.status === 409) return "ambiguous";
    if (res.status === 429) return "throttled";
    return "error";
  } catch {
    return "error";
  }
}
