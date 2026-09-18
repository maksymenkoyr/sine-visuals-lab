import type { QualityPreset } from "./quality.ts";

/**
 * User override for which quality preset drives rendering, global per device
 * (like src/render/powerMode.ts, src/audio/autoGain.ts, and
 * src/audio/bandSplit.ts, not per scene).
 *
 * - "auto": follows detectQuality()'s boot-time GPU benchmark — what every
 *   device used before this setting existed. The choice for a device that
 *   wants to be governed by its own measured headroom instead of pinned.
 * - "high" (default) / "mid" / "low" / "floor": pins the baseline the
 *   quality governor (src/render/governor.ts) steps from, overriding the
 *   benchmark. Shipped defaulting to "high": a fresh device starts at full
 *   detail rather than whatever a cold-boot benchmark guesses. app.ts still
 *   shows which preset Auto would have picked, marked as recommended — on a
 *   device the benchmark would place below High, that underline lands on a
 *   different chip than the lit one, which is the override affordance
 *   working as intended, not a bug. A user who knows their device better
 *   than the benchmark, or wants to trade sharpness for headroom, sets this
 *   directly.
 *
 * Same in-memory-cache-over-localStorage pattern as powerMode.ts: the cache
 * is the source of truth for get/set within a session, seeded once from
 * localStorage, so behavior stays correct even where localStorage is
 * unavailable (node test env, Safari private mode).
 */

export type QualityChoice = "auto" | QualityPreset;

const STORAGE_KEY = "vibe.quality";
export const QUALITY_CHOICE_DEFAULT: QualityChoice = "high";

function isQualityChoice(value: string): value is QualityChoice {
  return value === "auto" || value === "high" || value === "mid" || value === "low" || value === "floor";
}

function loadInitial(): QualityChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw !== null && isQualityChoice(raw) ? raw : QUALITY_CHOICE_DEFAULT;
  } catch {
    return QUALITY_CHOICE_DEFAULT;
  }
}

let cache: QualityChoice = loadInitial();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, cache);
  } catch {
    // Not fatal — the choice just won't persist across reloads.
  }
}

export function getQualityChoice(): QualityChoice {
  return cache;
}

export function setQualityChoice(next: QualityChoice): void {
  cache = next;
  persist();
}
