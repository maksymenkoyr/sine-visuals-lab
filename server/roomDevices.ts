/**
 * The members of a claimed room and the three choices the Room view makes for
 * each: its name, where its sound comes from (`ears`) and what its screen
 * shows (`screen`). The room stores one record per device id
 * (server/roomCore.ts keeps them as rows, so a device that drops and comes
 * back keeps its choices), lists every record in the roster, online or not,
 * and routes feature frames by them. The client reads the same records from
 * the roster (src/net/roomMessages.ts) to draw the Room view and to decide
 * what it listens to and how far behind the room clock it draws.
 *
 * Ears. A device on its `own` input analyses its own mic or input device and
 * is a feed: the room forwards its frames to every device that follows it,
 * and to nobody else. A device that `follow`s draws from a feed's frames,
 * RENDER_DELAY_MS behind the room clock. `follow: null` means "the room's
 * owner", the laptop that opened the room, so a device that joins before the
 * owner has said anything still has a feed to name. Feeds are always on their
 * own input, so a follow chain can't form: following a device that itself
 * follows is refused, and when a feed switches to following, the devices that
 * followed it are pointed at another feed (`applyDeviceSet` has the order).
 *
 * Screen. `main` shows the room's look document (server/lookDoc.ts), the
 * program that Play changes. `own` keeps whatever look the device has and is
 * skipped by Play. `off` is a remote with no picture of its own. A TV page has
 * no panel to be a remote with, so it can't be `off`.
 *
 * Who decides. Any keyed member may change any device (the QR is the
 * permission: only people in the room can scan it); only the owner may forget
 * a device. The defaults for a newcomer come from what it is: the owner is on
 * its own input and shows Main, everyone else follows the owner, and a phone
 * starts as a remote.
 *
 * Plain TS with no DOM or Workers types (listed in the root tsconfig `files`
 * like server/roomRules.ts): the room, the client and the tests share it.
 */

import type { RoomRole } from "./roomRules.ts";

/** How far behind the room clock a follower draws, so a slow or jittery
 *  network path eats into slack instead of showing up as desync. Lives here
 *  because the room view and the delay rule below need it as much as the
 *  connection does (src/net/room.ts re-exports it). */
export const RENDER_DELAY_MS = 120;

export type DeviceKind = "laptop" | "tablet" | "phone" | "tv";
export type Ears = "own" | "follow";
export type ScreenUse = "main" | "own" | "off";

/** What the Room view sets for a device. */
export interface DeviceSettings {
  name: string;
  ears: Ears;
  /** The feed this device listens through while `ears` is "follow": a device
   *  id, or null for the room's owner. Kept (and ignored) while `ears` is "own",
   *  so switching back to follow returns to the same feed. */
  follow: string | null;
  screen: ScreenUse;
}

/** What a device is, as it says itself when it joins (and may update in a hello). */
export interface DeviceTraits {
  kind: DeviceKind;
  /** It can open a microphone at all. A TV page can't. */
  hasMic: boolean;
}

/** A stored device: its settings, its traits, the role it joined with, and
 *  when the room first and last saw it (room clock, ms). */
export interface DeviceRecord extends DeviceSettings, DeviceTraits {
  role: RoomRole;
  added: number;
  seen: number;
}

/** A change to one device's settings (`deviceSet`). */
export interface DeviceSetPatch {
  name?: string;
  ears?: Ears;
  follow?: string | null;
  screen?: ScreenUse;
}

export const DEVICE_LIMITS = {
  maxNameChars: 32,
  /** Records kept per room, online or not. Past it the record of the device
   *  that has been offline longest is dropped to make room. */
  maxStoredDevices: 32,
} as const;

const KIND_NAMES: Record<DeviceKind, string> = { laptop: "Laptop", tablet: "Tablet", phone: "Phone", tv: "TV" };

export function parseKind(v: unknown): DeviceKind | undefined {
  return v === "laptop" || v === "tablet" || v === "phone" || v === "tv" ? v : undefined;
}

export function parseEars(v: unknown): Ears | undefined {
  return v === "own" || v === "follow" ? v : undefined;
}

export function parseScreen(v: unknown): ScreenUse | undefined {
  return v === "main" || v === "own" || v === "off" ? v : undefined;
}

/** The kind a device that didn't say is assumed to be, from its role. */
export function kindForRole(role: RoomRole): DeviceKind {
  return role === "host" ? "laptop" : role === "renderer" ? "tv" : "phone";
}

/** A name to show for a device that hasn't been given one. */
export function defaultName(kind: DeviceKind): string {
  return KIND_NAMES[kind];
}

