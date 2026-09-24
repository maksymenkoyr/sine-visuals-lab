import { NUM_BANDS, type FeatureFrame } from "../audio/types.ts";
import { type AnimFrame, BEAT_PULSE_DECAY_PER_SEC } from "./animClock.ts";
import type { SceneSetting } from "./sceneSettings.ts";
import { settingScope } from "./sceneSettings.ts";
import { SIGNALS, type SignalId } from "./signals.ts";
import { createGridPulse, type GridPulse } from "./gridPulse.ts";
import { beatGridBeats, type BeatGridIndex } from "../audio/beatGrid.ts";
import { bandLineDrive } from "../audio/bandLine.ts";
import { GROUP_TUNING } from "./bandEnergy.ts";
import { getDriveLine, getDriveLineStrength, getDriveSetting } from "./driveStore.ts";

/**
 * The drive engine: one place that turns a `SceneSetting.drive` setting into
 * a number (or an edge) every tick, so a scene declares "this setting is
 * reactive" and reads one value instead of hard-coding its own audio
 * coupling. See sceneSettings.ts's `drive` doc comment for the shape a
 * setting can be on, and CLAUDE.md's "Why a setting resolves the way it
 * does under Auto" row for the sibling system (autoTune.ts) this doesn't
 * replace — auto/manual decides a setting's own *amount*; a drive decides
 * what event/level that amount responds to. The two compose freely: an auto
 * setting's resolved amount is what a coupling formula multiplies the drive
 * by.
 *
 * **The patch model.** A setting not on `"scene"` is a `DrivePatch`: one or
 * more `DriveSource`s (each a plain `DriveChoice` — a src/render/signals.ts
 * `SignalId`, `{source:"beat", grid}`, or `{source:"line"}` — never
 * `"scene"`, plus a `weight` and, for a hit-kind source, a `height`)
 * combined by the patch's own `mix`:
 *
 *   - **add** — Σ weight·value. The everyday case: two hits reinforcing
 *     each other, or a hit layered under a sustained level.
 *   - **max** — the single largest weight·value. "Whichever is louder right
 *     now", for two sources that should never simply stack (Bass hit *or*
 *     Any hit, say, rather than a double-height pulse when both land).
 *   - **gate** — `weight0·value0 · smoothstep(0.35, 0.55, weight1·value1)`.
 *     Only sources 0 and 1 count; a third source is stored but ignored by
 *     every read below (the panel disables adding one). "Plays" (source 0)
 *     only *while* "only when" (source 1) is past its own midpoint — a
 *     level gating a hit, or one hit gating another.
 *
 *   The combined value is finally scaled by the setting's own `drive.gain`
 *   (unchanged from before patches existed — see the uniformPair doc below).
 *   A one-source `add` patch with weight 1 and Graded height is defined to
 *   equal exactly what a plain single `DriveChoice` gave before this system
 *   had patches — see the identity note further down, and
 *   tests/drives.test.ts's own identity walk.
 *
 * **Heights.** A hit-kind source (an edge-kind catalogue entry, or a beat
 * grid — never a level-kind entry or the drawn line, which ignore `height`
 * entirely) can read three ways:
 *
 *   - **Graded** (the default, and the only height that existed before
 *     patches) — exactly today's reading: the catalogue's own decaying
 *     pulse (already shaped by src/audio/hitStrength.ts when a device has
 *     Dimension raised — see that module's header), or the grid's own pulse.
 *   - **Fixed** — a flat 1 on the source's own edge, decaying at that same
 *     source's own rate. "This hit is binary: it either lands or it
 *     doesn't", independent of how hard it hit or how loud the room is.
 *   - **Loud** — the source's own *band group's level* on its edge (bass/
 *     mid/high's slewed level for a band onset, the sensitivity-applied
 *     broadband level for Any hit/beat-grid, src/render/sectionIntensity.ts's
 *     own trend for Drop), decaying the same way. "This hit is exactly as
 *     tall as the room was loud when it landed" — a hit gate on a sustained
 *     reading, useful under `max`/`gate` against a Loudness source.
 *
 *   Fixed/Loud decay at *that source's own* existing pulse-decay rate —
 *   src/render/animClock.ts's BEAT_PULSE_DECAY_PER_SEC for Any hit/beat-grid,
 *   src/render/bandEnergy.ts's own GROUP_TUNING for a band onset — reused
 *   directly (never re-typed by hand) so a Fixed pulse decays exactly as
 *   fast as the Graded pulse it replaces, just with a different height.
 *
 * **Inspection, for the panel.** `sourceValues(key)` returns each source's
 * own `weight·value` this tick, in patch order — un-gained, so the panel can
 * draw each source's thin trace independent of the setting's own `gain`.
 * `valueOf(key)` returns the same reading `value()`/`uniformPair()` give a
 * scene (mix-combined, then × `gain`) — the row's own sparkline. Both are
 * pure reads of state `accumulate()` already advanced; neither consumes a
 * grid edge the way `fired()` does.
 *
 * `"scene"` is still the one setting with no engine state at all: `.value()`
 * and `.fired()` simply return whatever the caller's own `sceneDefault`/
 * `sceneDefaultFired` argument was, and `.uniformPair()` returns
 * `{ drive: 0, custom: 0 }` so the generated GLSL helper
 * (`mix(sceneDefault, u<Key>Drive, u<Key>Custom)`, sceneCommon.ts's
 * DRIVE_GLSL) reduces to exactly `sceneDefault` — bit-for-bit, since
 * `mix(x, y, 0) === x` for any `y`. A `drive.sceneSources` list
 * (sceneSettings.ts) names, for the panel only, which catalogue signals a
 * Scene composite honestly reads — it's display metadata for a dimmed
 * "scene mix" cable, never read by this engine or by the scene itself.
 *
 * **Identity.** At a setting's own `drive.default`, the engine's value is
 * defined to equal the signal/pulse the scene used to read directly before
 * this system had multiple sources: `defaultDriveSetting()` below turns a
 * plain catalogue/grid/line default into exactly the one-source, weight-1,
 * Graded `add` patch that reproduces it, and every combine/height rule
 * collapses to a no-op at that shape (Σ of one weight-1 term is that term;
 * Graded is the untouched catalogue/grid/line reading). See
 * tests/drives.test.ts's identity check, which walks every registered
 * scene's drive settings and asserts exactly this.
 *
 * **Advancing.** Grid pulses, line peak-holds and Fixed/Loud height
 * envelopes are per-tick state that has to see every rAF tick, not just the
 * ticks that end up rendering — a fast grid stop (1/8 at a high tempo) can
 * cross a boundary between two renders under framePace.ts's render cap, and
 * a peak-hold's release is wrong if it only ever sees the longer
 * render-to-render gap. `accumulate()` is that per-tick advance, called from
 * app.ts/tv.ts right after animClock.advance() — same placement as
 * renderLatch.ts's own accumulate(), and for the same reason. It takes
 * `gainedFrame` (band-gained, not sensitivity-applied — what the line drive
 * reacts to, matching what animClock.ts's own retired `line` param used) and
 * `driveEnergy` (the *sensitivity-applied* energy scalar — matching what a
 * scene's own `uEnergy` sees this tick; app.ts's displayFrame is where that
 * shaping happens, computed once per tick just for this rather than only at
 * render time, since accumulate() itself needs it on every tick, both for
 * the "All level" catalogue source and as Loud height's own level for Any
 * hit/beat-grid) separately, because they're deliberately different frames —
 * see sceneCommon.ts's `uploadCommonUniforms` and app.ts's `loop()` for the
 * exact pipeline each one matches.
 *
 * **Reading.** `forScene(sceneId, settings, anim)` returns a `SceneDrives`
 * view — cheap to build (closes over three references, no new state) — for
 * whichever AnimFrame the caller has in hand. A scene's own render() gets
 * one built from the render-latched AnimFrame (renderLatch.ts's consume()
 * result, the same object passed to render() itself), so a plain-catalogue
 * edge choice (Beat, Bass hit, …) reads its per-source edge straight off
 * that already-latched boolean — no separate latch needed for those. Only a
 * grid source keeps its own pending-edge flag (set in accumulate(), since a
 * grid tick isn't an AnimFrame field at all), and only `.fired()` clears it,
 * as a read-time side effect — so calling `.fired()` for a setting with a
 * grid source is what "consumes" that source's edge, exactly once per
 * actual render, without a separate consume() step every caller has to
 * remember to call. deviceMenu.ts builds its own `forScene()` off the tick's
 * raw (unlatched) AnimFrame purely to show a live reading beside a row — it
 * only ever reads `.uniformPair()`/`.excess()`/`.sourceValues()`/`.valueOf()`,
 * never `.fired()`, so it can't accidentally steal a grid edge a scene
 * hasn't rendered yet.
 *
 * **What's deliberately not a drive** (so the boundary is written down, not
 * just implied by what SETTINGS arrays happen to declare): response-shape
 * params (time constants, hold, curve shapes — they're not amounts);
 * spatial spectrum mappings (a scene's own per-vertex/per-cell band
 * lookup — one scalar can't replace *which band is where on screen*);
 * bar-wrap choreography and flowPhase rates (timelines, not amounts — a
 * future "Beat · 1 bar" source on one of these is plausible, just not this
 * system); scenes with no settings at all. A setting in one of these
 * buckets simply declares no `drive` — the scene keeps reading its signal
 * directly, exactly as before this file existed.
 */

