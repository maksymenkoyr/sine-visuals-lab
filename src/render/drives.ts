import { NUM_BANDS, type FeatureFrame } from "../audio/types.ts";
import { type AnimFrame, BEAT_PULSE_DECAY_PER_SEC } from "./animClock.ts";
import type { SceneSetting } from "./sceneSettings.ts";
import { getSceneExpansion, getSceneExpansionShape, SCENE_EXPANSION_DEFAULT, settingScope, type ExpansionShape } from "./sceneSettings.ts";
import { SIGNALS, type SignalId } from "./signals.ts";
import { createGridPulse, type GridPulse } from "./gridPulse.ts";
import { beatGridBeats, type BeatGridIndex } from "../audio/beatGrid.ts";
import { bandLineDrive } from "../audio/bandLine.ts";
import { advanceGateTracker, createGateTracker, stepHeightEnv, windowReading, type GateTrackerState } from "./gateWindow.ts";
import { getDriveLine, getDriveLineStrength, getDriveReadout, getDriveSetting, getDriveSmoothness, getDriveSmoothnessOn, getDriveThresholdState, getDriveWindowMax } from "./driveStore.ts";
import { getGateFormula, getWireGateFormula } from "./gateFormulas.ts";
import { createValueTrigger, stepValueTrigger, VALUE_TRIGGER_UPPER_DEFAULT, type ValueTrigger } from "./valueTrigger.ts";
import { advanceStandout, advanceStandoutAmount, advanceStandoutSized, createStandoutState, standoutLine, type HitReadout, type StandoutState } from "./standout.ts";
import { publishSettingMarks } from "./settingMarks.ts";
import { getDriveSolo } from "./driveSolo.ts";
import { isDriveMuted } from "./driveMute.ts";
import { createWireModState, freshWireMod, clampWireMod, sameWireMod, stepWireMod, wireModIsIdle, type WireMod, type WireModState } from "./wireMod.ts";

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
 *     reading, useful under `max`/`gate` against a Level source.
 *
 *   Fixed/Loud decay at *that source's own* existing pulse-decay rate —
 *   src/render/animClock.ts's BEAT_PULSE_DECAY_PER_SEC for Any hit/beat-grid,
 *   src/render/bandEnergy.ts's own GROUP_TUNING for a band onset — reused
 *   directly (never re-typed by hand) so a Fixed pulse decays exactly as
 *   fast as the Graded pulse it replaces, just with a different height. The
 *   envelope itself is stepHeightEnv in gateWindow.ts.
 *
 * **Wire modifiers.** A catalogue source can carry a modifier
 * (`DriveSource.mod`, src/render/wireMod.ts): Window, Smoothness and Length
 * on that one wire, after its Height. `accumulate()` steps every catalogue
 * wire's modifier state each tick, with or without a modifier, so the
 * panel can draw any wire's input before its Window is switched on; the
 * wire reads the modifier's output only while its Window or Length is on.
 * For `fired()`, a modified hit wire passes the hit's own edge whenever the
 * modifier's output is above 0, so its window decides which hits get
 * through; a modified level wire takes a Schmitt trigger, like any level
 * entry.
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
 * Graded is the untouched catalogue/grid/line reading). A coupling that
 * sums several catalogue signals declares that sum as a patch default
 * (`add`, one weighted source per term) instead of `"scene"`, so it starts
 * on real wires the user can see and unplug — Chladni's Glow. See
 * tests/drives.test.ts's identity check, which walks every registered
 * scene's drive settings and asserts exactly this.
 *
 * **Nothing plugged in.** Two rules a jack's `drive.default` and a scene's
 * own coupling formula both have to hold for (2026-09-28): (1) a jack's
 * default always reacts to the music — never a constant, and never a Scene
 * composite that turns out to be one in disguise. A setting nothing in the
 * catalogue genuinely fits either declares no `drive` at all or, when the
 * scene wants it wireable anyway, starts on an empty patch — a jack with
 * nothing plugged in, reading its slider until the user wires it (Sweep's
 * knobs, 2026-10-05: the user asked for every knob to be wireable). (2) with
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
 * gate shape actually fits its signal — Physarum 2's Dose and Alien's Cut
 * read standout.ts's learned floor/peak trackers, not the generic one
 * below. (Caustics' Beat ripple takes both instead: the generic gate on its
 * drive, then its own Ring threshold as a plain setting.) Declaring
 * `drive.threshold` is what opts a setting *out* of the engine's own gate;
 * every other patched setting (no `drive.threshold` on its spec) gets a
 * generic version of the same idea for free, off by default so nothing
 * changes until it's switched on. `accumulate()` tracks it per setting: a
 * peak that jumps straight to a new high and eases back toward a floor that
 * follows the signal's resting level (down fast, up slowly — a brief loud
 * passage shouldn't instantly convince it the room got louder). The
 * setting's window — two 0..1 sliders, Min (the stored threshold) and Max
 * (getDriveWindowMax), each 0 at a reading of 0 and 1 at the peak — picks
 * two lines between them. `value()`/`uniformPair()`/`valueOf()` read 0 at
 * or under the Min line, the tracked peak at or over the Max line, and a
 * straight rise in between, so a window open all the way (Min 0, Max 1, no
 * Smoothness) hands the reading on unchanged up to the peak. The Max end
 * rides the signal's own peak, so it holds from one song to the next. The
 * setting's Smoothness (getDriveSmoothness in driveStore.ts, defaulting to
 * GENERIC_SMOOTHNESS_DEFAULT in gateWindow.ts, where the window's math lives
 * too: windowReading) softens the window so a reading riding the Min line
 * doesn't flicker, by default without ever passing 0 or the peak; at its
 * far left, or switched off with getDriveSmoothnessOn, the window is exact.
 * A dev build can switch a setting to another of Smoothness's formulas
 * (gateWindow.ts's GATE_FORMULAS, picked in gateFormulas.ts). `fired()` blocks an edge
 * whose own combined value falls under the Min line, on top of whatever
 * that mix already required. A setting
 * still on its built-in reaction (`"scene"`) gets the same gate through
 * `value()` only — forScene()'s gateBuiltIn advances its tracker there, on
 * the scene's own value, since accumulate() never sees it. The panel's
 * own graph draws the Min line with `SceneDrives.gateLine(key)` and the Max
 * line with `SceneDrives.gateTop(key)` — `undefined`
 * whenever there's nothing to draw: no `drive` at all, a scene-handled
 * threshold (the scene draws its own line through settingMarks.ts instead),
 * or the generic gate simply off. Because a scene-handled setting is
 * skipped by the generic gate outright, and a generic setting has no scene
 * of its own reading `drives.threshold`, a setting is never gated twice.
 * A hit driver (next paragraph) opts out of the generic gate too.
 *
 * **Hit drivers.** A setting that does one thing per hit (a burst, a jump, a
 * reset) declares `SceneSetting.drive.hit`, reads `fired()`, and scales its
 * reaction by `hitSize(key)`. Its threshold row is the standout detector
 * (src/render/standout.ts) instead of the generic gate, so a hit counts the
 * same way it does for Beat ripple, Dose and Cut. `fired()` runs that
 * detector itself, once per AnimFrame, on the setting's reading (or, on its
 * built-in reaction, on the `sceneSignal` the scene passes), and draws its
 * reach line and a dot per reaction on the setting's graph through
 * settingMarks.ts. The Reaction row picks the read-out (driveStore.ts's
 * getDriveReadout). With the threshold On, Flat fires once per climb that
 * earns half a standout, at size 1, and Sized once per climb that clears the
 * line, at the size it earned. With the threshold Off, every edge fires
 * exactly as before: at size 1 (Flat) or at its own climb (Sized). So a hit
 * driver nobody has touched (Off, Flat) reads exactly what it did before hit
 * drivers existed. A `flatOnly` setting always reads Flat. A built-in
 * reaction whose scene passes no `sceneSignal` fires on the scene's own edge
 * at size 1, as before. A setting with `hit.ownDetector` (Beat ripple, Dose,
 * Cut) runs standout.ts itself and only reads `readout(key)`. The detector
 * learns from every frame it sees, so a scene calls `fired()` for a hit
 * driver every frame, never behind a check on its own amount. A setting
 * read with `fired()` that should stay out of all this declares
 * `drive.noStandout` (with its reason) instead of `drive.hit`, and its edges
 * pass through the generic gate as before hit drivers existed.
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
 * the "Level" catalogue source and as Loud height's own level for Any
 * hit/beat-grid) separately, because they're deliberately different frames —
 * see sceneCommon.ts's `uploadCommonUniforms` and app.ts's `loop()` for the
 * exact pipeline each one matches. The "Input level" source reads `gainedFrame`'s
 * own `level`, which neither frame's gain or sensitivity ever shapes.
 *
 * **Reading.** `forScene(sceneId, settings, anim)` returns a `SceneDrives`
 * view (each call builds a fresh view object and its closures; the key -> spec
 * lookup is cached per settings array by specMapFor(), and combined readings
 * go through one reused scratch array, so what a read still allocates is its
 * small result objects) — for whichever AnimFrame the caller has in hand. A
 * scene's own render() gets one built from the render-latched AnimFrame
 * (renderLatch.ts's consume()
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
 * **"Only this".** A local, in-memory preview (driveSolo.ts): while one
 * setting of a scene is soloed, `forScene()` reads every other setting of
 * that scene as if all its wires were switched off, so it falls under the
 * "Nothing plugged in" rules above, and a built-in reaction reads its rest.
 * The soloed setting itself reads normally. Mute (driveMute.ts) silences one
 * setting the same way. The stored wires are never touched, so ending the
 * solo restores them exactly. `accumulate()` ignores
 * the solo, so every tracker keeps learning and ending it is warm.
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

/** One source inside a patch; never `"scene"`. */
export type DriveSourceChoice = SignalId | { source: "beat"; grid: BeatGridIndex } | { source: "line" };

/** What a drive setting can be on: `"scene"` (the scene's own coupling) or a
 *  patch. */
export type DriveChoice = DriveSourceChoice | "scene";

/** Fixed/Loud apply only to a hit-kind source (an edge-kind catalogue entry or
 *  a beat grid); level-kind entries and the drawn line ignore it. Absent means
 *  Graded. */
export type HitHeight = "graded" | "fixed" | "loud";

/** Beats per swing for Beat wave's divider (DriveSource.every): multiples of a
 *  beat grid division. */
export const DRIVE_EVERY_VALUES = [1, 2, 4, 8, 16] as const;
type DriveEvery = (typeof DRIVE_EVERY_VALUES)[number];

/** One tap into a patch; `weight` is clamped to 0..2 by `clampWeight`. */
export interface DriveSource {
  choice: DriveSourceChoice;
  weight: number;
  height?: HitHeight;
  /** Gate role: absent plays, `true` marks a condition (header, gate
   *  paragraph). Kept in the other mixes so switching back to `gate` restores
   *  the roles. */
  when?: true;
  /** Muted: contributes nothing but keeps its other fields; `sourceValues()`
   *  reports 0 for the slot. */
  off?: true;
  /** Beat wave only: beats per swing. `normalizeDriveSetting` strips it
   *  elsewhere. Absent or 1 is the plain reading; `sourceRawImpl` branches only
   *  above 1. */
  every?: DriveEvery;
  /** Catalogue sources only: this wire's own Window, Smoothness and Length
   *  (wireMod.ts). Absent reads as `freshWireMod()`, the plain wire. */
  mod?: WireMod;
}

/** How a patch's sources combine; formulas in the header. */
export type DriveMix = "add" | "max" | "gate";

export interface DrivePatch {
  mix: DriveMix;
  sources: DriveSource[];
}

/** What a `SceneSetting.drive` setting is on. Persisted by driveStore.ts and
 *  sceneLooks.ts. */
export type DriveSetting = "scene" | DrivePatch;

export interface SceneDrives {
  /** `sceneDefault` for `"scene"`; `rest` (no gain, no gate) for a patch with
   *  no live source; else the mix-combined reading times `drive.gain`. */
  value(key: string, sceneDefault: number, rest?: number): number;
  /** `sceneDefaultFired` for `"scene"`. Else add/max: the OR of every non-muted
   *  source's edge; gate: the OR over the plays sources AND the conditions open
   *  (a condition's own edge is never consumed). A level-kind or line source
   *  has no edge, so it runs through a Schmitt trigger at `upper` (default
   *  `VALUE_TRIGGER_UPPER_DEFAULT`). A hit driver with its threshold On is
   *  decided by the standout detector instead (header, "Hit drivers"). */
  fired(key: string, sceneDefaultFired: boolean, upper?: number, sceneSignal?: number): boolean;
  /** Hit driver only: size 0..1 of the last hit `fired()` reported (1 while
   *  Flat); holds until the next hit. 1 for any other setting. */
  hitSize(key: string): number;
  /** A hit driver's read-out, for a scene that runs standout.ts itself
   *  (`hit.ownDetector`). Undefined for a non-hit-driver or under
   *  PASSTHROUGH_DRIVES. */
  readout(key: string): HitReadout | undefined;
  /** Per-band excess behind the line source (bandLine.ts's
   *  BandLineDrive.excess), for the panel overlay; null without a line source. */
  excess(key: string): Float32Array | null;
  /** Framework-internal (sceneCommon.ts's uploadCommonUniforms, the panel's
   *  pill); scenes use value()/fired(). `custom` is 0 for `"scene"`, else 1. No
   *  `rest`: a patch with no live source still gives `{drive: 0, custom: 1}`,
   *  so a GLSL coupling must be identity at drive 0 (header, "Nothing plugged
   *  in"). */
  uniformPair(key: string): { drive: number; custom: number };
  /** Each source's un-gained `weight·value` in patch order (a muted slot reads
   *  0); null for `"scene"` or an unknown key. Never consumes a grid edge. */
  sourceValues(key: string): Float32Array | null;
  /** The reading `value()` gives, for a row's sparkline: 0 for `"scene"`,
   *  `rest` for a patch with no live source. */
  valueOf(key: string, rest?: number): number;
  /** The gained reading just before and after the Master Expansion, both ahead
   *  of the generic gate. Null when Expansion passes through, for `"scene"`,
   *  with no live source, or before a tracker exists. */
  expansionPair(key: string): { before: number; after: number } | null;
  /** The threshold when on (scene-handled or generic), null when off, undefined
   *  with no engine behind it (PASSTHROUGH_DRIVES). A scene-handled setting
   *  reads this to apply its own gate; the engine already applies the generic
   *  one inside value()/uniformPair()/valueOf()/fired(). */
  threshold(key: string): number | null | undefined;
  /** The generic gate's Min line for the panel graph; undefined when there is
   *  nothing to draw (no drive, a scene-handled threshold, or the gate off). */
  gateLine(key: string): number | undefined;
  /** The generic gate window's Max line (GateTrackerState.top); undefined
   *  whenever gateLine is. */
  gateTop(key: string): number | undefined;
  /** Master gauge needle: mean over live patched settings of (Expansion reading
   *  minus `normal`), in reading units. Null before any tracker exists. */
  masterExcursion(): number | null;
}

/** Identity fallback for callers without a DriveEngine (gallery previews,
 *  tests): a scene renders as if it had no drive system. */
export const PASSTHROUGH_DRIVES: SceneDrives = {
  value: (_key, sceneDefault, _rest) => sceneDefault,
  fired: (_key, sceneDefaultFired) => sceneDefaultFired,
  hitSize: () => 1,
  readout: () => undefined,
  excess: () => null,
  uniformPair: () => ({ drive: 0, custom: 0 }),
  sourceValues: () => null,
  valueOf: (_key, _rest) => 0,
  expansionPair: () => null,
  threshold: () => undefined,
  gateLine: () => undefined,
  gateTop: () => undefined,
  masterExcursion: () => null,
};

// What "Only this" (driveSolo.ts) silences a setting to: a patch with no live
// source, so it reads its rest. Never stored.
const SOLO_SILENCED: DrivePatch = { mix: "add", sources: [{ choice: "feature.level", weight: 1, off: true }] };

// Imported so grid pulses and Any-hit/beat-grid Fixed/Loud heights release like
// the beat pulse they stand in for.
const GRID_PULSE_DECAY_PER_SEC = BEAT_PULSE_DECAY_PER_SEC;
const LINE_DRIVE_RELEASE_PER_SEC = 6; // the line drive's release from the start: changing it changes how every Line wire feels

export const DRIVE_WEIGHT_MIN = 0;
export const DRIVE_WEIGHT_MAX = 2;
const DRIVE_WEIGHT_DEFAULT = 1;

/** Source index marked the condition when a patch with no roles is first
 *  switched to gate; matches the old single-`when` default, so saved two-source
 *  patches keep their meaning. */
const DRIVE_GATE_WHEN_DEFAULT = 1;
/** The gate's smoothstep window on a condition's weighted value;
 *  combine()/fired() and the panel's gate-open shading (deviceMenu.ts's
 *  buildOutputGraph) share it. */
export const GATE_OPEN_LOW = 0.35;
export const GATE_OPEN_HIGH = 0.55;

/** Longest step the hit driver's standout detector takes (a stalled tab must
 *  not read as one long decay); same clamp as Physarum 2's Dose. */
const HIT_DT_MAX_SEC = 0.05;

/** Declared hit driver whose scene runs no detector of its own and has no
 *  scene-handled threshold. */
export function isEngineHitDriver(spec: SceneSetting | undefined): boolean {
  const hit = spec?.drive?.hit;
  return !!hit && !hit.ownDetector && spec!.drive!.threshold === undefined;
}

/** The Smoothness a setting's generic gate runs at: 0 while it's switched off. */
function gateSmoothness(sceneId: string, spec: SceneSetting): number {
  return getDriveSmoothnessOn(sceneId, spec) ? getDriveSmoothness(sceneId, spec) : 0;
}

/** The generic gate skips scene-handled thresholds and engine-run hit drivers. */
function usesGenericGate(spec: SceneSetting): boolean {
  return spec.drive !== undefined && spec.drive.threshold === undefined && !isEngineHitDriver(spec);
}

// Master Expansion dial mapping (header). At 1x it is the identity, which the
// engine short-circuits.
const EXPANSION_NORMAL_TAU_SEC = 30;
function expansionUsualTauSec(expansion: number): number {
  return EXPANSION_NORMAL_TAU_SEC * expansion * expansion * expansion;
}
export function expansionReach(expansion: number): number {
  return Math.sqrt(expansion);
}

// "bigMoves": `recent` spans about a bar at dance tempos, so single hits blur
// into a level. A recent-vs-usual gap under the low mark is ignored; full size
// at the high mark (reading units, after the reach).
const EXPANSION_RECENT_TAU_SEC = 1.5;
const BIG_MOVE_LOW = 0.08;
const BIG_MOVE_HIGH = 0.2;
// "softTop": headroom always left above `normal`, so a reading already near 1
// can still lift.
const SOFT_TOP_MIN_ROOM = 0.25;

export interface ExpansionTracker {
  normal: number;
  usual: number;
  recent: number;
  /** Seconds tracked. Until an average's own time has passed it is the plain
   *  mean, so a scene opening on silence settles within seconds instead of
   *  `normal`'s tau. */
  ageSec: number;
}

function advanceExpansionTracker(tr: ExpansionTracker, dtSec: number, v: number, expansion: number): void {
  tr.ageSec += dtSec;
  const step = (tau: number) => Math.min(1, dtSec / Math.min(tau, tr.ageSec));
  tr.normal += (v - tr.normal) * step(EXPANSION_NORMAL_TAU_SEC);
  tr.usual += (v - tr.usual) * step(expansionUsualTauSec(expansion));
  tr.recent += (v - tr.recent) * step(EXPANSION_RECENT_TAU_SEC);
}

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

/** Exported for tests. */
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

/** Fractional part in [0, 1); `x % 1` alone wraps negatives to (-1, 0]. */
function wrap01(x: number): number {
  const w = x % 1;
  return w < 0 ? w + 1 : w;
}

/** Exported so the panel's gate-open shading matches what combine()/fired()
 *  gate on. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Indices of sources marked `when`, in patch order, whatever the `mix`
 *  (callers check `mix === "gate"`) and including muted ones. */
export function gateConditionIndices(patch: DrivePatch): number[] {
  const out: number[] = [];
  for (let i = 0; i < patch.sources.length; i++) if (patch.sources[i]!.when) out.push(i);
  return out;
}

/** Whether any source contributes a reading: not muted and, in a `gate` mix,
 *  not a bare condition. value()/valueOf() return `rest` when false (header,
 *  "Nothing plugged in"). */
export function hasLiveSource(patch: DrivePatch): boolean {
  return patch.sources.some((s) => !s.off && !(patch.mix === "gate" && s.when));
}

function isGridChoice(choice: DriveSourceChoice): choice is { source: "beat"; grid: BeatGridIndex } {
  return typeof choice === "object" && choice.source === "beat";
}

function isLineChoice(choice: DriveSourceChoice): choice is { source: "line" } {
  return typeof choice === "object" && choice.source === "line";
}

/** Plain id, `grid:<i>` or `line`: unique within a patch, and keys per-source
 *  engine state. */
export function sourceKey(choice: DriveSourceChoice): string {
  if (typeof choice === "string") return choice;
  return choice.source === "beat" ? `grid:${choice.grid}` : "line";
}

/** Like `sourceKey`, but every beat-grid division shares the slot `"grid"` (one
 *  grid source per patch, re-gridded in place). driveSources.ts's jackKey is it
 *  too, so the Beat grid add chip can unplug a patch re-gridded to Bar. */
export function sourceSlot(choice: DriveSourceChoice): string {
  return isGridChoice(choice) ? "grid" : sourceKey(choice);
}

/** Structural equality, used by the panel and sceneLooks.ts. */
export function sameDriveChoice(a: DriveChoice, b: DriveChoice): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a.source !== b.source) return false;
  return a.source === "beat" && b.source === "beat" ? a.grid === b.grid : true;
}

