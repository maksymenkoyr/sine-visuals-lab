/**
 * Everything a room does, over injected sockets, storage and clock — so
 * Vitest can drive a whole room with fakes. server/room.ts is the thin
 * Cloudflare adapter around this (it owns the WebSocketPair, the hibernation
 * calls and `ctx.storage`); the rules themselves are server/roomRules.ts (who
 * may join, who may send what), server/roomDevices.ts (the device records:
 * name, ears, screen) and server/lookDoc.ts (the look document and its
 * patch). The messages are described in src/net/roomMessages.ts.
 *
 * The room stays a relay. A claimed room keeps one record per device that ever
 * joined it (`d:<deviceId>` rows, so a device that drops and comes back keeps
 * its choices), and relays feature frames from each device that is on its own
 * input (a feed) to the devices that follow it, as unparsed bytes, capped in
 * size and nothing more; a device that isn't a feed has its frames dropped. A
 * room nobody has claimed is the legacy relay: the host's frames go to every
 * renderer. The JSON it understands is small: clock-sync ping/pong, the device
 * roster (sent on every join, leave, hello and device change), `deviceSet` and
 * `deviceForget` against the records, the TV adopt relay (delivered by nonce
 * tag, see `adopt`), and, in a claimed room only, the look — which goes to
 * every member, the laptop included, with the id of the member whose patch it
 * is — and the host's `endRoom` (the laptop's Reset, see `end`). The room never
 * interprets a setting; a look entry is an opaque string it stores and relays.
 * A member's patches and device changes are rationed per socket (LOOK_LIMITS
 * `patchBurst` and `patchesPerSec`) because each accepted one is durable row
 * writes.
 *
 * A Durable Object that hibernates loses every instance field, so what must
 * outlive that is written as flat rows: the claim (hashed keys), the look's
 * revision and ids, one row per look key and one per device record. The
 * constructor rebuilds the in-memory state from those rows; every later change
 * writes only the rows it touched. A claimed room that has no socket left
 * schedules a wipe (the idle alarm); an accepted socket cancels it. No timer
 * ever runs while a socket is connected, so hibernation is preserved.
 *
 * Plain TS with no Workers or DOM types: the root tsconfig lists this file
 * (`files`) because the tests import it, the same arrangement as
 * server/usage.ts.
 */

import {
  LOOK_LIMITS,
  applyLookPatch,
  emptyLookDoc,
  sanitizeLookDoc,
  sanitizeLookPatch,
  validLookKey,
  type LookDoc,
  type LookServerMsg,
} from "./lookDoc.ts";
import {
  ROOM_CLOSE_DENIED,
  ROOM_CODE_RE,
  ROOM_IDLE_TTL_MS,
  ADOPT_ANY_TAG,
  adoptTag,
  canSend,
  decideJoin,
  parseRole,
  validDeviceId,
  validKey,
  type RoomMeta,
  type RoomRole,
} from "./roomRules.ts";
import {
  DEVICE_LIMITS,
  applyDeviceSet,
  cleanName,
  defaultSettings,
  feedOf,
  followersOf,
  forgetDevice,
  kindForRole,
  ownerId,
  parseKind,
  parseRecord,
  sanitizeDeviceSet,
  type DeviceKind,
  type DeviceRecord,
} from "./roomDevices.ts";

export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_VIEWPORT: Viewport = { x: 0, y: 0, w: 1, h: 1 };

/** What a socket carries across hibernation (`serializeAttachment`, which
 *  caps it small — keep it to ids and short strings). `sid` is unique per
 *  socket and is what dedupes and excludes senders; `keyed` says the socket
 *  joined a claimed room, so the stricter send rules and the look apply.
 *  `kind` and `hasMic` are what the device said it is (the join URL, then
 *  `hello`); `joinName` is the name it asked for, kept only until the room
 *  makes its record. */
export interface Attachment {
  sid: string;
  role: RoomRole;
  deviceId: string;
  scene: string;
  palette: string;
  viewport: Viewport;
  keyed: boolean;
  kind: DeviceKind;
  hasMic: boolean;
  joinName?: string;
}

export interface CoreSocket {
  /** Decoded fresh on every access by the adapter. */
  readonly attachment: Attachment;
  /** May throw (the socket is mid-close); the core catches. */
  send(data: string | ArrayBuffer): void;
  close(code: number, reason: string): void;
  setAttachment(a: Attachment): void;
}

