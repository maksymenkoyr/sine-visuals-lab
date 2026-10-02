/**
 * What each device remembers between page loads so a reload, a sleeping phone
 * or a power-cycled TV rejoins its room without anyone scanning again.
 *
 * Each `SessionKind` is something a device keeps for the pairing flows
 * (src/net/pairing.ts):
 * - `controller`: the phone's room and room key.
 * - `tv`: the TV's room and room key, once a phone has adopted it.
 * - `host`: the laptop's room with its host key and room key. `ts` is when the
 *   room was minted and a resume must not refresh it, or a laptop left open
 *   would keep one room (and its keys) forever (src/net/hostRoom.ts).
 * - `pending`: a phone that scanned a TV before the laptop. It holds the TV's
 *   slot and nonce just long enough for the laptop scan to complete the
 *   pairing, so it expires (PENDING_ADOPT_TTL_MS); the others last until the
 *   room itself says their keys are dead (a denied join clears them).
 *
 * These are secrets, so the keys are in syncedStores.ts's PRIVATE_KEYS (never
 * mirrored to the pop-out) and don't start with `vibe.` (never part of a look).
 * Callers hand in the device's REAL storage (src/net/realStorage.ts), because a
 * paired phone or TV has swapped `localStorage` for an in-memory overlay that a
 * session must never end up in. Storage is a parameter, not a global, so the
 * functions test in node; null stands for unavailable storage.
 *
 * Reading never throws and trusts nothing: JSON that doesn't parse, a field of
 * the wrong type, a room code or key that fails the room validators all read as
 * "no session". Writing and clearing swallow storage errors (private windows,
 * blocked site data).
 */

import { PENDING_ADOPT_TTL_MS, ROOM_CODE_RE, validKey } from "./pairing.ts";

export type SessionKind = "controller" | "tv" | "host" | "pending";

export interface ControllerSession {
  room: string;
  key: string;
  ts: number;
}

export interface TvSession {
  room: string;
  key: string;
  ts: number;
}

export interface HostRoomSession {
  room: string;
  hostKey: string;
  roomKey: string;
  ts: number;
}

export interface PendingAdopt {
  slot: string;
  nonce: string;
  ts: number;
}

interface SessionMap {
  controller: ControllerSession;
  tv: TvSession;
  host: HostRoomSession;
  pending: PendingAdopt;
}

export type SessionOf<K extends SessionKind> = SessionMap[K];

export const SESSION_KEYS: {
  controller: "svl.controllerSession";
  tv: "svl.tvSession";
  host: "svl.hostRoom";
  pending: "svl.pendingAdopt";
} = {
  controller: "svl.controllerSession",
  tv: "svl.tvSession",
  host: "svl.hostRoom",
  pending: "svl.pendingAdopt",
};

function isRoom(v: unknown): v is string {
  return typeof v === "string" && ROOM_CODE_RE.test(v);
}

function isTs(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

/** Rebuilds the session from only the fields it should have, or null. */
function parseSession(kind: SessionKind, raw: unknown, now: number): SessionMap[SessionKind] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isTs(o.ts)) return null;
  const ts = o.ts;
  switch (kind) {
    case "controller":
    case "tv":
      if (!isRoom(o.room) || !validKey(o.key)) return null;
      return { room: o.room, key: o.key, ts };
    case "host":
      if (!isRoom(o.room) || !validKey(o.hostKey) || !validKey(o.roomKey)) return null;
      return { room: o.room, hostKey: o.hostKey, roomKey: o.roomKey, ts };
    case "pending":
      if (!isRoom(o.slot) || !validKey(o.nonce)) return null;
      if (now - ts > PENDING_ADOPT_TTL_MS) return null;
      return { slot: o.slot, nonce: o.nonce, ts };
  }
}

export function readSession<K extends SessionKind>(
  kind: K,
  storage: Pick<Storage, "getItem"> | null,
  now: number = Date.now(),
): SessionOf<K> | null {
  if (!storage) return null;
  try {
    const text = storage.getItem(SESSION_KEYS[kind]);
    if (text === null) return null;
    return parseSession(kind, JSON.parse(text), now) as SessionOf<K> | null;
  } catch {
    return null;
  }
}

export function writeSession<K extends SessionKind>(
  kind: K,
  value: SessionOf<K>,
  storage: Pick<Storage, "setItem"> | null,
): void {
  if (!storage) return;
  try {
    storage.setItem(SESSION_KEYS[kind], JSON.stringify(value));
  } catch {
    // Storage full or blocked: the session just won't survive a reload.
  }
}

export function clearSession(kind: SessionKind, storage: Pick<Storage, "removeItem"> | null): void {
  if (!storage) return;
  try {
    storage.removeItem(SESSION_KEYS[kind]);
  } catch {
    // Nothing to do; a stale entry is rejected by the room when it's tried.
  }
}