/** One source inside a patch — never `"scene"` (that's the whole setting's
 *  own escape hatch, not a thing you'd mix alongside real sources). */
export type DriveSourceChoice = SignalId | { source: "beat"; grid: BeatGridIndex } | { source: "line" };

/** What a drive setting can be on. `"scene"` keeps its old meaning exactly
 *  (see this file's header); anything else is now a full patch rather than
 *  a single choice — a bare `DriveChoice` from before patches existed is
 *  just the one-source, weight-1, Graded case of `DrivePatch`, which
 *  `defaultDriveSetting()`/`driveSettingFromChoice()` below build directly. */
export type DriveChoice = DriveSourceChoice | "scene";

/** Graded = today's behavior (whatever src/audio/hitStrength.ts's Dimension
 *  shaping already gives a catalogue/grid pulse). Fixed/Loud only mean
 *  anything for a hit-kind source (an edge-kind catalogue entry or a beat
 *  grid) — a level-kind entry or the drawn line ignores `height` outright
 *  (see this file's header). Absent on a `DriveSource` means Graded. */
export type HitHeight = "graded" | "fixed" | "loud";

/** One tap into a patch: `choice` never `"scene"`, `weight` clamped to
 *  0..2 (see `clampWeight` below) wherever a patch is normalized. */