export interface CoreHost {
  /** Live sockets, optionally only those registered under `tag`. */
  sockets(tag?: string): CoreSocket[];
  now(): number;
  setAlarm(atMs: number): void;
  deleteAlarm(): void;
  /** Fire-and-forget persist; the platform holds outgoing messages until it lands. */
  put(key: string, value: string): void;
  remove(key: string): void;
  /** Wipes every row and the alarm. */
  removeAll(): void;
}

export interface JoinParams {
  role: string | null;
  deviceId: string | null;
  /** What the device says it is (the `kind` / `mic` / `name` query values);
   *  they only seed its record, and a missing or unknown one falls back to
   *  what the role implies. */
  kind?: string | null;
  mic?: boolean;
  name?: string | null;
  /** The nonce a TV waiting in a pairing slot presents (the `adopt` query
   *  value); only a keyless renderer gets a tag from it. */
  adopt?: string | null;
}

export type JoinResult = { ok: true; attachment: Attachment; tags: string[] } | { ok: false };

/** A socket's patch allowance: tokens left, as of `at`. */
interface PatchBucket {
  tokens: number;
  at: number;
}

/** A roster entry as a legacy (unclaimed) room sends it. */
interface RosterEntry {
  deviceId: string;
  role: RoomRole;
  scene: string;
  palette: string;
  viewport: Viewport;
}

const META_ROW = "meta";
const LOOK_ROW = "look";
const KEY_ROW_PREFIX = "k:";
const DEVICE_ROW_PREFIX = "d:";
const HASH_RE = /^[0-9a-f]{64}$/;
const DENIED: JoinResult = { ok: false };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function parseViewport(v: unknown): Viewport | undefined {
  if (!isRecord(v)) return undefined;
  const { x, y, w, h } = v;
  if (
    typeof x === "number" &&
    typeof y === "number" &&
    typeof w === "number" &&
    typeof h === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(w) &&
    Number.isFinite(h)
  ) {
    return { x, y, w, h };
  }
  return undefined;
}

/** A scene or palette string from a `hello` / `setDevice`: length only, no
 *  charset rule (legacy callers send whatever ids they have), but short enough
 *  to keep the socket attachment small. */
function shortString(v: unknown): string | undefined {
  return typeof v === "string" && v.length <= LOOK_LIMITS.maxIdChars ? v : undefined;
}

/** An attachment from whatever `deserializeAttachment` returned, including the
 *  shape written before roles, keys and socket ids existed (a socket that
 *  hibernated across a deploy): those belong to unclaimed rooms, so `keyed` is
 *  false and `sid` is derived from the device id. Never throws. */
export function readAttachment(raw: unknown): Attachment {
  const o = isRecord(raw) ? raw : {};
  const role: RoomRole = o.role === "host" || o.role === "controller" ? o.role : "renderer";
  const deviceId = typeof o.deviceId === "string" ? o.deviceId : "";
  return {
    sid: typeof o.sid === "string" && o.sid !== "" ? o.sid : `legacy:${deviceId}`,
    role,
    deviceId,
    scene: typeof o.scene === "string" ? o.scene : "",
    palette: typeof o.palette === "string" ? o.palette : "",
    viewport: parseViewport(o.viewport) ?? { ...FULL_VIEWPORT },
    keyed: o.keyed === true,
    kind: parseKind(o.kind) ?? kindForRole(role),
    hasMic: typeof o.hasMic === "boolean" ? o.hasMic : role !== "renderer",
    joinName: cleanName(o.joinName),
  };
}

/** The device records from their rows, oldest first (the order a roster lists
 *  them). Unreadable rows and rows under an id that is not a legal device id
 *  are skipped. */
function loadRecords(stored: ReadonlyMap<string, string>): Map<string, DeviceRecord> {
  const rows: Array<[string, DeviceRecord]> = [];
  for (const [key, value] of stored) {
    if (!key.startsWith(DEVICE_ROW_PREFIX)) continue;
    const id = key.slice(DEVICE_ROW_PREFIX.length);
    if (!validDeviceId(id)) continue;
    const record = parseRecord(value);
    if (record) rows.push([id, record]);
  }
  rows.sort((a, b) => a[1].added - b[1].added);
  return new Map(rows);
}