/** A device name from untrusted input: control characters dropped, runs of
 *  white space collapsed, trimmed, cut to DEVICE_LIMITS.maxNameChars. Empty
 *  (or not a string) is undefined. */
export function cleanName(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, DEVICE_LIMITS.maxNameChars).trim();
  return s === "" ? undefined : s;
}

/** The settings a device gets the first time it joins a room. */
export function defaultSettings(role: RoomRole, traits: DeviceTraits, name?: string): DeviceSettings {
  const own = role === "host";
  return {
    name: cleanName(name) ?? defaultName(traits.kind),
    ears: own ? "own" : "follow",
    follow: null,
    screen: !own && traits.kind === "phone" ? "off" : "main",
  };
}

/** A `deviceSet` message's target and patch, or null when the shape is wrong.
 *  Only the fields present are in the patch; an unknown value for a present
 *  field refuses the whole message. `validId` is the device-id rule
 *  (roomRules.ts validDeviceId), passed in to keep this file free of it. */
export function sanitizeDeviceSet(
  msg: Record<string, unknown>,
  validId: (s: unknown) => s is string,
): { targetId: string; patch: DeviceSetPatch } | null {
  if (!validId(msg.targetId)) return null;
  const patch: DeviceSetPatch = {};
  if (msg.name !== undefined) {
    const name = cleanName(msg.name);
    if (name === undefined) return null;
    patch.name = name;
  }
  if (msg.ears !== undefined) {
    const ears = parseEars(msg.ears);
    if (ears === undefined) return null;
    patch.ears = ears;
  }
  if (msg.follow !== undefined) {
    if (msg.follow !== null && !validId(msg.follow)) return null;
    patch.follow = msg.follow;
  }
  if (msg.screen !== undefined) {
    const screen = parseScreen(msg.screen);
    if (screen === undefined) return null;
    patch.screen = screen;
  }
  if (Object.keys(patch).length === 0) return null;
  return { targetId: msg.targetId, patch };
}

/** A stored record from its row text, or null when it can't be read. */
export function parseRecord(raw: string): DeviceRecord | null {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const kind = parseKind(r.kind);
  const ears = parseEars(r.ears);
  const screen = parseScreen(r.screen);
  const name = cleanName(r.name);
  const role = r.role === "host" || r.role === "controller" || r.role === "renderer" ? r.role : undefined;
  if (!kind || !ears || !screen || !name || !role) return null;
  if (r.follow !== null && typeof r.follow !== "string") return null;
  if (typeof r.added !== "number" || typeof r.seen !== "number") return null;
  return {
    name,
    ears,
    follow: r.follow,
    screen,
    kind,
    hasMic: r.hasMic === true,
    role,
    added: r.added,
    seen: r.seen,
  };
}

/** The owner's device id (the record that joined as host), or null. */
export function ownerId(records: ReadonlyMap<string, DeviceRecord>): string | null {
  for (const [id, r] of records) if (r.role === "host") return id;
  return null;
}

/** The feed a device draws from: itself when on its own input, else the
 *  device it follows (the owner for `null`). Null when that feed isn't a
 *  device on its own input (gone, or switched to following): no sound. */
export function feedOf(records: ReadonlyMap<string, DeviceRecord>, deviceId: string): string | null {
  const r = records.get(deviceId);
  if (!r) return null;
  if (r.ears === "own") return deviceId;
  const target = r.follow ?? ownerId(records);
  if (target === null || target === deviceId) return null;
  return records.get(target)?.ears === "own" ? target : null;
}

/** Every device that draws from `feedId`'s frames, itself excluded. */
export function followersOf(records: ReadonlyMap<string, DeviceRecord>, feedId: string): string[] {
  const out: string[] = [];
  for (const id of records.keys()) if (id !== feedId && feedOf(records, id) === feedId) out.push(id);
  return out;
}

/** Where the devices that drew from `leavingId` should draw from once it is no
 *  longer a feed (it switched to following, or it was forgotten). `after` is
 *  the room's records as they will be then. The owner (`null`) if the owner is
 *  still on its own input, else the first other feed in record order, else
 *  undefined: nothing to point them at, so they are left as they were. The one
 *  rule `applyDeviceSet` and `forgetDevice` share. */
function replacementFeed(after: ReadonlyMap<string, DeviceRecord>, leavingId: string): string | null | undefined {
  const owner = ownerId(after);
  if (owner !== null && owner !== leavingId && after.get(owner)?.ears === "own") return null;
  for (const [id, r] of after) {
    if (id !== leavingId && r.ears === "own") return id;
  }
  return undefined;
}

export type DeviceSetResult =
  | { ok: true; changed: Map<string, DeviceRecord> }
  | { ok: false; reason: "unknown" | "no-mic" | "tv-off" | "bad-follow" };

