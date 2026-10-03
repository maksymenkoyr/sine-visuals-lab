/**
 * The look document: the room's shared picture settings, and the patch that
 * edits it.
 *
 * A paired room (server/roomRules.ts) holds one look — a scene id, a palette
 * id and the raw localStorage strings of every store that changes how a scene
 * looks (src/net/syncedStores.ts `isRoomKey` decides which). The phone
 * controller publishes edits as patches, the Durable Object (server/room.ts,
 * rules in server/roomCore.ts) applies them in arrival order and relays what
 * actually changed, and a TV replicates the result. The room never interprets
 * a setting: it stores opaque strings and enforces size and shape only, so a
 * store added next year rides along with no server change.
 *
 * Plain TS with no DOM or Workers types on purpose: the Worker project, the
 * client and the tests all compile this file, so it must be listed in the root
 * tsconfig `files` (the same arrangement as server/usage.ts). It is also
 * shipped to old TV browsers, so it avoids runtime APIs newer than the build
 * target (vite.config.ts) — which is why utf8Length does its own arithmetic
 * instead of reaching for TextEncoder on every key of every patch.
 *
 * Every key must start with `vibe.` (validLookKey). That is the whole defence
 * against `__proto__`, `constructor` and `prototype` arriving as key names: none
 * of them can pass. Result maps are still plain objects, so never assign a key
 * that did not come through validLookKey (applyLookPatch re-checks anyway).
 *
 * Patch semantics, which the phone's publisher and the room both rely on:
 * - `set` writes a value, `del` removes a key (a missing key is ignored), and
 *   a key named in both is a shape error. `scene` / `palette` replace.
 * - Applying is idempotent: replaying a patch changes nothing, so a client that
 *   lost its ack can simply resend.
 * - A patch that changes nothing yields `effective: null`; the room does not
 *   bump its revision, persist or broadcast for it.
 * - An empty scene or palette id means "no opinion" and is never published
 *   (diffLook skips it, sanitizeLookPatch rejects it) — a controller that has
 *   not picked a scene yet must not blank the TV's.
 *
 * Limits live in LOOK_LIMITS so a message that is too big, a document that has
 * grown too big and a store that is too big all answer to one set of numbers.
 */

export interface LookLimits {
  /** A text message, in UTF-16 units; checked before JSON.parse. */
  readonly maxMessageChars: number;
  /** A binary frame (the real ones are the feature-frame size). */
  readonly maxBinaryBytes: number;
  /** UTF-8 bytes of every id, key and value in a document. */
  readonly maxDocBytes: number;
  /** One stored value. */
  readonly maxValueBytes: number;
  readonly maxKeys: number;
  readonly maxKeyChars: number;
  /** Scene id, palette id, and the strings of a `hello`. */
  readonly maxIdChars: number;
  readonly maxDeviceIdChars: number;
  /** The body of the TV adopt request. */
  readonly maxAdoptBodyBytes: number;
  /** A controller's patch budget: it may send this many at once, and the room
   *  gives it `patchesPerSec` more every second (a token bucket per socket,
   *  server/roomCore.ts). Every accepted patch is durable row writes, so the
   *  rate is capped; a device sends one patch per Play (src/net/mainPlay.ts,
   *  one press at a time, a few in a burst at most), which stays well inside it. */
  readonly patchBurst: number;
  readonly patchesPerSec: number;
  /** The longest glide a patch may ask a screen to arrive over — the same
   *  ceiling as src/net/outputGlide.ts's GLIDE_MAX_MS (a test keeps them equal). */
  readonly maxGlideMs: number;
}

export const LOOK_LIMITS: LookLimits = {
  maxMessageChars: 131072,
  maxBinaryBytes: 64,
  maxDocBytes: 98304,
  maxValueBytes: 65536,
  maxKeys: 256,
  maxKeyChars: 96,
  maxIdChars: 48,
  maxDeviceIdChars: 64,
  maxAdoptBodyBytes: 512,
  patchBurst: 40,
  patchesPerSec: 20,
  maxGlideMs: 30_000,
};

export interface LookDoc {
  scene: string;
  palette: string;
  storage: Record<string, string>;
}

export interface LookPatch {
  scene?: string;
  palette?: string;
  set?: Record<string, string>;
  del?: string[];
  /** The laptop's Play held down: a screen arrives at the look this patch
   *  makes over this many ms instead of switching (src/net/outputGlide.ts says
   *  what moves smoothly). It describes how to show the change, not the look,
   *  so it is never stored, and applyLookPatch's `effective` leaves it out —
   *  the room relays it beside the patch it came with. */
  glideMs?: number;
}