function parseMeta(raw: string | undefined): RoomMeta | null {
  if (raw === undefined) return null;
  try {
    const o: unknown = JSON.parse(raw);
    if (
      isRecord(o) &&
      o.v === 1 &&
      typeof o.hostKeyHash === "string" &&
      HASH_RE.test(o.hostKeyHash) &&
      typeof o.roomKeyHash === "string" &&
      HASH_RE.test(o.roomKeyHash) &&
      typeof o.claimedAt === "number"
    ) {
      return { v: 1, hostKeyHash: o.hostKeyHash, roomKeyHash: o.roomKeyHash, claimedAt: o.claimedAt };
    }
  } catch {
    // Unreadable claim: treated as unclaimed.
  }
  return null;
}

/** The look from its rows. Revision 0 means no patch ever applied, whatever
 *  stray key rows say; the `look` row and the key rows of one patch are written
 *  in the same event, so they land together or not at all. */
function loadLook(stored: ReadonlyMap<string, string>): { rev: number; doc: LookDoc } {
  const none = { rev: 0, doc: emptyLookDoc() };
  const raw = stored.get(LOOK_ROW);
  if (raw === undefined) return none;
  let row: unknown;
  try {
    row = JSON.parse(raw);
  } catch {
    return none;
  }
  if (!isRecord(row) || typeof row.rev !== "number" || !Number.isSafeInteger(row.rev) || row.rev < 1) return none;

  const storage: Record<string, string> = {};
  for (const [key, value] of stored) {
    if (!key.startsWith(KEY_ROW_PREFIX)) continue;
    const k = key.slice(KEY_ROW_PREFIX.length);
    if (validLookKey(k)) storage[k] = value;
  }
  const doc = sanitizeLookDoc({ scene: row.scene, palette: row.palette, storage }) ?? emptyLookDoc();
  return { rev: row.rev, doc };
}

export class RoomCore {
  private meta: RoomMeta | null;
  private rev: number;
  private doc: LookDoc;
  /** A claimed room's device records, in the order the devices were added
   *  (empty while unclaimed). Only changed through `store` / `drop`, which keep
   *  the rows and the follower cache in step. */
  private records = new Map<string, DeviceRecord>();
  /** Per feed device id, who draws from it: `followersOf` over `records`, kept
   *  because frames arrive at 30 Hz. Cleared whenever `records` changes. */
  private readonly followerCache = new Map<string, string[]>();
  /** Per socket id, in memory only: a room that hibernates starts its sockets
   *  with a full allowance, which a sender that never goes quiet cannot use. */
  private readonly patchBuckets = new Map<string, PatchBucket>();

  /** `stored` is every row the adapter read from storage on wake-up. */
  constructor(
    private readonly host: CoreHost,
    stored: ReadonlyMap<string, string>,
  ) {
    this.meta = parseMeta(stored.get(META_ROW));
    const look = this.meta === null ? { rev: 0, doc: emptyLookDoc() } : loadLook(stored);
    this.rev = look.rev;
    this.doc = look.doc;
    if (this.meta !== null) this.records = loadRecords(stored);
  }

