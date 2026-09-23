import { NUM_BANDS, type FeatureFrame } from "../audio/types.ts";
import type { AnimFrame } from "./animClock.ts";
import type { SceneSetting } from "./sceneSettings.ts";
import { settingScope } from "./sceneSettings.ts";
import { SIGNALS, type SignalId } from "./signals.ts";
import { createGridPulse, type GridPulse } from "./gridPulse.ts";
import { BEAT_GRIDS, beatGridBeats, type BeatGridIndex } from "../audio/beatGrid.ts";
import { bandLineDrive } from "../audio/bandLine.ts";
import { getDriveChoice, getDriveLine, getDriveLineStrength } from "./driveStore.ts";

/**
 * The drive engine: one place that turns a `SceneSetting.drive` choice into
 * a number (or an edge) every tick, so a scene declares "this setting is
 * reactive" and reads one value instead of hard-coding its own audio
 * coupling. See sceneSettings.ts's `drive` doc comment for the choices a
 * setting can be on, and CLAUDE.md's "Why a setting resolves the way it
 * does under Auto" row for the sibling system (autoTune.ts) this doesn't
 * replace — auto/manual decides a setting's own *amount*; a drive decides
 * what event/level that amount responds to. The two compose freely: an auto
 * setting's resolved amount is what a coupling formula multiplies the drive
 * by.
 *
 * A `DriveChoice` that isn't `"scene"` is either a plain
 * src/render/signals.ts SignalId (reused as the drive catalogue rather than
 * a parallel list — see that file's header), or one of the two parametric,
 * stateful choices this engine owns:
 *
 *   - `{ source: "beat", grid }` — a beat-grid tick (src/audio/beatGrid.ts).
 *     One GridPulse per (scene, setting) that picks a grid, advanced every
 *     tick off AnimFrame.beats/tempoLock — see gridPulse.ts for the
 *     lock/fallback behavior. Its decaying pulse (jumps to 1 on a grid
 *     crossing, same BEAT_PULSE-style exponential release as
 *     animClock.ts's own beatPulse) is what a GLSL/`.value()` consumer
 *     reads; its one-shot edge is latched across skipped render ticks the
 *     same way renderLatch.ts latches AnimFrame's own onsets — see
 *     `.fired()` below for how that latch is kept and cleared.
 *   - `{ source: "line" }` — this setting's own drawn frequency line
 *     (src/audio/bandLine.ts's math, src/render/driveStore.ts's storage).
 *     Same peak-hold shape animClock.ts used to compute once, globally,
 *     for every scene reading the old `uLineDrive` — now one instance per
 *     (scene, setting) on this choice, off `gainedFrame.bands` (already
 *     post-band-gains, matching what the line used to react to).
 *
 * Every other plain-catalogue and grid/line choice is a *level* by nature —
 * even an onset-kind SIGNALS entry reads as its decaying pulse envelope,
 * never a bare boolean (see signals.ts's header) — so accumulate() never has
 * to distinguish "used as a value" from "used as a trigger" while advancing
 * state; only `.fired()` below draws that line, at read time.
 *
 * `"scene"` is the one choice with no engine state at all: `.value()` and
 * `.fired()` simply return whatever the caller's own `sceneDefault`/
 * `sceneDefaultFired` argument was, and `.uniformPair()` returns
 * `{ drive: 0, custom: 0 }` so the generated GLSL helper
 * (`mix(sceneDefault, u<Key>Drive, u<Key>Custom)`, sceneCommon.ts's
 * DRIVE_GLSL) reduces to exactly `sceneDefault` — bit-for-bit, since
 * `mix(x, y, 0) === x` for any `y`. That identity is also why every
 * catalogue/grid/line default reproduces today's coupling exactly: at a
 * setting's own `drive.default`, the engine's value is defined to equal the
 * signal/pulse the scene used to read directly (see tests/drives.test.ts's
 * identity check, which walks every registered scene's drive settings and
 * asserts exactly this).
 *
 * **Advancing.** Grid pulses and line peak-holds are per-tick state that has
 * to see every rAF tick, not just the ticks that end up rendering — a fast
 * grid stop (1/8 at a high tempo) can cross a boundary between two renders
 * under framePace.ts's render cap, and a peak-hold's release is wrong if it
 * only ever sees the longer render-to-render gap. `accumulate()` is that
 * per-tick advance, called from app.ts/tv.ts right after animClock.advance()
 * — same placement as renderLatch.ts's own accumulate(), and for the same
 * reason. It takes `gainedFrame` (band-gained, not sensitivity-applied —
 * what the line drive reacts to, matching what animClock.ts's own retired
 * `line` param used) and `driveEnergy` (the *sensitivity-applied* energy
 * scalar — matching what a scene's own `uEnergy` sees this tick; app.ts's
 * displayFrame is where that shaping happens, computed once per tick just
 * for this rather than only at render time, since accumulate() itself needs
 * it on every tick) separately, because they're deliberately different
 * frames — see sceneCommon.ts's `uploadCommonUniforms` and app.ts's `loop()`
 * for the exact pipeline each one matches.
 *
 * **Reading.** `forScene(sceneId, settings, anim)` returns a `SceneDrives`
 * view — cheap to build (closes over three references, no new state) — for
 * whichever AnimFrame the caller has in hand. A scene's own render() gets
 * one built from the render-latched AnimFrame (renderLatch.ts's consume()
 * result, the same object passed to render() itself), so a plain-catalogue
 * edge choice (Beat, Bass hit, …) reads `.fired()` straight off that
 * already-latched boolean — no separate latch needed for those. Only a grid
 * choice keeps its own pending-edge flag (set in accumulate(), since a grid
 * tick isn't an AnimFrame field at all), and only `.fired()` clears it, as a
 * read-time side effect — so calling `.fired()` for a grid setting is what
 * "consumes" its edge, exactly once per actual render, without a separate
 * consume() step every caller has to remember to call. deviceMenu.ts builds
 * its own `forScene()` off the tick's raw (unlatched) AnimFrame purely to
 * show a live reading beside a row — it only ever reads `.uniformPair()`/
 * `.excess()`, never `.fired()`, so it can't accidentally steal a grid edge
 * a scene hasn't rendered yet.
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

export type DriveChoice =
  | SignalId
  | "scene"
  | { source: "beat"; grid: BeatGridIndex }
  | { source: "line" };

export interface SceneDrives {
  /** The resolved value for a value-style (GLSL/JS-continuous) consumer:
   *  `sceneDefault` passed straight through for `"scene"`, else the
   *  engine's own reading for the chosen source (its decaying envelope for
   *  an edge-kind catalogue entry, the grid pulse, or the line's peak-hold). */
  value(key: string, sceneDefault: number): number;
  /** The resolved one-shot trigger for a JS-side spawn/impulse: `sceneDefaultFired`
   *  passed straight through for `"scene"` and for a level-kind catalogue
   *  choice (no natural edge — see this file's header); the render-latched
   *  AnimFrame's own boolean for an edge-kind catalogue choice; this
   *  setting's own pending grid edge (cleared by this call) for a grid
   *  choice; `sceneDefaultFired` again for a line choice (no natural edge
   *  either). */
  fired(key: string, sceneDefaultFired: boolean): boolean;
  /** Per-band excess behind this setting's line drive (bandLine.ts's
   *  BandLineDrive.excess), for the panel's overlay — null unless this
   *  setting is currently on Frequencies. */
  excess(key: string): Float32Array | null;
  /** Framework-internal: what sceneCommon.ts's uploadCommonUniforms writes
   *  into u<Key>Drive/u<Key>Custom, and what the panel's live pill reads —
   *  scene authors use value()/fired() instead. `custom` is 0 for `"scene"`
   *  (mix() then reduces to sceneDefault exactly) and 1 otherwise; `drive`
   *  is 0 when `custom` is 0 (unused by the shader's mix() either way). */
  uniformPair(key: string): { drive: number; custom: number };
}