/** `size` is every limit in LOOK_LIMITS, including the patch budget: a
 *  controller that sends faster than the room allows is answered with it. */
export type LookRejectReason = "role" | "size" | "shape";

/** What a controller sends the room. */
export type LookClientMsg = { type: "lookGet" } | ({ type: "lookPatch"; n: number } & LookPatch);

/** What the room sends back: the snapshot, a relayed patch, and the replies to a patch. */
export type LookServerMsg =
  | { type: "look"; rev: number; doc: LookDoc | null }
  /** `by`: the device id of the member whose patch this is (the room adds
   *  it to a relay; absent from an older room). */
  | ({ type: "lookPatch"; rev: number; by?: string } & LookPatch)
  | { type: "lookAck"; n: number; rev: number }
  | { type: "lookReject"; n: number | null; reason: LookRejectReason };

const KEY_PREFIX = "vibe.";
const LOOK_KEY_RE = /^vibe\.[\w.@:-]*$/;
const LOOK_ID_RE = /^[\w.@-]+$/;

function hasOwn(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Bytes `s` takes as UTF-8, counted per code point. A lone surrogate counts
 *  as the 3-byte replacement character, the way TextEncoder encodes it. */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

export function validLookKey(k: unknown): k is string {
  return (
    typeof k === "string" &&
    k.length > KEY_PREFIX.length &&
    k.length <= LOOK_LIMITS.maxKeyChars &&
    LOOK_KEY_RE.test(k)
  );
}

export function validLookId(s: unknown): s is string {
  return typeof s === "string" && s.length >= 1 && s.length <= LOOK_LIMITS.maxIdChars && LOOK_ID_RE.test(s);
}

export function emptyLookDoc(): LookDoc {
  return { scene: "", palette: "", storage: {} };
}

export function docBytes(doc: LookDoc): number {
  let n = utf8Length(doc.scene) + utf8Length(doc.palette);
  for (const k of Object.keys(doc.storage)) n += utf8Length(k) + utf8Length(doc.storage[k]);
  return n;
}

export function isEmptyPatch(p: LookPatch): boolean {
  return (
    p.scene === undefined &&
    p.palette === undefined &&
    (p.set === undefined || Object.keys(p.set).length === 0) &&
    (p.del === undefined || p.del.length === 0)
  );
}

type Sanitized = { ok: true; patch: LookPatch } | { ok: false; reason: "shape" | "size" };

/** Validates an untrusted patch (a controller's message, or what the room
 *  relayed) and returns a clean copy that carries only the patch fields. An
 *  empty result is fine: applying it is a no-op the room acks. */
export function sanitizeLookPatch(raw: unknown): Sanitized {
  if (!isRecord(raw)) return { ok: false, reason: "shape" };
  const patch: LookPatch = {};

  const scene = raw.scene;
  if (scene !== undefined) {
    if (!validLookId(scene)) return { ok: false, reason: "shape" };
    patch.scene = scene;
  }
  const palette = raw.palette;
  if (palette !== undefined) {
    if (!validLookId(palette)) return { ok: false, reason: "shape" };
    patch.palette = palette;
  }

  const rawSet = raw.set;
  if (rawSet !== undefined) {
    if (!isRecord(rawSet)) return { ok: false, reason: "shape" };
    const keys = Object.keys(rawSet);
    if (keys.length > LOOK_LIMITS.maxKeys) return { ok: false, reason: "size" };
    const set: Record<string, string> = {};
    for (const k of keys) {
      const v = rawSet[k];
      if (!validLookKey(k) || typeof v !== "string") return { ok: false, reason: "shape" };
      if (utf8Length(v) > LOOK_LIMITS.maxValueBytes) return { ok: false, reason: "size" };
      set[k] = v;
    }
    if (keys.length > 0) patch.set = set;
  }

  const rawDel = raw.del;
  if (rawDel !== undefined) {
    if (!Array.isArray(rawDel)) return { ok: false, reason: "shape" };
    if (rawDel.length > LOOK_LIMITS.maxKeys) return { ok: false, reason: "size" };
    const seen = new Set<string>();
    for (const k of rawDel) {
      if (!validLookKey(k)) return { ok: false, reason: "shape" };
      seen.add(k);
    }
    if (seen.size > 0) patch.del = Array.from(seen);
  }

  if (patch.set && patch.del) {
    for (const k of patch.del) if (hasOwn(patch.set, k)) return { ok: false, reason: "shape" };
  }

  // A glide that is not a plain positive number is no glide: the change still
  // applies, it just switches. Longer than the ceiling is the ceiling.
  const glide = raw.glideMs;
  if (typeof glide === "number" && Number.isFinite(glide) && glide > 0) {
    patch.glideMs = Math.min(glide, LOOK_LIMITS.maxGlideMs);
  }
  return { ok: true, patch };
}

/** A document from an untrusted source (the room's snapshot), cleaned: invalid
 *  keys, non-string values and anything past the limits are dropped, so the
 *  result always satisfies them. Null only when `raw` is not an object. */
export function sanitizeLookDoc(raw: unknown): LookDoc | null {
  if (!isRecord(raw)) return null;
  const doc = emptyLookDoc();
  if (validLookId(raw.scene)) doc.scene = raw.scene;
  if (validLookId(raw.palette)) doc.palette = raw.palette;

  const storage = raw.storage;
  if (isRecord(storage)) {
    let keys = 0;
    let bytes = utf8Length(doc.scene) + utf8Length(doc.palette);
    for (const k of Object.keys(storage)) {
      const v = storage[k];
      if (!validLookKey(k) || typeof v !== "string") continue;
      const vBytes = utf8Length(v);
      if (vBytes > LOOK_LIMITS.maxValueBytes) continue;
      const add = utf8Length(k) + vBytes;
      if (keys >= LOOK_LIMITS.maxKeys || bytes + add > LOOK_LIMITS.maxDocBytes) continue;
      doc.storage[k] = v;
      keys++;
      bytes += add;
    }
  }
  return doc;
}

/** `doc` with `patch` applied; `doc` itself is never touched. `effective` is
 *  only the entries that actually changed (null when none did, in which case
 *  `doc` is returned as is). A `set` wins over a `del` of the same key, and
 *  entries sanitizeLookPatch would have refused are ignored. */
export function applyLookPatch(
  doc: LookDoc,
  patch: LookPatch,
): { ok: true; doc: LookDoc; effective: LookPatch | null } | { ok: false; reason: "size" } {
  const effective: LookPatch = {};
  const storage: Record<string, string> = { ...doc.storage };
  let scene = doc.scene;
  let palette = doc.palette;

  if (patch.scene !== undefined && validLookId(patch.scene) && patch.scene !== scene) {
    scene = patch.scene;
    effective.scene = scene;
  }
  if (patch.palette !== undefined && validLookId(patch.palette) && patch.palette !== palette) {
    palette = patch.palette;
    effective.palette = palette;
  }
  if (patch.del) {
    for (const k of patch.del) {
      if (!validLookKey(k) || (patch.set && hasOwn(patch.set, k)) || !hasOwn(storage, k)) continue;
      delete storage[k];
      (effective.del ??= []).push(k);
    }
  }
  if (patch.set) {
    for (const k of Object.keys(patch.set)) {
      const v = patch.set[k];
      if (!validLookKey(k) || typeof v !== "string") continue;
      if (hasOwn(storage, k) && storage[k] === v) continue;
      storage[k] = v;
      (effective.set ??= {})[k] = v;
    }
  }

  if (isEmptyPatch(effective)) return { ok: true, doc, effective: null };
  const next: LookDoc = { scene, palette, storage };
  if (Object.keys(storage).length > LOOK_LIMITS.maxKeys || docBytes(next) > LOOK_LIMITS.maxDocBytes) {
    return { ok: false, reason: "size" };
  }
  return { ok: true, doc: next, effective };
}

/** The smallest patch that turns `base` into `current`, or null when they
 *  already agree. Keys come out sorted so equal diffs serialise identically
 *  (the publisher compares them to avoid resending one the room refused). */
export function diffLook(base: LookDoc, current: LookDoc): LookPatch | null {
  const patch: LookPatch = {};
  if (current.scene !== "" && current.scene !== base.scene) patch.scene = current.scene;
  if (current.palette !== "" && current.palette !== base.palette) patch.palette = current.palette;

  const set: Record<string, string> = {};
  let changed = false;
  for (const k of Object.keys(current.storage).sort()) {
    const v = current.storage[k];
    if (!hasOwn(base.storage, k) || base.storage[k] !== v) {
      set[k] = v;
      changed = true;
    }
  }
  if (changed) patch.set = set;

  const del = Object.keys(base.storage)
    .filter((k) => !hasOwn(current.storage, k))
    .sort();
  if (del.length > 0) patch.del = del;

  return isEmptyPatch(patch) ? null : patch;
}