  /** Decides a join and, if it is the claim, writes it — synchronously, so two
   *  concurrent claimants cannot both win. `hashes` are the SHA-256 hex of the
   *  presented `k` / `hk` (null when absent), computed by the adapter because
   *  hashing is async. `newSid` is unique per socket and doubles as the
   *  replacement for a device id that is missing, malformed or reserved. */
  join(p: JoinParams, hashes: { k: string | null; hk: string | null }, newSid: string): JoinResult {
    const role = parseRole(p.role);
    if (role === null) return DENIED;
    const decision = decideJoin(this.meta, { role, hostKeyHash: hashes.hk, roomKeyHash: hashes.k });
    if (!decision.ok) return DENIED;
    if (decision.claim && hashes.hk !== null && hashes.k !== null) this.claim(hashes.hk, hashes.k);

    // The owner's id is in every roster and shared by every tab of its browser,
    // so a keyed non-host presenting it (another tab, a QR holder) is given a
    // fresh id instead: it must not take over the owner's record.
    const claimedId = validDeviceId(p.deviceId) ? p.deviceId : null;
    const takesOwnerId = decision.keyed && role !== "host" && claimedId !== null && this.records.get(claimedId)?.role === "host";
    const deviceId = claimedId !== null && !takesOwnerId ? claimedId : newSid;
    const tags: string[] = [role, deviceId];
    // A keyless renderer is a TV waiting in a pairing slot (a claimed room's
    // keyed renderers are never adopted into anything).
    if (role === "renderer" && !decision.keyed && validKey(p.adopt)) tags.push(adoptTag(p.adopt), ADOPT_ANY_TAG);
    const attachment: Attachment = {
      sid: newSid,
      role,
      deviceId,
      scene: "",
      palette: "",
      viewport: { ...FULL_VIEWPORT },
      keyed: decision.keyed,
      kind: parseKind(p.kind) ?? kindForRole(role),
      // The TV page has no way to open a microphone, whatever its URL says.
      hasMic: role === "renderer" ? false : p.mic === true,
      joinName: cleanName(p.name),
    };
    return { ok: true, attachment, tags };
  }

  /** The socket is accepted: a claimed room is not idle any more, the device
   *  has a record (made now if it is new), a keyed socket is told the current
   *  look at once — the laptop's too, since a laptop that follows another
   *  member's panel has to show what that panel set — and everyone is told who
   *  is in the room. */
  opened(ws: CoreSocket): void {
    if (this.meta !== null) this.host.deleteAlarm();
    const a = ws.attachment;
    if (!a.keyed || this.meta === null) return;
    this.touchRecord(a);
    this.send(ws, this.lookSnapshot());
    this.broadcastRoster();
  }

  message(ws: CoreSocket, data: string | ArrayBuffer): void {
    const a = ws.attachment;
    // A keyless socket that was already connected when the room got claimed,
    // or a keyed one left over from a room the host has just ended: it is
    // being closed, and says nothing in the meantime (a late patch must not
    // write a look into a room nobody holds any more).
    if (this.meta !== null ? !a.keyed : a.keyed) return;

    if (typeof data !== "string") {
      this.relayFrame(a, data);
      return;
    }
    if (data.length > LOOK_LIMITS.maxMessageChars) return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(msg)) return;