export interface DriveSource {
  choice: DriveSourceChoice;
  weight: number;
  height?: HitHeight;
}

/** How a patch's sources combine into one number — see this file's header
 *  for each rule's exact formula. */
export type DriveMix = "add" | "max" | "gate";

export interface DrivePatch {
  mix: DriveMix;
  sources: DriveSource[];
}

/** What a `SceneSetting.drive` setting is currently on: the scene's own
 *  composite, or a patch. Storage (driveStore.ts) and Looks
 *  (sceneLooks.ts) both persist this shape. */
export type DriveSetting = "scene" | DrivePatch;

export interface SceneDrives {
  /** The resolved value for a value-style (GLSL/JS-continuous) consumer:
   *  `sceneDefault` passed straight through for `"scene"`, else the patch's
   *  mix-combined reading (each source's own weighted value — its decaying
   *  envelope for a hit-kind source, its level for a level-kind one) times
   *  `drive.gain`. */
  value(key: string, sceneDefault: number): number;
  /** The resolved one-shot trigger for a JS-side spawn/impulse:
   *  `sceneDefaultFired` passed straight through for `"scene"`; for `add`/
   *  `max`, the OR of every source's own edge (a grid source's pending tick,
   *  cleared by this call; an edge-kind catalogue source's render-latched
   *  boolean off `anim`; any other source falls back to `sceneDefaultFired`,
   *  same as `"scene"` — see this file's header); for `gate`, source 0's own
   *  edge AND the gate being open (source 1's weighted value past the same
   *  smoothstep midpoint `value()`'s gate combine uses). */
  fired(key: string, sceneDefaultFired: boolean): boolean;
  /** Per-band excess behind this setting's line source (bandLine.ts's
   *  BandLineDrive.excess), for the panel's overlay — null unless the
   *  current patch has a source on Frequencies. */
  excess(key: string): Float32Array | null;
  /** Framework-internal: what sceneCommon.ts's uploadCommonUniforms writes
   *  into u<Key>Drive/u<Key>Custom, and what the panel's live pill reads —
   *  scene authors use value()/fired() instead. `custom` is 0 for `"scene"`
   *  (mix() then reduces to sceneDefault exactly) and 1 otherwise; `drive`
   *  is the same combined-then-gained reading value() gives (0 when
   *  `custom` is 0 — unused by the shader's mix() either way). */
  uniformPair(key: string): { drive: number; custom: number };
  /** Each source's own `weight·value` this tick, in patch order, un-gained —
   *  the panel's per-source trace and its ghost lines in the output graph.
   *  Null for `"scene"` (nothing to enumerate) or an unknown key. Only reads
   *  state accumulate() already computed — never consumes a grid edge. */
  sourceValues(key: string): Float32Array | null;
  /** The same mix-combined, gained reading `value()`/`uniformPair().drive`
   *  give — for a row's own live sparkline, without a caller having to know
   *  a scene's own `sceneDefault` for a "scene" setting (which returns 0
   *  here, since there is no patch to sum — the panel draws that setting's
   *  cables instead of a sparkline). */
  valueOf(key: string): number;
}

