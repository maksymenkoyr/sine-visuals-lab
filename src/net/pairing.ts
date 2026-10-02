/**
 * Shared vocabulary of the pairing flows: how long each piece of pairing state
 * lives, and how a secret is minted. The flows themselves are split by who
 * runs them — src/net/hostRoom.ts (the laptop's room), src/net/adopt.ts (the
 * phone handing a TV to a room), src/net/bootPlan.ts (what a page load means),
 * src/net/sessions.ts (what each device remembers) — and who may join what is
 * decided server-side in server/roomRules.ts.
 *
 * A key is random bytes, base64url, long enough to pass `validKey`. The laptop
 * mints a host key and a room key for each room (the host key is never put in
 * the QR, the room key rides in it) and a TV mints a one-shot nonce for each
 * pairing slot, which its QR carries. Only `crypto.getRandomValues` feeds them:
 * a key must never come from `Math.random`. The encoding is done by hand rather
 * than through `btoa`, which would want a binary string built first.
 *
 * Code and key validators are re-exported from the room rules rather than
 * redefined, so the client and the Durable Object can never disagree about what
 * a well-formed room code or key looks like.
 */

export { ROOM_CODE_RE, validKey } from "../../server/roomRules.ts";

/** How long an unpaired TV shows one pairing QR before it swaps in a fresh
 *  slot and nonce. Bounds how long a photographed QR stays useful. */
export const TV_SLOT_ROTATE_MS = 10 * 60 * 1000;

/** How long a phone that scanned a TV before the laptop remembers it, waiting
 *  for the laptop scan that completes the pairing. */
export const PENDING_ADOPT_TTL_MS = 10 * 60 * 1000;

/** The oldest a saved laptop room may be and still be resumed on reload; past
 *  this the laptop starts a fresh room (and so a fresh pair of keys). */
export const HOST_ROOM_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Base64url without padding. */
function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64URL[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64URL[b2 & 63];
  }
  return out;
}

/** A fresh secret: random bytes as base64url text, unpadded. */
export function newKey(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}
