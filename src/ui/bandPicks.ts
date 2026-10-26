import { NUM_BANDS } from "../audio/types.ts";

/**
 * Which analyser bands have their own row on the Sound card (audioMeters.ts):
 * a click on a bar of its spectrum toggles that band's number here. Global
 * per device, not per scene or look, like historySpan.ts: it's how you like
 * to look at the panel and changes nothing a scene draws, so it's one of
 * src/net/syncedStores.ts's PRIVATE_KEYS. A band wired to a setting shows
 * its row whether picked or not; that rule lives in audioMeters.ts, not here.
 * Same in-memory-cache-over-localStorage pattern as historySpan.ts, so it
 * keeps working where localStorage is unavailable.
 *
 * Stored as a sorted list of unique band numbers in 0..NUM_BANDS-1; anything
 * else in the stored text is dropped on load.
 */

const STORAGE_KEY = "vibe.bandPicks";

function clean(list: readonly unknown[]): number[] {
  const ok = list.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < NUM_BANDS);
  return [...new Set(ok)].sort((a, b) => a - b);
}

function loadInitial(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? clean(parsed) : [];
  } catch {
    return [];
  }
}

let cache: readonly number[] = loadInitial();

export function getBandPicks(): readonly number[] {
  return cache;
}

export function isBandPicked(band: number): boolean {
  return cache.includes(band);
}

/** Adds `band` if it isn't picked, drops it if it is; returns whether it's
 *  picked now. */
export function toggleBandPick(band: number): boolean {
  const picked = !isBandPicked(band);
  cache = picked ? clean([...cache, band]) : cache.filter((n) => n !== band);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Not fatal — the pick just won't persist across reloads.
  }
  return picked;
}