/** Structural equality, sources compared in order. */
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
    if (!sameWireMod(sa.mod, sb.mod)) return false;
  }
  return true;
}

/** `choice` as the one-source, weight-1, Graded `add` patch (`"scene"`
 *  unchanged). */
export function driveSettingFromChoice(choice: DriveChoice): DriveSetting {
  if (choice === "scene") return "scene";
  return { mix: "add", sources: [{ choice, weight: DRIVE_WEIGHT_DEFAULT }] };
}

/** `"scene"` stays; a patch default is normalized; any other default becomes
 *  its one-source patch (header, Identity). */
export function defaultDriveSetting(spec: SceneSetting): DriveSetting {
  const def = spec.drive?.default;
  if (def === undefined) return "scene";
  if (typeof def === "object" && "mix" in def) return normalizeDriveSetting(def);
  return driveSettingFromChoice(def);
}

/** Enforces a patch's invariants (header: unique `sourceSlot`s, weight 0..2, not
 *  every source a condition); driveStore.ts's sanitizer and the editing helpers
 *  below build through here.
 *  - A duplicate slot loses to the first occurrence.
 *  - An empty result stays empty: nothing plugged in reads `rest` and never
 *    fires. It must not collapse to `"scene"`, or unplugging the last source
 *    would silently fall back to the scene's mix; "Reset to scene default" is
 *    the one way back.
 *  - The legacy top-level `when: n` (driveStore.ts's sanitizer handles its wire
 *    twin `w`) migrates onto that source, only when no source has a role yet.
 *  - A patch whose every source is a condition has every `when` cleared:
 *    a backstop for decoded data; `setSourceRole` refuses it.
 *  - A `gate` patch with no condition is left alone: a real state that reads as
 *    add. `setPatchMix` picks the default on a fresh switch. */
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
    // Only a plain Beat wave source, and only a listed value.
    if (src.choice === "anim.beatWave" && src.every !== undefined && src.every !== 1 && (DRIVE_EVERY_VALUES as readonly number[]).includes(src.every)) {
      source.every = src.every;
    }
    // Only a catalogue wire, and only one that differs from the plain wire.
    if (src.mod !== undefined && typeof src.choice === "string") {
      const mod = clampWireMod(src.mod);
      if (!sameWireMod(mod, undefined)) source.mod = mod;
    }
    sources.push(source);
  }
  if (sources.length === 0) return { mix: setting.mix, sources: [] };

  if (legacyWhen !== undefined && !sources.some((s) => s.when)) {
    const idx = Math.min(sources.length - 1, Math.max(0, Math.round(legacyWhen)));
    if (Number.isFinite(idx)) sources[idx]!.when = true;
  }

  // A lone condition would gate nothing and read 0.
  if (sources.every((s) => s.when)) {
    for (const s of sources) delete s.when;
  }

  return { mix: setting.mix, sources };
}

