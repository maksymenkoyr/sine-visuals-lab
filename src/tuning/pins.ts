/**
 * Dev-only pin layer for typing an out-of-range value into a param row (see
 * deviceMenu.ts's editable readout). Sibling to overrides.ts, with one
 * difference: a pin is *persisted* (localStorage, key below) so a value
 * survives a reload, where an override is pure in-memory and gone on one.
 *
 * autoTune.ts's resolve() consults this in its import.meta.env.DEV block,
 * after an override and before auto-pin — see that function's comment for
 * the full precedence chain. A pin never touches sceneSettings.ts's store:
 * it's how a value the store's min/max can't represent (that store clamps
 * on both read and write) still reaches the shader, without ever being able
 * to corrupt a real user's saved settings. In a production build,
 * import.meta.env.DEV compiles to `false` at every call site above, so this
 * module is never imported and tree-shakes out entirely — no clamping here
 * is safe only because of that; see the module's lazy load below for why it
 * must also carry no side effect at import time.
 */

const STORAGE_KEY = "vibe.devPins";

type Store = Record<string, Record<string, number>>;

// Loaded lazily (on first get/set) rather than at module scope: a top-level
// `loadInitial()` call would read localStorage during module evaluation,
// which is itself enough to keep Rollup from proving this module side-effect
// free and stripping it out of a production bundle — the one property this
// whole file exists to have.
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

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store()));
  } catch {
    // Not fatal — pins just won't survive a reload.
  }
}

function pinKey(sceneId: string, key: string): string {
  return `${sceneId}:${key}`;
}

export function getPin(sceneId: string, key: string): number | undefined {
  const value = store()[sceneId]?.[key];
  return typeof value === "number" ? value : undefined;
}

/** No clamping — any finite number round-trips exactly. Rejects non-finite
 *  input the same way tuning/bus.ts's applyTuningParams does for overrides,
 *  rather than falling back to a spec default the way sceneSettings.ts does:
 *  a pin has no spec to fall back to, it's cleared instead. */
export function setPin(sceneId: string, key: string, value: number): void {
  if (!Number.isFinite(value)) return;
  const s = store();
  (s[sceneId] ??= {})[key] = value;
  persist();
}

export function clearPin(sceneId: string, key: string): void {
  const s = store();
  const scenePins = s[sceneId];
  if (!scenePins || !(key in scenePins)) return;
  delete scenePins[key];
  if (Object.keys(scenePins).length === 0) delete s[sceneId];
  persist();
}

/** Drops every pin on every scene — mirrors overrides.ts's
 *  clearAllOverrides, for debug.ts's window.__viz.clearPins(). */
export function clearAllPins(): void {
  cache = {};
  persist();
}

/** For the numeric probe and any future pin-aware UI — every pin currently
 *  set, keyed the same way as the internal map. */
export function pinSnapshot(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [sceneId, scenePins] of Object.entries(store())) {
    for (const [key, value] of Object.entries(scenePins)) out[pinKey(sceneId, key)] = value;
  }
  return out;
}
