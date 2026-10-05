import { LOOK_LIMITS } from "../../server/lookDoc.ts";
import { registerSyncedStore } from "../net/syncedStores.ts";
import type { SceneSetting } from "./sceneSettings.ts";
import { captureLook, decodeLook, encodeLook, type SceneLook } from "./sceneLooks.ts";

/**
 * The Set: pads of saved looks from any scene, fired live (the Set card,
 * src/ui/setCard.ts; keys 1-9 and Autopilot, src/app.ts). This file is the
 * model and its store — pure functions over a `SetDoc` plus a thin
 * localStorage cache, so none of it needs a DOM.
 *
 * A pad is one clip: a scene, that scene's Look (sceneLooks.ts's SceneLook —
 * manual settings and drives) and the room palette id at capture time. It
 * embeds its own copy of the Look, so renaming or deleting a saved Look in
 * the Looks card never breaks a pad. Applying a pad is applyLook plus a
 * scene and palette switch; app.ts does the switching through its own
 * applyScene/applyPalette (that is how the pop-out's Cue/Play and a scene
 * crossfade see it like any other change), so this file only captures and
 * stores. The pad's name is the editable half of its label, which the card
 * draws as "<scene name> · <name>".
 *
 * Storage: one key, `vibe.set`. It is deliberately NOT in net/syncedStores.ts's
 * excluded list (unlike the Looks shelf): the Set has to reach a paired phone,
 * and a phone gets only what `isRoomKey` accepts, as part of the room's Main
 * look (so a pad added on the laptop reaches the phone with the laptop's next
 * Play, like every other setting). The store registers a reload hook so the
 * pop-out and a room's applyRoomStorage re-seed the cache. Each pad's Look is
 * stored in sceneLooks.ts's share-code form (encodeLook/decodeLook), not as
 * raw JSON: that format is version-tagged, already sanitises drive settings
 * and is the one a saved pad must outlive.
 *
 * The caps: SET_MAX_PADS pads, so every pad has a digit key, and
 * SET_MAX_CHARS of stored text, kept well under the room's one-value limit
 * (server/lookDoc.ts's LOOK_LIMITS) so a Set of heavy looks can never make
 * the room refuse the whole look. Adding past either is refused with a
 * reason; the card says it in words.
 *
 * The Autopilot dials live in the same document: `autopilot.everyBars` is one
 * of AUTOPILOT_EVERY_BARS (setAutopilot.ts runs them).
 */

/** Most pads a Set holds — one per digit key, 1 to 9. */
export const SET_MAX_PADS = 9;
/** Most stored text a Set may take; half the room's per-value limit. */
export const SET_MAX_CHARS = Math.floor(LOOK_LIMITS.maxValueBytes / 2);
/** The longest pad name the card accepts. */
export const PAD_NAME_MAX = 40;

/** What "Every" can be set to, in bars. */
export const AUTOPILOT_EVERY_BARS: readonly number[] = [4, 8, 16, 32, 64];
export const AUTOPILOT_EVERY_DEFAULT = 16;

export type AutopilotOrder = "inOrder" | "shuffle";
export const AUTOPILOT_ORDERS: readonly AutopilotOrder[] = ["inOrder", "shuffle"];

export interface AutopilotConfig {
  on: boolean;
  /** One of AUTOPILOT_EVERY_BARS. */
  everyBars: number;
  order: AutopilotOrder;
}

export interface SetPad {
  /** Stable for the pad's life (the markers and the Autopilot's cursor key on
   *  it); never reused, even after the pad is deleted. */
  id: string;
  /** The editable half of the label. */
  name: string;
  /** The room palette id at capture time. */
  paletteId: string;
  /** The pad's own copy; `look.sceneId` is the pad's scene. */
  look: SceneLook;
}

export interface SetDoc {
  pads: SetPad[];
  /** The next pad number: ids are `p<number>` and are never handed out twice. */
  next: number;
  autopilot: AutopilotConfig;
}

export const AUTOPILOT_DEFAULT: AutopilotConfig = { on: false, everyBars: AUTOPILOT_EVERY_DEFAULT, order: "inOrder" };

export function emptySet(): SetDoc {
  return { pads: [], next: 1, autopilot: { ...AUTOPILOT_DEFAULT } };
}

/** "Look 1", "Look 2", … — the lowest number no pad of this scene uses yet. */
export function defaultPadName(pads: readonly SetPad[], sceneId: string): string {
  const used = new Set(pads.filter((p) => p.look.sceneId === sceneId).map((p) => p.name));
  let n = 1;
  while (used.has(`Look ${n}`)) n++;
  return `Look ${n}`;
}

export type AddPadResult =
  | { ok: true; doc: SetDoc; pad: SetPad }
  | { ok: false; reason: "full" | "tooBig" };

/** Adds a pad holding `look` (copied) and `paletteId`. Refused when the Set
 *  already has SET_MAX_PADS or the stored text would pass SET_MAX_CHARS. */
export function addPad(doc: SetDoc, look: SceneLook, paletteId: string, name?: string): AddPadResult {
  if (doc.pads.length >= SET_MAX_PADS) return { ok: false, reason: "full" };
  const pad: SetPad = {
    id: `p${doc.next}`,
    name: (name ?? defaultPadName(doc.pads, look.sceneId)).slice(0, PAD_NAME_MAX),
    paletteId,
    look: { ...look, name: "" },
  };
  const next: SetDoc = { ...doc, pads: [...doc.pads, pad], next: doc.next + 1 };
  if (serializeSet(next).length > SET_MAX_CHARS) return { ok: false, reason: "tooBig" };
  return { ok: true, doc: next, pad };
}

