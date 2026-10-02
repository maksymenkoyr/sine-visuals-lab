/**
 * The JSON vocabulary spoken over a room's WebSocket, and the one place it is
 * parsed. The binary feature frame is a different thing (protocol.ts); these
 * are the small text messages that ride beside it. They are additive and
 * unversioned: a client ignores a `type` it does not know (parseControlMessage
 * returns null), and the room ignores one it does not know, so a new message
 * can ship on either side first.
 *
 * Client to room:
 * - `ping { t0 }` — clock sync, any role; answered with `pong`.
 * - `hello { scene, palette, viewport? }` — a device announcing what it shows;
 *   the room answers by broadcasting `roster`.
 * - `setDevice { targetId, scene?, palette?, viewport? }` — ask another device
 *   (by its roster id) to change; delivered to it as `command`.
 * - `lookGet` — a controller or TV asks for the current look; answered with `look`.
 * - `lookPatch { n, ...patch }` — a controller edits the look (server/lookDoc.ts
 *   has the patch semantics). Only a controller may; `n` numbers the patch so
 *   the sender can match the reply.
 * - `endRoom` — the host of a claimed room ends it (the laptop's Reset). The
 *   room wipes its claim and look, sends every socket `ended`, and closes each
 *   with the denial code, so every device forgets the room as it would a dead
 *   one.
 *
 * Room to client:
 * - `pong { t0, tServer }`, `roster { devices }` (a phone controller is never
 *   listed, so it is invisible to the Room panel and to the host's wait-for-
 *   company check), `command { scene?, palette?, viewport? }`.
 * - `look { rev, doc }` — the whole look. Pushed when a controller or TV joins a
 *   claimed room, and as the reply to `lookGet`. `doc` is null until the first
 *   patch has ever applied.
 * - `lookPatch { rev, ...patch }` — what another controller changed, only the
 *   entries that actually differed, to every controller and TV but the sender.
 *   `rev` is the room's revision after it; a receiver that sees a hole asks
 *   for `lookGet` (src/net/lookSync.ts owns that rule).
 * - `lookAck { n, rev }` / `lookReject { n, reason }` — the replies to the
 *   sender's patch. `reason` is a `LookRejectReason` (server/lookDoc.ts):
 *   `role` (not a controller), `size` (past the limits in `LOOK_LIMITS`) or
 *   `shape` (not a valid patch).
 * - `ended` — the host ended the room (`endRoom`). It means what a denial
 *   close means, and comes just before that close because the close alone is
 *   not enough: a close the room starts on a socket other than the one whose
 *   message it is handling can leave that client stuck closing (seen under
 *   `wrangler dev`), and a TV stuck there would sit in the dead room.
 *
 * Phone-to-TV adoption does not come from a room's own state: `adopt { room,
 * k, n }`. A TV waiting to be paired sits alone in a throwaway room; the phone's
 * HTTP request to that room is delivered to the waiting screen that holds the
 * nonce, as this message (server/worker.ts has the route). The TV checks `n`
 * against the nonce in the QR it is showing; parseAdoptMessage only checks the
 * shape. A laptop has no QR to read, so its request may leave `n` out and the
 * message then has none.
 *
 * Everything here is untrusted input. A look document or patch is cleaned by
 * the same functions the room uses (server/lookDoc.ts), so what a client holds
 * always satisfies the limits whoever sent it. Nothing in this file throws.
 *
 * Pure on purpose — no DOM, no config — so tests can drive it in node.
 */

import type { Viewport } from "../render/scene.ts";
import { sanitizeLookDoc, sanitizeLookPatch, type LookRejectReason, type LookServerMsg } from "../../server/lookDoc.ts";
import { ROOM_CODE_RE, validKey, type RoomRole } from "../../server/roomRules.ts";

export interface RosterEntry {
  deviceId: string;
  role: RoomRole;
  scene: string;
  palette: string;
  viewport: Viewport;
}

export interface DeviceCommand {
  scene?: string;
  palette?: string;
  viewport?: Viewport;
}

export type ControlMessage =
  | { type: "pong"; t0: number; tServer: number }
  | { type: "roster"; devices: RosterEntry[] }
  | ({ type: "command" } & DeviceCommand)
  | { type: "ended" }
  | LookServerMsg;

