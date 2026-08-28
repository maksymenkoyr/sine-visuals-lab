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
 * Default is on — this is a debug/preference escape hatch for comparing the
 * spectrum strip's "before processing" and processed views on equal footing
 * (see src/ui/spectrumStrip.ts), not a change to default behavior.
 */

const STORAGE_KEY = "vibe.autoGain";
export const AUTO_GAIN_DEFAULT = true;

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
