import { remoteSyncable } from "./syncedStores.ts";

/**
 * Remote control: the pure half — what two linked windows (a HOST that owns
 * the audio, the render and the output window; a REMOTE that drives it) say
 * to each other, and how they merge. net/remoteLink.ts is the glue that
 * carries these over the room connection; net/room.ts and server/room.ts
 * relay them (`type: "ctl"`); outputSync.ts's header covers the output window
 * the remote's Cue/Go commands act on.
 *
 * What is shared is the app's *model*: every localStorage key
 * net/syncedStores.ts's `remoteSyncable` lets through, plus the two
 * pseudo-keys MODEL_SCENE / MODEL_PALETTE for which scene and palette the
 * host shows. A stored value that is a JSON object is parsed, so two windows
 * that each change a different setting of the same scene merge instead of
 * overwriting each other; anything else is an opaque string.
 *
 * Merge is per-leaf, last writer wins. Each side remembers `base`, the model
 * as of the last time it and the other side agreed. Every poll it diffs its
 * own model against `base` (`diffModel`), sends the resulting ops and moves
 * `base` forward; ops that arrive are applied to the local model *and* to
 * `base` (so they are never echoed back). A local edit made between two
 * polls survives an incoming op on a different leaf, and wins on the same
 * one only by arriving later — no clocks, no versions.
 *
 * The host is the source of truth when a remote joins: the remote sends any
 * edits it made while disconnected, the host merges them and replies with its
 * whole model (`snap`), which the remote adopts. So a dropped link, a
 * reloaded remote and a reloaded host (which keeps its room code — see
 * app.ts's hostRoomCode) all converge on host state plus whatever the remote
 * changed last.
 */

/** Which scene / palette the host shows, as model keys. */
export const MODEL_SCENE = "@scene";
export const MODEL_PALETTE = "@palette";

export type Model = Record<string, unknown>;

/** One change: at `p` (path from a model key down through nested objects) set
 *  `v`, or delete when `d`. */
export interface Op {
  p: string[];
  v?: unknown;
  d?: 1;
}

export type CtlMessage =
  /** remote → host, on every (re)connect: edits made while unlinked. */
  | { t: "join"; ops: Op[] }
  /** host → one remote: the whole model, to adopt. `out` is the output window's status. */
  | { t: "snap"; model: Model; out: OutStatus }
  /** either way. `src` is the remote's deviceId when the host relays one remote's ops to the others. */
  | { t: "ops"; ops: Op[]; src?: string }
  /** host → remote: remote control is not enabled on the host. */
  | { t: "denied" }
  /** host → all remotes when the host (re)connects: send a fresh join. */
  | { t: "hostup" }
  | { t: "cue"; on: boolean }
  | { t: "go" }
  /** host → remotes: the output window changed state. */
  | { t: "out"; status: OutStatus };

export interface OutStatus {
  open: boolean;
  cue: boolean;
  differs: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Stored text -> model: object-shaped JSON is parsed, everything else kept as text. */
export function toModel(storage: Record<string, string>): Model {
  const out: Model = {};
  for (const [k, raw] of Object.entries(storage)) {
    if (!remoteSyncable(k)) continue;
    let v: unknown = raw;
    if (raw.charCodeAt(0) === 123 /* { */) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isObj(parsed)) v = parsed;
      } catch {
        // not JSON after all — keep the text
      }
    }
    out[k] = v;
  }
  return out;
}

/** The text a model value is stored as. */
export function serializeValue(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

function diffInto(path: string[], a: unknown, b: unknown, ops: Op[]): void {
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(b)) {
      if (!(k in a)) ops.push({ p: [...path, k], v: b[k] });
      else diffInto([...path, k], a[k], b[k], ops);
    }
    for (const k of Object.keys(a)) if (!(k in b)) ops.push({ p: [...path, k], d: 1 });
    return;
  }
  if (!deepEqual(a, b)) ops.push({ p: path, v: b });
}

/** The ops that turn `base` into `cur`. */
export function diffModel(base: Model, cur: Model): Op[] {
  const ops: Op[] = [];
  diffInto([], base, cur, ops);
  return ops;
}

/** Applies ops to `model` in place; ops touching keys `allow` rejects are dropped. */
export function applyOps(model: Model, ops: readonly Op[], allow: (key: string) => boolean = isModelKey): void {
  for (const op of ops) {
    if (!Array.isArray(op.p) || op.p.length === 0 || !op.p.every((s) => typeof s === "string")) continue;
    if (!allow(op.p[0]) || op.p.some((s) => s === "__proto__" || s === "constructor" || s === "prototype")) continue;
    let node: Record<string, unknown> = model;
    for (let i = 0; i < op.p.length - 1; i++) {
      const next = node[op.p[i]];
      if (isObj(next)) node = next;
      else {
        const made: Record<string, unknown> = {};
        node[op.p[i]] = made;
        node = made;
      }
    }
    const last = op.p[op.p.length - 1];
    if (op.d) delete node[last];
    else node[last] = op.v;
  }
}

/** Keys a link may carry: the app's synced stores and the scene/palette pseudo-keys. */
export function isModelKey(key: string): boolean {
  return key === MODEL_SCENE || key === MODEL_PALETTE || remoteSyncable(key);
}

/** Which model keys a set of ops touches. */
export function touchedKeys(ops: readonly Op[]): Set<string> {
  const out = new Set<string>();
  for (const op of ops) if (Array.isArray(op.p) && op.p.length > 0) out.add(op.p[0]);
  return out;
}

/** One side's `base` bookkeeping (see the header). */
export interface ModelSync {
  /** False until the first poll (host) or adopt (remote). */
  hasBase(): boolean;
  /** Ops to send for `cur`, and `base` moves to `cur`. The very first call
   *  only records `base` (nothing to say yet). */
  poll(cur: Model): Op[];
  /** The ops `poll` would return, without moving `base` (a join that might be denied). */
  peek(cur: Model): Op[];
  /** Ops just applied locally, so `base` follows and they are not echoed. */
  received(ops: readonly Op[]): void;
  /** Replace `base` with the other side's whole model. */
  adopt(model: Model): void;
}

export function createModelSync(): ModelSync {
  let base: Model | null = null;
  const clone = (m: Model): Model => JSON.parse(JSON.stringify(m)) as Model;
  return {
    hasBase: () => base !== null,
    poll(cur) {
      if (base === null) {
        base = clone(cur);
        return [];
      }
      const ops = diffModel(base, cur);
      if (ops.length > 0) base = clone(cur);
      return ops;
    },
    peek: (cur) => (base === null ? [] : diffModel(base, cur)),
    received(ops) {
      if (base !== null) applyOps(base, ops);
    },
    adopt(model) {
      base = clone(model);
    },
  };
}