/** Always "scene" — the identity fallback every caller not wired to a real
 *  DriveEngine gets (gallery previews, tests, any Scene.render() call with
 *  no `drives` argument). Every value/fired call is a bare passthrough and
 *  uniformPair is always {0,0}, so a scene renders exactly as if it had no
 *  drive system at all — the same invariant a catalogue default's identity
 *  gives at the engine level (see this file's header). */
export const PASSTHROUGH_DRIVES: SceneDrives = {
  value: (_key, sceneDefault) => sceneDefault,
  fired: (_key, sceneDefaultFired) => sceneDefaultFired,
  excess: () => null,
  uniformPair: () => ({ drive: 0, custom: 0 }),
  sourceValues: () => null,
  valueOf: () => 0,
};

// matches animClock.ts's own BEAT_PULSE_DECAY_PER_SEC exactly (imported, not
// hand-duplicated) — grid pulses and Any-hit/beat-grid Fixed/Loud heights
// release at the same rate the broadband beat pulse they stand in for does.
const GRID_PULSE_DECAY_PER_SEC = BEAT_PULSE_DECAY_PER_SEC;
const LINE_DRIVE_RELEASE_PER_SEC = 6; // matches the release this setting's line drive had while it lived in animClock.ts
// matches src/render/sectionIntensity.ts's own DROP_PULSE_DECAY (kept in
// step by hand — that module doesn't export it, same convention as
// LINE_DRIVE_RELEASE_PER_SEC above until animClock's own constant was
// exported for GRID_PULSE_DECAY_PER_SEC).
const DROP_PULSE_DECAY_PER_SEC = 2.5;

export const DRIVE_WEIGHT_MIN = 0;
export const DRIVE_WEIGHT_MAX = 2;
export const DRIVE_WEIGHT_DEFAULT = 1;

function clampWeight(w: number): number {
  return Number.isFinite(w) ? Math.min(DRIVE_WEIGHT_MAX, Math.max(DRIVE_WEIGHT_MIN, w)) : DRIVE_WEIGHT_DEFAULT;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function isGridChoice(choice: DriveSourceChoice): choice is { source: "beat"; grid: BeatGridIndex } {
  return typeof choice === "object" && choice.source === "beat";
}

function isLineChoice(choice: DriveSourceChoice): choice is { source: "line" } {
  return typeof choice === "object" && choice.source === "line";
}

/** Plain id, `grid:<i>`, or `line` — what makes a source unique within one
 *  patch (see `normalizeDriveSetting`'s dedupe below) and what keys its own
 *  per-tick engine state alongside the setting's own key. */
export function sourceKey(choice: DriveSourceChoice): string {
  if (typeof choice === "string") return choice;
  return choice.source === "beat" ? `grid:${choice.grid}` : "line";
}

/** Structural equality for two DriveChoice values — plain values compare by
 *  `===`, the two object shapes compare by their one field. Used by the
 *  panel to compare a source against a patch's existing sources, and by
 *  sceneLooks.ts to tell a setting's stored choice apart from its default. */
export function sameDriveChoice(a: DriveChoice, b: DriveChoice): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a.source !== b.source) return false;
  return a.source === "beat" && b.source === "beat" ? a.grid === b.grid : true;
}

