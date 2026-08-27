/**
 * Per-scene user-tunable parameters, uploaded to the shader as `uniform float
 * u<Key>` (see fullscreenScene.ts). Mirrors src/audio/sensitivity.ts: an
 * in-memory cache seeded once from localStorage, so get/set stay correct
 * even where localStorage is unavailable (node test env, Safari private
 * mode) — only cross-reload persistence depends on it.
 */
export interface SceneSetting {
  /** Uniform suffix — "focus" becomes uFocus. Keep it a valid GLSL identifier tail. */
  key: string;
  /** Shown in the device menu. */
  label: string;
  /** One-line plain-language note shown under the slider. Omit for no caption. */
  description?: string;
  /** Optional section heading. Consecutive settings sharing a group render
   *  under one heading in the device menu; omit entirely for a flat list. */
  group?: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** "boolean" renders as a checkbox (still stored/uploaded as 0/1) instead
   *  of a range slider. Omit for the default numeric slider. */
  type?: "boolean";
  /**
   * Promoted from a constant to make it scrubbable, but not yet earning a
   * place in the user's menu. A draft renders only in a tuning session (see
   * docs/tuning.md's promote -> scrub -> keep/draft/bake loop), under its own
   * collapsed "Dev" section, and persists to the dev-only store below rather
   * than to a user's saved settings. Clear the flag to keep it, or fold the
   * value back into a constant and delete the entry to bake it.
   */
  draft?: true;
  /** How this parameter responds to music character. Signed weights per dial;
   *  omit for a parameter that should stay manual. See autoTune.ts. Inline
   *  type-only import avoids a runtime cycle with autoTune.ts, which imports
   *  SceneSetting from this file. */
  auto?: import("./autoTune.ts").AutoWeights;
}

const STORAGE_KEY = "vibe.sceneSettings";
/**
 * Draft settings persist here instead, and only in a dev build. A separate
 * key on purpose, twice over: a production build never reads it even if a
 * stale value is sitting in the browser, and a tuning session can promote and
 * scrub freely without ever writing the settings a user has saved. That's the
 * same invariant src/tuning/overrides.ts protects, extended to survive the
 * reloads that promoting a constant tends to involve.
 */
const DEV_STORAGE_KEY = "vibe.devSettings";

type Store = Record<string, Record<string, number>>;

function loadInitial(key: string): Store {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const cache: Store = loadInitial(STORAGE_KEY);
// Never populated in a production build: nothing reaches storeFor with a
// draft spec there, since draft rows aren't rendered and aren't written.
const devCache: Store = import.meta.env.DEV ? loadInitial(DEV_STORAGE_KEY) : {};

function storeFor(spec: SceneSetting): { cache: Store; key: string } {
  return import.meta.env.DEV && spec.draft
    ? { cache: devCache, key: DEV_STORAGE_KEY }
    : { cache, key: STORAGE_KEY };
}

function persist(store: Store, key: string): void {
  try {
    localStorage.setItem(key, JSON.stringify(store));
  } catch {
    // Not fatal — settings just won't persist across reloads.
  }
}

function clamp(spec: SceneSetting, value: number): number {
  if (!Number.isFinite(value)) return spec.default;
  return Math.min(spec.max, Math.max(spec.min, value));
}

export function getSceneSetting(sceneId: string, spec: SceneSetting): number {
  const store = storeFor(spec).cache;
  const value = store[sceneId]?.[spec.key];
  return typeof value === "number" ? clamp(spec, value) : spec.default;
}

export function setSceneSetting(sceneId: string, spec: SceneSetting, value: number): void {
  const store = storeFor(spec);
  (store.cache[sceneId] ??= {})[spec.key] = clamp(spec, value);
  persist(store.cache, store.key);
}

export function resetSceneSettings(sceneId: string, specs: SceneSetting[]): void {
  for (const spec of specs) setSceneSetting(sceneId, spec, spec.default);
}