// ---- Pure patch-editing helpers ----
// driveStore.ts wraps each with (sceneId, spec) to persist; kept store-free so
// they are testable.

/** Adds `choice` if nothing holds its `sourceSlot`, else removes what does (so
 *  any grid division unplugs the grid source). `"scene"` becomes a fresh one-
 *  source `add` patch. */
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

export function setSourceHeight(setting: DriveSetting, choice: DriveSourceChoice, height: HitHeight): DriveSetting {
  if (setting === "scene") return setting;
  const key = sourceKey(choice);
  const sources = setting.sources.map((s) => (sourceKey(s.choice) === key ? { ...s, height } : s));
  return normalizeDriveSetting({ mix: setting.mix, sources });
}

/** Sets the modifier on the catalogue wire `choice` (`null`: back to the
 *  plain wire). No-op on any other wire. */
export function setSourceMod(setting: DriveSetting, choice: DriveSourceChoice, mod: WireMod | null): DriveSetting {
  if (setting === "scene" || typeof choice !== "string") return setting;
  const sources = setting.sources.map((s): DriveSource => {
    if (s.choice !== choice) return s;
    const next: DriveSource = { ...s };
    if (mod) next.mod = mod;
    else delete next.mod;
    return next;
  });
  return normalizeDriveSetting({ mix: setting.mix, sources });
}