export interface DriveEngine {
  /** Call once per rAF tick, right after animClock.advance() — see this
   *  file's header for why grid/line state can't wait for a render tick. */
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
};

const GRID_PULSE_DECAY_PER_SEC = 6; // matches animClock.ts's own BEAT_PULSE_DECAY_PER_SEC (kept in step by hand, same convention as beatListener.ts's PULSE_DECAY_DEFAULT)
const LINE_DRIVE_RELEASE_PER_SEC = 6; // matches the release this setting's line drive had while it lived in animClock.ts

interface KeyState {
  grid: GridPulse | null;
  gridPulse: number;
  gridFiredPending: boolean;
  linePulse: number;
  lineExcess: Float32Array;
}

function createKeyState(): KeyState {
  return {
    grid: null,
    gridPulse: 0,
    gridFiredPending: false,
    linePulse: 0,
    lineExcess: new Float32Array(NUM_BANDS),
  };
}

function isGridChoice(choice: DriveChoice): choice is { source: "beat"; grid: BeatGridIndex } {
  return typeof choice === "object" && choice.source === "beat";
}

function isLineChoice(choice: DriveChoice): choice is { source: "line" } {
  return typeof choice === "object" && choice.source === "line";
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

export function createDriveEngine(): DriveEngine {
  const states = new Map<string, KeyState>();

  function stateKey(sceneId: string, key: string): string {
    return `${settingScope(sceneId, key)}:${key}`;
  }

  function stateFor(sceneId: string, key: string): KeyState {
    const k = stateKey(sceneId, key);
    let st = states.get(k);
    if (!st) {
      st = createKeyState();
      states.set(k, st);
    }
    return st;
  }

  return {
    accumulate(dtSec, gainedFrame, driveEnergy, anim, sceneId, settings) {
      driveFrameScratch.energy = driveEnergy;
      for (const spec of settings) {
        if (!spec.drive) continue;
        const choice = getDriveChoice(sceneId, spec);

        if (isGridChoice(choice)) {
          const st = stateFor(sceneId, spec.key);
          if (!st.grid) st.grid = createGridPulse();
          const gridBeats = beatGridBeats(choice.grid);
          const fired = st.grid.advance(anim.beats, anim.tempoLock, gridBeats, anim.onset);
          st.gridPulse *= Math.exp(-dtSec * GRID_PULSE_DECAY_PER_SEC);
          if (fired) st.gridPulse = 1;
          st.gridFiredPending ||= fired;
        } else if (isLineChoice(choice)) {
          const st = stateFor(sceneId, spec.key);
          const heights = getDriveLine(sceneId, spec);
          const strength = getDriveLineStrength(sceneId, spec);
          const result = bandLineDrive(gainedFrame.bands, heights, strength, lineDriveScratch);
          st.linePulse *= Math.exp(-dtSec * LINE_DRIVE_RELEASE_PER_SEC);
          if (result.drive > st.linePulse) st.linePulse = result.drive;
          st.lineExcess.set(result.excess);
        }
        // Plain catalogue and "scene" choices have no per-tick state to
        // advance — they're read straight off `anim`/`driveFrame` at
        // forScene() time below.
      }
    },

    forScene(sceneId, settings, anim) {
      const specByKey = new Map(settings.map((s) => [s.key, s]));

      function resolve(key: string): { choice: DriveChoice; gain: number } {
        const spec = specByKey.get(key);
        const drive = spec?.drive;
        if (!spec || !drive) return { choice: "scene", gain: 1 };
        return { choice: getDriveChoice(sceneId, spec), gain: drive.gain ?? 1 };
      }

      // Raw reading for a non-"scene" choice — needs `key` too (not just the
      // choice) to look up this setting's own grid/line state.
      function rawValue(key: string, choice: Exclude<DriveChoice, "scene">, gain: number): number {
        if (isGridChoice(choice)) return stateFor(sceneId, key).gridPulse * gain;
        if (isLineChoice(choice)) return stateFor(sceneId, key).linePulse * gain;
        return SIGNALS[choice].read(driveFrameScratch, anim) * gain;
      }

      return {
        value(key, sceneDefault) {
          const { choice, gain } = resolve(key);
          return choice === "scene" ? sceneDefault : rawValue(key, choice, gain);
        },

        fired(key, sceneDefaultFired) {
          const { choice } = resolve(key);
          if (choice === "scene") return sceneDefaultFired;
          if (isGridChoice(choice)) {
            const st = stateFor(sceneId, key);
            const fired = st.gridFiredPending;
            st.gridFiredPending = false;
            return fired;
          }
          if (isLineChoice(choice)) return sceneDefaultFired; // no natural edge — see this file's header
          const edge = SIGNALS[choice].edge;
          return edge ? edge(anim) : sceneDefaultFired; // level-kind catalogue choice — same fallback
        },

        excess(key) {
          const { choice } = resolve(key);
          if (!isLineChoice(choice)) return null;
          return stateFor(sceneId, key).lineExcess;
        },

        uniformPair(key) {
          const { choice, gain } = resolve(key);
          return choice === "scene" ? { drive: 0, custom: 0 } : { drive: rawValue(key, choice, gain), custom: 1 };
        },
      };
    },
  };
}

/** Structural equality for two DriveChoice values — plain values compare by
 *  `===`, the two object shapes compare by their one field. Used to find a
 *  stored choice's current position in driveModes() below, and by
 *  sceneLooks.ts to tell a setting's stored choice apart from its default. */
export function sameDriveChoice(a: DriveChoice, b: DriveChoice): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a.source !== b.source) return false;
  return a.source === "beat" && b.source === "beat" ? a.grid === b.grid : true;
}