/** Structural equality for two DriveSetting values, sources compared in
 *  order (a patch built the same way keeps the same order — see
 *  `normalizeDriveSetting`) — captureLook's/the panel's "does this differ
 *  from the setting's own default" check. */
export function sameDriveSetting(a: DriveSetting, b: DriveSetting): boolean {
  if (a === "scene" || b === "scene") return a === b;
  if (a.mix !== b.mix || a.sources.length !== b.sources.length) return false;
  for (let i = 0; i < a.sources.length; i++) {
    const sa = a.sources[i]!;
    const sb = b.sources[i]!;
    if (!sameDriveChoice(sa.choice, sb.choice)) return false;
    if (sa.weight !== sb.weight) return false;
    if ((sa.height ?? "graded") !== (sb.height ?? "graded")) return false;
  }
  return true;
}

/** `choice` turned into the one-source, weight-1, Graded `add` patch that
 *  reproduces it exactly (or `"scene"` unchanged) — the shared "a plain
 *  choice is just this one shape of patch" conversion `defaultDriveSetting`
 *  below and driveStore.ts's own sanitizeDriveSetting/legacy migration
 *  both build through. */
export function driveSettingFromChoice(choice: DriveChoice): DriveSetting {
  if (choice === "scene") return "scene";
  return { mix: "add", sources: [{ choice, weight: DRIVE_WEIGHT_DEFAULT }] };
}

/** A default of `"scene"` stays `"scene"`; any other default becomes the
 *  one-source patch `driveSettingFromChoice` builds for it — see this
 *  file's header's Identity paragraph for why that reproduces today's
 *  coupling bit-for-bit. */
export function defaultDriveSetting(spec: SceneSetting): DriveSetting {
  const def = spec.drive?.default;
  return def === undefined ? "scene" : driveSettingFromChoice(def);
}

/** Clamps every source's weight, drops a source whose key collides with an
 *  earlier one in the same patch (first occurrence wins) or a second line
 *  source, and collapses an empty result to `"scene"` — the one place a
 *  patch's own invariants (this file's header: unique source keys, at most
 *  one line source, weight in 0..2) are enforced, so driveStore.ts's
 *  sanitizer and every patch-editing helper below can build through this
 *  rather than re-checking the rules themselves. */
export function normalizeDriveSetting(setting: DriveSetting): DriveSetting {
  if (setting === "scene") return "scene";
  const seen = new Set<string>();
  const sources: DriveSource[] = [];
  for (const src of setting.sources) {
    const key = sourceKey(src.choice);
    if (seen.has(key)) continue;
    seen.add(key);
    const source: DriveSource = { choice: src.choice, weight: clampWeight(src.weight) };
    if (src.height !== undefined && src.height !== "graded") source.height = src.height;
    sources.push(source);
  }
  if (sources.length === 0) return "scene";
  return { mix: setting.mix, sources };
}

// ---- Pure patch-editing helpers (deviceMenu.ts, Phase 2) -------------------
//
// Each takes and returns a DriveSetting — driveStore.ts's own same-named
// helpers wrap these around (sceneId, spec): read the current setting,
// call through here, persist the result. Kept pure/store-free so they're
// testable without a localStorage stub and so the store stays the only
// place that decides *when* to persist.

/** Adds `choice` to the patch (weight 1, Graded) if it isn't already a
 *  source, removes it if it is. `"scene"` becomes a fresh one-source `add`
 *  patch on the first add. An empty result normalizes to `"scene"`. */
export function togglePatchSource(setting: DriveSetting, choice: DriveSourceChoice): DriveSetting {
  if (setting === "scene") return { mix: "add", sources: [{ choice, weight: DRIVE_WEIGHT_DEFAULT }] };
  const key = sourceKey(choice);
  const exists = setting.sources.some((s) => sourceKey(s.choice) === key);
  const sources = exists
    ? setting.sources.filter((s) => sourceKey(s.choice) !== key)
    : [...setting.sources, { choice, weight: DRIVE_WEIGHT_DEFAULT }];
  return normalizeDriveSetting({ mix: setting.mix, sources });
}

