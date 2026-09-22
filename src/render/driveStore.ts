import { NUM_BANDS } from "../audio/types.ts";
import { LINE_HEIGHT_DEFAULT, LINE_STRENGTH_DEFAULT, LINE_STRENGTH_MAX, LINE_STRENGTH_MIN, sanitizeLine } from "../audio/bandLine.ts";
import { BEAT_GRIDS, BEAT_GRID_DEFAULT, LEGACY_BEAT_GRID_STORAGE_KEY } from "../audio/beatGrid.ts";
import { SIGNALS } from "./signals.ts";
import { settingScope, type SceneSetting } from "./sceneSettings.ts";
import type { DriveChoice } from "./drives.ts";

/**
 * Storage for `SceneSetting.drive` — the choice a drive setting is
 * currently on, plus (for a setting parked on Frequencies) the line it was
 * drawn with and its overall strength. One entry per (scene, setting),
 * scoped through sceneSettings.ts's settingScope() exactly like the plain
 * value store, so a scene's variant (Kaleidoscope's Style, …) keeps its own
 * profile of drive choices too. Same cache-over-localStorage pattern as
 * every other store here: the in-memory cache is the source of truth for
 * get/set within a session, seeded once from localStorage, so behavior
 * stays correct even where localStorage is unavailable (node test env,
 * Safari private mode).
 *
 * The line lives here rather than in src/audio/bandLine.ts because it's
 * keyed one level deeper than that module's old per-scene store: two drive
 * settings on the same scene each draw their own line (bandLine.ts's own
 * header covers why bandLineDrive() itself — the pure math — stayed put).
 *
 * Migration: a scene that had a non-Hits grid stored under beatGrid.ts's
 * retired per-scene store (LEGACY_BEAT_GRID_STORAGE_KEY, `vibe.beatGrid`)
 * converts once, lazily, the first time getDriveChoice() is asked about a
 * setting whose own `drive.default` is the plain "feature.onset" (Beat)
 * catalogue choice: it resolves to (and persists) `{source:"beat", grid}`
 * instead of the plain default, so a scene whose beat reactions used to run
 * on, say, "1 bar" doesn't suddenly snap back to raw Hits the moment this
 * system takes over gridding beat edges (see drives.ts's header for why
 * that's now a per-setting concern instead of animClock's own single
 * global grid). A setting whose default is anything other than plain Beat
 * never had a global grid apply to it in the first place, so it's left
 * alone. Read once at module load — the legacy store is retired, not kept
 * live alongside this one.
 */

interface DriveEntry {
  choice?: DriveChoice;
  line?: number[];
  lineStrength?: number;
}

type Store = Record<string, Record<string, DriveEntry>>;

const STORAGE_KEY = "vibe.drives";

function loadInitial(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const cache: Store = loadInitial();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Not fatal — drive choices/lines just won't persist across reloads.
  }
}

function entryFor(scope: string, key: string): DriveEntry {
  const bucket = (cache[scope] ??= {});
  return (bucket[key] ??= {});
}

// ---- Legacy beat-grid migration -------------------------------------------