// ---- The panel's source picker -------------------------------------------
//
// Two questions, not one catalogue dump (see this section's own header
// note below driveModes()'s doc comment for the full rationale): *when*
// does a setting react (row 1 — driveModes()'s own DriveModeRow.mode), and
// *to which frequencies* (row 2 — DriveModeRow.options). modeOf() is the
// inverse: given any stored DriveChoice, which row 1 mode it belongs to,
// plus a DriveRange bucket used only to carry a choice's frequency range
// across a row-1 switch (deviceMenu.ts) — Hits·Bass to Loudness·Bass, say.

/** Row 1 of the panel's picker (deviceMenu.ts): *when* a setting reacts.
 *  "scene" is offered only for a setting whose own `drive.default` is
 *  `"scene"` — see driveModes()'s own doc comment. */
export type DriveMode = "hits" | "loudness" | "beatGrid" | "scene";

/** A DriveChoice's frequency-range bucket, for "switching row 1 keeps the
 *  range" (deviceMenu.ts): "bass"/"mid"/"treble" carry across Hits and
 *  Loudness directly (Hits·Bass -> Loudness·Bass); "broadband" is Any/All,
 *  the shared "no particular band" bucket both rows offer; "other" is
 *  everything with no natural range at all (Drop, the default-only
 *  Brightness/Song extras, Draw, every Beat-grid stop, and Scene) — landing
 *  on a target row's own "broadband" option is `modeOf`'s answer for those,
 *  same as the plan's "Drop/Brightness/Song/Draw map to All/Any" rule. */
