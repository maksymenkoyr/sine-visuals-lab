/**
 * Global on/off switch for the per-band adaptive auto-gain in features.ts.
 * Global per device (not per scene, unlike src/audio/sensitivity.ts and
 * src/render/sceneSettings.ts) — like src/audio/bandSplit.ts, whether the
 * room/mic needs auto-gain describes the input, not one scene's look, so it
 * should carry across scene switches. Same in-memory-cache-over-localStorage
 * pattern as bandSplit.ts: the cache is the source of truth for get/set
 * within a session, seeded once from localStorage, so behavior stays correct
 * even where localStorage is unavailable (node test env, Safari private mode).
 *
 * Default is off — the fixed mapping it falls back to (see features.ts)
 * preserves the music's real bass-to-treble tilt, which the adaptive path
 * flattens by design. A user who wants the old flattening/convergence
 * behavior (e.g. a very quiet or very loud room) can still switch it on; that
 * choice is what persists here.
 */

const STORAGE_KEY = "vibe.autoGain";
export const AUTO_GAIN_DEFAULT = false;

function loadInitial(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return AUTO_GAIN_DEFAULT;
    return raw === "1";
  } catch {
    return AUTO_GAIN_DEFAULT;
  }
}

let cache: boolean = loadInitial();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, cache ? "1" : "0");
  } catch {
    // Not fatal — the switch just won't persist across reloads.
  }
}

export function isAutoGainEnabled(): boolean {
  return cache;
}

export function setAutoGainEnabled(next: boolean): void {
  cache = next;
  persist();
}
