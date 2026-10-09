import { registerSyncedStore } from "../net/syncedStores.ts";
import type { SceneSetting } from "./sceneSettings.ts";

/**
 * Custom values: a scene setting typed past its slider's ends (deviceMenu.ts's
 * typed readout), kept apart from sceneSettings.ts's store. That store clamps
 * on both read and write, and should go on doing so: it is what pulls an old
 * saved value back into range when a scene's range changes. A custom value is
 * the one deliberate exception, set by hand and shown with a ⚠ by the number
 * for as long as it lasts.
 *
 * How it plays with the rest:
 * - autoTune.ts's resolve() returns a custom value ahead of auto (after only
 *   a dev tuning override), and resolveSceneSetting leaves it out of Master
 *   Scale, whose clamp would pull it straight back into range.
 * - Any write to the setting itself (setSceneSetting: a drag, ↺, the Scene
 *   card's Reset, a Look, a phone in the room) drops it, so it never shadows
 *   a later edit. The typed path writes the slider's nearest end first, then
 *   lays the custom value over it, so a reader that doesn't know about
 *   custom values (an older app on a room's TV) still sees the nearest end.
 * - It is part of the room look (net/syncedStores.ts), so a room's TV and the
 *   pop-out output show it too, and sceneLooks.ts carries it in a Look.
 *
 * How far: `customReach` allows `CUSTOM_REACH_SPANS` slider widths past either
 * end. That is enough for a glow, size or speed that wants to go several times
 * past its tuned end. It never goes below 0 for a slider that starts at 0 or
 * above (a negative glow or size is a shader's NaN, not a look). Only
 * continuous settings take one: a toggle, an option, or a step of 1 or more
 * (a count) takes none, because a count's max is usually a hard limit in the
 * scene's code. The bound stays finite because the value persists: a typo that
 * stalls the GPU would stall it again on every load. Dev builds lift it for
 * tuning (`unbounded`), as the old dev-only pins did.
 */

const STORAGE_KEY = "vibe.customValues";

type Store = Record<string, Record<string, number>>;

let cache: Store | null = null;

function loadInitial(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Matches sceneSettings.ts: no localStorage global at all (Vitest's node
    // env), storage disabled, or a corrupt blob — start empty either way.
    return {};
  }
}

function store(): Store {
  if (cache === null) cache = loadInitial();
  return cache;
}

// Re-seeds from localStorage once a snapshot lands — how the pop-out output
// and a room's TV pick up a custom value (net/syncedStores.ts).
registerSyncedStore(STORAGE_KEY, () => {
  cache = null;
});

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store()));
  } catch {
    // Not fatal — custom values just won't survive a reload.
  }
}

export function getCustomValue(sceneId: string, key: string): number | undefined {
  const value = store()[sceneId]?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Stores `value` as given — callers fit it first (fitCustom). Rejects a
 *  non-finite number rather than storing it. */
export function setCustomValue(sceneId: string, key: string, value: number): void {
  if (!Number.isFinite(value)) return;
  const s = store();
  (s[sceneId] ??= {})[key] = value;
  persist();
}

export function clearCustomValue(sceneId: string, key: string): void {
  const s = store();
  const scene = s[sceneId];
  if (!scene || !(key in scene)) return;
  delete scene[key];
  if (Object.keys(scene).length === 0) delete s[sceneId];
  persist();
}

/** Drops every custom value on every scene — for debug.ts's
 *  window.__viz.clearPins(), so a headless run starts clean. */
export function clearAllCustomValues(): void {
  cache = {};
  persist();
}

/** Every custom value set, keyed `sceneId:key` — for the numeric probe. */
export function customValueSnapshot(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [sceneId, scene] of Object.entries(store())) {
    for (const [key, value] of Object.entries(scene)) out[`${sceneId}:${key}`] = value;
  }
  return out;
}

type Range = Pick<SceneSetting, "min" | "max" | "step" | "type">;

/** How many slider widths a custom value may reach past either end — see the
 *  header's "How far". */
export const CUSTOM_REACH_SPANS = 4;

/** The span a custom value may take for this setting, or null when it takes
 *  none (a toggle, an option, or — outside a dev build — a count). See the
 *  header. */
export function customReach(range: Range, unbounded = false): { lo: number; hi: number } | null {
  if (range.type !== undefined) return null;
  if (unbounded) return { lo: -Infinity, hi: Infinity };
  if (range.step !== undefined && range.step >= 1) return null;
  const reach = (range.max - range.min) * CUSTOM_REACH_SPANS;
  return { lo: range.min >= 0 ? Math.max(0, range.min - reach) : range.min - reach, hi: range.max + reach };
}

/** `value` as a custom value for this setting: inside the slider's own range
 *  it is no custom value at all (null — the store takes it), past an end it
 *  is clamped into customReach, and a setting with no reach gets null. */
export function fitCustom(range: Range, value: number, unbounded = false): number | null {
  if (!Number.isFinite(value) || (value >= range.min && value <= range.max)) return null;
  const reach = customReach(range, unbounded);
  if (!reach) return null;
  return Math.min(reach.hi, Math.max(reach.lo, value));
}
