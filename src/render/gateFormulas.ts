/**
 * A dev build's per-setting pick of Smoothness's formula (gateWindow.ts's
 * GATE_FORMULAS). Temporary: while PR #544 picks which formula Smoothness
 * keeps, a dev build shows a picker under a setting's Smoothness row
 * (deviceMenu.ts's buildSmoothnessRow) and keeps the choice here, per
 * setting. A production build always runs GATE_FORMULA_DEFAULT. Once a
 * formula is picked, this file and the picker go.
 */
import { parseSyncedObject, registerSyncedStore } from "../net/syncedStores.ts";
import { GATE_FORMULA_DEFAULT, GATE_FORMULAS, type GateFormula } from "./gateWindow.ts";
import { settingScope } from "./sceneSettings.ts";

const STORAGE_KEY = "vibe.gateFormula";
const FORMULA_IDS: ReadonlySet<string> = new Set(GATE_FORMULAS.map((f) => f.id));

function readStore(): Record<string, unknown> {
  return parseSyncedObject(localStorage.getItem(STORAGE_KEY)) ?? {};
}

let cache: Record<string, unknown> = (() => {
  try {
    return readStore();
  } catch {
    return {};
  }
})();

// Re-seeds from localStorage for the pop-out output window (net/syncedStores.ts).
registerSyncedStore(STORAGE_KEY, () => {
  cache = readStore();
});

/** The formula a setting's gate runs: its dev pick, or GATE_FORMULA_DEFAULT. */
export function getGateFormula(sceneId: string, key: string): GateFormula {
  if (!import.meta.env.DEV) return GATE_FORMULA_DEFAULT;
  const f = cache[`${settingScope(sceneId, key)}:${key}`];
  return typeof f === "string" && FORMULA_IDS.has(f) ? (f as GateFormula) : GATE_FORMULA_DEFAULT;
}

export function setGateFormula(sceneId: string, key: string, f: GateFormula): void {
  cache[`${settingScope(sceneId, key)}:${key}`] = f;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Not fatal: the pick just won't survive a reload.
  }
}