/** Applies one `deviceSet` to the room's records. Returns every record that
 *  changed (the target, and the followers it re-pointed), or why it was
 *  refused. Never mutates `records`.
 *
 *  - The target must be a known device.
 *  - Setting `ears: "own"` needs a device that has a microphone, and setting
 *    `screen: "off"` is refused for a TV. Only what the patch sets is checked,
 *    so a device whose record is already odd can still be renamed.
 *  - A `follow` must name another known device that is on its own input (after
 *    this patch), or be null (the owner). Setting `follow` without `ears`
 *    also sets `ears: "follow"`. A device never follows itself: the owner can't
 *    switch to Follow while its `follow` is null (that would name itself).
 *  - When the target stops being a feed (own → follow), each device that drew
 *    from it is pointed at a feed that is still on its own input: the owner
 *    (`null`) if the owner still is one, else the first other feed in record
 *    order, else it is left as it was (it then has no sound until someone
 *    picks a feed). */
export function applyDeviceSet(
  records: ReadonlyMap<string, DeviceRecord>,
  targetId: string,
  patch: DeviceSetPatch,
): DeviceSetResult {
  const before = records.get(targetId);
  if (!before) return { ok: false, reason: "unknown" };
  const next: DeviceRecord = { ...before };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.ears !== undefined) next.ears = patch.ears;
  if (patch.follow !== undefined) {
    next.follow = patch.follow;
    if (patch.ears === undefined) next.ears = "follow";
  }
  if (patch.screen !== undefined) next.screen = patch.screen;

  // Only what the patch sets is checked: a record that is already odd (an
  // owner without a mic, say) can still be renamed or given another screen.
  if (patch.ears === "own" && !next.hasMic) return { ok: false, reason: "no-mic" };
  if (patch.screen === "off" && next.kind === "tv") return { ok: false, reason: "tv-off" };
  if (patch.follow !== undefined && patch.follow !== null) {
    const feed = records.get(patch.follow);
    if (patch.follow === targetId || !feed || feed.ears !== "own") return { ok: false, reason: "bad-follow" };
  }
  // `follow: null` means the owner, so the owner switching to Follow without
  // naming another feed would follow itself.
  if (
    (patch.ears !== undefined || patch.follow !== undefined) &&
    next.ears === "follow" &&
    (next.follow ?? ownerId(records)) === targetId
  ) {
    return { ok: false, reason: "bad-follow" };
  }

  const changed = new Map<string, DeviceRecord>([[targetId, next]]);
  if (before.ears === "own" && next.ears === "follow") {
    const after = new Map(records);
    after.set(targetId, next);
    const replacement = replacementFeed(after, targetId);
    if (replacement !== undefined) {
      for (const id of followersOf(records, targetId)) {
        const r = records.get(id);
        if (r) changed.set(id, { ...r, follow: replacement });
      }
    }
  }
  return { ok: true, changed };
}

/** The records that change when `id` is forgotten (the owner removing a
 *  device): each device that drew from it is pointed at another feed by the
 *  rule `applyDeviceSet` uses when a feed stops (the owner if it is a feed,
 *  else the first other feed, else left as it was). The forgotten record
 *  itself is not in `changed`: the caller deletes it. Never mutates `records`;
 *  an unknown id changes nothing. */
export function forgetDevice(records: ReadonlyMap<string, DeviceRecord>, id: string): { changed: Map<string, DeviceRecord> } {
  const changed = new Map<string, DeviceRecord>();
  if (!records.has(id)) return { changed };
  const after = new Map(records);
  after.delete(id);
  const replacement = replacementFeed(after, id);
  if (replacement === undefined) return { changed };
  for (const followerId of followersOf(records, id)) {
    const r = records.get(followerId);
    if (r) changed.set(followerId, { ...r, follow: replacement });
  }
  return { changed };
}

/** How far behind the room clock this device should draw. A follower always
 *  waits RENDER_DELAY_MS for its frames to cross the network. A device on its
 *  own input draws at once, unless it shows Main next to other Main screens
 *  that follow a feed: it then waits as long as they do, so a beat lands on
 *  every Main screen together. */
export function pictureDelayMs(records: ReadonlyMap<string, DeviceRecord>, online: ReadonlySet<string>, selfId: string): number {
  const self = records.get(selfId);
  if (!self) return 0;
  if (self.ears === "follow") return RENDER_DELAY_MS;
  if (self.screen !== "main") return 0;
  for (const [id, r] of records) {
    if (id !== selfId && online.has(id) && r.screen === "main" && r.ears === "follow") return RENDER_DELAY_MS;
  }
  return 0;
}