export type DriveRange = "broadband" | "bass" | "mid" | "treble" | "other";

const MODE_LABEL: Record<DriveMode, string> = {
  hits: "Hits",
  loudness: "Loudness",
  beatGrid: "Beat grid",
  scene: "Scene mix",
};

interface CatalogueRowOption {
  choice: SignalId;
  range: DriveRange;
  label: string;
}

// Row 2 under Hits — deliberately its own small vocabulary ("Any", not
// SIGNALS["feature.onset"].label's "Beat"; "Bass"/"Mid"/"Treble", not "Bass
// hit") rather than reusing signals.ts's own labels: those are written for
// the meters and a setting's `reads` pill, where the signal's *identity*
// needs spelling out ("Bass hit" beside a "Bass level" meter row); here row
// 1 already says "Hits", so row 2 only needs to say which band.
const HITS_OPTIONS: CatalogueRowOption[] = [
  { choice: "feature.onset", range: "broadband", label: "Any" },
  { choice: "anim.lowOnset", range: "bass", label: "Bass" },
  { choice: "anim.midOnset", range: "mid", label: "Mid" },
  { choice: "anim.highOnset", range: "treble", label: "Treble" },
  { choice: "anim.dropOnset", range: "other", label: "Drop" },
];

// Row 2 under Loudness. "✎ Draw" ({source:"line"}) and the two default-only
// extras (Brightness/Song, appended by driveModes() below, only for the one
// setting whose own default is that id) aren't SignalId catalogue entries,
// so they're added on top of this list rather than living in it.
const LOUDNESS_OPTIONS: CatalogueRowOption[] = [
  { choice: "anim.energy", range: "broadband", label: "All" },
  { choice: "anim.low", range: "bass", label: "Bass" },
  { choice: "anim.mid", range: "mid", label: "Mid" },
  { choice: "anim.high", range: "treble", label: "Treble" },
];

const DRAW_LABEL = "✎ Draw";
const DRAW_CHOICE: DriveChoice = { source: "line" };

// Row 2 under Beat grid — plain-language note-value names distinct from
// beatGrid.ts's own DAW-quantise-menu labels ("1/8", "1 bar", …), which the
// picker's earlier revision showed verbatim and the user called cryptic.
// Index 0 ("Hits") is never offered here — it's the plain Beat catalogue
// choice already in the Hits row, under a different name.
const BEAT_GRID_ROW_LABEL: Record<number, string> = {
  1: "½ beat",
  2: "Beat",
  3: "2 beats",
  4: "Bar",
  5: "2 bars",
};

/** Which row-1 mode a stored DriveChoice belongs to, plus its DriveRange —
 *  the inverse of driveModes() below, and the one place that mapping is
 *  written down, so the two can't drift. Exhaustive over every SignalId
 *  (tests/drives.test.ts's round-trip check): the four Hits ids and the
 *  broadband/bass/mid/treble four of Loudness resolve by table lookup; a
 *  grid or line choice resolves by shape; anim.centroid/anim.sectionIntensity
 *  — the two default-only extras, never in either table since they only
 *  ever appear on the one setting they default for — fall to the same
 *  Loudness/"other" answer driveModes() itself gives them. */
