import { NUM_BANDS, type FeatureFrame } from "../audio/types.ts";
import { type AnimFrame, BEAT_PULSE_DECAY_PER_SEC } from "./animClock.ts";
import type { SceneSetting } from "./sceneSettings.ts";
import { getSceneExpansion, getSceneExpansionShape, SCENE_EXPANSION_DEFAULT, settingScope, type ExpansionShape } from "./sceneSettings.ts";
import { SIGNALS, type SignalId } from "./signals.ts";
import { createGridPulse, type GridPulse } from "./gridPulse.ts";
import { beatGridBeats, type BeatGridIndex } from "../audio/beatGrid.ts";
import { bandLineDrive } from "../audio/bandLine.ts";
import { GROUP_TUNING } from "./bandEnergy.ts";
import type { HitLane } from "../audio/hitStrength.ts";
import { getDriveLine, getDriveLineStrength, getDriveSetting, getDriveThresholdState } from "./driveStore.ts";
import { createValueTrigger, stepValueTrigger, VALUE_TRIGGER_UPPER_DEFAULT, type ValueTrigger } from "./valueTrigger.ts";

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
 * `"scene"`, plus a `weight`, for a hit-kind source a `height`, and for a
 * plain `"anim.beatWave"` source an `every` — see DriveSource.every's own
 * doc) combined by the patch's own `mix`:
 *
 *   - **add** — Σ weight·value. The everyday case: two hits reinforcing
 *     each other, or a hit layered under a sustained level.
 *   - **max** — the single largest weight·value. "Whichever is louder right
 *     now", for two sources that should never simply stack (Bass hit *or*
 *     Any hit, say, rather than a double-height pulse when both land).
 *   - **gate** — each source has a *role*, `DriveSource.when` (absent means
 *     "plays"; `true` marks it a *condition*). `plays = Σ over non-condition,
 *     non-muted sources of weightᵢ·valueᵢ`; `open = Π over condition,
 *     non-muted sources of smoothstep(GATE_OPEN_LOW, GATE_OPEN_HIGH,
 *     weightⱼ·valueⱼ)` — every condition's own smoothstep multiplied
 *     together, so *all* of them have to be reading high at once (an AND,
 *     not an OR) for the product to stay near 1; the combined value is
 *     `plays · open`. A muted source (`DriveSource.off`) never enters either
 *     side, as if it weren't in the patch at all — see the header's own
 *     Muting paragraph below. If no source is currently an *active*
 *     condition — none is marked `when` at all, or every marked one is
 *     muted — `open` is the empty product (1) and the gate simply reads as
 *     `add` over whatever plays: this is the one, deliberate way to gate on
 *     nothing (a user muting a patch's only condition to "listen past" it
 *     for a moment) rather than a special case `combine()`/`fired()` have to
 *     branch on. With exactly one source marked "plays" and one marked
 *     `when` and neither muted, this is `weight0·value0 ·
 *     smoothstep(GATE_OPEN_LOW, GATE_OPEN_HIGH, weight1·value1)` — today's
 *     (single-condition) gate, bit-for-bit (tests/drives.test.ts's own
 *     identity check).
 *
 *     **Invariant: at least one source plays.** A patch where every source
 *     is marked `when` can never produce a value. `setSourceRole(setting,
 *     index, "when")` — the pure edit a source line's own role toggle
 *     (deviceMenu.ts) calls through, driveStore.ts's same-named wrapper
 *     persisting it — refuses (returns `setting` unchanged) a request that
 *     would leave zero "plays" sources; `normalizeDriveSetting` carries the
 *     same check as a backstop for a patch built some other way (decoded
 *     data, a structural edit that removes the last "plays" source), simply
 *     clearing every `when` rather than guessing which one should stay a
 *     condition. In every mix *other* than `gate`, a source's `when` flag is
 *     kept (so switching the mix back to "Only when" restores exactly the
 *     roles it had) but plays no part in `add`'s sum or `max`'s pick.
 *
 *     **Muting.** `DriveSource.off` turns a source off without unplugging
 *     it: `combine()`/`fired()` treat it as absent (contributes nothing,
 *     either as a "plays" term or a condition), but it keeps its own
 *     position, weight, height, role and (on a Beat wave source) its every-N-
 *     beats divider, so switching it back on restores exactly what it was
 *     doing. `sourceValues()` below reports a muted
 *     source's own slot as 0 (still in patch order — the panel's per-source
 *     trace just goes flat rather than disappearing and shifting every
 *     later trace over). If *every* source in a patch is muted,
 *     `hasLiveSource` (below) reads false and `value()`/`valueOf()` return
 *     the caller's own `rest` regardless of mix — not an honest 0 read off
 *     `combine()` — see this header's own "Nothing plugged in" paragraph.
 *
 *   The combined value is finally scaled by the setting's own `drive.gain`
 *   (unchanged from before patches existed — see the uniformPair doc below).
 *   A one-source `add` patch with weight 1 and Graded height is defined to
 *   equal exactly what a plain single `DriveChoice` gave before this system
 *   had patches — see the identity note further down, and
 *   tests/drives.test.ts's own identity walk.
 *
 * **Master Expansion.** The Master card's Expansion dial
 * (sceneSettings.ts's getSceneExpansion) acts here, on the gained reading,
 * not on any setting's value: Scale (autoTune.ts's resolveSceneSetting)
 * sets where the picture normally sits, and Expansion says how far the
 * music may pull it away from there and how long it stays away. Each
 * patched setting keeps an ExpansionTracker over its own gained reading:
 * `normal`, an average over EXPANSION_NORMAL_TAU_SEC, and `usual`, one whose
 * catch-up time (expansionUsualTauSec) grows with the dial. A scene reads
 * `max(0, normal + expansionReach(E)·(reading − usual))`. Below 1, `usual`
 * catches up fast and the reach shrinks, so a dip or a peak is pulled back
 * to `normal` within a second or two even while the music stays there.
 * Above 1, `usual` lags and the reach grows, so a drop throws the picture
 * far and a long breakdown holds it down. The Master card's shape chips
 * (sceneSettings.ts's getSceneExpansionShape) bend that straight line —
 * see shapeExcursion: "even" keeps it, "softTop" rounds big upward jumps
 * off below the reading's nominal top of 1, and "bigMoves" ignores beat-to-
 * beat swings by comparing `recent` (a short average) with `usual`, so the
 * picture only moves when a section changes. "upOnly" keeps only the rises
 * (a breakdown leaves the picture at `normal`) and "downOnly" only the
 * dips (a drop never throws it above `normal`). At 1 with "even" the reading
 * passes through untouched (bit-for-bit, so every identity rule in this
 * header holds); any other shape applies at 1 too.
 * Applied before the generic gate — its tracker sees the expanded reading,
 * so the line it draws is on the same scale the scene gets — and to
 * `fired()`'s gate check, but never to an edge itself or to
 * `sourceValues()`'s per-source traces.
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
 * scene (mix-combined, then × `gain`) — the row's own sparkline.
 * `expansionPair(key)` returns that reading just before and just after the
 * Master Expansion (both ahead of the generic gate), so the output graph
 * can shade what Expansion moved; null whenever Expansion passes the
 * reading through untouched. All three are pure reads of state
 * `accumulate()` already advanced; none consumes a grid edge the way
 * `fired()` does. The panel's jacks and cables
 * (src/ui/jack.ts, src/ui/cableLayer.ts, wired from src/ui/deviceMenu.ts)
 * read only these two plus a patch's own `sources`/`mix` — nothing here
 * exists for them alone.
 *
 * `"scene"` is still the one setting with no engine state at all: `.value()`
 * and `.fired()` simply return whatever the caller's own `sceneDefault`/
 * `sceneDefaultFired` argument was (`.value()` through the generic gate
 * once its threshold is switched on — the threshold paragraph below), and `.uniformPair()` returns
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
 * **Nothing plugged in.** Two rules a jack's `drive.default` and a scene's
 * own coupling formula both have to hold for (2026-09-28): (1) a jack's
 * default always reacts to the music — never a constant, and never a Scene
 * composite that turns out to be one in disguise; a setting nothing in the
 * catalogue genuinely fits simply declares no `drive` at all. (2) with
 * nothing plugged in — every source unplugged (an empty patch), muted, or
 * (in a `gate` mix) only a `when` condition left with no source actually
 * "playing", see `hasLiveSource` below — the music stops moving the
 * setting and nothing else changes: `value()`/`valueOf()` return the
 * caller's own `rest` argument (default 0) in that case, skipping `gain`
 * and the generic gate entirely, rather than reading `combine()`'s honest 0
 * for an empty sum. A caller whose neutral silence isn't 0 (physarum2's
 * `nutrient`) passes its own `rest`; every
 * other caller's implicit 0 is exactly right for a hit-only setting (Beat
 * flash, Beat ripple) that simply has nothing to react to. `uniformPair()`
 * has no `rest` of its own — an unplugged patch still uploads `{drive: 0,
 * custom: 1}` — so this is also why every GLSL coupling built on that pair
 * has to be identity at drive 0 in its own right: a lift on top of the
 * slider (`v + (1 - v) * k * d`, a factor `1 + k*d`/`1 - k*d`), never
 * `slider * drive` for an amount that exists without music, which would
 * zero it (or run it backwards) the instant a jack sits empty.
 *
 * **The threshold: scene-handled vs. engine-gated.** `SceneSetting.drive.
 * threshold` marks a setting scene-handled: the scene owns the whole idea of
 * "how far does this have to stand out before it counts" and reads the
 * user's own slider back with `drives.threshold(key)`, applying whatever
 * gate shape actually fits its signal — Physarum 2's Dose reads
 * rippleEmitter.ts's salience floor/peak trackers, not the generic one
 * below. (Caustics' Beat ripple takes both instead: the generic gate on its
 * drive, then its own Ring threshold as a plain setting.) Declaring
 * `drive.threshold` is what opts a setting *out* of the engine's own gate;
 * every other patched setting (no `drive.threshold` on its spec) gets a
 * generic version of the same idea for free, off by default so nothing
 * changes until it's switched on. `accumulate()` tracks it per setting: a
 * floor that follows the signal's resting level (down fast, up slowly — a
 * brief loud passage shouldn't instantly convince it the room got louder)
 * and a peak that jumps straight to a new high and eases back toward the
 * floor, with the threshold slider (0..1) picking a line between the two —
 * 0 at the floor (everything through), 1 at the peak (only the standouts).
 * `value()`/`uniformPair()`/`valueOf()` fade a reading out smoothly below
 * that line (a soft knee, not a hard cut, so a hit riding right on the edge
 * doesn't flicker) and `fired()` blocks an edge whose own combined value
 * falls under it, on top of whatever that mix already required. A setting
 * still on its built-in reaction (`"scene"`) gets the same gate through
 * `value()` only — forScene()'s gateBuiltIn advances its tracker there, on
 * the scene's own value, since accumulate() never sees it. The panel's
 * own graph draws the line with `SceneDrives.gateLine(key)` — `undefined`
 * whenever there's nothing to draw: no `drive` at all, a scene-handled
 * threshold (the scene draws its own line through settingMarks.ts instead),
 * or the generic gate simply off. Because a scene-handled setting is
 * skipped by the generic gate outright, and a generic setting has no scene
 * of its own reading `drives.threshold`, a setting is never gated twice.
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
 * remember to call. A level-kind catalogue source or the drawn line has no
 * edge at all to latch or consume — `.fired()` instead runs that source's
 * own weighted reading through a per-source Schmitt trigger (valueTrigger.ts)
 * every time it's asked, and that trigger's own hysteresis state (armed,
 * last beat, last fire time) simply persists across a render the scene
 * skips, the same way the grid's pending flag survives one. deviceMenu.ts
 * builds its own `forScene()` off the tick's raw (unlatched) AnimFrame
 * purely to show a live reading beside a row — it
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

/** Beat wave's own divider (DriveSource.every): how many beats one swing of
 *  its cosine takes, instead of always one. 1 (or absent) is today's plain
 *  reading — every value here is one this system already has a name for
 *  (a beat grid division's own multiples), so a picker offering these five
 *  reads as "the same kind of choice as a beat grid", not an arbitrary
 *  slider. */
export const DRIVE_EVERY_VALUES = [1, 2, 4, 8, 16] as const;
export type DriveEvery = (typeof DRIVE_EVERY_VALUES)[number];

/** One tap into a patch: `choice` never `"scene"`, `weight` clamped to
 *  0..2 (see `clampWeight` below) wherever a patch is normalized. */
export interface DriveSource {
  choice: DriveSourceChoice;
  weight: number;
  height?: HitHeight;
  /** This source's role in a `gate` mix: absent means "plays", `true` marks
   *  it a condition — see this file's header's gate paragraph for how
   *  several conditions combine (every one ANDed together) and the
   *  at-least-one-plays invariant `setSourceRole`/`normalizeDriveSetting`
   *  enforce. Kept (not stripped) in every other mix, so switching back to
   *  `gate` restores exactly the roles a patch had before — just ignored by
   *  `add`/`max`'s own combine. */
  when?: true;
  /** Muted: contributes nothing to `combine()`/`fired()` (as if this source
   *  weren't in the patch at all) but keeps its own weight/height/role —
   *  see this file's header's Muting paragraph. `sourceValues()` still
   *  reports this slot, as 0. */
  off?: true;
  /** Only meaningful on a plain `"anim.beatWave"` choice (see DRIVE_EVERY_VALUES'
   *  own doc): swings once every this-many beats instead of once every beat.
   *  `normalizeDriveSetting` strips this on any other choice, or an
   *  out-of-list value, rather than carrying a number nothing will ever
   *  read. Absent (or 1) is today's plain Beat wave reading, bit-identical —
   *  `sourceRawImpl` (this file's engine) only takes the divider's own
   *  branch once it's greater than 1. */
  every?: DriveEvery;
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
   *  `sceneDefault` passed straight through for `"scene"`; for a patch with
   *  no live source (`hasLiveSource` below is false — this file's header's
   *  "Nothing plugged in" paragraph), `rest` (default 0) unchanged, with no
   *  `gain` or generic gate applied; otherwise the patch's mix-combined
   *  reading (each source's own weighted value — its decaying envelope for
   *  a hit-kind source, its level for a level-kind one) times `drive.gain`. */
  value(key: string, sceneDefault: number, rest?: number): number;
  /** The resolved one-shot trigger for a JS-side spawn/impulse:
   *  `sceneDefaultFired` passed straight through for `"scene"`; for `add`/
   *  `max`, the OR of every non-muted source's own edge — a grid source's
   *  pending tick (cleared by this call), an edge-kind catalogue source's
   *  render-latched boolean off `anim`, or, for a level-kind catalogue
   *  source or the drawn line (neither has a natural edge of its own —
   *  signals.ts's header), that source's own weighted reading run through a
   *  per-source Schmitt trigger (valueTrigger.ts) instead of falling back to
   *  `sceneDefaultFired`; for `gate`, the OR of every non-muted *plays*
   *  source's own edge (by that same rule) AND `open` (every non-muted
   *  condition's own weighted value past the same smoothstep midpoint
   *  `value()`'s gate combine multiplies together) being past 0.5 — a
   *  condition source's own edge, if it has one, is never consumed. A gate
   *  with no active condition (this file's header) is always open, so this
   *  reduces to the add/max OR-of-edges rule above. `upper` is the
   *  Schmitt trigger's own fire mark for a level/line source only (ignored
   *  by a hit-kind source's real edge) — defaults to
   *  `VALUE_TRIGGER_UPPER_DEFAULT` (valueTrigger.ts) when omitted, or a
   *  scene can pass its own user-facing threshold setting through here. */
  fired(key: string, sceneDefaultFired: boolean, upper?: number): boolean;
  /** Per-band excess behind this setting's line source (bandLine.ts's
   *  BandLineDrive.excess), for the panel's overlay — null unless the
   *  current patch has a source on Frequencies. */
  excess(key: string): Float32Array | null;
  /** Framework-internal: what sceneCommon.ts's uploadCommonUniforms writes
   *  into u<Key>Drive/u<Key>Custom, and what the panel's live pill reads —
   *  scene authors use value()/fired() instead. `custom` is 0 for `"scene"`
   *  (mix() then reduces to sceneDefault exactly) and 1 otherwise; `drive`
   *  is the same combined-then-gained reading value() gives (0 when
   *  `custom` is 0 — unused by the shader's mix() either way). Unlike
   *  value(), this has no `rest` of its own: a patch with no live source
   *  still uploads `{drive: 0, custom: 1}` (`combine()`'s honest empty sum),
   *  which is exactly why a GLSL `<key>Drive(sceneDefault)` coupling has to
   *  be identity at drive 0 on its own terms — see this file's header's
   *  "Nothing plugged in" paragraph. */
  uniformPair(key: string): { drive: number; custom: number };
  /** Each source's own `weight·value` this tick, in patch order, un-gained —
   *  the panel's per-source trace and its ghost lines in the output graph. A
   *  muted source's own slot reads 0 (still in patch order — this file's
   *  header's Muting paragraph). Null for `"scene"` (nothing to enumerate)
   *  or an unknown key. Only reads state accumulate() already computed —
   *  never consumes a grid edge. */
  sourceValues(key: string): Float32Array | null;
  /** The same mix-combined, gained reading `value()`/`uniformPair().drive`
   *  give — for a row's own live sparkline, without a caller having to know
   *  a scene's own `sceneDefault` for a "scene" setting (which returns 0
   *  here, since there is no patch to sum — the panel draws that setting's
   *  cables instead of a sparkline). For a patch with no live source,
   *  `rest` (default 0) — the same rule value() applies, this file's
   *  header's "Nothing plugged in" paragraph. */
  valueOf(key: string, rest?: number): number;
  /** The gained reading just before and just after the Master Expansion
   *  (this file's header), both ahead of the generic gate — the output
   *  graph shades the gap between them. Null when Expansion passes the
   *  reading through (1× with "even"), for `"scene"`, a patch with no live
   *  source, or a setting accumulate() has no tracker for yet. */
  expansionPair(key: string): { before: number; after: number } | null;
  /** This setting's own threshold value when its threshold is on (whether
   *  scene-handled — SceneSetting.drive.threshold, adjusted by the slider
   *  under its graph — or the generic engine gate every other patched
   *  setting gets, adjusted the same way), `null` while it's off, and
   *  `undefined` only when there's no engine behind this at all
   *  (PASSTHROUGH_DRIVES — the caller falls back to its own default). A
   *  scene-handled setting reads this to apply its own gate shape (this
   *  file's header's threshold paragraph); a generic setting doesn't need
   *  to call this itself — the engine already applies its gate inside
   *  value()/uniformPair()/valueOf()/fired(). */
  threshold(key: string): number | null | undefined;
  /** The generic engine gate's current line (this file's header's threshold
   *  paragraph), for the panel's own graph to draw dotted — undefined
   *  whenever there's nothing to draw: no `drive` on this setting, a
   *  scene-handled threshold (the scene draws its own line instead), or the
   *  generic gate simply off. */
  gateLine(key: string): number | undefined;
  /** The Master card gauge's needle: how far this scene's picture sits from
   *  its normal right now — the mean, over every patched setting with a live
   *  source, of its Master-Expansion reading minus its own `normal`, in
   *  reading units (this file's header, "Master Expansion"). Null when no
   *  setting has a tracker yet. Never consumes an edge. */
  masterExcursion(): number | null;
}

/** Always "scene" — the identity fallback every caller not wired to a real
 *  DriveEngine gets (gallery previews, tests, any Scene.render() call with
 *  no `drives` argument). Every value/fired call is a bare passthrough and
 *  uniformPair is always {0,0}, so a scene renders exactly as if it had no
 *  drive system at all — the same invariant a catalogue default's identity
 *  gives at the engine level (see this file's header). */
export const PASSTHROUGH_DRIVES: SceneDrives = {
  value: (_key, sceneDefault, _rest) => sceneDefault,
  fired: (_key, sceneDefaultFired) => sceneDefaultFired,
  excess: () => null,
  uniformPair: () => ({ drive: 0, custom: 0 }),
  sourceValues: () => null,
  valueOf: (_key, _rest) => 0,
  expansionPair: () => null,
  threshold: () => undefined,
  gateLine: () => undefined,
  masterExcursion: () => null,
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

/** The source index `setPatchMix`/the wire-format migration (driveStore.ts's
 *  sanitizeDriveSetting) mark as the condition when converting a patch that
 *  carries no per-source role information at all into one that does — the
 *  same source the old, single-`DrivePatch.when` model defaulted to, so a
 *  two-source patch that has never touched its roles keeps its old meaning
 *  the moment it's asked to gate. */
export const DRIVE_GATE_WHEN_DEFAULT = 1;
/** The gate's own smoothstep window on a condition source's weighted
 *  value — this file's header's gate rule, and the one place these two
 *  numbers are written down (combine()/fired() below and the panel's own
 *  gate-open shading — deviceMenu.ts's buildOutputGraph — read them from
 *  here rather than re-typing 0.35/0.55 by hand). */
export const GATE_OPEN_LOW = 0.35;
export const GATE_OPEN_HIGH = 0.55;

/** The generic engine gate's own threshold default (this file's header's
 *  threshold paragraph) — the slider's resting position the one time it's
 *  ever read before a user moves it. Unlike a scene-handled threshold
 *  (SceneSetting.drive.threshold's own `default`), there's one value for
 *  every generic setting, since none of them shaped this gate on purpose the
 *  way a scene-handled setting shapes its own. */
export const GENERIC_THRESHOLD_DEFAULT = 0.25;
// The generic gate tracker's own time constants (accumulate() below) — a
// floor that chases a *lower* resting level quickly (so a quiet moment reads
// as quiet almost at once) but a *higher* one slowly (so one loud passage
// doesn't instantly convince it the room got louder), and a peak that jumps
// to a new high immediately but eases back down toward the floor at the same
// slow rate. Picked to feel like a noise floor, not measured against any
// reference — nothing here plays back a released ring the way
// SALIENCE_*_RELAX_SEC (rippleEmitter.ts) does for Beat ripple's own,
// unrelated trackers.
const GATE_FLOOR_DOWN_TAU_SEC = 0.3;
const GATE_FLOOR_UP_TAU_SEC = 4;
const GATE_PEAK_DECAY_TAU_SEC = 4;
// The soft knee around the gate's own line (value()/uniformPair()/valueOf()
// below): a fraction of the tracker's own floor-to-peak spread, with a
// minimum so a dead-flat signal (peak == floor) still has *some* knee rather
// than a hard step.
const GATE_KNEE_FRACTION = 0.04;
const GATE_KNEE_SPREAD_MIN = 0.1;

// Master Expansion (this file's header): `normal`'s fixed averaging time,
// and the dial's mapping onto `usual`'s catch-up time and the reach. At 1×
// usual's time equals normal's and the reach is 1 — the passthrough the
// engine short-circuits to.
export const EXPANSION_NORMAL_TAU_SEC = 30;
export function expansionUsualTauSec(expansion: number): number {
  return EXPANSION_NORMAL_TAU_SEC * expansion * expansion * expansion;
}
export function expansionReach(expansion: number): number {
  return Math.sqrt(expansion);
}

// "bigMoves": `recent` averages over about a bar at dance tempos, so single
// hits blur into a level; a recent-vs-usual gap under the low mark is
// ignored, and it reaches full size by the high mark (reading units, after
// the reach).
const EXPANSION_RECENT_TAU_SEC = 1.5;
const BIG_MOVE_LOW = 0.08;
const BIG_MOVE_HIGH = 0.2;
// "softTop": headroom it always leaves above `normal`, so a reading whose
// normal already sits near or past 1 can still lift a little.
const SOFT_TOP_MIN_ROOM = 0.25;

export interface ExpansionTracker {
  normal: number;
  usual: number;
  recent: number;
  /** Seconds tracked so far. Until an average's own time has passed it is
   *  the plain mean of everything heard, so a scene that opens on silence
   *  settles on the music within seconds instead of after `normal`'s 30. */
  ageSec: number;
}

function advanceExpansionTracker(tr: ExpansionTracker, dtSec: number, v: number, expansion: number): void {
  tr.ageSec += dtSec;
  const step = (tau: number) => Math.min(1, dtSec / Math.min(tau, tr.ageSec));
  tr.normal += (v - tr.normal) * step(EXPANSION_NORMAL_TAU_SEC);
  tr.usual += (v - tr.usual) * step(expansionUsualTauSec(expansion));
  tr.recent += (v - tr.recent) * step(EXPANSION_RECENT_TAU_SEC);
}

/** How far from `normal` the picture goes, for each shape chip — this
 *  file's header, "Master Expansion". */
function shapeExcursion(v: number, tr: ExpansionTracker, reach: number, shape: ExpansionShape): number {
  if (shape === "bigMoves") {
    const x = reach * (tr.recent - tr.usual);
    return x * smoothstep(BIG_MOVE_LOW, BIG_MOVE_HIGH, Math.abs(x));
  }
  const x = reach * (v - tr.usual);
  if (shape === "upOnly") return Math.max(0, x);
  if (shape === "downOnly") return Math.min(0, x);
  if (shape === "softTop" && x > 0) {
    const room = Math.max(SOFT_TOP_MIN_ROOM, 1 - tr.normal);
    return room * Math.tanh(x / room);
  }
  return x;
}

/** A gained reading through the Master Expansion (this file's header).
 *  Exported for tests. */
export function expandReading(v: number, tr: ExpansionTracker, expansion: number, shape: ExpansionShape): number {
  if (expansion === SCENE_EXPANSION_DEFAULT && shape === "even") return v;
  return Math.max(0, tr.normal + shapeExcursion(v, tr, expansionReach(expansion), shape));
}

function clampWeight(w: number): number {
  return Number.isFinite(w) ? Math.min(DRIVE_WEIGHT_MAX, Math.max(DRIVE_WEIGHT_MIN, w)) : DRIVE_WEIGHT_DEFAULT;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Fractional part in [0, 1) — same convention as beatClock.ts's own
 *  (unexported) wrap01, reproduced here rather than imported since it's a
 *  one-line generic helper, not a beat-clock-specific one: `x % 1` alone
 *  wraps negative inputs to (-1, 0], which every-N-beats' own division
 *  (below) practically never hits (anim.beats only grows, bar the beat
 *  trim's occasional hair-sized nudge back), but a copy that doesn't
 *  quietly rely on that stays correct if it ever does. */
function wrap01(x: number): number {
  const w = x % 1;
  return w < 0 ? w + 1 : w;
}

/** Exported for the panel's own gate-open shading (buildOutputGraph) — the
 *  exact function combine()/fired() below use, so a dashed trace's shaded
 *  "open" band never drifts from what the engine actually gates on. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Indices of `patch.sources` marked `when: true` — the patch's own gate
 *  conditions, in patch order. Computed generically off the `when` flags
 *  regardless of `mix` (a source's role survives a mix change — this file's
 *  header), so a caller checks `mix === "gate"` itself before treating this
 *  as meaningful. Includes a muted condition — `combine()`/`fired()` are
 *  what skip those; the panel's own output graph (deviceMenu.ts's
 *  buildOutputGraph) uses this same list to know which traces draw dashed,
 *  separately deciding whether to draw a muted one at all. */
export function gateConditionIndices(patch: DrivePatch): number[] {
  const out: number[] = [];
  for (let i = 0; i < patch.sources.length; i++) if (patch.sources[i]!.when) out.push(i);
  return out;
}

/** True iff `patch` has at least one source that actually contributes a
 *  reading right now: not muted (`off`), and — in a `gate` mix only — not a
 *  bare condition (`when` gates a `plays` source instead of playing itself;
 *  `add`/`max` ignore `when` entirely, so it never disqualifies a source in
 *  those mixes). `value()`/`valueOf()` below read this to decide whether a
 *  patch has anything plugged in at all, or whether the caller's own `rest`
 *  should stand in unchanged — see this file's header's "Nothing plugged
 *  in" paragraph. */
export function hasLiveSource(patch: DrivePatch): boolean {
  return patch.sources.some((s) => !s.off && !(patch.mix === "gate" && s.when));
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

/** What a patch holds at most one of: `sourceKey`, except every beat-grid
 *  division shares the one slot `"grid"` — a patch carries a single grid
 *  source and `setSourceGrid` re-grids it in place, so toggling *any*
 *  division unplugs whichever one is there. `normalizeDriveSetting`'s dedupe
 *  and `togglePatchSource` key by this; driveSources.ts's jackKey is it too,
 *  so the Timing strip's Grid jack (which always carries the default
 *  division) can unplug a patch whose grid was re-gridded to Bar. */
export function sourceSlot(choice: DriveSourceChoice): string {
  return isGridChoice(choice) ? "grid" : sourceKey(choice);
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
    if (!!sa.when !== !!sb.when) return false;
    if (!!sa.off !== !!sb.off) return false;
    if ((sa.every ?? 1) !== (sb.every ?? 1)) return false;
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
 *  source, and keeps an empty result empty: a patch with nothing plugged in
 *  reads as the caller's own `rest` (0 unless the read passes one — this
 *  file's header's "Nothing plugged in" paragraph) and never fires. It used
 *  to collapse to
 *  `"scene"`, which made unplugging the last source silently fall back to
 *  the scene's own mix — Beat ripple's "bass or beat hit" could never be
 *  disconnected. The panel's "Reset to scene default" is the one way back
 *  to `"scene"`. Also carries the
 *  legacy top-level `when: n` a patch built before per-source roles existed
 *  can still show up with at runtime (driveStore.ts's sanitizeDriveSetting
 *  does the same for the wire-format twin of this field, top-level `w`):
 *  migrates to that surviving source's own `when: true`, but only when
 *  nothing already carries a role (an already-migrated/edited patch keeps
 *  whatever it has). Finally enforces this file's header's own invariant —
 *  at least one source plays — as a backstop: a patch where literally every
 *  source is marked `when` (a lone condition left after its plays sources
 *  were unplugged, or decoded/hand-built data — `setSourceRole`'s own
 *  refusal below already blocks it through the role toggle) has every
 *  `when` cleared rather than guessing which one should stay a condition. This is the one place a patch's own invariants
 *  (this file's header: unique `sourceSlot`s — so at most one grid source
 *  and one line source — weight in 0..2, never every source a condition)
 *  are enforced, so driveStore.ts's
 *  sanitizer and every patch-editing helper below can build through this
 *  rather than re-checking the rules themselves. Deliberately does *not*
 *  invent a condition for a `gate` patch that simply has none marked yet —
 *  that's a real, reachable state (this file's header: "the gate simply
 *  reads as add"), not something to fix up; `setPatchMix` below is the one
 *  place a *fresh* switch into `gate` picks a default. */
export function normalizeDriveSetting(setting: DriveSetting): DriveSetting {
  if (setting === "scene") return "scene";
  const legacyWhen = typeof (setting as unknown as { when?: unknown }).when === "number" ? (setting as unknown as { when: number }).when : undefined;
  const seen = new Set<string>();
  const sources: DriveSource[] = [];
  for (const src of setting.sources) {
    const key = sourceSlot(src.choice);
    if (seen.has(key)) continue;
    seen.add(key);
    const source: DriveSource = { choice: src.choice, weight: clampWeight(src.weight) };
    if (src.height !== undefined && src.height !== "graded") source.height = src.height;
    if (src.when === true) source.when = true;
    if (src.off === true) source.off = true;
    // Only ever meaningful on a plain Beat wave source, and only for a
    // value the picker actually offers — anything else is dropped rather
    // than carried as a number nothing will read (DriveSource.every's own
    // doc, and this file's header on what a drive setting stores).
    if (src.choice === "anim.beatWave" && src.every !== undefined && src.every !== 1 && (DRIVE_EVERY_VALUES as readonly number[]).includes(src.every)) {
      source.every = src.every;
    }
    sources.push(source);
  }
  if (sources.length === 0) return { mix: setting.mix, sources: [] };

  if (legacyWhen !== undefined && !sources.some((s) => s.when)) {
    const idx = Math.min(sources.length - 1, Math.max(0, Math.round(legacyWhen)));
    if (Number.isFinite(idx)) sources[idx]!.when = true;
  }

  // Including a lone source: a patch left with only a condition (every
  // plays source unplugged) would gate nothing and read 0.
  if (sources.every((s) => s.when)) {
    for (const s of sources) delete s.when;
  }

  return { mix: setting.mix, sources };
}

// ---- Pure patch-editing helpers (deviceMenu.ts, Phase 2) -------------------
//
// Each takes and returns a DriveSetting — driveStore.ts's own same-named
// helpers wrap these around (sceneId, spec): read the current setting,
// call through here, persist the result. Kept pure/store-free so they're
// testable without a localStorage stub and so the store stays the only
// place that decides *when* to persist.

/** Adds `choice` to the patch (weight 1, Graded) if nothing holds its
 *  `sourceSlot` yet, removes whatever does if something does — so a grid
 *  choice of any division unplugs the patch's grid source, whichever
 *  division it's on. `"scene"` becomes a fresh one-source `add`
 *  patch on the first add. An empty result normalizes to `"scene"`. A
 *  source's own role/mute travel with it automatically now — nothing to
 *  re-find by key across the edit (drives.ts used to track a single
 *  patch-level `when` index this way; a per-source flag needs no such
 *  bookkeeping). Removing the last source not marked `when` falls under
 *  `normalizeDriveSetting`'s own all-conditions backstop. */
export function togglePatchSource(setting: DriveSetting, choice: DriveSourceChoice): DriveSetting {
  if (setting === "scene") return { mix: "add", sources: [{ choice, weight: DRIVE_WEIGHT_DEFAULT }] };
  const key = sourceSlot(choice);
  const exists = setting.sources.some((s) => sourceSlot(s.choice) === key);
  const sources = exists
    ? setting.sources.filter((s) => sourceSlot(s.choice) !== key)
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

/** Beat wave's own every-N-beats divider (DriveSource.every — see that
 *  field's own doc). No-op on `"scene"` or a patch with no source matching
 *  `choice`; `normalizeDriveSetting` is what actually enforces "only on
 *  anim.beatWave, only a listed value", so a caller here (or a stray value)
 *  can't leave a meaningless one behind. */
export function setSourceEvery(setting: DriveSetting, choice: DriveSourceChoice, every: number): DriveSetting {
  if (setting === "scene") return setting;
  const key = sourceKey(choice);
  const sources = setting.sources.map((s) => (sourceKey(s.choice) === key ? { ...s, every: every as DriveEvery } : s));
  return normalizeDriveSetting({ mix: setting.mix, sources });
}

/** Re-grids the patch's own grid source (there's at most one — this file's
 *  header) to `grid`. No-op on `"scene"` or a patch with no grid source. */
export function setSourceGrid(setting: DriveSetting, grid: BeatGridIndex): DriveSetting {
  if (setting === "scene") return setting;
  const sources = setting.sources.map((s) => (isGridChoice(s.choice) ? { ...s, choice: { source: "beat" as const, grid } } : s));
  return normalizeDriveSetting({ mix: setting.mix, sources });
}

/** No-op on `"scene"`. Switching *into* `gate` for the first time (nothing
 *  in the patch has ever had a role assigned) marks `DRIVE_GATE_WHEN_DEFAULT`
 *  the condition, so a fresh two-source patch gates exactly the way the old
 *  single-`when` model always defaulted it to rather than landing on the
 *  (equally valid, but surprising as a first click) "acts as add" state —
 *  see this file's header. Switching mixes otherwise never touches a
 *  source's own role. */
export function setPatchMix(setting: DriveSetting, mix: DriveMix): DriveSetting {
  if (setting === "scene") return setting;
  let sources = setting.sources;
  if (mix === "gate" && sources.length >= 2 && !sources.some((s) => s.when)) {
    const idx = Math.min(DRIVE_GATE_WHEN_DEFAULT, sources.length - 1);
    sources = sources.map((s, i) => (i === idx ? { ...s, when: true as const } : s));
  }
  return normalizeDriveSetting({ mix, sources });
}

/** The source line's own role toggle (deviceMenu.ts's buildRoleToggle):
 *  marks `sources[index]` "plays" or "when" — several sources can be marked
 *  `when` at once (this file's header's gate paragraph: every one of them
 *  has to read high, ANDed together, for the gate to open). Refuses (returns
 *  `setting` unchanged) a `"when"` request that would leave zero "plays"
 *  sources among the *others* — the at-least-one-plays invariant, checked
 *  here (not just in `normalizeDriveSetting`'s own backstop) so the panel
 *  can tell a real edit from a no-op and disable the button instead of
 *  letting a click visibly do nothing. Mute state (`off`) plays no part in
 *  that check — a role is a role regardless of whether the source is
 *  currently muted. No-op on `"scene"` or an out-of-range index.
 *  driveStore.ts's same-named wrapper persists the result. */
export function setSourceRole(setting: DriveSetting, index: number, role: "plays" | "when"): DriveSetting {
  if (setting === "scene") return setting;
  if (index < 0 || index >= setting.sources.length) return setting;
  if (role === "when" && !setting.sources.some((s, i) => i !== index && !s.when)) return setting;
  const sources = setting.sources.map((s, i) => {
    if (i !== index) return s;
    const next: DriveSource = { ...s };
    if (role === "when") next.when = true;
    else delete next.when;
    return next;
  });
  return normalizeDriveSetting({ mix: setting.mix, sources });
}

/** The source line's own mute switch (deviceMenu.ts's buildMuteSwitch):
 *  turns `sources[index]` off without unplugging it, or back on — see this
 *  file's header's Muting paragraph. No-op on `"scene"` or an out-of-range
 *  index. driveStore.ts's same-named wrapper persists the result. */
export function setSourceMuted(setting: DriveSetting, index: number, muted: boolean): DriveSetting {
  if (setting === "scene") return setting;
  if (index < 0 || index >= setting.sources.length) return setting;
  const sources = setting.sources.map((s, i) => {
    if (i !== index) return s;
    const next: DriveSource = { ...s };
    if (muted) next.off = true;
    else delete next.off;
    return next;
  });
  return normalizeDriveSetting({ mix: setting.mix, sources });
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
  /** Schmitt-trigger state `sourceEdge` below advances for a level-kind
   *  catalogue source or the drawn line, when `fired()` asks for this
   *  source's own edge — see valueTrigger.ts's header. Unused (stays at its
   *  just-created state) for a grid or edge-kind source, which have a real
   *  edge of their own to read instead. */
  valueTrigger: ValueTrigger;
}

function createSourceState(): SourceState {
  return {
    grid: null,
    gridPulse: 0,
    gridFiredPending: false,
    linePulse: 0,
    lineExcess: new Float32Array(NUM_BANDS),
    heightEnv: 0,
    valueTrigger: createValueTrigger(),
  };
}

/** One patched setting's own generic-gate tracker (this file's header's
 *  threshold paragraph) — `accumulate()` advances it once per tick, from the
 *  setting's own combined-and-gained value; `forScene()` only ever reads
 *  `line`/`floor`/`peak` back, never advances them itself, same split as
 *  `SourceState` above. Keyed per setting, not per source — there's one gate
 *  on the setting's own output, not one per source feeding it. */
interface GateTrackerState {
  init: boolean;
  floor: number;
  peak: number;
  /** floor + t·(peak−floor), t the setting's own threshold value — what the
   *  panel's graph draws dotted (SceneDrives.gateLine) and what value()/
   *  fired() gate against. Recomputed every advance, so it's always current
   *  the instant floor/peak move even if the threshold slider itself didn't. */
  line: number;
}

function createGateTracker(): GateTrackerState {
  return { init: false, floor: 0, peak: 0, line: 0 };
}

/** Advances one setting's gate tracker by `dtSec`, given `v` (that setting's
 *  own combined, gained reading this tick — the same number value() would
 *  give with the gate itself switched off) and `t` (the threshold slider,
 *  0..1). The first call seeds floor/peak from `v` rather than from 0, so
 *  startup never reads as a signal that's fallen far below a floor of 0. */
function advanceGateTracker(tr: GateTrackerState, dtSec: number, v: number, t: number): void {
  if (!tr.init) {
    tr.floor = v;
    tr.peak = v;
    tr.init = true;
  } else {
    const floorTau = v < tr.floor ? GATE_FLOOR_DOWN_TAU_SEC : GATE_FLOOR_UP_TAU_SEC;
    tr.floor += (v - tr.floor) * (1 - Math.exp(-dtSec / floorTau));
    tr.peak = v > tr.peak ? v : tr.floor + (tr.peak - tr.floor) * Math.exp(-dtSec / GATE_PEAK_DECAY_TAU_SEC);
  }
  tr.line = tr.floor + clamp01(t) * (tr.peak - tr.floor);
}

/** Which Length row (AnimFrame.hitTail) stretches a hit-kind source's
 *  Fixed/Loud release — the lane whose pulse heightDecayPerSec below borrows
 *  its rate from. Null for Drop: its slow pulse (sectionIntensity.ts) is a
 *  section swell, not a hit's ring-out, so no Length row stretches it. */
function heightTailLane(choice: DriveSourceChoice): HitLane | null {
  switch (choice) {
    case "anim.lowOnset":
      return "low";
    case "anim.midOnset":
      return "mid";
    case "anim.highOnset":
      return "high";
    case "anim.dropOnset":
      return null;
    default:
      return "beat"; // Any hit and the metronome, timed like beatPulse
  }
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
    case "anim.metronome":
    case "anim.metronomeBar":
      return BEAT_PULSE_DECAY_PER_SEC; // matches animClock.ts's own metronomePulse/metronomeBarPulse decay
    default:
      return BEAT_PULSE_DECAY_PER_SEC; // unreached — every edge-kind SignalId is listed above
  }
}

/** Loud height's own target on a hit-kind source's edge — "that band
 *  group's level" (this file's header): the group's own slewed level for a
 *  band onset, sectionIntensity's trend for Drop (its own composite
 *  "loudness" — Drop has no group level of its own to read), and the
 *  sensitivity-applied broadband level (matching Loudness · All exactly)
 *  for Any hit, every beat-grid stop, and the metronome (Metronome/
 *  Metronome bar), since none of those is band-specific. */
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
    case "anim.metronome":
    case "anim.metronomeBar":
      return driveEnergy; // same broadband level as "feature.onset" (Any hit)
    default:
      return driveEnergy; // "feature.onset" (Any hit) and unreached edge cases
  }
}

// combine()'s gate branch (below) is the one place `off`/`when` are read
// directly rather than through a zeroed weighted value — see
// SceneDrives.sourceValues's own doc for why the *panel's* own read zeros a
// muted slot instead of skipping it structurally. Pure (patch + its own
// already-weighted readings in), so both forScene() (a scene/panel's own
// read) and accumulate() (the generic gate tracker's own input, this file's
// header's threshold paragraph) share this one implementation.
function combine(patch: DrivePatch, weighted: number[]): number {
  if (patch.mix === "max") {
    let m = 0;
    for (let i = 0; i < weighted.length; i++) {
      if (patch.sources[i]!.off) continue;
      if (weighted[i]! > m) m = weighted[i]!;
    }
    return m;
  }
  if (patch.mix === "gate") {
    let plays = 0;
    let open = 1;
    let anyCondition = false;
    for (let i = 0; i < patch.sources.length; i++) {
      const src = patch.sources[i]!;
      if (src.off) continue;
      if (src.when) {
        anyCondition = true;
        open *= smoothstep(GATE_OPEN_LOW, GATE_OPEN_HIGH, weighted[i]!);
      } else {
        plays += weighted[i]!;
      }
    }
    // No active condition (none marked, or every marked one muted) — this
    // file's header's own deliberate "acts as add" fallback.
    return anyCondition ? plays * open : plays;
  }
  let sum = 0;
  for (let i = 0; i < weighted.length; i++) if (!patch.sources[i]!.off) sum += weighted[i]!;
  return sum;
}

const lineDriveScratch = { drive: 0, excess: new Float32Array(NUM_BANDS) };
const driveFrameScratch: FeatureFrame = {
  time: 0,
  bands: new Float32Array(NUM_BANDS),
  energy: 0,
  onset: false,
  pulseOnset: false,
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
  // One gate tracker per (scene, setting) — see GateTrackerState's own doc.
  const gateTrackers = new Map<string, GateTrackerState>();
  // The AnimFrame a built-in ("scene") setting's gate tracker last advanced
  // on — forScene()'s gateBuiltIn advances it from value(), which a scene
  // may call more than once a frame, so this keeps it to once per frame.
  const builtInGateFrames = new Map<string, AnimFrame>();
  // One Master Expansion tracker per (scene, setting) — this file's header.
  // Advanced every tick even at 1×, so turning the dial starts from a warm
  // `normal`/`usual` instead of the reading of that moment.
  const expansionTrackers = new Map<string, ExpansionTracker>();

  function stateFor(sceneId: string, key: string, srcKey: string): SourceState {
    const k = `${settingScope(sceneId, key)}:${key}:${srcKey}`;
    let st = states.get(k);
    if (!st) {
      st = createSourceState();
      states.set(k, st);
    }
    return st;
  }

  function gateTrackerKey(sceneId: string, key: string): string {
    return `${settingScope(sceneId, key)}:${key}`;
  }

  /** Creates the tracker on first touch — only ever called from
   *  accumulate() below, for a setting accumulate() has already confirmed is
   *  a real patch with the generic gate on, or from forScene()'s gateBuiltIn
   *  for a built-in reaction with the gate on. A read-only lookup (forScene()'s
   *  own gateTrackerLine/applyGate/passesGate) uses the Map directly instead,
   *  so merely *reading* a setting nobody has ever accumulated for (still on
   *  "scene", or the gate is off) doesn't manufacture a fresh, meaningless
   *  tracker. */
  function gateTrackerFor(sceneId: string, key: string): GateTrackerState {
    const k = gateTrackerKey(sceneId, key);
    let tr = gateTrackers.get(k);
    if (!tr) {
      tr = createGateTracker();
      gateTrackers.set(k, tr);
    }
    return tr;
  }

  // Raw (un-weighted, un-gained) reading for one source — needs `key` too
  // (not just the choice) to look up this setting's own per-source state,
  // and `anim` since accumulate() and forScene() each advance/read for their
  // own AnimFrame (this file's header's Advancing/Reading paragraphs).
  // Shared by both: forScene() below wraps this in a same-named, 2-arg local
  // (closing over its own sceneId/anim) so the rest of that function's body
  // reads exactly as it did before this was split out.
  function sourceRawImpl(sceneId: string, key: string, src: DriveSource, anim: AnimFrame): number {
    const choice = src.choice;
    const wantsHeight = src.height === "fixed" || src.height === "loud";
    if (isGridChoice(choice)) {
      const st = stateFor(sceneId, key, sourceKey(choice));
      return wantsHeight ? st.heightEnv : st.gridPulse;
    }
    if (isLineChoice(choice)) return stateFor(sceneId, key, sourceKey(choice)).linePulse;
    // Beat wave's own every-N-beats divider (DriveSource.every): the plain
    // catalogue read is exactly this formula at every=1 (it swings over the
    // metronome's own phase, and metronomePhase is the fractional part of
    // metronomeBeats — see AnimFrame's metronome fields in animClock.ts), so
    // every>1 is the only case that needs its own read; every=1/absent
    // falls through to the untouched catalogue.read() below, kept
    // bit-identical on purpose rather than routed through this formula too.
    if (choice === "anim.beatWave" && src.every !== undefined && src.every !== 1) {
      return anim.metronomeLevel * (0.5 + 0.5 * Math.cos(2 * Math.PI * wrap01(anim.metronomeBeats / src.every)));
    }
    const catalogue = SIGNALS[choice];
    if (catalogue.kind === "edge" && wantsHeight) return stateFor(sceneId, key, sourceKey(choice)).heightEnv;
    return catalogue.read(driveFrameScratch, anim);
  }

  // Plain float64 array, deliberately not a Float32Array — combine()'s
  // sum/max has to match today's bit-for-bit reading exactly (this file's
  // header's Identity paragraph), and rounding every weighted term through
  // float32 on the way in would quietly break that at the last few bits.
  // sourceValues() below, the panel's own inspection API, is the one place
  // that precision loss is fine (and its own return type, Float32Array,
  // says so).
  function weightedValuesImpl(sceneId: string, key: string, patch: DrivePatch, anim: AnimFrame): number[] {
    return patch.sources.map((src) => clampWeight(src.weight) * sourceRawImpl(sceneId, key, src, anim));
  }

  return {
    accumulate(dtSec, gainedFrame, driveEnergy, anim, sceneId, settings) {
      driveFrameScratch.energy = driveEnergy;
      const expansion = getSceneExpansion();
      const shape = getSceneExpansionShape();
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
            st.gridPulse *= Math.exp(-dtSec * GRID_PULSE_DECAY_PER_SEC * anim.hitTail.beat);
            if (fired) st.gridPulse = 1;
            st.gridFiredPending ||= fired;
            if (wantsHeight) {
              st.heightEnv *= Math.exp(-dtSec * GRID_PULSE_DECAY_PER_SEC * anim.hitTail.beat);
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
            const lane = heightTailLane(choice);
            const rate = heightDecayPerSec(choice) * (lane === null ? 1 : anim.hitTail[lane]);
            st.heightEnv *= Math.exp(-dtSec * rate);
            const edge = SIGNALS[choice].edge!(anim);
            if (edge) st.heightEnv = Math.max(st.heightEnv, src.height === "fixed" ? 1 : loudLevel(choice, anim, driveEnergy));
          }
          // Graded catalogue sources (edge- or level-kind) have no per-tick
          // state to advance — read straight off `anim`/driveFrameScratch at
          // forScene() time below.
        }

        if (!hasLiveSource(setting)) continue;
        const gain = spec.drive.gain ?? 1;
        const raw = combine(setting, weightedValuesImpl(sceneId, spec.key, setting, anim)) * gain;
        const trKey = gateTrackerKey(sceneId, spec.key);
        let ex = expansionTrackers.get(trKey);
        if (!ex) {
          ex = { normal: 0, usual: 0, recent: 0, ageSec: 0 };
          expansionTrackers.set(trKey, ex);
        }
        advanceExpansionTracker(ex, dtSec, raw, expansion);

        // The generic engine gate (this file's header's threshold
        // paragraph): only for a setting that hasn't opted out by declaring
        // its own scene-handled threshold, and only once it's actually
        // switched on — an untouched setting costs nothing extra here. It
        // tracks the expanded reading, the one the scene gets.
        if (spec.drive.threshold === undefined) {
          const thresholdState = getDriveThresholdState(sceneId, spec);
          if (thresholdState.on) {
            const v = expandReading(raw, ex, expansion, shape);
            advanceGateTracker(gateTrackerFor(sceneId, spec.key), dtSec, v, thresholdState.value);
          }
        }
      }
    },

    forScene(sceneId, settings, anim) {
      const specByKey = new Map(settings.map((s) => [s.key, s]));
      const expansion = getSceneExpansion();
      const shape = getSceneExpansionShape();

      function resolve(key: string): { setting: DriveSetting; gain: number } {
        const spec = specByKey.get(key);
        const drive = spec?.drive;
        if (!spec || !drive) return { setting: "scene", gain: 1 };
        return { setting: getDriveSetting(sceneId, spec), gain: drive.gain ?? 1 };
      }

      // Thin, 2-arg wrappers around the shared impls above, closing over
      // this call's own (sceneId, anim) — every call site below reads
      // exactly as it did before sourceRaw/weightedValues moved out to be
      // shared with accumulate()'s own generic-gate tracker.
      function sourceRaw(key: string, src: DriveSource): number {
        return sourceRawImpl(sceneId, key, src, anim);
      }
      function weightedValues(key: string, patch: DrivePatch): number[] {
        return weightedValuesImpl(sceneId, key, patch, anim);
      }

      // Whether `key` is gated by the *generic* engine gate right now (a
      // patch, or a built-in reaction gateBuiltIn has advanced for; its spec
      // opted in by not declaring its own drive.threshold; the threshold
      // switched on) — undefined otherwise, in which case there's nothing
      // here for a caller to apply. Reads the tracker read-only: a setting
      // the generic gate has never had a reason to advance for simply isn't
      // gated, rather than manufacturing a fresh tracker just to answer this.
      function genericGate(key: string): GateTrackerState | undefined {
        const spec = specByKey.get(key);
        if (!spec?.drive || spec.drive.threshold !== undefined) return undefined;
        if (!getDriveThresholdState(sceneId, spec).on) return undefined;
        return gateTrackers.get(gateTrackerKey(sceneId, key));
      }

      // The combined, gained reading through the Master Expansion (this
      // file's header) — what value()/uniformPair()/valueOf() hand on to the
      // generic gate, and what fired()'s gate check compares. A setting
      // accumulate() has never advanced a tracker for passes through.
      function reading(key: string, setting: DrivePatch, gain: number): number {
        const v = combine(setting, weightedValues(key, setting)) * gain;
        if (expansion === SCENE_EXPANSION_DEFAULT && shape === "even") return v;
        const ex = expansionTrackers.get(gateTrackerKey(sceneId, key));
        return ex ? expandReading(v, ex, expansion, shape) : v;
      }

      // value()/uniformPair()/valueOf()'s own soft knee around the generic
      // gate's line (this file's header's threshold paragraph) — a hard cut
      // would make a hit riding right on the line flicker. No-op (returns
      // `v` unchanged) whenever genericGate(key) has nothing to gate on.
      function applyGenericGate(key: string, v: number): number {
        const tr = genericGate(key);
        if (!tr) return v;
        const k = GATE_KNEE_FRACTION * Math.max(tr.peak - tr.floor, GATE_KNEE_SPREAD_MIN);
        return v * smoothstep(tr.line - k, tr.line + k, v);
      }

      // fired()'s own hard cut: an edge whose combined value falls under the
      // generic gate's line never counts, on top of whatever that setting's
      // own mix already required. True (nothing blocked) whenever
      // genericGate(key) has nothing to gate on.
      function passesGenericGate(key: string, v: number): boolean {
        const tr = genericGate(key);
        return !tr || v >= tr.line;
      }

      // grid and edge-kind catalogue sources read a real one-shot edge, same
      // as before. A level-kind catalogue source or the drawn line has no
      // edge of its own (signals.ts's header) — its weighted reading is run
      // through this source's own Schmitt trigger (valueTrigger.ts) instead
      // of falling back to `sceneDefaultFired`. fired() runs once per scene
      // render, not every rAF tick, which is exactly the rate hysteresis
      // wants: a tick a scene never rendered never gets a vote on whether
      // the trigger should have fired, and the trigger's own state
      // (armed/lastBeat/lastFireSec) simply persists across a skipped tick.
      function sourceEdge(key: string, src: DriveSource, upper: number): boolean {
        const choice = src.choice;
        if (isGridChoice(choice)) {
          const st = stateFor(sceneId, key, sourceKey(choice));
          const fired = st.gridFiredPending;
          st.gridFiredPending = false;
          return fired;
        }
        if (!isLineChoice(choice) && SIGNALS[choice].kind === "edge") return SIGNALS[choice].edge!(anim);
        const st = stateFor(sceneId, key, sourceKey(choice));
        const raw = clampWeight(src.weight) * sourceRaw(key, src);
        return stepValueTrigger(st.valueTrigger, raw, upper, anim);
      }

      // The generic gate on a built-in ("scene") reaction read through
      // value(): accumulate() never sees the scene's own value, so the
      // tracker advances here instead, on the value the scene passed, once
      // per AnimFrame. Only value() — uniformPair()'s built-in reading lives
      // in the shader, out of the engine's reach, and fired()'s is a bare
      // yes/no with no level to compare.
      function gateBuiltIn(key: string, v: number): number {
        const spec = specByKey.get(key);
        if (!spec?.drive || spec.drive.threshold !== undefined) return v;
        const thresholdState = getDriveThresholdState(sceneId, spec);
        if (!thresholdState.on) return v;
        const k = gateTrackerKey(sceneId, key);
        if (builtInGateFrames.get(k) !== anim) {
          builtInGateFrames.set(k, anim);
          advanceGateTracker(gateTrackerFor(sceneId, key), anim.dtSec, v, thresholdState.value);
        }
        return applyGenericGate(key, v);
      }

      return {
        value(key, sceneDefault, rest = 0) {
          const { setting, gain } = resolve(key);
          if (setting === "scene") return gateBuiltIn(key, sceneDefault);
          if (!hasLiveSource(setting)) return rest;
          return applyGenericGate(key, reading(key, setting, gain));
        },

        fired(key, sceneDefaultFired, upper = VALUE_TRIGGER_UPPER_DEFAULT) {
          const { setting, gain } = resolve(key);
          if (setting === "scene") return sceneDefaultFired;
          let ok: boolean;
          if (setting.mix === "gate") {
            let anyPlays = false;
            let open = 1;
            let anyCondition = false;
            for (let i = 0; i < setting.sources.length; i++) {
              const src = setting.sources[i]!;
              if (src.off) continue;
              if (src.when) {
                anyCondition = true;
                const conditionValue = clampWeight(src.weight) * sourceRaw(key, src);
                open *= smoothstep(GATE_OPEN_LOW, GATE_OPEN_HIGH, conditionValue);
                // A condition's own edge, if it has one, is never consumed.
              } else if (sourceEdge(key, src, upper)) {
                anyPlays = true;
              }
            }
            const gateOpen = !anyCondition || open > 0.5;
            ok = anyPlays && gateOpen;
          } else {
            ok = false;
            for (const src of setting.sources) {
              if (src.off) continue;
              if (sourceEdge(key, src, upper)) ok = true;
            }
          }
          // The generic gate's own hard cut, on top of whatever the mix
          // above already required (this file's header's threshold
          // paragraph) — a weak hit's edge is blocked even though it fired.
          return ok && passesGenericGate(key, reading(key, setting, gain));
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
          return { drive: applyGenericGate(key, reading(key, setting, gain)), custom: 1 };
        },

        sourceValues(key) {
          const { setting } = resolve(key);
          if (setting === "scene") return null;
          const out = Float32Array.from(weightedValues(key, setting));
          // A muted source's own slot reads 0 (this file's header's Muting
          // paragraph) — combine()/fired() above check `.off` directly
          // instead of relying on this zeroing (a muted *condition* still
          // has to be told apart from one genuinely reading 0), but the
          // panel's own per-source trace wants the flat-0 reading. Never
          // gated — this file's header's threshold paragraph: the generic
          // gate only ever touches the combined result.
          for (let i = 0; i < setting.sources.length; i++) if (setting.sources[i]!.off) out[i] = 0;
          return out;
        },

        valueOf(key, rest = 0) {
          const { setting, gain } = resolve(key);
          if (setting === "scene") return 0;
          if (!hasLiveSource(setting)) return rest;
          return applyGenericGate(key, reading(key, setting, gain));
        },

        expansionPair(key) {
          if (expansion === SCENE_EXPANSION_DEFAULT && shape === "even") return null;
          const { setting, gain } = resolve(key);
          if (setting === "scene" || !hasLiveSource(setting)) return null;
          const ex = expansionTrackers.get(gateTrackerKey(sceneId, key));
          if (!ex) return null;
          const before = combine(setting, weightedValues(key, setting)) * gain;
          return { before, after: expandReading(before, ex, expansion, shape) };
        },

        threshold(key) {
          const spec = specByKey.get(key);
          if (!spec?.drive) return undefined;
          const state = getDriveThresholdState(sceneId, spec);
          return state.on ? state.value : null;
        },

        gateLine(key) {
          return genericGate(key)?.line;
        },

        masterExcursion() {
          let sum = 0;
          let count = 0;
          for (const spec of settings) {
            if (!spec.drive) continue;
            const setting = getDriveSetting(sceneId, spec);
            if (setting === "scene" || !hasLiveSource(setting)) continue;
            const ex = expansionTrackers.get(gateTrackerKey(sceneId, spec.key));
            if (!ex) continue;
            sum += reading(spec.key, setting, spec.drive.gain ?? 1) - ex.normal;
            count++;
          }
          return count ? sum / count : null;
        },
      };
    },
  };
}