/** No-op on `"scene"` or a patch with no source matching `choice`. */
export function setSourceWeight(setting: DriveSetting, choice: DriveSourceChoice, weight: number): DriveSetting {
  if (setting === "scene") return setting;
  const key = sourceKey(choice);
  const sources = setting.sources.map((s) => (sourceKey(s.choice) === key ? { ...s, weight: clampWeight(weight) } : s));
  return normalizeDriveSetting({ mix: setting.mix, sources });
}

/** No-op on `"scene"` or a patch with no source matching `choice`. */
export function setSourceHeight(setting: DriveSetting, choice: DriveSourceChoice, height: HitHeight): DriveSetting {
  if (setting === "scene") return setting;
  const key = sourceKey(choice);
  const sources = setting.sources.map((s) => (sourceKey(s.choice) === key ? { ...s, height } : s));
  return normalizeDriveSetting({ mix: setting.mix, sources });
}

/** Re-grids the patch's own grid source (there's at most one — this file's
 *  header) to `grid`. No-op on `"scene"` or a patch with no grid source. */
export function setSourceGrid(setting: DriveSetting, grid: BeatGridIndex): DriveSetting {
  if (setting === "scene") return setting;
  const sources = setting.sources.map((s) => (isGridChoice(s.choice) ? { ...s, choice: { source: "beat" as const, grid } } : s));
  return normalizeDriveSetting({ mix: setting.mix, sources });
}

/** No-op on `"scene"`. */
export function setPatchMix(setting: DriveSetting, mix: DriveMix): DriveSetting {
  if (setting === "scene") return setting;
  return normalizeDriveSetting({ mix, sources: setting.sources });
}

// ---- Engine ------------------------------------------------------------

interface SourceState {
  grid: GridPulse | null;
  gridPulse: number;
  gridFiredPending: boolean;
  linePulse: number;
  lineExcess: Float32Array;
  /** Fixed/Loud's own decaying envelope — see this file's header. Unused
   *  (stays 0) for a Graded source or a level-kind/line source, which never
   *  advance it. */
  heightEnv: number;
}

function createSourceState(): SourceState {
  return {
    grid: null,
    gridPulse: 0,
    gridFiredPending: false,
    linePulse: 0,
    lineExcess: new Float32Array(NUM_BANDS),
    heightEnv: 0,
  };
}

/** Fixed/Loud's own release rate for a hit-kind source — reused directly
 *  from the module that owns the Graded pulse it stands in for (see this
 *  file's header). Only ever called for an edge-kind catalogue entry or a
 *  grid source (accumulate()/sourceRaw below both gate on that). */
function heightDecayPerSec(choice: DriveSourceChoice): number {
  if (isGridChoice(choice)) return GRID_PULSE_DECAY_PER_SEC;
  switch (choice) {
    case "feature.onset":
      return BEAT_PULSE_DECAY_PER_SEC;
    case "anim.lowOnset":
      return GROUP_TUNING.low.pulseDecayRate;
    case "anim.midOnset":
      return GROUP_TUNING.mid.pulseDecayRate;
    case "anim.highOnset":
      return GROUP_TUNING.high.pulseDecayRate;
    case "anim.dropOnset":
      return DROP_PULSE_DECAY_PER_SEC;
    default:
      return BEAT_PULSE_DECAY_PER_SEC; // unreached — every edge-kind SignalId is listed above
  }
}

/** Loud height's own target on a hit-kind source's edge — "that band
 *  group's level" (this file's header): the group's own slewed level for a
 *  band onset, sectionIntensity's trend for Drop (its own composite
 *  "loudness" — Drop has no group level of its own to read), and the
 *  sensitivity-applied broadband level (matching Loudness · All exactly)
 *  for Any hit and every beat-grid stop, since neither is band-specific. */
function loudLevel(choice: DriveSourceChoice, anim: AnimFrame, driveEnergy: number): number {
  if (isGridChoice(choice)) return driveEnergy;
  switch (choice) {
    case "anim.lowOnset":
      return anim.low;
    case "anim.midOnset":
      return anim.mid;
    case "anim.highOnset":
      return anim.high;
    case "anim.dropOnset":
      return anim.sectionIntensity;
    default:
      return driveEnergy; // "feature.onset" (Any hit) and unreached edge cases
  }
}

