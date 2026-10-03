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
 * - `hello { scene, palette, viewport?, kind?, hasMic?, autoQuality? }` — a
 *   device announcing what it shows, and optionally what it is: its `kind` and
 *   whether it can open a microphone, the same two things the join URL
 *   carries. A TV adds `autoQuality`, the preset its GPU benchmark picks (what
 *   its `quality: "auto"` renders at). The room answers by broadcasting
 *   `roster`. The room never takes a name from a
 *   hello; a name is chosen with `deviceSet`.
 * - `deviceSet { targetId, name?, ears?, follow?, screen?, quality? }` — change one
 *   member's settings (server/roomDevices.ts says what each means and who may
 *   ask). Any member of a claimed room may; the answer is a new `roster`, or
 *   `deviceReject` when the room refused.
 * - `deviceForget { targetId }` — the owner removes a member from the room. The
 *   room sends that device `ended` with reason `removed` and closes it.
 * - `lookGet` — a member asks for the current look; answered with `look`.
 * - `lookPatch { n, ...patch }` — a member edits the look (server/lookDoc.ts
 *   has the patch semantics). Any member of a claimed room may, the laptop
 *   included (publishing with Cue and Play, net/roomBridge.ts); `n` numbers the
 *   patch so the sender can match the reply. A patch may carry `glideMs`:
 *   screens arrive at the look it makes over that long instead of switching.
 * - `endRoom` — the host of a claimed room ends it (the laptop's Reset). The
 *   room wipes its claim and look, sends every socket `ended`, and closes each
 *   with the denial code, so every device forgets the room as it would a dead
 *   one.
 *
 * Room to client:
 * - `pong { t0, tServer }`.
 * - `roster { devices }` — every member of a claimed room, online or not, with
 *   what the room stores for it: `kind`, `name`, `hasMic`, `ears`, `follow`,
 *   `screen`, `quality`, `online`, `owner` (and what it shows now: `scene`,
 *   `palette`, `viewport`, and a TV's `autoQuality` while it is online). An unclaimed (legacy) room sends only the older fields, and
 *   parseRosterEntry fills the rest with what such a device would have been
 *   given. `recordsFromRoster` turns a roster into the records that
 *   server/roomDevices.ts reads, so the client asks the same `feedOf` and
 *   `pictureDelayMs` the room does.
 * - `deviceReject { targetId, reason }` — the room refused a `deviceSet` or
 *   `deviceForget` this device sent; `reason` is a `DeviceRejectReason`.
 * - `look { rev, doc }` — the whole look. Pushed when any member joins a
 *   claimed room (the laptop included), and as the reply to `lookGet`. `doc`
 *   is null until the first patch has ever applied.
 * - `lookPatch { rev, by?, ...patch }` — what another member changed, only the
 *   entries that actually differed, to every member but the sender, with the
 *   `glideMs` it came with. `by` is the sender's device id (absent from an
 *   older room), so a receiver can tell whose change it is. `rev` is the
 *   room's revision after it; a receiver that sees a hole asks for `lookGet`
 *   (src/net/lookSync.ts owns that rule).
 * - `lookAck { n, rev }` / `lookReject { n, reason }` — the replies to the
 *   sender's patch. `reason` is a `LookRejectReason` (server/lookDoc.ts):
 *   `role` (not a member that may), `size` (past the limits in `LOOK_LIMITS`)
 *   or `shape` (not a valid patch).
 * - `ended { reason? }` — the room is closed to this device: the host ended it
 *   (`endRoom`), or the owner removed this device (reason `removed`). It means
 *   what a denial close means, and comes just before that close because the
 *   close alone is not enough: a close the room starts on a socket other than
 *   the one whose message it is handling can leave that client stuck closing
 *   (seen under `wrangler dev`), and a TV stuck there would sit in the dead
 *   room.
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
import {
  cleanName,
  defaultName,
  kindForRole,
  parseEars,
  parseKind,
  parseQuality,
  parsePreset,
  parseScreen,
  type DeviceKind,
  type DeviceRecord,
  type Ears,
  type ScreenPreset,
  type ScreenQuality,
  type ScreenUse,
} from "../../server/roomDevices.ts";

/** One member of the room as the room lists it: what it shows right now
 *  (scene, palette, viewport) and what the room stores for it
 *  (server/roomDevices.ts says what each setting means). */
export interface RosterEntry {
  deviceId: string;
  role: RoomRole;
  scene: string;
  palette: string;
  viewport: Viewport;
  kind: DeviceKind;
  name: string;
  hasMic: boolean;
  ears: Ears;
  /** The feed this device listens through (a device id), or null for the owner. */
  follow: string | null;
  screen: ScreenUse;
  /** The quality a TV renders at (server/roomDevices.ts). */
  quality: ScreenQuality;
  /** What `quality: "auto"` resolves to on this device: the preset its own GPU
   *  benchmark picked, as its hello said. Null until a TV has said it, and for
   *  every other device. */
  autoQuality: ScreenPreset | null;
  /** Has a live socket in the room right now. */
  online: boolean;
  owner: boolean;
}

/** Why the room refused a `deviceSet`: the first four are
 *  server/roomDevices.ts's `DeviceSetResult`; `shape` is a message that is not
 *  a valid one, `rate` is too many changes too quickly. */
export type DeviceRejectReason = "unknown" | "no-mic" | "tv-off" | "bad-follow" | "shape" | "rate";

export interface DeviceReject {
  type: "deviceReject";
  /** The device the refused change was aimed at; null when the message named none. */
  targetId: string | null;
  reason: DeviceRejectReason;
}

export type ControlMessage =
  | { type: "pong"; t0: number; tServer: number }
  | { type: "roster"; devices: RosterEntry[] }
  | DeviceReject
  | { type: "ended"; reason?: "removed" }
  | LookServerMsg;

export interface AdoptMessage {
  type: "adopt";
  room: string;
  k: string;
  /** Absent when the laptop adopted the screen by its typed code alone. */
  n?: string;
}

const FULL_VIEWPORT: Viewport = { x: 0, y: 0, w: 1, h: 1 };

/** A device id as it rides on a relayed patch's `by`: 1 to 64 letters, digits, `_` or `-`. */
const BY_RE = /^[\w-]{1,64}$/;

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

function isDeviceRejectReason(x: unknown): x is DeviceRejectReason {
  return x === "unknown" || x === "no-mic" || x === "tv-off" || x === "bad-follow" || x === "shape" || x === "rate";
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
  // A room that has not claimed its devices sends only deviceId, role, scene,
  // palette and viewport; the rest default to what that role would have been
  // given.
  const kind = parseKind(raw.kind) ?? kindForRole(role);
  return {
    deviceId,
    role,
    scene: typeof raw.scene === "string" ? raw.scene : "",
    palette: typeof raw.palette === "string" ? raw.palette : "",
    viewport: parseViewport(raw.viewport) ?? FULL_VIEWPORT,
    kind,
    name: cleanName(raw.name) ?? defaultName(kind),
    hasMic: typeof raw.hasMic === "boolean" ? raw.hasMic : role !== "renderer",
    ears: parseEars(raw.ears) ?? (role === "host" ? "own" : "follow"),
    follow: typeof raw.follow === "string" ? raw.follow : null,
    screen: parseScreen(raw.screen) ?? "main",
    quality: parseQuality(raw.quality) ?? "auto",
    autoQuality: parsePreset(raw.autoQuality) ?? null,
    online: raw.online !== false,
    owner: raw.owner === true || (raw.owner === undefined && role === "host"),
  };
}

/** A roster as the records server/roomDevices.ts works on (`feedOf`,
 *  `followersOf`, `pictureDelayMs`), plus the ids of the members that are
 *  online. The roster is in the room's order (owner first, then by when each
 *  joined), so `added` is the position; when each was last seen is not on the
 *  wire, so `seen` is 0. */
export function recordsFromRoster(roster: RosterEntry[]): { records: Map<string, DeviceRecord>; online: Set<string> } {
  const records = new Map<string, DeviceRecord>();
  const online = new Set<string>();
  roster.forEach((e, i) => {
    records.set(e.deviceId, {
      name: e.name,
      ears: e.ears,
      follow: e.follow,
      screen: e.screen,
      quality: e.quality,
      kind: e.kind,
      hasMic: e.hasMic,
      role: e.role,
      added: i,
      seen: 0,
    });
    if (e.online) online.add(e.deviceId);
  });
  return { records, online };
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
  if (m.type === "deviceReject") {
    if (!isDeviceRejectReason(m.reason)) return null;
    return { type: "deviceReject", targetId: typeof m.targetId === "string" ? m.targetId : null, reason: m.reason };
  }
  if (m.type === "ended") return m.reason === "removed" ? { type: "ended", reason: "removed" } : { type: "ended" };

  if (m.type === "look") {
    if (!isCount(m.rev)) return null;
    if (m.doc === null) return { type: "look", rev: m.rev, doc: null };
    const doc = sanitizeLookDoc(m.doc);
    return doc ? { type: "look", rev: m.rev, doc } : null;
  }
  if (m.type === "lookPatch") {
    if (!isCount(m.rev)) return null;
    const cleaned = sanitizeLookPatch(m);
    if (!cleaned.ok) return null;
    const by = typeof m.by === "string" && BY_RE.test(m.by) ? m.by : undefined;
    return by === undefined
      ? { type: "lookPatch", rev: m.rev, ...cleaned.patch }
      : { type: "lookPatch", rev: m.rev, by, ...cleaned.patch };
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