/** `normalizeDriveSetting` enforces "only anim.beatWave, only a listed value". */
export function setSourceEvery(setting: DriveSetting, choice: DriveSourceChoice, every: number): DriveSetting {
  if (setting === "scene") return setting;
  const key = sourceKey(choice);
  const sources = setting.sources.map((s) => (sourceKey(s.choice) === key ? { ...s, every: every as DriveEvery } : s));
  return normalizeDriveSetting({ mix: setting.mix, sources });
}

export function setSourceGrid(setting: DriveSetting, grid: BeatGridIndex): DriveSetting {
  if (setting === "scene") return setting;
  const sources = setting.sources.map((s) => (isGridChoice(s.choice) ? { ...s, choice: { source: "beat" as const, grid } } : s));
  return normalizeDriveSetting({ mix: setting.mix, sources });
}

/** The first switch into `gate` (no roles yet) marks `DRIVE_GATE_WHEN_DEFAULT`
 *  the condition rather than landing on the "acts as add" state; otherwise a
 *  source's role is untouched. */
export function setPatchMix(setting: DriveSetting, mix: DriveMix): DriveSetting {
  if (setting === "scene") return setting;
  let sources = setting.sources;
  if (mix === "gate" && sources.length >= 2 && !sources.some((s) => s.when)) {
    const idx = Math.min(DRIVE_GATE_WHEN_DEFAULT, sources.length - 1);
    sources = sources.map((s, i) => (i === idx ? { ...s, when: true as const } : s));
  }
  return normalizeDriveSetting({ mix, sources });
}

