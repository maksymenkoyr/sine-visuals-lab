import { NUM_BANDS } from "./types.ts";
import { parseSyncedObject, registerSyncedStore } from "../net/syncedStores.ts";

/**
 * Persisted low/mid/high crossover for src/render/bandEnergy.ts, tunable from
 * the config panel's Bands box. Global per device (not per scene, unlike
 * src/audio/sensitivity.ts and src/render/sceneSettings.ts) — a crossover
 * describes the room and the music, not one scene's look, so it should carry
 * across scene switches. Same in-memory-cache-over-localStorage pattern as
 * those two modules: the cache is the source of truth for get/set within a
 * session, seeded once from localStorage, so behavior stays correct even
 * where localStorage is unavailable (node test env, Safari private mode).
 */
export interface BandSplit {
  /** Band index where "low" ends and "mid" begins. */
  lowMid: number;
  /** Band index where "mid" ends and "high" begins. */
  midHigh: number;
}

// Reproduces today's hardcoded src/render/bandEnergy.ts split exactly:
// LOW_BANDS = [0..5], MID_BANDS = [6..15], HIGH_BANDS = [16..23].
export const LOW_MID_DEFAULT = 6;
export const MID_HIGH_DEFAULT = 16;

const DEFAULT_SPLIT: BandSplit = { lowMid: LOW_MID_DEFAULT, midHigh: MID_HIGH_DEFAULT };

const STORAGE_KEY = "vibe.bandSplit";

// Strict: throws on text that is not a JSON object, so the reload hook keeps
// the split it has (net/syncedStores.ts's parseSyncedObject). An absent key is
// the default split.
function readSplit(): BandSplit {
  const parsed = parseSyncedObject(localStorage.getItem(STORAGE_KEY));
  if (parsed === null) return { ...DEFAULT_SPLIT };
  return clampSplit({
    lowMid: typeof parsed.lowMid === "number" ? parsed.lowMid : DEFAULT_SPLIT.lowMid,
    midHigh: typeof parsed.midHigh === "number" ? parsed.midHigh : DEFAULT_SPLIT.midHigh,
  });
}

function loadInitial(): BandSplit {
  try {
    return readSplit();
  } catch {
    return { ...DEFAULT_SPLIT };
  }
}

/** Keeps every group non-empty: 1 <= lowMid < midHigh <= NUM_BANDS - 1, so
 *  [0,lowMid), [lowMid,midHigh), [midHigh,NUM_BANDS) can never divide by zero. */
function clampSplit(split: BandSplit): BandSplit {
  const safe = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
  let lowMid = Math.round(safe(split.lowMid, DEFAULT_SPLIT.lowMid));
  let midHigh = Math.round(safe(split.midHigh, DEFAULT_SPLIT.midHigh));
  lowMid = Math.min(NUM_BANDS - 2, Math.max(1, lowMid));
  midHigh = Math.min(NUM_BANDS - 1, Math.max(lowMid + 1, midHigh));
  return { lowMid, midHigh };
}

let cache: BandSplit = loadInitial();
let version = 0;

// A snapshot applied from outside (the pop-out's Cue, a room look on a TV)
// re-seeds the split. It bumps `version` like any change, so bandEnergy.ts
// rebuilds its cached group edges instead of rendering the old crossover.
// Unreadable text throws out of readSplit before either line runs, so neither
// the split nor the version moves.
registerSyncedStore(STORAGE_KEY, () => {
  cache = readSplit();
  version++;
});

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Not fatal — split just won't persist across reloads.
  }
}

export function getBandSplit(): BandSplit {
  return cache;
}

export function setBandSplit(next: Partial<BandSplit>): void {
  cache = clampSplit({ ...cache, ...next });
  version++;
  persist();
}

export function resetBandSplit(): void {
  cache = { ...DEFAULT_SPLIT };
  version++;
  persist();
}

/** Bumped on every set/reset — lets consumers (bandEnergy.ts) cheaply detect
 *  a change without re-reading the split every frame. */
export function bandSplitVersion(): number {
  return version;
}