    switch (msg.type) {
      case "ping":
        // Clock sync: echo the client's send time plus this clock, at once,
        // so the client can estimate offset and round trip.
        if (typeof msg.t0 === "number") {
          this.send(ws, JSON.stringify({ type: "pong", t0: msg.t0, tServer: this.host.now() }));
        }
        return;
      case "hello":
        this.hello(ws, a, msg);
        return;
      case "deviceSet":
        this.deviceSet(ws, a, msg);
        return;
      case "deviceForget":
        this.deviceForget(a, msg);
        return;
      case "lookGet":
        if (a.keyed && canSend(a.keyed, a.role, "lookGet")) this.send(ws, this.lookSnapshot());
        return;
      case "lookPatch":
        if (a.keyed) this.applyPatch(ws, a, msg);
        return;
      case "endRoom":
        if (canSend(a.keyed, a.role, "endRoom")) this.end();
        return;
    }
  }

  /** A socket is gone (closed or errored): note when its device was last seen,
   *  tell everyone who is left, and start the idle countdown if a claimed room
   *  has nobody. The closing socket is excluded explicitly — the platform may
   *  still list it during its own close handler. */
  closed(ws: CoreSocket): void {
    const a = ws.attachment;
    const gone = a.sid;
    this.patchBuckets.delete(gone);
    if (this.meta !== null) {
      const record = this.records.get(a.deviceId);
      if (record) this.store(a.deviceId, { ...record, seen: this.host.now() });
    }
    this.broadcastRoster(gone);
    if (this.meta === null) return;
    const someoneLeft = this.host.sockets().some((s) => s.attachment.sid !== gone);
    if (!someoneLeft) this.host.setAlarm(this.host.now() + ROOM_IDLE_TTL_MS);
  }

  /** The idle alarm fired: wipe a claimed room that is still empty, after
   *  which the code behaves as an unclaimed room again. */
  alarm(): void {
    if (this.meta === null || this.host.sockets().length > 0) return;
    this.host.removeAll();
    this.forgetEverything();
  }

  /** The host ended the room (the laptop's Reset): the same wipe as the idle
   *  alarm's, then every socket, the host's own included, is told `ended` and
   *  closed as denied. A denial is what makes a device forget a room's keys,
   *  so a paired TV goes back to its pairing QR and a phone says the room is
   *  closed, instead of each sitting in a room whose laptop has moved on to a
   *  new one. The message is the part a client can rely on: a close started
   *  here on any socket but the host's (whose message this is) has been seen
   *  to leave its client stuck closing (src/net/roomMessages.ts `ended`). The
   *  code is an unclaimed room again; the laptop mints a fresh one. */
  private end(): void {
    const sockets = this.host.sockets();
    this.host.removeAll();
    this.forgetEverything();
    const ended = JSON.stringify({ type: "ended" });
    for (const ws of sockets) {
      this.send(ws, ended);
      try {
        ws.close(ROOM_CLOSE_DENIED, "ended");
      } catch {
        // Already closing.
      }
    }
  }

  /** Back to an unclaimed room's memory (the rows are the caller's to wipe). */
  private forgetEverything(): void {
    this.patchBuckets.clear();
    this.records = new Map();
    this.followerCache.clear();
    this.meta = null;
    this.rev = 0;
    this.doc = emptyLookDoc();
  }

  /** Makes or refreshes the record of the device behind a keyed socket that
   *  just opened: a newcomer gets the settings its role and kind imply (and
   *  the name it asked for); a returning device keeps its choices and only has
   *  what it is, and when it was seen, brought up to date. A room that has
   *  grown past DEVICE_LIMITS.maxStoredDevices drops the record of the device
   *  that has been offline longest (never the owner's). */
  private touchRecord(a: Attachment): void {
    const now = this.host.now();
    const existing = this.records.get(a.deviceId);
    if (existing) {
      // The role stays the one the record joined with: only a host join makes
      // it the owner's, so no other socket can change who the owner is.
      const role = a.role === "host" ? "host" : existing.role;
      this.store(a.deviceId, { ...existing, kind: a.kind, hasMic: a.hasMic, role, seen: now });
      return;
    }
    const traits = { kind: a.kind, hasMic: a.hasMic };
    this.store(a.deviceId, { ...defaultSettings(a.role, traits, a.joinName), ...traits, role: a.role, added: now, seen: now });
    if (this.records.size <= DEVICE_LIMITS.maxStoredDevices) return;
    let oldest: string | null = null;
    let oldestSeen = Infinity;
    for (const [id, r] of this.records) {
      if (id === a.deviceId || r.role === "host" || r.seen >= oldestSeen) continue;
      if (this.host.sockets(id).length > 0) continue;
      oldest = id;
      oldestSeen = r.seen;
    }
    if (oldest !== null) this.evict(oldest);
  }

  /** Removes a record the way a forget does: the devices that listened
   *  through it are pointed at another feed first. */
  private evict(id: string): void {
    const { changed } = forgetDevice(this.records, id);
    this.drop(id);
    for (const [followerId, record] of changed) this.store(followerId, record);
  }

  /** Keeps a record in memory and as its row. */
  private store(id: string, record: DeviceRecord): void {
    this.records.set(id, record);
    this.followerCache.clear();
    this.host.put(DEVICE_ROW_PREFIX + id, JSON.stringify(record));
  }

  private drop(id: string): void {
    this.records.delete(id);
    this.followerCache.clear();
    this.host.remove(DEVICE_ROW_PREFIX + id);
  }

  /** A device announcing itself, or its updated scene / palette / viewport. In
   *  a claimed room it may also say what it is (`kind`, `hasMic`: a tablet
   *  that turns out to have no microphone, say), which updates its record (a
   *  durable write, so it spends from the allowance a device change does).
   *  Never its name: the name is the Room view's to set (`deviceSet`). */
  private hello(ws: CoreSocket, a: Attachment, msg: Record<string, unknown>): void {
    const kind = parseKind(msg.kind) ?? a.kind;
    const hasMic = a.role === "renderer" ? false : typeof msg.hasMic === "boolean" ? msg.hasMic : a.hasMic;
    const next: Attachment = {
      ...a,
      scene: shortString(msg.scene) ?? a.scene,
      palette: shortString(msg.palette) ?? a.palette,
      viewport: parseViewport(msg.viewport) ?? a.viewport,
    };
    if (a.keyed) {
      const record = this.records.get(a.deviceId);
      const changes = record !== undefined && (record.kind !== kind || record.hasMic !== hasMic);
      // A change to what the device is rewrites its row, so it spends from the
      // same allowance as a device change; with no token left it is ignored.
      if (!changes || this.takePatchToken(a.sid)) {
        next.kind = kind;
        next.hasMic = hasMic;
        if (record !== undefined && changes) this.store(a.deviceId, { ...record, kind, hasMic });
      }
    }
    ws.setAttachment(next);
    this.broadcastRoster();
  }

  /** `deviceSet`: any member of a claimed room changes one device's name,
   *  ears or screen (server/roomDevices.ts `applyDeviceSet` has the rules). An
   *  accepted change is stored and the roster goes to everyone; a refused one
   *  is answered to the sender alone with `deviceReject` and the reason. */
  private deviceSet(ws: CoreSocket, sender: Attachment, msg: Record<string, unknown>): void {
    if (!canSend(sender.keyed, sender.role, "deviceSet")) return;
    const raw = typeof msg.targetId === "string" && msg.targetId.length <= 64 ? msg.targetId : null;
    if (!this.takePatchToken(sender.sid)) {
      this.rejectDevice(ws, raw, "rate");
      return;
    }
    const clean = sanitizeDeviceSet(msg, validDeviceId);
    if (clean === null) {
      this.rejectDevice(ws, raw, "shape");
      return;
    }
    const result = applyDeviceSet(this.records, clean.targetId, clean.patch);
    if (!result.ok) {
      this.rejectDevice(ws, clean.targetId, result.reason);
      return;
    }
    for (const [id, record] of result.changed) this.store(id, record);
    this.broadcastRoster();
  }

  /** `deviceForget`: the owner removes a device from the room. Its record and
   *  row go, the devices that listened through it are pointed at another feed,
   *  and each of its sockets is told `ended` with reason `removed` and closed
   *  as denied, so it forgets the room's keys (it can rejoin by scanning the
   *  QR again, as a newcomer). The owner can't forget itself. */
  private deviceForget(sender: Attachment, msg: Record<string, unknown>): void {
    if (!canSend(sender.keyed, sender.role, "deviceForget")) return;
    const target = msg.targetId;
    if (!validDeviceId(target) || target === sender.deviceId || !this.records.has(target)) return;
    const { changed } = forgetDevice(this.records, target);
    this.drop(target);
    for (const [id, record] of changed) this.store(id, record);
    const removed = JSON.stringify({ type: "ended", reason: "removed" });
    for (const ws of this.host.sockets(target)) {
      this.send(ws, removed);
      try {
        ws.close(ROOM_CLOSE_DENIED, "removed");
      } catch {
        // Already closing.
      }
    }
    this.broadcastRoster();
  }

  private rejectDevice(ws: CoreSocket, targetId: string | null, reason: string): void {
    this.send(ws, JSON.stringify({ type: "deviceReject", targetId, reason }));
  }

  /** The TV adopt request (POST /api/room/{slot}/adopt, relayed here by the
   *  adapter). The body carries the room key, and the slot's code is printed on
   *  the TV, so anyone may be sitting in the slot: it goes only to the sockets
   *  that joined presenting the body's nonce (`adoptTag`), not to every
   *  renderer. The room checks shape and routes by that tag and nothing else;
   *  the TV checks the nonce again, and the room keeps it only as the tag of the
   *  socket that presented it. A claimed room is never a slot, so it answers 404
   *  as an empty one does.
   *
   *  A body without `n` is the laptop's: it can only type the slot's code. It
   *  is delivered only when exactly one screen is waiting in the slot
   *  (`ADOPT_ANY_TAG`); with a second socket there, which could be a bystander
   *  who joined with any nonce-shaped value, it is refused (409) and nothing is
   *  sent, so the room key never goes to a bystander next to the TV. Such a
   *  message carries no `n` for the TV to check. The nonce stays the stricter
   *  way in. */
  adopt(body: unknown): { status: number; body: Record<string, unknown> } {
    if (
      !isRecord(body) ||
      typeof body.room !== "string" ||
      !ROOM_CODE_RE.test(body.room) ||
      !validKey(body.k) ||
      (body.n !== undefined && !validKey(body.n))
    ) {
      return { status: 400, body: { error: "bad-request" } };
    }
    if (this.meta !== null) return { status: 404, body: { delivered: 0 } };
    const payload = JSON.stringify({ type: "adopt", room: body.room, k: body.k, n: body.n });
    const targets = this.host.sockets(body.n === undefined ? ADOPT_ANY_TAG : adoptTag(body.n));
    if (body.n === undefined && targets.length > 1) return { status: 409, body: { delivered: 0 } };
    let delivered = 0;
    for (const ws of targets) if (this.send(ws, payload)) delivered++;
    return delivered > 0 ? { status: 200, body: { delivered } } : { status: 404, body: { delivered: 0 } };
  }

  private claim(hostKeyHash: string, roomKeyHash: string): void {
    this.meta = { v: 1, hostKeyHash, roomKeyHash, claimedAt: this.host.now() };
    this.host.put(META_ROW, JSON.stringify(this.meta));
    // Sockets that got in while the room was unclaimed hold no key and must
    // not outlive the claim (a keyless renderer could still command devices).
    for (const ws of this.host.sockets()) {
      if (ws.attachment.keyed) continue;
      try {
        ws.close(ROOM_CLOSE_DENIED, "denied");
      } catch {
        // Already closing.
      }
    }
  }

  /** Feature bytes, unparsed and size-capped. In a claimed room they go from a
   *  device that is on its own input (a feed, by its record) to every device
   *  that follows it, and from anyone else nowhere. In a room nobody has
   *  claimed they go from the host to every renderer, as before records
   *  existed. Never back to the sender. A keyless socket left over from before
   *  the claim gets none (see `claim`). */
  private relayFrame(sender: Attachment, data: ArrayBuffer): void {
    if (!canSend(sender.keyed, sender.role, "binary") || data.byteLength > LOOK_LIMITS.maxBinaryBytes) return;
    if (!sender.keyed) {
      for (const target of this.host.sockets("renderer")) {
        const a = target.attachment;
        if (a.sid === sender.sid || a.keyed) continue;
        this.send(target, data);
      }
      return;
    }
    if (feedOf(this.records, sender.deviceId) !== sender.deviceId) return;
    for (const followerId of this.followersFor(sender.deviceId)) {
      for (const target of this.host.sockets(followerId)) {
        const a = target.attachment;
        if (a.sid === sender.sid || !a.keyed) continue;
        this.send(target, data);
      }
    }
  }

  /** `followersOf` for a feed, cached until the records next change. */
  private followersFor(feedId: string): string[] {
    let list = this.followerCache.get(feedId);
    if (list === undefined) {
      list = followersOf(this.records, feedId);
      this.followerCache.set(feedId, list);
    }
    return list;
  }

  private applyPatch(ws: CoreSocket, sender: Attachment, msg: Record<string, unknown>): void {
    const n = typeof msg.n === "number" && Number.isSafeInteger(msg.n) ? msg.n : null;
    if (!canSend(sender.keyed, sender.role, "lookPatch")) {
      this.reject(ws, n, "role");
      return;
    }
    if (!this.takePatchToken(sender.sid)) {
      this.reject(ws, n, "size");
      return;
    }
    if (n === null) {
      this.reject(ws, null, "shape");
      return;
    }
    const clean = sanitizeLookPatch(msg);
    if (!clean.ok) {
      this.reject(ws, n, clean.reason);
      return;
    }
    const applied = applyLookPatch(this.doc, clean.patch);
    if (!applied.ok) {
      this.reject(ws, n, applied.reason);
      return;
    }
    const effective = applied.effective;
    if (effective === null) {
      // Nothing differs (a resend after a lost ack, say): no new revision, no write, no broadcast.
      this.send(ws, JSON.stringify({ type: "lookAck", n, rev: this.rev } satisfies LookServerMsg));
      return;
    }

    this.doc = applied.doc;
    this.rev += 1;
    this.host.put(LOOK_ROW, JSON.stringify({ rev: this.rev, scene: this.doc.scene, palette: this.doc.palette }));
    if (effective.set) {
      for (const k of Object.keys(effective.set)) this.host.put(KEY_ROW_PREFIX + k, effective.set[k]);
    }
    if (effective.del) {
      for (const k of effective.del) this.host.remove(KEY_ROW_PREFIX + k);
    }

    this.send(ws, JSON.stringify({ type: "lookAck", n, rev: this.rev } satisfies LookServerMsg));
    const relayed = JSON.stringify({
      type: "lookPatch",
      rev: this.rev,
      by: sender.deviceId,
      ...effective,
      ...(clean.patch.glideMs !== undefined ? { glideMs: clean.patch.glideMs } : {}),
    } satisfies LookServerMsg);
    for (const other of this.host.sockets()) {
      const o = other.attachment;
      if (o.sid === sender.sid || !o.keyed) continue;
      this.send(other, relayed);
    }
  }

  /** Spends one patch from this socket's allowance (a token bucket: LOOK_LIMITS
   *  `patchBurst`, refilled at `patchesPerSec`); false when it is empty. */
  private takePatchToken(sid: string): boolean {
    const now = this.host.now();
    const b = this.patchBuckets.get(sid) ?? { tokens: LOOK_LIMITS.patchBurst, at: now };
    const refill = (Math.max(0, now - b.at) * LOOK_LIMITS.patchesPerSec) / 1000;
    b.tokens = Math.min(LOOK_LIMITS.patchBurst, b.tokens + refill);
    b.at = now;
    this.patchBuckets.set(sid, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private reject(ws: CoreSocket, n: number | null, reason: "role" | "size" | "shape"): void {
    this.send(ws, JSON.stringify({ type: "lookReject", n, reason } satisfies LookServerMsg));
  }

  /** The `look` message: revision 0 has no document yet, so `doc` is null. */
  private lookSnapshot(): string {
    const msg: LookServerMsg = { type: "look", rev: this.rev, doc: this.rev === 0 ? null : this.doc };
    return JSON.stringify(msg);
  }

  /** Who is in the room, to every live socket. A claimed room lists every
   *  device record, owner first and then in the order they were added, online
   *  or not, with its name, ears and screen (the Room view draws from it); the
   *  scene, palette and viewport come from one of the device's live sockets,
   *  and are empty / full while it is offline. Only keyed sockets are told: a
   *  keyless one left over from before the claim is being closed. A room
   *  nobody has claimed keeps the shape it always had: the live hosts and
   *  renderers (controllers see the roster but are not in it), to everyone. */
  private broadcastRoster(exceptSid?: string): void {
    const live = this.host.sockets().filter((ws) => ws.attachment.sid !== exceptSid);
    if (this.meta !== null) {
      const sockets = live.filter((ws) => ws.attachment.keyed);
      const owner = ownerId(this.records);
      const ids = [...this.records.keys()];
      if (owner !== null) ids.splice(ids.indexOf(owner), 1);
      if (owner !== null) ids.unshift(owner);
      const entries = ids.map((id) => {
        const r = this.records.get(id) as DeviceRecord;
        const mine = sockets.find((ws) => ws.attachment.deviceId === id);
        const a = mine?.attachment;
        return {
          deviceId: id,
          role: r.role,
          scene: a?.scene ?? "",
          palette: a?.palette ?? "",
          viewport: a?.viewport ?? { ...FULL_VIEWPORT },
          kind: r.kind,
          name: r.name,
          hasMic: r.hasMic,
          ears: r.ears,
          follow: r.follow,
          screen: r.screen,
          online: mine !== undefined,
          owner: r.role === "host",
        };
      });
      const payload = JSON.stringify({ type: "roster", devices: entries });
      for (const ws of sockets) this.send(ws, payload);
      return;
    }
    const devices: RosterEntry[] = [];
    for (const ws of live) {
      const a = ws.attachment;
      if (a.role === "controller") continue;
      devices.push({ deviceId: a.deviceId, role: a.role, scene: a.scene, palette: a.palette, viewport: a.viewport });
    }
    const payload = JSON.stringify({ type: "roster", devices });
    for (const ws of live) this.send(ws, payload);
  }

  private send(ws: CoreSocket, data: string | ArrayBuffer): boolean {
    try {
      ws.send(data);
      return true;
    } catch {
      // Socket is mid-close; its close handler cleans up.
      return false;
    }
  }
}