/** Refuses (returns `setting` unchanged) a `"when"` request that would leave no
 *  other "plays" source, so the panel can disable the button instead of a click
 *  doing nothing. Mute plays no part in the check. */
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
  /** Fixed/Loud envelope; stays 0 for other sources. */
  heightEnv: number;
  /** Schmitt state for a level-kind or line source's `fired()` edge
   *  (valueTrigger.ts). */
  valueTrigger: ValueTrigger;
  /** A catalogue wire's modifier (wireMod.ts), stepped every tick; null for any other source. */
  mod: WireModState | null;
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
    mod: null,
  };
}

/** An engine-run hit driver's standout detector. fired() advances it once per
 *  AnimFrame, so repeat calls within a frame agree. */
interface HitDetector {
  standout: StandoutState;
  /** The AnimFrame last advanced on, and what fired() said. */
  anim: AnimFrame | null;
  fired: boolean;
  size: number;
}

function createHitDetector(): HitDetector {
  return { standout: createStandoutState(), anim: null, fired: false, size: 1 };
}

// The gate branch reads `off`/`when` directly (a muted condition must differ
// from one reading 0); sourceValues() instead zeros a muted slot. Shared by
// forScene() and accumulate()'s gate tracker.
function combine(patch: DrivePatch, weighted: readonly number[]): number {
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
    // No active condition: acts as add (header).
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
  hats: 0,
  lead: 0,
  engine: null,
};