export function modeOf(choice: DriveChoice): { mode: DriveMode; range: DriveRange } {
  if (choice === "scene") return { mode: "scene", range: "other" };
  if (typeof choice === "object") {
    return choice.source === "beat" ? { mode: "beatGrid", range: "other" } : { mode: "loudness", range: "other" };
  }
  const hit = HITS_OPTIONS.find((o) => o.choice === choice);
  if (hit) return { mode: "hits", range: hit.range };
  const level = LOUDNESS_OPTIONS.find((o) => o.choice === choice);
  if (level) return { mode: "loudness", range: level.range };
  return { mode: "loudness", range: "other" }; // anim.centroid / anim.sectionIntensity
}

/** One row-2 chip: its label, the DriveChoice it sets, and whether it's
 *  this setting's own `drive.default` — driveModes() below marks exactly
 *  one option (or, for a Scene-default setting, the "Scene mix" row itself)
 *  this way per setting, so the panel can dot it and skip a separate reset
 *  (deviceMenu.ts). */
export interface DriveModeOption {
  label: string;
  choice: DriveChoice;
  isDefault: boolean;
}

/** One row-1 mode plus its row-2 chips. `options` is empty for `"scene"` —
 *  its row 2 is one line of text (this setting's own `drive.sceneLabel` +
 *  "— the scene's own mix", deviceMenu.ts), not a chip strip, since a
 *  composite has nothing to pick from. */
export interface DriveModeRow {
  mode: DriveMode;
  label: string;
  options: DriveModeOption[];
}

/** The panel's whole picker for one drive setting (deviceMenu.ts): always
 *  Hits, Loudness and Beat grid, in that order, plus a trailing Scene mix
 *  row *only* when `setting.drive.default` is `"scene"` — every other
 *  setting's Scene passthrough exists at the engine level (drives.ts's own
 *  header) but has no picker row, since there's nothing to say about it
 *  beyond "back to how it was" and every other row already offers that via
 *  its own dot. That dot — DriveModeOption.isDefault / the presence of the
 *  Scene mix row itself — is the only "reset": returning to a setting's own
 *  default is one tap on whichever chip already shows it, not a separate
 *  control (see the plan's Revision 3 section for why a Reset chip was cut).
 *
 *  This replaces `driveOptionGroups()`'s flat five-group catalogue dump
 *  (Hits/Grid/Levels/Frequencies/Scene, printed straight from SIGNALS) with
 *  a picker shaped around the two questions a user actually asks — *when*
 *  (row 1) and *which frequencies* (row 2) — per the user's own "super
 *  crappy… not thought through" verdict on that flat version. Grouping
 *  lives here, not deviceMenu.ts, so it's unit-testable
 *  (tests/drives.test.ts) independent of the DOM it's rendered into. */
export function driveModes(setting: SceneSetting): DriveModeRow[] {
  const def = setting.drive?.default;
  const isDefault = (choice: DriveChoice): boolean => def !== undefined && sameDriveChoice(choice, def);

  const hits: DriveModeRow = {
    mode: "hits",
    label: MODE_LABEL.hits,
    options: HITS_OPTIONS.map((o) => ({ label: o.label, choice: o.choice, isDefault: isDefault(o.choice) })),
  };

  const loudnessOptions: DriveModeOption[] = LOUDNESS_OPTIONS.map((o) => ({
    label: o.label,
    choice: o.choice,
    isDefault: isDefault(o.choice),
  }));
  loudnessOptions.push({ label: DRAW_LABEL, choice: DRAW_CHOICE, isDefault: isDefault(DRAW_CHOICE) });
  // Default-only extras — see this function's own header paragraph above.
  if (def === "anim.centroid") loudnessOptions.push({ label: "Brightness", choice: "anim.centroid", isDefault: true });
  if (def === "anim.sectionIntensity") loudnessOptions.push({ label: "Song", choice: "anim.sectionIntensity", isDefault: true });
  const loudness: DriveModeRow = { mode: "loudness", label: MODE_LABEL.loudness, options: loudnessOptions };

  const gridOptions: DriveModeOption[] = [];
  for (let i = 1; i < BEAT_GRIDS.length; i++) {
    const choice: DriveChoice = { source: "beat", grid: i };
    gridOptions.push({ label: BEAT_GRID_ROW_LABEL[i], choice, isDefault: isDefault(choice) });
  }
  const beatGrid: DriveModeRow = { mode: "beatGrid", label: MODE_LABEL.beatGrid, options: gridOptions };

  const rows: DriveModeRow[] = [hits, loudness, beatGrid];
  if (def === "scene") rows.push({ mode: "scene", label: MODE_LABEL.scene, options: [] });
  return rows;
}