export interface AdoptMessage {
  type: "adopt";
  room: string;
  k: string;
  /** Absent when the laptop adopted the screen by its typed code alone. */
  n?: string;
}

const FULL_VIEWPORT: Viewport = { x: 0, y: 0, w: 1, h: 1 };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** A revision or a patch number: a whole number from zero up. */
function isCount(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
}

function isRejectReason(x: unknown): x is LookRejectReason {
  return x === "role" || x === "size" || x === "shape";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseViewport(v: unknown): Viewport | undefined {
  if (!isRecord(v)) return undefined;
  const { x, y, w, h } = v;
  if (typeof x === "number" && typeof y === "number" && typeof w === "number" && typeof h === "number") {
    return { x, y, w, h };
  }
  return undefined;
}

function parseRosterEntry(raw: unknown): RosterEntry | null {
  if (!isRecord(raw)) return null;
  const { deviceId, role } = raw;
  if (typeof deviceId !== "string") return null;
  if (role !== "host" && role !== "renderer" && role !== "controller") return null;
  return {
    deviceId,
    role,
    scene: typeof raw.scene === "string" ? raw.scene : "",
    palette: typeof raw.palette === "string" ? raw.palette : "",
    viewport: parseViewport(raw.viewport) ?? FULL_VIEWPORT,
  };
}

/** Text from the room as a typed message, or null for anything that is not
 *  one this client understands (binary frames never get here). */
export function parseControlMessage(data: unknown): ControlMessage | null {
  if (typeof data !== "string") return null;
  const m = parseJson(data);
  if (!isRecord(m)) return null;

  if (m.type === "pong" && typeof m.t0 === "number" && typeof m.tServer === "number") {
    return { type: "pong", t0: m.t0, tServer: m.tServer };
  }
  if (m.type === "roster" && Array.isArray(m.devices)) {
    const devices: RosterEntry[] = [];
    for (const d of m.devices) {
      const entry = parseRosterEntry(d);
      if (entry) devices.push(entry);
    }
    return { type: "roster", devices };
  }
  if (m.type === "command") {
    return {
      type: "command",
      scene: typeof m.scene === "string" ? m.scene : undefined,
      palette: typeof m.palette === "string" ? m.palette : undefined,
      viewport: parseViewport(m.viewport),
    };
  }
  if (m.type === "ended") return { type: "ended" };

  if (m.type === "look") {
    if (!isCount(m.rev)) return null;
    if (m.doc === null) return { type: "look", rev: m.rev, doc: null };
    const doc = sanitizeLookDoc(m.doc);
    return doc ? { type: "look", rev: m.rev, doc } : null;
  }
  if (m.type === "lookPatch") {
    if (!isCount(m.rev)) return null;
    const cleaned = sanitizeLookPatch(m);
    return cleaned.ok ? { type: "lookPatch", rev: m.rev, ...cleaned.patch } : null;
  }
  if (m.type === "lookAck") {
    return isCount(m.n) && isCount(m.rev) ? { type: "lookAck", n: m.n, rev: m.rev } : null;
  }
  if (m.type === "lookReject") {
    if (!isRejectReason(m.reason)) return null;
    if (m.n === null) return { type: "lookReject", n: null, reason: m.reason };
    return isCount(m.n) ? { type: "lookReject", n: m.n, reason: m.reason } : null;
  }
  return null;
}

/** The room's relay of a phone's adopt request, from the raw socket text (an
 *  already-parsed object is accepted too). The shape only: whether `n` is the
 *  nonce this TV is showing is the caller's check. */
export function parseAdoptMessage(data: unknown): AdoptMessage | null {
  const m = typeof data === "string" ? parseJson(data) : data;
  if (!isRecord(m) || m.type !== "adopt") return null;
  const { room, k, n } = m;
  if (typeof room !== "string" || !ROOM_CODE_RE.test(room) || !validKey(k)) return null;
  if (n === undefined) return { type: "adopt", room, k };
  if (!validKey(n)) return null;
  return { type: "adopt", room, k, n };
}