// forScene()'s key -> spec lookup, built once per `settings` array (called
// every rendered frame). Keyed by array identity, so a scene's `settings` must
// never be mutated in place. `scene.settings ?? []` is a fresh array each
// frame; empty arrays share one map so the WeakMap doesn't fill.
const EMPTY_SPEC_MAP: ReadonlyMap<string, SceneSetting> = new Map();
const specMaps = new WeakMap<readonly SceneSetting[], ReadonlyMap<string, SceneSetting>>();

/** Exported for tests. */
export function specMapFor(settings: readonly SceneSetting[]): ReadonlyMap<string, SceneSetting> {
  if (settings.length === 0) return EMPTY_SPEC_MAP;
  let m = specMaps.get(settings);
  if (!m) {
    m = new Map(settings.map((s) => [s.key, s]));
    specMaps.set(settings, m);
  }
  return m;
}

export interface DriveEngine {
  /** Once per rAF tick, right after animClock.advance(): grid/line/height state
   *  must see every tick (header, "Advancing"). */
  accumulate(
    dtSec: number,
    gainedFrame: FeatureFrame,
    driveEnergy: number,
    anim: AnimFrame,
    sceneId: string,
    settings: readonly SceneSetting[],
  ): void;
  /** A read-only view for `anim`; render and panel hand in different AnimFrames
   *  (header, "Reading"). */
  forScene(sceneId: string, settings: readonly SceneSetting[], anim: AnimFrame): SceneDrives;
  /** A catalogue wire's modifier state this tick (wireMod.ts: its input, output and window lines), for the panel; null before the wire was accumulated. */
  wire(sceneId: string, key: string, choice: SignalId): Readonly<WireModState> | null;
}

