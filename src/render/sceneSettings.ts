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
  /** How this parameter responds to music character. Signed weights per dial;
   *  omit for a parameter that should stay manual. See autoTune.ts. Inline
   *  type-only import avoids a runtime cycle with autoTune.ts, which imports
   *  SceneSetting from this file. */
  auto?: import("./autoTune.ts").AutoWeights;
}

const STORAGE_KEY = "vibe.sceneSettings";

type Store = Record<string, Record<string, number>>;

function loadInitial(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const cache: Store = loadInitial();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Not fatal — settings just won't persist across reloads.
  }
}

function clamp(spec: SceneSetting, value: number): number {
  if (!Number.isFinite(value)) return spec.default;
  return Math.min(spec.max, Math.max(spec.min, value));
}

export function getSceneSetting(sceneId: string, spec: SceneSetting): number {
  const value = cache[sceneId]?.[spec.key];
  return typeof value === "number" ? clamp(spec, value) : spec.default;
}

export function setSceneSetting(sceneId: string, spec: SceneSetting, value: number): void {
  (cache[sceneId] ??= {})[spec.key] = clamp(spec, value);
  persist();
}

export function resetSceneSettings(sceneId: string, specs: SceneSetting[]): void {
  for (const spec of specs) setSceneSetting(sceneId, spec, spec.default);
}
