import { NUM_BANDS } from "../audio/types.ts";
import { LINE_HEIGHT_DEFAULT, LINE_STRENGTH_DEFAULT, LINE_STRENGTH_MAX, LINE_STRENGTH_MIN, sanitizeLine } from "../audio/bandLine.ts";
import { BEAT_GRIDS, BEAT_GRID_DEFAULT, LEGACY_BEAT_GRID_STORAGE_KEY, type BeatGridIndex } from "../audio/beatGrid.ts";
import { SIGNALS } from "./signals.ts";
import { settingScope, type SceneSetting } from "./sceneSettings.ts";
import {
  defaultDriveSetting,
  driveSettingFromChoice,
  normalizeDriveSetting,
  setPatchMix as pureSetPatchMix,
  setSourceGrid as pureSetSourceGrid,
  setSourceHeight as pureSetSourceHeight,
  setSourceMuted as pureSetSourceMuted,
  setSourceRole as pureSetSourceRole,
  setSourceWeight as pureSetSourceWeight,
  togglePatchSource as pureTogglePatchSource,
  type DriveChoice,
  type DriveMix,
  type DriveSetting,
  type DriveSource,
  type DriveSourceChoice,
  type HitHeight,
} from "./drives.ts";

/**
 * Storage for `SceneSetting.drive` — the patch (src/render/drives.ts's
 * `DriveSetting`: `"scene"` or a `DrivePatch`) a drive setting is currently
 * on, plus (for a setting with a source on Frequencies) the line it was
 * drawn with and its overall strength. One entry per (scene, setting),
 * scoped through sceneSettings.ts's settingScope() exactly like the plain
 * value store, so a scene's variant (Kaleidoscope's Style, …) keeps its own
 * profile of drive settings too. Same cache-over-localStorage pattern as
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
 * **Two storage shapes, one field each.** `DriveEntry.patch` is the current
 * shape — whatever `getDriveSetting`/`setDriveSetting` round-trip, sanitized
 * through `sanitizeDriveSetting` below on read so a stale/foreign value
 * falls back rather than throwing. `DriveEntry.choice` is what every entry
 * used to be before patches existed (a bare `DriveChoice`) — still read (and
 * upgraded to a one-source patch via `driveSettingFromChoice`) for a browser
 * that saved one before this file grew a `patch` field; every write goes
 * through `patch` only, so a choice-only entry never comes back once this
 * session has touched it.
 *
 * Migration: a scene that had a non-Hits grid stored under beatGrid.ts's
 * retired per-scene store (LEGACY_BEAT_GRID_STORAGE_KEY, `vibe.beatGrid`)
 * converts once, lazily, the first time getDriveSetting() is asked about a
 * setting whose own `drive.default` is the plain "feature.onset" (Beat)
 * catalogue choice: it resolves to (and persists) the one-source patch for
 * `{source:"beat", grid}` instead of the plain default, so a scene whose
 * beat reactions used to run on, say, "1 bar" doesn't suddenly snap back to
 * raw Hits the moment this system took over gridding beat edges (see
 * drives.ts's header for why that's now a per-setting concern instead of
 * animClock's own single global grid). A setting whose default is anything
 * other than plain Beat never had a global grid apply to it in the first
 * place, so it's left alone. Read once at module load — the legacy store is
 * retired, not kept live alongside this one.
 */

