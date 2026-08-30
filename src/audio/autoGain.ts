/**
 * Global amount, AUTO_GAIN_MIN..AUTO_GAIN_MAX, for the per-band adaptive
 * auto-gain in features.ts: how far each band's mapping is pulled from the
 * analyser's fixed dB window toward its own adaptive floor/peak window (the
 * blend itself lives in FeatureExtractor.update). AUTO_GAIN_MIN is the fixed
 * mapping alone, AUTO_GAIN_MAX the adaptive one alone; anything between
 * keeps some of the music's real bass-to-treble tilt while still converging
 * different mics/rooms toward the same look.
 *
 * Global per device (not per scene, unlike src/audio/sensitivity.ts and
 * src/render/sceneSettings.ts) — like src/audio/bandSplit.ts, how much the
 * room/mic needs auto-gain describes the input, not one scene's look, so it
 * should carry across scene switches. Same in-memory-cache-over-localStorage
 * pattern as bandSplit.ts: the cache is the source of truth for get/set
 * within a session, seeded once from localStorage, so behavior stays correct
 * even where localStorage is unavailable (node test env, Safari private mode).
 *
 * Default is AUTO_GAIN_MIN — the fixed mapping preserves the music's real
 * tilt, which the adaptive path flattens by design. This setting used to be
 * an on/off switch stored as "1"/"0" under the same key; those strings parse
 * as the two ends of the range, so nothing needs migrating.
 */

const STORAGE_KEY = "vibe.autoGain";
export const AUTO_GAIN_MIN = 0;
export const AUTO_GAIN_MAX = 1;
export const AUTO_GAIN_DEFAULT = AUTO_GAIN_MIN;

function clamp(value: number): number {
  if (!Number.isFinite(value)) return AUTO_GAIN_DEFAULT;
  return Math.min(AUTO_GAIN_MAX, Math.max(AUTO_GAIN_MIN, value));
}

function loadInitial(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return AUTO_GAIN_DEFAULT;
    return clamp(Number(raw));
  } catch {
    return AUTO_GAIN_DEFAULT;
  }
}

let cache: number = loadInitial();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(cache));
  } catch {
    // Not fatal — the setting just won't persist across reloads.
  }
}

export function getAutoGain(): number {
  return cache;
}

export function setAutoGain(next: number): void {
  cache = clamp(next);
  persist();
}
