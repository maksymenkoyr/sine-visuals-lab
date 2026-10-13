/**
 * Which controls-panel layout is showing: the one everybody has, or the
 * three-column "ui-v2" one that is still being built. `?ui=v2` (or `?ui=v1`
 * to go back) in the address sets it and the choice is remembered; the V2 chip
 * in the Bands column head flips it live (deviceMenu.ts). Panel view state like
 * panelFolds.ts, not app state: nothing outside src/ui/ reads it, and it is not
 * part of a look, so it is a private key in syncedStores.ts: each window and
 * each phone keeps its own.
 *
 * What v2 changes so far: a pinned setting's wire panel opens in its own column
 * between the settings and the Power card instead of under the setting's row.
 * Same in-memory-cache-over-localStorage pattern as panelFolds.ts, so it also
 * works where localStorage is missing (the node test env, Safari private mode).
 */

const STORAGE_KEY = "vibe.uiVersion";

function loadInitial(): boolean {
  try {
    const asked = new URLSearchParams(location.search).get("ui");
    if (asked === "v2" || asked === "v1") {
      localStorage.setItem(STORAGE_KEY, asked);
      return asked === "v2";
    }
    return localStorage.getItem(STORAGE_KEY) === "v2";
  } catch {
    return false;
  }
}

let v2 = loadInitial();

export function isUiV2(): boolean {
  return v2;
}

export function setUiV2(on: boolean): void {
  v2 = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? "v2" : "v1");
  } catch {
    // Kept in memory for this session.
  }
}
