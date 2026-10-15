/**
 * The generic gate's Smoothness formulas (drives.ts's header, threshold
 * paragraph): how Smoothness softens a setting's Min/Max window.
 *
 * Temporary. While PR #544 picks which formula Smoothness keeps, a dev build
 * shows a picker under a setting's Smoothness row (deviceMenu.ts's
 * buildSmoothnessRow) and keeps the choice per setting under
 * GATE_FORMULA_STORAGE_KEY; a production build always runs
 * GATE_FORMULA_DEFAULT. The same formulas run in the "Gate Smoothness Lab"
 * artifact. Once one is picked, this file shrinks to that one.
 *
 * Every formula reads the window's two lines (`line` is Min, `top` is Max,
 * both on the 0→peak scale) and the tracked `peak`, plus `s`, the
 * Smoothness, where 0 gives every formula the exact window. The shape
 * formulas work on the reading alone. The others keep a little memory on the
 * gate tracker (`open`, `y`, `x`): stepGateFormula steps it once per tick,
 * next to the tracker itself, and gateFormulaOut only reads it, since
 * value() may run more than once a frame.
 */
import { parseSyncedObject, registerSyncedStore } from "../net/syncedStores.ts";
import { settingScope } from "./sceneSettings.ts";

export const GATE_FORMULAS = [
  { id: "inside", label: "Widen inside 0 and the peak" },
  { id: "past", label: "Widen past the ends (old)" },
  { id: "corners", label: "Rounded corners" },
  { id: "sticky", label: "Sticky gate" },
  { id: "glide", label: "Glide" },
  { id: "riseFall", label: "Fast rise, slow fall" },
  { id: "smoothFirst", label: "Smooth the signal first" },
] as const;
export type GateFormula = (typeof GATE_FORMULAS)[number]["id"];
const GATE_FORMULA_DEFAULT: GateFormula = "inside";

/** The part of drives.ts's gate tracker a formula reads and steps. */
export interface GateFormulaState {
  peak: number;
  line: number;
  top: number;
  /** "sticky": whether the gate is open. */
  open: boolean;
  /** "glide" / "riseFall": the eased output, NaN until the first step. */
  y: number;
  /** "smoothFirst": the eased reading, NaN until the first step. */
  x: number;
}

// "past": how far each end moves, as a share of the 0→peak range at full
// Smoothness, with a floor on that range so a silent signal still softens
// (the formula main had before PR #544).
const PAST_REACH = 2;
const PAST_RANGE_MIN = 0.1;
// "corners": each corner's half-width at full Smoothness, as a share of the peak.
const CORNER_REACH = 0.5;
// Time formulas: their easing time at full Smoothness.
const GLIDE_TAU_MAX_SEC = 0.6;
const FALL_TAU_MAX_SEC = 1.2;
const RISE_TAU_SEC = 0.01;
const SMOOTH_FIRST_TAU_MAX_SEC = 0.4;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function windowOut(v: number, lo: number, hi: number, g: GateFormulaState): number {
  if (hi - lo <= 1e-6) return v >= g.line ? g.peak : 0;
  return g.peak * clamp01((v - lo) / (hi - lo));
}

function exact(v: number, g: GateFormulaState): number {
  return windowOut(v, g.line, g.top, g);
}

// A compressor-style soft corner `k` wide on each side of 0.
function softRamp(x: number, k: number): number {
  if (k <= 0) return Math.max(0, x);
  if (x < -k) return 0;
  if (x > k) return x;
  return ((x + k) * (x + k)) / (4 * k);
}

function cornersFrac(v: number, g: GateFormulaState, k: number): number {
  const w = g.top - g.line;
  if (w > 1e-6) return clamp01((softRamp(v - g.line, k) - softRamp(v - g.top, k)) / w);
  if (k <= 0) return v >= g.line ? 1 : 0;
  return clamp01((v - g.line + k) / (2 * k));
}

function ease(y: number, target: number, tau: number, dtSec: number): number {
  return tau <= 0 ? target : y + (target - y) * (1 - Math.exp(-dtSec / tau));
}

/** Steps a time formula's memory by one tick, after the tracker's own lines moved. */
export function stepGateFormula(f: GateFormula, g: GateFormulaState, v: number, s: number, dtSec: number): void {
  switch (f) {
    case "sticky": {
      if (g.open) {
        if (v < g.line * (1 - s)) g.open = false;
      } else if (v >= g.line) g.open = true;
      return;
    }
    case "glide": {
      const target = exact(v, g);
      g.y = Number.isFinite(g.y) ? ease(g.y, target, s * GLIDE_TAU_MAX_SEC, dtSec) : target;
      return;
    }
    case "riseFall": {
      const target = exact(v, g);
      g.y = Number.isFinite(g.y) ? ease(g.y, target, target > g.y ? RISE_TAU_SEC : s * FALL_TAU_MAX_SEC, dtSec) : target;
      return;
    }
    case "smoothFirst":
      g.x = Number.isFinite(g.x) ? ease(g.x, v, s * SMOOTH_FIRST_TAU_MAX_SEC, dtSec) : v;
      return;
    default:
      return;
  }
}

/** What the setting receives for reading `v`. */
export function gateFormulaOut(f: GateFormula, g: GateFormulaState, v: number, s: number): number {
  switch (f) {
    case "past": {
      const k = PAST_REACH * s * Math.max(g.peak, PAST_RANGE_MIN);
      return windowOut(v, g.line - k, g.top + k, g);
    }
    case "corners":
      return g.peak * cornersFrac(v, g, CORNER_REACH * s * g.peak);
    case "sticky":
      return g.open ? windowOut(v, g.line * (1 - s), g.top, g) : 0;
    case "glide":
    case "riseFall":
      return Number.isFinite(g.y) ? g.y : exact(v, g);
    case "smoothFirst":
      return exact(Number.isFinite(g.x) ? g.x : v, g);
    default:
      return windowOut(v, g.line * (1 - s), g.top + s * (g.peak - g.top), g);
  }
}

// ---- the dev-only per-setting choice ----

const GATE_FORMULA_STORAGE_KEY = "vibe.gateFormula";
const FORMULA_IDS: ReadonlySet<string> = new Set(GATE_FORMULAS.map((f) => f.id));

function readStore(): Record<string, unknown> {
  return parseSyncedObject(localStorage.getItem(GATE_FORMULA_STORAGE_KEY)) ?? {};
}

let cache: Record<string, unknown> = (() => {
  try {
    return readStore();
  } catch {
    return {};
  }
})();

// Re-seeds from localStorage for the pop-out output window (net/syncedStores.ts).
registerSyncedStore(GATE_FORMULA_STORAGE_KEY, () => {
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
    localStorage.setItem(GATE_FORMULA_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Not fatal: the pick just won't survive a reload.
  }
}
