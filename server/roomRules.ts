/**
 * Who may join a room, and who may say what once inside — the rules, with no
 * sockets in sight so tests can drive every case (server/roomCore.ts applies
 * them to live sockets; server/room.ts is the Cloudflare adapter around that).
 *
 * Roles. The laptop is the `host`: it plays and analyses the music and is the
 * only role whose binary frames are relayed. A phone is a `controller`: it
 * edits the room's look (server/lookDoc.ts) and may also watch frames. A TV is
 * a `renderer`: it draws from the host's frames and the look.
 *
 * The host key and the room key are separate on purpose. The host key never
 * goes into the QR or to another device, but the laptop does present it to the
 * room, in the `hk` query value of its connect URL, to claim and to rejoin; the
 * room key (`k`) is what the laptop's QR carries and what phones and TVs
 * present. Whoever photographs the QR can therefore change settings (that is
 * what the QR is for) but cannot inject frames as the host. Keys travel in
 * URLs, so the platform's own request handling can see them; the room itself
 * never logs them and stores only SHA-256 hashes of the keys, comparing them
 * in constant time.
 *
 * Claiming. An unclaimed room is a legacy room: a keyless host and keyless
 * renderers relay frames exactly as before keys existed (how old links and old
 * TV tabs keep working), and nobody there can see or edit a look. Only a host
 * that presents both keys claims a room — trust on first use by the laptop —
 * and from then on every join must present the right key for its role. A
 * controller can never create or claim a room. hashKey is async, so the
 * adapter hashes first and the core then calls decideJoin and writes the claim
 * with no `await` in between, so concurrent claimants cannot interleave.
 *
 * Denial is a WebSocket close with ROOM_CLOSE_DENIED, uniform for an unknown
 * room, a wrong key and a wrong role. A browser WebSocket cannot read an HTTP
 * status, so a close code is the only way a client can tell "these credentials
 * are dead, forget them" from "the network blinked, retry"; being uniform, it
 * also lets nobody probe which rooms exist. Any other close is transient.
 *
 * A claimed room that has been empty for ROOM_IDLE_TTL_MS is wiped and is
 * unclaimed again.
 *
 * Pairing slot. A TV that has no room yet waits in a throwaway unclaimed room,
 * and the phone's adopt request is delivered there. The slot's code is printed
 * on the TV, so anyone may sit in it as a keyless renderer; the adopt carries
 * the room key, so it must not reach them. The TV therefore joins with the
 * nonce its QR carries, which the room turns into an `adoptTag`, and the adopt
 * goes only to sockets under the tag of the nonce it presents. The tag is
 * never in the roster (the roster lists device ids), so a bystander cannot
 * learn it.
 *
 * Plain TS with no DOM or Workers types: the client imports the validators and
 * the tests import everything, so this file is listed in the root tsconfig
 * `files` like server/usage.ts.
 */

import { LOOK_LIMITS } from "./lookDoc.ts";

export type RoomRole = "host" | "controller" | "renderer";

/** The shape of the room code every room address uses (no look-alike characters). */
export const ROOM_CODE_RE = /^[A-Z2-9]{4}$/;

/** WebSocket close code for a refused join; every other close code is transient. */
export const ROOM_CLOSE_DENIED = 4003;

/** Sockets one room accepts; past it a new upgrade is refused with HTTP 429.
 *  A party is a host, a TV or two and a few phones. Not a credential check, so
 *  not a ROOM_CLOSE_DENIED: the client sees a transient close and redials. */
export const MAX_SOCKETS_PER_ROOM = 16;

/** How long a claimed room may sit with no socket before it is wiped. */
export const ROOM_IDLE_TTL_MS = 24 * 60 * 60 * 1000;

/** Names the Durable Object already uses as socket tags (role tags, and the
 *  tag a frame-watching controller carries), so a device id can't be one. */
export const RESERVED_TAGS: ReadonlySet<string> = new Set(["host", "renderer", "controller", "frames"]);

const DEVICE_ID_RE = /^[\w-]+$/;
const KEY_RE = /^[A-Za-z0-9_-]{22,64}$/;

/** The role named by a query value: absent or empty is `renderer` (what a
 *  client that predates roles sends); anything unknown is null (denied). */