function loadLegacyBeatGrid(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LEGACY_BEAT_GRID_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const legacyBeatGrid = loadLegacyBeatGrid();

function migratedBeatGridChoice(sceneId: string, spec: SceneSetting): DriveChoice | null {
  if (spec.drive?.default !== "feature.onset") return null;
  const raw = legacyBeatGrid[sceneId];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const grid = Math.min(BEAT_GRIDS.length - 1, Math.max(0, Math.round(raw)));
  if (grid === BEAT_GRID_DEFAULT) return null; // Hits — nothing to migrate, it's already the plain default
  return { source: "beat", grid };
}

// ---- Choice -----------------------------------------------------------------

function isValidGridIndex(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n < BEAT_GRIDS.length;
}

/** `raw` sanitized into a real DriveChoice, or null if it doesn't match any
 *  of the shapes a choice can take (a stale/foreign localStorage value, or —
 *  the other caller — an untrusted Look share code; sceneLooks.ts reuses
 *  this rather than re-validating the same shape a second way). */
export function sanitizeChoice(raw: unknown): DriveChoice | null {
  if (raw === "scene") return "scene";
  if (typeof raw === "string") return raw in SIGNALS ? (raw as DriveChoice) : null;
  if (raw && typeof raw === "object") {
    const source = (raw as { source?: unknown }).source;
    if (source === "line") return { source: "line" };
    if (source === "beat") {
      const grid = (raw as { grid?: unknown }).grid;
      return isValidGridIndex(grid) ? { source: "beat", grid } : null;
    }
  }
  return null;
}

/** This setting's stored source choice, or its `drive.default` — with the
 *  one-time legacy beat-grid migration above folded in — for a setting
 *  that's never been touched. `spec.drive` must be set; callers only reach
 *  this for a setting the panel has already shown a source picker on. */
export function getDriveChoice(sceneId: string, spec: SceneSetting): DriveChoice {
  const scope = settingScope(sceneId, spec.key);
  const stored = cache[scope]?.[spec.key]?.choice;
  const sanitized = stored === undefined ? undefined : sanitizeChoice(stored);
  if (sanitized !== undefined && sanitized !== null) return sanitized;

  const migrated = migratedBeatGridChoice(sceneId, spec);
  if (migrated) {
    setDriveChoice(sceneId, spec, migrated);
    return migrated;
  }
  return spec.drive?.default ?? "scene";
}

export function setDriveChoice(sceneId: string, spec: SceneSetting, choice: DriveChoice): void {
  entryFor(settingScope(sceneId, spec.key), spec.key).choice = choice;
  persist();
}

/** Back to `spec.drive.default` — a row's reset affordance. */
export function resetDriveChoice(sceneId: string, spec: SceneSetting): void {
  delete entryFor(settingScope(sceneId, spec.key), spec.key).choice;
  persist();
}

// ---- Line (this setting parked on Frequencies) -----------------------------

const scratchLine = new Float32Array(NUM_BANDS);

/** This setting's drawn line, written into `out` (default: a shared scratch
 *  — copy if you need to hold onto it). A setting that's never been drawn
 *  on, or whose stored entry didn't sanitize, reads as the undrawn default. */
export function getDriveLine(sceneId: string, spec: SceneSetting, out: Float32Array = scratchLine): Float32Array {
  const stored = cache[settingScope(sceneId, spec.key)]?.[spec.key]?.line;
  const sanitized = stored ? sanitizeLine(stored) : null;
  if (sanitized) out.set(sanitized);
  else out.fill(LINE_HEIGHT_DEFAULT);
  return out;
}

export function setDriveLineBand(sceneId: string, spec: SceneSetting, band: number, height: number): void {
  if (!Number.isInteger(band) || band < 0 || band >= NUM_BANDS) return;
  const entry = entryFor(settingScope(sceneId, spec.key), spec.key);
  const heights = entry.line ? Array.from(entry.line) : new Array(NUM_BANDS).fill(LINE_HEIGHT_DEFAULT);
  heights[band] = Number.isFinite(height) ? Math.min(1, Math.max(0, height)) : LINE_HEIGHT_DEFAULT;
  entry.line = heights;
  persist();
}

export function setDriveLine(sceneId: string, spec: SceneSetting, heights: ArrayLike<number>): void {
  const sanitized = sanitizeLine(Array.from(heights)) ?? new Float32Array(NUM_BANDS).fill(LINE_HEIGHT_DEFAULT);
  entryFor(settingScope(sceneId, spec.key), spec.key).line = Array.from(sanitized);
  persist();
}

/** Back to the undrawn default — the panel's Reset chip while drawing this
 *  setting's line (alongside resetDriveLineStrength below). */
export function resetDriveLine(sceneId: string, spec: SceneSetting): void {
  delete entryFor(settingScope(sceneId, spec.key), spec.key).line;
  persist();
}

// ---- Line strength ----------------------------------------------------------

function clampStrength(value: number): number {
  if (!Number.isFinite(value)) return LINE_STRENGTH_DEFAULT;
  return Math.min(LINE_STRENGTH_MAX, Math.max(LINE_STRENGTH_MIN, value));
}

export function getDriveLineStrength(sceneId: string, spec: SceneSetting): number {
  const stored = cache[settingScope(sceneId, spec.key)]?.[spec.key]?.lineStrength;
  return typeof stored === "number" ? clampStrength(stored) : LINE_STRENGTH_DEFAULT;
}

export function setDriveLineStrength(sceneId: string, spec: SceneSetting, value: number): void {
  entryFor(settingScope(sceneId, spec.key), spec.key).lineStrength = clampStrength(value);
  persist();
}

export function resetDriveLineStrength(sceneId: string, spec: SceneSetting): void {
  delete entryFor(settingScope(sceneId, spec.key), spec.key).lineStrength;
  persist();
}
