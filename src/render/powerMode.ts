/**
 * Global on/off/override for the quality governor (src/render/governor.ts).
 * Global per device (like src/audio/autoGain.ts and src/audio/bandSplit.ts,
 * not per scene) — whether this device wants to trade picture quality for
 * battery describes the device, not one scene's look.
 *
 * - "auto" (default): the governor runs closed-loop, stepping quality down
 *   under sustained GPU load and back up once comfortable, with the
 *   authority probe (governor.ts) so a pace this page doesn't control (a
 *   browser energy-saver mode, an OS refresh-rate cap) can't be mistaken
 *   for overload.
 * - "on": a deliberate, user-forced saver — quality stays at the chosen
 *   preset's baseline (nothing is cut), but the render-rate cap drops to
 *   RENDER_FPS_CAP_FLOOR (see src/render/framePace.ts). Halving the render
 *   rate roughly halves GPU work without reintroducing the softness a
 *   resolution cut causes, at a comparable saving.
 * - "off": the governor never steps anything — quality is pinned to
 *   whatever the quality setting resolved to (src/render/qualityPref.ts),
 *   for a session where dropped frames are preferable to any quality loss.
 *
 * Same in-memory-cache-over-localStorage pattern as autoGain.ts: the cache
 * is the source of truth for get/set within a session, seeded once from
 * localStorage, so behavior stays correct even where localStorage is
 * unavailable (node test env, Safari private mode).
 */

export type PowerMode = "auto" | "on" | "off";

const STORAGE_KEY = "vibe.powerMode";
export const POWER_MODE_DEFAULT: PowerMode = "auto";

function isPowerMode(value: string): value is PowerMode {
  return value === "auto" || value === "on" || value === "off";
}

function loadInitial(): PowerMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw !== null && isPowerMode(raw) ? raw : POWER_MODE_DEFAULT;
  } catch {
    return POWER_MODE_DEFAULT;
  }
}

let cache: PowerMode = loadInitial();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, cache);
  } catch {
    // Not fatal — the switch just won't persist across reloads.
  }
}

export function getPowerMode(): PowerMode {
  return cache;
}

export function setPowerMode(next: PowerMode): void {
  cache = next;
  persist();
}