const lineDriveScratch = { drive: 0, excess: new Float32Array(NUM_BANDS) };
const driveFrameScratch: FeatureFrame = {
  time: 0,
  bands: new Float32Array(NUM_BANDS),
  energy: 0,
  onset: false,
  bpm: 0,
  onsetPhase: 0,
  level: 0,
};

export interface DriveEngine {
  /** Call once per rAF tick, right after animClock.advance() — see this
   *  file's header for why grid/line/height state can't wait for a render
   *  tick. */
  accumulate(
    dtSec: number,
    gainedFrame: FeatureFrame,
    driveEnergy: number,
    anim: AnimFrame,
    sceneId: string,
    settings: readonly SceneSetting[],
  ): void;
  /** A read-only view for `anim` — see this file's header for the render
   *  vs. panel distinction in which AnimFrame each caller hands in. */
  forScene(sceneId: string, settings: readonly SceneSetting[], anim: AnimFrame): SceneDrives;
}

export function createDriveEngine(): DriveEngine {
  const states = new Map<string, SourceState>();

  function stateFor(sceneId: string, key: string, srcKey: string): SourceState {
    const k = `${settingScope(sceneId, key)}:${key}:${srcKey}`;
    let st = states.get(k);
    if (!st) {
      st = createSourceState();
      states.set(k, st);
    }
    return st;
  }

  return {
    accumulate(dtSec, gainedFrame, driveEnergy, anim, sceneId, settings) {
      driveFrameScratch.energy = driveEnergy;
      for (const spec of settings) {
        if (!spec.drive) continue;
        const setting = getDriveSetting(sceneId, spec);
        if (setting === "scene") continue;

        for (const src of setting.sources) {
          const choice = src.choice;
          const st = stateFor(sceneId, spec.key, sourceKey(choice));
          const wantsHeight = src.height === "fixed" || src.height === "loud";

          if (isGridChoice(choice)) {
            if (!st.grid) st.grid = createGridPulse();
            const gridBeats = beatGridBeats(choice.grid);
            const fired = st.grid.advance(anim.beats, anim.tempoLock, gridBeats, anim.onset);
            st.gridPulse *= Math.exp(-dtSec * GRID_PULSE_DECAY_PER_SEC);
            if (fired) st.gridPulse = 1;
            st.gridFiredPending ||= fired;
            if (wantsHeight) {
              st.heightEnv *= Math.exp(-dtSec * GRID_PULSE_DECAY_PER_SEC);
              if (fired) st.heightEnv = Math.max(st.heightEnv, src.height === "fixed" ? 1 : driveEnergy);
            }
          } else if (isLineChoice(choice)) {
            const heights = getDriveLine(sceneId, spec);
            const strength = getDriveLineStrength(sceneId, spec);
            const result = bandLineDrive(gainedFrame.bands, heights, strength, lineDriveScratch);
            st.linePulse *= Math.exp(-dtSec * LINE_DRIVE_RELEASE_PER_SEC);
            if (result.drive > st.linePulse) st.linePulse = result.drive;
            st.lineExcess.set(result.excess);
            // Height ignored — see this file's header.
          } else if (SIGNALS[choice].kind === "edge" && wantsHeight) {
            const rate = heightDecayPerSec(choice);
            st.heightEnv *= Math.exp(-dtSec * rate);
            const edge = SIGNALS[choice].edge!(anim);
            if (edge) st.heightEnv = Math.max(st.heightEnv, src.height === "fixed" ? 1 : loudLevel(choice, anim, driveEnergy));
          }
          // Graded catalogue sources (edge- or level-kind) have no per-tick
          // state to advance — read straight off `anim`/driveFrameScratch at
          // forScene() time below.
        }
      }
    },

    forScene(sceneId, settings, anim) {
      const specByKey = new Map(settings.map((s) => [s.key, s]));

      function resolve(key: string): { setting: DriveSetting; gain: number } {
        const spec = specByKey.get(key);
        const drive = spec?.drive;
        if (!spec || !drive) return { setting: "scene", gain: 1 };
        return { setting: getDriveSetting(sceneId, spec), gain: drive.gain ?? 1 };
      }

      // Raw (un-weighted, un-gained) reading for one source — needs `key`
      // too (not just the choice) to look up this setting's own per-source
      // state.
      function sourceRaw(key: string, src: DriveSource): number {
        const choice = src.choice;
        const wantsHeight = src.height === "fixed" || src.height === "loud";
        if (isGridChoice(choice)) {
          const st = stateFor(sceneId, key, sourceKey(choice));
          return wantsHeight ? st.heightEnv : st.gridPulse;
        }
        if (isLineChoice(choice)) return stateFor(sceneId, key, sourceKey(choice)).linePulse;
        const catalogue = SIGNALS[choice];
        if (catalogue.kind === "edge" && wantsHeight) return stateFor(sceneId, key, sourceKey(choice)).heightEnv;
        return catalogue.read(driveFrameScratch, anim);
      }

      // Plain float64 array, deliberately not a Float32Array — combine()'s
      // sum/max has to match today's bit-for-bit reading exactly (this
      // file's header's Identity paragraph), and rounding every weighted
      // term through float32 on the way in would quietly break that at the
      // last few bits. sourceValues() below, the panel's own inspection
      // API, is the one place that precision loss is fine (and its own
      // return type, Float32Array, says so).
      function weightedValues(key: string, patch: DrivePatch): number[] {
        return patch.sources.map((src) => clampWeight(src.weight) * sourceRaw(key, src));
      }

      function combine(patch: DrivePatch, weighted: number[]): number {
        if (patch.mix === "max") {
          let m = 0;
          for (const v of weighted) if (v > m) m = v;
          return m;
        }
        if (patch.mix === "gate") {
          const v0 = weighted[0] ?? 0;
          if (weighted.length < 2) return v0;
          return v0 * smoothstep(0.35, 0.55, weighted[1]!);
        }
        let sum = 0;
        for (const v of weighted) sum += v;
        return sum;
      }

      function sourceEdge(key: string, choice: DriveSourceChoice, sceneDefaultFired: boolean): boolean {
        if (isGridChoice(choice)) {
          const st = stateFor(sceneId, key, sourceKey(choice));
          const fired = st.gridFiredPending;
          st.gridFiredPending = false;
          return fired;
        }
        if (isLineChoice(choice)) return sceneDefaultFired;
        const edge = SIGNALS[choice].edge;
        return edge ? edge(anim) : sceneDefaultFired;
      }

      return {
        value(key, sceneDefault) {
          const { setting, gain } = resolve(key);
          if (setting === "scene") return sceneDefault;
          return combine(setting, weightedValues(key, setting)) * gain;
        },

        fired(key, sceneDefaultFired) {
          const { setting } = resolve(key);
          if (setting === "scene") return sceneDefaultFired;
          if (setting.mix === "gate") {
            const src0 = setting.sources[0];
            if (!src0) return sceneDefaultFired;
            const edge0 = sourceEdge(key, src0.choice, sceneDefaultFired);
            if (setting.sources.length < 2) return edge0;
            const v1 = clampWeight(setting.sources[1]!.weight) * sourceRaw(key, setting.sources[1]!);
            return edge0 && smoothstep(0.35, 0.55, v1) > 0.5;
          }
          let any = false;
          for (const src of setting.sources) if (sourceEdge(key, src.choice, sceneDefaultFired)) any = true;
          return any;
        },

        excess(key) {
          const { setting } = resolve(key);
          if (setting === "scene") return null;
          const lineSrc = setting.sources.find((s) => isLineChoice(s.choice));
          if (!lineSrc) return null;
          return stateFor(sceneId, key, "line").lineExcess;
        },

        uniformPair(key) {
          const { setting, gain } = resolve(key);
          if (setting === "scene") return { drive: 0, custom: 0 };
          return { drive: combine(setting, weightedValues(key, setting)) * gain, custom: 1 };
        },

        sourceValues(key) {
          const { setting } = resolve(key);
          return setting === "scene" ? null : Float32Array.from(weightedValues(key, setting));
        },

        valueOf(key) {
          const { setting, gain } = resolve(key);
          return setting === "scene" ? 0 : combine(setting, weightedValues(key, setting)) * gain;
        },
      };
    },
  };
}