/** Captures what is on screen now — the scene's current Look and the palette
 *  — as a new pad. The look is captured the way the Looks card's Save does. */
export function capturePad(
  doc: SetDoc,
  sceneId: string,
  specs: readonly SceneSetting[],
  paletteId: string,
): AddPadResult {
  return addPad(doc, captureLook("", sceneId, specs), paletteId);
}

/** A blank name, or one that does not change, leaves the Set as it is. */
export function renamePad(doc: SetDoc, id: string, name: string): SetDoc {
  const trimmed = name.trim().slice(0, PAD_NAME_MAX);
  if (!trimmed) return doc;
  if (!doc.pads.some((p) => p.id === id && p.name !== trimmed)) return doc;
  return { ...doc, pads: doc.pads.map((p) => (p.id === id ? { ...p, name: trimmed } : p)) };
}

export function removePad(doc: SetDoc, id: string): SetDoc {
  if (!doc.pads.some((p) => p.id === id)) return doc;
  return { ...doc, pads: doc.pads.filter((p) => p.id !== id) };
}

export function withAutopilot(doc: SetDoc, change: Partial<AutopilotConfig>): SetDoc {
  const autopilot = sanitizeAutopilot({ ...doc.autopilot, ...change });
  return { ...doc, autopilot };
}

function sanitizeAutopilot(raw: unknown): AutopilotConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const every = typeof r.everyBars === "number" && AUTOPILOT_EVERY_BARS.includes(r.everyBars) ? r.everyBars : AUTOPILOT_EVERY_DEFAULT;
  const order = AUTOPILOT_ORDERS.includes(r.order as AutopilotOrder) ? (r.order as AutopilotOrder) : AUTOPILOT_DEFAULT.order;
  return { on: r.on === true, everyBars: every, order };
}

const STORE_VERSION = 1;

export function serializeSet(doc: SetDoc): string {
  return JSON.stringify({
    v: STORE_VERSION,
    next: doc.next,
    pads: doc.pads.map((p) => ({ id: p.id, name: p.name, palette: p.paletteId, look: encodeLook(p.look) })),
    autopilot: doc.autopilot,
  });
}

/** Never throws: unreadable text, a future version or a pad whose Look no
 *  longer decodes comes back as the Set without it (a Set outlives the build
 *  that wrote it). A key a room or an old build planted is clamped to what
 *  this build allows. */
export function parseSet(raw: string | null): SetDoc {
  if (!raw) return emptySet();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.v !== STORE_VERSION || !Array.isArray(parsed.pads)) return emptySet();
    const pads: SetPad[] = [];
    const seen = new Set<string>();
    let next = typeof parsed.next === "number" && Number.isFinite(parsed.next) ? Math.max(1, Math.floor(parsed.next)) : 1;
    for (const p of parsed.pads) {
      if (pads.length >= SET_MAX_PADS) break;
      if (!p || typeof p !== "object" || typeof p.id !== "string" || typeof p.look !== "string") continue;
      if (seen.has(p.id)) continue;
      const look = decodeLook(p.look);
      if (!look) continue;
      seen.add(p.id);
      const n = /^p(\d+)$/.exec(p.id);
      if (n) next = Math.max(next, Number(n[1]) + 1);
      const name = typeof p.name === "string" ? p.name.trim().slice(0, PAD_NAME_MAX) : "";
      pads.push({
        id: p.id,
        name: name || defaultPadName(pads, look.sceneId),
        paletteId: typeof p.palette === "string" ? p.palette : "",
        look,
      });
    }
    return { pads, next, autopilot: sanitizeAutopilot(parsed.autopilot) };
  } catch {
    return emptySet();
  }
}

// ---- the store: a cache over localStorage, same pattern as sceneLooks.ts ----

const STORAGE_KEY = "vibe.set";

function loadInitial(): SetDoc {
  try {
    return parseSet(localStorage.getItem(STORAGE_KEY));
  } catch {
    return emptySet();
  }
}

let cache: SetDoc = loadInitial();

// Re-seeds from localStorage for the pop-out and a room's applied look
// (net/syncedStores.ts).
registerSyncedStore(STORAGE_KEY, () => {
  cache = loadInitial();
});

function commit(doc: SetDoc): void {
  cache = doc;
  try {
    localStorage.setItem(STORAGE_KEY, serializeSet(doc));
  } catch {
    // Not fatal — the Set just won't persist across reloads.
  }
}

export function getSet(): SetDoc {
  return cache;
}

export function listPads(): readonly SetPad[] {
  return cache.pads;
}

/** Captures the current scene's Look and palette as a new pad. */
export function addCapturedPad(sceneId: string, specs: readonly SceneSetting[], paletteId: string): AddPadResult {
  const result = capturePad(cache, sceneId, specs, paletteId);
  if (result.ok) commit(result.doc);
  return result;
}

export function renameStoredPad(id: string, name: string): void {
  const next = renamePad(cache, id, name);
  if (next !== cache) commit(next);
}

export function removeStoredPad(id: string): void {
  const next = removePad(cache, id);
  if (next !== cache) commit(next);
}

export function getAutopilot(): AutopilotConfig {
  return cache.autopilot;
}

export function setAutopilot(change: Partial<AutopilotConfig>): void {
  commit(withAutopilot(cache, change));
}
