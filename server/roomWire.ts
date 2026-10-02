/**
 * What the Room Durable Object (server/room.ts) and the browser client
 * (src/net/room.ts) agree on for the small JSON control messages, and the
 * limits the DO holds every peer to. Plain TS with no Workers or DOM types,
 * like server/usage.ts, so both tsconfigs compile it (the root one lists it
 * under "files").
 *
 * The limits are deliberately loose — a legitimate client never comes near
 * them — and they exist so one malformed or hostile peer cannot make the DO
 * throw mid-handler (a deviceId over Cloudflare's 256-char tag limit, an
 * attachment over its 2 KiB limit) or starve the rest of a room. They are
 * not authentication: the 4-character room code is still the only credential,
 * and a socket may still claim the host role (a phone reloading opens its new
 * host socket before the old one is gone, so exclusivity would lock it out).
 */

export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_VIEWPORT: Viewport = { x: 0, y: 0, w: 1, h: 1 };

export interface RosterEntry {
  deviceId: string;
  role: "host" | "renderer";
  scene: string;
  palette: string;
  viewport: Viewport;
}

/** Sockets one room accepts; past it a new upgrade is refused with a 429.
 *  A party is a host, a TV or two and the odd control panel. */
export const MAX_SOCKETS_PER_ROOM = 16;

/** A JSON control message longer than this is dropped unparsed. The largest
 *  real one is a hello or setDevice: a pair of short ids and a viewport. */
export const MAX_CONTROL_CHARS = 1024;

/** A binary message longer than this is dropped. A feature frame is a few
 *  dozen bytes (src/net/protocol.ts); this leaves room for it to grow. */
export const MAX_BINARY_BYTES = 256;

/** Longest scene or palette id the roster keeps — the attachment a socket
 *  carries across hibernation is capped at 2 KiB in total. */
export const MAX_NAME_CHARS = 64;

/** Client ids are crypto.randomUUID() (36 chars); the DO uses them as a
 *  socket tag, which Cloudflare caps at 256 chars. */
export function isValidDeviceId(s: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(s);
}

/** A scene or palette id from a peer, or undefined if it is not a string or
 *  is too long to store. */
export function cleanName(v: unknown): string | undefined {
  return typeof v === "string" && v.length <= MAX_NAME_CHARS ? v : undefined;
}

export function parseViewport(v: unknown): Viewport | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const { x, y, w, h } = o;
  if (typeof x === "number" && typeof y === "number" && typeof w === "number" && typeof h === "number") {
    return { x, y, w, h };
  }
  return undefined;
}