export function parseRole(raw: string | null): RoomRole | null {
  if (raw === null || raw === "") return "renderer";
  if (raw === "host" || raw === "controller" || raw === "renderer") return raw;
  return null;
}

export function validDeviceId(s: unknown): s is string {
  return (
    typeof s === "string" &&
    s.length >= 1 &&
    s.length <= LOOK_LIMITS.maxDeviceIdChars &&
    DEVICE_ID_RE.test(s) &&
    !RESERVED_TAGS.has(s)
  );
}

/** The socket tag of a TV waiting in a pairing slot, made from the nonce in its
 *  QR. The colon keeps it apart from every device id and role tag. */
export function adoptTag(nonce: string): string {
  return `adopt:${nonce}`;
}

/** A `setDevice` target is addressed by its socket tag, so it must be a
 *  legal device id — never a role tag, which would fan the command out. */
export function validTargetTag(s: unknown): s is string {
  return validDeviceId(s);
}

/** The shape of a room key or host key (minted by the laptop, base64url). */
export function validKey(s: unknown): s is string {
  return typeof s === "string" && KEY_RE.test(s);
}

/** SHA-256 of a key as lowercase hex. The room keeps only these. */
export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Compares two hex digests without stopping at the first difference. The
 *  length is not secret (digests are fixed-size), so a mismatch there returns early. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface RoomMeta {
  v: 1;
  hostKeyHash: string;
  roomKeyHash: string;
  claimedAt: number;
}

/** What a joining socket presented: the role it asked for and the hashes of
 *  its `hk` / `k` query values (null when absent). */
export interface JoinRequest {
  role: RoomRole;
  hostKeyHash: string | null;
  roomKeyHash: string | null;
}

/** `claim`: persist this join's keys as the room's meta. `keyed`: the room is
 *  claimed, so the look and the stricter send rules apply to this socket. */
export type JoinDecision = { ok: true; claim: boolean; keyed: boolean } | { ok: false };

const DENY: JoinDecision = { ok: false };

/** `meta` is the room's stored claim, or null while unclaimed. */
export function decideJoin(meta: RoomMeta | null, req: JoinRequest): JoinDecision {
  const { role, hostKeyHash, roomKeyHash } = req;

  if (meta === null) {
    if (role === "host") {
      if (hostKeyHash !== null && roomKeyHash !== null) return { ok: true, claim: true, keyed: true };
      if (hostKeyHash === null && roomKeyHash === null) return { ok: true, claim: false, keyed: false };
      return DENY;
    }
    // A renderer may join an unclaimed room only the old keyless way; one
    // carrying a key is looking for a claimed room that is not there.
    if (role === "renderer" && hostKeyHash === null && roomKeyHash === null) {
      return { ok: true, claim: false, keyed: false };
    }
    return DENY;
  }

  if (role === "host") {
    if (hostKeyHash !== null && safeEqualHex(hostKeyHash, meta.hostKeyHash)) {
      return { ok: true, claim: false, keyed: true };
    }
    return DENY;
  }
  if (roomKeyHash !== null && safeEqualHex(roomKeyHash, meta.roomKeyHash)) {
    return { ok: true, claim: false, keyed: true };
  }
  return DENY;
}

export type SendKind = "binary" | "ping" | "hello" | "setDevice" | "lookGet" | "lookPatch";

/** Whether a socket of `role` may send a message of this kind (the messages
 *  are described in src/net/roomMessages.ts). `keyed` only matters for
 *  `setDevice`: in a claimed room a renderer may not command other devices. The look
 *  kinds are looked at by role alone — a legacy room has no look, so the
 *  core ignores them there before it ever asks, and a `lookPatch` that this
 *  refuses (host, renderer) is answered with a `lookReject` rather than
 *  dropped, which is the core's job too. */
export function canSend(keyed: boolean, role: RoomRole, kind: SendKind): boolean {
  switch (kind) {
    case "binary":
      return role === "host";
    case "ping":
    case "hello":
      return true;
    case "setDevice":
      return role === "renderer" ? !keyed : true;
    case "lookGet":
      return role !== "host";
    case "lookPatch":
      return role === "controller";
  }
}
