/**
 * Dev-only override of a scene setting's *default* — what a row's Reset
 * (↺ / R) snaps back to, set live from the device menu's D hotkey ("the
 * value I'm looking at right now is what Reset should mean from now on").
 * Sibling to pins.ts: same persisted Record<sceneId, Record<key, number>>
 * shape, same lazy load so this module carries no side effect at import
 * time and tree-shakes out of a production build the way that file's header
 * explains. Unlike a pin, this never substitutes for the live value — it
 * only changes what "default" resolves to — so it stays out of
 * sceneSettings.ts's store and autoTune.ts's resolve() precedence chain
 * entirely; deviceMenu.ts reads it once per row build to seed
 * ControlRowSpec.defaultValue.
 */

const STORAGE_KEY = "vibe.devDefaults";

type Store = Record<string, Record<string, number>>;

let cache: Store | null = null;

function loadInitial(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Matches pins.ts: no localStorage global at all (Vitest's node env),
    // storage disabled, or a corrupt blob — start empty either way.
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
    // Not fatal — the override just won't survive a reload.
  }
}

export function getDefaultOverride(sceneId: string, key: string): number | undefined {
  const value = store()[sceneId]?.[key];
  return typeof value === "number" ? value : undefined;
}

export function setDefaultOverride(sceneId: string, key: string, value: number): void {
  if (!Number.isFinite(value)) return;
  const s = store();
  (s[sceneId] ??= {})[key] = value;
  persist();
}
