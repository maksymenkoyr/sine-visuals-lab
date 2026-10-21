/**
 * The "Play will change" list on the desk (issue #620): every difference
 * between NEXT (the main window's look, the preview) and LIVE (what the pop-out
 * output shows, the held program). Each difference is one row, and a row can
 * be sent on its own (`takeRow`: LIVE with just that row taken from NEXT) or
 * dropped (`dropRowText`: NEXT's storage with LIVE's value put back). Pure
 * over the OutputState values outputSync.ts already carries; no DOM.
 *
 * The comparison skips exactly what outputSync.ts's `stateKey` skips (shelves
 * and volatile keys), so a row exists only where the list and "does the output
 * match the preview" agree. A two-level store (`{ scope: { key: value } }`,
 * NESTED_KEYS) gives one row per (scope, key), so one slider is one row; every
 * other storage key gives one row for its whole text. A scene change is a
 * single row on its own: the scene's whole look travels with it, so there is
 * nothing smaller to send.
 */
import type { OutputState } from "./outputSync.ts";
import { SHELF_KEYS, VOLATILE_PREFIXES } from "./syncedStores.ts";

/** Stores held as { scope: { key: value } } — one row per (scope, key). */
const NESTED_KEYS: ReadonlySet<string> = new Set(["vibe.sceneSettings", "vibe.drives"]);

export type LookRow =
  | { id: "scene"; kind: "scene"; from: string; to: string }
  | { id: "palette"; kind: "palette"; from: string; to: string }
  | { id: string; kind: "key"; storageKey: string; from: string | null; to: string | null }
  | { id: string; kind: "entry"; storageKey: string; scope: string; key: string; from: unknown; to: unknown };

/** NEXT against LIVE. A different scene gives that one row only. Otherwise:
 *  palette, then every differing entry of a nested store, then every other
 *  differing key, each group sorted by id. */
export function diffLooks(next: OutputState, live: OutputState): LookRow[] {
  if (next.scene !== live.scene) return [{ id: "scene", kind: "scene", from: live.scene, to: next.scene }];
  const rows: LookRow[] = [];
  if (next.palette !== live.palette) rows.push({ id: "palette", kind: "palette", from: live.palette, to: next.palette });
  const entries: LookRow[] = [];
  const keys: LookRow[] = [];
  for (const key of comparedKeys(next, live)) {
    if (NESTED_KEYS.has(key)) {
      entries.push(...entryRows(key, live, next));
      continue;
    }
    const from = rawOf(live.storage, key);
    const to = rawOf(next.storage, key);
    if (from !== to) keys.push({ id: `k:${key}`, kind: "key", storageKey: key, from, to });
  }
  rows.push(...entries.sort(byId), ...keys.sort(byId));
  return rows;
}

/** LIVE with only `row` taken from NEXT (a scene row gives NEXT itself). */
export function takeRow(live: OutputState, next: OutputState, row: LookRow): OutputState {
  if (row.kind === "scene") return next;
  if (row.kind === "palette") return { ...live, palette: next.palette };
  const storage = { ...live.storage };
  if (row.kind === "key") {
    const text = rawOf(next.storage, row.storageKey);
    if (text === null) delete storage[row.storageKey];
    else setOwn(storage, row.storageKey, text);
  } else {
    // Parsed afresh from NEXT, so the object written into LIVE is a copy.
    const obj = readNested(rawOf(live.storage, row.storageKey));
    putEntry(obj, row.scope, row.key, entryOf(readNested(rawOf(next.storage, row.storageKey)), row.scope, row.key));
    if (Object.keys(obj).length > 0) setOwn(storage, row.storageKey, JSON.stringify(obj));
    else delete storage[row.storageKey];
  }
  return { ...live, storage };
}

/** The text NEXT's storage should hold for `row.storageKey` once the row is
 *  dropped (LIVE's value put back), null to remove the key. Undefined for a
 *  scene or palette row, which the caller drops another way. */
export function dropRowText(next: OutputState, live: OutputState, row: LookRow): string | null | undefined {
  if (row.kind === "scene" || row.kind === "palette") return undefined;
  if (row.kind === "key") return rawOf(live.storage, row.storageKey);
  const obj = readNested(rawOf(next.storage, row.storageKey));
  putEntry(obj, row.scope, row.key, entryOf(readNested(rawOf(live.storage, row.storageKey)), row.scope, row.key));
  return Object.keys(obj).length > 0 ? JSON.stringify(obj) : null;
}

const byId = (a: LookRow, b: LookRow): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Storage keys that the list compares: the union of both looks', less what
 *  stateKey leaves out. */
function comparedKeys(a: OutputState, b: OutputState): string[] {
  const all = new Set([...Object.keys(a.storage), ...Object.keys(b.storage)]);
  return [...all].filter((k) => !SHELF_KEYS.has(k) && !VOLATILE_PREFIXES.some((p) => k.startsWith(p)));
}

function entryRows(storageKey: string, live: OutputState, next: OutputState): LookRow[] {
  const liveObj = readNested(rawOf(live.storage, storageKey));
  const nextObj = readNested(rawOf(next.storage, storageKey));
  const rows: LookRow[] = [];
  for (const scope of unionKeys(liveObj, nextObj)) {
    const a = scopeOf(liveObj, scope) ?? {};
    const b = scopeOf(nextObj, scope) ?? {};
    for (const key of unionKeys(a, b)) {
      const from = own(a, key);
      const to = own(b, key);
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        rows.push({ id: `e:${storageKey}|${scope}|${key}`, kind: "entry", storageKey, scope, key, from, to });
      }
    }
  }
  return rows;
}

/** A nested store's object. Unreadable text, or anything but a plain object,
 *  reads as empty; both sides of a diff are read the same way. */
function readNested(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function entryOf(obj: Record<string, unknown>, scope: string, key: string): unknown {
  return own(scopeOf(obj, scope) ?? {}, key);
}

/** Sets or removes one entry in a nested object, then removes the scope when
 *  it is left empty so no empty scope object lingers in storage. */
function putEntry(obj: Record<string, unknown>, scope: string, key: string, entry: unknown): void {
  const inner = scopeOf(obj, scope) ?? {};
  if (entry === undefined) delete inner[key];
  else setOwn(inner, key, entry);
  if (Object.keys(inner).length > 0) setOwn(obj, scope, inner);
  else delete obj[scope];
}

function scopeOf(obj: Record<string, unknown>, scope: string): Record<string, unknown> | undefined {
  const v = own(obj, scope);
  return isRecord(v) ? v : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function rawOf(storage: Record<string, string>, key: string): string | null {
  return own(storage, key) ?? null;
}

/** Own keys only: a stored name such as "constructor" must not read as a prototype member. */
function own<T>(obj: Record<string, T>, key: string): T | undefined {
  // biome-ignore lint/suspicious/noPrototypeBuiltins: the method is called from Object.prototype, so a parsed object with its own "hasOwnProperty" key cannot shadow it (Object.hasOwn is past the es2017 target)
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

/** Own-property write: a stored key named "__proto__" must stay data, not reach the prototype. */
function setOwn<T>(obj: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

function unionKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])];
}