interface DriveEntry {
  /** Legacy — see this file's header. Never written by this module any
   *  more; only read as a fallback when `patch` is absent. */
  choice?: DriveChoice;
  /** `encodeDriveSetting`'s output — see that function's own doc for the
   *  two shapes this field can hold. */
  patch?: StoredDriveSetting;
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
    // Not fatal — drive settings/lines just won't persist across reloads.
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

// ---- Choice (single-source; legacy shape) -----------------------------------

function isValidGridIndex(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n < BEAT_GRIDS.length;
}

/** `raw` sanitized into a real DriveChoice, or null if it doesn't match any
 *  of the shapes a choice can take (a stale/foreign localStorage value, or —
 *  another caller — a `DriveSource.choice` inside a patch, or an untrusted
 *  Look share code; sanitizeDriveSetting/sceneLooks.ts reuse this rather
 *  than re-validating the same shape a second way). Accepts `"scene"` for
 *  the legacy top-level `choice` field/Look `d` entries; sanitizeSourceChoice
 *  below is the same check with `"scene"` rejected, for a patch source. */
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

/** `sanitizeChoice`, with `"scene"` rejected — what one `DriveSource.choice`
 *  inside a patch must sanitize to. */
export function sanitizeSourceChoice(raw: unknown): DriveSourceChoice | null {
  const choice = sanitizeChoice(raw);
  return choice === null || choice === "scene" ? null : choice;
}

const HIT_HEIGHTS: readonly HitHeight[] = ["graded", "fixed", "loud"];
const DRIVE_MIXES: readonly DriveMix[] = ["add", "max", "gate"];

/** `raw` sanitized into a real DriveSetting, or null if it doesn't match
 *  either shape a stored/shared entry can take: a plain `DriveChoice`
 *  (`"scene"`, or what `sanitizeChoice` accepts — a setting whose patch has
 *  never been edited past the identity one-source/weight-1/Graded shape
 *  round-trips through this form, both in localStorage and in a Look's `d`
 *  — see sceneLooks.ts's own header) or a compact patch
 *  `{m: DriveMix, s: [{c: DriveChoice, w?: number, h?: HitHeight, g?: 1,
 *  o?: 1}, …]}`. A source's own `g`/`o` (present only when `true`) are
 *  `DriveSource.when`/`.off` — drives.ts's header covers what each does; `g`
 *  for "gate condition", `o` for "off", one letter each to match `c`/`w`/`h`.
 *  A source's `w`/`h`, if present, must already be a well-shaped value —
 *  out-of-range weight is clamped (`normalizeDriveSetting`), but a wrong
 *  *type* anywhere fails the whole entry rather than silently dropping one
 *  source, so a garbage entry can't quietly resolve to a half-built patch.
 *
 *  **Legacy top-level `w`.** Before a source had its own role, `DrivePatch`
 *  carried one gate condition as a single index, encoded at this shape's own
 *  top level (a different field than a source's own `w`, its weight, one
 *  level down — just the same short key, mirroring drives.ts's naming).
 *  Never written any more (`encodeDriveSetting` below only ever emits a
 *  source's own `g`), but still read here: it migrates to that surviving
 *  source's own `when: true`, same convergence point as drives.ts's own
 *  `normalizeDriveSetting` migrating a runtime object that still carries the
 *  old `DrivePatch.when` field. A `gate` patch decoded with no role
 *  information at all — no source's own `g`, no legacy top-level `w` — is
 *  read as exactly that: no condition, so the gate acts as add (drives.ts's
 *  header). It must not invent one: "every condition switched back to
 *  plays" is a real state the panel writes, and guessing a condition here
 *  would change the setting's behaviour on the next reload. */
export function sanitizeDriveSetting(raw: unknown): DriveSetting | null {
  const asChoice = sanitizeChoice(raw);
  if (asChoice !== null) return driveSettingFromChoice(asChoice);
  if (!raw || typeof raw !== "object" || !("s" in raw)) return null;

  const mix = (raw as { m?: unknown }).m;
  if (typeof mix !== "string" || !(DRIVE_MIXES as readonly string[]).includes(mix)) return null;

  const rawSources = (raw as { s?: unknown }).s;
  if (!Array.isArray(rawSources)) return null;

  const sources: DriveSource[] = [];
  for (const item of rawSources) {
    if (!item || typeof item !== "object") return null;
    const choice = sanitizeSourceChoice((item as { c?: unknown }).c);
    if (choice === null) return null;

    const rawWeight = (item as { w?: unknown }).w;
    let weight = 1;
    if (rawWeight !== undefined) {
      if (typeof rawWeight !== "number" || !Number.isFinite(rawWeight)) return null;
      weight = rawWeight;
    }

    const rawHeight = (item as { h?: unknown }).h;
    let height: HitHeight | undefined;
    if (rawHeight !== undefined) {
      if (typeof rawHeight !== "string" || !(HIT_HEIGHTS as readonly string[]).includes(rawHeight)) return null;
      height = rawHeight as HitHeight;
    }

    const source: DriveSource = { choice, weight };
    if (height !== undefined) source.height = height;

    const rawGate = (item as { g?: unknown }).g;
    if (rawGate !== undefined) {
      if (rawGate !== 1) return null;
      source.when = true;
    }
    const rawOff = (item as { o?: unknown }).o;
    if (rawOff !== undefined) {
      if (rawOff !== 1) return null;
      source.off = true;
    }
    sources.push(source);
  }

  const rawLegacyWhen = (raw as { w?: unknown }).w;
  if (rawLegacyWhen !== undefined) {
    if (typeof rawLegacyWhen !== "number" || !Number.isFinite(rawLegacyWhen)) return null;
    if (!sources.some((s) => s.when)) {
      const idx = Math.min(sources.length - 1, Math.max(0, Math.round(rawLegacyWhen)));
      if (sources[idx]) sources[idx]!.when = true;
    }
  }

  return normalizeDriveSetting({ mix: mix as DriveMix, sources });
}

/** The wire/storage shape `encodeDriveSetting` below produces and
 *  `sanitizeDriveSetting` above accepts — either shape doc'd on that
 *  function. Both `DriveEntry.patch` (localStorage) and a Look's `d` entry
 *  (sceneLooks.ts) are one of these, never a bare `DriveSetting` — see this
 *  file's header for why one canonical shape serves both boundaries. */
export type StoredDriveSetting = DriveChoice | { m: DriveMix; s: { c: DriveChoice; w?: number; h?: HitHeight; g?: 1; o?: 1 }[] };

/** `setting` written the way `sanitizeDriveSetting` reads it back: a
 *  one-source, weight-1, Graded, unconditioned, unmuted `add` patch (and
 *  `"scene"`) as the bare `DriveChoice` it's identical to — the same shape
 *  this store/a Look used before patches existed, so an untouched setting
 *  keeps costing no more than it always did and an old app can still make
 *  sense of it — anything else as the compact `{m,s}` form, a source's own
 *  role/mute as its own `g`/`o` (never a top-level field any more — see
 *  sanitizeDriveSetting's own header for the legacy top-level `w` this still
 *  reads, just never writes). sceneLooks.ts reuses this directly rather than
 *  re-deriving the same compaction. */
export function encodeDriveSetting(setting: DriveSetting): StoredDriveSetting {
  if (setting === "scene") return "scene";
  if (setting.mix === "add" && setting.sources.length === 1) {
    const only = setting.sources[0]!;
    if (only.weight === 1 && (only.height === undefined || only.height === "graded") && !only.when && !only.off) {
      return only.choice;
    }
  }
  return {
    m: setting.mix,
    s: setting.sources.map((src) => {
      const entry: { c: DriveChoice; w?: number; h?: HitHeight; g?: 1; o?: 1 } = { c: src.choice };
      if (src.weight !== 1) entry.w = src.weight;
      if (src.height !== undefined && src.height !== "graded") entry.h = src.height;
      if (src.when) entry.g = 1;
      if (src.off) entry.o = 1;
      return entry;
    }),
  };
}

/** This setting's stored DriveSetting, or its `drive.default` — with the
 *  one-time legacy beat-grid migration above folded in — for a setting
 *  that's never been touched. `spec.drive` must be set; callers only reach
 *  this for a setting the panel has already shown a source picker on. */
export function getDriveSetting(sceneId: string, spec: SceneSetting): DriveSetting {
  const scope = settingScope(sceneId, spec.key);
  const entry = cache[scope]?.[spec.key];

  if (entry?.patch !== undefined) {
    const sanitized = sanitizeDriveSetting(entry.patch);
    if (sanitized !== null) return sanitized;
  } else if (entry?.choice !== undefined) {
    const sanitized = sanitizeChoice(entry.choice);
    if (sanitized !== null) return driveSettingFromChoice(sanitized);
  }

  const migrated = migratedBeatGridChoice(sceneId, spec);
  if (migrated) {
    const setting = driveSettingFromChoice(migrated);
    setDriveSetting(sceneId, spec, setting);
    return setting;
  }
  return defaultDriveSetting(spec);
}

export function setDriveSetting(sceneId: string, spec: SceneSetting, setting: DriveSetting): void {
  const entry = entryFor(settingScope(sceneId, spec.key), spec.key);
  entry.patch = encodeDriveSetting(normalizeDriveSetting(setting));
  delete entry.choice; // a fresh write always supersedes any legacy field
  persist();
}

/** Back to `spec.drive.default` — a row's reset affordance. */
export function resetDriveSetting(sceneId: string, spec: SceneSetting): void {
  const entry = entryFor(settingScope(sceneId, spec.key), spec.key);
  delete entry.patch;
  delete entry.choice;
  persist();
}

// ---- Patch-editing helpers (deviceMenu.ts) ---------------------------------
//
// Store-level counterparts of drives.ts's own pure, same-named helpers:
// read the current setting, run it through the pure function, persist. Kept
// here (not exported from drives.ts under these names) so a caller always
// reaches for the (sceneId, spec, …) form without having to
// getDriveSetting()/setDriveSetting() around a pure call by hand.

export function togglePatchSource(sceneId: string, spec: SceneSetting, choice: DriveSourceChoice): void {
  setDriveSetting(sceneId, spec, pureTogglePatchSource(getDriveSetting(sceneId, spec), choice));
}

export function setSourceWeight(sceneId: string, spec: SceneSetting, choice: DriveSourceChoice, weight: number): void {
  setDriveSetting(sceneId, spec, pureSetSourceWeight(getDriveSetting(sceneId, spec), choice, weight));
}

export function setSourceHeight(sceneId: string, spec: SceneSetting, choice: DriveSourceChoice, height: HitHeight): void {
  setDriveSetting(sceneId, spec, pureSetSourceHeight(getDriveSetting(sceneId, spec), choice, height));
}

export function setSourceGrid(sceneId: string, spec: SceneSetting, grid: BeatGridIndex): void {
  setDriveSetting(sceneId, spec, pureSetSourceGrid(getDriveSetting(sceneId, spec), grid));
}

export function setPatchMix(sceneId: string, spec: SceneSetting, mix: DriveMix): void {
  setDriveSetting(sceneId, spec, pureSetPatchMix(getDriveSetting(sceneId, spec), mix));
}

/** The source line's own role toggle (deviceMenu.ts's buildRoleToggle):
 *  marks `sources[index]` "plays" or "when" — drives.ts's setSourceRole. */
export function setSourceRole(sceneId: string, spec: SceneSetting, index: number, role: "plays" | "when"): void {
  setDriveSetting(sceneId, spec, pureSetSourceRole(getDriveSetting(sceneId, spec), index, role));
}

/** The source line's own mute switch (deviceMenu.ts's buildMuteSwitch):
 *  turns `sources[index]` off without unplugging it, or back on —
 *  drives.ts's setSourceMuted. */
export function setSourceMuted(sceneId: string, spec: SceneSetting, index: number, muted: boolean): void {
  setDriveSetting(sceneId, spec, pureSetSourceMuted(getDriveSetting(sceneId, spec), index, muted));
}

// ---- Line (a setting with a source on Frequencies) -------------------------

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