export function createDriveEngine(): DriveEngine {
  const states = new Map<string, SourceState>();
  const gateTrackers = new Map<string, GateTrackerState>();
  // The AnimFrame a built-in setting's gate tracker last advanced on: value()
  // may be called more than once a frame.
  const builtInGateFrames = new Map<string, AnimFrame>();
  // Advanced every tick even at 1x, so turning the dial starts from a warm
  // `normal`/`usual`.
  const expansionTrackers = new Map<string, ExpansionTracker>();
  const hitDetectors = new Map<string, HitDetector>();
  const freshMod = freshWireMod();

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

  /** Only accumulate() and gateBuiltIn() create it; forScene()'s read-only
   *  lookups use the Map directly so merely reading a setting nothing
   *  accumulated doesn't manufacture a tracker. */
  function gateTrackerFor(sceneId: string, key: string): GateTrackerState {
    const k = gateTrackerKey(sceneId, key);
    let tr = gateTrackers.get(k);
    if (!tr) {
      tr = createGateTracker();
      gateTrackers.set(k, tr);
    }
    return tr;
  }

  // Whether a wire reads its modifier's output rather than its plain reading.
  function modOn(src: DriveSource): boolean {
    return typeof src.choice === "string" && !wireModIsIdle(src.mod);
  }

  // Raw (un-weighted, un-gained) reading for one source. Shared by accumulate()
  // and forScene(), each for its own AnimFrame.
  function sourceRawImpl(sceneId: string, key: string, src: DriveSource, anim: AnimFrame): number {
    if (modOn(src)) return stateFor(sceneId, key, sourceKey(src.choice)).mod?.output ?? 0;
    return plainRawImpl(sceneId, key, src, anim);
  }

  // A source's reading before its modifier.
  function plainRawImpl(sceneId: string, key: string, src: DriveSource, anim: AnimFrame): number {
    const choice = src.choice;
    const wantsHeight = src.height === "fixed" || src.height === "loud";
    if (isGridChoice(choice)) {
      const st = stateFor(sceneId, key, sourceKey(choice));
      return wantsHeight ? st.heightEnv : st.gridPulse;
    }
    if (isLineChoice(choice)) return stateFor(sceneId, key, sourceKey(choice)).linePulse;
    // Beat wave every-N-beats. every=1 falls through to the catalogue read
    // below, kept bit-identical rather than routed through this formula
    // (metronomePhase is the fractional part of metronomeBeats, animClock.ts).
    if (choice === "anim.beatWave" && src.every !== undefined && src.every !== 1) {
      return anim.metronomeLevel * (0.5 + 0.5 * Math.cos(2 * Math.PI * wrap01(anim.metronomeBeats / src.every)));
    }
    const catalogue = SIGNALS[choice];
    if (catalogue.kind === "edge" && wantsHeight) return stateFor(sceneId, key, sourceKey(choice)).heightEnv;
    return catalogue.read(driveFrameScratch, anim);
  }

  // Plain float64, not Float32Array: combine()'s sum/max must match the reading
  // bit for bit (header, Identity), and float32 rounding per term would break
  // that. One array reused by every read: weightedInto() fills it and combine()
  // consumes it at once; sourceRawImpl() never re-enters combine, so no read
  // overwrites another's terms.
  const weightedScratch: number[] = [];

  function weightedInto(sceneId: string, key: string, patch: DrivePatch, anim: AnimFrame, out: number[]): number[] {
    const sources = patch.sources;
    out.length = sources.length;
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i]!;
      out[i] = clampWeight(src.weight) * sourceRawImpl(sceneId, key, src, anim);
    }
    return out;
  }

  function combinedImpl(sceneId: string, key: string, patch: DrivePatch, anim: AnimFrame): number {
    return combine(patch, weightedInto(sceneId, key, patch, anim, weightedScratch));
  }

  return {
    accumulate(dtSec, gainedFrame, driveEnergy, anim, sceneId, settings) {
      driveFrameScratch.energy = driveEnergy;
      driveFrameScratch.level = gainedFrame.level;
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
          } else {
            if (SIGNALS[choice].kind === "edge" && wantsHeight) {
              st.heightEnv = stepHeightEnv(st.heightEnv, choice, src.height as "fixed" | "loud", dtSec, anim, driveEnergy);
            }
            // Every catalogue wire's modifier steps, switched on or not: the
            // panel draws a wire's input before its Window is on.
            st.mod ??= createWireModState();
            const formula = getWireGateFormula(sceneId, spec.key, choice);
            stepWireMod(st.mod, src.mod ?? freshMod, dtSec, plainRawImpl(sceneId, spec.key, src, anim), formula);
          }
        }

        if (!hasLiveSource(setting)) continue;
        const gain = spec.drive.gain ?? 1;
        const raw = combinedImpl(sceneId, spec.key, setting, anim) * gain;
        const trKey = gateTrackerKey(sceneId, spec.key);
        let ex = expansionTrackers.get(trKey);
        if (!ex) {
          ex = { normal: 0, usual: 0, recent: 0, ageSec: 0 };
          expansionTrackers.set(trKey, ex);
        }
        advanceExpansionTracker(ex, dtSec, raw, expansion);

        // Generic gate (header, threshold paragraph): not for a scene-handled
        // threshold, and only once switched on. Tracks the expanded reading,
        // the one the scene gets.
        if (usesGenericGate(spec)) {
          const thresholdState = getDriveThresholdState(sceneId, spec);
          if (thresholdState.on) {
            const v = expandReading(raw, ex, expansion, shape);
            advanceGateTracker(
              gateTrackerFor(sceneId, spec.key),
              dtSec,
              v,
              thresholdState.value,
              getDriveWindowMax(sceneId, spec),
              getGateFormula(sceneId, spec.key),
              gateSmoothness(sceneId, spec),
            );
          }
        }
      }
    },

    forScene(sceneId, settings, anim) {
      const specByKey = specMapFor(settings);
      const expansion = getSceneExpansion();
      const shape = getSceneExpansionShape();

      function resolve(key: string): { setting: DriveSetting; gain: number } {
        const spec = specByKey.get(key);
        const drive = spec?.drive;
        if (!spec || !drive) return { setting: "scene", gain: 1 };
        const solo = getDriveSolo();
        if (solo && solo.sceneId === sceneId && solo.key !== key) return { setting: SOLO_SILENCED, gain: drive.gain ?? 1 };
        if (isDriveMuted(sceneId, key)) return { setting: SOLO_SILENCED, gain: drive.gain ?? 1 };
        return { setting: getDriveSetting(sceneId, spec), gain: drive.gain ?? 1 };
      }

      function sourceRaw(key: string, src: DriveSource): number {
        return sourceRawImpl(sceneId, key, src, anim);
      }
      function combined(key: string, patch: DrivePatch): number {
        return combinedImpl(sceneId, key, patch, anim);
      }

      // The generic gate's tracker when `key` is gated right now, else
      // undefined. Read-only: never manufactures a tracker for a setting
      // nothing has accumulated.
      function genericGate(key: string): GateTrackerState | undefined {
        const spec = specByKey.get(key);
        if (!spec || !usesGenericGate(spec)) return undefined;
        if (!getDriveThresholdState(sceneId, spec).on) return undefined;
        return gateTrackers.get(gateTrackerKey(sceneId, key));
      }

      // Combined, gained reading through the Master Expansion; a setting with
      // no tracker yet passes through.
      function reading(key: string, setting: DrivePatch, gain: number): number {
        const v = combined(key, setting) * gain;
        if (expansion === SCENE_EXPANSION_DEFAULT && shape === "even") return v;
        const ex = expansionTrackers.get(gateTrackerKey(sceneId, key));
        return ex ? expandReading(v, ex, expansion, shape) : v;
      }

      // Header's threshold paragraph: the window, softened by the setting's
      // Smoothness formula (gateWindow.ts windowReading).
      function applyGenericGate(key: string, v: number): number {
        const tr = genericGate(key);
        if (!tr) return v;
        return windowReading(tr, v, gateSmoothness(sceneId, specByKey.get(key)!), getGateFormula(sceneId, key));
      }

      // fired()'s hard cut: an edge under the generic gate's line never counts.
      function passesGenericGate(key: string, v: number): boolean {
        const tr = genericGate(key);
        return !tr || v >= tr.line;
      }

      // Grid and edge-kind sources read a real one-shot edge. A level-kind
      // source or the line has none (signals.ts's header), so its weighted
      // reading goes through its own Schmitt trigger. fired() runs per scene
      // render, not per tick, which suits hysteresis: the trigger's state just
      // persists across a skipped tick.
      function sourceEdge(key: string, src: DriveSource, upper: number): boolean {
        const choice = src.choice;
        if (isGridChoice(choice)) {
          const st = stateFor(sceneId, key, sourceKey(choice));
          const fired = st.gridFiredPending;
          st.gridFiredPending = false;
          return fired;
        }
        if (!isLineChoice(choice) && SIGNALS[choice].kind === "edge") {
          // A modified hit wire passes the hit's own edge while its output is
          // up: its window decides which hits get through.
          const edge = SIGNALS[choice].edge!(anim);
          return modOn(src) ? edge && sourceRaw(key, src) > 0 : edge;
        }
        const st = stateFor(sceneId, key, sourceKey(choice));
        const raw = clampWeight(src.weight) * sourceRaw(key, src);
        return stepValueTrigger(st.valueTrigger, raw, upper, anim);
      }

      // Generic gate on a built-in reaction read through value(): accumulate()
      // never sees the scene's value, so the tracker advances here, once per
      // AnimFrame. Not uniformPair() (the built-in lives in the shader) or
      // fired() (no level to compare).
      function gateBuiltIn(key: string, v: number): number {
        const spec = specByKey.get(key);
        if (!spec || !usesGenericGate(spec)) return v;
        const thresholdState = getDriveThresholdState(sceneId, spec);
        if (!thresholdState.on) return v;
        const k = gateTrackerKey(sceneId, key);
        if (builtInGateFrames.get(k) !== anim) {
          builtInGateFrames.set(k, anim);
          advanceGateTracker(
            gateTrackerFor(sceneId, key),
            anim.dtSec,
            v,
            thresholdState.value,
            getDriveWindowMax(sceneId, spec),
            getGateFormula(sceneId, key),
            gateSmoothness(sceneId, spec),
          );
        }
        return applyGenericGate(key, v);
      }

      function patchEdge(key: string, setting: DrivePatch, upper: number): boolean {
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
        return ok;
      }

      // An engine-run hit driver's fired(): `edge` is the plain edge, `signal`
      // what the standout detector reads (undefined for a built-in reaction
      // whose scene passes none: the edge decides, at size 1).
      function hitFired(spec: SceneSetting, edge: boolean, signal: number | undefined): boolean {
        const k = gateTrackerKey(sceneId, spec.key);
        let det = hitDetectors.get(k);
        if (!det) {
          det = createHitDetector();
          hitDetectors.set(k, det);
        }
        if (det.anim === anim) return det.fired;
        det.anim = anim;
        if (signal === undefined) {
          det.fired = edge;
          if (edge) det.size = 1;
          return edge;
        }
        // The render frame's dtSec (time since the last render) is this
        // detector's step.
        const dt = Math.min(HIT_DT_MAX_SEC, Math.max(0, anim.dtSec));
        const thresholdState = getDriveThresholdState(sceneId, spec);
        const sized = getDriveReadout(sceneId, spec) === "sized";
        const st = det.standout;
        let size: number;
        if (!thresholdState.on) {
          // Off: edges decide; the detector still learns, and a Sized hit is as
          // big as its climb.
          advanceStandoutAmount(st, dt, signal, null);
          size = !edge ? 0 : !sized ? 1 : st.climbing ? st.earnedThisClimb : 0;
        } else if (sized) {
          size = advanceStandoutSized(st, dt, signal, thresholdState.value);
        } else {
          size = advanceStandout(st, dt, signal, thresholdState.value) ? 1 : 0;
        }
        det.fired = size > 0;
        if (det.fired) det.size = size;
        publishSettingMarks(
          sceneId,
          spec.key,
          { lines: standoutLine(st, "reach to react"), reactionLabel: spec.drive!.hit!.reactionLabel ?? "reaction" },
          size,
        );
        return det.fired;
      }

      return {
        value(key, sceneDefault, rest = 0) {
          const { setting, gain } = resolve(key);
          if (setting === "scene") return gateBuiltIn(key, sceneDefault);
          if (!hasLiveSource(setting)) return rest;
          return applyGenericGate(key, reading(key, setting, gain));
        },

        fired(key, sceneDefaultFired, upper = VALUE_TRIGGER_UPPER_DEFAULT, sceneSignal) {
          const { setting, gain } = resolve(key);
          const spec = specByKey.get(key);
          if (isEngineHitDriver(spec)) {
            const edge = setting === "scene" ? sceneDefaultFired : patchEdge(key, setting, upper);
            const signal = setting === "scene" ? sceneSignal : hasLiveSource(setting) ? reading(key, setting, gain) : 0;
            return hitFired(spec!, edge, signal);
          }
          if (setting === "scene") return sceneDefaultFired;
          // The generic gate's hard cut: a weak hit's edge is blocked even
          // though it fired.
          return patchEdge(key, setting, upper) && passesGenericGate(key, reading(key, setting, gain));
        },

        hitSize(key) {
          if (!isEngineHitDriver(specByKey.get(key))) return 1;
          return hitDetectors.get(gateTrackerKey(sceneId, key))?.size ?? 1;
        },

        readout(key) {
          const spec = specByKey.get(key);
          return spec ? getDriveReadout(sceneId, spec) : undefined;
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
          if (setting === SOLO_SILENCED) return { drive: 0, custom: 1 };
          return { drive: applyGenericGate(key, reading(key, setting, gain)), custom: 1 };
        },

        sourceValues(key) {
          const { setting } = resolve(key);
          if (setting === "scene") return null;
          const out = Float32Array.from(weightedInto(sceneId, key, setting, anim, weightedScratch));
          // A muted slot reads 0 for the panel's flat trace; combine()/fired()
          // check `.off` directly so a muted condition differs from one reading
          // 0. Never gated: the generic gate only touches the combined result.
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
          const before = combined(key, setting) * gain;
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

        gateTop(key) {
          return genericGate(key)?.top;
        },

        masterExcursion() {
          let sum = 0;
          let count = 0;
          for (const spec of settings) {
            if (!spec.drive) continue;
            const { setting } = resolve(spec.key);
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

    wire(sceneId, key, choice) {
      return states.get(`${settingScope(sceneId, key)}:${key}:${sourceKey(choice)}`)?.mod ?? null;
    },
  };
}

