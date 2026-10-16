import {
  EXPANSION_DEFAULT,
  EXPANSION_MAX,
  EXPANSION_MIN,
  applySensitivity,
  SENSITIVITY_DEFAULT,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  SMOOTHING_DEFAULT,
  SMOOTHING_MAX,
  SMOOTHING_MIN,
  shapeExpansion,
  shapeLevel,
} from "../audio/sensitivity.ts";
import {
  SCENE_EXPANSION_DEFAULT,
  SCENE_EXPANSION_MAX,
  SCENE_EXPANSION_MIN,
  SCENE_MASTER_DEFAULT,
  SCENE_MASTER_MAX,
  SCENE_MASTER_MIN,
  isProLocked,
  type SceneSetting,
} from "../render/sceneSettings.ts";
import type { SceneLook } from "../render/sceneLooks.ts";
import type { Scene } from "../render/scene.ts";
import { createLooksCard } from "./looksCard.ts";
import { createMidiCard } from "./midiCard.ts";
import type { MidiController } from "./midiInput.ts";
import { MASTER_EXPANSION_TARGET, MASTER_SCALE_TARGET, sceneTargetId } from "./midiMap.ts";
import { createSetCard, type SetCardDeps } from "./setCard.ts";
import { createOverlayCard, type OverlayCardDeps } from "./overlayCard.ts";
// Side-effect import: registers every built-in widget (registerWidget) so a
// scene's Scene.panel sections resolve — see widgets/registry.ts's header
// for the panel/widget split this file is the one place that renders.
import "./widgets/index.ts";
import { getWidget, type LinkedSetting, type WidgetCtx } from "./widgets/registry.ts";
import { formatMixedSummary } from "./widgets/itemSelection.ts";
import { SIGNALS, type SignalId, type SignalSpec } from "../render/signals.ts";
import { takeSettingMarks } from "../render/settingMarks.ts";
import { NUM_BANDS, type FeatureFrame } from "../audio/types.ts";
import { type BandSplit } from "../audio/bandSplit.ts";
import { AUTO_GAIN_DEFAULT, AUTO_GAIN_MAX, AUTO_GAIN_MIN } from "../audio/autoGain.ts";
import {
  SILENCE_GATE_CLOSED_DEFAULT,
  SILENCE_GATE_MAX,
  SILENCE_GATE_MIN,
  SILENCE_GATE_OPEN_DEFAULT,
  type SilenceGateMarks,
  type SilenceGateReading,
} from "../audio/silenceGate.ts";
import type { HitShape, HitShapePatch } from "../audio/hitStrength.ts";
import type { OnsetDiag } from "../audio/onsetDiag.ts";
import type { LufsReading } from "../audio/lufs.ts";
import { BAND_FADER_COUNT } from "../audio/bandGains.ts";
import { LINE_STRENGTH_DEFAULT } from "../audio/bandLine.ts";
import {
  defaultDriveSetting,
  DRIVE_WEIGHT_MAX,
  DRIVE_WEIGHT_MIN,
  gateConditionIndices,
  GATE_OPEN_HIGH,
  GATE_OPEN_LOW,
  isEngineHitDriver,
  isShapedChoice,
  sameDriveSetting,
  shapeSource,
  smoothstep,
  sourceKey,
  type DriveMix,
  type DrivePatch,
  type DriveSetting,
  type DriveSource,
  type DriveSourceChoice,
  type HitHeight,
  type SceneDrives,
} from "../render/drives.ts";
import type { DriveThresholdState } from "../render/driveStore.ts";
import { isDefaultDriveSetting } from "../render/wireModifiers.ts";
import { clearDriveSolo, getDriveSolo, onDriveSoloChange, setDriveSolo } from "../render/driveSolo.ts";
import type { HitReadout } from "../render/standout.ts";
import { BEAT_GRIDS, type BeatGridIndex } from "../audio/beatGrid.ts";
import {
  driveAddGroups,
  DRIVE_WHITE,
  driveGridDivisionLabel,
  driveSourceColor,
  driveSourceDescription,
  driveSourceLabel,
  HEIGHT_OPTIONS,
  isGridSourceChoice,
  isLineSourceChoice,
  jackKey,
  shapingNodeLabel,
} from "./driveSources.ts";
import { addShapingNode, getShapingNode, listShapingNodes, updateShapingNode } from "../render/shapingNodes.ts";
import { hideTooltip, showTooltip } from "./tooltip.ts";
import { setHintText } from "./hintSwatches.ts";
import { installKeyHints, noteKeyUse, SHORTCUTS, welcomeOnce } from "./keyHints.ts";
import { createBandFaders } from "./bandFaders.ts";
import { createBandLineEditor } from "./bandLineEditor.ts";
import { createAudioMeters, createMeterRow, createTraceStrip, meterGroupHeading, type AudioMetersDeps } from "./audioMeters.ts";
import { createShapingColumn } from "./shapingColumn.ts";
import { chainOf, type ChainFocus, type ChainGraph } from "./patchChain.ts";
import {
  createHeatPip,
  createHeatTrack,
  heatGlowLevel,
  heatHistory,
  heatStripBackground,
  heatText,
  heatToColor,
  HEAT_HISTORY_CELLS,
  HEAT_REFRESH_MS,
  type HeatPip,
  type HeatTrack,
} from "./heat.ts";
import { getHistorySpan } from "./historySpan.ts";
import {
  PICTURE_MEASURES,
  displayLevel,
  overallLevel,
  type PictureMeasureKey,
  type PictureReading,
} from "../render/pictureMeter.ts";
import { createJack, setRowFed, type JackHandle } from "./jack.ts";
import { createCableLayer, type CableGroupSpec, type CableSourceSpec } from "./cableLayer.ts";
import { createPowerCard, type PowerStatus } from "./powerCard.ts";
import type { CastMode, PreviewSize } from "../render/outputPower.ts";
import type { OutputRenderStatus } from "../net/outputSync.ts";
import { isFolded, setFolded, METERS_COLUMN } from "./panelFolds.ts";
import type { PowerMode } from "../render/powerMode.ts";
import type { QualityChoice } from "../render/qualityPref.ts";
import { DISPLAY_SHARE_GUIDE, type AudioSourceChoice, type SourceState } from "../audio/sourcePref.ts";
import { inputKind, isInputHidden, INPUT_KIND_TEXT, type InputDeviceOption, type InputDevicePref, type InputKind } from "../audio/inputDevice.ts";
import type { InputHealthReading } from "../audio/inputHealth.ts";
import type { AnimFrame } from "../render/animClock.ts";
import { createLeashGauge } from "./leashGauge.ts";
import { watchOnScreen } from "./onScreen.ts";
import { allowedChar, fitTyped, parseTyped } from "./typedValue.ts";
import { setLiveText } from "./liveText.ts";
import { GLASS_PANE_CLASS } from "./glassPanes.ts";
import { customReach, fitCustom, sliderSpan } from "../render/customValues.ts";
import {
  AUTO_SKY,
  BANDS_AMBER,
  FADER_OFF,
  FAMILY_ACCENTS,
  FOLDED_BAR_PX,
  FONT_LABEL,
  FONT_MONO,
  GLASS_BG,
  GLASS_FILTER,
  HOT_RED,
  HOT_YELLOW,
  INPUT_GREEN,
  LIVE_DOT,
  SCENE_VIOLET,
  STACK_BELOW_PX,
  ensureControlsStyles,
  withAlpha,
} from "./controlsTheme.ts";
import {
  chipBtnLitStyle,
  chipBtnStyle,
  createAdvancedSection,
  createCard,
  createChipButton,
  createPickerRow,
  createSignalStrip,
  createTraceLegend,
  digitsStyle,
  digitsTextStyle,
  groupHeading,
  paletteGroupLabelStyle,
  paletteGroupRowStyle,
  paletteGroupsStyle,
  paletteSwatchChipLitStyle,
  paletteSwatchChipStyle,
  paletteSwatchStyle,
  percentReadout,
  readoutStyle,
  rowHeadStyle,
  rowLabelStyle,
  rowResetStyle,
  rowRightStyle,
  spacer,
  unitStyle,
} from "./controlsKit.ts";
import { GENERIC_SMOOTHNESS_DEFAULT, GENERIC_THRESHOLD_DEFAULT } from "../render/gateWindow.ts";
import { getGateFormula, setGateFormula } from "../render/gateFormulas.ts";
import { buildGateFormulaPicker } from "./gateFormulaPicker.ts";

/**
 * The controller's controls panel — the "Viz Controls" design.
 *
 * Glass columns over the live scene, docked to opposite screen edges in the
 * wide layout (controlsTheme.ts) with the scene and the patch bay's own
 * cables (src/ui/cableLayer.ts) showing through the open middle: the Bands
 * card (scene name, audio source, and the live bars with the band faders
 * drawn over them — see src/ui/bandFaders.ts) anchored top-left, and the
 * controls column anchored top-right alongside Power, whose cards run the
 * Auto master bar → Input
 * (its own header carries a second Auto button, next to Reset — see
 * src/audio/micAuto.ts for how it differs from the master block) → Scene →
 * Palette → a footer strip. A drive setting (SceneSetting.drive — see
 * src/render/drives.ts) is the patch bay: its row grows an input port (a
 * small ring at the row's left edge, in its first source's colour —
 * src/ui/driveSources.ts owns every source's colour and label), a source
 * summary under the label ("Treble hits + Treble level"), and a live
 * sparkline under the slider (drawn from `drives.valueOf(key)` at ~30 Hz in
 * update(), skipped while the panel is closed or the row is out of
 * view). None of the three is a fork
 * of createControlRow — they're its `port`/`summary`/`below` slots, filled
 * in by appendSettingRow only for a setting with `spec.drive`. Heat (heat.ts)
 * puts a thin history strip under each wired setting's graph, and the heat
 * lens (L or the column head's HEAT chip) makes its row glow in its heat
 * colour; each wire in the wire panel carries a heat dot. Tracks record every
 * tick, panel open or closed; a built-in setting gets none.
 *
 * Two levels of attention, not one: hovering a row for
 * HOVER_SELECT_DELAY_MS, or giving its slider keyboard focus, *previews* it
 * (wireHoverFocus's existing dwell — see its own comment — now drives
 * `preview` instead of a picker); there's no layout change, just the port
 * lighting (cables and meter glow are Phase 2b). Clicking the row's label,
 * summary or port instead *pins* it (togglePin) — one setting at a time —
 * and so does a click anywhere else on the card — the slider included —
 * that isn't one of its side chips (isCardPress; pin-only, never unpins) —
 * and expands its patch panel inline in the row, below the sparkline. The
 * slider pins on `click`, i.e. once a drag is released, so the panel it
 * swaps can't shift the row mid-drag. A row with no `drive` (a slider,
 * switch or picker) pins the same way and gets the same ring, Solo and Tab
 * — just no patch panel, and a jack click passes it by (jackTarget). Escape, clicking the pinned row's
 * own label again, or switching scene unpins (onKeyDown, togglePin,
 * renderSceneSettings's own tail). The patch panel (buildPatchPanel) is
 * rebuilt only on a genuine patch edit — a mix/height/division button, an
 * add/remove chip, Reset — never from a slider drag's own `input` event
 * (that only writes the store and a readout) and never from the panel's
 * periodic refresh, matching the click-loss lesson in this file's carried
 * rules. It shows: a mix segmented control (Add/Strongest/Only when), one
 * line per source (colour dot, name, weight 0–2×, a "+ Modifier" button on a
 * catalogue wire that puts a modifier (shaping node) on it, a hit source's Height
 * Graded/Fixed/Loud only while it still carries an old one, a grid source's
 * division chips, the line source's
 * Strength + Clear reusing lineEditor.strengthRow), a 4 s output graph off
 * `sourceValues`/`valueOf`, and "+ Add by name" chip groups
 * (src/ui/driveSources.ts's DRIVE_ADD_GROUPS) — always open in the stacked
 * layout, since Phase 2b's jacks (the primary way in) are far away there.
 *
 * The words the panel shows for all of this — signal, jack, wire, port,
 * reactive setting, wire panel, built-in — are docs/vocabulary.md's; this
 * file's own names (patch, source, cable) stay code-side.
 *
 * Jacks and cables (Phase 2b) are how a meter actually gets plugged in.
 * Every reactive meter row/lane — audioMeters.ts's own (Hits/Tempo/Dynamics/
 * Character) plus this file's own Bands level rows (BAND_LEVELS/STEM_LEVELS) and
 * its Frequencies corner (mountBandsJack) — grows a jack (src/ui/jack.ts): a
 * ring in its source's colour, filled when it feeds the shown (preview ??
 * pinned) setting, with tiny usage dots around the ring for how many of
 * this scene's settings use it. While a signal's row is lit (hover or
 * focus), every one of those wires is drawn to its port (litSignalFan,
 * cableLayer.ts's fan group). Clicking one with a pinned setting toggles it into that
 * patch (onJackClick); with nothing pinned, it pins whichever setting was
 * last previewed (`lastPreview`, since `preview` itself goes back to null
 * the moment the pointer leaves) and plugs in in the same click, or shows a
 * toast if nothing ever was. A jack can also be dragged onto a setting, a
 * shaping node, or the middle column. Hovering a jack highlights every scene
 * row it already feeds (onJackHover, independent of the shown-setting highlight).
 * While a setting is shown, `refreshPatchHighlight` — called from every
 * place `pinned`/`preview`/a patch actually changes, never per frame —
 * dims the rest of the Bands+meters column (`.vc-patching`, controlsTheme.ts)
 * and dims the spectrum's own unheard bands (refreshSpectrumDriveHighlight).
 * A feeding row/lane's own glow (jack.ts's setRowFed) and the cables
 * themselves now distinguish *pinned* from *previewed* rather than
 * collapsing both into one "shown" look, since a click and a passing hover
 * mean different things: pinned is the patch actually in effect, solid and
 * glowing; a preview (hover, or keyboard focus, short of a click) is a
 * quick look, thin and quiet, that never expands the row's own patch panel.
 * `activePreview()` is `preview` only when it names a genuinely different
 * setting than `pinned` — hovering the pinned row itself is a no-op here.
 * refreshBandsJacks/audioMeters.ts's own refreshPatchView compute, per fed
 * row/lane, which of the two (if both) applies: a preview always wins the
 * glow (soft) over a competing pinned feed, which in turn either keeps its
 * full glow (nothing else previewed) or steps back to a bare "faint" mark
 * (something else is). The cables themselves
 * (src/ui/cableLayer.ts) are one `<svg>` fixed over the viewport, outside
 * every card's own `overflow: hidden`, drawing two independent path
 * groups — pinned (its usual glow/core/flow, dimmed once a preview is also
 * live) and preview (a single thin dashed line, no glow, no flow
 * animation) — from cableSpecsForShown/cableGroupFor below, each a bezier
 * with a short straight stub at both the jack and the port (cableLayer.ts's
 * own CABLE_STUB_PX) whose bend direction is derived from the two
 * endpoints' actual resolved positions rather than assumed, so a cable
 * still draws cleanly regardless of which side of its port a given jack's
 * clamped/folded endpoint (endpointFor, cableLayer.ts) ends up landing on.
 * Geometry is recomputed only on that same short list of triggers (a
 * selection/patch change, scroll of either scrolling column, resize, a
 * card fold, a Scene-card rebuild — scheduleCableRecompute), with only
 * `stroke-dashoffset` written per tick, on the pinned group alone
 * (cableLayer.tick, flow speed off each source's own live value). A
 * pinned cable is also pressable: cableGroupFor gives its real patch
 * sources an onPress, and cableLayer.ts draws a hit stroke over the
 * group for it, so pressing a cable unplugs that source — the same
 * toggle as the source line's own × button. A preview cable and a
 * display-only scene-mix cable stay decoration (no per-source press).
 *
 * In Only when mode, a source's *role* (drives.ts's `DriveSource.when`) is
 * its own, independent flag — several lines can be marked "Only when" at
 * once, every one of them ANDed together (drives.ts's own header). Every
 * line, once the patch has two or more sources and is gating, gets
 * buildRoleToggle's Plays/Only when pair, both halves clickable
 * (deps.onSetSourceRole) — "Only when" disables itself, with a hint, on the
 * one line whose marking would leave zero "plays" sources among the rest
 * (drives.ts's own setSourceRole refusal, mirrored here rather than letting
 * a click visibly do nothing). Every source line shares one left gutter
 * (driveSrcGutterStyle) so dots/names/controls line up regardless of role;
 * a condition line's own dashed rule (`.vc-drive-gutter-cond`,
 * controlsTheme.ts) lives *inside* that gutter, never shifting the row's own
 * content the way a border+padding on the whole line would. buildOutputGraph
 * draws every condition's trace dashed and darkens the time the gate was
 * blocked (drives.ts's GATE_OPEN_LOW/HIGH) plus a lit-when-open strip along
 * its own bottom edge; cableGroupFor marks each condition cable `cond`,
 * which cableLayer.ts/controlsTheme.ts draw with a longer dash than a
 * scene-mix cable's own `soft` one. driveSummaryText's own gate branch names
 * the plays sources then every condition ("Treble hits + Bass hits, only
 * when Song intensity and Loudness are high").
 *
 * A source line's own mute switch (buildMuteSwitch, `deps.onSetSourceMuted`)
 * turns it off without unplugging it — drives.ts's `DriveSource.off`, its
 * own header's Muting paragraph. A muted line dims (`.vc-drive-src-muted`)
 * except the switch itself; its cable draws in cableLayer.ts's flat, dashed
 * `.vc-cable-muted` style (no glow, no flow) rather than the pinned group's
 * usual three-layer structure, and its meter jack still fills solid (it's
 * still plugged in — jackIsShown/jackIsPinned don't look at mute at all) but
 * no longer lights that row's own fed glow (jackIsPinnedActive/
 * jackFeedsPreviewActive, the mute-aware pair refreshBandsJacks/
 * audioMeters.ts's refreshPatchView use for row/lane glow specifically,
 * leaving the plain isPinned/isPreview predicates — and so aria-pressed —
 * mute-agnostic, since unplugging a muted source is still exactly what a
 * click on its jack does).
 *
 * Every control in the patch panel explains itself two ways (setHint,
 * this file's own "cover everything with hints" pass): an `aria-description`
 * for a screen reader (no `title` — the native tooltip only repeated the
 * bottom line) and a `data-hint` the panel's own bottom hint line
 * (buildPatchPanel's `hintBar`) reads off whichever control is currently
 * hovered or keyboard-focused, through one delegated pointerover/
 * pointerout/focusin/focusout pair on the panel root — never a
 * per-control listener, never rebuilt from refreshAuto/update(). The bar's
 * own height is fixed (controlsTheme.ts's `.vc-drive-bottom-hint`) so
 * nothing else in the panel grows or shrinks as the hint text changes. A
 * jack, a row's own port, and a row's own sparkline live *outside* the
 * panel, so they get src/ui/tooltip.ts's small floating tooltip instead,
 * shown with no delay straight off the same pointerenter/focus events
 * jack.ts's onHover already fires — onJackHover shows/hides it, its two
 * lines built by jackTooltipLines from driveSources.ts's own
 * `driveSourceDescription` map (the one place a source's plain-language
 * description lives, next to its colour/label).
 *
 * The Bands card is plain again: the live bars with the band faders drawn
 * over them (src/ui/bandFaders.ts) — its knobs, *except* while the pinned
 * setting's patch has a source on Frequencies, when the strip swaps to that
 * line's drawing overlay (src/ui/bandLineEditor.ts, backed by
 * src/audio/bandLine.ts; refreshLineMode derives this from the pinned
 * patch, not from focus). Its readouts (bandFaders.ts's own `readouts`,
 * plus the fader hint) live in `eqLayer` under the strip, hover/focus/drag-
 * revealed rather than always on (refreshEqLayer below), so the card no
 * longer grows by default just to show them. Scene name and audio source
 * moved out of the card entirely, into one column head above it — a live
 * dot, a status text, and the column's single RAW chip (see that chip's own
 * comment for what it drives) — sitting together with the "Sound" heading
 * in `vc-bands-block`, a wrapper that carries the stacked layout's
 * `.vc-spectrum-card` class (controlsTheme.ts) so head+heading+card travel
 * as one unit there. Under the Bands card, the read-only meters
 * (audioMeters.ts) scroll in their own strip. Below the breakpoint in
 * controlsTheme.ts everything stacks into one scrolling column with the
 * meters last, so the knobs stay in reach. It's corner-docked, not a modal:
 * the whole point is to watch the scene react while you tune it, so it also
 * stays open across palette taps.
 *
 * Every card in that left column — Power, Bands, and each meter card —
 * collapses to just its title bar (createCard's foldId, controlsKit.ts):
 * click the chevron or anywhere on the header outside a Reset-style chip.
 * The Bands+meters column can also go away at once — "Hide left" in the
 * footer strip, or M — which leaves Power and the controls where they are
 * rather than reflowing anything. Solo (O, the footer's "Solo", or the
 * Solo eye just outside a pinned setting's left edge) goes further: only the
 * pinned setting stays — or, with
 * nothing pinned, only the Scene card, until O again (see applySolo);
 * jumping to a block outside what's soloed turns it off rather than
 * moving it (jumpToBlock). The footer sits in a dock stuck to
 * the bottom of the controls column, with a Keys list (?) above it: one row
 * per src/ui/keyHints.ts's SHORTCUTS entry, hovering or clicking a row
 * flashing (or, for the handful with a single action — Panel/Hide UI/Hide
 * left/Solo/Fullscreen/Keys — performing) every control it names
 * (wireKeysRow). That same module also owns the hover tooltip on any
 * `data-key`-tagged control and the hold-Shift-to-reveal keycaps — see its
 * own header. Separately, once every card in Power and
 * that column is folded, there's nothing left to show but a stack of title
 * bars, so the pair collapses horizontally too, down to one small triangle
 * (columnsWrap's vc-cols-folded below) that reopens everything — driven by
 * a MutationObserver over each card's vc-folded class rather than a
 * fold-all callback threaded through createCard, so it costs the rest of
 * the panel nothing. Fold and hide state are this panel's own view state
 * (panelFolds.ts) — unlike every scene/audio/palette read and write below,
 * which goes through DeviceMenuDeps, this doesn't, since nothing outside
 * src/ui/ ever needs to know which card is folded.
 *
 * Row grammar (createControlRow, exported for audioMeters.ts's Hits card's
 * Shape section to reuse directly rather than duplicate; most meter rows instead
 * follow the same grammar with a meter in the slider's place — the shared
 * pieces live in controlsKit.ts): label · seven-segment readout + unit ·
 * "A" chip · "T" chip · ↺. The A chip *is* the auto indicator — filled when
 * auto owns the value, outlined when the user has taken the row manual,
 * absent when the setting has no auto weights (see autoTune.ts). The T chip
 * mutes the row to its floor (0 for a zeroAtMin row, spec.min otherwise) and
 * restores the value it had on a second press — the thumb stays put while
 * muted; only the readout (Off) and the colours change. Any other write to
 * the row (drag, a typed value, ↺, a card Reset, auto taking over) forgets that restore
 * point and unlights it — it's a toggle, not a memory. ↺ only appears once a value is
 * off its default, doubling as a "you changed this" marker. Clicking the
 * readout types a value into it in place (createControlRow's typed entry,
 * typedValue.ts for what the text means), committed like a drag; past the
 * slider's ends a Scene-card setting keeps it as a custom value, marked ⚠
 * left of the number, its slider stretched to it (render/customValues.ts).
 * A chip's letter *is* its hotkey once the row's control has keyboard
 * focus — and wireHoverFocus gives it that focus on genuine pointer
 * movement over the row, matching the identical hover/focus styling
 * below, so pointing at a row is enough; no click needed first. The hint
 * under a row (a setting's `description`) stays collapsed until
 * hover/focus, and while auto holds the row a second line beneath it
 * invites the user to take over. Each card's accent
 * names its system — the constants and their meanings live in
 * controlsTheme.ts.
 *
 * The panel itself is opened and closed from outside with S (wired in
 * app.ts, live only in a viz — see that handler), mirroring a click on
 * deps.toggleButton (the gear); H, below, is the reverse direction, only
 * live once the panel is already open.
 *
 * It's never closed by a tap outside it: that only lets go of focus (see
 * onDocPointerDown), so you can work the scene with the panel still up.
 *
 * Keyboard layer, live only while the panel is open (see onKeyDown): H
 * closes it, M hides/shows the meters column, O solos the pinned setting (or the Scene card), ?
 * lists the keys. Tab / Shift+Tab walk a ring over every
 * .vc-slider/.vc-toggle/.vc-picker/.vc-fader in document order, wrapping at both ends
 * and skipping every chip and button — so Tab alone never leaves the panel
 * and never lands anywhere but a control. That's the soft (preview) walk;
 * while a setting is pinned, Tab / Shift+Tab instead carry the pin itself
 * to the next/previous drive row, wrapping (moveTabPin) — skipping the
 * pinned row's own patch panel and every row that can't be pinned. On whichever control has focus, A
 * toggles auto, R resets, T mutes/restores (see above; a fader's arrow keys
 * are its own, in bandFaders.ts). A focused
 * slider also takes Home/End to its min/max — the browser's own native
 * range-input behavior, left alone by onKeyDown below — plus z/x/c
 * (wireSliderQuickJump) to jump straight to the middle of the track, the
 * top, or wherever the pointer last hovered along it. Shift+1 to Shift+9
 * (the bare digits fire the Set's pads, app.ts) jump to a numbered block —
 * each card title and each scene group heading carries a .vc-block badge,
 * renumbered by renumberBlocks() whenever the block set can change (i.e. on
 * every renderSceneSettings) — and focus the first control inside it,
 * unfolding the block's card first if it's folded (see jumpToBlock). The
 * fold caret is a button, so like every other chip it sits outside the Tab
 * ring on purpose.
 *
 * Scene selection lives in the gallery — this panel doesn't duplicate it.
 * Every read and write goes through DeviceMenuDeps (wired in app.ts); the
 * panel never imports a store.
 */

export interface MenuItem {
  id: string;
  name: string;
}

export type AudioSource = "mic" | "display" | "remote" | "synthetic" | "none";

export interface InputDevicesState {
  /** Empty until the mic permission's first grant (the row shows one "Microphone" placeholder meanwhile). */
  options: InputDeviceOption[];
  defaultLabel: string | null;
  missing: InputDevicePref | null;
  liveLabel: string | null;
}
export interface AudioStatus {
  source: AudioSource;
  sampleRate: number | null;
}

export interface PaletteMenuItem extends MenuItem {
  /** Groups in order of first appearance. */
  group: string;
  /** Ramp, darkest first. */
  swatch: readonly string[];
}

export interface DeviceMenuDeps {
  /** Absent: no MIDI card. */
  midi?: MidiController;
  getPalettes: () => PaletteMenuItem[];
  currentSceneId: () => string;
  currentPaletteId: () => string;
  /** False while app.ts skips the stem split (src/render/stemReaders.ts); Heat records a gap. */
  stemsMeasured: () => boolean;
  onPickPalette: (id: string) => void;
  getAudioStatus: () => AudioStatus;
  /** Mic-vs-screen state (src/audio/sourcePref.ts). Null on a renderer or the synthetic feed, which hides the Source row. */
  getSourceState: () => SourceState | null;
  onAudioSourceChange: (choice: AudioSourceChoice) => void;
  onStopAudio: () => void;
  /** Read on the row's own refresh timer, so src/app.ts answers from a cache, never a fresh enumerateDevices(). */
  getInputDevices: () => InputDevicesState;
  /** src/app.ts also switches the capture to it. */
  onInputDeviceChange: (deviceId: string) => void;
  /** Browser/OS matrix: sourcePref.ts's header. */
  canCaptureDisplay: () => boolean;
  /** Null where there is no local tap to read (renderer, synthetic feed, before a capture's first tick); a healthy input is `{ kind: "ok" }`, never null. Read on the Source row's refresh(), not every rAF tick. */
  getInputHealth: () => InputHealthReading | null;
  /** 0..1 preview level for a device that isn't the live one; null where its preview isn't open (inputPreview.ts). The live row uses FeatureFrame.level instead. */
  getInputLevel: (deviceId: string) => number | null;
  /** True only while the panel is open; inputPreview.ts's header says why it is gated further. */
  setInputPreviewActive: (active: boolean) => void;
  /** By label (inputDevice.ts's hidden-inputs paragraph); app.ts stores it and re-syncs the idle preview, which skips hidden inputs. */
  onInputHiddenChange: (label: string, hide: boolean) => void;
  getSensitivity: (sceneId: string) => number;
  onSensitivityChange: (sceneId: string, value: number) => void;
  getExpansion: (sceneId: string) => number;
  onExpansionChange: (sceneId: string, value: number) => void;
  getSmoothing: (sceneId: string) => number;
  onSmoothingChange: (sceneId: string, value: number) => void;
  /** Empty: the card hides itself. */
  getSceneSettings: (sceneId: string) => SceneSetting[];
  /** For its optional `panel` (src/render/scene.ts); nothing else here reaches into a Scene. */
  getScene: (sceneId: string) => Scene | undefined;
  getSceneSettingValue: (sceneId: string, spec: SceneSetting) => number;
  /** The row's reset target under the scene's current variant (SceneSetting.variant). */
  getSceneSettingDefault: (sceneId: string, spec: SceneSetting) => number;
  onSceneSettingChange: (
    sceneId: string,
    spec: SceneSetting,
    value: number,
  ) => void;
  onSceneSettingsReset: (sceneId: string) => void;
  listLooks: (sceneId: string) => SceneLook[];
  onSaveLook: (sceneId: string) => string;
  onRenameLook: (sceneId: string, from: string, to: string) => boolean;
  onApplyLook: (look: SceneLook) => void;
  onDeleteLook: (sceneId: string, name: string) => void;
  decodeLook: (code: string) => SceneLook | null;
  buildShareLink: (look: SceneLook) => string;
  buildShareCode: (look: SceneLook) => string;
  hasLookUndo: (sceneId: string) => boolean;
  onUndoLook: (sceneId: string) => void;
  /** See src/ui/setCard.ts. */
  set: Omit<SetCardDeps, "sceneName">;
  overlay: OverlayCardDeps;
  /** Per device, not per scene; only colours the strip's bars by pulse group, unrelated to the faders (src/audio/bandSplit.ts). */
  getBandSplit: () => BandSplit;
  /** Real Hz edges once the analyser exists, the nominal ladder before mic access. Also labels the faders. */
  getBandEdgesHz: () => Float32Array;
  getBandGain: (sceneId: string, fader: number) => number;
  onBandGainChange: (sceneId: string, fader: number, value: number) => void;
  onBandGainsReset: (sceneId: string) => void;
  /** A drive setting's whole patch plus the store-level editing helpers below, mirroring driveStore.ts's exports. Keyed per (scene, setting): two settings on one scene keep independent patches and drawn lines. */
  getDriveSetting: (sceneId: string, spec: SceneSetting) => DriveSetting;
  /** A shaping node's live input/output, panel open or closed. */
  getShapingReading(id: string): { input: number; output: number; line: number; top: number } | null;
  /** Writes a whole DriveSetting (driveStore.ts's setDriveSetting), the primitive the narrower onSetXxx wrap. appendSettingRow's multi-item bridge uses it to copy a row's patch onto its `linked` siblings verbatim; right even for a "scene" choice, since items' scene defaults can differ. */
  onSetDriveSetting: (sceneId: string, spec: SceneSetting, setting: DriveSetting) => void;
  onResetDriveSetting: (sceneId: string, spec: SceneSetting) => void;
  /** Offered while the setting plays its scene's own mix, which has no source line to unplug; an empty patch stays empty (drives.ts's normalizeDriveSetting). */
  onUnplugAll: (sceneId: string, spec: SceneSetting) => void;
  onTogglePatchSource: (sceneId: string, spec: SceneSetting, choice: DriveSourceChoice) => void;
  onSetSourceWeight: (sceneId: string, spec: SceneSetting, choice: DriveSourceChoice, weight: number) => void;
  onSetSourceHeight: (sceneId: string, spec: SceneSetting, choice: DriveSourceChoice, height: HitHeight) => void;
  /** Only on a plain Beat wave source line (drives.ts's setSourceEvery). */
  onSetSourceEvery: (sceneId: string, spec: SceneSetting, choice: DriveSourceChoice, every: number) => void;
  onSetSourceGrid: (sceneId: string, spec: SceneSetting, grid: BeatGridIndex) => void;
  onSetPatchMix: (sceneId: string, spec: SceneSetting, mix: DriveMix) => void;
  onSetSourceRole: (sceneId: string, spec: SceneSetting, index: number, role: "plays" | "when") => void;
  /** Off without unplugging (drives.ts's setSourceMuted). */
  onSetSourceMuted: (sceneId: string, spec: SceneSetting, index: number, muted: boolean) => void;
  getDriveLine: (sceneId: string, spec: SceneSetting) => Float32Array;
  setDriveLineBand: (sceneId: string, spec: SceneSetting, band: number, height: number) => void;
  setDriveLine: (sceneId: string, spec: SceneSetting, heights: ArrayLike<number>) => void;
  resetDriveLine: (sceneId: string, spec: SceneSetting) => void;
  getDriveLineStrength: (sceneId: string, spec: SceneSetting) => number;
  /** Under each drive setting's graph. Scene-handled (SceneSetting.drive.threshold) or the generic engine gate (drives.ts's header); the row looks the same, with a different label/hint. */
  getDriveThresholdState: (sceneId: string, spec: SceneSetting) => DriveThresholdState;
  onSetDriveThreshold: (sceneId: string, spec: SceneSetting, value: number) => void;
  onSetDriveThresholdOn: (sceneId: string, spec: SceneSetting, on: boolean) => void;
  /** Generic gates only; its Min is the threshold above. */
  getDriveWindowMax: (sceneId: string, spec: SceneSetting) => number;
  onSetDriveWindowMax: (sceneId: string, spec: SceneSetting, value: number) => void;
  /** Knee width, 0..1. Generic gates only. */
  getDriveSmoothness: (sceneId: string, spec: SceneSetting) => number;
  onSetDriveSmoothness: (sceneId: string, spec: SceneSetting, value: number) => void;
  /** Whether that knee is on, independent of the threshold. */
  getDriveSmoothnessOn: (sceneId: string, spec: SceneSetting) => boolean;
  onSetDriveSmoothnessOn: (sceneId: string, spec: SceneSetting, on: boolean) => void;
  /** Flat or Sized (SceneSetting.drive.hit); undefined for a setting that isn't a hit driver. */
  getDriveReadout: (sceneId: string, spec: SceneSetting) => HitReadout | undefined;
  onSetDriveReadout: (sceneId: string, spec: SceneSetting, readout: HitReadout) => void;
  setDriveLineStrength: (sceneId: string, spec: SceneSetting, value: number) => void;
  onLufsReset: () => void;
  onTap: (timeStamp: number) => void;
  /** Live value for a row on auto (autoTune.ts). */
  resolveSceneSettingValue: (sceneId: string, spec: SceneSetting) => number;
  resolveSensitivityValue: (sceneId: string) => number;
  resolveExpansionValue: (sceneId: string) => number;
  resolveSmoothingValue: (sceneId: string) => number;
  /** Synthetic SceneSettings so these pseudo-params drive an auto chip through the same contract as a real row. */
  getSensitivitySpec: () => SceneSetting;
  getExpansionSpec: () => SceneSetting;
  getSmoothingSpec: () => SceneSetting;
  isSettingAutoEnabled: (sceneId: string, key: string) => boolean;
  onSettingAutoToggle: (sceneId: string, spec: SceneSetting, on: boolean) => void;
  isSceneAuto: (sceneId: string) => boolean;
  onSceneAutoToggle: (sceneId: string, on: boolean) => void;
  /** Device-local: neither captured in a Look nor sent to the TV. Resolved in autoTune.ts's resolveSceneSetting. */
  getSceneMaster: () => number;
  onSceneMasterChange: (value: number) => void;
  /** How far and how long a drive reading may pull the picture from the line Scale sets (drives.ts's header, "Master Expansion"). Device-local. */
  getSceneExpansion: () => number;
  onSceneExpansionChange: (value: number) => void;
  /** Index into sceneSettings.ts's EXPANSION_SHAPES. Device-local. */
  getSceneExpansionShape: () => number;
  onSceneExpansionShapeChange: (index: number) => void;
  /** Null once the meter has gone stale (panel just opened, or nothing forced sampling while closed), never a frozen last value. See src/render/pictureMeter.ts. */
  getPictureReading: () => PictureReading | null;
  /** A value typed past the slider's ends, and how far the slider stretches to fit it (render/customValues.ts). */
  customValues: {
    get(sceneId: string, key: string): number | undefined;
    set(sceneId: string, key: string, value: number): void;
    clear(sceneId: string, key: string): void;
    stretch(sceneId: string, key: string): number | undefined;
    stretchTo(sceneId: string, key: string, to: number): void;
    reset(sceneId: string, key: string): void;
  };
  /** Global per-band adaptive normalization (src/audio/autoGain.ts). AUTO_GAIN_MIN is the fixed mapping against the analyser's dB window, matching the spectrum strip's raw feed; AUTO_GAIN_MAX is fully adaptive. */
  getAutoGain: () => number;
  onAutoGainChange: (value: number) => void;
  /** The row's own A chip: resolves from the room's measured span, not MUSIC_DIALS (autoGain.ts's header). Independent of the master Auto button, which is scoped to isSceneAuto's per-scene store. */
  isAutoGainAuto: () => boolean;
  onAutoGainAutoToggle: (on: boolean) => void;
  resolveAutoGain: () => number;
  /** The two silence-gate marks (src/audio/silenceGate.ts), device-wide: how quiet the room is describes the input, not one scene. Setting one can push the other (open >= closed + SILENCE_GATE_MIN_WIDTH), so both rows re-sync from getSilenceGate() after either change. */
  getSilenceGate: () => SilenceGateMarks;
  onSilenceGateClosedChange: (value: number) => void;
  onSilenceGateOpenChange: (value: number) => void;
  /** One flag for both marks; they resolve against steadiness, not MUSIC_DIALS (silenceGate.ts's "Auto mode" paragraph). Independent of the master Auto button. */
  isSilenceGateAuto: () => boolean;
  onSilenceGateAutoToggle: (on: boolean) => void;
  resolveSilenceGate: () => SilenceGateMarks;
  /** Global per device, not per scene: how a hit's stand-out and loudness blend into pulse height is a taste about detection (src/audio/hitStrength.ts). */
  getHitShape: () => HitShape;
  setHitShape: (partial: HitShapePatch) => void;
  /** Whether every member of "the whole mic" is auto for this scene (src/audio/micAuto.ts's header); overlaps isSceneAuto. */
  isMicAuto: (sceneId: string) => boolean;
  onMicAutoToggle: (sceneId: string, on: boolean) => void;
  /** Device-wide (src/render/powerMode.ts). */
  getPowerMode: () => PowerMode;
  onPowerModeChange: (mode: PowerMode) => void;
  /** Device-wide (src/render/qualityPref.ts). */
  getQualityChoice: () => QualityChoice;
  onQualityChoiceChange: (choice: QualityChoice) => void;
  /** Polled on the panel's auto-refresh tick, not per frame. */
  getPowerStatus: () => PowerStatus;
  /** True while a pop-out output window is open: the main Power card then describes the window's preview and gains Size and Resolution rows. */
  isPreview: () => boolean;
  /** False when the preview has no box to resize (a phone controller's); hides Size. Absent means it can. */
  canResizePreview?: () => boolean;
  getPreviewSize: () => PreviewSize;
  onPreviewSizeChange: (size: PreviewSize) => void;
  /** Fraction from RESOLUTION_MIN to RESOLUTION_MAX (src/render/outputPower.ts), for preview and output. */
  getPreviewResolution: () => number;
  onPreviewResolutionChange: (value: number) => void;
  /** Null while none is open; the "Output" Power card shows only while non-null. */
  getOutputPowerStatus: () => OutputRenderStatus | null;
  getOutputQualityChoice: () => QualityChoice;
  onOutputQualityChoiceChange: (choice: QualityChoice) => void;
  getOutputResolution: () => number;
  onOutputResolutionChange: (value: number) => void;
  getOutputCastMode: () => CastMode;
  onOutputCastModeChange: (mode: CastMode) => void;
  getOutputPowerMode: () => PowerMode;
  onOutputPowerModeChange: (mode: PowerMode) => void;
  /** Excluded from the tap-outside focus reset; ringed (aria-pressed) while open. */
  toggleButton: HTMLElement;
}

export interface DeviceMenu {
  toggle(): void;
  close(): void;
  /** Fed every frame while in a viz. Any may be null (frame/ungained/anim before audio is up; rawBands on a mic-less renderer, mono there too unless the feed sends its waveform).
   *  `frame` has the band faders applied, `ungained` is the same before them (the ghost bars).
   *  `fixedEnergy`, `lufs`, `beatDiag`, `gate` and `drives` are null wherever this device runs no extractor of its own (renderer, synthetic feed).
   *  `rateScale` is app.ts's already-resolved smoothingRateScale; not re-resolved here because resolveSmoothing() slews its auto value and this runs every rAF tick.
   *  `drives` comes off the same un-latched AnimFrame as `anim`: row pills read uniformPair() and the Frequencies overlay reads excess(); neither calls fired(), so polling can't steal a grid setting's pending edge from the scene.
   *  `draw` is false on ticks the panel skips (a display faster than the render cap): only the meters' traces, the heat and the drive graphs' peaks record, with no draw or DOM write. */
  update(
    frame: FeatureFrame | null,
    rawBands: Float32Array | null,
    ungained: FeatureFrame | null,
    pinnedBands: Uint8Array | null,
    anim: AnimFrame | null,
    mono: Float32Array | null,
    rateScale: number,
    fixedEnergy: number | null,
    lufs: LufsReading | null,
    beatDiag: OnsetDiag | null,
    gate: SilenceGateReading | null,
    drives: SceneDrives | null,
    draw: boolean,
  ): void;
  /** By target id and controller value 0..127; works with the panel shut. */
  applyMidiCc(target: string, cc: number): void;
  /** Lets immersive fullscreen (src/ui/fullscreen.ts) skip idle-hiding the gear under an open panel. */
  isOpen(): boolean;
  /** The scene or palette changed from outside (Set pad, key, Autopilot): rebuilds what follows the scene. No-op while closed (open() does it). */
  sceneChanged(): void;
  /** app.ts samples the frame for the Picture block only while it is on screen (onScreen.ts says why that sample isn't free). */
  isPictureOnScreen(): boolean;
  /** The stem split runs only while this is true (src/render/stemReaders.ts). */
  isStemsRowOnScreen(): boolean;
}

// ---- styles --------------------------------------------------------------
// Layout-level rules are class rules in controlsTheme.ts; the row-head grammar
// shared with the meters is in controlsKit.ts; the rest is inline here.

const autoChipBaseStyle = `
  width: 17px; height: 16px; display: grid; place-items: center; border-radius: 3px;
  font: 500 9.5px/1 ${FONT_MONO}; cursor: pointer; padding: 0; flex-shrink: 0;
`;
const autoChipLitStyle = (accent: string) =>
  `${autoChipBaseStyle} background: ${accent}; border: 1px solid ${accent}; color: #070a09;`;
const autoChipManualStyle = (accent: string) =>
  `${autoChipBaseStyle} background: transparent; border: 1px solid ${withAlpha(accent, 0.7)}; color: ${accent};`;
// Lit, "T" fills with FADER_OFF (the panel's one "this is off" colour), never
// the row accent, so a muted row can't read as a lit A chip.
const offChipLitStyle = `${autoChipBaseStyle} background: ${FADER_OFF}; border: 1px solid ${FADER_OFF}; color: #070a09;`;
const AUTO_HOLDING_HINT = "Auto is holding this — drag to take over";
function paintOnlyChip(chip: HTMLElement): void {
  const solo = getDriveSolo();
  const on = !!solo && `${solo.sceneId}:${solo.key}` === chip.dataset.soloKey;
  const accent = chip.dataset.soloAccent ?? SCENE_VIOLET;
  chip.style.cssText = on ? autoChipLitStyle(accent) : autoChipManualStyle(accent);
  chip.setAttribute("aria-pressed", String(on));
  chip.title = on
    ? "All back: switch every setting's reaction back on"
    : "Only this: switch off every other setting's reaction, so only this one moves";
}

/** In sceneSettings.ts's EXPANSION_SHAPES order. */
const EXPANSION_SHAPE_NAMES = ["Even", "Soft top", "Big moves only", "Up only", "Down only"] as const;

const autoMasterBaseStyle = `
  width: 100%; box-sizing: border-box; height: ${FOLDED_BAR_PX}px; flex-shrink: 0;
  cursor: pointer; padding: 0; border-radius: 3px;
  -webkit-backdrop-filter: ${GLASS_FILTER}; backdrop-filter: ${GLASS_FILTER};
`;
const autoMasterStyle = `${autoMasterBaseStyle} background: ${GLASS_BG}; border: 1px solid ${withAlpha(AUTO_SKY, 0.3)};`;
const autoMasterLitStyle = `${autoMasterBaseStyle} background: linear-gradient(${withAlpha("#1479b0", 0.28)}, ${withAlpha("#1479b0", 0.28)}), ${GLASS_BG}; border: 1px solid ${withAlpha(AUTO_SKY, 0.6)};`;
const autoMasterInnerStyle = `display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 100%;`;
const autoMasterLabelStyle = (lit: boolean) =>
  `font: 500 13px/1.2 ${FONT_LABEL}; color: ${lit ? "#a0e7ff" : "rgba(255,255,255,0.55)"};`;
const autoMasterSubStyle = (lit: boolean) =>
  `font: 400 8.5px/1.4 ${FONT_MONO}; letter-spacing: 0.14em; color: ${lit ? withAlpha("#8dccf9", 0.8) : "rgba(255,255,255,0.4)"};`;

const micAutoBaseStyle = `
  font: 500 9.5px/1.2 ${FONT_MONO}; letter-spacing: 0.04em; padding: 2.5px 8px;
  border-radius: 4px; cursor: pointer;
  -webkit-backdrop-filter: ${GLASS_FILTER}; backdrop-filter: ${GLASS_FILTER};
`;
const micAutoStyle = `${micAutoBaseStyle} background: ${GLASS_BG}; border: 1px solid ${withAlpha(INPUT_GREEN, 0.35)}; color: rgba(255,255,255,0.55);`;
const micAutoLitStyle = `${micAutoBaseStyle} background: linear-gradient(${withAlpha(INPUT_GREEN, 0.28)}, ${withAlpha(INPUT_GREEN, 0.28)}), ${GLASS_BG}; border: 1px solid ${withAlpha(INPUT_GREEN, 0.7)}; color: #eafff0;`;
// createCard's `right` slot takes one element, not a list.
const inputCardHeaderRightStyle = `display: flex; align-items: center; gap: 6px;`;

// Column head above the Bands card, no card of its own; audioMeters.ts's
// meterGroupHeadingStyle sizes its top margin to sit flush under it.
const columnHeadStyle = `display: flex; align-items: center; justify-content: space-between; margin: 2px 0 10px;`;
const spectrumStatusStyle = `display: flex; align-items: center; gap: 6px; flex-shrink: 0;`;
const liveDotStyle = (on: boolean) =>
  `width: 4px; height: 4px; border-radius: 50%; background: ${on ? LIVE_DOT : "rgba(255,255,255,0.3)"};`;
const statusTextStyle = `font: 400 10.5px/1 ${FONT_MONO}; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.5);`;

// Plain text, not .vc-hint: that class waits for hover/focus on an enclosing
// .vc-row, and this line has none.
const eqHintStyle = `font: 400 11px/1.5 ${FONT_LABEL}; color: rgba(255,255,255,0.5); margin-top: 6px;`;
const FADER_HINT_TEXT =
  "Drag a knob up to boost a band, down to cut it. Pin an animation node to plug input nodes into it.";

const levelsRowStyle = `display: flex; flex-direction: column; gap: 4px; margin-top: 10px;`;
const levelsLabelStyle = `font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.45);`;
const levelsGridStyle = `display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;`;
// Cells are narrow, so the row label wants a smaller font. Padding/margin
// cancel a `.vc-row` hover glow (controlsTheme.ts), which reaches past its
// content, back to the cell's edge.
const levelsCellStyle = `padding: 2px 8px; margin: -2px -8px;`;
const levelsCellLabelStyle = `font-size: 11.5px;`;

// See the build site near spectrumCol for why one chip drives two raw modes.
const RAW_CHIP_TITLE =
  "Raw: the spectrum before the adaptive envelope and Bands gain, and every meter reading below its pre-smoothing value. Drag Smoothing (Input card) to Off instead to close that second gap for good — at Off, every eased reading already lands on exactly what this shows.";
const HEAT_CHIP_TITLE =
  "Heat lens: every wired animation node and input node glows in its heat colour, brighter as it moves. Colder = barely moves, hotter = big moves on loud music. Also L.";

// ---- The patch bay: layout only; colours and labels come from
// src/ui/driveSources.ts.

// Label and summary stack: side by side, the summary ellipsized to unreadable
// in the narrow controls column.
const driveRowLeftStyle = `display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; cursor: pointer;`;
const driveSummaryStyle = `
  font: 400 11px/1.35 ${FONT_MONO}; color: rgba(255,255,255,0.45); min-width: 0;
  overflow-wrap: break-word;
`;
// Port position/size/shape live in controlsTheme.ts's .vc-drive-port rule;
// drivePortStyle() writes only what depends on live state (source colours,
// pinned/preview ring).

const driveSparkWrapStyle = `margin-top: 4px; height: 20px;`;
const driveSparkCanvasStyle = `display: block; width: 100%; height: 100%;`;

const drivePatchPanelStyle = `
  margin-top: 8px; padding: 9px 9px 8px; border-radius: 7px;
  background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.08);
  display: flex; flex-direction: column; gap: 8px; cursor: default;
`;
const drivePatchHeadStyle = `display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;`;
const driveEyebrowStyle = `font: 500 9.5px/1 ${FONT_LABEL}; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(255,255,255,0.4);`;

const driveSegStyle = `display: inline-flex; border: 1px solid rgba(255,255,255,0.18); border-radius: 6px; overflow: hidden;`;
const driveSegBtnBase = `
  font: 500 10px/1 ${FONT_LABEL}; letter-spacing: 0.08em; text-transform: uppercase;
  background: none; border: none; border-left: 1px solid rgba(255,255,255,0.1); padding: 6px 9px; cursor: pointer;
`;
const driveSegBtnStyle = `${driveSegBtnBase} color: rgba(255,255,255,0.6);`;
const driveSegBtnLitStyle = `${driveSegBtnBase} color: #fff; background: rgba(255,255,255,0.12);`;
const driveSegBtnDisabledStyle = `${driveSegBtnBase} color: rgba(255,255,255,0.22); cursor: not-allowed;`;

// Five fixed columns so every line aligns, condition or plain, muted or not.
// The condition marker is a gutter column, never border+padding on the line
// (controlsTheme.ts's .vc-drive-gutter-cond); row 2 indents under the name.
const driveSrcListStyle = `display: flex; flex-direction: column;`;
const driveSrcLineStyle = `
  display: grid; grid-template-columns: 12px 20px 10px minmax(0,1fr) auto; align-items: center; gap: 6px 9px;
  padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.05);
`;
const driveSrcGutterStyle = `grid-row: 1 / span 2; align-self: stretch; width: 100%;`;
const driveSrcDotStyle = (color: string) => `width: 8px; height: 8px; border-radius: 50%; background: ${color}; box-shadow: 0 0 6px ${color};`;
const driveSrcNameStyle = `font: 500 12px/1.2 ${FONT_LABEL}; color: #fff; min-width: 0;`;
const driveSrcRemoveStyle = `
  background: none; border: none; color: rgba(255,255,255,0.4); font: 15px/1 ${FONT_MONO};
  padding: 2px 5px; border-radius: 3px; cursor: pointer;
`;
const driveSrcCtrlsStyle = `grid-column: 4 / -1; display: flex; align-items: center; gap: 9px; flex-wrap: wrap;`;
const driveEmptySrcStyle = `font: 400 12px/1.4 ${FONT_LABEL}; color: rgba(255,255,255,0.55); padding: 3px 0;`;

const driveMiniSegStyle = `display: inline-flex; border: 1px solid rgba(255,255,255,0.16); border-radius: 5px; overflow: hidden;`;
const driveMiniSegBtnBase = `
  font: 500 9px/1 ${FONT_LABEL}; letter-spacing: 0.05em; text-transform: uppercase;
  background: none; border: none; border-left: 1px solid rgba(255,255,255,0.08); padding: 4px 6px; cursor: pointer;
`;
const driveMiniSegBtnStyle = `${driveMiniSegBtnBase} color: rgba(255,255,255,0.55);`;
const driveMiniSegBtnLitStyle = `${driveMiniSegBtnBase} color: #fff; background: rgba(255,255,255,0.14);`;
const driveMiniSegBtnDisabledStyle = `${driveMiniSegBtnBase} color: rgba(255,255,255,0.22); cursor: not-allowed;`;
const driveGridChipsStyle = `display: flex; flex-wrap: wrap; gap: 4px;`;

const driveWeightWrapStyle = `display: flex; align-items: center; gap: 7px; flex: 1 1 120px; min-width: 100px;`;
const driveWeightRangeStyle = `flex: 1;`;
const driveWeightOutStyle = `font: 400 10.5px/1 ${FONT_MONO}; color: rgba(255,255,255,0.6); min-width: 34px; text-align: right;`;
const driveDrawHintStyle = `font: 400 11px/1.3 ${FONT_LABEL}; color: rgba(255,255,255,0.5);`;

// Too long for a plugged-in source line, which shows buildSourceLine's short
// drawHint instead.
const LINE_HINT_TEXT =
  "Draw the line down onto the bars this setting listens to — keep it just above where they rest so only the hits poke over it. A band left at the top is ignored.";

// Always open in the stacked layout (jacks are far away there); a disclosure
// in the wide layout.
const driveAddDisclosureStyle = `
  align-self: flex-start; background: none; border: none; padding: 0;
  font: 400 11.5px/1.4 ${FONT_LABEL}; color: ${withAlpha(BANDS_AMBER, 0.85)}; text-decoration: underline;
  text-underline-offset: 3px; cursor: pointer;
`;
const driveAddGroupsStyle = `display: flex; flex-direction: column; gap: 6px; margin-top: 2px;`;
const driveAddGroupRowStyle = `display: flex; flex-wrap: wrap; gap: 5px; align-items: center;`;
const driveAddGroupLabelStyle = `font: 500 9px/1 ${FONT_LABEL}; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.4); width: 46px; flex-shrink: 0;`;
const driveChipStyle = `
  font: 400 10.5px/1.2 ${FONT_LABEL}; color: rgba(255,255,255,0.7);
  background: transparent; border: 1px solid rgba(255,255,255,0.18); border-radius: 5px;
  padding: 4px 7px; cursor: pointer;
`;
const driveChipLitStyle = (color: string) =>
  `${driveChipStyle} color: #fff; border-color: ${color}; background: ${withAlpha(color, 0.16)};`;

const driveOutHeadStyle = `display: flex; justify-content: space-between; align-items: baseline;`;
const driveOutValStyle = `font: 400 12px/1 ${FONT_MONO}; color: #fff;`;
const driveOutCanvasStyle = `display: block; width: 100%; height: 56px; border-radius: 5px; background: rgba(255,255,255,0.02);`;

const driveResetLinkStyle = `
  align-self: flex-start; background: none; border: none; padding: 0;
  font: 500 11px/1 ${FONT_LABEL}; color: ${SCENE_VIOLET}; text-decoration: underline; text-underline-offset: 3px; cursor: pointer;
`;


/** Matches the .vc-solo-eye box in controlsTheme.ts. */
const SOLO_EYE_PX = 18;

const footerStyle = `
  display: flex; align-items: center; justify-content: space-between; padding: 7px 12px;
  background: ${GLASS_BG};
  -webkit-backdrop-filter: ${GLASS_FILTER}; backdrop-filter: ${GLASS_FILTER};
  border: 1px solid rgba(255,255,255,0.13); border-radius: 3px;
  font: 400 9.5px/1.2 ${FONT_MONO}; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.5);
`;
const footerBtnStyle = `
  font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit;
  background: none; border: none; padding: 0; cursor: pointer;
`;

// The Input card doubles as a level meter via two background washes sized per
// frame in update(); a bar over a slider read as a second, draggable control.
//  - tick: 2px edge at FeatureFrame.level (absolute loudness on a fixed dB
//    window), always input-green, untouched by Auto-gain or Sensitivity.
//  - fill: out to the shaped (post-Auto-gain, post-sensitivity) level; its
//    colour rides --wash (washColor()), the only value written per frame.
// Fill ramp: green up to HOT_START, then yellow, red from PEAK_START: a silent
// "pinned at max" cue.
const HOT_START = 0.96;
const PEAK_START = 0.99;
const WASH_ALPHA = 0x26;
const WASH_HOT_ALPHA = 0x40; // more opaque at full clip, to read as a warning

const inputCardWashStyle = `
  --wash: ${withAlpha(INPUT_GREEN, WASH_ALPHA / 255)};
  background-image:
    linear-gradient(90deg, transparent calc(100% - 2px), ${withAlpha(INPUT_GREEN, 0.67)} 0),
    linear-gradient(var(--wash), var(--wash));
  background-repeat: no-repeat, no-repeat;
  background-size: 0% 100%, 0% 100%;
  transition: background-size 80ms linear;
`;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
const INPUT_GREEN_RGB = hexToRgb(INPUT_GREEN);
const HOT_YELLOW_RGB = hexToRgb(HOT_YELLOW);
const HOT_RED_RGB = hexToRgb(HOT_RED);

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function lerpRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function toHex(n: number): string {
  return Math.round(n).toString(16).padStart(2, "0");
}

function washColor(level: number): string {
  let rgb = INPUT_GREEN_RGB;
  let alpha = WASH_ALPHA;
  if (level >= HOT_START) {
    const t = Math.min(1, (level - HOT_START) / (PEAK_START - HOT_START));
    rgb =
      level < PEAK_START
        ? lerpRgb(INPUT_GREEN_RGB, HOT_YELLOW_RGB, t)
        : lerpRgb(
            HOT_YELLOW_RGB,
            HOT_RED_RGB,
            (level - PEAK_START) / (1 - PEAK_START),
          );
    alpha = lerp(WASH_ALPHA, WASH_HOT_ALPHA, Math.min(1, (level - HOT_START) / (1 - HOT_START)));
  }
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}${toHex(alpha)}`;
}

// ---- builders ------------------------------------------------------------

/** Idempotent: card titles mark once, per-scene group headings on every
 *  renderSceneSettings. The badge is filled by renumberBlocks. No `data-keycap`
 *  on it, on purpose: it already shows the digit as text. */
function markBlock(heading: HTMLElement): void {
  if (heading.classList.contains("vc-block")) return;
  heading.classList.add("vc-block");
  const badge = document.createElement("span");
  badge.className = "vc-block-n";
  badge.dataset.key = "block";
  heading.prepend(badge);
}

function unmarkBlock(heading: HTMLElement): void {
  if (!heading.classList.contains("vc-block")) return;
  heading.classList.remove("vc-block");
  heading.querySelector(".vc-block-n")?.remove();
}

// Exported for audioMeters.ts's Hits card Shape section (hitStrength.ts).
export interface ControlRowSpec {
  label: string;
  accent: string;
  /** `id` is the target a mapping stores (ui/midiMap.ts), `label` its name in the mapping list (ui/midiCard.ts). */
  midi?: { id: string; label: string };
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
  /** log: a 0..100 slider position whose midpoint lands near defaultValue; linear: the value itself. */
  mapping: "log" | "linear";
  /** Log rows only: the slider's bottom snaps to exactly 0 (a kill), since log(0) has no position. */
  zeroAtMin?: boolean;
  unit?: string;
  format: (value: number) => string;
  /** Set when `format` scales the value (a % row shows value × 100): typed numbers are divided by it. Spread controlsKit.ts's `percentReadout`. */
  typedScale?: number;
  description?: string;
  auto?: {
    isEnabled: () => boolean;
    toggle: (on: boolean) => void;
    resolveLive: () => number;
    /** Read when the chip turns auto off: reveals what's stored, not what the slider showed. */
    getManual: () => number;
  };
  /** After every chip click that flips `auto` and every commit() (a drag or reset hands the row back to manual through onChange). The one hook the Input card rows use for refreshMicAuto and the scene rows for refreshAutoMaster. */
  onAutoToggled?: () => void;
  /** Lets a value typed past the slider's ends stand as a custom value (render/customValues.ts), shown with ⚠. Without it, typed values clamp. */
  custom?: {
    get(): number | undefined;
    set(value: number): void;
    clear(): void;
    stretch(): number | undefined;
    stretchTo(to: number): void;
    reset(): void;
    /** `raw` as this row's custom value; null when it takes none: inside the slider, or a count (customValues.ts's fitCustom). */
    fit(raw: number): number | null;
    /** For the ⚠ tooltip; null for unbounded (a dev build). */
    reach(): { lo: number; hi: number } | null;
    /** The already-resolved live value (auto/override-aware, as the row's auto path reads it), not a raw manual read, so dropping a custom value never fights whatever else owns the row. */
    resolve(): number;
  };
  /** SceneSetting.reads resolved to signals and callbacks by appendSettingRow. */
  reads?: readonly ResolvedSignalRead[];
  /** A drive setting's row extension, built by appendSettingRow's buildDriveRow. `port` mounts absolutely at the row's left edge; `summary` inline after the label, inside the clickable wrapper; `below` as the last child (sparkline, then the pinned patch panel). `onPin` fires on a click on that wrapper or on `port` (stopPropagation'd so the row's click-to-focus-slider handler doesn't also run). */
  drivePanel?: {
    port: HTMLElement;
    summary: HTMLElement;
    below: HTMLElement;
    onPin: () => void;
  };
  /** The O chip: "Only this" (driveSolo.ts). It carries `data-solo-key` so the menu's one onDriveSoloChange listener can relight every row. */
  onlyThis?: { sceneId: string; key: string };
  /** Fires on a click anywhere on the card that isn't a side control (isCardPress); pin-only, so a stray click can't close a pinned card. */
  onCardPin?: () => void;
  /** Other selected items' value for this exact setting (registry.ts's `appendRow` `linked` option, the multi-item selection bridge). Present only for a row built with `linked`, so other rows never allocate the tick DOM. A tick is drawn at a linked value's position only while it disagrees with this row; a caller keeps it current via the returned `setLinkedTicks`, since only this row's own edits change which still disagree (their own rows don't render while selected together). */
  linkedTicks?: readonly { value: number; colour?: string }[];
}

/** One SceneSetting.reads entry resolved against the active scene. `active` closes over the sibling-setting getter (built once in appendSettingRow, not per frame); `onReveal`, present only when the SignalSpec has a `monitor` anchor, unfolds/scrolls to/flashes that meter row (audioMeters.ts's revealRow). */
interface ResolvedSignalRead {
  signal: SignalSpec;
  active: () => boolean;
  onReveal?: () => void;
}

/** Shared by every document-level hotkey and wireHoverFocus, and imported by
 *  app.ts for its beat-trim keys. A range slider keeping focus after a drag is
 *  not typing. */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "TEXTAREA" || t.isContentEditable) return true;
  if (tag === "INPUT" && (t as HTMLInputElement).type !== "range") return true;
  return false;
}

/** A/R/T on a row's focusable control, kept on the control (not the document)
 *  so the keys act on whichever row the Tab ring last focused. Goes through the
 *  chips' `.click()` handlers so key and chip can't drift apart. `auto` is
 *  omitted for rows with no auto weights. The one place all three report to
 *  keyHints.ts's noteKeyUse. */
function wireRowKeys(
  control: HTMLElement,
  actions: { auto?: () => void; reset: () => void; toggleOff: () => void },
): void {
  control.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key.toLowerCase()) {
      case "a":
        if (!actions.auto) return;
        e.preventDefault();
        noteKeyUse("auto");
        actions.auto();
        break;
      case "r":
        e.preventDefault();
        noteKeyUse("reset");
        actions.reset();
        break;
      case "t":
        e.preventDefault();
        noteKeyUse("mute");
        actions.toggleOff();
        break;
    }
  });
}

// Pull radius from the thumb, and the extra scale stacked on the row's
// hover/focus boost (controlsTheme.ts) at zero distance.
const THUMB_MAGNET_RADIUS_PX = 48;
const THUMB_MAGNET_MAX_BOOST = 1.3;

/** Grows the thumb as the pointer nears it. Written as --vc-thumb-boost, which
 *  the thumb's transform multiplies in (controlsTheme.ts), so it composes with
 *  the row's hover rule and falls back to 1. Mouse only. */
function wireThumbMagnet(row: HTMLElement, slider: HTMLInputElement): void {
  row.addEventListener("mousemove", (e) => {
    const rect = slider.getBoundingClientRect();
    const lo = Number(slider.min);
    const hi = Number(slider.max);
    const frac = hi > lo ? (Number(slider.value) - lo) / (hi - lo) : 0;
    const thumbX = rect.left + frac * rect.width;
    const t = Math.max(0, 1 - Math.abs(e.clientX - thumbX) / THUMB_MAGNET_RADIUS_PX);
    const boost = 1 + (THUMB_MAGNET_MAX_BOOST - 1) * t * t;
    row.style.setProperty("--vc-thumb-boost", boost.toFixed(3));
  });
  row.addEventListener("mouseleave", () => row.style.removeProperty("--vc-thumb-boost"));
}

// Last real mouse position in the panel, shared across rows: scrolling with a
// stationary cursor (or jumpToBlock's scrollIntoView) puts a different row
// under it and fires a synthetic mousemove at unchanged coordinates, which only
// a panel-wide check can recognize as "nothing moved."
let lastHoverX = -1;
let lastHoverY = -1;

// True only during wireHoverFocus's control.focus(); appendSettingRow's
// onRowFocusIn reads it synchronously from the resulting focusin to tell
// pointer focus (which waits HOVER_SELECT_DELAY_MS) from keyboard/click. One
// flag, not per row, like lastHoverX/Y.
let pointerFocusOriginated = false;

// Long enough that a fast diagonal sweep toward the spectrum strip never
// selects, short enough that resting on a row feels immediate.
const HOVER_SELECT_DELAY_MS = 150;

/** Focus on real pointer movement, so the keyboard agrees with the hover
 *  styling (controlsTheme.ts styles :hover and :focus-within alike).
 *  `preventScroll` is required: a bare focus() would scroll the `.vc-scroll`
 *  column and slide the row from under the cursor (as bandFaders.ts's
 *  hit.focus()). Never steals from a typing target: a typed readout's blur
 *  commits, and the check is on document.activeElement since the pointer is
 *  over this row, not the readout. */
function wireHoverFocus(row: HTMLElement, control: HTMLElement): void {
  row.addEventListener("mousemove", (e) => {
    if (e.clientX === lastHoverX && e.clientY === lastHoverY) return;
    lastHoverX = e.clientX;
    lastHoverY = e.clientY;
    if (document.activeElement === control || isTypingTarget(document.activeElement)) return;
    pointerFocusOriginated = true;
    control.focus({ preventScroll: true });
    pointerFocusOriginated = false;
  });
}

/** What a card click leaves alone (isCardPress): real controls (chips, signal
 *  pills) and the pinned patch panel, whose buttons rebuild it. The row's own
 *  value control counts as the card. */
const ROW_OWN_CONTROLS = "button, input, select, textarea, a, [role], .vc-drive-patch";

/** A click counts as pressing the card itself, including its value control
 *  `main`. `click` lands only once the pointer is up, so a slider drag finishes
 *  before a patch panel elsewhere collapses and shifts the row. */
function isCardPress(row: HTMLElement, main: HTMLElement, target: EventTarget | null): boolean {
  const own = (target as Element | null)?.closest(ROW_OWN_CONTROLS);
  return !own || !row.contains(own) || main.contains(own);
}

/** The pointer's fraction along the track (0..1, clamped), for
 *  wireSliderQuickJump's c. A keydown has no coordinates, so it reads
 *  lastHoverX/Y. Undefined before the pointer enters the panel or when it sits
 *  outside `row` (the scroll desync wireHoverFocus describes), so c no-ops
 *  rather than edit a row the pointer left. Maps across the slider's full rect,
 *  matching wireThumbMagnet and the --vc-fill track paint (controlsTheme.ts);
 *  the skipped half-thumb inset is sub-pixel. */
function pointerFraction(row: HTMLElement, slider: HTMLInputElement): number | undefined {
  if (lastHoverX < 0) return undefined;
  const rowRect = row.getBoundingClientRect();
  if (
    lastHoverX < rowRect.left ||
    lastHoverX > rowRect.right ||
    lastHoverY < rowRect.top ||
    lastHoverY > rowRect.bottom
  ) {
    return undefined;
  }
  const rect = slider.getBoundingClientRect();
  if (rect.width <= 0) return undefined;
  return Math.min(1, Math.max(0, (lastHoverX - rect.left) / rect.width));
}

/** z centers a focused slider, x maxes it, c jumps to where the pointer last
 *  was (pointerFraction). No low-end key: Home does it natively (onKeyDown
 *  leaves it alone). Plain keys are safe: z/x/c collide with nothing live
 *  while a slider has focus. Sets .value and redispatches "input" so each
 *  site's own commit logic runs. */
function wireSliderQuickJump(row: HTMLElement, slider: HTMLInputElement): void {
  slider.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const frac = e.key === "c" ? pointerFraction(row, slider) : { z: 0.5, x: 1 }[e.key];
    if (frac === undefined) return;
    e.preventDefault();
    const lo = Number(slider.min);
    const hi = Number(slider.max);
    slider.value = String(lo + frac * (hi - lo));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Gain rows (log) and scene setting rows (linear) share one shape; the
 *  pos<->value mapping lives here. */
export function createControlRow(spec: ControlRowSpec) {
  const el = document.createElement("div");
  el.className = "vc-row";
  el.style.cursor = "pointer";

  const head = document.createElement("div");
  head.style.cssText = rowHeadStyle;
  const label = document.createElement("div");
  label.textContent = spec.label;
  label.className = "vc-label";
  label.style.cssText = rowLabelStyle;
  const right = document.createElement("div");
  right.style.cssText = rowRightStyle;

  const readout = document.createElement("div");
  readout.style.cssText = readoutStyle;
  const digits = document.createElement("span");
  digits.style.cssText = digitsStyle;
  const unit = document.createElement("span");
  unit.style.cssText = unitStyle;
  unit.textContent = spec.unit ?? "";
  if (!spec.unit) unit.style.display = "none";
  readout.append(digits, unit);

  // What the typed field opens on, and what a cancelled edit restores.
  let lastValue = spec.defaultValue;
  let lastAuto = false;

  // Typed entry: a click on the digits makes that span editable in place
  // (.vc-digits-edit, controlsTheme.ts; typedValue.ts says what the text
  // means). Enter, Tab or a click away commits through commit(); Escape
  // restores. Pointer-only: ringElements() walks the sliders and Enter and the
  // bare digits are taken, so no key is left to open it. While `editing`,
  // setReadout leaves the digits alone and refreshAuto skips the row, so a live
  // value can't overwrite what's typed.
  let editing = false;
  let openedText = "";
  digits.classList.add("vc-digits-typable");
  digits.title = "Click to type a value";
  digits.addEventListener("click", (e) => {
    // Never let el's click-to-focus-slider handler (below) pull focus out.
    e.stopPropagation();
    if (!editing) openEdit();
  });
  digits.addEventListener("blur", () => closeEdit(true));
  digits.addEventListener("keydown", (e) => {
    if (!editing) return;
    // Typing must not reach the panel's keys or the Set's pads.
    e.stopPropagation();
    if (e.key === "Enter" || e.key === "Tab" || e.key === "Escape") {
      e.preventDefault();
      closeEdit(e.key !== "Escape");
      slider.focus({ preventScroll: true });
    }
  });
  // Only characters parseTyped can read get in; anything else typed, pasted or
  // dropped is filtered (a comma becomes the point), and no line break or
  // formatting lands.
  digits.addEventListener("beforeinput", (e) => {
    if (e.inputType.startsWith("delete") || e.inputType.startsWith("history")) return;
    if (e.inputType === "insertCompositionText") return; // not cancelable; parseTyped judges the result
    const data = e.inputType === "insertText" ? e.data ?? "" : "";
    if (data && [...data].every((c) => allowedChar(c) && c !== ",")) return;
    e.preventDefault();
    insertTyped(data);
  });
  digits.addEventListener("paste", (e) => {
    e.preventDefault();
    insertTyped(e.clipboardData?.getData("text/plain") ?? "");
  });
  digits.addEventListener("drop", (e) => e.preventDefault());

  // ⚠ in the row's accent while a custom value is set (.vc-custom-mark). A
  // drawn triangle, not the character, which some systems render as a colour
  // emoji; drawn twice, the copy underneath blurred into the pulsing glow.
  let customMark: HTMLSpanElement | null = null;
  if (spec.custom) {
    const triangle = (cls: string) =>
      `<svg class="${cls}" width="12" height="11" viewBox="0 0 12 11" fill="none" aria-hidden="true">` +
      `<path d="M6 1 11 10H1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>` +
      `<path d="M6 4.2V6.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>` +
      `<circle cx="6" cy="8.3" r="0.65" fill="currentColor"/></svg>`;
    customMark = document.createElement("span");
    customMark.className = "vc-custom-mark";
    customMark.setAttribute("role", "img");
    customMark.setAttribute("aria-label", "Custom value");
    customMark.innerHTML = triangle("vc-custom-glow") + triangle("vc-custom-icon");
    customMark.style.display = "none";
    const reach = spec.custom.reach();
    customMark.title =
      "Custom value, past the slider's end. The scene wasn't tuned this far: if the picture breaks, drag the slider or press ↺." +
      (reach ? ` Typed values here go from ${spec.format(reach.lo)} to ${spec.format(reach.hi)}.` : "");
    readout.insertBefore(customMark, digits);
  }

  // Hoisted, so the listeners above can name them before display(), commit()
  // and clearOff() exist.
  function openEdit(): void {
    editing = true;
    // An "Off" readout is in the mono face; the field always opens on the number.
    openedText = spec.format(lastValue);
    setDigitsText(openedText);
    digits.style.cssText = digitsStyle;
    if (spec.unit) unit.style.display = "";
    digits.contentEditable = "true";
    // A phone's decimal pad has no minus key.
    digits.inputMode = spec.min < 0 ? "text" : "decimal";
    digits.classList.add("vc-digits-edit");
    digits.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(digits);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  function insertTyped(text: string): void {
    const clean = [...text].filter(allowedChar).join("").replace(/,/g, ".");
    const sel = getSelection();
    if (!clean || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!digits.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const node = document.createTextNode(clean);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function closeEdit(keep: boolean): void {
    if (!editing) return;
    editing = false;
    const text = digits.textContent ?? "";
    digits.contentEditable = "false";
    digits.classList.remove("vc-digits-edit");
    const sel = getSelection();
    if (sel && digits.contains(sel.anchorNode)) sel.removeAllRanges();
    // Unchanged text commits nothing: the readout is rounded, and writing it
    // back would round the real value off with it.
    if (keep && text !== openedText) commitTyped(text);
    else display(lastValue, lastAuto);
  }
  function commitTyped(text: string): void {
    const typed = parseTyped(text);
    if (typed === null) {
      // Emptying the field drops a custom value and the slider's stretch.
      if (spec.custom && text.trim() === "" && (spec.custom.get() ?? spec.custom.stretch()) !== undefined) {
        spec.custom.reset();
        display(spec.custom.resolve(), false);
      } else display(lastValue, lastAuto);
      return;
    }
    const custom = spec.custom?.fit(typed / (spec.typedScale ?? 1)) ?? null;
    clearOff();
    // A value typed past the slider's end moves the end there (customValues.ts's stretch).
    if (custom !== null) spec.custom!.stretchTo(custom);
    commitValue(
      custom ??
        fitTyped(typed, {
          min: spec.min,
          max: spec.max,
          step: isLog ? undefined : spec.step,
          scale: spec.typedScale,
          zeroAtMin: spec.zeroAtMin,
        }),
    );
  }
  // Every value the row's controls set goes through here. Past the slider's
  // range it is a custom value: the nearest end goes through commit() first
  // (Auto off, the store, the room and the pop-out, and what a reader that
  // doesn't know custom values falls back to), then the custom value over it.
  // Inside, a plain commit drops any custom value and keeps the stretch. An Off
  // stop's 0 counts as inside.
  function commitValue(v: number): void {
    const custom = spec.zeroAtMin && v <= 0 ? null : (spec.custom?.fit(v) ?? null);
    if (custom !== null) {
      commit(Math.min(spec.max, Math.max(spec.min, v)));
      spec.custom!.set(custom);
      display(custom, false);
      return;
    }
    spec.custom?.clear();
    commit(v);
  }

  const chip = document.createElement("button");
  chip.textContent = "A";
  chip.title = `Auto-tune ${spec.label} (A)`;
  chip.style.cssText = autoChipManualStyle(spec.accent);
  // Every row's A chip shares the one "auto" id (keyHints.ts), so a keys-list
  // hover/click (flashOn) and a held Shift's keycap reach all of them.
  chip.classList.add("vc-keycap-anchor");
  chip.dataset.key = "auto";
  chip.dataset.keycap = "A";
  if (!spec.auto) chip.style.display = "none";

  const offChip = document.createElement("button");
  offChip.textContent = "T";
  offChip.title = `Turn ${spec.label} off (T)`;
  offChip.style.cssText = autoChipManualStyle(spec.accent);
  offChip.classList.add("vc-keycap-anchor");
  offChip.dataset.key = "mute";
  offChip.dataset.keycap = "T";

  // "Only this" (driveSolo.ts). No hotkey: O stays the Solo view toggle.
  let onlyChip: HTMLButtonElement | null = null;
  if (spec.onlyThis) {
    const { sceneId, key } = spec.onlyThis;
    onlyChip = document.createElement("button");
    onlyChip.type = "button";
    onlyChip.textContent = "O";
    onlyChip.dataset.soloKey = `${sceneId}:${key}`;
    onlyChip.dataset.soloAccent = spec.accent;
    onlyChip.addEventListener("click", () => {
      const now = getDriveSolo();
      if (now && now.sceneId === sceneId && now.key === key) clearDriveSolo();
      else setDriveSolo(sceneId, key);
    });
    paintOnlyChip(onlyChip);
  }

  // visibility (not display) keeps the row from reflowing while dragging.
  const resetBtn = document.createElement("button");
  resetBtn.textContent = "↺";
  resetBtn.title = `Reset ${spec.label} (R)`;
  resetBtn.style.cssText = rowResetStyle;
  // Keycap is the shortcut key (R), not the glyph this button shows.
  resetBtn.classList.add("vc-keycap-anchor");
  resetBtn.dataset.key = "reset";
  resetBtn.dataset.keycap = "R";

  // Chip in `right` (leftmost, reads as a badge) plus a hover-revealed pill
  // strip below, outside .vc-hint (see the .vc-reads rule in controlsTheme.ts
  // for why). Both omitted without `reads`.
  const signalIndicator = spec.reads?.length
    ? createSignalStrip(
        spec.reads.map((r) => ({
          label: r.signal.label,
          description: r.signal.description,
          onReveal: r.onReveal,
        })),
        spec.accent,
      )
    : null;
  if (signalIndicator) right.appendChild(signalIndicator.chip);

  right.appendChild(readout);
  right.append(chip, offChip);
  if (onlyChip) right.appendChild(onlyChip);
  right.appendChild(resetBtn);
  if (spec.drivePanel) {
    const left = document.createElement("div");
    left.style.cssText = driveRowLeftStyle;
    // Room for the port at the row's left edge (controlsTheme.ts); a plain gap
    // leaves the port floating over the text.
    left.classList.add("vc-drive-row-left");
    spec.drivePanel.summary.classList.add("vc-drive-summary");
    left.append(label, spec.drivePanel.summary);
    left.addEventListener("click", (e) => {
      e.stopPropagation();
      spec.drivePanel!.onPin();
    });
    spec.drivePanel.port.addEventListener("click", (e) => {
      e.stopPropagation();
      spec.drivePanel!.onPin();
    });
    el.appendChild(spec.drivePanel.port);
    head.append(left, right);
  } else {
    head.append(label, right);
  }

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "vc-slider";
  slider.setAttribute("aria-label", spec.label);
  // The accent rides the row so the hover/focus highlight on title and track
  // shares it (controlsTheme.ts).
  el.style.setProperty("--vc-accent", spec.accent);
  const isLog = spec.mapping === "log";
  // Continuous: a declared `step` is the uniform's resolution, not a detent
  // (snapping made a 0..1 row jump in visible hops). Only a step of 1 or more
  // is a discrete control (integer counts).
  const discrete = !isLog && spec.step !== undefined && spec.step >= 1;
  if (isLog) {
    slider.min = "0";
    slider.max = "100";
  } else {
    slider.min = String(spec.min);
    slider.max = String(spec.max);
  }
  slider.step = discrete ? String(spec.step) : "any";
  if (spec.midi) {
    el.dataset.midiRow = "";
    slider.dataset.midiId = spec.midi.id;
    slider.dataset.midiLabel = spec.midi.label;
    if (!isLog && spec.step !== undefined) slider.dataset.midiStep = String(spec.step);
  }

  // The description, plus an auto takeover note below it only while auto holds
  // the row; an addition, so the description stays readable.
  const hint = document.createElement("div");
  hint.className = "vc-hint";
  const hintDesc = document.createElement("div");
  setHintText(hintDesc, spec.description ?? "");
  const hintAuto = document.createElement("div");
  hintAuto.className = "vc-hint-auto";
  hintAuto.textContent = AUTO_HOLDING_HINT;
  hint.append(hintDesc, hintAuto);

  // Linked-item ticks sit in a wrapper sized to the slider's box, not the whole
  // row. Built only when `linkedTicks` is defined (not merely empty), so
  // single-item rows never allocate it.
  let ticksWrap: HTMLElement | null = null;
  if (spec.linkedTicks !== undefined) {
    const sliderBox = document.createElement("div");
    sliderBox.style.cssText = "position: relative;";
    sliderBox.appendChild(slider);
    ticksWrap = document.createElement("div");
    ticksWrap.className = "vc-slider-ticks";
    ticksWrap.setAttribute("aria-hidden", "true");
    sliderBox.appendChild(ticksWrap);
    el.append(head, sliderBox, hint);
  } else {
    el.append(head, slider, hint);
  }
  if (signalIndicator) el.appendChild(signalIndicator.strip);
  if (spec.drivePanel) el.appendChild(spec.drivePanel.below);
  el.addEventListener("click", (e) => {
    // The pinned patch panel sits inside this row, so its clicks bubble here:
    // they keep their own focus, since pulling it to the slider (far above once
    // the panel is scrolled into view) scrolled the column under the pointer.
    // preventScroll for the same reason as wireHoverFocus.
    if (!spec.drivePanel?.below.contains(e.target as Node)) slider.focus({ preventScroll: true });
    if (spec.onCardPin && isCardPress(el, slider, e.target)) spec.onCardPin();
  });
  wireHoverFocus(el, slider);
  wireThumbMagnet(el, slider);
  wireSliderQuickJump(el, slider);

  // Log-mapped so the midpoint lands near defaultValue. With zeroAtMin,
  // position 0 is an explicit kill and the curve covers 1..100: a reserved
  // position makes the kill a deliberate stop, not one you land on by accident.
  function posToValue(pos: number): number {
    if (spec.zeroAtMin && pos <= 0) return 0;
    const loPos = spec.zeroAtMin ? 1 : 0;
    const t = (pos - loPos) / (100 - loPos);
    return spec.min * Math.pow(spec.max / spec.min, t);
  }
  function valueToPos(value: number): number {
    if (spec.zeroAtMin && value <= 0) return 0;
    const loPos = spec.zeroAtMin ? 1 : 0;
    const t = Math.log(value / spec.min) / Math.log(spec.max / spec.min);
    return loPos + t * (100 - loPos);
  }
  function sliderToValue(): number {
    return isLog ? posToValue(Number(slider.value)) : Number(slider.value);
  }
  function valueToSlider(value: number): number {
    return isLog ? valueToPos(value) : value;
  }

  // In place (liveText.ts): an Auto row repaints its readout every refresh,
  // and on Safari a click on a live number otherwise never opened typed entry.
  const setDigitsText = (text: string) => setLiveText(digits, text);

  function setReadout(value: number, muted: boolean): void {
    if (editing) return; // the digits are the typed field right now
    if (muted || (spec.zeroAtMin && value <= 0)) {
      setDigitsText("Off");
      digits.style.cssText = `${digitsTextStyle} color: ${FADER_OFF};`;
      unit.style.display = "none";
      return;
    }
    setDigitsText(spec.format(value));
    digits.style.cssText = digitsStyle;
    if (spec.unit) unit.style.display = "";
  }

  function setHint(auto: boolean): void {
    hintDesc.style.display = spec.description ? "" : "none";
    hintAuto.style.display = auto ? "" : "none";
    hint.style.display = spec.description || auto ? "" : "none";
  }

  // Same log/linear/zeroAtMin mapping as display()'s fill, so a linked tick
  // lands where a drag to that value would.
  function valueToPercent(value: number): number {
    const sliderValue = valueToSlider(value);
    const lo = Number(slider.min);
    const hi = Number(slider.max);
    const pct = hi > lo ? ((sliderValue - lo) / (hi - lo)) * 100 : 0;
    return Math.max(0, Math.min(100, pct));
  }

  // Seeded from the spec so a fresh selection with differing values shows them
  // before any edit.
  let linkedTicksData: readonly { value: number; colour?: string }[] = spec.linkedTicks ?? [];
  function renderTicks(): void {
    if (!ticksWrap) return;
    ticksWrap.replaceChildren();
    for (const t of linkedTicksData) {
      if (Math.abs(t.value - lastValue) <= 1e-6) continue;
      const tick = document.createElement("i");
      tick.className = "vc-slider-tick";
      tick.style.left = `${valueToPercent(t.value)}%`;
      if (t.colour) tick.style.setProperty("--c", t.colour);
      ticksWrap.appendChild(tick);
    }
  }

  // Non-null while muted (T): the value the next T restores, and where
  // display() holds the thumb. Any other write to the row forgets it via
  // clearOff(), so the chip never claims a stale restore point.
  let offStoredValue: number | null = null;

  function display(value: number, auto: boolean): void {
    lastValue = value;
    lastAuto = auto;
    // Muted: the setting runs at its floor but the thumb stays on the value a
    // second T restores, and the row greys out (.vc-row-off) rather than
    // sliding left.
    const muted = offStoredValue !== null && !auto;
    const shown = muted ? offStoredValue! : value;
    // A stretched slider (customValues.ts) spans its range plus the stretch and
    // any custom value; set before the value, which the input clamps. Linear
    // rows only: log rows never take a custom value outside a dev build.
    if (!isLog && spec.custom) {
      const span = sliderSpan(spec, spec.custom.stretch(), spec.custom.get());
      if (Number(slider.min) !== span.lo) slider.min = String(span.lo);
      if (Number(slider.max) !== span.hi) slider.max = String(span.hi);
    }
    slider.value = String(valueToSlider(shown));
    slider.style.setProperty("--vc-fill", `${valueToPercent(shown)}%`);
    el.classList.toggle("vc-row-off", muted);
    renderTicks();
    setReadout(value, muted);
    if (customMark) customMark.style.display = spec.custom!.get() !== undefined ? "inline-flex" : "none";
    // ↺ also stays while the slider is stretched: it is what shrinks it back.
    const changed = Math.abs(value - spec.defaultValue) > 1e-6 || spec.custom?.stretch() !== undefined;
    resetBtn.style.visibility = changed ? "visible" : "hidden";
    setHint(auto);
  }

  function refreshChip(): void {
    if (!spec.auto) return;
    const on = spec.auto.isEnabled();
    chip.style.cssText = on ? autoChipLitStyle(spec.accent) : autoChipManualStyle(spec.accent);
    setHint(on);
  }

  function refreshOffChip(): void {
    offChip.style.cssText = offStoredValue !== null ? offChipLitStyle : autoChipManualStyle(spec.accent);
  }
  function clearOff(): void {
    if (offStoredValue === null) return;
    offStoredValue = null;
    refreshOffChip();
  }

  let onCommit: (value: number) => void = () => {};
  function commit(value: number): void {
    display(value, false);
    onCommit(value);
    refreshChip();
    spec.onAutoToggled?.();
  }

  let dragging = false;
  slider.addEventListener("pointerdown", () => {
    dragging = true;
  });
  slider.addEventListener("pointerup", () => {
    dragging = false;
  });
  slider.addEventListener("pointercancel", () => {
    dragging = false;
  });
  slider.addEventListener("input", () => {
    clearOff();
    commitValue(sliderToValue());
  });
  resetBtn.addEventListener("click", () => {
    clearOff();
    spec.custom?.reset();
    commit(spec.defaultValue);
  });
  offChip.addEventListener("click", () => {
    if (offStoredValue !== null) {
      // Restores through commitValue, so a custom value comes back as one.
      const restore = offStoredValue;
      offStoredValue = null;
      commitValue(restore);
      refreshOffChip();
    } else {
      offStoredValue = sliderToValue();
      refreshOffChip();
      spec.custom?.clear(); // muted runs at the floor; the stretch stays
      commit(spec.zeroAtMin ? 0 : spec.min);
    }
  });

  if (spec.auto) {
    chip.addEventListener("click", () => {
      const auto = spec.auto!;
      const on = !auto.isEnabled();
      auto.toggle(on);
      if (on) {
        clearOff();
        // A custom value beats auto in resolve()'s precedence, so without this
        // the chip would light while the row stayed put. Auto stays inside the
        // slider's range, so the stretch goes too.
        spec.custom?.reset();
      }
      refreshChip();
      display(on ? auto.resolveLive() : auto.getManual(), on);
      spec.onAutoToggled?.();
    });
  }

  wireRowKeys(slider, {
    auto: spec.auto ? () => chip.click() : undefined,
    reset: () => resetBtn.click(),
    toggleOff: () => offChip.click(),
  });

  return {
    el,
    setValue(value: number): void {
      display(value, false);
    },
    onChange(cb: (value: number) => void): void {
      onCommit = cb;
    },
    /** Pulls the live auto value unless the row is being dragged or typed in. */
    refreshAuto(): void {
      if (!spec.auto || dragging || editing || !spec.auto.isEnabled()) return;
      display(spec.auto.resolveLive(), true);
    },
    refreshChip,
    /** Forgets the T restore point, for card-level Reset chips that write
     *  through setValue(). Call it BEFORE setValue(): display() renders the row
     *  muted while a restore point is held, and clearOff() only repaints the T
     *  chip. */
    clearOff,
    /** The live auto value if auto owns the row (resolveLive() already puts a
     *  custom value ahead of auto, autoTune.ts's resolve()), else a custom value
     *  ahead of the manual store. */
    sync(manualValue: () => number): void {
      refreshChip();
      if (spec.auto && spec.auto.isEnabled()) {
        // Drop the T restore point: otherwise the T chip stays lit and the next
        // T writes the stale value, taking the row off auto. The manual branch
        // keeps it: open() syncs every row, and a muted manual row must stay
        // muted.
        clearOff();
        display(spec.auto.resolveLive(), true);
      } else display(spec.custom?.get() ?? manualValue(), false);
    },
    /** Every drawn tick; no-op without `reads`. Per drawn tick to match the
     *  meters' "fills move every frame" rule (audioMeters.ts). */
    updateSignalPills(frame: FeatureFrame | null, anim: AnimFrame | null): void {
      if (!signalIndicator || !spec.reads) return;
      signalIndicator.update(
        spec.reads.map((r) => ({
          value: frame && anim ? r.signal.read(frame, anim) : 0,
          active: r.active(),
        })),
      );
    },
    /** Redraws with fresh values; appendSettingRow calls it after propagating
     *  its commit to linked settings, so a tick that just became equal vanishes
     *  at once. No-op without `linkedTicks`. */
    setLinkedTicks(ticks: readonly { value: number; colour?: string }[]): void {
      if (!ticksWrap) return;
      linkedTicksData = ticks;
      renderTicks();
    },
  };
}

interface ToggleRowSpec {
  label: string;
  accent: string;
  defaultValue: number;
  description?: string;
  get: () => number;
  set: (value: number) => void;
  /** Port, summary and sparkline as in createControlRow, so a trigger toggle can be wired to a signal like a slider row. */
  drivePanel?: { port: HTMLElement; summary: HTMLElement; below: HTMLElement; onPin: () => void };
}

/** A boolean setting's row: a pill toggle where the slider would be. Never
 *  auto-tunable (autoTune.ts: a toggle between two discrete states doesn't fit
 *  the glide model), so no A chip; T just flips it (wireRowKeys). */
function createToggleRow(spec: ToggleRowSpec): HTMLElement {
  const el = document.createElement("div");
  el.className = "vc-row";
  el.style.cursor = "pointer";

  const head = document.createElement("div");
  head.style.cssText = rowHeadStyle;
  const label = document.createElement("div");
  label.textContent = spec.label;
  label.className = "vc-label";
  label.style.cssText = rowLabelStyle;
  const right = document.createElement("div");
  right.style.cssText = rowRightStyle;
  const readout = document.createElement("span");
  readout.style.cssText = `${digitsTextStyle} color: #fff;`;
  const resetBtn = document.createElement("button");
  resetBtn.textContent = "↺";
  resetBtn.title = `Reset ${spec.label} (R)`;
  resetBtn.style.cssText = rowResetStyle;
  resetBtn.classList.add("vc-keycap-anchor");
  resetBtn.dataset.key = "reset";
  resetBtn.dataset.keycap = "R";
  right.append(readout, resetBtn);
  if (spec.drivePanel) {
    const dp = spec.drivePanel;
    const left = document.createElement("div");
    left.style.cssText = driveRowLeftStyle;
    left.classList.add("vc-drive-row-left");
    dp.summary.classList.add("vc-drive-summary");
    left.append(label, dp.summary);
    left.addEventListener("click", (e) => {
      e.stopPropagation();
      dp.onPin();
    });
    dp.port.addEventListener("click", (e) => {
      e.stopPropagation();
      dp.onPin();
    });
    el.appendChild(dp.port);
    head.append(left, right);
  } else {
    head.append(label, right);
  }

  const toggle = document.createElement("button");
  toggle.className = "vc-toggle";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-label", spec.label);
  el.style.setProperty("--vc-accent", spec.accent);

  const hint = document.createElement("div");
  hint.className = "vc-hint";
  setHintText(hint, spec.description ?? "");
  if (!spec.description) hint.style.display = "none";

  el.append(head, toggle, hint);
  if (spec.drivePanel) el.appendChild(spec.drivePanel.below);
  // Clicks inside the pinned patch panel keep their own focus (as a slider row's).
  el.addEventListener("click", (e) => {
    if (!spec.drivePanel?.below.contains(e.target as Node)) toggle.focus({ preventScroll: true });
  });
  wireHoverFocus(el, toggle);

  function apply(value: number): void {
    const on = value >= 0.5;
    toggle.setAttribute("aria-checked", String(on));
    readout.textContent = on ? "On" : "Off";
    resetBtn.style.visibility = Math.abs(value - spec.defaultValue) > 1e-6 ? "visible" : "hidden";
  }
  apply(spec.get());

  toggle.addEventListener("click", () => {
    const value = toggle.getAttribute("aria-checked") === "true" ? 0 : 1;
    apply(value);
    spec.set(value);
  });
  resetBtn.addEventListener("click", () => {
    apply(spec.defaultValue);
    spec.set(spec.defaultValue);
  });

  wireRowKeys(toggle, {
    reset: () => resetBtn.click(),
    toggleOff: () => toggle.click(),
  });

  return el;
}


function statusText(status: AudioStatus): string {
  switch (status.source) {
    case "mic":
      return status.sampleRate ? `Mic live · ${Math.round(status.sampleRate / 1000)}k` : "Mic live";
    case "display":
      return status.sampleRate ? `Screen live · ${Math.round(status.sampleRate / 1000)}k` : "Screen live";
    case "remote":
      return "Remote feed";
    case "synthetic":
      return "Synthetic";
    default:
      return "Waiting";
  }
}

const formatGain = (value: number) => value.toFixed(1);
const formatSetting = (value: number) => value.toFixed(2);

// ---- the panel -----------------------------------------------------------

export function createDeviceMenu(deps: DeviceMenuDeps): DeviceMenu {
  ensureControlsStyles();

  const root = document.createElement("div");
  root.className = "vc-root vc-scroll";

  // Leftmost; a compact card, so it isn't wired into the digit-block keyboard
  // jump (renumberBlocks/markBlock). Its controls are chip buttons plus the
  // Resolution slider, outside the Tab ring (ringElements() skips this column).
  const powerCard = createPowerCard({
    getPowerMode: deps.getPowerMode,
    onPowerModeChange: deps.onPowerModeChange,
    getQualityChoice: deps.getQualityChoice,
    onQualityChoiceChange: deps.onQualityChoiceChange,
    getPowerStatus: deps.getPowerStatus,
    isPreview: deps.isPreview,
    canResizePreview: deps.canResizePreview,
    getPreviewSize: deps.getPreviewSize,
    onPreviewSizeChange: deps.onPreviewSizeChange,
    getResolution: deps.getPreviewResolution,
    onResolutionChange: deps.onPreviewResolutionChange,
  });
  // The pop-out output's own Power card, shown only while an output window is
  // open; its status is what the output reports (net/outputSync.ts's
  // OutputRenderStatus).
  const outputPowerCard = createPowerCard(
    {
      getPowerMode: deps.getOutputPowerMode,
      onPowerModeChange: deps.onOutputPowerModeChange,
      getCastMode: deps.getOutputCastMode,
      onCastModeChange: deps.onOutputCastModeChange,
      getQualityChoice: deps.getOutputQualityChoice,
      onQualityChoiceChange: deps.onOutputQualityChoiceChange,
      getResolution: deps.getOutputResolution,
      onResolutionChange: deps.onOutputResolutionChange,
      getPowerStatus: () => {
        const s = deps.getOutputPowerStatus();
        return {
          mode: deps.getOutputPowerMode(),
          choice: deps.getOutputQualityChoice(),
          recommended: s?.recommended ?? "high",
          fps: s?.fps ?? 0,
          level: s ? s.level : null,
          maxLevel: s?.maxLevel ?? 0,
          fraction: s?.fraction ?? 1,
          standingDown: s?.standingDown ?? false,
          bufferWidth: s?.bufferWidth ?? 0,
          bufferHeight: s?.bufferHeight ?? 0,
          missedFrames: s?.missedFrames ?? null,
          longestGapMs: s?.longestGapMs ?? null,
          // The output window does not report these (net/outputSync.ts).
          cpuLoad: null,
          gpuMs: null,
          heapMb: null,
        };
      },
    },
    { title: "Output", foldId: "powerOutput" },
  );
  outputPowerCard.setVisible(false);
  let outputPowerShown = false;
  const powerCol = document.createElement("div");
  powerCol.className = "vc-power-col";
  powerCol.append(powerCard.el, outputPowerCard.el);

  // One card for the live spectrum and the band gains: bandFaders.ts draws the
  // faders over the bars, so what you tune and what you watch are the same
  // pixels. Always mounted (unlike the Scene card); per-scene fader values are
  // pushed in by refreshBandFaders on open() and after a Reset.
  const bandFaders = createBandFaders({
    onChange: (fader, gain) => deps.onBandGainChange(deps.currentSceneId(), fader, gain),
  });
  const spectrumStrip = bandFaders.strip;
  // The functions referenced below are hoisted declarations further down this
  // closure (patch-bay section); none is called until createDeviceMenu() has
  // finished, so referencing them early is safe. One bundle, shared by the
  // meters and the shaping column (shapingColumn.ts).
  // The real choice each jack element carries: its jackKey collapses beat-grid
  // divisions, and a drag needs the choice (registerJack, mountBandsJack).
  const jackChoices = new WeakMap<HTMLElement, DriveSourceChoice>();
  const jackPatch: AudioMetersDeps["patch"] = {
    usage: jackUsage,
    isShown: jackIsShown,
    isPinned: jackIsPinned,
    isPreview: jackFeedsPreview,
    isPinnedActive: jackIsPinnedActive,
    isPreviewActive: jackFeedsPreviewActive,
    previewIsActive: () => !!activePreview(),
    isSceneSource: jackIsSceneSource,
    describe: jackDescribe,
    onJackClick,
    onJackHover,
    registerJack: (el, choice) => jackChoices.set(el, choice),
  };
  const audioMeters = createAudioMeters({
    heatSettings: heatSettingRows,
    onLufsReset: deps.onLufsReset,
    onTap: deps.onTap,
    getSilenceGate: () => deps.getSilenceGate(),
    stemsMeasured: () => deps.stemsMeasured(),
    hitShape: {
      get: () => deps.getHitShape(),
      set: (partial) => deps.setHitShape(partial),
    },
    patch: jackPatch,
  });
  const shapingCol = createShapingColumn({
    patch: jackPatch,
    getReading: deps.getShapingReading,
    onStructureChanged: shapingStructureChanged,
    onLayout: scheduleCableRecompute,
    onNodePress: toggleNodePin,
    isNodePinned: (id) => pinnedNode === id,
  });

  const spectrumCol = document.createElement("div");
  spectrumCol.className = "vc-spectrum-col";

  const bandsResetChip = createChipButton("Reset", "Every fader back to 1×", () => {
    deps.onBandGainsReset(deps.currentSceneId());
    refreshBandFaders();
  });
  const bandsCard = createCard({
    title: "Bands",
    accent: BANDS_AMBER,
    right: bandsResetChip,
    foldId: "bands",
  });
  markBlock(bandsCard.title);

  const columnHead = document.createElement("div");
  columnHead.style.cssText = columnHeadStyle;
  const spectrumStatus = document.createElement("div");
  spectrumStatus.style.cssText = spectrumStatusStyle;
  const liveDot = document.createElement("div");
  liveDot.style.cssText = liveDotStyle(false);
  const statusLabel = document.createElement("div");
  statusLabel.style.cssText = statusTextStyle;
  spectrumStatus.append(liveDot, statusLabel);
  // One chip, two raw modes. Lit, the spectrum shows the raw mic signal: no
  // adaptive envelope (features.ts), no Bands gain. Sensitivity/Expansion are
  // not undone: they apply later, on the render path only (applySensitivity in
  // app.ts), after this strip is fed. The same click sets every meter row's raw
  // mode (audioMeters.ts's setRaw; its header says which rows change). The
  // halves differ: the spectrum's always differs while Auto-gain is on (the two
  // sides normalize against different windows, features.ts's autoGain doc); the
  // meters' half is a no-op once Smoothing (Input card) is Off, since eased
  // readings then equal raw.
  const rawChip = createChipButton("RAW", RAW_CHIP_TITLE, () => {
    const on = !spectrumStrip.showRaw();
    spectrumStrip.setShowRaw(on);
    audioMeters.setRaw(on);
    rawChip.style.cssText = on ? chipBtnLitStyle : chipBtnStyle;
  });
  // The heat lens (heat.ts). Off on every load.
  const heatChip = createChipButton("HEAT", HEAT_CHIP_TITLE, () => setHeatLens(!heatLensOn));
  heatChip.dataset.key = "heat";
  const headChips = document.createElement("div");
  headChips.style.cssText = "display: flex; gap: 6px; align-items: center;";
  headChips.append(heatChip, rawChip);
  columnHead.append(spectrumStatus, headChips);

  // In a .vc-row so it wakes (glow) on hover and focus-within like a slider row.
  const fadersRow = document.createElement("div");
  // vc-row-keep: opts out of .vc-patching's flat dim (controlsTheme.ts);
  // refreshSpectrumDriveHighlight dims by band range instead.
  fadersRow.className = "vc-row vc-row-keep";
  fadersRow.style.setProperty("--vc-accent", BANDS_AMBER);
  // Explains the sky-blue centroid marker spectrumStrip.ts's drawCentroidMarker
  // draws (same AUTO_SKY, so the swatch can't drift); same signal as the
  // Character card's Brightness trace (audioMeters.ts).
  const spectrumLegend = createTraceLegend([
    { color: AUTO_SKY, label: "Centroid", note: "where the spectrum's energy balances" },
  ]);
  fadersRow.append(bandFaders.el, spectrumLegend.el);
  // R/T on a focused fader, like every row; no A (faders have no auto weights).
  bandFaders.faders.forEach((el, i) => {
    wireRowKeys(el, {
      reset: () => bandFaders.reset(i),
      toggleOff: () => bandFaders.toggleOff(i),
    });
    wireHoverFocus(el, el);
  });

  // Hidden by default (in flow: the card grows while shown), revealed by
  // hover/focus/drag over fadersRow (refreshEqLayer's wiring) and forced hidden
  // while the pinned setting's patch has a Frequencies source (refreshLineMode).
  // refreshEqLayer is the one writer of eqLayer.style.display, so the two
  // conditions can't stomp each other.
  const fadersHint = document.createElement("div");
  fadersHint.style.cssText = eqHintStyle;
  fadersHint.textContent = FADER_HINT_TEXT;
  const eqLayer = document.createElement("div");
  eqLayer.append(bandFaders.readouts, fadersHint);
  eqLayer.style.display = "none";

  // ---- The patch bay (this file's header doc comment has the contract) ----

  /** Hover/keyboard focus: port lit only, no layout change. Written only by previewDrive(). */
  let preview: { sceneId: string; spec: SceneSetting } | null = null;
  /** An explicit click on a row's label/summary/port; expands its patch panel.
   *  One at a time; written only by togglePin(), Escape (onKeyDown), or a scene
   *  switch (renderSceneSettings's tail). */
  let pinned: { sceneId: string; spec: SceneSetting } | null = null;
  /** A pinned shaping node (shapingColumn.ts): its chain stays lit, and a click on an input jack makes it read that input. Never set together with `pinned`. */
  let pinnedNode: string | null = null;
  let hoverNode: string | null = null;
  // Solo's on/off (setSolo/applySolo); declared here because togglePin and
  // every pinned panel's Solo chip read it.
  let soloOn = false;
  // Wide layout's "+ Add by name" disclosure (buildAddChips). Kept here, not
  // per panel: adding a source rebuilds the panel, and a fresh `false` closed
  // the list under the pointer after every add. Session view state, like Solo.
  let addChipsOpen = false;
  // Declared up here: setSolo's cable-visibility refresh runs during construction.
  let isOpen = false;
  // Set by a mountRows dispose that removed the pinned row; consumed by the next mountRows.
  let pinHandoff: { family: string; param: string; other?: number } | null = null;
  /** The last non-null setting previewDrive got; unlike `preview` it survives
   *  the pointer leaving. A jack click with nothing pinned pins it and plugs
   *  in, rather than a bare toast. */
  let lastPreview: { sceneId: string; spec: SceneSetting } | null = null;
  /** The Bands card's line-drawing mode, derived from `pinned`'s patch by
   *  refreshLineMode() (only a pinned setting's panel can add/remove its line
   *  source), not from focus. A variable so update()'s per-tick overlay refresh
   *  knows which excess() to read without re-deriving. */
  let lineMode: { sceneId: string; spec: SceneSetting } | null = null;
  /** The pinned setting's DriveSetting as of its panel's last build; update()'s
   *  refresh compares against it to notice an external change (a paired
   *  device's command) without rebuilding every tick (the click-loss rule).
   *  Null when nothing is pinned. */
  let lastPinnedSetting: DriveSetting | null = null;

  function samePair(a: { sceneId: string; spec: SceneSetting } | null, b: typeof a): boolean {
    return !!a && !!b && a.sceneId === b.sceneId && a.spec.key === b.spec.key;
  }

  const lineEditor = createBandLineEditor({
    onLineChange: (band, height) => {
      if (lineMode) deps.setDriveLineBand(lineMode.sceneId, lineMode.spec, band, height);
    },
    onStrengthChange: (value) => {
      if (lineMode) deps.setDriveLineStrength(lineMode.sceneId, lineMode.spec, value);
    },
  });
  lineEditor.el.style.display = "none";
  // Appended after the faders' hit divs, so it paints on top and captures every
  // pointer event over the strip while visible; the faders' handlers need no
  // suppression, only spectrumStrip.setShowFaders for the drawn markers.
  bandFaders.el.appendChild(lineEditor.el);
  // Also used in the pinned row's patch panel (buildSourceLine) for its line source.
  const clearLineChip = createChipButton("Clear line", "Erase the drawn line — every band is ignored again.", () => {
    if (!lineMode) return;
    deps.resetDriveLine(lineMode.sceneId, lineMode.spec);
    deps.setDriveLineStrength(lineMode.sceneId, lineMode.spec, LINE_STRENGTH_DEFAULT);
    lineEditor.setLine(deps.getDriveLine(lineMode.sceneId, lineMode.spec));
    lineEditor.setStrength(deps.getDriveLineStrength(lineMode.sceneId, lineMode.spec));
  });
  clearLineChip.dataset.hint = clearLineChip.title;
  // Static, so set once here, not per buildSourceLine() rebuild; the panel's
  // bottom hint line reads it off this element wherever it is appended.
  lineEditor.strengthRow.title = "How hard the drawn line drives the setting when bars rise above it.";
  lineEditor.strengthRow.dataset.hint = lineEditor.strengthRow.title;

  /** Called after every pin change and patch edit (patchChanged), never per tick. */
  function refreshLineMode(): void {
    const setting = pinned ? deps.getDriveSetting(pinned.sceneId, pinned.spec) : "scene";
    const hasLine = !!pinned && setting !== "scene" && setting.sources.some((s) => isLineSourceChoice(s.choice));
    if (hasLine && pinned) {
      const isNew = !samePair(lineMode, pinned);
      lineMode = { sceneId: pinned.sceneId, spec: pinned.spec };
      if (isNew) {
        spectrumStrip.setShowFaders(false);
        lineEditor.el.style.display = "";
        refreshEqLayer();
      }
      lineEditor.setLine(deps.getDriveLine(lineMode.sceneId, lineMode.spec));
      lineEditor.setStrength(deps.getDriveLineStrength(lineMode.sceneId, lineMode.spec));
    } else if (lineMode) {
      lineMode = null;
      spectrumStrip.setShowFaders(true);
      lineEditor.el.style.display = "none";
      refreshEqLayer();
    }
  }

  // ---- eqLayer's hover/focus/drag reveal (refreshEqLayer is the one writer of
  // its display). Hiding waits EQ_HIDE_DELAY_MS so a pointer crossing a knob
  // gap, or a quick refocus between faders, doesn't flash it off and on.
  let eqHovering = false;
  let eqFocused = false;
  let eqDragging = false;
  let eqHideTimer: ReturnType<typeof setTimeout> | null = null;
  const EQ_HIDE_DELAY_MS = 400;
  function refreshEqLayer(): void {
    if (eqHideTimer !== null) {
      clearTimeout(eqHideTimer);
      eqHideTimer = null;
    }
    const wantShown = eqHovering || eqFocused || eqDragging;
    if (!lineMode && wantShown) {
      eqLayer.style.display = "";
      return;
    }
    if (eqLayer.style.display === "none") return;
    if (lineMode) {
      // The drawing overlay needs the space now: hide at once.
      eqLayer.style.display = "none";
    } else {
      eqHideTimer = setTimeout(() => {
        eqHideTimer = null;
        eqLayer.style.display = "none";
      }, EQ_HIDE_DELAY_MS);
    }
  }
  // A finger has no hover: a press already shows the readouts (eqDragging
  // below), and showing them as the tap lands moved what was under it.
  fadersRow.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch") return;
    eqHovering = true;
    refreshEqLayer();
  });
  fadersRow.addEventListener("pointerleave", () => {
    eqHovering = false;
    refreshEqLayer();
  });
  // Keyboard focus only: wireHoverFocus also focuses a fader on plain pointer
  // movement, and that focus outlives the pointer; counting it would leave the
  // readouts up. pointerFocusOriginated is true exactly during that focus().
  fadersRow.addEventListener("focusin", () => {
    eqFocused = !pointerFocusOriginated;
    refreshEqLayer();
  });
  fadersRow.addEventListener("focusout", () => {
    eqFocused = false;
    refreshEqLayer();
  });
  fadersRow.addEventListener("pointerdown", (e) => {
    // The Frequencies jack sits in this row, but pressing it isn't a fader
    // drag: popping the readouts up under a tap cost the tap its click on
    // iPad Safari.
    if ((e.target as Element | null)?.closest(".vc-jack")) return;
    eqDragging = true;
    refreshEqLayer();
    const stopDrag = (): void => {
      eqDragging = false;
      refreshEqLayer();
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
  });

  // ---- The Bands card's own jacks: the Frequencies corner plus the Levels and
  // Stems rows below eqLayer. Built here, not via audioMeters.ts's mountJack,
  // because the Bands card lives in this file; they share the hoisted
  // onJackClick/onJackHover/jackIsShown with the meters' `patch` deps, so every
  // jack answers to identical logic. bandsJackEls is this card's half of the
  // cable layer's source-endpoint lookup (combinedJackElements).
  const bandsJackEls = new Map<string, HTMLElement>();
  function mountBandsJack(choice: DriveSourceChoice, host: HTMLElement, feedEl: HTMLElement): JackHandle {
    const jack = createJack(
      driveSourceColor(choice),
      () => onJackClick(choice),
      (on) => onJackHover(choice, on),
    );
    jackChoices.set(jack.el, choice);
    host.appendChild(jack.el);
    bandsJacks.push({ choice, jack, feedEl });
    bandsJackEls.set(jackKey(choice), jack.el);
    return jack;
  }
  const bandsJacks: { choice: DriveSourceChoice; jack: JackHandle; feedEl: HTMLElement }[] = [];

  const lineJack = mountBandsJack({ source: "line" }, fadersRow, fadersRow);
  lineJack.el.style.cssText += "position: absolute; top: 4px; right: 4px; z-index: 2;";

  interface LevelCell {
    choice: SignalId;
    read: (anim: AnimFrame) => number;
  }
  const BAND_LEVELS: readonly LevelCell[] = [
    { choice: "anim.low", read: (a) => a.low },
    { choice: "anim.mid", read: (a) => a.mid },
    { choice: "anim.high", read: (a) => a.high },
  ];
  // Lead and Hats (src/audio/stemSplit.ts) sit under the Mid and Treble rows
  // they cover; Bass stays empty.
  const STEM_LEVELS: readonly (LevelCell | null)[] = [
    null,
    { choice: "anim.lead", read: (a) => a.lead },
    { choice: "anim.hats", read: (a) => a.hats },
  ];
  const bandLevelRows: (LevelCell & { row: ReturnType<typeof createMeterRow> })[] = [];
  // Labels drop driveSourceLabel's " level" suffix (needed elsewhere to tell it
  // from a hit); the Levels caption already says it.
  function levelsGridRow(caption: string, cells: readonly (LevelCell | null)[]): HTMLElement {
    const label = document.createElement("div");
    label.textContent = caption;
    label.style.cssText = levelsLabelStyle;
    const grid = document.createElement("div");
    grid.style.cssText = levelsGridStyle;
    for (const cell of cells) {
      if (!cell) {
        grid.appendChild(document.createElement("div"));
        continue;
      }
      const row = createMeterRow({
        label: driveSourceLabel(cell.choice).replace(/ level$/, ""),
        accent: driveSourceColor(cell.choice),
      });
      row.el.style.cssText += levelsCellStyle;
      row.el.querySelector<HTMLElement>(".vc-label")!.style.cssText += levelsCellLabelStyle;
      const jack = mountBandsJack(cell.choice, row.right, row.el);
      // Heat (heat.ts), as for a meter card's signal jack.
      audioMeters.addHeatJack(cell.choice, jack.el, row.el, bandsCard.title.textContent ?? "", () => bandsCard.fold?.isFolded() ?? false);
      grid.appendChild(row.el);
      bandLevelRows.push({ ...cell, row });
    }
    const el = document.createElement("div");
    el.style.cssText = levelsRowStyle;
    el.append(label, grid);
    return el;
  }

  const stemsRow = levelsGridRow("Stems", STEM_LEVELS);
  const stemsOnScreen = watchOnScreen(stemsRow);
  bandsCard.body.append(fadersRow, eqLayer, levelsGridRow("Levels", BAND_LEVELS), stemsRow);

  // One at a time: set by buildPatchPanel() when the pinned row builds an
  // output graph, cleared by togglePin()/patchChanged() when there's nothing to
  // feed. update() calls through it rather than iterating rows, since only the
  // pinned row has a graph.
  let activeOutputTick: ((drives: SceneDrives, slots: number) => void) | null = null;

  // Every drive row appendSettingRow builds; reset at the top of
  // renderSceneSettings with sceneRowHandles (any rebuild remakes the Scene card).
  interface DriveRowHandle {
    sceneId: string;
    spec: SceneSetting;
    /** A cable's target endpoint (src/ui/cableLayer.ts). */
    portEl: HTMLElement;
    /** Jack-hover's highlight target (onJackHover). */
    rowEl: HTMLElement;
    refreshMeta(): void;
    refreshPin(): void;
    refreshPreviewLit(): void;
    rebuildIfPinned(): void;
    tickSparkline(drives: SceneDrives, frame: FeatureFrame | null, anim: AnimFrame | null, slots: number): void;
    refreshHeat(nowSec: number): void;
    tickHeatGlow(): void;
  }
  let driveRowHandles: DriveRowHandle[] = [];
  // "Only this" (driveSolo.ts) changes from any row's button or the scene
  // change in update(); the pinned panel shows the current label.
  // rebuildIfPinned() is a no-op except on the pinned row.
  onDriveSoloChange(() => {
    for (const h of driveRowHandles) h.rebuildIfPinned();
    for (const chip of document.querySelectorAll<HTMLElement>("[data-solo-key]")) paintOnlyChip(chip);
  });

  // Heat (heat.ts) for the current scene's wired settings and each wire (keyed
  // by jackKey), recorded every tick by recordHeat, panel open or closed, and
  // cleared on a scene change. All read the Dynamics card's span chip: the
  // Scene card has none of its own.
  const HEAT_SPAN_CARD = "signal";
  let heatSceneId: string | null = null;
  const settingHeat = new Map<string, HeatTrack>();
  const wireHeat = new Map<string, Map<string, HeatTrack>>();
  let wireHeatPips: { key: string; wireKey: string; pip: HeatPip }[] = [];
  // Each wired setting's live reading for the lens glow, relative to its
  // weight-1 line (the graph's dotted line), so one full-weight wire can light
  // it fully.
  const heatLive = new Map<string, number>();
  let heatLensOn = false;
  let lastHeatMs = -Infinity;

  const expansionTagText = (expansion: number, shapeIndex: number): string =>
    `Expansion ${expansion.toFixed(2)}×` + (shapeIndex > 0 ? ` · ${EXPANSION_SHAPE_NAMES[shapeIndex] ?? ""}` : "");

  // Peak-hold between graph samples: a hit is a one-tick spike that decays
  // right away, and a sample landing a tick or two after it drew a Fixed hit
  // (exactly 1) at 0.8-0.9, so peaks looked uneven. notePeaks() runs every
  // frame keeping the highest reading per setting (combined and per source);
  // the graph tick draws max(now, that), then the update loop clears it.
  const peakSeen = new Map<string, { v: number; src: number[]; before: number; after: number }>();
  function notePeaks(drives: SceneDrives): void {
    for (const h of driveRowHandles) {
      if (deps.getDriveSetting(h.sceneId, h.spec) === "scene") continue;
      const key = h.spec.key;
      let p = peakSeen.get(key);
      if (!p) {
        p = { v: 0, src: [], before: 0, after: 0 };
        peakSeen.set(key, p);
      }
      p.v = Math.max(p.v, drives.valueOf(key));
      const vals = drives.sourceValues(key);
      if (vals) for (let i = 0; i < vals.length; i++) p.src[i] = Math.max(p.src[i] ?? 0, vals[i]!);
      const pair = drives.expansionPair(key);
      if (pair) {
        p.before = Math.max(p.before, pair.before);
        p.after = Math.max(p.after, pair.after);
      }
    }
  }
  const heldValue = (key: string, now: number): number => Math.max(now, peakSeen.get(key)?.v ?? 0);
  const heldSource = (key: string, i: number, now: number): number => Math.max(now, peakSeen.get(key)?.src[i] ?? 0);
  const heldExpansion = (key: string, now: { before: number; after: number }): { before: number; after: number } => {
    const p = peakSeen.get(key);
    return { before: Math.max(now.before, p?.before ?? 0), after: Math.max(now.after, p?.after ?? 0) };
  };

  /** Every Scene-card row that can be pinned (drive or not), in document order:
   *  what togglePin refreshes, Tab walks (moveTabPin) and a rebuild re-finds
   *  the pin in. A non-drive row's refreshPin just toggles the
   *  .vc-drive-pinned ring, so Solo, its eye and Tab treat both alike. */
  interface PinRowHandle {
    sceneId: string;
    spec: SceneSetting;
    rowEl: HTMLElement;
    refreshPin(): void;
  }
  let pinRowHandles: PinRowHandle[] = [];
  // Every row's sparkline canvas, so renderSceneSettings can unobserve them
  // (driveCanvasRO) before discarding the old rows; otherwise the observer
  // holds a detached canvas per old row.
  let driveSparkCanvases: HTMLCanvasElement[] = [];

  // Canvases are sized only from ResizeObserver entries, never measured in a
  // draw (no per-tick layout reads); and the Scene card's rows are built while
  // the panel is still `display:none` (open() calls renderSceneSettings()
  // before adding vc-open), so a synchronous read would give zero.
  interface CanvasSize {
    w: number;
    h: number;
    onScreen: boolean;
  }
  const driveCanvasSizes = new WeakMap<HTMLCanvasElement, CanvasSize>();
  const driveCanvasRO = new ResizeObserver((entries) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const entry of entries) {
      const canvas = entry.target as HTMLCanvasElement;
      const size = driveCanvasSizes.get(canvas);
      if (!size) continue;
      size.w = entry.contentRect.width;
      size.h = entry.contentRect.height;
      canvas.width = Math.max(1, Math.round(size.w * dpr));
      canvas.height = Math.max(1, Math.round(size.h * dpr));
      canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  });
  // Which canvases are in view. Rows scrolled out of sight (or under a closed
  // panel) keep recording (tickSparkline) and skip only the draw, like the
  // meters' cards (audioMeters.ts). One observer for all, unobserved in
  // untrackDriveCanvas, since onScreen.ts's watchOnScreen can't stop watching
  // a row a rebuild drops.
  const driveCanvasIO =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
          for (const entry of entries) {
            const size = driveCanvasSizes.get(entry.target as HTMLCanvasElement);
            if (size) size.onScreen = entry.isIntersecting;
          }
        });
  /** The one fixed top of the drive graphs (row sparkline and "What it
   *  receives" graph): one source at the most weight it can have
   *  (DRIVE_WEIGHT_MAX) reading full scale, times the setting's gain. It never
   *  moves (not with a weight drag, a plug or mute, or a peak), so a taller
   *  line always means more received. A weight-1 source peaks at `gain` (the
   *  dotted line); past the top clips. */
  function driveGraphTop(spec: SceneSetting): number {
    return Math.max(1e-3, DRIVE_WEIGHT_MAX * (spec.drive?.gain ?? 1));
  }

  /** One tick of heat for wired settings and their wires, scaled by
   *  driveGraphTop like the row's sparkline. */
  function recordHeat(drives: SceneDrives | null, frame: FeatureFrame | null): void {
    const sceneId = deps.currentSceneId();
    if (sceneId !== heatSceneId) {
      heatSceneId = sceneId;
      settingHeat.clear();
      wireHeat.clear();
      heatLive.clear();
    }
    if (!drives || !frame) return;
    const nowSec = performance.now() / 1000;
    for (const spec of deps.getSceneSettings(sceneId)) {
      if (!spec.drive) continue;
      const setting = deps.getDriveSetting(sceneId, spec);
      if (setting === "scene") continue;
      const top = driveGraphTop(spec);
      let track = settingHeat.get(spec.key);
      if (!track) {
        track = createHeatTrack();
        settingHeat.set(spec.key, track);
      }
      const value = drives.valueOf(spec.key);
      track.push(value / top, frame.level, nowSec);
      heatLive.set(spec.key, value / (top / DRIVE_WEIGHT_MAX));
      if (!setting.sources.length) continue;
      const vals = drives.sourceValues(spec.key);
      if (!vals) continue;
      let wires = wireHeat.get(spec.key);
      if (!wires) {
        wires = new Map();
        wireHeat.set(spec.key, wires);
      }
      for (let i = 0; i < setting.sources.length && i < vals.length; i++) {
        const wireKey = jackKey(setting.sources[i]!.choice);
        let wire = wires.get(wireKey);
        if (!wire) {
          wire = createHeatTrack();
          wires.set(wireKey, wire);
        }
        wire.push(vals[i]! / top, frame.level, nowSec);
      }
    }
  }

  /** At most every HEAT_REFRESH_MS, from update(), while the Scene card is on screen and unfolded. */
  function refreshHeatPips(nowSec: number): void {
    const span = getHistorySpan(HEAT_SPAN_CARD);
    for (const h of driveRowHandles) h.refreshHeat(nowSec);
    for (const w of wireHeatPips) {
      if (!w.pip.el.isConnected) continue;
      w.pip.set(wireHeat.get(w.key)?.get(w.wireKey)?.read(span, nowSec) ?? null, span);
    }
  }

  /** The Heat history card's Settings group (audioMeters.ts's deps.heatSettings). */
  function heatSettingRows(): { label: string; track: HeatTrack }[] {
    const sceneId = deps.currentSceneId();
    const rows: { label: string; track: HeatTrack }[] = [];
    for (const spec of deps.getSceneSettings(sceneId)) {
      if (!spec.drive || deps.getDriveSetting(sceneId, spec) === "scene") continue;
      const track = settingHeat.get(spec.key);
      if (track) rows.push({ label: spec.label, track });
    }
    return rows;
  }

  /** The graphs' frame under their traces: a faint band over 0…top, a line at
   *  the top (driveGraphTop; a trace touching it is at the most the graph
   *  shows) and a dimmer one at 0. */
  function drawDriveGraphFrame(ctx: CanvasRenderingContext2D, w: number, yTop: number, yZero: number): void {
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    ctx.fillRect(0, yTop, w, yZero - yTop);
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.beginPath();
    ctx.moveTo(0, yTop);
    ctx.lineTo(w, yTop);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(0, yZero);
    ctx.lineTo(w, yZero);
    ctx.stroke();
  }

  function trackDriveCanvas(canvas: HTMLCanvasElement): CanvasSize {
    // Without the observer every canvas counts as in view.
    const size: CanvasSize = { w: 0, h: 0, onScreen: driveCanvasIO === null };
    driveCanvasSizes.set(canvas, size);
    driveCanvasRO.observe(canvas);
    driveCanvasIO?.observe(canvas);
    return size;
  }
  function untrackDriveCanvas(canvas: HTMLCanvasElement | null): void {
    if (!canvas) return;
    driveCanvasRO.unobserve(canvas);
    driveCanvasIO?.unobserve(canvas);
    driveCanvasSizes.delete(canvas);
  }

  /** Drops the scene's "Scene: " prefix and a leading "this scene's own ",
   *  since "Built-in: " already says both (docs/vocabulary.md). */
  function builtInText(spec: SceneSetting): string {
    return (spec.drive?.sceneLabel ?? "").replace(/^Scene:\s*/, "").replace(/^this scene's own\s+/, "");
  }

  /** Muted sources are left out of the list and folded into one "· N off"
   *  suffix (the Muting paragraph of drives.ts's header). */
  function driveSummaryText(spec: SceneSetting, setting: DriveSetting): string {
    if (setting === "scene") {
      const label = builtInText(spec);
      return label ? `Built-in: ${label}` : "Built-in";
    }
    if (!setting.sources.length) return "Nothing plugged in";
    const mutedCount = setting.sources.filter((s) => s.off).length;
    const suffix = mutedCount > 0 ? ` · ${mutedCount} off` : "";
    const live = setting.sources.filter((s) => !s.off);
    if (setting.mix === "gate" && setting.sources.length > 1) {
      const conditions = live.filter((s) => s.when);
      const plays = live.filter((s) => !s.when);
      const playsText = plays.length ? plays.map((s) => driveSourceLabel(s.choice)).join(" + ") : "Nothing";
      if (!conditions.length) return `${playsText}${suffix}`;
      const condText = conditions.map((s) => driveSourceLabel(s.choice)).join(" and ");
      const verb = conditions.length > 1 ? "are" : "is";
      return `${playsText}, only when ${condText} ${verb} high${suffix}`;
    }
    const names = live.map((s) => driveSourceLabel(s.choice));
    if (!names.length) return `Nothing playing${suffix}`;
    return `${names.join(setting.mix === "max" ? " or " : " + ")}${suffix}`;
  }

  /** The setting's default patch in a normal summary's words, so the hint reads
   *  as "this is what you'd get". */
  function driveDefaultSummary(spec: SceneSetting): string {
    return driveSummaryText(spec, defaultDriveSetting(spec));
  }

  /** Short form for the "Mixed — …" line, where every part must stay short. */
  function driveShortSummary(spec: SceneSetting, setting: DriveSetting): string {
    return setting === "scene" ? "Built-in" : driveSummaryText(spec, setting);
  }

  /** "Mixed — …" once linked siblings (registry.ts's `appendRow` `linked`
   *  option) disagree with `setting`: the drive-summary half of the multi-item
   *  bridge (tick marks are createControlRow's). Plain otherwise. */
  function driveSummaryForRow(sceneId: string, spec: SceneSetting, setting: DriveSetting): string {
    const entry = linkedByKey.get(spec.key);
    if (!entry?.linked.length) return driveSummaryText(spec, setting);
    const differs = entry.linked.some((l) => !sameDriveSetting(deps.getDriveSetting(sceneId, l.spec), setting));
    if (!differs) return driveSummaryText(spec, setting);
    return formatMixedSummary([
      { label: entry.ownLabel ?? spec.label, text: driveShortSummary(spec, setting) },
      ...entry.linked.map((l) => ({ label: l.label, text: driveShortSummary(l.spec, deps.getDriveSetting(sceneId, l.spec)) })),
    ]);
  }

  /** First plugged source's colour, SCENE_VIOLET for a "scene" mix with nothing
   *  plugged. Shared by drivePortStyle's glow and refreshMeta's --vc-pin-color
   *  (controlsTheme.ts), so a row's pinned/preview border matches its port. */
  function driveRowAccent(setting: DriveSetting): string {
    if (setting === "scene" || !setting.sources.length) return SCENE_VIOLET;
    return driveSourceColor(setting.sources[0]!.choice);
  }

  /** Pinned: solid glowing ring (the shown patch). Preview: a bare outline, a
   *  passing look (only a click expands the panel; see the header doc). */
  function drivePortStyle(setting: DriveSetting, state: "pinned" | "preview" | "none"): string {
    const ring =
      state === "pinned"
        ? `, 0 0 0 2px ${withAlpha("#ffffff", 0.6)}`
        : state === "preview"
          ? `, 0 0 0 1.5px ${withAlpha("#ffffff", 0.5)}`
          : "";
    if (setting === "scene") {
      return `border: 1.5px dashed rgba(255,255,255,0.45); background: transparent; box-shadow: 0 0 0 2px rgba(8,11,10,0.75)${ring};`;
    }
    const cols = setting.sources.map((s) => driveSourceColor(s.choice));
    const bg =
      cols.length <= 1
        ? (cols[0] ?? "rgba(255,255,255,0.3)")
        : `conic-gradient(${cols.map((c, i) => `${c} ${(i / cols.length) * 100}% ${((i + 1) / cols.length) * 100}%`).join(", ")})`;
    const glow = cols[0] ? withAlpha(cols[0], 0.55) : "transparent";
    return `border: 1.5px solid rgba(8,11,10,0.75); background: ${bg}; box-shadow: 0 0 0 2px rgba(8,11,10,0.75), 0 0 6px ${glow}${ring};`;
  }

  /** registry.ts's `WidgetCtx.portLook`: an unpinned port's look for one
   *  setting, or for several wired by one port: theirs if all receive the same,
   *  else every wire colour on a dashed ring ("mixed"). */
  function portLookFor(sceneId: string, specs: readonly SceneSetting[]): string {
    const settings = specs.map((s) => deps.getDriveSetting(sceneId, s));
    const first = settings[0];
    if (first === undefined) return drivePortStyle("scene", "none");
    if (settings.every((s) => sameDriveSetting(s, first))) return drivePortStyle(first, "none");
    const cols = [...new Set(settings.flatMap((s) => (s === "scene" ? [] : s.sources.map((x) => driveSourceColor(x.choice)))))];
    const bg = cols.length
      ? `conic-gradient(${cols.map((c, i) => `${c} ${(i / cols.length) * 100}% ${((i + 1) / cols.length) * 100}%`).join(", ")})`
      : "transparent";
    return `border: 1.5px dashed rgba(255,255,255,0.7); background: ${bg}; box-shadow: 0 0 0 2px rgba(8,11,10,0.75);`;
  }

  // ---- Patch-panel sub-builders: each wires its controls straight to `deps`;
  // patchChanged() is the one place a mutation is followed by a rebuild. ----

  /** `data-hint` is read by buildPatchPanel's bottom hint line off whichever
   *  control is hovered/focused (one delegated mechanism, no per-control
   *  listener); `aria-description` is for screen readers. No `title`: the
   *  native tooltip repeated the bottom line. Everything in the patch panel
   *  goes through this so the two never drift. */
  function setHint(el: HTMLElement, text: string): void {
    el.setAttribute("aria-description", text);
    el.dataset.hint = text;
  }

  const MIX_OPTIONS: { mix: DriveMix; label: string; hint: string }[] = [
    { mix: "add", label: "Add", hint: "Stack the wires: each adds its share, so together they push harder." },
    { mix: "max", label: "Strongest", hint: "Only the strongest wire at each moment counts — they don't stack." },
    {
      mix: "gate",
      label: "Only when",
      hint: "Some wires play, but only while the condition is high — e.g. treble hits, only when the song is intense.",
    },
  ];

  // Only on a plain Beat wave source line (buildSourceLine); other sources
  // ignore DriveSource.every (drives.ts).
  const EVERY_OPTIONS: readonly number[] = [1, 2, 4, 8, 16];
  const EVERY_HINT = "How many beats one swing takes: 1 = every beat, 4 = once a bar.";

  const ROLE_OPTIONS: { role: "plays" | "when"; label: string; hint: string }[] = [
    { role: "plays", label: "Plays", hint: "This wire makes the setting move." },
    {
      role: "when",
      label: "Only when",
      hint: "A condition: the playing wires only get through while this one is high. Mark more than one and every condition has to be high at once.",
    },
  ];
  const ROLE_REFUSE_HINT = "At least one wire has to play.";

  const GRID_CHIP_HINT: Record<number, string> = {
    1: "A pulse every half beat.",
    2: "A pulse on every beat.",
    3: "A pulse every other beat.",
    4: "A pulse at the start of every bar (4 beats).",
    5: "A pulse every two bars.",
  };

  function buildMixSeg(sceneId: string, spec: SceneSetting, patch: DrivePatch): HTMLElement {
    const seg = document.createElement("div");
    seg.style.cssText = driveSegStyle;
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Mix");
    for (const opt of MIX_OPTIONS) {
      const disabled = opt.mix === "gate" && patch.sources.length < 2;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt.label;
      btn.disabled = disabled;
      setHint(btn, disabled ? "Plug in a second input node to gate one against the other." : opt.hint);
      btn.setAttribute("aria-pressed", String(patch.mix === opt.mix));
      btn.style.cssText = disabled ? driveSegBtnDisabledStyle : patch.mix === opt.mix ? driveSegBtnLitStyle : driveSegBtnStyle;
      if (!disabled) {
        btn.addEventListener("click", () => {
          if (patch.mix === opt.mix) return;
          deps.onSetPatchMix(sceneId, spec, opt.mix);
          patchChanged(sceneId, spec);
        });
      }
      seg.appendChild(btn);
    }
    return seg;
  }

  function buildHeightSeg(sceneId: string, spec: SceneSetting, src: DriveSource): HTMLElement {
    const seg = document.createElement("div");
    seg.style.cssText = driveMiniSegStyle;
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Height");
    const current = src.height ?? "graded";
    for (const opt of HEIGHT_OPTIONS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt.label;
      setHint(btn, opt.hint);
      btn.setAttribute("aria-pressed", String(current === opt.h));
      btn.style.cssText = current === opt.h ? driveMiniSegBtnLitStyle : driveMiniSegBtnStyle;
      btn.addEventListener("click", () => {
        if (current === opt.h) return;
        deps.onSetSourceHeight(sceneId, spec, src.choice, opt.h);
        patchChanged(sceneId, spec);
      });
      seg.appendChild(btn);
    }
    return seg;
  }

  /** A visible "Every" label (the numbers alone don't say what they count) plus
   *  a row of chips, one per EVERY_OPTIONS value. Only for a plain Beat wave
   *  source line. */
  function buildEverySeg(sceneId: string, spec: SceneSetting, src: DriveSource): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = `display: flex; align-items: center; gap: 6px;`;
    setHint(wrap, EVERY_HINT);
    const label = document.createElement("span");
    label.style.cssText = driveDrawHintStyle + " white-space: nowrap;";
    label.textContent = "Every";
    const seg = document.createElement("div");
    seg.style.cssText = driveMiniSegStyle;
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Every how many beats");
    const current = src.every ?? 1;
    for (const n of EVERY_OPTIONS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = String(n);
      setHint(btn, EVERY_HINT);
      btn.setAttribute("aria-pressed", String(current === n));
      btn.style.cssText = current === n ? driveMiniSegBtnLitStyle : driveMiniSegBtnStyle;
      btn.addEventListener("click", () => {
        if (current === n) return;
        deps.onSetSourceEvery(sceneId, spec, src.choice, n);
        patchChanged(sceneId, spec);
      });
      seg.appendChild(btn);
    }
    wrap.append(label, seg);
    return wrap;
  }

  /** The Only when role toggle (drives.ts's setSourceRole), on every source
   *  line while gating. Both halves are clickable independently: marking this
   *  line "when" never touches another line's role. "Only when" disables itself
   *  (ROLE_REFUSE_HINT) on the one line whose marking would leave zero "plays"
   *  sources, mirroring drives.ts's refusal instead of a click visibly doing
   *  nothing. `index` is the source's position in `patch.sources`. */
  function buildRoleToggle(sceneId: string, spec: SceneSetting, patch: DrivePatch, index: number): HTMLElement {
    const seg = document.createElement("div");
    seg.style.cssText = driveMiniSegStyle;
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Role");
    const isCondition = !!patch.sources[index]!.when;
    const wouldRefuse = !isCondition && !patch.sources.some((s, i) => i !== index && !s.when);
    for (const opt of ROLE_OPTIONS) {
      const pressed = (opt.role === "when") === isCondition;
      const disabled = opt.role === "when" && wouldRefuse && !pressed;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt.label;
      btn.disabled = disabled;
      setHint(btn, disabled ? ROLE_REFUSE_HINT : opt.hint);
      btn.setAttribute("aria-pressed", String(pressed));
      btn.style.cssText = disabled ? driveMiniSegBtnDisabledStyle : pressed ? driveMiniSegBtnLitStyle : driveMiniSegBtnStyle;
      if (!disabled) {
        btn.addEventListener("click", () => {
          if (pressed) return;
          deps.onSetSourceRole(sceneId, spec, index, opt.role);
          patchChanged(sceneId, spec);
        });
      }
      seg.appendChild(btn);
    }
    return seg;
  }

  function buildGridChips(sceneId: string, spec: SceneSetting, src: DriveSource): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = driveGridChipsStyle;
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Beat grid division");
    const current = typeof src.choice === "object" && src.choice.source === "beat" ? src.choice.grid : 2;
    for (let i = 1; i < BEAT_GRIDS.length; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = driveGridDivisionLabel(i);
      const hint = GRID_CHIP_HINT[i] ?? "";
      setHint(btn, hint);
      btn.setAttribute("aria-pressed", String(current === i));
      btn.style.cssText = current === i ? driveChipLitStyle(DRIVE_WHITE) : driveChipStyle;
      btn.addEventListener("click", () => {
        if (current === i) return;
        deps.onSetSourceGrid(sceneId, spec, i as BeatGridIndex);
        patchChanged(sceneId, spec);
      });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  const WEIGHT_HINT = "This wire's share: 0 ignores it, 1× is normal, 2× doubles it.";

  const GENERIC_THRESHOLD_HINT =
    "A window on this wire. Each dotted line runs from nothing at 0 to the wire's recent peak at 1: the low one is Min, the high one Max. Under Min counts as nothing, over Max counts as full, and in between rises in a straight line, so Min 0 and Max 1 pass the wire through as it is. Off: everything passes as it is.";

  const HIT_THRESHOLD_HINT =
    "Moves the dotted line: how far a hit has to stand out from the everyday ones to count. Left: more reactions, even from quiet sounds. Right: only clear standouts. Off: every hit counts.";

  const READOUT_OPTIONS: { readout: HitReadout; label: string; hint: string }[] = [
    { readout: "flat", label: "Flat", hint: "Every hit that counts gets the full reaction, however much it stood out." },
    {
      readout: "sized",
      label: "Sized",
      hint: "Each reaction is as big as its hit stood out: a hit that only just clears the dotted line gets a small one. With the threshold Off, as big as the hit itself.",
    },
  ];

  const GENERIC_SMOOTHNESS_HINT =
    "How gently the window starts and ends. Left: exactly at the two lines. Right: a softer rise that stretches toward nothing and toward the loudest the wire has been, while silence still gives nothing and the loudest still gives full. Off: exactly at the two lines, whatever the slider says.";

  /** 0..1 slider for how far the window softens (driveStore.ts's
   *  getDriveSmoothness; the formula is gateWindow.ts's windowReading), with
   *  its own On/Off and, in a dev build, a formula picker. Live-write, no
   *  rebuild, as buildThresholdRow. */
  function buildSmoothnessRow(sceneId: string, spec: SceneSetting, onLiveEdit: () => void): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = `display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap;`;
    setHint(wrap, GENERIC_SMOOTHNESS_HINT);

    const seg = document.createElement("div");
    seg.style.cssText = driveMiniSegStyle;
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Smoothness on/off");
    const onBtn = document.createElement("button");
    onBtn.type = "button";
    onBtn.textContent = "On";
    const offBtn = document.createElement("button");
    offBtn.type = "button";
    offBtn.textContent = "Off";
    seg.append(onBtn, offBtn);

    const name = document.createElement("span");
    name.style.cssText = driveDrawHintStyle + " white-space: nowrap;";
    name.textContent = "Smoothness";
    const rng = document.createElement("input");
    rng.type = "range";
    rng.className = "vc-slider";
    rng.min = "0";
    rng.max = "1";
    rng.step = "0.01";
    rng.setAttribute("aria-label", "Smoothness");
    rng.style.cssText = driveWeightRangeStyle;
    const out = document.createElement("output");
    out.style.cssText = driveWeightOutStyle;

    const showValue = (v: number) => {
      rng.value = String(v);
      rng.style.setProperty("--vc-fill", `${v * 100}%`);
      out.textContent = v.toFixed(2);
    };
    const showOnOff = (on: boolean) => {
      onBtn.setAttribute("aria-pressed", String(on));
      offBtn.setAttribute("aria-pressed", String(!on));
      onBtn.style.cssText = on ? driveMiniSegBtnLitStyle : driveMiniSegBtnStyle;
      offBtn.style.cssText = !on ? driveMiniSegBtnLitStyle : driveMiniSegBtnStyle;
      rng.disabled = !on;
      rng.style.opacity = on ? "1" : "0.4";
      out.style.opacity = on ? "1" : "0.4";
    };
    showValue(deps.getDriveSmoothness(sceneId, spec));
    showOnOff(deps.getDriveSmoothnessOn(sceneId, spec));

    rng.addEventListener("input", () => {
      const v = Number(rng.value);
      showValue(v);
      deps.onSetDriveSmoothness(sceneId, spec, v);
      onLiveEdit();
    });
    onBtn.addEventListener("click", () => {
      if (onBtn.getAttribute("aria-pressed") === "true") return;
      deps.onSetDriveSmoothnessOn(sceneId, spec, true);
      showOnOff(true);
      onLiveEdit();
    });
    offBtn.addEventListener("click", () => {
      if (offBtn.getAttribute("aria-pressed") === "true") return;
      deps.onSetDriveSmoothnessOn(sceneId, spec, false);
      showOnOff(false);
      onLiveEdit();
    });

    wrap.append(seg, name, rng, out);
    // Dev only, while PR #544 picks Smoothness's formula (gateFormulas.ts's header).
    if (import.meta.env.DEV) {
      wrap.append(
        buildGateFormulaPicker(getGateFormula(sceneId, spec.key), (f) => {
          setGateFormula(sceneId, spec.key, f);
          onLiveEdit();
        }),
      );
    }
    return wrap;
  }

  /** On/Off + a labelled 0..1 slider under the graph (or where it would be with
   *  nothing plugged). Scene-handled (SceneSetting.drive.threshold) uses its own
   *  label/hint and starts on; every other drive setting uses the generic ones
   *  and starts off, gated by drives.ts's engine. A generic gate's row is a
   *  window: Min (the stored threshold) and Max (getDriveWindowMax), plus a
   *  Smoothness row (buildSmoothnessRow). Live-write, no rebuild, as
   *  buildWeightSlider. A generic window is built only while its gate is on
   *  (buildPatchPanel): shaping nodes own the window now, and this row is what
   *  a saved Look from before them still shows. */
  function buildThresholdRow(sceneId: string, spec: SceneSetting, onLiveEdit: () => void): HTMLElement {
    const declared = spec.drive?.threshold;
    const engineHit = isEngineHitDriver(spec);
    const generic = declared === undefined && !engineHit;
    const label = declared?.label ?? (generic ? "Window" : "Threshold");
    const hint = declared?.hint ?? (engineHit ? HIT_THRESHOLD_HINT : GENERIC_THRESHOLD_HINT);

    const wrap = document.createElement("div");
    wrap.style.cssText = `display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap;`;
    setHint(wrap, hint);

    const seg = document.createElement("div");
    seg.style.cssText = driveMiniSegStyle;
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", `${label} on/off`);
    const onBtn = document.createElement("button");
    onBtn.type = "button";
    onBtn.textContent = "On";
    const offBtn = document.createElement("button");
    offBtn.type = "button";
    offBtn.textContent = "Off";
    seg.append(onBtn, offBtn);

    const slider = (text: string, ariaLabel: string) => {
      const name = document.createElement("span");
      name.style.cssText = driveDrawHintStyle + " white-space: nowrap;";
      name.textContent = text;
      const rng = document.createElement("input");
      rng.type = "range";
      rng.className = "vc-slider";
      rng.min = "0";
      rng.max = "1";
      rng.step = "0.05";
      rng.setAttribute("aria-label", ariaLabel);
      rng.style.cssText = driveWeightRangeStyle;
      const out = document.createElement("output");
      out.style.cssText = driveWeightOutStyle;
      const show = (v: number) => {
        rng.value = String(v);
        rng.style.setProperty("--vc-fill", `${v * 100}%`);
        out.textContent = v.toFixed(2);
      };
      return { name, rng, out, show };
    };

    const main = generic ? slider("Min", "Window Min") : slider(label, label);
    const top = generic ? slider("Max", "Window Max") : undefined;
    const sliders = top ? [main, top] : [main];
    const smooth = generic ? buildSmoothnessRow(sceneId, spec, onLiveEdit) : undefined;

    const showOnOff = (on: boolean) => {
      onBtn.setAttribute("aria-pressed", String(on));
      offBtn.setAttribute("aria-pressed", String(!on));
      onBtn.style.cssText = on ? driveMiniSegBtnLitStyle : driveMiniSegBtnStyle;
      offBtn.style.cssText = !on ? driveMiniSegBtnLitStyle : driveMiniSegBtnStyle;
      for (const s of sliders) {
        s.rng.disabled = !on;
        s.rng.style.opacity = on ? "1" : "0.4";
        s.out.style.opacity = on ? "1" : "0.4";
      }
    };

    const state = deps.getDriveThresholdState(sceneId, spec);
    main.show(state.value);
    if (top) top.show(deps.getDriveWindowMax(sceneId, spec));
    showOnOff(state.on);

    if (top) {
      // Keep Min ≤ Max: dragging one past the other drags the other along.
      main.rng.addEventListener("input", () => {
        const v = Number(main.rng.value);
        main.show(v);
        deps.onSetDriveThreshold(sceneId, spec, v);
        if (v > Number(top.rng.value)) {
          top.show(v);
          deps.onSetDriveWindowMax(sceneId, spec, v);
        }
        onLiveEdit();
      });
      top.rng.addEventListener("input", () => {
        const v = Number(top.rng.value);
        top.show(v);
        deps.onSetDriveWindowMax(sceneId, spec, v);
        if (v < Number(main.rng.value)) {
          main.show(v);
          deps.onSetDriveThreshold(sceneId, spec, v);
        }
        onLiveEdit();
      });
    } else {
      main.rng.addEventListener("input", () => {
        const v = Number(main.rng.value);
        main.show(v);
        deps.onSetDriveThreshold(sceneId, spec, v);
        onLiveEdit();
      });
    }
    onBtn.addEventListener("click", () => {
      if (onBtn.getAttribute("aria-pressed") === "true") return;
      deps.onSetDriveThresholdOn(sceneId, spec, true);
      showOnOff(true);
      onLiveEdit();
    });
    offBtn.addEventListener("click", () => {
      if (offBtn.getAttribute("aria-pressed") === "true") return;
      deps.onSetDriveThresholdOn(sceneId, spec, false);
      showOnOff(false);
      onLiveEdit();
    });

    if (top) {
      // Min and Max each get a full line: side by side in the panel's column
      // they squeeze to their thumbs.
      const title = document.createElement("span");
      title.style.cssText = driveDrawHintStyle + " white-space: nowrap;";
      title.textContent = label;
      wrap.append(seg, title);
      for (const s of sliders) {
        const line = document.createElement("div");
        line.style.cssText = `display: flex; align-items: center; gap: 8px; flex: 1 1 100%; padding-left: 12px;`;
        s.name.style.minWidth = "26px";
        line.append(s.name, s.rng, s.out);
        wrap.append(line);
      }
    } else {
      wrap.append(seg, main.name, main.rng, main.out);
    }
    if (!smooth) return wrap;
    const column = document.createElement("div");
    column.style.cssText = `display: flex; flex-direction: column;`;
    column.append(wrap, smooth);
    return column;
  }

  /** A hit driver's Reaction row (SceneSetting.drive.hit): Flat or Sized, under
   *  the threshold row. A `flatOnly` setting shows Sized greyed out, the
   *  declaration's hint saying why. Live-write, no rebuild, as
   *  buildThresholdRow. */
  function buildReadoutRow(sceneId: string, spec: SceneSetting, onLiveEdit: () => void): HTMLElement | null {
    const hit = spec.drive?.hit;
    if (!hit) return null;
    const wrap = document.createElement("div");
    wrap.style.cssText = `display: flex; align-items: center; gap: 8px; margin-top: 6px;`;
    const name = document.createElement("span");
    name.style.cssText = driveDrawHintStyle + " white-space: nowrap;";
    name.textContent = "Reaction";
    const seg = document.createElement("div");
    seg.style.cssText = driveMiniSegStyle;
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Reaction");
    const buttons: { readout: HitReadout; btn: HTMLButtonElement; disabled: boolean }[] = [];
    const show = (current: HitReadout | undefined) => {
      for (const b of buttons) {
        const pressed = b.readout === current;
        b.btn.setAttribute("aria-pressed", String(pressed));
        b.btn.style.cssText = b.disabled ? driveMiniSegBtnDisabledStyle : pressed ? driveMiniSegBtnLitStyle : driveMiniSegBtnStyle;
      }
    };
    for (const opt of READOUT_OPTIONS) {
      const disabled = opt.readout === "sized" && hit.flatOnly !== undefined;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt.label;
      btn.disabled = disabled;
      setHint(btn, disabled ? hit.flatOnly! : opt.hint);
      if (!disabled) {
        btn.addEventListener("click", () => {
          if (deps.getDriveReadout(sceneId, spec) === opt.readout) return;
          deps.onSetDriveReadout(sceneId, spec, opt.readout);
          show(opt.readout);
          onLiveEdit();
        });
      }
      buttons.push({ readout: opt.readout, btn, disabled });
      seg.appendChild(btn);
    }
    show(deps.getDriveReadout(sceneId, spec));
    wrap.append(name, seg);
    return wrap;
  }

  function buildWeightSlider(sceneId: string, spec: SceneSetting, src: DriveSource, onLiveEdit: () => void): HTMLElement {
    const wrap = document.createElement("label");
    wrap.style.cssText = driveWeightWrapStyle;
    setHint(wrap, WEIGHT_HINT);
    const rng = document.createElement("input");
    rng.type = "range";
    rng.setAttribute("aria-description", WEIGHT_HINT);
    // The class gives the panel's shared track/thumb/fill CSS (controlsTheme.ts,
    // --vc-accent/--vc-fill) and a place in the Tab ring (ringElements());
    // without it this is the bare native control.
    rng.className = "vc-slider";
    rng.min = String(DRIVE_WEIGHT_MIN);
    rng.max = String(DRIVE_WEIGHT_MAX);
    rng.step = "0.05";
    rng.value = String(src.weight);
    rng.setAttribute("aria-label", `${driveSourceLabel(src.choice)} weight`);
    rng.style.cssText = driveWeightRangeStyle;
    rng.style.setProperty("--vc-accent", driveSourceColor(src.choice));
    const out = document.createElement("output");
    out.style.cssText = driveWeightOutStyle;
    const setFill = (w: number) => rng.style.setProperty("--vc-fill", `${(w / DRIVE_WEIGHT_MAX) * 100}%`);
    const setOut = (w: number) => (out.textContent = `${w.toFixed(2)}×`);
    setFill(src.weight);
    setOut(src.weight);
    // Live store write + readout per drag frame, no rebuild: buildPatchPanel()
    // would tear out the slider being dragged (the click-loss rule). The
    // snapshot moves with the write too: sameDriveSetting compares weights, so
    // a stale lastPinnedSetting would read the drag as an external change and
    // update()'s check would rebuild mid-drag.
    rng.addEventListener("input", () => {
      const w = Number(rng.value);
      setFill(w);
      setOut(w);
      deps.onSetSourceWeight(sceneId, spec, src.choice, w);
      if (samePair(pinned, { sceneId, spec })) lastPinnedSetting = deps.getDriveSetting(sceneId, spec);
      syncLinkedDriveSetting(sceneId, spec);
      onLiveEdit();
    });
    wrap.append(rng, out);
    return wrap;
  }

  const MUTE_HINT_ON = "Switch this wire off without unplugging it — its settings are kept.";
  const MUTE_HINT_OFF = "Switch this wire back on.";

  /** Lives in its own gutter column on every line, so alignment never depends
   *  on whether a line has one. Styled like `.vc-toggle` (controlsTheme.ts) at a
   *  compact size (`.vc-mute-switch`) without reusing the class: `.vc-toggle` is
   *  the Tab ring's selector (ringElements()), and a mute switch isn't meant to
   *  join it. */
  function buildMuteSwitch(sceneId: string, spec: SceneSetting, index: number, src: DriveSource): HTMLElement {
    const muted = !!src.off;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vc-mute-switch";
    btn.setAttribute("role", "switch");
    btn.setAttribute("aria-checked", String(!muted));
    btn.setAttribute("aria-label", `${driveSourceLabel(src.choice)} on/off`);
    btn.style.setProperty("--c", driveSourceColor(src.choice));
    setHint(btn, muted ? MUTE_HINT_OFF : MUTE_HINT_ON);
    btn.addEventListener("click", () => {
      deps.onSetSourceMuted(sceneId, spec, index, !muted);
      patchChanged(sceneId, spec);
    });
    return btn;
  }

  /** "+ Modifier": puts a new shaping node (shapingNodes.ts) on this catalogue
   *  wire and re-points the wire at it, so the picture doesn't change until the
   *  node is edited. The node takes the wire's Height, and the setting's window
   *  too when this is its only wire and the gate is on (the setting's own window
   *  then goes off). */
  function buildShapeButton(sceneId: string, spec: SceneSetting, src: DriveSource): HTMLElement {
    const choice = src.choice as SignalId;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.cssText = driveResetLinkStyle;
    btn.textContent = "+ Modifier";
    btn.setAttribute("aria-label", `Put a modifier on ${driveSourceLabel(src.choice)}`);
    setHint(btn, "Put a modifier on this wire: it reads the same until you change the modifier.");
    btn.addEventListener("click", () => {
      const setting = deps.getDriveSetting(sceneId, spec);
      if (setting === "scene") return;
      const generic = spec.drive?.threshold === undefined && !isEngineHitDriver(spec);
      const gate = deps.getDriveThresholdState(sceneId, spec);
      // The setting's own window moves into the node only when this is its only wire.
      const carryGate = generic && gate.on && setting.sources.length === 1;
      const node = addShapingNode(choice, {
        height: src.height ?? "graded",
        windowOn: carryGate,
        ...(carryGate
          ? {
              min: gate.value,
              max: deps.getDriveWindowMax(sceneId, spec),
              smoothOn: deps.getDriveSmoothnessOn(sceneId, spec),
              smoothness: deps.getDriveSmoothness(sceneId, spec),
            }
          : {}),
      });
      if (!node) {
        showToast("No room for another modifier");
        return;
      }
      deps.onSetDriveSetting(sceneId, spec, shapeSource(setting, src.choice, node.id));
      if (carryGate) deps.onSetDriveThresholdOn(sceneId, spec, false);
      patchChanged(sceneId, spec);
      showToast(`This wire now runs through ${shapingNodeLabel(node.id)}`);
    });
    return btn;
  }

  function buildSourceLine(
    sceneId: string,
    spec: SceneSetting,
    patch: DrivePatch,
    src: DriveSource,
    i: number,
    onLiveEdit: () => void,
  ): HTMLElement {
    const isGate = patch.mix === "gate" && patch.sources.length > 1;
    const isCondition = isGate && !!src.when;
    const muted = !!src.off;
    const line = document.createElement("div");
    line.style.cssText = driveSrcLineStyle;
    line.classList.toggle("vc-drive-src-muted", muted);

    // The condition marker is a gutter column, not border+padding on the line,
    // so dots/names/controls align regardless of role.
    const gutter = document.createElement("span");
    gutter.style.cssText = driveSrcGutterStyle;
    gutter.classList.toggle("vc-drive-gutter-cond", isCondition);

    const muteBtn = buildMuteSwitch(sceneId, spec, i, src);

    const dot = document.createElement("span");
    dot.style.cssText = driveSrcDotStyle(driveSourceColor(src.choice));
    const name = document.createElement("div");
    name.style.cssText = driveSrcNameStyle;
    name.textContent = driveSourceLabel(src.choice);
    const wireKey = jackKey(src.choice);
    const wirePip = createHeatPip(name);
    name.appendChild(wirePip.el);
    wireHeatPips.push({ key: spec.key, wireKey, pip: wirePip });
    const heatSpan = getHistorySpan(HEAT_SPAN_CARD);
    wirePip.set(wireHeat.get(spec.key)?.get(wireKey)?.read(heatSpan, performance.now() / 1000) ?? null, heatSpan);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.style.cssText = driveSrcRemoveStyle;
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Unplug ${driveSourceLabel(src.choice)}`);
    setHint(removeBtn, "Unplug this wire.");
    removeBtn.addEventListener("click", () => {
      deps.onTogglePatchSource(sceneId, spec, src.choice);
      patchChanged(sceneId, spec);
    });

    const ctrls = document.createElement("div");
    ctrls.style.cssText = driveSrcCtrlsStyle;
    if (isGate) ctrls.appendChild(buildRoleToggle(sceneId, spec, patch, i));
    // Fixed/Loud height only mean something for a hit-kind source: an
    // edge-kind catalogue entry or a beat grid (drives.ts's header).
    const isHitKind = isGridSourceChoice(src.choice) || (typeof src.choice === "string" && SIGNALS[src.choice].kind === "edge");
    // Only a wire still carrying an old Fixed/Loud shows Height; nodes own it
    // now (the engine still honours it).
    if (isHitKind && src.height !== undefined && src.height !== "graded") ctrls.appendChild(buildHeightSeg(sceneId, spec, src));
    // Every-N-beats only means something for a plain Beat wave (DriveSource.every).
    if (src.choice === "anim.beatWave") ctrls.appendChild(buildEverySeg(sceneId, spec, src));
    if (isGridSourceChoice(src.choice)) ctrls.appendChild(buildGridChips(sceneId, spec, src));
    if (isLineSourceChoice(src.choice)) {
      lineEditor.strengthRow.style.flex = "1 1 160px";
      ctrls.append(lineEditor.strengthRow, clearLineChip);
      const drawHint = document.createElement("span");
      drawHint.style.cssText = driveDrawHintStyle;
      drawHint.textContent = "Draw on the spectrum.";
      ctrls.appendChild(drawHint);
    } else {
      // A catalogue wire can take a node, except a Beat wave on an every-N
      // divider: shapeSource would drop that divider (DriveSource.every).
      if (typeof src.choice === "string" && !(src.choice === "anim.beatWave" && src.every !== undefined && src.every !== 1)) {
        ctrls.appendChild(buildShapeButton(sceneId, spec, src));
      }
      ctrls.appendChild(buildWeightSlider(sceneId, spec, src, onLiveEdit));
    }

    line.append(gutter, muteBtn, dot, name, removeBtn, ctrls);
    return line;
  }

  function buildAddChips(sceneId: string, spec: SceneSetting, patch: DrivePatch): HTMLElement {
    const wrap = document.createElement("div");
    // Always open in the stacked layout (jacks are far away there). A one-time
    // check, not a resize listener: the panel is rebuilt on every patch edit
    // anyway, and a breakpoint crossing mid-edit is too rare to chase.
    const stacked = window.matchMedia(`(max-width: ${STACK_BELOW_PX}px)`).matches;
    let groupsHost = wrap;
    if (!stacked) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.style.cssText = driveAddDisclosureStyle;
      toggle.textContent = "+ Add by name";
      groupsHost = document.createElement("div");
      // A style toggle, not `hidden`: driveAddGroupsStyle sets an inline
      // `display`, which outranks the UA's `[hidden] { display: none }`.
      const sync = () => {
        groupsHost.style.cssText = `${driveAddGroupsStyle} display: ${addChipsOpen ? "flex" : "none"};`;
        toggle.setAttribute("aria-expanded", String(addChipsOpen));
      };
      sync();
      toggle.addEventListener("click", () => {
        addChipsOpen = !addChipsOpen;
        sync();
      });
      wrap.append(toggle, groupsHost);
    } else {
      groupsHost.style.cssText = driveAddGroupsStyle;
    }
    for (const group of driveAddGroups()) {
      const row = document.createElement("div");
      row.style.cssText = driveAddGroupRowStyle;
      const label = document.createElement("b");
      label.style.cssText = driveAddGroupLabelStyle;
      label.textContent = group.label;
      row.appendChild(label);
      for (const choice of group.choices) {
        const isTempo = isGridSourceChoice(choice);
        const pressed = isTempo
          ? patch.sources.some((s) => isGridSourceChoice(s.choice))
          : patch.sources.some((s) => sourceKey(s.choice) === sourceKey(choice));
        const btn = document.createElement("button");
        btn.type = "button";
        // The Tempo chip is generic ("Beat grid"): which division plays is the
        // source line's division chips (buildGridChips).
        const chipLabel = isTempo ? "Beat grid" : driveSourceLabel(choice);
        btn.textContent = chipLabel;
        btn.setAttribute("aria-pressed", String(pressed));
        btn.style.cssText = pressed ? driveChipLitStyle(driveSourceColor(choice)) : driveChipStyle;
        // The line chip keeps its own longer instructions (LINE_HINT_TEXT); the
        // rest get "Plug <Source> in" plus driveSources.ts's description.
        setHint(btn, isLineSourceChoice(choice) ? LINE_HINT_TEXT : `Plug ${chipLabel} in — ${driveSourceDescription(choice)}`);
        btn.addEventListener("click", () => {
          // The Tempo chip toggles whichever grid source is present, not just
          // this division (driveSources.ts's DRIVE_ADD_GROUPS comment).
          const target = isTempo ? (patch.sources.find((s) => isGridSourceChoice(s.choice))?.choice ?? choice) : choice;
          deps.onTogglePatchSource(sceneId, spec, target);
          patchChanged(sceneId, spec);
        });
        row.appendChild(btn);
      }
      groupsHost.appendChild(row);
    }
    return wrap;
  }

  function buildOutputGraph(
    sceneId: string,
    spec: SceneSetting,
    patch: DrivePatch,
  ): { el: HTMLElement; canvas: HTMLCanvasElement; tick: (drives: SceneDrives, slots: number) => void } {
    const wrap = document.createElement("div");
    setHint(
      wrap,
      "The last 4 seconds, on a scale that never changes: the top line is one wire at full weight (higher clips), the bottom line 0, the dotted line across the middle one wire at weight 1. White: what this setting receives. Thin coloured lines: each wire (dashed: a condition). Violet: what the Master card's Expansion moved — solid where it pushed this setting up, hatched where it pulled it down; none at 1× with Even. Dark: the gate was closed. Other dotted lines and cyan dots, when shown: see the key under the graph.",
    );
    const head = document.createElement("div");
    head.style.cssText = driveOutHeadStyle;
    const eyebrow = document.createElement("span");
    eyebrow.style.cssText = driveEyebrowStyle;
    eyebrow.textContent = "What it receives · last 4 s";
    const val = document.createElement("span");
    val.style.cssText = driveOutValStyle;
    val.textContent = "0.00";
    head.append(eyebrow, val);
    const canvas = document.createElement("canvas");
    canvas.style.cssText = driveOutCanvasStyle;
    // Key for a scene's own marks (settingMarks.ts), shown only once the scene
    // has published some.
    const key = document.createElement("div");
    key.style.cssText = "display:none;gap:12px;margin-top:4px;font-size:11px;color:rgba(255,255,255,0.6);";
    const keyReaction = document.createElement("span");
    const keyReactionSwatch = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:rgba(110,235,225,0.95);margin-right:5px;vertical-align:0"></span>';
    const keyLine = document.createElement("span");
    const keyLineSwatch = '<span style="display:inline-block;width:14px;border-top:1px dotted rgba(255,255,255,0.7);margin-right:5px;vertical-align:3px"></span>';
    key.append(keyReaction, keyLine);
    wrap.append(head, canvas, key);
    const ctx = canvas.getContext("2d")!;
    const size = trackDriveCanvas(canvas);

    const RING = 120; // 4 s at 30 Hz
    const combined = new Float32Array(RING);
    const perSource = patch.sources.map(() => new Float32Array(RING));
    // Every marked condition draws dashed; `gateOpen` tracks the same
    // AND-of-smoothsteps combine()/fired() gate on (drives.ts's
    // GATE_OPEN_LOW/HIGH, reused), reduced to a bit per tick for the shading.
    const isGate = patch.mix === "gate";
    const conditionIdxs = isGate ? gateConditionIndices(patch) : [];
    const gateOpen = new Uint8Array(RING);
    // A scene's own reference lines and reactions (settingMarks.ts). Lines are
    // recorded per tick (a scene's line can move) and drawn as traces, labelled
    // at their latest point.
    const reactions = new Float32Array(RING);
    // Master Expansion's gap (drives.ts expansionPair): before/after, NaN on a
    // tick it passed the reading through.
    const expBefore = new Float32Array(RING).fill(NaN);
    const expAfter = new Float32Array(RING).fill(NaN);
    let expansionTag = "";
    const markTraces = new Map<string, Float32Array>();
    let ringHead = 0;
    let filled = 0;

    // Blocked time is darkened clearly (a faint wash over the open time read too
    // subtly on the synthetic feed), plus a thin lit-when-open strip along the
    // bottom edge, neutral white since several conditions may be marked.
    const BLOCKED_FILL = "rgba(0,0,0,0.4)";
    const STRIP_OPEN = "rgba(255,255,255,0.9)";
    const STRIP_BLOCKED = "rgba(255,255,255,0.16)";
    const STRIP_H = 3;
    const MARK_LINE = "rgba(255,255,255,0.55)";
    const MARK_REACTION = "rgba(110,235,225,0.9)";
    // Expansion's gap in the Master card's colour: solid where it pushed the
    // reading up, hatched where it pulled down.
    const EXP_UP = withAlpha(SCENE_VIOLET, 0.45);
    const EXP_DOWN = withAlpha(SCENE_VIOLET, 0.14);
    const EXP_HATCH = withAlpha(SCENE_VIOLET, 0.6);
    // The generic gate's lines have no scene to name them: one fixed label each,
    // both a `markTraces` key and the key row's text (Min line gateLine, Max
    // line gateTop).
    const GENERIC_GATE_LINE_LABEL = "below this counts as nothing";
    const GENERIC_GATE_TOP_LABEL = "above this counts as full";

    function draw(): void {
      const { w, h } = size;
      if (w <= 1 || h <= 1) return;
      ctx.clearRect(0, 0, w, h);
      const n = Math.min(filled, RING);
      if (n < 2) return;
      const xs = (k: number) => (k / (RING - 1)) * w;
      const at = (k: number) => (ringHead - RING + k + 1 + RING * 2) % RING;
      // driveGraphTop is fixed, so the trace never rescales; a mark line riding
      // above the signal clips at the top. `sourceValues()` and the generic
      // gate's line are un-gained (weight·value, drives.ts's header) while the
      // combined value and this top are gained, so every trace is scaled by
      // `gain` to share one axis (a 0.15-gain setting drew its source traces 7×
      // off the top).
      const gain = spec.drive?.gain ?? 1;
      const top = driveGraphTop(spec);
      const ys = (v: number) => h - 3 - Math.max(0, Math.min(1, v / top)) * (h - 6);
      drawDriveGraphFrame(ctx, w, ys(top), ys(0));

      if (isGate) {
        ctx.fillStyle = BLOCKED_FILL;
        let runStart = -1;
        for (let k = RING - n; k < RING; k++) {
          const blocked = gateOpen[at(k)] === 0;
          if (blocked && runStart < 0) runStart = k;
          if (!blocked && runStart >= 0) {
            ctx.fillRect(xs(runStart), 0, xs(k) - xs(runStart), h);
            runStart = -1;
          }
        }
        if (runStart >= 0) ctx.fillRect(xs(runStart), 0, xs(RING - 1) - xs(runStart), h);
      }

      for (let i = 0; i < patch.sources.length; i++) {
        if (patch.sources[i]!.off) continue;
        ctx.strokeStyle = withAlpha(driveSourceColor(patch.sources[i]!.choice), 0.65);
        ctx.lineWidth = 1;
        ctx.setLineDash(conditionIdxs.includes(i) ? [3, 3] : []);
        ctx.beginPath();
        for (let k = RING - n; k < RING; k++) {
          const idx = at(k);
          const x = xs(k);
          const y = ys(perSource[i]![idx]! * gain);
          if (k === RING - n) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = MARK_LINE;
      for (const trace of markTraces.values()) {
        ctx.beginPath();
        let penDown = false;
        for (let k = RING - n; k < RING; k++) {
          const v = trace[at(k)]!;
          if (!(v >= 0)) {
            penDown = false; // NaN = no line that tick
            continue;
          }
          if (penDown) ctx.lineTo(xs(k), ys(v));
          else ctx.moveTo(xs(k), ys(v));
          penDown = true;
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = MARK_LINE;
      ctx.beginPath();
      ctx.moveTo(0, ys(gain));
      ctx.lineTo(w, ys(gain));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `400 10px ${FONT_MONO}`;
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText(top.toFixed(top < 1 ? 2 : 1), 4, 3);

      const colW = w / (RING - 1);
      for (let k = RING - n; k < RING; k++) {
        const idx = at(k);
        const b = expBefore[idx]!;
        const a = expAfter[idx]!;
        if (!(Math.abs(a - b) > 0.004)) continue; // NaN or too small to see
        const x = xs(k);
        const yB = ys(b);
        const yA = ys(a);
        if (a > b) {
          ctx.fillStyle = EXP_UP;
          ctx.fillRect(x, yA, colW + 0.5, yB - yA);
        } else {
          ctx.fillStyle = EXP_DOWN;
          ctx.fillRect(x, yB, colW + 0.5, yA - yB);
          if (k % 3 === 0) {
            ctx.fillStyle = EXP_HATCH;
            ctx.fillRect(x, yB, 1, yA - yB);
          }
        }
      }
      if (expansionTag) {
        const tw = ctx.measureText(expansionTag).width;
        ctx.fillStyle = withAlpha(SCENE_VIOLET, 0.16);
        ctx.fillRect(w - tw - 12, 3, tw + 8, 14);
        ctx.fillStyle = SCENE_VIOLET;
        ctx.fillText(expansionTag, w - tw - 8, 5);
      }

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let k = RING - n; k < RING; k++) {
        const idx = at(k);
        const x = xs(k);
        const y = ys(combined[idx]!);
        if (k === RING - n) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // A reaction spanning several ticks (a slow climb) is one dot at the tick
      // it started, sized by its total, on the white line so it sits on the bump
      // that caused it.
      ctx.fillStyle = MARK_REACTION;
      for (let k = RING - n; k < RING; k++) {
        if (reactions[at(k)]! <= 0.01) continue;
        const start = k;
        let total = 0;
        while (k < RING && reactions[at(k)]! > 0.01) total += reactions[at(k++)]!;
        ctx.beginPath();
        ctx.arc(xs(start), ys(combined[at(start)]!), 1.5 + 4.5 * Math.sqrt(Math.min(1, total)), 0, Math.PI * 2);
        ctx.fill();
      }

      if (isGate) {
        const colW = Math.max(1, w / (RING - 1));
        let runStart = -1;
        let runOpen = true;
        for (let k = RING - n; k < RING; k++) {
          const open = gateOpen[at(k)] === 1;
          if (runStart < 0) {
            runStart = k;
            runOpen = open;
          } else if (open !== runOpen) {
            ctx.fillStyle = runOpen ? STRIP_OPEN : STRIP_BLOCKED;
            ctx.fillRect(xs(runStart), h - STRIP_H, xs(k) - xs(runStart), STRIP_H);
            runStart = k;
            runOpen = open;
          }
        }
        if (runStart >= 0) {
          ctx.fillStyle = runOpen ? STRIP_OPEN : STRIP_BLOCKED;
          ctx.fillRect(xs(runStart), h - STRIP_H, xs(RING - 1) - xs(runStart) + colW, STRIP_H);
        }
      }
    }

    /** `slots` is how many SPARKLINE_REFRESH_MS columns this call covers (more
     *  than 1 after a slow frame), so the x axis stays real time: the held peak
     *  lands in the first, the live reading fills the rest, and the scene's
     *  marks (taken once) land with the peak. */
    function tick(drives: SceneDrives, slots: number): void {
      const src = drives.sourceValues(spec.key);
      const now = drives.valueOf(spec.key);
      const v = heldValue(spec.key, now);
      const pairNow = drives.expansionPair(spec.key);
      const pairHeld = pairNow && heldExpansion(spec.key, pairNow);
      expansionTag = pairNow ? expansionTagText(deps.getSceneExpansion(), deps.getSceneExpansionShape()) : "";
      const marks = takeSettingMarks(sceneId, spec.key, "graph");
      // The generic gate's window (drives.ts's header): Min line gateLine, Max
      // line gateTop; undefined for a scene-handled setting (it draws its own
      // line through settingMarks.ts) or while the gate is off. Drawn dotted
      // like a scene's mark lines, one fixed label each so they get key entries.
      const gateLine = drives.gateLine(spec.key);
      const gateTop = drives.gateTop(spec.key);
      for (const line of marks?.lines ?? []) {
        if (!markTraces.has(line.label)) markTraces.set(line.label, new Float32Array(RING).fill(NaN));
      }
      if (gateLine !== undefined && !markTraces.has(GENERIC_GATE_LINE_LABEL)) {
        markTraces.set(GENERIC_GATE_LINE_LABEL, new Float32Array(RING).fill(NaN));
      }
      if (gateTop !== undefined && !markTraces.has(GENERIC_GATE_TOP_LABEL)) {
        markTraces.set(GENERIC_GATE_TOP_LABEL, new Float32Array(RING).fill(NaN));
      }
      let open = 1;
      if (isGate) {
        let anyCondition = false;
        for (const idx of conditionIdxs) {
          if (patch.sources[idx]!.off) continue; // muted condition — excluded from the AND, same as the engine
          anyCondition = true;
          open *= smoothstep(GATE_OPEN_LOW, GATE_OPEN_HIGH, src?.[idx] ?? 0);
        }
        if (!anyCondition) open = 1;
      }
      for (let s = 0; s < slots; s++) {
        const first = s === 0;
        ringHead = (ringHead + 1) % RING;
        for (let i = 0; i < perSource.length; i++) {
          const sv = src?.[i] ?? 0;
          perSource[i]![ringHead] = first ? heldSource(spec.key, i, sv) : sv;
        }
        combined[ringHead] = first ? v : now;
        const pair = first ? pairHeld : pairNow;
        expBefore[ringHead] = pair ? pair.before : NaN;
        expAfter[ringHead] = pair ? pair.after : NaN;
        for (const trace of markTraces.values()) trace[ringHead] = NaN;
        for (const line of marks?.lines ?? []) markTraces.get(line.label)![ringHead] = line.value;
        if (gateLine !== undefined) markTraces.get(GENERIC_GATE_LINE_LABEL)![ringHead] = gateLine * (spec.drive?.gain ?? 1);
        if (gateTop !== undefined) markTraces.get(GENERIC_GATE_TOP_LABEL)![ringHead] = gateTop * (spec.drive?.gain ?? 1);
        reactions[ringHead] = first ? (marks?.reaction ?? 0) : 0;
        if (isGate) gateOpen[ringHead] = open > 0.5 ? 1 : 0;
      }
      if (key.style.display === "none" && (marks || gateLine !== undefined)) {
        key.style.display = "flex";
        keyReaction.style.display = marks ? "" : "none"; // no reaction concept for the generic gate alone
        keyReaction.innerHTML = marks ? keyReactionSwatch : "";
        keyReaction.append(marks?.reactionLabel ?? "");
        const lineLabel = marks ? marks.lines[0]?.label : `${GENERIC_GATE_LINE_LABEL} · ${GENERIC_GATE_TOP_LABEL}`;
        keyLine.innerHTML = lineLabel ? `${keyLineSwatch}${lineLabel}` : "";
      }
      filled = Math.min(RING, filled + slots);
      val.textContent = v.toFixed(2);
      draw();
    }

    return { el: wrap, canvas, tick };
  }

  /** Rebuilds the pinned row's whole patch panel; only on a genuine patch edit
   *  (patchChanged) or a fresh pin, never from the periodic refresh or a
   *  slider's `input` event (the click-loss rule). */
  function buildPatchPanel(
    sceneId: string,
    spec: SceneSetting,
  ): { el: HTMLElement; outputCanvas: HTMLCanvasElement | null; tick: ((drives: SceneDrives, slots: number) => void) | null } {
    wireHeatPips = [];
    const setting = deps.getDriveSetting(sceneId, spec);
    const patch: DrivePatch = setting === "scene" ? { mix: "add", sources: [] } : setting;
    // Legacy window rows: a saved Look from before shaping nodes (buildThresholdRow).
    const generic = spec.drive?.threshold === undefined && !isEngineHitDriver(spec);
    const legacyWindow = generic && deps.getDriveThresholdState(sceneId, spec).on;

    const panel = document.createElement("div");
    panel.style.cssText = drivePatchPanelStyle;

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.style.cssText = driveResetLinkStyle;
    resetBtn.textContent = "Reset to scene default";
    setHint(resetBtn, `Back to how this scene starts — ${driveDefaultSummary(spec)}.`);
    resetBtn.addEventListener("click", () => {
      deps.onResetDriveSetting(sceneId, spec);
      patchChanged(sceneId, spec);
    });
    function refreshResetVisibility(): void {
      // A moved threshold counts too; the row's default is "on" for a
      // scene-handled gate, "off" for a generic one (driveStore.ts).
      const declared = spec.drive?.threshold;
      const thresholdState = spec.drive ? deps.getDriveThresholdState(sceneId, spec) : undefined;
      const thresholdMoved =
        !!thresholdState &&
        (thresholdState.on !== (declared !== undefined) || thresholdState.value !== (declared?.default ?? GENERIC_THRESHOLD_DEFAULT));
      const smoothnessMoved =
        !!spec.drive && declared === undefined && !isEngineHitDriver(spec) && (deps.getDriveSmoothness(sceneId, spec) !== GENERIC_SMOOTHNESS_DEFAULT || !deps.getDriveSmoothnessOn(sceneId, spec));
      const hit = spec.drive?.hit;
      const readoutMoved = !!hit && hit.flatOnly === undefined && deps.getDriveReadout(sceneId, spec) !== (hit.readout ?? "flat");
      resetBtn.hidden =
        !thresholdMoved && !smoothnessMoved && !readoutMoved && isDefaultDriveSetting(spec, deps.getDriveSetting(sceneId, spec));
    }

    const head = document.createElement("div");
    head.style.cssText = drivePatchHeadStyle;
    const eyebrow = document.createElement("span");
    eyebrow.style.cssText = driveEyebrowStyle;
    eyebrow.textContent = "Wires";
    // "Only this" (driveSolo.ts) is a local preview, not a wire edit, so it
    // skips patchChanged() (which copies the setting to linked rows).
    const soloNow = getDriveSolo();
    const isSolo = !!soloNow && soloNow.sceneId === sceneId && soloNow.key === spec.key;
    const soloBtn = document.createElement("button");
    soloBtn.type = "button";
    soloBtn.style.cssText = driveResetLinkStyle;
    soloBtn.textContent = isSolo ? "All back" : "Only this";
    soloBtn.setAttribute("aria-pressed", String(isSolo));
    setHint(
      soloBtn,
      isSolo
        ? "Switch every setting's reaction back on."
        : "Switch off every other setting's reaction, so only this one moves. Wires are kept; this screen only.",
    );
    soloBtn.addEventListener("click", () => {
      const now = getDriveSolo();
      if (now && now.sceneId === sceneId && now.key === spec.key) clearDriveSolo();
      else setDriveSolo(sceneId, spec.key);
    });
    head.append(eyebrow, soloBtn, buildMixSeg(sceneId, spec, patch));
    panel.appendChild(head);

    const list = document.createElement("div");
    list.style.cssText = driveSrcListStyle;
    if (setting === "scene") {
      // The built-in has no wire line, so it needs its own Unplug.
      const empty = document.createElement("div");
      empty.style.cssText = driveEmptySrcStyle;
      const builtIn = builtInText(spec);
      empty.textContent = builtIn
        ? `Built-in: ${builtIn}. Plug in an input node to replace it.`
        : "Built-in reaction. Plug in an input node to replace it.";
      const unplug = document.createElement("button");
      unplug.type = "button";
      unplug.style.cssText = driveResetLinkStyle;
      unplug.textContent = "Unplug";
      setHint(unplug, "Unplug the built-in reaction, so this setting doesn't react to the music.");
      unplug.addEventListener("click", () => {
        deps.onUnplugAll(sceneId, spec);
        patchChanged(sceneId, spec);
      });
      list.append(empty, unplug);
    } else if (!patch.sources.length) {
      const empty = document.createElement("div");
      empty.style.cssText = driveEmptySrcStyle;
      empty.textContent = "Nothing plugged in, so this doesn't react to the music. Plug in an input node, or reset to the scene default.";
      list.appendChild(empty);
    }
    patch.sources.forEach((src, i) => {
      list.appendChild(buildSourceLine(sceneId, spec, patch, src, i, refreshResetVisibility));
    });
    if (generic && patch.sources.some((s) => !isShapedChoice(s.choice))) {
      const shapeNote = document.createElement("div");
      shapeNote.style.cssText = driveEmptySrcStyle;
      shapeNote.textContent = "Window, Smoothness, Length and Height live on modifiers now. Press + Modifier on a wire to give it one.";
      list.appendChild(shapeNote);
    }
    panel.appendChild(list);
    panel.appendChild(buildAddChips(sceneId, spec, patch));

    let outputCanvas: HTMLCanvasElement | null = null;
    let tick: ((drives: SceneDrives, slots: number) => void) | null = null;
    if (patch.sources.length) {
      const graph = buildOutputGraph(sceneId, spec, patch);
      panel.appendChild(graph.el);
      outputCanvas = graph.canvas;
      tick = graph.tick;
    }
    if (!generic || legacyWindow) {
      if (legacyWindow) {
        const legacyNote = document.createElement("div");
        legacyNote.style.cssText = driveEmptySrcStyle;
        // Shape carries the window into the node only from a setting's only wire (buildShapeButton).
        legacyNote.textContent =
          patch.sources.length === 1
            ? "This setting's own window, from before modifiers. Press + Modifier on its wire to move it into a modifier."
            : "This setting's own window, from before modifiers. To move it, give its wires modifiers, set each one's window, then switch this Off.";
        panel.appendChild(legacyNote);
      }
      panel.appendChild(buildThresholdRow(sceneId, spec, refreshResetVisibility));
    }
    const readoutRow = buildReadoutRow(sceneId, spec, refreshResetVisibility);
    if (readoutRow) panel.appendChild(readoutRow);

    panel.appendChild(resetBtn);
    refreshResetVisibility();

    // Bottom hint line: one delegated listener set reads the hovered or
    // focused control's `data-hint`; never per-control, never touched by
    // refreshAuto/update(). Stacked, the jacks are far away, so the rest
    // hint points at the add-by-name chips.
    const stacked = window.matchMedia(`(max-width: ${STACK_BELOW_PX}px)`).matches;
    const restHint = stacked ? "Add an input node by name below." : "Click an input node's jack to plug it in or out.";
    const hintBar = document.createElement("div");
    hintBar.className = "vc-drive-bottom-hint";
    setHintText(hintBar, restHint);
    function hintedAncestor(target: EventTarget | null): HTMLElement | null {
      return target instanceof HTMLElement ? target.closest<HTMLElement>("[data-hint]") : null;
    }
    function leftHintedAncestor(el: HTMLElement, related: EventTarget | null): boolean {
      return !(related instanceof Node) || !el.contains(related);
    }
    panel.addEventListener("pointerover", (e) => {
      const el = hintedAncestor(e.target);
      if (el) setHintText(hintBar, el.dataset.hint!);
    });
    panel.addEventListener("pointerout", (e) => {
      const el = hintedAncestor(e.target);
      if (el && leftHintedAncestor(el, e.relatedTarget)) setHintText(hintBar, restHint);
    });
    panel.addEventListener("focusin", (e) => {
      const el = hintedAncestor(e.target);
      if (el) setHintText(hintBar, el.dataset.hint!);
    });
    panel.addEventListener("focusout", (e) => {
      const el = hintedAncestor(e.target);
      if (el && leftHintedAncestor(el, e.relatedTarget)) setHintText(hintBar, restHint);
    });
    panel.appendChild(hintBar);

    return { el: panel, outputCanvas, tick };
  }

  /** One drive-capable setting's port/summary/sparkline trio. appendSettingRow
   *  needs `port`/`summary` before the row exists and calls `bind(row.el)`
   *  after (the pinned highlight needs the element). */
  function buildDriveRow(
    sceneId: string,
    spec: SceneSetting,
  ): { port: HTMLElement; summary: HTMLElement; below: HTMLElement; bind: (rowEl: HTMLElement) => DriveRowHandle } {
    const port = document.createElement("button");
    port.type = "button";
    port.className = "vc-drive-port";
    const portTooltip = (): string[] => {
      if (deps.getDriveSetting(sceneId, spec) === "scene") return [port.title];
      const span = getHistorySpan(HEAT_SPAN_CARD);
      return [port.title, heatText(settingHeat.get(spec.key)?.read(span, performance.now() / 1000) ?? null, span)];
    };
    // Not for a finger, as a jack's (jack.ts): a tooltip mid-tap could cost
    // the tap its click on iPad Safari.
    port.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "touch") showTooltip(port, driveRowAccent(deps.getDriveSetting(sceneId, spec)), portTooltip());
    });
    port.addEventListener("pointerleave", hideTooltip);
    port.addEventListener("focus", () => showTooltip(port, driveRowAccent(deps.getDriveSetting(sceneId, spec)), portTooltip()));
    port.addEventListener("blur", hideTooltip);
    const summary = document.createElement("span");
    summary.style.cssText = driveSummaryStyle;

    const below = document.createElement("div");
    const sparkWrap = document.createElement("div");
    sparkWrap.style.cssText = driveSparkWrapStyle;
    const sparkCanvas = document.createElement("canvas");
    sparkCanvas.className = "vc-drive-spark";
    sparkCanvas.style.cssText = driveSparkCanvasStyle;
    const SPARK_TOOLTIP = "Live: what this setting is receiving (last 3 s). The top line is one wire at full weight; higher clips. Colour shows which wire is contributing most.";
    sparkCanvas.title = SPARK_TOOLTIP;
    sparkCanvas.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "touch") showTooltip(sparkCanvas, driveRowAccent(deps.getDriveSetting(sceneId, spec)), [SPARK_TOOLTIP]);
    });
    sparkCanvas.addEventListener("pointerleave", hideTooltip);
    sparkWrap.appendChild(sparkCanvas);
    const sparkCtx = sparkCanvas.getContext("2d")!;
    const sparkSize = trackDriveCanvas(sparkCanvas);
    driveSparkCanvases.push(sparkCanvas);
    const heatStrip = document.createElement("div");
    heatStrip.className = "vc-heat-strip";
    let heatStripBg = "";
    let heatColorNow = "";
    let heatGlowNow = -1;
    const patchContainer = document.createElement("div");
    patchContainer.className = "vc-drive-patch";
    patchContainer.style.display = "none";
    below.append(sparkWrap, heatStrip, patchContainer);

    const SPARK_LEN = 90; // ~3 s at 30 Hz
    const sparkVals = new Float32Array(SPARK_LEN);
    const sparkCols: string[] = new Array(SPARK_LEN).fill(DRIVE_WHITE);
    // The scene's own reactions (settingMarks.ts) under this view's "row"
    // slot: with any, the sparkline draws a dot per reaction over a dimmed trace.
    const sparkReact = new Float32Array(SPARK_LEN);
    let sparkHasMarks = false;
    let sparkHead = 0;
    let sparkFilled = 0;
    // Same fixed top as the panel's "What it receives" graph (driveGraphTop);
    // a Scene row's un-gained approximation drops the gain to match.
    let sparkTop = driveGraphTop(spec);
    let outputCanvas: HTMLCanvasElement | null = null;
    let boundRowEl: HTMLElement | null = null;

    function isPinned(): boolean {
      return samePair(pinned, { sceneId, spec });
    }

    function refreshMeta(): void {
      const setting = deps.getDriveSetting(sceneId, spec);
      const state: "pinned" | "preview" | "none" = isPinned()
        ? "pinned"
        : samePair(preview, { sceneId, spec })
          ? "preview"
          : "none";
      port.style.cssText = drivePortStyle(setting, state);
      port.title = isPinned()
        ? "Pinned — click again or press Esc to close."
        : "Click to pin this setting and choose what it listens to.";
      summary.textContent = driveSummaryForRow(sceneId, spec, setting);
      // --vc-pin-color: read by controlsTheme.ts; set even at "none" so it is
      // right the instant a class lands.
      boundRowEl?.style.setProperty("--vc-pin-color", driveRowAccent(setting));
    }

    function refreshHeat(nowSec: number): void {
      const wired = deps.getDriveSetting(sceneId, spec) !== "scene";
      heatStrip.hidden = !wired;
      boundRowEl?.classList.toggle("vc-heat-row", wired);
      if (!wired) return;
      const track = settingHeat.get(spec.key);
      const span = getHistorySpan(HEAT_SPAN_CARD);
      const bg = track ? heatStripBackground(heatHistory(track, span, nowSec, HEAT_HISTORY_CELLS)) : "";
      if (bg !== heatStripBg) {
        heatStripBg = bg;
        heatStrip.style.background = bg;
      }
      const r = track?.read(span, nowSec) ?? null;
      const color = heatToColor(r ? r.heat : 0);
      if (color !== heatColorNow) {
        heatColorNow = color;
        boundRowEl?.style.setProperty("--vc-heat", color);
      }
    }

    function tickHeatGlow(): void {
      const glow = heatGlowLevel(heatLive.get(spec.key) ?? 0);
      if (glow === heatGlowNow) return;
      heatGlowNow = glow;
      boundRowEl?.style.setProperty("--vc-heat-glow", String(glow));
    }

    /** Resyncs .vc-drive-preview from the global `preview` (also clears a stale
     *  one; see togglePin); a pinned row wins visually, so it skips refreshMeta(). */
    function refreshPreviewLit(): void {
      boundRowEl?.classList.toggle("vc-drive-preview", !isPinned() && samePair(preview, { sceneId, spec }));
      if (isPinned()) return;
      refreshMeta();
    }

    function rebuildIfPinned(): void {
      if (!isPinned()) return;
      untrackDriveCanvas(outputCanvas);
      const built = buildPatchPanel(sceneId, spec);
      patchContainer.replaceChildren(built.el);
      outputCanvas = built.outputCanvas;
      activeOutputTick = built.tick;
      lastPinnedSetting = deps.getDriveSetting(sceneId, spec);
    }

    function refreshPin(): void {
      const on = isPinned();
      boundRowEl?.classList.toggle("vc-drive-pinned", on);
      patchContainer.style.display = on ? "" : "none";
      if (on) {
        rebuildIfPinned();
      } else {
        untrackDriveCanvas(outputCanvas);
        outputCanvas = null;
        patchContainer.replaceChildren();
      }
      refreshMeta();
    }

    function drawSparkline(): void {
      const { w, h, onScreen } = sparkSize;
      if (w <= 1 || h <= 1 || !onScreen) return;
      sparkCtx.clearRect(0, 0, w, h);
      const n = Math.min(sparkFilled, SPARK_LEN);
      if (n < 2) return;
      const at = (k: number) => (sparkHead - SPARK_LEN + k + 1 + SPARK_LEN * 2) % SPARK_LEN;
      const xs = (k: number) => (k / (SPARK_LEN - 1)) * w;
      const top = sparkTop;
      const pad = sparkHasMarks ? 3 : 1;
      const ys = (v: number) => h - pad - Math.max(0, Math.min(1, v / top)) * (h - 2 * pad);
      drawDriveGraphFrame(sparkCtx, w, ys(top), ys(0));
      sparkCtx.lineWidth = 1.3;
      sparkCtx.lineJoin = "round";
      sparkCtx.globalAlpha = sparkHasMarks ? 0.45 : 1;
      let runColor = "";
      let prevX = 0;
      let prevY = 0;
      for (let k = SPARK_LEN - n; k < SPARK_LEN; k++) {
        const idx = at(k);
        const col = sparkCols[idx]!;
        const px = xs(k);
        const py = ys(sparkVals[idx]!);
        if (col !== runColor) {
          if (runColor) sparkCtx.stroke();
          sparkCtx.strokeStyle = col;
          sparkCtx.beginPath();
          // Continue from the previous point so no gap appears.
          if (runColor) {
            sparkCtx.moveTo(prevX, prevY);
            sparkCtx.lineTo(px, py);
          } else {
            sparkCtx.moveTo(px, py);
          }
          runColor = col;
        } else {
          sparkCtx.lineTo(px, py);
        }
        prevX = px;
        prevY = py;
      }
      if (runColor) sparkCtx.stroke();
      sparkCtx.globalAlpha = 1;
      if (sparkHasMarks) {
        sparkCtx.fillStyle = "rgba(110,235,225,0.95)";
        for (let k = SPARK_LEN - n; k < SPARK_LEN; k++) {
          if (sparkReact[at(k)]! <= 0.01) continue;
          const start = k;
          let total = 0;
          while (k < SPARK_LEN && sparkReact[at(k)]! > 0.01) total += sparkReact[at(k++)]!;
          k--;
          sparkCtx.beginPath();
          sparkCtx.arc(xs(start), ys(sparkVals[at(start)]!), 1 + 2.8 * Math.sqrt(Math.min(1, total)), 0, Math.PI * 2);
          sparkCtx.fill();
        }
      }
    }

    function tickSparkline(drives: SceneDrives, frame: FeatureFrame | null, anim: AnimFrame | null, slots: number): void {
      const setting = deps.getDriveSetting(sceneId, spec);
      let now: number;
      let v: number;
      let col: string;
      if (setting === "scene") {
        // drives.valueOf() is 0 for "scene" (no patch to sum), so approximate
        // from the loudest of drive.sceneSources (display-only, see drives.ts
        // header), dimmed to mark it as an approximation.
        const sources = spec.drive?.sceneSources;
        if (sources?.length && frame && anim) {
          let best = 0;
          let bestId: SignalId = sources[0]!;
          for (const id of sources) {
            const rv = SIGNALS[id].read(frame, anim);
            if (rv > best) {
              best = rv;
              bestId = id;
            }
          }
          now = v = best;
          col = withAlpha(driveSourceColor(bestId), 0.55);
        } else {
          // Faint baseline: a literal 0 is invisible at the track's bottom.
          now = v = 0.04;
          col = withAlpha(SCENE_VIOLET, 0.35);
        }
      } else {
        now = drives.valueOf(spec.key);
        v = heldValue(spec.key, now);
        col = SCENE_VIOLET;
        if (setting.sources.length) {
          const vals = drives.sourceValues(spec.key);
          let bi = 0;
          if (vals && vals.length) {
            let bv = -Infinity;
            for (let i = 0; i < vals.length; i++) {
              if (vals[i]! > bv) {
                bv = vals[i]!;
                bi = i;
              }
            }
          }
          col = driveSourceColor(setting.sources[bi]!.choice);
        }
      }
      sparkTop = setting === "scene" ? DRIVE_WEIGHT_MAX : driveGraphTop(spec);
      const marks = takeSettingMarks(sceneId, spec.key, "row");
      if (marks) sparkHasMarks = true;
      for (let s = 0; s < slots; s++) {
        sparkHead = (sparkHead + 1) % SPARK_LEN;
        sparkVals[sparkHead] = s === 0 ? v : now;
        sparkCols[sparkHead] = col;
        sparkReact[sparkHead] = s === 0 ? (marks?.reaction ?? 0) : 0;
      }
      sparkFilled = Math.min(SPARK_LEN, sparkFilled + slots);
      drawSparkline();
    }

    return {
      port,
      summary,
      below,
      bind(rowEl) {
        boundRowEl = rowEl;
        refreshMeta();
        refreshHeat(performance.now() / 1000);
        return { sceneId, spec, portEl: port, rowEl, refreshMeta, refreshPin, refreshPreviewLit, rebuildIfPinned, tickSparkline, refreshHeat, tickHeatGlow };
      },
    };
  }

  /** Copies `spec`'s just-written DriveSetting onto every linked setting
   *  verbatim (registry.ts's `appendRow` `linked`; DeviceMenuDeps says why a
   *  straight copy is right). No-op without `linked` entries. patchChanged
   *  calls it, and so does buildWeightSlider's live `input`, which never
   *  rebuilds. */
  function syncLinkedDriveSetting(sceneId: string, spec: SceneSetting): void {
    const entry = linkedByKey.get(spec.key);
    if (!entry?.linked.length) return;
    const setting = deps.getDriveSetting(sceneId, spec);
    for (const l of entry.linked) deps.onSetDriveSetting(sceneId, l.spec, setting);
  }

  /** The only place a patch mutation is followed by a rebuild. A weight
   *  slider's `input` is the exception (click-loss rule): it only refreshes the
   *  reset link and calls syncLinkedDriveSetting itself. */
  function patchChanged(sceneId: string, spec: SceneSetting): void {
    syncLinkedDriveSetting(sceneId, spec);
    const h = driveRowHandles.find((r) => r.sceneId === sceneId && r.spec.key === spec.key);
    h?.refreshMeta();
    h?.rebuildIfPinned();
    refreshLineMode();
    refreshPatchHighlight();
  }

  /** registry.ts's `WidgetCtx.setDrive`: patchChanged's refresh without its
   *  linked-row copy, since the widget writes every setting it means to. A
   *  setting equal to the scene default is a reset, so Back after a Random
   *  leaves a lane on its default rather than a stored copy of it. */
  function setDriveFromWidget(sceneId: string, spec: SceneSetting, setting: DriveSetting): void {
    if (isDefaultDriveSetting(spec, setting)) deps.onResetDriveSetting(sceneId, spec);
    else deps.onSetDriveSetting(sceneId, spec, setting);
    const h = driveRowHandles.find((r) => r.sceneId === sceneId && r.spec.key === spec.key);
    h?.refreshMeta();
    h?.rebuildIfPinned();
    refreshLineMode();
    refreshPatchHighlight();
  }

  /** The only place `pinned` is written (besides Escape in onKeyDown and the
   *  scene-mismatch check in renderSceneSettings). Clears a pending preview so
   *  a stale dwell timer can't race the click. */
  function togglePin(sceneId: string, spec: SceneSetting): void {
    cancelPendingPreview();
    const next = { sceneId, spec };
    pinned = samePair(pinned, next) ? null : next;
    if (pinned) pinnedNode = null;
    preview = null;
    activeOutputTick = null;
    if (!pinned) lastPinnedSetting = null;
    for (const h of pinRowHandles) h.refreshPin();
    // refreshPin() never touches the preview tint; resync so another row isn't
    // left showing a stale one.
    for (const h of driveRowHandles) h.refreshPreviewLit();
    refreshLineMode();
    refreshPatchHighlight();
    // Solo follows the pin.
    if (soloOn) applySolo();
    scheduleCableRecompute();
  }

  /** Pins without ever unpinning — a press on a card (isCardPress). */
  function pinSetting(sceneId: string, spec: SceneSetting): void {
    if (!samePair(pinned, { sceneId, spec })) togglePin(sceneId, spec);
  }

  /** Registers `rowEl` into `pinRowHandles` outside the DriveRowHandle path
   *  (appendSettingRow's non-drive rows; `WidgetCtx.registerCard`, see
   *  registry.ts for why `spec` may be a synthetic identity). A click on
   *  `rowEl` pins unless it hits some other in-row control (isCardPress);
   *  passing `rowEl` itself as `main` makes every press in the row count. */
  function registerPinnableRow(sceneId: string, spec: SceneSetting, accent: string, rowEl: HTMLElement, main?: HTMLElement | null): void {
    if (main) {
      rowEl.addEventListener("click", (e) => {
        if (isCardPress(rowEl, main, e.target)) pinSetting(sceneId, spec);
      });
    }
    rowEl.style.setProperty("--vc-pin-color", accent);
    pinRowHandles.push({
      sceneId,
      spec,
      rowEl,
      refreshPin: () => rowEl.classList.toggle("vc-drive-pinned", samePair(pinned, { sceneId, spec })),
    });
  }

  /** The only place `preview` is written (hover-dwell contract: appendSettingRow's onRowFocusIn). */
  function previewDrive(next: { sceneId: string; spec: SceneSetting } | null): void {
    cancelPendingPreview();
    if (samePair(preview, next)) return;
    preview = next;
    if (next) lastPreview = next;
    for (const h of driveRowHandles) h.refreshPreviewLit();
    refreshPatchHighlight();
  }

  // ---- Jacks (jack.ts) and cables (cableLayer.ts) ----
  // These predicates answer "does `choice` feed the shown (preview ?? pinned)
  // setting" for both createAudioMeters's jacks and the Bands card's
  // (mountBandsJack). jackKey (driveSources.ts) collapses every beat-grid
  // division to one key: a patch carries at most one, and the Grid jack means
  // whichever is there.

  function shownSelection(): { sceneId: string; spec: SceneSetting } | null {
    return preview ?? pinned;
  }

  /** `preview` only when it differs from the pinned setting: hovering the
   *  pinned row isn't a competing preview (cableSpecsForShown). */
  function activePreview(): { sceneId: string; spec: SceneSetting } | null {
    return preview && !samePair(preview, pinned) ? preview : null;
  }

  /** How many of the active scene's settings use `choice` (the jack's usage dots). */
  function jackUsage(choice: DriveSourceChoice): number {
    const sceneId = deps.currentSceneId();
    const key = jackKey(choice);
    let n = 0;
    for (const spec of deps.getSceneSettings(sceneId)) {
      if (!spec.drive) continue;
      const setting = deps.getDriveSetting(sceneId, spec);
      if (setting !== "scene" && setting.sources.some((s) => jackKey(s.choice) === key)) n++;
    }
    return n;
  }

  /** The pinned shaping node's input jack, when a node is pinned and no setting is — the node's input lights as the one it reads. */
  function pinnedNodeInput(choice: DriveSourceChoice): boolean {
    if (!pinnedNode) return false;
    const node = getShapingNode(pinnedNode);
    return !!node && jackKey(node.src) === jackKey(choice);
  }

  function jackIsShown(choice: DriveSourceChoice): boolean {
    const sel = shownSelection();
    if (!sel) return pinnedNodeInput(choice);
    const setting = deps.getDriveSetting(sel.sceneId, sel.spec);
    return setting !== "scene" && setting.sources.some((s) => jackKey(s.choice) === jackKey(choice));
  }

  function jackIsPinned(choice: DriveSourceChoice): boolean {
    if (!pinned) return pinnedNodeInput(choice);
    const setting = deps.getDriveSetting(pinned.sceneId, pinned.spec);
    return setting !== "scene" && setting.sources.some((s) => jackKey(s.choice) === jackKey(choice));
  }

  /** `choice` feeds the active preview: a soft row/lane glow that takes
   *  priority over a pinned feed. */
  function jackFeedsPreview(choice: DriveSourceChoice): boolean {
    const ap = activePreview();
    if (!ap) return false;
    const setting = deps.getDriveSetting(ap.sceneId, ap.spec);
    return setting !== "scene" && setting.sources.some((s) => jackKey(s.choice) === jackKey(choice));
  }

  /** The `DriveSource` for `choice` in `setting`, if any. */
  function sourceForChoice(setting: DriveSetting, choice: DriveSourceChoice): DriveSource | undefined {
    if (setting === "scene") return undefined;
    const key = jackKey(choice);
    return setting.sources.find((s) => jackKey(s.choice) === key);
  }

  /** `jackIsPinned`, but false for a muted source: its jack stays filled
   *  (still plugged in) while its row stops lighting (header's Muting). */
  function jackIsPinnedActive(choice: DriveSourceChoice): boolean {
    if (!pinned) return pinnedNodeInput(choice);
    const src = sourceForChoice(deps.getDriveSetting(pinned.sceneId, pinned.spec), choice);
    return !!src && !src.off;
  }

  /** `jackFeedsPreview`, but false for a muted source. */
  function jackFeedsPreviewActive(choice: DriveSourceChoice): boolean {
    const ap = activePreview();
    if (!ap) return false;
    const src = sourceForChoice(deps.getDriveSetting(ap.sceneId, ap.spec), choice);
    return !!src && !src.off;
  }

  /** `choice` is in the shown setting's display-only `drive.sceneSources`
   *  (drives.ts header): a softer row/lane glow, never a jack fill. */
  function jackIsSceneSource(choice: DriveSourceChoice): boolean {
    if (typeof choice !== "string") return false;
    const sel = shownSelection();
    if (!sel) return false;
    const setting = deps.getDriveSetting(sel.sceneId, sel.spec);
    if (setting !== "scene") return false;
    return (sel.spec.drive?.sceneSources ?? []).includes(choice);
  }

  /** Something is shown: drives the Bands card's `.vc-patching` dim. */
  function isAnythingShown(): boolean {
    return shownSelection() !== null;
  }

  /** What a jack click plugs into: the pinned setting if it takes drives,
   *  else the last one previewed (always a drive row — previewDrive is
   *  handed null for any other). A pinned no-drive row has no patch. */
  function jackTarget(): { sceneId: string; spec: SceneSetting } | null {
    return (pinned?.spec.drive ? pinned : null) ?? lastPreview;
  }

  /** `choice` is already plugged into `target`'s patch. */
  function jackFeeds(target: { sceneId: string; spec: SceneSetting }, choice: DriveSourceChoice): boolean {
    const setting = deps.getDriveSetting(target.sceneId, target.spec);
    return setting !== "scene" && setting.sources.some((s) => jackKey(s.choice) === jackKey(choice));
  }

  function jackDescribe(choice: DriveSourceChoice): { aria: string; title: string } {
    const name = driveSourceLabel(choice);
    if (pinnedNode && getShapingNode(pinnedNode)) {
      const aria = typeof choice === "string" ? `Make ${shapingNodeLabel(pinnedNode)} read ${name}` : `${name} — a modifier reads one input node`;
      return { aria, title: name };
    }
    const target = jackTarget();
    if (!target) return { aria: `${name} — pick a setting first`, title: name };
    const already = jackFeeds(target, choice);
    const verb = already ? "Unplug" : "Plug";
    const prep = already ? "from" : "into";
    return { aria: `${verb} ${name} ${prep} ${target.spec.label}`, title: name };
  }

  /** The jack's tooltip lines (onJackHover): what the source is, then what a
   *  click does now. */
  function jackTooltipLines(choice: DriveSourceChoice): string[] {
    const line1 = `${driveSourceLabel(choice)} — ${driveSourceDescription(choice)}`;
    const heat = audioMeters.jackHeatText(choice) ?? shapingCol.jackHeatText(choice);
    const tail = heat ? [heat] : [];
    if (pinnedNode && getShapingNode(pinnedNode)) {
      const line2 = typeof choice === "string" ? `Click to make ${shapingNodeLabel(pinnedNode)} read this` : "A modifier reads one input node";
      return [line1, line2, ...tail];
    }
    const target = jackTarget();
    if (!target) return [line1, "Pin a setting first", ...tail];
    const line2 = jackFeeds(target, choice) ? `Click to unplug from ${target.spec.label}` : `Click to plug into ${target.spec.label}`;
    return [line1, line2, ...tail];
  }

  // Consumed once by buildCables to draw that cable on (controlsTheme.ts's
  // vc-cable-new) instead of snapping in; set before the store write, since
  // add-vs-remove must be known ahead.
  let justAddedKey: string | null = null;

  function onJackClick(choice: DriveSourceChoice): void {
    if (jackDragJustEnded) return;
    if (pinnedNode) {
      const node = getShapingNode(pinnedNode);
      if (node) {
        if (typeof choice !== "string") {
          showToast("A modifier reads one input node");
          return;
        }
        if (node.src !== choice) {
          updateShapingNode(node.id, { src: choice });
          showToast(`${shapingNodeLabel(node.id)} now reads ${driveSourceLabel(choice)}`);
        }
        return;
      }
    }
    const target = jackTarget();
    if (!target) {
      showToast("Pick a setting first");
      return;
    }
    pinSetting(target.sceneId, target.spec);
    const existed = jackFeeds(target, choice);
    justAddedKey = existed ? null : jackKey(choice);
    deps.onTogglePatchSource(target.sceneId, target.spec, choice);
    patchChanged(target.sceneId, target.spec);
  }

  // ---- Jack drag: a mouse or pen press that moves (wide layout only; cables
  // are hidden when narrow). Without movement it stays onJackClick's click.
  /** A jack press that may become a drag (DRAG_START_PX of movement). */
  let jackDrag: { el: HTMLElement; choice: DriveSourceChoice; x: number; y: number; pointerId: number; moved: boolean } | null = null;
  /** Set on the pointerup that ends a real drag, so the click the browser may still send to the jack is ignored. */
  let jackDragJustEnded = false;
  let dropTargetEl: HTMLElement | null = null;
  const DRAG_START_PX = 5;

  type DropTarget =
    | { kind: "setting"; el: HTMLElement; sceneId: string; spec: SceneSetting }
    | { kind: "node"; el: HTMLElement; id: string }
    | { kind: "column"; el: HTMLElement };

  /** What a jack dropped at (x, y) lands on. A node's own jack (a shaped choice) only lands on a setting. */
  function dropTargetAt(x: number, y: number, choice: DriveSourceChoice): DropTarget | null {
    const under = document.elementFromPoint(x, y);
    if (!under) return null;
    const sceneId = deps.currentSceneId();
    const h = driveRowHandles.find((r) => r.sceneId === sceneId && r.spec.drive && r.rowEl.contains(under));
    if (h) return { kind: "setting", el: h.rowEl, sceneId, spec: h.spec };
    if (typeof choice !== "string") return null;
    const nodeEl = under.closest<HTMLElement>(".vc-shape-node");
    if (nodeEl?.dataset.nodeId) return { kind: "node", el: nodeEl, id: nodeEl.dataset.nodeId };
    if (under.closest(".vc-shape-col")) return { kind: "column", el: shapingCol.el };
    return null;
  }

  /** Plugging never unplugs: dropping a wire that is already there just pins its setting. */
  function dropJack(choice: DriveSourceChoice, t: DropTarget): void {
    if (t.kind === "setting") {
      pinSetting(t.sceneId, t.spec);
      if (!jackFeeds({ sceneId: t.sceneId, spec: t.spec }, choice)) {
        justAddedKey = jackKey(choice);
        deps.onTogglePatchSource(t.sceneId, t.spec, choice);
        patchChanged(t.sceneId, t.spec);
        showToast(`${driveSourceLabel(choice)} → ${t.spec.label}`);
      }
      return;
    }
    if (typeof choice !== "string") return;
    if (t.kind === "node") {
      const node = getShapingNode(t.id);
      if (!node) return;
      if (node.src !== choice) {
        updateShapingNode(node.id, { src: choice });
        showToast(`${shapingNodeLabel(node.id)} now reads ${driveSourceLabel(choice)}`);
      }
      if (pinnedNode !== node.id) toggleNodePin(node.id);
      return;
    }
    const node = addShapingNode(choice);
    if (!node) {
      showToast("No room for another modifier");
      return;
    }
    showToast(`New modifier: ${shapingNodeLabel(node.id)}. Drag its jack onto a setting.`);
    // Pinned after the add: the column rebuilds itself from the store.
    toggleNodePin(node.id);
  }

  function setDropTarget(el: HTMLElement | null): void {
    if (el === dropTargetEl) return;
    dropTargetEl?.classList.remove("vc-drop-target");
    dropTargetEl = el;
    el?.classList.add("vc-drop-target");
  }

  function clearJackDrag(): void {
    jackDrag = null;
    cableLayer.setDrag(null);
    root.classList.remove("vc-dragging");
    setDropTarget(null);
  }

  root.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.pointerType === "touch" || narrowMQ.matches) return;
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>(".vc-jack") : null;
    const choice = el ? jackChoices.get(el) : undefined;
    if (!el || !choice) return;
    jackDrag = { el, choice, x: e.clientX, y: e.clientY, pointerId: e.pointerId, moved: false };
  });
  window.addEventListener("pointermove", (e) => {
    const d = jackDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) <= DRAG_START_PX) return;
      d.moved = true;
      root.classList.add("vc-dragging");
      hideTooltip();
    }
    cableLayer.setDrag({ from: d.el, x: e.clientX, y: e.clientY, color: driveSourceColor(d.choice) });
    setDropTarget(dropTargetAt(e.clientX, e.clientY, d.choice)?.el ?? null);
  });
  window.addEventListener("pointerup", (e) => {
    const d = jackDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    clearJackDrag();
    if (!d.moved) return;
    jackDragJustEnded = true;
    setTimeout(() => {
      jackDragJustEnded = false;
    }, 0);
    const t = dropTargetAt(e.clientX, e.clientY, d.choice);
    if (t) dropJack(d.choice, t);
  });
  window.addEventListener("pointercancel", (e) => {
    const d = jackDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    clearJackDrag();
  });

  /** Highlights every scene row the jack feeds and shows its tooltip;
   *  independent of the preview/pin highlight (fires for any jack). Called
   *  from every jack's pointerenter/leave/focus/blur (jack.ts), never a
   *  timer. */
  function onJackHover(choice: DriveSourceChoice, on: boolean): void {
    const key = jackKey(choice);
    const color = driveSourceColor(choice);
    for (const h of driveRowHandles) {
      const setting = deps.getDriveSetting(h.sceneId, h.spec);
      if (setting === "scene" || !setting.sources.some((s) => jackKey(s.choice) === key)) continue;
      h.rowEl.classList.toggle("vc-drive-hl", on);
      if (on) h.rowEl.style.setProperty("--vc-hl2", color);
    }
    if (on) {
      const jackEl = combinedJackElements().get(key);
      if (jackEl) showTooltip(jackEl, color, jackTooltipLines(choice));
    } else {
      hideTooltip();
    }
  }

  /** The Bands card's jacks: the same refresh as audioMeters.ts's
   *  refreshPatchView, plus the row-level fed/dim (jack.ts's setRowFed). Glow
   *  priority per shared row: active preview (soft), then pinned feed (full,
   *  faint while another preview is live), then the scene-mix fallback
   *  (jackIsSceneSource; a "scene" setting has no patch sources). */
  function refreshBandsJacks(): void {
    const ap = activePreview();
    const feedGroups = new Map<HTMLElement, DriveSourceChoice[]>();
    for (const { choice, jack, feedEl } of bandsJacks) {
      jack.setFilled(jackIsShown(choice));
      jack.setPressed(jackIsPinned(choice));
      jack.setUses(jackUsage(choice));
      const { aria, title } = jackDescribe(choice);
      jack.setLabel(aria, title);
      let list = feedGroups.get(feedEl);
      if (!list) {
        list = [];
        feedGroups.set(feedEl, list);
      }
      list.push(choice);
    }
    for (const [rowEl, choices] of feedGroups) {
      // Mute-aware: a muted source keeps its jack filled but doesn't light the row.
      const previewHit = ap ? choices.find((c) => jackFeedsPreviewActive(c)) : undefined;
      const pinnedHit = pinned ? choices.find((c) => jackIsPinnedActive(c)) : undefined;
      const sceneSoftHit = previewHit || pinnedHit ? undefined : choices.find((c) => jackIsSceneSource(c));
      if (previewHit) {
        setRowFed(rowEl, "soft", driveSourceColor(previewHit));
      } else if (pinnedHit) {
        setRowFed(rowEl, ap ? "faint" : "full", driveSourceColor(pinnedHit));
      } else if (sceneSoftHit) {
        setRowFed(rowEl, "soft", driveSourceColor(sceneSoftHit));
      } else {
        setRowFed(rowEl, "none", "");
      }
    }
  }

  /** Dims the unheard bands on the spectrum strip for the shown setting:
   *  patch sources, or `sceneSources` for a "scene" one (a grid/line source has
   *  no band range). Recomputed with the other selection refreshes, never per
   *  frame (a drive row has no `reads` for wireBandHighlight). */
  function refreshSpectrumDriveHighlight(): void {
    const sel = shownSelection();
    if (!sel) {
      spectrumStrip.setHighlight(null);
      spectrumStrip.redraw();
      return;
    }
    const setting = deps.getDriveSetting(sel.sceneId, sel.spec);
    const ids: SignalId[] =
      setting === "scene"
        ? [...(sel.spec.drive?.sceneSources ?? [])]
        : setting.sources.map((s) => s.choice).filter((c): c is SignalId => typeof c === "string");
    const split = deps.getBandSplit();
    let lo = NUM_BANDS;
    let hi = 0;
    let any = false;
    for (const id of ids) {
      const range = SIGNALS[id].bandRange;
      if (!range) continue;
      if (range === "all") {
        any = false;
        break; // whole spectrum: nothing to dim, same convention as wireBandHighlight
      }
      const r = resolveBandRange(range, split);
      lo = Math.min(lo, r.lo);
      hi = Math.max(hi, r.hi);
      any = true;
    }
    spectrumStrip.setHighlight(any ? { lo, hi } : null);
    spectrumStrip.redraw();
  }

  // ---- Cables ----
  const cableLayer = createCableLayer();
  document.body.appendChild(cableLayer.el);
  // Also drives bandLevelRows (setValue's dtSec is only a peak-hold decay
  // rate, so a rough per-tick delta is enough).
  let lastCableTickMs = performance.now();
  const narrowMQ = window.matchMedia(`(max-width: ${STACK_BELOW_PX}px)`);

  /** A shaping node was added or removed (shapingColumn.ts). */
  function shapingStructureChanged(): void {
    if (pinnedNode && !getShapingNode(pinnedNode)) pinnedNode = null;
    if (hoverNode && !getShapingNode(hoverNode)) hoverNode = null;
    for (const h of driveRowHandles) {
      h.refreshMeta();
      h.rebuildIfPinned();
    }
    refreshLineMode();
    refreshPatchHighlight();
  }

  function combinedJackElements(): ReadonlyMap<string, HTMLElement> {
    const merged = new Map(audioMeters.jackElements());
    for (const [k, v] of shapingCol.jackElements()) merged.set(k, v);
    for (const [k, v] of bandsJackEls) merged.set(k, v);
    return merged;
  }

  // Read fresh each tick by cableSpecsForShown's getValue() closures, so cable
  // flow tracks the live signal though geometry is rebuilt less often.
  let lastDrives: SceneDrives | null = null;
  let lastFrame: FeatureFrame | null = null;
  let lastAnim: AnimFrame | null = null;

  /** One cable group (cableLayer.ts's CableGroupSpec) for `pinned` or
   *  activePreview(). `interactive` marks the pinned group: pressing a real
   *  source's cable unplugs it, like the source line's × button. A preview
   *  isn't a committed patch, and display-only sceneSources have no per-source
   *  unplug (the row's Unplug owns that). */
  function cableGroupFor(sel: { sceneId: string; spec: SceneSetting } | null, interactive: boolean): CableGroupSpec {
    if (!sel) return { sources: [], portEl: null };
    const handle = driveRowHandles.find((r) => r.sceneId === sel.sceneId && r.spec.key === sel.spec.key);
    if (!handle) return { sources: [], portEl: null };
    const jackEls = combinedJackElements();
    const setting = deps.getDriveSetting(sel.sceneId, sel.spec);
    const sources: CableSourceSpec[] = [];
    if (setting === "scene") {
      for (const id of sel.spec.drive?.sceneSources ?? []) {
        const jackEl = jackEls.get(jackKey(id));
        if (!jackEl) continue;
        sources.push({
          key: jackKey(id),
          color: driveSourceColor(id),
          soft: true,
          jackEl,
          getValue: () => (lastFrame && lastAnim ? SIGNALS[id].read(lastFrame, lastAnim) : 0),
        });
      }
    } else {
      // Marked conditions draw dashed-long (controlsTheme.ts's .vc-cable-cond);
      // a muted source draws flat dashed `.vc-cable-muted` (no glow/flow).
      const target = sel;
      const conditionIdxs = setting.mix === "gate" ? gateConditionIndices(setting) : [];
      setting.sources.forEach((src, idx) => {
        const key = jackKey(src.choice);
        const jackEl = jackEls.get(key);
        if (!jackEl) return;
        const specKey = sel.spec.key;
        sources.push({
          key,
          color: driveSourceColor(src.choice),
          soft: false,
          cond: conditionIdxs.includes(idx),
          muted: !!src.off,
          jackEl,
          getValue: () => lastDrives?.sourceValues(specKey)?.[idx] ?? 0,
          isNew: key === justAddedKey,
          onPress: interactive
            ? () => {
                justAddedKey = null;
                deps.onTogglePatchSource(target.sceneId, target.spec, src.choice);
                patchChanged(target.sceneId, target.spec);
              }
            : undefined,
        });
      });
    }
    return { sources, portEl: handle.portEl };
  }

  /** Both groups of cableLayer.ts's two-path-group recompute; independent, see activePreview(). */
  function cableSpecsForShown(): { pinned: CableGroupSpec; preview: CableGroupSpec } {
    const pinnedGroup = cableGroupFor(pinned, true);
    const previewGroup = cableGroupFor(activePreview(), false);
    justAddedKey = null;
    return { pinned: pinnedGroup, preview: previewGroup };
  }

  let cableRecomputeQueued = false;
  function scheduleCableRecompute(): void {
    if (cableRecomputeQueued) return;
    cableRecomputeQueued = true;
    requestAnimationFrame(() => {
      cableRecomputeQueued = false;
      placeShapingColumn();
      positionSoloEye();
      if (!isOpen) return;
      const { pinned: pinnedGroup, preview: previewGroup } = cableSpecsForShown();
      cableLayer.recompute(pinnedGroup, previewGroup, [...shapingCol.feedGroups(combinedJackElements()), ...litSignalFan()]);
    });
  }

  // ---- The lit signal's fan (cableLayer.ts's third group) ----
  // While a signal row is lit (hover or focus; controlsTheme.ts's
  // `.vc-row:hover, .vc-row:focus-within`), every wire leaving its jack(s) is
  // drawn to its port. Pointer and focus are tracked separately: the glow
  // answers to either.
  let hoverJackRow: HTMLElement | null = null;
  let focusJackRow: HTMLElement | null = null;
  /** The signal row `t` sits in: a `.vc-row` carrying a jack (a Hits row
   *  carries one per lane), or null. */
  function jackRowOf(t: EventTarget | null): HTMLElement | null {
    if (!(t instanceof Element)) return null;
    const row = t.closest<HTMLElement>(".vc-row");
    return row && row.querySelector(".vc-jack") ? row : null;
  }
  function setLitJackRows(hover: HTMLElement | null, focus: HTMLElement | null): void {
    if (hover === hoverJackRow && focus === focusJackRow) return;
    const hadFan = hoverJackRow !== null || focusJackRow !== null;
    hoverJackRow = hover;
    focusJackRow = focus;
    if (hadFan || hover || focus) scheduleCableRecompute();
    refreshChain();
  }
  // Not for a finger: a tap is no hover, and drawing a wired jack's cables
  // as the tap lands cost the tap its click on iPad Safari.
  root.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    setLitJackRows(jackRowOf(e.target), focusJackRow);
    const card = e.target instanceof Element ? e.target.closest<HTMLElement>(".vc-shape-node") : null;
    setHoverNode(card?.dataset.nodeId ?? null);
  });
  root.addEventListener("pointerleave", () => {
    setLitJackRows(null, focusJackRow);
    setHoverNode(null);
  });
  root.addEventListener("focusin", (e) => setLitJackRows(hoverJackRow, jackRowOf(e.target)));
  root.addEventListener("focusout", (e) => setLitJackRows(hoverJackRow, jackRowOf(e.relatedTarget)));

  /** One fan group per port the chain's fan jacks reach (patchChain.ts's
   *  fanKeys), one cable per (setting, jack) so a jack draws as many cables as
   *  it has usage dots. A setting's focus draws nothing: its own cables run. */
  function litSignalFan(): CableGroupSpec[] {
    const focus = shownChainFocus();
    if (!focus || focus.kind === "setting") return [];
    const chain = chainOf(chainGraph(), focus);
    const jackEls = combinedJackElements();
    const litJacks = new Map<string, HTMLElement>();
    for (const key of chain.fanKeys) {
      const el = jackEls.get(key);
      if (el) litJacks.set(key, el);
    }
    const sceneId = deps.currentSceneId();
    const groups: CableGroupSpec[] = [];
    for (const h of driveRowHandles) {
      if (h.sceneId !== sceneId || !h.spec.drive) continue;
      const setting = deps.getDriveSetting(h.sceneId, h.spec);
      if (setting === "scene") continue;
      const sources: CableSourceSpec[] = [];
      for (const src of setting.sources) {
        const key = jackKey(src.choice);
        const jackEl = litJacks.get(key);
        if (!jackEl || sources.some((s) => s.key === key)) continue;
        sources.push({ key, color: driveSourceColor(src.choice), soft: false, jackEl, getValue: () => 0 });
      }
      if (sources.length) groups.push({ sources, portEl: h.portEl });
    }
    return groups;
  }
  function refreshCableVisibility(): void {
    // Soloed, the meters column is hidden: cables would run to jacks off screen.
    cableLayer.setVisible(isOpen && !narrowMQ.matches && !soloOn);
  }
  narrowMQ.addEventListener("change", () => {
    refreshCableVisibility();
    scheduleCableRecompute();
  });
  window.addEventListener("resize", scheduleCableRecompute);
  // Recompute triggers: scroll (columns and root), resize, and a
  // ResizeObserver on the columns and every card. A column is a fixed-height
  // scroller, so a card growing inside it (a .vc-hint unfolding) never resizes
  // the column; without per-card observation cables stay put while their jacks
  // move. Card fold/unfold rides refreshColumnsFold's MutationObserver.
  const cableColumnsRO = new ResizeObserver(scheduleCableRecompute);
  cableColumnsRO.observe(spectrumCol);
  audioMeters.el.addEventListener("scroll", scheduleCableRecompute, { passive: true });
  root.addEventListener("scroll", scheduleCableRecompute, { passive: true });

  // ---- Solo eye ----
  // A floating button on <body> just outside the pinned row's left edge
  // (positionSoloEye): the Scene card's overflow: hidden would clip it inside
  // the row. Look: controlsTheme.ts's .vc-solo-eye rules.
  const soloEyeEl = document.createElement("button");
  soloEyeEl.type = "button";
  soloEyeEl.className = "vc-solo-eye";
  soloEyeEl.dataset.key = "solo";
  soloEyeEl.dataset.keycap = "O";
  soloEyeEl.hidden = true;
  soloEyeEl.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><defs>' +
    '<linearGradient id="vc-eye-tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0.78"/></linearGradient>' +
    '<linearGradient id="vc-eye-depth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#15191b"/></linearGradient>' +
    '<radialGradient id="vc-eye-ball" cx="0.5" cy="0.5" r="0.5"><stop offset="0.72" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0.45"/></radialGradient>' +
    '<radialGradient id="vc-eye-lidshade" gradientUnits="userSpaceOnUse" cx="12" cy="12" r="8.4"><stop offset="0.35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></radialGradient>' +
    '<mask id="vc-eye-hole"><rect width="24" height="24" fill="#fff"/><path d="M4.2 12 Q12 4.6 19.8 12 Q12 19.4 4.2 12Z" fill="#000"/></mask>' +
    '<clipPath id="vc-eye-clip"><path d="M4.2 12 Q12 4.6 19.8 12 Q12 19.4 4.2 12Z"/></clipPath>' +
    "</defs>" +
    '<rect x="1.4" y="1.4" width="21.2" height="21.2" rx="4.2" fill="url(#vc-eye-tile)" mask="url(#vc-eye-hole)"/>' +
    '<path d="M3.2 19.5 V5.6 Q3.2 3.2 5.6 3.2 H19.5" fill="none" stroke="#fff" stroke-opacity="0.2" stroke-width="0.9" stroke-linecap="round"/>' +
    '<path d="M20.8 4.5 V18.4 Q20.8 20.8 18.4 20.8 H4.5" fill="none" stroke="#000" stroke-opacity="0.2" stroke-width="0.9" stroke-linecap="round"/>' +
    '<g clip-path="url(#vc-eye-clip)">' +
    '<rect width="24" height="24" fill="url(#vc-eye-depth)"/>' +
    '<circle cx="12" cy="12.4" r="3.3" fill="url(#vc-eye-ball)"/>' +
    '<path d="M4.2 12 Q12 4.6 19.8 12 Q12 19.4 4.2 12Z" fill="none" stroke="#000" stroke-opacity="0.7" stroke-width="2.2" transform="translate(0 -1.1)"/>' +
    '<g class="vc-eye-lid-top"><path d="M2 2 H22 V12 Q12 13.2 2 12 Z" fill="currentColor"/><path d="M2 2 H22 V12 Q12 13.2 2 12 Z" fill="url(#vc-eye-lidshade)"/>' +
    '<path d="M2 12 Q12 13.2 22 12" fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="0.9"/></g>' +
    '<g class="vc-eye-lid-bot"><path d="M2 22 H22 V12 Q12 13.2 2 12 Z" fill="currentColor"/><path d="M2 22 H22 V12 Q12 13.2 2 12 Z" fill="url(#vc-eye-lidshade)"/></g>' +
    "</g>" +
    '<path d="M4.2 12 Q12 4.6 19.8 12 Q12 19.4 4.2 12Z" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="0.8"/>' +
    "</svg>";
  soloEyeEl.addEventListener("click", () => setSolo(!soloOn));
  document.body.appendChild(soloEyeEl);
  /** Parks the eye beside the pinned row in its pin colour, or hides it
   *  (closed, nothing pinned, row scrolled out of its column). Rides every
   *  cable recompute. */
  function positionSoloEye(): void {
    const row = isOpen ? findPinnedRowEl() : null;
    const r = row?.getBoundingClientRect();
    const col = (narrowMQ.matches ? root : controlsCol).getBoundingClientRect();
    const top = r ? r.top + 20 : 0;
    const visible = !!r && r.height > 0 && top >= col.top && top + SOLO_EYE_PX <= col.bottom;
    soloEyeEl.hidden = !visible;
    if (!visible || !row || !r) return;
    soloEyeEl.style.left = `${r.left - SOLO_EYE_PX - 5}px`;
    soloEyeEl.style.top = `${top}px`;
    soloEyeEl.style.setProperty("--vc-pin-color", row.style.getPropertyValue("--vc-pin-color"));
  }

  const toastEl = document.createElement("div");
  toastEl.className = "vc-toast";
  toastEl.setAttribute("role", "status");
  document.body.appendChild(toastEl);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function showToast(text: string, durationMs = 2200): void {
    toastEl.textContent = text;
    toastEl.classList.add("vc-toast-show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("vc-toast-show"), durationMs);
  }

  /** Recomputes every selection-driven visual together: on a pin, a preview
   *  change, a patch edit, and from renderSceneSettings's tail. Content only;
   *  scheduleCableRecompute() does the measuring. */
  function refreshPatchHighlight(): void {
    audioMeters.refreshPatchView();
    shapingCol.refreshPatchView();
    refreshBandsJacks();
    refreshSpectrumDriveHighlight();
    spectrumCol.classList.toggle("vc-patching", isAnythingShown());
    refreshChain();
    scheduleCableRecompute();
  }

  // ---- Patch focus across the three columns (patchChain.ts) ----
  // chainGraph() reads the patch as plain keys; refreshChain() paints it. Runs
  // only on focus and patch changes, never per frame.

  /** A pinned shaping node's pin toggle (shapingColumn.ts onNodePress). Pinning one unpins any setting. */
  function toggleNodePin(id: string): void {
    const next = pinnedNode === id ? null : id;
    if (next && pinned) togglePin(pinned.sceneId, pinned.spec);
    pinnedNode = next;
    refreshPatchHighlight();
    scheduleCableRecompute();
  }

  function setHoverNode(id: string | null): void {
    if (id === hoverNode) return;
    hoverNode = id;
    refreshChain();
    scheduleCableRecompute();
  }

  /** What the panel's chain light follows (patchChain.ts): a hovered node card, a hovered or keyboard-focused input row, a previewed setting, a pinned node, a pinned setting — in that order. */
  function shownChainFocus(): ChainFocus | null {
    if (hoverNode) return { kind: "node", id: hoverNode };
    const row = hoverJackRow ?? focusJackRow;
    if (row) {
      const card = row.closest<HTMLElement>(".vc-shape-node");
      if (card?.dataset.nodeId) return { kind: "node", id: card.dataset.nodeId };
      const keyOfEl = new Map<HTMLElement, string>();
      for (const [key, el] of combinedJackElements()) keyOfEl.set(el, key);
      const keys: string[] = [];
      for (const el of row.querySelectorAll<HTMLElement>(".vc-jack")) {
        const key = keyOfEl.get(el);
        if (key) keys.push(key);
      }
      if (keys.length) return { kind: "input", keys };
    }
    const ap = activePreview();
    if (ap) return { kind: "setting", key: ap.spec.key };
    if (pinnedNode) return { kind: "node", id: pinnedNode };
    if (pinned?.spec.drive) return { kind: "setting", key: pinned.spec.key };
    return null;
  }

  /** The patch as plain keys (patchChain.ts's ChainGraph): every shaping node with its own jack key and its input's, and every wired setting in the active scene with its wires' jack keys. */
  function chainGraph(): ChainGraph {
    const nodes = listShapingNodes().map((n) => ({ id: n.id, key: jackKey({ source: "shaped", id: n.id }), inputKey: jackKey(n.src) }));
    const sceneId = deps.currentSceneId();
    const settings: ChainGraph["settings"][number][] = [];
    for (const h of driveRowHandles) {
      if (h.sceneId !== sceneId || !h.spec.drive) continue;
      const setting = deps.getDriveSetting(h.sceneId, h.spec);
      settings.push({ key: h.spec.key, wireKeys: setting === "scene" ? [] : setting.sources.map((s) => jackKey(s.choice)) });
    }
    return { nodes, settings };
  }

  /** Paints the chain of shownChainFocus(): dims the settings, shaping nodes and input rows off it, marks the focused node, and root's vc-chain-on switches the dimming on. */
  function refreshChain(): void {
    const focus = shownChainFocus();
    const chain = focus ? chainOf(chainGraph(), focus) : null;
    root.classList.toggle("vc-chain-on", chain !== null);
    for (const h of driveRowHandles) h.rowEl.classList.toggle("vc-chain-off", !!chain && !chain.settings.has(h.spec.key));
    shapingCol.setChain(chain ? chain.nodes : null, focus?.kind === "node" ? focus.id : null);
    // Input rows: only for an input or node focus — a setting's focus already dims the meters through .vc-patching.
    const dimInputs = focus !== null && focus.kind !== "setting";
    const rowLit = new Map<HTMLElement, boolean>();
    // The Bands card's level and stem jacks sit beside rows of their own (mountBandsJack's feedEl), not inside a .vc-row.
    const bandsFeed = new Map<HTMLElement, HTMLElement>(bandsJacks.map((b) => [b.jack.el, b.feedEl]));
    for (const [key, el] of combinedJackElements()) {
      if (shapingCol.el.contains(el)) continue;
      const row = bandsFeed.get(el) ?? el.closest<HTMLElement>(".vc-row");
      if (!row) continue;
      rowLit.set(row, (rowLit.get(row) ?? false) || (!!chain && chain.inputs.has(key)));
    }
    for (const [row, lit] of rowLit) row.classList.toggle("vc-chain-off", dimInputs && !lit);
  }

  // The middle column's place in the open gap (controlsTheme.ts's
  // .vc-shape-col rules are only the fallback before the first placement).
  const SHAPE_COL_MIN_PX = 240;
  const SHAPE_COL_MAX_PX = 300;
  const SHAPE_COL_GAP_PX = 16;
  /** Matches .vc-shape-col's CSS top (controlsTheme.ts). */
  const SHAPE_COL_TOP_PX = 60;
  /** What .vc-shape-col's max-height leaves below its top (the CSS fallback's own subtraction). */
  const SHAPE_COL_BELOW_PX = 90;
  const SHAPE_COL_CLEAR = { left: "", top: "", width: "", maxHeight: "" };

  /** Writes each inline value only when it differs, since this runs on every scroll's recompute. */
  function setShapePlacement(p: { left: string; top: string; width: string; maxHeight: string }): void {
    const style = shapingCol.el.style;
    if (style.left !== p.left) style.left = p.left;
    if (style.top !== p.top) style.top = p.top;
    if (style.width !== p.width) style.width = p.width;
    if (style.maxHeight !== p.maxHeight) style.maxHeight = p.maxHeight;
  }

  /** Places the shaping column in the open gap between the meters and the settings side (controlsTheme.ts's .vc-shape-col sets the fallback). The gap's right end is the Power card's left edge while Power shows; if that leaves less than SHAPE_COL_MIN_PX, the column drops below the Power card and runs to the settings column instead. */
  function placeShapingColumn(): void {
    if (narrowMQ.matches || spectrumCol.getClientRects().length === 0) {
      setShapePlacement(SHAPE_COL_CLEAR);
      return;
    }
    const meters = spectrumCol.getBoundingClientRect();
    const settings = controlsCol.getBoundingClientRect();
    const powerRect = powerCol.querySelector<HTMLElement>(".vc-power-card")?.getBoundingClientRect();
    const power = powerRect && powerRect.width > 0 ? powerRect : null;
    const left0 = meters.right + SHAPE_COL_GAP_PX;
    let right0 = (power ? power.left : settings.left) - SHAPE_COL_GAP_PX;
    let top = SHAPE_COL_TOP_PX;
    if (right0 - left0 < SHAPE_COL_MIN_PX && power) {
      right0 = settings.left - SHAPE_COL_GAP_PX;
      top = Math.max(SHAPE_COL_TOP_PX, power.bottom + 8);
    }
    const width = Math.max(0, Math.min(SHAPE_COL_MAX_PX, right0 - left0));
    const left = left0 + (right0 - left0 - width) / 2;
    setShapePlacement({
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      width: `${Math.round(width)}px`,
      maxHeight: `calc(var(--vc-vh) - ${Math.round(top + SHAPE_COL_BELOW_PX)}px)`,
    });
  }

  // A hover-scheduled preview change not yet committed (wireHoverFocus's
  // pointerFocusOriginated, appendSettingRow's onRowFocusIn): only pointer-
  // originated focus waits; keyboard/click focus previews at once. One shared
  // timer, since only one change is ever in flight.
  let pendingPreviewTimer: ReturnType<typeof setTimeout> | null = null;
  function cancelPendingPreview(): void {
    if (pendingPreviewTimer !== null) {
      clearTimeout(pendingPreviewTimer);
      pendingPreviewTimer = null;
    }
  }

  // The column head, "Sound" heading (audioMeters.ts's meterGroupHeading,
  // shared so group headings can't drift) and Bands card travel as one unit,
  // vc-bands-block, so the stacked layout (controlsTheme.ts) keeps them
  // together.
  const bandsBlock = document.createElement("div");
  bandsBlock.className = "vc-bands-block vc-spectrum-card";
  bandsBlock.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
  bandsBlock.append(columnHead, meterGroupHeading("Sound"), bandsCard.el);

  spectrumCol.append(bandsBlock, audioMeters.el);

  // Power travels with this column so the CSS (vc-cols-wrap, controlsTheme.ts)
  // can hide both when everything is folded. columnsToggle stays visible then;
  // clicking it unfolds every folded card via its chevron.
  const columnsToggle = document.createElement("button");
  columnsToggle.type = "button";
  columnsToggle.className = "vc-cols-toggle";
  columnsToggle.textContent = "▸";
  columnsToggle.title = "Open every card in this column";
  columnsToggle.addEventListener("click", () => {
    for (const chevron of columnsWrap.querySelectorAll<HTMLButtonElement>(".vc-card.vc-folded .vc-fold")) {
      chevron.click();
    }
  });
  const columnsWrap = document.createElement("div");
  columnsWrap.className = "vc-cols-wrap";
  columnsWrap.append(columnsToggle, powerCol, spectrumCol);

  // Recomputed off each card's vc-folded class via the observer below. With
  // "Hide left" active, Bands and the meter cards are excluded
  // (isFolded(METERS_COLUMN), not an offsetParent probe: that forced a
  // synchronous layout per class mutation and stalled the panel), and so is
  // Power, whose folded square (powerCard.ts) needs no "▸".
  function refreshColumnsFold(): void {
    const cards = [...columnsWrap.querySelectorAll<HTMLElement>(".vc-card")].filter((c) => c.style.display !== "none");
    columnsWrap.classList.toggle(
      "vc-cols-folded",
      !isFolded(METERS_COLUMN) && cards.length > 0 && cards.every((c) => c.classList.contains("vc-folded")),
    );
    // This observer already fires for every fold/unfold here; reuse it as the cable layer's trigger.
    scheduleCableRecompute();
  }
  new MutationObserver(refreshColumnsFold).observe(columnsWrap, {
    attributes: true,
    attributeFilter: ["class"],
    subtree: true,
  });

  let lastStatusText = "";
  function refreshSpectrumHeader(): void {
    const status = deps.getAudioStatus();
    const text = statusText(status);
    if (text !== lastStatusText) {
      lastStatusText = text;
      statusLabel.textContent = text;
      liveDot.style.cssText = liveDotStyle(status.source !== "none");
    }
  }

  const faderGains = new Float32Array(BAND_FADER_COUNT);
  function refreshBandFaders(): void {
    const sceneId = deps.currentSceneId();
    for (let i = 0; i < BAND_FADER_COUNT; i++) faderGains[i] = deps.getBandGain(sceneId, i);
    bandFaders.setGains(faderGains);
    bandFaders.clearOff();
  }


  // The split is fixed (it only tints bars by pulse group), but the Hz edges
  // depend on the analyser's sample rate, unknown until mic access is granted,
  // so re-run on every open(). The Frequencies overlay needs neither.
  function refreshBandsSplit(): void {
    bandFaders.setEdgesHz(deps.getBandEdgesHz());
    spectrumStrip.setSplit(deps.getBandSplit());
  }

  // ---- controls column ----
  const controlsCol = document.createElement("div");
  controlsCol.className = "vc-controls-col vc-scroll";
  cableColumnsRO.observe(controlsCol);
  controlsCol.addEventListener("scroll", scheduleCableRecompute, { passive: true });
  cableColumnsRO.observe(shapingCol.el);
  shapingCol.el.addEventListener("scroll", scheduleCableRecompute, { passive: true });

  // Global "Auto" master switch: toggles every auto-capable row (app.ts's
  // isSceneAuto). Overlaps the Input card's Auto button (micAuto.ts header) on
  // Sensitivity/Expansion/Smoothing only, so toggling either refreshes the
  // other's lit state (toggleAutoMaster/toggleMicAuto).
  const autoMasterBtn = document.createElement("button");
  autoMasterBtn.className = GLASS_PANE_CLASS;
  autoMasterBtn.title = "Auto-tune everything — sensitivity, expansion, smoothing, and every scene setting";
  const autoMasterLabel = document.createElement("div");
  autoMasterLabel.textContent = "Auto";
  const autoMasterSub = document.createElement("div");
  const autoMasterInner = document.createElement("div");
  autoMasterInner.style.cssText = autoMasterInnerStyle;
  autoMasterInner.append(autoMasterLabel, autoMasterSub);
  autoMasterBtn.appendChild(autoMasterInner);

  // Master: device-wide dials. Scale sets every numeric scene param's normal
  // line (autoTune.ts's resolveSceneSetting; not drives, enums/booleans or the
  // Input card's gain stages); Expansion sets how far and how long the music
  // pulls the picture from it (drives.ts header, "Master Expansion"). Its own
  // always-visible card, not part of the auto system, so it stays on scenes
  // with no settings. Violet like the Scene card because it scales that card.
  //
  // The Picture block measures the rendered frame itself, since a setting has
  // no "more intense" direction (src/render/pictureMeter.ts;
  // tools/master-sweep.mjs sweeps it).
  const masterCard = createCard({ title: "Master", accent: SCENE_VIOLET });
  markBlock(masterCard.title);
  const masterRow = createControlRow({
    label: "Scale",
    accent: SCENE_VIOLET,
    midi: { id: MASTER_SCALE_TARGET, label: "Master · Scale" },
    min: SCENE_MASTER_MIN,
    max: SCENE_MASTER_MAX,
    step: 0.05,
    defaultValue: SCENE_MASTER_DEFAULT,
    mapping: "linear",
    unit: "×",
    format: (value) => value.toFixed(2),
    description: "Scales every scene param at once — 1 is as dialed",
  });
  masterRow.onChange((value) => deps.onSceneMasterChange(value));
  // Same range, log slider and readout as the Input card's Expansion row.
  const masterExpansionRow = createControlRow({
    label: "Expansion",
    accent: SCENE_VIOLET,
    midi: { id: MASTER_EXPANSION_TARGET, label: "Master · Expansion" },
    min: SCENE_EXPANSION_MIN,
    max: SCENE_EXPANSION_MAX,
    defaultValue: SCENE_EXPANSION_DEFAULT,
    mapping: "log",
    unit: "×",
    format: formatGain,
    description: "How far the music pulls the picture from its normal, and how long it stays away — 1 is as dialed",
  });
  masterExpansionRow.onChange((value) => deps.onSceneExpansionChange(value));
  // Expansion's shape (drives.ts header, "Master Expansion"): icon chips in
  // EXPANSION_SHAPES order, so the chosen index is what's stored. Each icon
  // draws its curve: music's change from usual across, picture's up.
  const curveIcon = (d: string) =>
    `<svg width="30" height="18" viewBox="0 0 30 18" fill="none" aria-hidden="true">` +
    `<path d="M2 9H28M15 1V17" stroke="currentColor" stroke-opacity="0.25" stroke-width="1"/>` +
    `<path d="${d}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const masterShapeRow = createPickerRow({
    label: "Expansion shape",
    accent: SCENE_VIOLET,
    options: [
      `${EXPANSION_SHAPE_NAMES[0]} — follows every change`,
      `${EXPANSION_SHAPE_NAMES[1]} — rounds off big jumps`,
      `${EXPANSION_SHAPE_NAMES[2]} — ignores the beat, follows the song's sections`,
      `${EXPANSION_SHAPE_NAMES[3]} — loud parts lift the picture, quiet parts leave it at normal`,
      `${EXPANSION_SHAPE_NAMES[4]} — quiet parts lower the picture, loud parts leave it at normal`,
    ],
    icons: [
      curveIcon("M3 16L27 2"),
      curveIcon("M3 16L15 9C19 6.6 22 5.4 27 5"),
      curveIcon("M3 17L10 9H20L27 1"),
      curveIcon("M3 9H15L27 2"),
      curveIcon("M3 16L15 9H27"),
    ],
    compact: true,
    defaultValue: 0,
    description: "Expansion shape",
    get: () => deps.getSceneExpansionShape(),
    set: (index) => deps.onSceneExpansionShapeChange(index),
    wire: (row, strip, a) => {
      wireHoverFocus(row, strip);
      wireRowKeys(strip, { reset: a.reset, toggleOff: () => a.cycle(1) });
    },
  });
  // The leash gauge (leashGauge.ts), drawn every tick below.
  const leashGauge = createLeashGauge(SCENE_VIOLET);
  const leashRow = document.createElement("div");
  leashRow.className = "vc-row";
  leashRow.append(leashGauge.el);
  const leashOnScreen = watchOnScreen(leashRow);
  masterCard.body.append(masterRow.el, masterExpansionRow.el, masterShapeRow.el, leashRow);

  // Picture block (see above): a plain .vc-row/.vc-hint block, not
  // createMeterRow's bar shape, since there's no single amount to fill.
  // Folded, one Overall row: every PICTURE_MEASURES trace in its PICTURE_COLORS
  // colour plus overallLevel's line in violet. Unfolded, a row per measure
  // (createTraceStrip). Rows record while folded, so they unfold with their
  // last 10 s drawn. Captions follow powerCard.ts's readoutCaptionStyle (kept
  // local).
  const pictureHeading = groupHeading("Picture");
  const pictureCaptionStyle = `
    font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.12em; text-transform: uppercase;
    color: rgba(255,255,255,0.5); white-space: nowrap;
  `;
  // DSEG7 (the face of the digits style) has no dashes, so "--" needs the
  // text style (as createMeterRow's setReadout does).
  const pictureReadoutDigitsStyle = `${digitsStyle} font-size: 11px; color: #fff; display: block; text-align: right;`;
  const pictureReadoutTextStyle = `${digitsTextStyle} font-size: 11px; color: #fff; display: block; text-align: right;`;
  // One colour per measure, for its row and its Overall overlay line; clear of
  // SCENE_VIOLET (the Overall line). A Record so a new key can't ship without.
  const PICTURE_COLORS: Record<PictureMeasureKey, string> = {
    brightness: "#f4f4f4",
    colour: "#f28bd0",
    motion: "#59bbfb",
    detail: "#8ce6a0",
    flashes: "#eab308",
  };
  const pictureGridStyle = `display: grid; grid-template-columns: 76px minmax(0, 1fr) 26px; align-items: center; gap: 5px 8px;`;
  const pictureBlock = document.createElement("div");
  pictureBlock.className = "vc-row";
  pictureBlock.tabIndex = 0;
  pictureBlock.setAttribute("role", "button");
  pictureBlock.style.cursor = "pointer";
  pictureBlock.style.setProperty("--vc-accent", SCENE_VIOLET);

  const pictureSummary = document.createElement("div");
  pictureSummary.style.cssText = pictureGridStyle;
  const pictureCaret = document.createElement("span");
  const pictureSummaryCaption = document.createElement("div");
  pictureSummaryCaption.style.cssText = `${pictureCaptionStyle} color: rgba(255,255,255,0.75);`;
  pictureSummaryCaption.append(pictureCaret, "Overall");
  const pictureSummaryStrip = createTraceStrip(
    [
      ...PICTURE_MEASURES.map((m) => ({ color: withAlpha(PICTURE_COLORS[m.key], 0.55), width: 1 })),
      { color: SCENE_VIOLET, width: 2.5 },
    ],
    40,
  );
  pictureSummaryStrip.canvas.style.marginTop = "0";
  const pictureSummaryReadout = document.createElement("span");
  pictureSummaryReadout.style.cssText = pictureReadoutTextStyle;
  pictureSummaryReadout.textContent = "--";
  pictureSummary.append(pictureSummaryCaption, pictureSummaryStrip.canvas, pictureSummaryReadout);
  let pictureSummaryText = "--";

  // Folded, a key naming the overlay's colours; hidden once the rows show.
  const pictureLegend = document.createElement("div");
  pictureLegend.style.cssText = `flex-wrap: wrap; gap: 2px 10px; margin: 5px 0 0 84px; font: 400 8.5px/1.2 ${FONT_MONO}; letter-spacing: 0.1em; text-transform: uppercase;`;
  for (const m of PICTURE_MEASURES) {
    const key = document.createElement("span");
    key.textContent = m.label;
    key.style.color = PICTURE_COLORS[m.key];
    pictureLegend.appendChild(key);
  }

  const pictureGrid = document.createElement("div");
  pictureGrid.style.cssText = `${pictureGridStyle} padding-top: 6px;`;
  const pictureFold = document.createElement("div");
  pictureFold.style.overflow = "hidden";
  pictureFold.appendChild(pictureGrid);
  const pictureHint = document.createElement("div");
  pictureHint.className = "vc-hint";
  setHintText(
    pictureHint,
    "Measured from the picture itself, 15 times a second, over the last 10 s. Overall is the average of them all. 100 is about as far as scenes go; a few go further and stay pinned at 100. Click to show or hide each one on its own.",
  );
  const pictureRows = PICTURE_MEASURES.map((measure) => {
    const caption = document.createElement("div");
    caption.textContent = measure.label;
    caption.title = measure.description;
    caption.style.cssText = `${pictureCaptionStyle} color: ${PICTURE_COLORS[measure.key]};`;
    const strip = createTraceStrip([{ color: PICTURE_COLORS[measure.key], width: 1.5 }], 18);
    strip.canvas.style.marginTop = "0";
    const readout = document.createElement("span");
    readout.style.cssText = pictureReadoutTextStyle;
    readout.textContent = "--";
    pictureGrid.append(caption, strip.canvas, readout);
    return { measure, strip, readout, lastText: "--" };
  });

  let pictureOpen = false;
  function setPictureOpen(open: boolean): void {
    pictureOpen = open;
    pictureBlock.setAttribute("aria-expanded", String(open));
    pictureCaret.textContent = open ? "▾ " : "▸ ";
    pictureFold.style.height = open ? "" : "0";
    pictureFold.inert = !open;
    pictureLegend.style.display = open ? "none" : "flex";
  }
  setPictureOpen(false);
  pictureBlock.addEventListener("click", () => setPictureOpen(!pictureOpen));
  pictureBlock.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    setPictureOpen(!pictureOpen);
  });

  pictureBlock.append(pictureSummary, pictureLegend, pictureFold, pictureHint);
  masterCard.body.append(pictureHeading, pictureBlock);
  const pictureOnScreen = watchOnScreen(pictureBlock);

  // Binds a row's typed entry to deps.customValues. The args are getters
  // because the Input card's rows outlive scene switches (makeInputRow). A dev
  // build lifts customReach's bound, for tuning.
  function customConfig(sceneId: () => string, spec: () => SceneSetting, resolve: () => number): ControlRowSpec["custom"] {
    const store = deps.customValues;
    return {
      get: () => store.get(sceneId(), spec().key),
      set: (value) => store.set(sceneId(), spec().key, value),
      clear: () => store.clear(sceneId(), spec().key),
      stretch: () => store.stretch(sceneId(), spec().key),
      stretchTo: (to) => store.stretchTo(sceneId(), spec().key, to),
      reset: () => store.reset(sceneId(), spec().key),
      fit: (raw) => fitCustom(spec(), raw, import.meta.env.DEV),
      reach: () => {
        const reach = customReach(spec(), import.meta.env.DEV);
        return reach && Number.isFinite(reach.lo) && Number.isFinite(reach.hi) ? reach : null;
      },
      resolve,
    };
  }

  // Input: Sensitivity/Expansion/Smoothing share one array of rows (and so the
  // auto-refresh call sites), so a fourth row can't ship half-wired to Auto.
  function makeInputRow(
    label: string,
    range: { min: number; max: number; defaultValue: number; zeroAtMin?: boolean },
    spec: () => SceneSetting,
    getManual: () => number,
    resolveLive: () => number,
    onChange: (value: number) => void,
    description: string,
  ) {
    const row = createControlRow({
      label,
      accent: INPUT_GREEN,
      min: range.min,
      max: range.max,
      defaultValue: range.defaultValue,
      mapping: "log",
      zeroAtMin: range.zeroAtMin,
      unit: "×",
      format: formatGain,
      description,
      auto: {
        isEnabled: () => deps.isSettingAutoEnabled(deps.currentSceneId(), spec().key),
        toggle: (on) => deps.onSettingAutoToggle(deps.currentSceneId(), spec(), on),
        resolveLive,
        getManual,
      },
      // One of the whole-mic Auto button's members (micAuto.ts header); also
      // refreshes the Auto master bar.
      onAutoToggled: refreshMicAutoAndMaster,
      // Dev only: these rows keep their own store (audio/sensitivity.ts), which
      // doesn't drop a custom value on a write the way setSceneSetting does, so
      // the public build clamps them. A custom value is one past the slider's
      // own range, not the Auto spec's (Smoothing's slider reaches past
      // SMOOTHING_SPEC.max, see SMOOTHING_AUTO_MAX).
      custom: import.meta.env.DEV
        ? customConfig(() => deps.currentSceneId(), () => ({ ...spec(), min: range.min, max: range.max }), resolveLive)
        : undefined,
    });
    row.onChange(onChange);
    return { row, getManual, defaultValue: range.defaultValue, onChange };
  }
  const inputRows = [
    makeInputRow(
      "Sensitivity",
      { min: SENSITIVITY_MIN, max: SENSITIVITY_MAX, defaultValue: SENSITIVITY_DEFAULT },
      deps.getSensitivitySpec,
      () => deps.getSensitivity(deps.currentSceneId()),
      () => deps.resolveSensitivityValue(deps.currentSceneId()),
      (value) => deps.onSensitivityChange(deps.currentSceneId(), value),
      "How hard the visuals react to the room",
    ),
    makeInputRow(
      "Expansion",
      { min: EXPANSION_MIN, max: EXPANSION_MAX, defaultValue: EXPANSION_DEFAULT },
      deps.getExpansionSpec,
      () => deps.getExpansion(deps.currentSceneId()),
      () => deps.resolveExpansionValue(deps.currentSceneId()),
      (value) => deps.onExpansionChange(deps.currentSceneId(), value),
      "Distance between the quiet parts and the loud parts",
    ),
    // zeroAtMin: this slider's bottom is a carved-out Off stop, genuinely
    // unsmoothed (sensitivity.ts header). Auto never lands there
    // (SMOOTHING_SPEC.min in autoTune.ts stays SMOOTHING_MIN); only a
    // deliberate drag or R-reset-then-drag does.
    makeInputRow(
      "Smoothing",
      { min: SMOOTHING_MIN, max: SMOOTHING_MAX, defaultValue: SMOOTHING_DEFAULT, zeroAtMin: true },
      deps.getSmoothingSpec,
      () => deps.getSmoothing(deps.currentSceneId()),
      () => deps.resolveSmoothingValue(deps.currentSceneId()),
      (value) => deps.onSmoothingChange(deps.currentSceneId(), value),
      "How much the picture lags and softens the sound — drag to the bottom for Off, the meters panel's RAW chip with nothing left to bypass",
    ),
  ];
  function syncInputRows(): void {
    for (const { row, getManual } of inputRows) row.sync(getManual);
    // Not in inputRows (built separately) but need the same resync.
    autoGainRow.sync(() => deps.getAutoGain());
    syncSilenceGateRows();
  }

  // Source: one list of every pickable input plus Screen (sourcePref.ts for
  // mic-vs-display, inputDevice.ts for which device Mic opens). Not built
  // through createControlRow: a list of rows where a slider would sit. Left
  // out of the card's Reset chip (that resets per-scene taste, not a
  // device-wide choice) and out of inputRows (no Auto behavior).
  //
  // CRITICAL: refresh() runs on update()'s ~10Hz timer; rebuilding the row
  // list's DOM there breaks a click in progress (pointerdown lands on one
  // node, pointerup on its replacement, so no "click" fires). syncRowList()
  // rebuilds only when a structure key says the set of rows changed; every
  // other refresh() updates nodes in place.
  const sourceListStyle = `display: flex; flex-direction: column; gap: 4px; margin-top: 4px;`;
  // One row: [dot or glyph] [name + optional dim sub-line] [meter] [kind tag].
  const sourceRowStyle = `
    display: grid; grid-template-columns: 12px 1fr auto; gap: 8px; align-items: center;
    width: 100%; box-sizing: border-box; text-align: left; cursor: pointer;
    background: transparent; color: rgba(255,255,255,0.75);
    border: 1px solid rgba(255,255,255,0.14); border-radius: 4px; padding: 7px 8px;
    font: 400 12.5px/1.25 ${FONT_LABEL};
  `;
  // Live = green border + tint: INPUT_GREEN like the gallery masthead's
  // .gal-src[data-state="live"] and this row's accent.
  const sourceRowLiveStyle = `${sourceRowStyle} border-color: ${withAlpha(INPUT_GREEN, 0.7)}; background: ${withAlpha(INPUT_GREEN, 0.12)}; color: #fff;`;
  // Dashed = not a real, present option: the missing device and the Screen row.
  const sourceRowDashedStyle = `${sourceRowStyle} border-style: dashed; border-color: rgba(255,255,255,0.22); color: rgba(255,255,255,0.55);`;
  const sourceRowDotStyle = `width: 8px; height: 8px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.45); box-sizing: border-box;`;
  const sourceRowDotLiveStyle = `${sourceRowDotStyle} background: ${INPUT_GREEN}; border-color: ${INPUT_GREEN};`;
  // The name truncates (device names run long); the sub-line wraps, since a
  // truncation would cut its hint in half.
  const sourceRowNameWrapStyle = `min-width: 0; display: flex; flex-direction: column;`;
  const sourceRowNameStyle = `display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
  const sourceRowSubStyle = `display: block; white-space: normal; font: 400 10.5px/1.3 ${FONT_MONO}; color: rgba(255,255,255,0.45);`;
  // Amber (BANDS_AMBER) so "not connected" reads as a warning.
  const sourceRowSubWarnStyle = `${sourceRowSubStyle} color: ${BANDS_AMBER};`;
  const sourceRowRightStyle = `display: flex; align-items: center; gap: 8px; flex-shrink: 0;`;
  // Kind tag (inputDevice.ts's inputKind): neutral for a mic, INPUT_GREEN for
  // a line input, cool violet-blue for a loopback driver.
  const sourceTagStyle = `
    font: 400 9px/1 ${FONT_MONO}; letter-spacing: 0.1em; text-transform: uppercase;
    padding: 3px 5px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.22);
    color: rgba(255,255,255,0.6); white-space: nowrap; flex-shrink: 0;
  `;
  const sourceTagLineStyle = `${sourceTagStyle} border-color: ${withAlpha(INPUT_GREEN, 0.45)}; color: ${INPUT_GREEN};`;
  const sourceTagLoopbackStyle = `${sourceTagStyle} border-color: rgba(150,170,255,0.45); color: #a9b6ff;`;
  const SOURCE_TAG_STYLE: Record<InputKind, string> = {
    mic: sourceTagStyle,
    line: sourceTagLineStyle,
    loopback: sourceTagLoopbackStyle,
  };
  // Level meter for the live row (green, taller) and an idle row's signal
  // preview (grey, shorter; inputPreview.ts). Segment nodes are built once;
  // only their style changes, per update() tick, not refresh() (CRITICAL
  // above).
  const SOURCE_METER_SEGMENTS = 12;
  const sourceMeterStyle = (tall: boolean) =>
    `display: inline-grid; grid-template-columns: repeat(${SOURCE_METER_SEGMENTS}, 3px); gap: 1.5px; height: ${tall ? 9 : 7}px; align-items: stretch; flex-shrink: 0;`;
  const sourceMeterSegLiveOnStyle = `background: ${INPUT_GREEN}; border-radius: 1px;`;
  const sourceMeterSegLiveOffStyle = `background: rgba(255,255,255,0.12); border-radius: 1px;`;
  const sourceMeterSegIdleOnStyle = `background: rgba(255,255,255,0.35); border-radius: 1px;`;
  const sourceMeterSegIdleOffStyle = `background: rgba(255,255,255,0.08); border-radius: 1px;`;
  // The "N hidden" line under the device rows: dim text that opens Edit,
  // quiet enough never to read as an input.
  const sourceHiddenLineStyle = `align-self: flex-start; margin-top: 2px; padding: 2px 0; background: none; border: 0; cursor: pointer; font: 400 10.5px/1.3 ${FONT_MONO}; color: rgba(255,255,255,0.4); text-decoration: underline dotted rgba(255,255,255,0.25); text-underline-offset: 3px;`;
  const sourceScreenCaptionStyle = `margin-top: 10px; font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.35);`;
  // Always visible while Screen is active, not a .vc-hint: on touch a hint
  // shows only after the tap that already opened the picker (as
  // createTraceLegend in controlsKit.ts).
  const sourceGuideStyle = `margin-top: 6px; font: 400 11px/1.45 ${FONT_LABEL}; color: rgba(255,255,255,0.55);`;
  // Always on too: it answers "which is picked and is it listening". No
  // inline color: the .vc-src-status class (controlsTheme.ts) owns it so its
  // [data-prompting] shimmer override can win; an inline color would beat any
  // class rule.
  const sourceStatusStyle = `margin-top: 6px; font: 400 11px/1.45 ${FONT_LABEL};`;

  const SVG_NS = "http://www.w3.org/2000/svg";
  // A monitor glyph: Screen isn't a device, so it doesn't borrow the dot.
  function buildScreenGlyph(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "11");
    svg.setAttribute("viewBox", "0 0 14 11");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.2");
    svg.style.flexShrink = "0";
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", "0.6");
    rect.setAttribute("y", "0.6");
    rect.setAttribute("width", "12.8");
    rect.setAttribute("height", "8");
    rect.setAttribute("rx", "1");
    const stand = document.createElementNS(SVG_NS, "line");
    stand.setAttribute("x1", "7");
    stand.setAttribute("y1", "8.6");
    stand.setAttribute("x2", "7");
    stand.setAttribute("y2", "10.4");
    const base = document.createElementNS(SVG_NS, "line");
    base.setAttribute("x1", "4.3");
    base.setAttribute("y1", "10.4");
    base.setAttribute("x2", "9.7");
    base.setAttribute("y2", "10.4");
    svg.append(rect, stand, base);
    return svg;
  }

  // One row's live nodes, reused across refresh()es that keep the row list (CRITICAL above).
  interface SourceRowHandle {
    btn: HTMLButtonElement;
    dot: HTMLSpanElement | null;
    glyph: SVGSVGElement | null;
    name: HTMLSpanElement;
    sub: HTMLSpanElement;
    meter: HTMLSpanElement;
    segments: HTMLSpanElement[];
    tag: HTMLSpanElement | null;
    /** null for the Screen row and the pre-permission placeholder. */
    deviceId: string | null;
    isScreen: boolean;
    /** The chosen-but-absent device's row: dashed, fixed "not connected"
     *  sub-line. */
    isMissing: boolean;
    isLive: boolean; // set by refresh(), read by the per-tick meter update
    /** Build-time tooltip, which the live row's "tap to disconnect" replaces. */
    idleTitle?: string;
    /** What updateMeters last painted, so an unchanged tick skips every style write. */
    meterKey?: string;
  }

  function buildRow(kind: "device" | "screen"): SourceRowHandle {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vc-src-row"; // hover glow — controlsTheme.ts
    let dot: HTMLSpanElement | null = null;
    let glyph: SVGSVGElement | null = null;
    if (kind === "screen") {
      glyph = buildScreenGlyph();
    } else {
      dot = document.createElement("span");
      dot.style.cssText = sourceRowDotStyle;
    }
    const nameWrap = document.createElement("span");
    nameWrap.style.cssText = sourceRowNameWrapStyle;
    const name = document.createElement("span");
    name.style.cssText = sourceRowNameStyle;
    const sub = document.createElement("span");
    sub.style.cssText = sourceRowSubStyle;
    nameWrap.append(name, sub);
    const right = document.createElement("span");
    right.style.cssText = sourceRowRightStyle;
    const meter = document.createElement("span");
    const segments: HTMLSpanElement[] = [];
    for (let i = 0; i < SOURCE_METER_SEGMENTS; i++) {
      const seg = document.createElement("span");
      meter.appendChild(seg);
      segments.push(seg);
    }
    right.appendChild(meter);
    let tag: HTMLSpanElement | null = null;
    if (kind === "device") {
      tag = document.createElement("span");
      right.appendChild(tag);
    }
    btn.append(dot ?? glyph!, nameWrap, right);
    return {
      btn,
      dot,
      glyph,
      name,
      sub,
      meter,
      segments,
      tag,
      deviceId: null,
      isScreen: kind === "screen",
      isMissing: false,
      isLive: false,
    };
  }

  /** silent's wording depends on the live input kind (line, mic, loopback,
   *  screen share). Screen share comes from state.choice, a device from
   *  inputKind on liveLabel, defaulting to the mic wording like the "Listening
   *  to …" line. */
  function silentSourceText(state: SourceState, liveLabel: string | null): string {
    if (state.choice === "display") return "Nothing playing";
    const kind = liveLabel ? inputKind(liveLabel) : "mic";
    if (kind === "loopback") return "Nothing playing";
    if (kind === "line") return "No sound coming in — check the cable and the mixer's REC/booth level";
    return "The mic hears nothing";
  }

  /** The Source row's status line for a non-"ok" getInputHealth() reading
   *  (src/audio/inputHealth.ts header explains the kinds); null for "ok". Red
   *  only for clipping, the one kind with an obvious fix; the rest are amber
   *  nudges. */
  function inputHealthText(
    reading: InputHealthReading,
    state: SourceState,
    liveLabel: string | null,
  ): { text: string; warn: "amber" | "red" } | null {
    switch (reading.kind) {
      case "clipping": {
        const side = reading.channel === "left" ? " (left channel)" : reading.channel === "right" ? " (right channel)" : "";
        return { text: `Too loud — clipping. Turn down the mixer's level or the interface gain${side}`, warn: "red" };
      }
      case "skipping":
        return { text: "The audio keeps skipping — try another USB port or cable", warn: "amber" };
      case "hum":
        return { text: `Hum on the line (${reading.humHz ?? 50} Hz) — try the laptop on battery`, warn: "amber" };
      case "silent":
        return { text: silentSourceText(state, liveLabel), warn: "amber" };
      default:
        return null;
    }
  }

  function createSourceRow() {
    const el = document.createElement("div");
    el.className = "vc-row";
    el.style.setProperty("--vc-accent", INPUT_GREEN);

    const head = document.createElement("div");
    head.style.cssText = rowHeadStyle;
    const label = document.createElement("div");
    label.textContent = "Source";
    label.className = "vc-label";
    label.style.cssText = rowLabelStyle;
    head.appendChild(label);

    // Edit mode: tapping an input hides or shows it (inputDevice.ts's hidden
    // inputs). A mode, not a per-row ✕: rows are buttons already (no nesting)
    // and a hover-only control is unreachable on touch.
    let editing = false;
    const editBtn = createChipButton("Edit", "Hide inputs you never use, or show them again", () => {
      editing = !editing;
      refresh();
    });
    head.appendChild(editBtn);

    const hiddenLine = document.createElement("button");
    hiddenLine.type = "button";
    hiddenLine.style.cssText = sourceHiddenLineStyle;
    hiddenLine.addEventListener("click", () => {
      editing = true;
      refresh();
    });

    const list = document.createElement("div");
    list.style.cssText = sourceListStyle;
    const caption = document.createElement("div");
    caption.style.cssText = sourceScreenCaptionStyle;
    caption.textContent = "OR SHARE A TAB, WINDOW OR SCREEN";

    const guide = document.createElement("div");
    guide.style.cssText = sourceGuideStyle;
    guide.textContent = DISPLAY_SHARE_GUIDE;

    const status = document.createElement("div");
    status.className = "vc-src-status";
    status.style.cssText = sourceStatusStyle;

    el.append(head, list, guide, status);

    // The pre-permission placeholder has no deviceId or kind tag and starts
    // the mic instead of switching input.
    function buildPermissionRow(): SourceRowHandle {
      const row = buildRow("device");
      row.name.textContent = "Microphone";
      row.sub.textContent = "allow access to list every input";
      row.btn.title = "Listen with this device's microphone";
      row.btn.addEventListener("click", () => deps.onAudioSourceChange("mic"));
      return row;
    }

    function buildDeviceRow(deviceId: string, label: string): SourceRowHandle {
      const row = buildRow("device");
      row.name.textContent = label;
      row.deviceId = deviceId;
      const kind = inputKind(label);
      row.btn.title = INPUT_KIND_TEXT[kind].title;
      row.tag!.textContent = INPUT_KIND_TEXT[kind].tag;
      row.tag!.style.cssText = SOURCE_TAG_STYLE[kind];
      row.btn.addEventListener("click", () => {
        if (editing) {
          // The input being heard stays: hiding it would hide the answer to what you hear.
          if (row.isLive) return;
          deps.onInputHiddenChange(label, !isInputHidden(label));
          refresh();
          return;
        }
        if (row.isLive) {
          deps.onStopAudio();
          refresh();
          return;
        }
        deps.onInputDeviceChange(deviceId);
      });
      return row;
    }

    function buildMissingRow(pref: InputDevicePref): SourceRowHandle {
      const row = buildRow("device");
      row.name.textContent = pref.label;
      row.deviceId = pref.deviceId;
      row.isMissing = true;
      row.sub.style.cssText = sourceRowSubWarnStyle;
      row.sub.textContent = "not connected";
      const kind = inputKind(pref.label);
      row.btn.title = INPUT_KIND_TEXT[kind].title;
      row.tag!.textContent = INPUT_KIND_TEXT[kind].tag;
      row.tag!.style.cssText = SOURCE_TAG_STYLE[kind];
      row.btn.addEventListener("click", () => deps.onInputDeviceChange(pref.deviceId));
      return row;
    }

    function buildScreenRow(): SourceRowHandle {
      const row = buildRow("screen");
      row.name.textContent = "Screen share";
      // Apps aren't inputs, so they never appear above: a browser hears them
      // by sharing the app's window (sound only; sourcePref.ts's share-TYPE
      // paragraph) or the Entire screen.
      row.sub.textContent = "an app's sound: share its window (e.g. Spotify) — or Entire screen for everything";
      row.btn.title = "Share screen audio";
      row.btn.addEventListener("click", () => {
        if (row.isLive) {
          deps.onStopAudio();
          refresh();
          return;
        }
        deps.onAudioSourceChange("display");
      });
      return row;
    }

    let rows: SourceRowHandle[] = [];
    let structureKey = "";

    // Rebuilds the row list only when its content changed (CRITICAL note
    // above). Returns the live device's label.
    function syncRowList(): string | null {
      const devices = deps.getInputDevices();
      const canDisplay = deps.canCaptureDisplay();
      // Outside Edit a hidden input drops out unless it's the one being heard;
      // in Edit every input shows (hidden ones dimmed, see refresh()).
      const shown = devices.options.filter((o) => editing || !isInputHidden(o.label) || o.label === devices.liveLabel);
      const hiddenCount = devices.options.length - shown.length;
      const key = JSON.stringify([shown, devices.missing, devices.defaultLabel, canDisplay, editing, hiddenCount]);
      if (key !== structureKey) {
        structureKey = key;
        const next: SourceRowHandle[] = [];
        if (devices.options.length === 0) {
          next.push(buildPermissionRow());
        } else {
          for (const o of shown) next.push(buildDeviceRow(o.deviceId, o.label));
          if (devices.missing) next.push(buildMissingRow(devices.missing));
        }
        // Screen isn't an input, so Edit has nothing to do with it.
        if (canDisplay && !editing) next.push(buildScreenRow());
        rows = next;
        hiddenLine.textContent = `${hiddenCount} hidden — Edit to show`;
        // The caption sits directly above the Screen row, marking it as not a device.
        const children: Node[] = [];
        for (const row of rows) {
          if (row.isScreen) {
            if (hiddenCount > 0) children.push(hiddenLine);
            children.push(caption);
          }
          children.push(row.btn);
        }
        if (hiddenCount > 0 && !rows.some((r) => r.isScreen)) children.push(hiddenLine);
        list.replaceChildren(...children);
      }
      editBtn.textContent = editing ? "Done" : "Edit";
      editBtn.style.cssText = editing ? chipBtnLitStyle : chipBtnStyle;
      // Nothing to hide before the permission lists real inputs.
      editBtn.style.display = devices.options.length === 0 ? "none" : "";
      return devices.liveLabel;
    }

    function refresh(): void {
        const state = deps.getSourceState();
        el.style.display = state === null ? "none" : "";
        if (state === null) return;
        const liveLabel = syncRowList();
        const devices = deps.getInputDevices();
        for (const row of rows) {
          const isLive =
            state.live &&
            (row.isScreen ? state.choice === "display" : state.choice === "mic" && row.name.textContent === liveLabel);
          row.isLive = isLive;
          row.idleTitle ??= row.btn.title;
          row.btn.title = isLive && !editing ? "Listening — tap to disconnect" : row.idleTitle;
          // The missing and pre-permission rows' sub-lines are fixed at build
          // time; only a present device row's depends on live/default/kind.
          const label = row.name.textContent ?? "";
          const isHidden = row.deviceId !== null && !row.isMissing && isInputHidden(label);
          if (!row.isScreen && !row.isMissing && row.deviceId !== null) {
            const sub = editing
              ? isLive
                ? "listening — can't hide"
                : isHidden
                  ? "hidden — tap to show"
                  : "tap to hide"
              : isLive && devices.missing
                ? "filling in until it's back"
                : label === devices.defaultLabel
                  ? "System default"
                  : inputKind(label) === "loopback"
                    ? "this computer's own sound"
                    : "";
            // In place (liveText.ts): this runs every refresh tick, and the line
            // sits inside the row's button.
            setLiveText(row.sub, sub);
            row.sub.style.display = sub ? "block" : "none";
          }
          row.btn.style.cssText = isLive ? sourceRowLiveStyle : row.isMissing || row.isScreen ? sourceRowDashedStyle : sourceRowStyle;
          if (editing && isHidden) row.btn.style.opacity = "0.45";
          if (row.dot) row.dot.style.cssText = isLive ? sourceRowDotLiveStyle : sourceRowDotStyle;
          if (row.glyph) row.glyph.style.color = isLive ? INPUT_GREEN : "rgba(255,255,255,0.55)";
        }
        guide.style.display = state.choice === "display" && !editing ? "" : "none";
        // Shimmer while nothing's live: .vc-src-status[data-prompting] (controlsTheme.ts).
        status.toggleAttribute("data-prompting", !state.live && !editing);
        // inputHealth.ts's reading takes over the status line when the live
        // input isn't ok. Not while editing (that owns the line) or when
        // nothing's live.
        const warning = state.live && !editing ? inputHealthText(deps.getInputHealth() ?? { kind: "ok" }, state, liveLabel) : null;
        // Colour: .vc-src-status[data-warn] (controlsTheme.ts); removed, not
        // falsy, so its CSS rule doesn't match.
        if (warning) status.setAttribute("data-warn", warning.warn);
        else status.removeAttribute("data-warn");
        status.textContent = editing
          ? "Tap an input to hide or show it"
          : !state.live
            ? "Pick a source above"
            : warning
              ? warning.text
              : state.choice === "display"
                ? "Listening to screen share"
                : `Listening to ${liveLabel ?? "the microphone"}`;
    }

    return {
      el,
      refresh,
      /** Closing the panel leaves Edit, so it never reopens with taps that
       *  hide instead of pick. */
      endEdit(): void {
        editing = false;
      },
      // Meter segments only, per update() tick. `liveLevel` is this tick's
      // FeatureFrame.level; idle rows read deps.getInputLevel(id)
      // (inputPreview.ts), null where no preview is open: the meter keeps its
      // slot but shows no segments.
      updateMeters(liveLevel: number | null): void {
        for (const row of rows) {
          const level = row.isLive ? Math.min(1, Math.max(0, liveLevel ?? 0)) : row.deviceId ? deps.getInputLevel(row.deviceId) : null;
          const lit = level === null ? 0 : Math.round(level * SOURCE_METER_SEGMENTS);
          // Level is quantised and idle rows mostly sit at zero; assigning
          // cssText re-parses and invalidates style even for an identical string.
          const key = `${row.isLive ? 1 : 0}|${level === null ? "h" : lit}`;
          if (key === row.meterKey) continue;
          row.meterKey = key;
          row.meter.style.cssText = sourceMeterStyle(row.isLive);
          row.meter.style.visibility = level === null ? "hidden" : "visible";
          const onStyle = row.isLive ? sourceMeterSegLiveOnStyle : sourceMeterSegIdleOnStyle;
          const offStyle = row.isLive ? sourceMeterSegLiveOffStyle : sourceMeterSegIdleOffStyle;
          for (let i = 0; i < row.segments.length; i++) row.segments[i].style.cssText = i < lit ? onStyle : offStyle;
        }
      },
    };
  }
  const sourceRow = createSourceRow();

  // Auto-gain: how much of features.ts's per-band adaptive normalization
  // reaches the output. At the bottom the mic's real levels show (bass louder
  // than treble); at the top mics and rooms converge toward one look at the
  // cost of that balance, and a Bands boost clamps against a full band.
  // Linear, not log: it's a mix amount. Global per device, so left out of this
  // card's Reset chip (per-scene taste). Its "A" chip resolves from the room's
  // measured span (FeatureExtractor.bandSpanDb), not MUSIC_DIALS, which has no
  // dial for how much of the analyser's window the room uses, and eases slowly
  // (autoGain.ts's EASE_RATE) so the Dynamics history trace reads as room
  // drift.
  const autoGainRow = createControlRow({
    label: "Auto-gain",
    accent: INPUT_GREEN,
    min: AUTO_GAIN_MIN,
    max: AUTO_GAIN_MAX,
    defaultValue: AUTO_GAIN_DEFAULT,
    mapping: "linear",
    ...percentReadout,
    description:
      "How much each band is rescaled to fill the display. 0 shows the mic's real levels; higher flattens bass-vs-treble balance but converges different mics and rooms toward the same look.",
    auto: {
      isEnabled: () => deps.isAutoGainAuto(),
      toggle: (on) => deps.onAutoGainAutoToggle(on),
      resolveLive: () => deps.resolveAutoGain(),
      getManual: () => deps.getAutoGain(),
    },
    // One of the whole-mic Auto button's members (micAuto.ts header);
    // refreshMicAuto keeps its lit state honest.
    onAutoToggled: refreshMicAuto,
  });
  autoGainRow.onChange((value) => deps.onAutoGainChange(value));
  autoGainRow.sync(() => deps.getAutoGain());

  // Silence gate: two volume marks in FeatureFrame.level units (silenceGate.ts
  // for the why: relative onset detection misfiring on mic hiss in a quiet
  // room). Both rows share one `auto` block (isSilenceGateAuto /
  // resolveSilenceGate), resolved from silenceGate.ts's room-floor tracker, not
  // MUSIC_DIALS (nothing there describes how quiet a room is). One flag drives
  // both marks, so each row's `toggle` also refreshes the other's chip.
  // syncSilenceGateRows re-reads both manual marks after either drags, since
  // moving one can push the other.
  const silenceClosedRow = createControlRow({
    label: "Silence below",
    accent: INPUT_GREEN,
    min: SILENCE_GATE_MIN,
    max: SILENCE_GATE_MAX,
    defaultValue: SILENCE_GATE_CLOSED_DEFAULT,
    mapping: "linear",
    zeroAtMin: true,
    ...percentReadout,
    description:
      "Quieter than this on the Dynamics card's Level, the room counts as silent and no beat can fire. All the way down turns the gate off.",
    auto: {
      isEnabled: () => deps.isSilenceGateAuto(),
      toggle: (on) => {
        deps.onSilenceGateAutoToggle(on);
        silenceOpenRow.refreshChip();
      },
      resolveLive: () => deps.resolveSilenceGate().closed,
      getManual: () => deps.getSilenceGate().closed,
    },
    onAutoToggled: refreshMicAuto,
  });
  const silenceOpenRow = createControlRow({
    label: "Sound above",
    accent: INPUT_GREEN,
    min: SILENCE_GATE_MIN,
    max: SILENCE_GATE_MAX,
    defaultValue: SILENCE_GATE_OPEN_DEFAULT,
    mapping: "linear",
    ...percentReadout,
    description:
      "Louder than this, beats are detected exactly as before. Between the two marks a hit has to stand out more the quieter the room is.",
    auto: {
      isEnabled: () => deps.isSilenceGateAuto(),
      toggle: (on) => {
        deps.onSilenceGateAutoToggle(on);
        silenceClosedRow.refreshChip();
      },
      resolveLive: () => deps.resolveSilenceGate().open,
      getManual: () => deps.getSilenceGate().open,
    },
    onAutoToggled: refreshMicAuto,
  });
  function syncSilenceGateRows(): void {
    const marks = deps.getSilenceGate();
    silenceClosedRow.sync(() => marks.closed);
    silenceOpenRow.sync(() => marks.open);
  }
  silenceClosedRow.onChange((value) => {
    deps.onSilenceGateClosedChange(value);
    syncSilenceGateRows();
  });
  silenceOpenRow.onChange((value) => {
    deps.onSilenceGateOpenChange(value);
    syncSilenceGateRows();
  });
  syncSilenceGateRows();

  // The Input card's Auto button: hands the whole mic to auto in one tap
  // (micAuto.ts header). refreshMicAuto/toggleMicAuto live further down beside
  // refreshAutoMaster, which they overlap; the button is built here as part of
  // this card's header.
  const micAutoBtn = document.createElement("button");
  micAutoBtn.textContent = "Auto";
  micAutoBtn.title = "Auto for the whole mic — gain, silence gate, sensitivity, expansion, smoothing";
  micAutoBtn.style.cssText = micAutoStyle;
  micAutoBtn.addEventListener("click", () => toggleMicAuto());

  const inputCardHeaderRight = document.createElement("div");
  inputCardHeaderRight.style.cssText = inputCardHeaderRightStyle;
  inputCardHeaderRight.append(
    micAutoBtn,
    createChipButton("Reset", "Reset sensitivity, expansion and smoothing", () => {
      for (const { row, defaultValue, onChange } of inputRows) {
        onChange(defaultValue);
        // Clear the T restore point first: setValue() renders a row muted
        // while one is held.
        row.clearOff();
        row.setValue(defaultValue);
        row.refreshChip();
      }
      // onChange took those rows back to manual without a row's commit(), so onAutoToggled never heard.
      refreshMicAuto();
      refreshAutoMaster();
    }),
  );

  const inputCard = createCard({
    title: "Input",
    accent: INPUT_GREEN,
    right: inputCardHeaderRight,
  });
  markBlock(inputCard.title);
  inputCard.el.style.cssText += inputCardWashStyle;
  inputCard.body.append(
    sourceRow.el,
    spacer(),
    autoGainRow.el,
    spacer(),
    silenceClosedRow.el,
    spacer(),
    silenceOpenRow.el,
    spacer(),
    inputRows[0].row.el,
    spacer(),
    inputRows[1].row.el,
    spacer(),
    inputRows[2].row.el,
  );

  // Scene: per-scene look knobs; rebuilt on every open() since the rows depend on the active scene.
  const sceneCard = createCard({
    title: "Scene",
    accent: SCENE_VIOLET,
    right: createChipButton("Reset", "Reset every scene setting", () => {
      deps.onSceneSettingsReset(deps.currentSceneId());
      renderSceneSettings();
    }),
  });
  sceneCard.el.style.display = "none";
  const sceneRows = document.createElement("div");
  sceneCard.body.appendChild(sceneRows);
  // Cards a widget mounts beside the Scene card (WidgetCtx.mountCard,
  // registry.ts): a plain host right after it in the controls column. Cleared
  // at the top of every renderSceneSettings() like sceneRows, so a widget card
  // never survives a rebuild that didn't rebuild it. pinnableCards() and
  // findPinnedRowEl() search it too, since a registerCard row pins like a
  // Scene-card row but can live in either card.
  const sceneWidgetCardsHost = document.createElement("div");
  /** Every top-level card a Scene-setting row's pin can live in. */
  function pinnableCards(): HTMLElement[] {
    return [sceneCard.el, ...sceneWidgetCardsHost.querySelectorAll<HTMLElement>(":scope > .vc-card")];
  }
  /** The currently `.vc-drive-pinned` row, wherever it lives. */
  function findPinnedRowEl(): HTMLElement | null {
    for (const card of pinnableCards()) {
      const row = card.querySelector<HTMLElement>(".vc-drive-pinned");
      if (row) return row;
    }
    return null;
  }
  // What the per-tick loop and auto refresh need from a scene row; an enum
  // picker with `reads` supplies its own pair (appendSettingRow).
  interface SceneRowHandle {
    updateSignalPills(frame: FeatureFrame | null, anim: AnimFrame | null): void;
    refreshAuto(): void;
  }
  let sceneRowHandles: SceneRowHandle[] = [];
  // Cleanup callbacks from WidgetCtx.onDispose (widgets/registry.ts), run once before the next full rebuild.
  let widgetDisposers: (() => void)[] = [];

  // registry.ts's `appendRow` `linked` option, by the primary row's spec.key;
  // rebuilt on every renderSceneSettings(). `ownLabel` is the primary item's
  // short name, for a "Mixed — …" drive summary (buildDriveRow's refreshMeta).
  let linkedByKey: Map<string, { ownLabel?: string; linked: readonly LinkedSetting[] }> = new Map();

  // The scene the Scene card's rows were last built for. They are rebuilt
  // when the panel opens, so with it shut after a scene change the rows are
  // the previous scene's until something asks (midiCard.ts's applyCc).
  let renderedSceneId: string | null = null;

  // Looks: named snapshots of the Scene card's settings (sceneLooks.ts);
  // hidden with the Scene card when there are no settings.
  const looksCard = createLooksCard({
    currentSceneId: deps.currentSceneId,
    listLooks: deps.listLooks,
    onSaveLook: deps.onSaveLook,
    onRenameLook: deps.onRenameLook,
    onApplyLook: (look) => {
      deps.onApplyLook(look);
      renderSceneSettings();
    },
    onDeleteLook: deps.onDeleteLook,
    decodeLook: deps.decodeLook,
    buildShareLink: deps.buildShareLink,
    buildShareCode: deps.buildShareCode,
    hasUndo: deps.hasLookUndo,
    onUndoLook: (sceneId) => {
      deps.onUndoLook(sceneId);
      renderSceneSettings();
    },
  });

  // The Set: pads of looks from any scene, fired live (src/ui/setCard.ts).
  // Always shown, unlike Looks: a pad can switch scene, so it doesn't depend
  // on the active scene having settings.
  const setCard = createSetCard({
    ...deps.set,
    sceneName: (sceneId) => deps.getScene(sceneId)?.name ?? sceneId,
  });
  // Overlay: a text line and a logo drawn over the visuals (ui/overlayCard.ts);
  // independent of the scene, so it is always shown.
  const overlayCard = createOverlayCard(deps.overlay);

  // Writes each .vc-block heading's digit in document order; only
  // renderSceneSettings changes the block set. Blanks past the ninth rather
  // than doubling up on "9": those blocks aren't reachable by number.
  function renumberBlocks(): void {
    const blocks = root.querySelectorAll<HTMLElement>(".vc-block");
    blocks.forEach((heading, i) => {
      const badge = heading.querySelector<HTMLElement>(".vc-block-n");
      if (badge) badge.textContent = i < 9 ? String(i + 1) : "";
    });
  }

  // SignalSpec.bandRange (signals.ts) against the live split, since
  // bandSplit.ts's crossover is user-configurable.
  function resolveBandRange(kind: "all" | "low" | "mid" | "high", split: BandSplit): { lo: number; hi: number } {
    switch (kind) {
      case "low":
        return { lo: 0, hi: split.lowMid };
      case "mid":
        return { lo: split.lowMid, hi: split.midHigh };
      case "high":
        return { lo: split.midHigh, hi: NUM_BANDS };
      case "all":
        return { lo: 0, hi: NUM_BANDS };
    }
  }

  // Lights the bands a signal-linked row listens to on the spectrum strip
  // while it's touched (hover, focus, drag). No-op without `reads`, or for
  // band-agnostic ones (drop detection); a drive setting declares no static
  // `reads` (signals.ts header), its jacks and cables do that job. Recomputed
  // on every `input`: dragging Ripple source across its threshold changes the
  // active signal (RIPPLE_SRC_BEAT_THRESHOLD in caustics.ts).
  function wireBandHighlight(el: HTMLElement, reads: ResolvedSignalRead[] | undefined): void {
    const withRange = reads?.filter((r) => r.signal.bandRange !== undefined);
    if (!withRange?.length) return;

    function show(): void {
      const split = deps.getBandSplit();
      let lo = NUM_BANDS;
      let hi = 0;
      let any = false;
      for (const r of withRange!) {
        if (!r.active()) continue;
        const range = resolveBandRange(r.signal.bandRange!, split);
        lo = Math.min(lo, range.lo);
        hi = Math.max(hi, range.hi);
        any = true;
      }
      spectrumStrip.setHighlight(any ? { lo, hi } : null);
      spectrumStrip.redraw();
    }
    function hide(): void {
      spectrumStrip.setHighlight(null);
      spectrumStrip.redraw();
    }

    el.addEventListener("pointerenter", show);
    el.addEventListener("focusin", show);
    el.addEventListener("input", show); // dragging can switch which read is active
    el.addEventListener("pointerleave", hide);
    el.addEventListener("focusout", hide);
  }


  // Builds one setting's row (enum picker, boolean toggle or slider) into
  // `container`, shared by the direct and advanced-section paths. `specs` is
  // the scene's full list, used only to resolve a SignalLink.activeWhen against
  // a sibling by key. `accent` is a family's colour for a family row; the A/T
  // chips are styled from it directly, not from `--vc-accent`.
  // `opts.linked`/`opts.ownLabel` are registry.ts's `appendRow` multi-item
  // bridge (see its doc comment); `setLinkedValue` is the one choke point for
  // plain value edits, so `linked` is threaded once. A patch edit's choke point
  // is `patchChanged`/`syncLinkedDriveSetting`: it never goes through
  // deps.onSceneSettingChange.
  function appendSettingRow(
    container: HTMLElement,
    sceneId: string,
    spec: SceneSetting,
    specs: SceneSetting[],
    accent: string = SCENE_VIOLET,
    opts?: { ownLabel?: string; linked?: readonly LinkedSetting[] },
  ): void {
    const linked = opts?.linked ?? [];
    if (linked.length) linkedByKey.set(spec.key, { ownLabel: opts?.ownLabel, linked });

    function setLinkedValue(value: number): void {
      deps.onSceneSettingChange(sceneId, spec, value);
      for (const l of linked) deps.onSceneSettingChange(sceneId, l.spec, value);
    }

    // A sibling setting's live value by key, for SignalLink.activeWhen
    // (signals.ts). 0 for an unknown key rather than throwing;
    // tests/signals.test.ts's key check catches typos.
    const getSiblingSetting = (key: string): number => {
      const sibling = specs.find((s) => s.key === key);
      return sibling ? deps.resolveSceneSettingValue(sceneId, sibling) : 0;
    };
    const reads: ResolvedSignalRead[] | undefined = spec.reads?.map((link) => {
      const id = typeof link === "string" ? link : link.signal;
      const activeWhen = typeof link === "string" ? undefined : link.activeWhen;
      const signalSpec = SIGNALS[id];
      return {
        signal: signalSpec,
        active: activeWhen ? () => activeWhen(getSiblingSetting) : () => true,
        onReveal: signalSpec.monitor
          ? () => {
              if (isFolded(METERS_COLUMN)) setMetersHidden(false);
              audioMeters.revealRow(signalSpec.monitor!.card, signalSpec.monitor!.row);
            }
          : undefined,
      };
    });

    // The preview signal (see previewDrive), for every row type so focusing a
    // non-drive row also clears a previous preview. Pointer-originated focus
    // (wireHoverFocus's pointerFocusOriginated) waits HOVER_SELECT_DELAY_MS,
    // canceled by a newer focusin (cancelPendingPreview) or this row losing
    // focus (wirePreviewFocus), so a fast sweep toward the spectrum strip
    // leaves the starting preview alone. Keyboard/click focus previews at
    // once. Never touches `pinned`.
    function onRowFocusIn(): void {
      cancelPendingPreview();
      const next = spec.drive ? { sceneId, spec } : null;
      if (pointerFocusOriginated) {
        pendingPreviewTimer = setTimeout(() => {
          pendingPreviewTimer = null;
          previewDrive(next);
        }, HOVER_SELECT_DELAY_MS);
      } else {
        previewDrive(next);
      }
    }

    /** Makes this row pinnable (pinRowHandles). A drive row brings its handle;
     *  any other row's `main` control is passed so a press on it or its card
     *  pins (registerPinnableRow, shared with WidgetCtx.registerCard). */
    function registerPinRow(rowEl: HTMLElement, drive: DriveRowHandle | null, main?: HTMLElement | null): void {
      if (drive) {
        if (main) {
          rowEl.addEventListener("click", (e) => {
            if (isCardPress(rowEl, main, e.target)) pinSetting(sceneId, spec);
          });
        }
        pinRowHandles.push(drive);
        return;
      }
      registerPinnableRow(sceneId, spec, accent, rowEl, main);
    }

    /** Wires `el`'s focusin to onRowFocusIn, and a focusout that cancels a
     *  still-pending hover preview when focus leaves for somewhere that never
     *  calls onRowFocusIn (spectrum strip, meters, another card). `el` is the
     *  whole row, so a focus change within it isn't a leave. */
    function wirePreviewFocus(el: HTMLElement): void {
      el.addEventListener("focusin", onRowFocusIn);
      el.addEventListener("focusout", (e) => {
        if (!el.contains(e.relatedTarget as Node | null)) cancelPendingPreview();
      });
    }

    if (spec.type === "enum" && spec.options) {
      // An enum's `reads` get the same chip + pill strip a slider builds in
      // createControlRow; here the host builds it (PickerRowSpec.signals). The
      // pills show which trigger the current choice rides, for pickers that
      // choose what the scene listens to.
      const signals = reads?.length
        ? createSignalStrip(
            reads.map((r) => ({ label: r.signal.label, description: r.signal.description, onReveal: r.onReveal })),
            accent,
          )
        : undefined;
      const picker = createPickerRow({
        label: spec.label,
        accent,
        options: spec.options,
        pro: spec.proOptions ? (i) => spec.proOptions!.includes(spec.options![i]) : undefined,
        locked: spec.proOptions ? (i) => isProLocked(spec, i) : undefined,
        defaultValue: deps.getSceneSettingDefault(sceneId, spec),
        description: spec.description,
        get: () => deps.getSceneSettingValue(sceneId, spec),
        set: (value) => {
          setLinkedValue(value);
          // A variant switch swaps every other row's profile (values,
          // defaults, auto state), so the card is rebuilt around it.
          if (spec.variant) renderSceneSettings();
        },
        wire: (row, strip, a) => {
          wireHoverFocus(row, strip);
          wireRowKeys(strip, { reset: a.reset, toggleOff: () => a.cycle(1) });
        },
        signals,
      });
      wirePreviewFocus(picker.el);
      registerPinRow(picker.el, null, picker.el.querySelector<HTMLElement>(".vc-picker"));
      container.appendChild(picker.el);
      if (signals && reads) {
        sceneRowHandles.push({
          // Same shape as createControlRow's own updateSignalPills.
          updateSignalPills: (frame, anim) =>
            signals.update(
              reads.map((r) => ({
                value: frame && anim ? r.signal.read(frame, anim) : 0,
                active: r.active(),
              })),
            ),
          refreshAuto: () => {},
        });
        wireBandHighlight(picker.el, reads);
      }
      return;
    }
    if (spec.type === "boolean") {
      // A trigger toggle gets the same port and patch panel as a slider, so its signal can be rewired.
      const toggleDrive = spec.drive ? buildDriveRow(sceneId, spec) : null;
      const toggleEl = createToggleRow({
        label: spec.label,
        accent,
        defaultValue: deps.getSceneSettingDefault(sceneId, spec),
        description: spec.description,
        get: () => deps.getSceneSettingValue(sceneId, spec),
        set: setLinkedValue,
        drivePanel: toggleDrive
          ? { port: toggleDrive.port, summary: toggleDrive.summary, below: toggleDrive.below, onPin: () => togglePin(sceneId, spec) }
          : undefined,
      });
      wirePreviewFocus(toggleEl);
      container.appendChild(toggleEl);
      const toggleHandle = toggleDrive ? toggleDrive.bind(toggleEl) : null;
      if (toggleHandle) driveRowHandles.push(toggleHandle);
      registerPinRow(toggleEl, toggleHandle, toggleEl.querySelector<HTMLElement>(".vc-toggle"));
      return;
    }

    // A drive-capable setting gets the patch bay's port/summary/sparkline:
    // built before the row (createControlRow's `drivePanel` needs them) and
    // bound after (the pinned-row highlight needs the element); see
    // buildDriveRow.
    const driveBuild = spec.drive ? buildDriveRow(sceneId, spec) : null;

    const row = createControlRow({
      label: spec.label,
      accent,
      midi: { id: sceneTargetId(sceneId, spec.key), label: `${deps.getScene(sceneId)?.name ?? sceneId} · ${spec.label}` },
      min: spec.min,
      max: spec.max,
      step: spec.step,
      defaultValue: deps.getSceneSettingDefault(sceneId, spec),
      mapping: "linear",
      format: formatSetting,
      description: spec.description,
      // A macro-driven setting is auto-capable like an `auto` one (it tracks
      // another setting, not the music profile): same A chip and refresh.
      auto: spec.auto || spec.macro
        ? {
            isEnabled: () => deps.isSettingAutoEnabled(sceneId, spec.key),
            toggle: (on) => {
              deps.onSettingAutoToggle(sceneId, spec, on);
              for (const l of linked) deps.onSettingAutoToggle(sceneId, l.spec, on);
            },
            resolveLive: () => deps.resolveSceneSettingValue(sceneId, spec),
            getManual: () => deps.getSceneSettingValue(sceneId, spec),
          }
        : undefined,
      // isSceneAuto is true only while every auto-capable row is auto, so any row's A chip or drag off auto flips the master bar.
      onAutoToggled: refreshAutoMaster,
      custom: customConfig(() => sceneId, () => spec, () => deps.resolveSceneSettingValue(sceneId, spec)),
      reads,
      drivePanel: driveBuild
        ? { port: driveBuild.port, summary: driveBuild.summary, below: driveBuild.below, onPin: () => togglePin(sceneId, spec) }
        : undefined,
      onlyThis: spec.drive ? { sceneId, key: spec.key } : undefined,
      onCardPin: () => pinSetting(sceneId, spec),
      linkedTicks: linked.length
        ? linked.map((l) => ({ value: deps.getSceneSettingValue(sceneId, l.spec), colour: l.colour }))
        : undefined,
    });
    row.onChange((value) => {
      setLinkedValue(value);
      if (linked.length) row.setLinkedTicks(linked.map((l) => ({ value, colour: l.colour })));
    });
    row.sync(() => deps.getSceneSettingValue(sceneId, spec));
    wirePreviewFocus(row.el);
    container.appendChild(row.el);
    sceneRowHandles.push(row);
    const driveHandle = driveBuild ? driveBuild.bind(row.el) : null;
    if (driveHandle) driveRowHandles.push(driveHandle);
    registerPinRow(row.el, driveHandle);
    wireBandHighlight(row.el, reads);
  }

  /** registry.ts's `WidgetCtx.mountRows`: a scoped sibling of appendSettingRow
   *  that builds `rows` into one host div, snapshotting the handle arrays so
   *  `dispose()` unregisters exactly what it added (and its `linkedByKey`
   *  entries). Mirrors renderSceneSettings's pinned-row reconciliation for
   *  these rows, so a mount that recreates the pinned row picks the patch
   *  panel back up. See registry.ts's header for why a widget (itemBoxes.ts)
   *  uses this instead of `ctx.rerender()`. */
  function mountRows(
    container: HTMLElement,
    sceneId: string,
    specs: SceneSetting[],
    rows: readonly { spec: SceneSetting; ownLabel?: string; linked?: readonly LinkedSetting[]; portHost?: HTMLElement }[],
  ): { dispose(): void } {
    const host = document.createElement("div");
    container.appendChild(host);

    const sceneRowStart = sceneRowHandles.length;
    const driveRowStart = driveRowHandles.length;
    const sparkStart = driveSparkCanvases.length;
    const pinRowStart = pinRowHandles.length;
    for (const r of rows) appendSettingRow(host, sceneId, r.spec, specs, SCENE_VIOLET, { ownLabel: r.ownLabel, linked: r.linked });

    const addedSceneRows = sceneRowHandles.slice(sceneRowStart);
    const addedDriveRows = driveRowHandles.slice(driveRowStart);
    const addedSparks = driveSparkCanvases.slice(sparkStart);
    // Every row registers here too (registerPinRow), drive or not.
    const addedPinRows = pinRowHandles.slice(pinRowStart);
    // A row's port moved out to where the widget drew it (`portHost`): it is
    // still this row's `portEl`, so the cables end there.
    const movedPorts: HTMLElement[] = [];
    for (const r of rows) {
      if (!r.portHost) continue;
      const h = addedDriveRows.find((d) => d.spec.key === r.spec.key);
      if (!h) continue;
      r.portHost.appendChild(h.portEl);
      h.rowEl.classList.add("vc-port-moved");
      movedPorts.push(h.portEl);
    }

    if (pinned) {
      const stillHere = addedPinRows.find((r) => r.sceneId === pinned!.sceneId && r.spec.key === pinned!.spec.key);
      stillHere?.refreshPin();
    }
    // A pin handed off by the previous mount's dispose: re-pin the same
    // per-item control on this mount's item, so switching items keeps the
    // patch bay aimed at it.
    const handoff = pinHandoff;
    pinHandoff = null;
    if (handoff && !pinned) {
      const same = rows.find(
        (r) =>
          r.spec.item?.family === handoff.family &&
          r.spec.item.param === handoff.param &&
          r.spec.item.other === handoff.other,
      );
      if (same) pinSetting(sceneId, same.spec);
    }

    let disposed = false;
    return {
      dispose(): void {
        if (disposed) return;
        disposed = true;
        sceneRowHandles = sceneRowHandles.filter((h) => !addedSceneRows.includes(h));
        driveRowHandles = driveRowHandles.filter((h) => !addedDriveRows.includes(h));
        pinRowHandles = pinRowHandles.filter((h) => !addedPinRows.includes(h));
        for (const c of addedSparks) untrackDriveCanvas(c);
        driveSparkCanvases = driveSparkCanvases.filter((c) => !addedSparks.includes(c));
        for (const r of rows) linkedByKey.delete(r.spec.key);
        host.remove();
        for (const port of movedPorts) port.remove();
        const ownsKey = (p: { sceneId: string; spec: SceneSetting } | null): boolean =>
          p !== null && p.sceneId === sceneId && rows.some((r) => r.spec.key === p.spec.key);
        // Never leave the pin (or preview) on a row that no longer exists;
        // remember the per-item control so the next mountRows can re-pin its
        // counterpart.
        if (ownsKey(pinned)) {
          const item = pinned!.spec.item;
          togglePin(pinned!.sceneId, pinned!.spec);
          pinHandoff = item ? { family: item.family, param: item.param, other: item.other } : null;
        }
        if (ownsKey(preview)) previewDrive(null);
        refreshPatchHighlight();
      },
    };
  }

  function renderSceneSettings(): void {
    const sceneId = deps.currentSceneId();
    renderedSceneId = sceneId;
    const specs = deps.getSceneSettings(sceneId);
    sceneRows.innerHTML = "";
    sceneWidgetCardsHost.innerHTML = "";
    sceneRowHandles = [];
    for (const c of driveSparkCanvases) untrackDriveCanvas(c);
    driveSparkCanvases = [];
    driveRowHandles = [];
    pinRowHandles = [];
    linkedByKey = new Map();
    for (const dispose of widgetDisposers) dispose();
    widgetDisposers = [];
    sceneCard.el.style.display = specs.length === 0 ? "none" : "";
    looksCard.el.style.display = specs.length === 0 ? "none" : "";
    looksCard.refresh();
    refreshAutoMaster();
    // Not scene-specific, but the one place already re-syncing on every
    // open()/scene-change/Look apply; mic-auto has per-scene and device-wide
    // members (micAuto.ts header), so piggybacking avoids a stale button.
    refreshMicAuto();

    let lastGroup: string | undefined;
    let first = true;
    let hasGroups = false;
    // The open advanced-section body a run of spec.advanced entries appends
    // into; null between runs, reset at a group heading.
    let advancedBody: HTMLElement | null = null;
    // familyAccents hands out FAMILY_ACCENTS in the order family names are
    // first seen (wrapping), fixed for this render so a family keeps one colour.
    const familyAccents = new Map<string, string>();
    const accentForFamily = (family: string): string => {
      let accent = familyAccents.get(family);
      if (!accent) {
        accent = FAMILY_ACCENTS[familyAccents.size % FAMILY_ACCENTS.length];
        familyAccents.set(family, accent);
      }
      return accent;
    };

    // Scene-declared item widgets (sceneItems.ts, Scene.panel) render first in
    // this card (widgets/registry.ts header); the flat loop below skips every
    // setting whose `item.family` a section claims.
    const scene = deps.getScene(sceneId);
    const panelSections = scene?.panel ?? [];
    const claimedFamilies = new Set(
      panelSections.map((s) => s.items).filter((x): x is string => x !== undefined),
    );
    // Plain settings a section renders itself (PanelSection.settings) are skipped too.
    const claimedKeys = new Set(panelSections.flatMap((s) => s.settings ?? []));
    for (const section of panelSections) {
      const build = getWidget(section.widget);
      // tests/sceneKeys.test.ts checks widget ids are registered; a missing
      // one renders nothing rather than throwing in a live panel.
      if (!build) continue;
      hasGroups = true;
      const heading = groupHeading(section.title, first);
      markBlock(heading);
      sceneRows.appendChild(heading);
      first = false;
      const host = document.createElement("div");
      sceneRows.appendChild(host);

      const tickFns: (() => void)[] = [];
      const ctx: WidgetCtx = {
        sceneId,
        specs,
        specsFor: (family, index) =>
          specs.filter((s) => s.item?.family === family && (index === undefined || s.item.index === index)),
        get: (spec) => deps.getSceneSettingValue(sceneId, spec),
        set: (spec, value) => deps.onSceneSettingChange(sceneId, spec, value),
        appendRow: (rowContainer, spec, opts) => appendSettingRow(rowContainer, sceneId, spec, specs, SCENE_VIOLET, opts),
        mountRows: (rowContainer, rows) => mountRows(rowContainer, sceneId, specs, rows),
        portLook: (portSpecs) => portLookFor(sceneId, portSpecs),
        pin: (spec) => pinSetting(sceneId, spec),
        getDrive: (spec) => deps.getDriveSetting(sceneId, spec),
        setDrive: (spec, setting) => setDriveFromWidget(sceneId, spec, setting),
        mountCard: (spec) => {
          const card = createCard(spec);
          // Own class so a script (padcheck.mjs) can find a widget-mounted card without matching its title.
          card.el.classList.add("vc-widget-card");
          markBlock(card.title);
          sceneWidgetCardsHost.appendChild(card.el);
          return { el: card.el, body: card.body };
        },
        registerCard: (rowEl, spec) => registerPinnableRow(sceneId, spec, SCENE_VIOLET, rowEl, rowEl),
        // The exact reading a row's sparkline draws (WidgetCtx.driveValue, registry.ts).
        driveValue: (spec, rest) => lastDrives?.valueOf(spec.key, rest) ?? rest ?? 0,
        probe: () => deps.getScene(sceneId)?.probe?.() ?? null,
        command: (name, args) => deps.getScene(sceneId)?.command?.(name, args),
        onTick: (fn) => tickFns.push(fn),
        onDispose: (fn) => widgetDisposers.push(fn),
        // A whole-card rebuild, not a DOM patch of this section (registry.ts header says why).
        rerender: () => renderSceneSettings(),
      };
      build(host, section, ctx);
      if (tickFns.length > 0) {
        sceneRowHandles.push({
          updateSignalPills: () => {
            for (const fn of tickFns) fn();
          },
          refreshAuto: () => {},
        });
      }
    }

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      if (spec.item && claimedFamilies.has(spec.item.family)) continue;
      if (claimedKeys.has(spec.key)) continue;
      const groupChanged = spec.group !== undefined && spec.group !== lastGroup;
      if (groupChanged) {
        hasGroups = true;
        advancedBody = null;
        const heading = groupHeading(spec.group!, lastGroup === undefined);
        markBlock(heading);
        sceneRows.appendChild(heading);
      }
      lastGroup = spec.group;

      if (spec.advanced) {
        // Families don't reach into an advanced run (SceneSetting.family in sceneSettings.ts).
        if (!advancedBody) {
          if (!groupChanged && !first) sceneRows.appendChild(spacer());
          let count = 1;
          for (let j = i + 1; j < specs.length && specs[j].advanced; j++) count++;
          const noun = count === 1 ? "control" : "controls";
          const section = createAdvancedSection(
            `scene:${sceneId}:${spec.group ?? ""}:advanced`,
            `${count} ${(spec.group ?? "").toLowerCase()} ${noun}`.trim(),
          );
          sceneRows.appendChild(section.el);
          advancedBody = section.body;
        } else {
          advancedBody.appendChild(spacer());
        }
        appendSettingRow(advancedBody, sceneId, spec, specs);
        first = false;
        continue;
      }
      advancedBody = null;

      if (!groupChanged && !first) sceneRows.appendChild(spacer());
      first = false;
      // A family's colour is the row's `accent` (not a --vc-accent override) so
      // the A/T chips, styled from that parameter, tint too.
      const accent = spec.family !== undefined ? accentForFamily(spec.family) : SCENE_VIOLET;
      appendSettingRow(sceneRows, sceneId, spec, specs, accent);
    }

    // The Scene card title is the block only when the scene has settings but
    // no group headings; otherwise it and the first group heading would
    // resolve to the same row. tests/settingGroups.test.ts requires grouping
    // (SETTING_GROUPS in sceneSettings.ts), so this stays dead until a scene
    // goes ungrouped.
    if (specs.length > 0 && !hasGroups) markBlock(sceneCard.title);
    else unmarkBlock(sceneCard.title);
    renumberBlocks();

    // A preview never survives a rebuild (its row may be gone, e.g. after a
    // variant switch). A pin survives if its (sceneId, key) is found in the new
    // rows; otherwise it's dropped, including on a real scene switch (every new
    // row carries the new sceneId).
    preview = null;
    cancelPendingPreview();
    if (pinned) {
      const stillHere = pinRowHandles.find((r) => r.sceneId === pinned!.sceneId && r.spec.key === pinned!.spec.key);
      if (stillHere) stillHere.refreshPin();
      else {
        pinned = null;
        lastPinnedSetting = null;
        // The old output graph went with its patch panel: stop update() redrawing it.
        activeOutputTick = null;
      }
    }
    // A jack click with nothing pinned reaches for lastPreview: drop it on a
    // scene switch so a click can't pin a setting on the scene just left.
    if (lastPreview && lastPreview.sceneId !== sceneId) lastPreview = null;
    refreshLineMode();
    refreshPatchHighlight();
    // Rows were just rebuilt unmarked: re-hide around the solo.
    if (soloOn) applySolo();
  }

  // Palette: the only picker left in the panel.
  const paletteCard = createCard({ title: "Palette", accent: "rgba(255,255,255,0.7)" });
  const paletteList = document.createElement("div");
  paletteList.style.cssText = paletteGroupsStyle;
  paletteCard.body.appendChild(paletteList);

  function renderPalettes(): void {
    paletteList.innerHTML = "";
    const currentId = deps.currentPaletteId();
    const rows = new Map<string, HTMLDivElement>();
    for (const item of deps.getPalettes()) {
      let row = rows.get(item.group);
      if (!row) {
        row = document.createElement("div");
        row.style.cssText = paletteGroupRowStyle;
        const label = document.createElement("span");
        label.textContent = item.group;
        label.style.cssText = paletteGroupLabelStyle;
        row.appendChild(label);
        rows.set(item.group, row);
        paletteList.appendChild(row);
      }
      const btn = document.createElement("button");
      btn.style.cssText = item.id === currentId ? paletteSwatchChipLitStyle : paletteSwatchChipStyle;
      const swatch = document.createElement("span");
      swatch.style.cssText = `${paletteSwatchStyle} background: linear-gradient(90deg, ${item.swatch.join(", ")});`;
      btn.append(swatch, item.name);
      btn.addEventListener("click", () => {
        deps.onPickPalette(item.id);
        // Stay open: tapping through palettes to watch the scene recolor is the point.
        renderPalettes();
      });
      row.appendChild(btn);
    }
  }

  // Footer strip: view toggles and a way out, in the column that never hides
  // (a chip above Bands needed its own row and pushed the column out of line
  // with Power and the Auto bar). The dock is sticky to the bottom (.vc-dock,
  // controlsTheme.ts): at the bottom of the scroll the buttons were out of
  // sight whenever the column overflowed.
  const footer = document.createElement("div");
  footer.style.cssText = footerStyle;
  // data-key/data-keycap (keyHints.ts): each button is the control its
  // shortcut performs, tagged at creation; the hover tooltip, held-Shift
  // keycap and keys-list flash (targetsFor) key off it.
  function makeFooterBtn(id: string, keycap: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.cssText = footerBtnStyle;
    btn.classList.add("vc-keycap-anchor");
    btn.dataset.key = id;
    btn.dataset.keycap = keycap;
    btn.addEventListener("click", onClick);
    return btn;
  }
  const keysBtn = makeFooterBtn("keys", "?", () => setKeysShown(!keysCard.classList.contains("vc-keys-show")));
  keysBtn.textContent = "Keys  ?";
  keysBtn.title = "Show the keyboard shortcuts (?)";
  const soloBtn = makeFooterBtn("solo", "O", () => setSolo(!soloOn));
  const metersBtn = makeFooterBtn("left", "M", () => setMetersHidden(!isFolded(METERS_COLUMN)));
  const hideBtn = makeFooterBtn("hide", "H", () => close());
  hideBtn.textContent = "Hide UI  H";
  hideBtn.title = "Close the panel (H)";
  footer.append(keysBtn, soloBtn, metersBtn, hideBtn);

  // The keys list behind "Keys": one row per keyHints.ts SHORTCUTS entry,
  // built here since a row is also this file's hover/click target. Hover
  // flashes every visible `[data-key="<id>"]` control (targetsFor/flashOn;
  // capped, a busy scene carries many A/R/T chips); click performs
  // singleAction where one exists, else re-flashes.
  const keysCard = document.createElement("div");
  keysCard.className = "vc-keys";

  function targetsFor(id: string): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(`[data-key="${id}"]`)]
      .filter((el) => el.getClientRects().length > 0)
      .slice(0, 12);
  }
  function clearFlash(): void {
    for (const el of [...document.querySelectorAll(".vc-key-flash")]) el.classList.remove("vc-key-flash");
  }
  function flashOn(id: string): void {
    for (const el of targetsFor(id)) el.classList.add("vc-key-flash");
  }
  // Reuses each control's click handler so the two can't drift; a side effect
  // is that keyHints.ts's delegated listener credits a genuine mouse use.
  // "panel" has no local button (the gear is in app.ts), so deps.toggleButton,
  // the same data-key="panel" control, closes the open panel
  // (deviceMenu.toggle()).
  const singleAction: Record<string, () => void> = {
    panel: () => deps.toggleButton.click(),
    hide: () => hideBtn.click(),
    left: () => metersBtn.click(),
    solo: () => soloBtn.click(),
    fullscreen: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" })),
    keys: () => keysBtn.click(),
  };
  function wireKeysRow(row: HTMLButtonElement, id: string): void {
    row.addEventListener("mouseenter", () => flashOn(id));
    row.addEventListener("mouseleave", clearFlash);
    row.addEventListener("click", () => (singleAction[id] ?? (() => flashOn(id)))());
  }
  for (const s of SHORTCUTS) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "vc-keys-row";
    const k = document.createElement("span");
    k.className = "vc-keys-key";
    k.textContent = s.key;
    const w = document.createElement("span");
    w.textContent = s.hint;
    row.append(k, w);
    wireKeysRow(row, s.id);
    keysCard.appendChild(row);
  }
  // Not a SHORTCUTS entry: it names no single control (holding it reveals
  // every keycap), so it's disabled rather than wired.
  const shiftRow = document.createElement("button");
  shiftRow.type = "button";
  shiftRow.className = "vc-keys-row";
  shiftRow.disabled = true;
  const shiftKey = document.createElement("span");
  shiftKey.className = "vc-keys-key";
  shiftKey.textContent = "Shift";
  const shiftHint = document.createElement("span");
  shiftHint.textContent = "Hold — show every shortcut";
  shiftRow.append(shiftKey, shiftHint);
  keysCard.appendChild(shiftRow);

  function setKeysShown(shown: boolean): void {
    keysCard.classList.toggle("vc-keys-show", shown);
    keysBtn.style.color = shown ? "#fff" : "inherit";
  }

  const dock = document.createElement("div");
  dock.className = "vc-dock";
  dock.append(keysCard, footer);

  function setMetersHidden(hidden: boolean): void {
    setFolded(METERS_COLUMN, hidden);
    root.classList.toggle("vc-meters-hidden", hidden);
    metersBtn.textContent = hidden ? "Show left  M" : "Hide left  M";
    metersBtn.title = hidden
      ? "Bring back the Bands card and the meters (M)"
      : "Hide the Bands card and the meters, keep the controls (M)";
    // Hiding/showing the column changes which cards have a layout box without
    // touching any vc-folded class, so the observer never fires: recompute.
    refreshColumnsFold();
  }
  setMetersHidden(isFolded(METERS_COLUMN));

  // ---- solo ----
  /** The heat lens on or off (HEAT chip and L). Session-only view state, like Solo. */
  function setHeatLens(on: boolean): void {
    heatLensOn = on;
    root.classList.toggle("vc-heat-lens", on);
    heatChip.style.cssText = on ? chipBtnLitStyle : chipBtnStyle;
    audioMeters.setHeatLens(on);
  }

  // Everything but the pinned setting (or, unpinned, the Scene card) hidden
  // until O again: walk up from it and the dock (which stays) to the root and
  // mark every sibling off those paths .vc-solo-hidden, so no column, heading
  // or button needs its own rule in either layout. Session-only view state.
  function setSolo(on: boolean): void {
    // Soloed, what's isolated slides to the bottom of the column above the
    // footer (.vc-solo, controlsTheme.ts). Un-soloed it stays put and the
    // column scrolls so the rest comes back around it; only when the column
    // can't scroll that far does it slide the rest of the way.
    const anchor = findPinnedRowEl() ?? sceneCard.el;
    const before = anchor.getBoundingClientRect().top;
    soloOn = on;
    applySolo();
    if (!on) (narrowMQ.matches ? root : controlsCol).scrollTop += anchor.getBoundingClientRect().top - before;
    slideFrom(sceneCard.el, before - anchor.getBoundingClientRect().top);
    syncSoloEye(soloEyeEl);
    refreshCableVisibility();
    soloBtn.textContent = on ? "All  O" : "Solo  O";
    soloBtn.title = on ? "Show everything again (O)" : "Show only the pinned setting — or the Scene card, when none is pinned (O)";
    soloBtn.style.color = on ? "#fff" : "inherit";
    scheduleCableRecompute();
  }
  const reducedMotionMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  /** Plays `el` from `dy` px away back to where layout now puts it (quick
   *  ease-out, skipped under reduced motion), then re-places cables and the
   *  solo eye. */
  function slideFrom(el: HTMLElement, dy: number): void {
    if (Math.abs(dy) < 1 || reducedMotionMQ.matches) return;
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
    el.getBoundingClientRect(); // commit the offset before animating it away
    el.style.transition = "transform 0.22s cubic-bezier(0.2, 0.8, 0.3, 1)";
    el.style.transform = "";
    el.addEventListener(
      "transitionend",
      () => {
        el.style.transition = "";
        scheduleCableRecompute();
      },
      { once: true },
    );
  }
  function syncSoloEye(eye: HTMLButtonElement): void {
    eye.setAttribute("aria-pressed", String(soloOn));
    eye.setAttribute("aria-label", soloOn ? "Show everything again" : "Show only this setting");
    eye.classList.toggle("vc-solo-eye-on", soloOn);
  }
  function applySolo(): void {
    for (const el of [...root.querySelectorAll(".vc-solo-hidden")]) el.classList.remove("vc-solo-hidden");
    root.classList.toggle("vc-solo", soloOn);
    if (!soloOn) return;
    // A pinned setting (its row plus its patch pane) alone stays, meters column
    // included in what goes. The pinned row can live in the Scene card or a
    // widget-mounted card (WidgetCtx.mountCard); whichever holds it is
    // unfolded.
    const pinnedRow = findPinnedRowEl();
    const activeCard = pinnedRow?.closest<HTMLElement>(".vc-card") ?? sceneCard.el;
    if (activeCard.classList.contains("vc-folded")) activeCard.querySelector<HTMLButtonElement>(".vc-fold")?.click();
    const leaves = new Set<Element>([pinnedRow ?? sceneCard.el, dock]);
    const onPath = new Set<Element>();
    for (const leaf of leaves) for (let n: Element | null = leaf; n && n !== root; n = n.parentElement) onPath.add(n);
    const visit = (parent: Element): void => {
      for (const child of parent.children) {
        if (!onPath.has(child)) child.classList.add("vc-solo-hidden");
        else if (!leaves.has(child)) visit(child);
      }
    };
    visit(root);
  }
  setSolo(false);

  // keyHints.ts's hover badge, hold-to-reveal keycaps and the mouse half of
  // light-suggestion tracking: one install for the panel's lifetime. A tip
  // stays longer than showToast's default.
  installKeyHints((text) => showToast(text, 4000));

  // What each button last painted: these also run on the slow tick and
  // re-assigning cssTexts is wasteful. null so the first paint writes.
  let autoMasterLitShown: boolean | null = null;
  let micAutoLitShown: boolean | null = null;

  function refreshAutoMaster(): void {
    const lit = deps.isSceneAuto(deps.currentSceneId());
    if (lit === autoMasterLitShown) return;
    autoMasterLitShown = lit;
    autoMasterBtn.style.cssText = lit ? autoMasterLitStyle : autoMasterStyle;
    autoMasterLabel.style.cssText = autoMasterLabelStyle(lit);
    autoMasterSub.style.cssText = autoMasterSubStyle(lit);
    autoMasterSub.textContent = lit ? "ON" : "OFF";
  }

  // Overlaps the Input card's Auto button (micAuto.ts) on
  // Sensitivity/Expansion/Smoothing, so refresh it too: flipping every scene
  // setting can flip it out from under mic-auto's lit state.
  function toggleAutoMaster(): void {
    const sceneId = deps.currentSceneId();
    deps.onSceneAutoToggle(sceneId, !deps.isSceneAuto(sceneId));
    renderSceneSettings();
    syncInputRows();
    refreshMicAuto();
  }
  autoMasterBtn.addEventListener("click", toggleAutoMaster);

  // The Input card's Auto button (micAuto.ts header says which members "the
  // whole mic" covers).
  function refreshMicAuto(): void {
    const lit = deps.isMicAuto(deps.currentSceneId());
    if (lit === micAutoLitShown) return;
    micAutoLitShown = lit;
    micAutoBtn.style.cssText = lit ? micAutoLitStyle : micAutoStyle;
  }
  // The Input rows are members of both buttons (see toggleMicAuto below).
  function refreshMicAutoAndMaster(): void {
    refreshMicAuto();
    refreshAutoMaster();
  }
  function toggleMicAuto(): void {
    const sceneId = deps.currentSceneId();
    deps.onMicAutoToggle(sceneId, !deps.isMicAuto(sceneId));
    syncInputRows();
    refreshMicAuto();
    // Those members are shared with the scene master (toggleAutoMaster):
    // refresh its lit state too.
    refreshAutoMaster();
  }

  // MIDI: a controller's knobs and pads (ui/midiCard.ts). Hidden where the
  // browser has no Web MIDI; absent entirely when app.ts wired no session.
  const midiCard = deps.midi
    ? createMidiCard({
        midi: deps.midi,
        currentSceneId: deps.currentSceneId,
        ensureSceneRows: () => {
          if (renderedSceneId !== deps.currentSceneId()) renderSceneSettings();
        },
      })
    : null;

  controlsCol.append(autoMasterBtn, masterCard.el, inputCard.el, sceneCard.el, sceneWidgetCardsHost, looksCard.el, setCard.el, paletteCard.el, overlayCard.el, ...(midiCard ? [midiCard.el] : []), dock);
  root.append(columnsWrap, controlsCol, shapingCol.el);
  // Every card is built once and lives for the panel's lifetime: one pass covers them (cableColumnsRO).
  for (const card of root.querySelectorAll<HTMLElement>(".vc-card")) cableColumnsRO.observe(card);
  document.body.appendChild(root);

  // ---- open / close ----
  // (isOpen itself is declared up with soloOn — setSolo reads it.)

  // A tap outside leaves the panel open (corner-docked; it closes only from
  // the gear, Hide UI, S or H) but releases what it held: keyboard focus (so
  // A/R/T/z/x/c stop landing on the last row), a pinned patch (as Escape does)
  // and the keys list. Solo stays. Listens on the document (no backdrop); the
  // gear is excluded as the panel's own switch.
  function onDocPointerDown(e: PointerEvent) {
    const t = e.target as Node | null;
    // The cable layer sits on <body> outside root (cableLayer.ts header), but
    // pressing a cable is a patch edit like a jack click: without this clause
    // it would unpin the setting it just unplugged from.
    if (t && (root.contains(t) || deps.toggleButton.contains(t) || soloEyeEl.contains(t) || cableLayer.el.contains(t)))
      return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && root.contains(active)) active.blur();
    if (pinned) togglePin(pinned.sceneId, pinned.spec);
    setKeysShown(false);
  }

  // The Tab ring: every param control in document order, derived from the DOM
  // each call so a rebuilt Scene card can't leave it stale. Filtered to
  // controls with a layout box: folded card bodies are display:none, an
  // unpinned setting's patch panel is display:none, and lineEditor.strengthRow
  // is detached outside line mode; such a control would sit in the ring and
  // fail to focus. The Power column's Resolution slider is left out, as its
  // chips are: a folded Power card is only visibility:hidden (it keeps its
  // layout box), so Tab would dead-end on a hidden control.
  function ringElements(): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(".vc-slider, .vc-toggle, .vc-picker, .vc-fader")].filter(
      (el) => el.getClientRects().length > 0 && !el.closest(".vc-power-col"),
    );
  }

  /** Tab while something is pinned: the pin moves to the next/previous
   *  visible drive row (wrapping) and focus follows, focused first since
   *  togglePin clears the preview that focus just set. */
  function moveTabPin(e: KeyboardEvent, from: { sceneId: string; spec: SceneSetting }): void {
    const rows = pinRowHandles.filter((h) => h.rowEl.getClientRects().length > 0);
    if (rows.length === 0) return;
    const idx = rows.findIndex((h) => samePair(from, h));
    const next = rows[(idx + (e.shiftKey ? -1 : 1) + rows.length) % rows.length]!;
    e.preventDefault();
    next.rowEl.querySelector<HTMLElement>(".vc-slider, .vc-toggle, .vc-picker")?.focus({ preventScroll: true });
    pinSetting(next.sceneId, next.spec);
    next.rowEl.scrollIntoView({ block: "nearest" });
  }

  function handleTab(e: KeyboardEvent): void {
    if (pinned) {
      moveTabPin(e, pinned);
      return;
    }
    const elements = ringElements();
    if (elements.length === 0) return;
    const idx = document.activeElement instanceof HTMLElement ? elements.indexOf(document.activeElement) : -1;
    // idx === -1 (focus elsewhere in the panel, or nowhere) enters the ring
    // at its first element going forward, its last going backward.
    const next = e.shiftKey
      ? elements[idx > 0 ? idx - 1 : elements.length - 1]
      : elements[idx >= 0 && idx < elements.length - 1 ? idx + 1 : 0];
    e.preventDefault();
    next.focus();
  }

  // A digit key resolves the nth .vc-block heading (renumberBlocks) and
  // focuses the first ring control after it by document position: a heading
  // is sometimes a card title (siblings: its body) and sometimes a group
  // heading (siblings: the following rows).
  function jumpToBlock(n: number): void {
    const heading = [...root.querySelectorAll<HTMLElement>(".vc-block")][n - 1];
    if (!heading) return;
    // Soloed, a jump outside the solo needs the rest of the panel back.
    if (soloOn && !(findPinnedRowEl() ?? sceneCard.el).contains(heading)) setSolo(false);
    // A folded card's controls are invisible to ringElements(): unfold first,
    // or the jump lands on the next block.
    const card = heading.closest<HTMLElement>(".vc-card");
    if (card?.classList.contains("vc-folded")) card.querySelector<HTMLButtonElement>(".vc-fold")?.click();
    const target = ringElements().find(
      (el) => (heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    );
    if (!target) return;
    target.focus();
    target.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (isTypingTarget(e.target)) return;
    if (e.key === "Escape" && jackDrag?.moved) {
      clearJackDrag();
      e.preventDefault();
      return;
    }
    if (e.key === "Escape" && pinnedNode) {
      pinnedNode = null;
      refreshPatchHighlight();
      scheduleCableRecompute();
      e.preventDefault();
      return;
    }
    if (e.key === "Escape" && pinned) {
      togglePin(pinned.sceneId, pinned.spec);
      e.preventDefault();
      return;
    }
    if (e.key === "h" || e.key === "H") {
      noteKeyUse("hide");
      close();
      return;
    }
    if (e.key === "m" || e.key === "M") {
      noteKeyUse("left");
      setMetersHidden(!isFolded(METERS_COLUMN));
      return;
    }
    if (e.key === "o" || e.key === "O") {
      noteKeyUse("solo");
      setSolo(!soloOn);
      return;
    }
    if (e.key === "l" || e.key === "L") {
      noteKeyUse("heat");
      setHeatLens(!heatLensOn);
      return;
    }
    if (e.key === "?") {
      noteKeyUse("keys");
      setKeysShown(!keysCard.classList.contains("vc-keys-show"));
      return;
    }
    if (e.key === "Tab") {
      noteKeyUse("tab");
      handleTab(e);
      return;
    }
    // Shift+digit, matched on the physical key (Shift turns e.key into "!",
    // "@", …): the bare digits fire the Set's pads (app.ts), panel open or not.
    if (e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
      e.preventDefault();
      noteKeyUse("block");
      jumpToBlock(Number(e.code.slice(5)));
    }
  }

  // Everything that follows the active scene or palette: what open() brings
  // up to date, and what an outside scene change (Set pad, Autopilot) redoes
  // while the panel is open.
  function syncToScene(): void {
    renderPalettes();
    syncInputRows();
    // The panel may have been closed on another scene: renderSceneSettings()'s
    // tail unpins if so and rebuilds the pinned patch panel.
    renderSceneSettings();
    refreshBandsSplit();
    refreshBandFaders();
    masterRow.sync(() => deps.getSceneMaster());
    masterExpansionRow.sync(() => deps.getSceneExpansion());
    masterShapeRow.sync();
    setCard.refresh();
    // Whatever was rebuilt above comes in unmarked.
    applySolo();
  }

  function open() {
    welcomeOnce();
    refreshSpectrumHeader();
    sourceRow.refresh();
    overlayCard.refresh();
    syncToScene();
    root.classList.add("vc-open");
    deps.toggleButton.setAttribute("aria-pressed", "true");
    deps.toggleButton.title = "Close controls (S)";
    isOpen = true;
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
    refreshCableVisibility();
    scheduleCableRecompute();
    // The Source row's idle signal-preview meters (inputPreview.ts) only run
    // while there's a row list open to show them on.
    deps.setInputPreviewActive(true);
  }

  function close() {
    root.classList.remove("vc-open");
    deps.toggleButton.setAttribute("aria-pressed", "false");
    deps.toggleButton.title = "Controls (S)";
    isOpen = false;
    document.removeEventListener("pointerdown", onDocPointerDown);
    document.removeEventListener("keydown", onKeyDown);
    refreshCableVisibility();
    toastEl.classList.remove("vc-toast-show");
    positionSoloEye();
    deps.setInputPreviewActive(false);
    sourceRow.endEdit();
  }

  // Last --wash value written, so update() only touches the DOM when it moves.
  let lastWash = "";
  // Slow cadence: auto-driven values move over seconds, so per-frame DOM
  // writes would be pure cost. The spectrum header rides it.
  const AUTO_UI_REFRESH_MS = 100;
  let lastAutoRefreshMs = 0;
  // Every drive row's sparkline plus the pinned row's output graph: canvas
  // draws, not DOM rebuilds, on a faster cadence than AUTO_UI_REFRESH_MS.
  // A fixed clock, not "since the last draw": a late frame owes the graphs
  // every column it spanned, so the window is real time at any frame rate and
  // hits land evenly spaced like the meters' strips. A gap past
  // SPARKLINE_MAX_SLOTS (folded card, closed panel, hidden tab) restarts the
  // clock instead of filling seconds with one reading.
  const SPARKLINE_REFRESH_MS = 1000 / 30;
  const SPARKLINE_MAX_SLOTS = 15;
  let lastSparklineMs = 0;
  // The Picture block's readout text rides a slow cadence like
  // AUTO_UI_REFRESH_MS, kept separate since the two blocks' DOM writes are
  // independent (its traces redraw every tick, like the sparklines).
  const PICTURE_TEXT_REFRESH_MS = 100;
  let lastPictureTextMs = 0;

  return {
    toggle() {
      if (isOpen) close();
      else open();
    },
    close,
    isOpen: () => isOpen,
    sceneChanged() {
      if (isOpen) syncToScene();
    },
    applyMidiCc: (target, cc) => midiCard?.applyCc(target, cc),
    isPictureOnScreen: () => isOpen && pictureOnScreen(),
    isStemsRowOnScreen: () => isOpen && stemsOnScreen(),
    update(
      frame: FeatureFrame | null,
      rawBands: Float32Array | null,
      ungained: FeatureFrame | null,
      pinnedBands: Uint8Array | null,
      anim: AnimFrame | null,
      mono: Float32Array | null,
      rateScale: number,
      fixedEnergy: number | null,
      lufs: LufsReading | null,
      beatDiag: OnsetDiag | null,
      gate: SilenceGateReading | null,
      drives: SceneDrives | null,
      draw: boolean,
    ) {
      // Heat records panel open or closed, like the meters' traces (heat.ts).
      recordHeat(drives, frame);
      // Dropped on a scene switch; checked before the closed return so it
      // clears with the panel shut.
      const solo = getDriveSolo();
      if (solo && solo.sceneId !== deps.currentSceneId()) clearDriveSolo();
      // Closed, only the meters' traces and heat record (so they open on what
      // they missed); every DOM write is skipped since this runs every rAF
      // tick. Open but not `draw`, it also records the drive graphs' peak-hold
      // (notePeaks) so a one-tick hit reaches the next drawn sparkline.
      if (!isOpen || !draw) {
        audioMeters.update(frame, anim, mono, rawBands, rateScale, fixedEnergy, lufs, beatDiag, gate, false);
        if (isOpen && drives && driveRowHandles.length && !sceneCard.fold?.isFolded()) notePeaks(drives);
        shapingCol.update(frame?.level ?? null, false);
        return;
      }
      // A scene switch leaves `pinned` on a setting of another scene; checked
      // here, not at each scene-change call site, since this runs every tick
      // however the switch happened. Cheap when nothing changed.
      if (pinned && pinned.sceneId !== deps.currentSceneId()) togglePin(pinned.sceneId, pinned.spec);
      audioMeters.update(frame, anim, mono, rawBands, rateScale, fixedEnergy, lufs, beatDiag, gate, true);
      shapingCol.update(frame?.level ?? null, true);
      // Unthrottled: the live row's meter should track frame.level like any
      // other live meter, not the structural-refresh cadence.
      sourceRow.updateMeters(frame?.level ?? null);
      // The cable layer's per-tick flow (dashoffset only, no reads;
      // cableLayer.ts header) and the Bands level rows need a live dtSec.
      lastDrives = drives;
      lastFrame = frame;
      lastAnim = anim;
      const cableNowMs = performance.now();
      const cableDtSec = Math.min(1 / 15, Math.max(1e-4, (cableNowMs - lastCableTickMs) / 1000));
      lastCableTickMs = cableNowMs;
      if (!bandsCard.fold?.isFolded()) {
        for (const r of bandLevelRows) r.row.setValue(anim ? r.read(anim) : null, cableDtSec);
      }
      if (!narrowMQ.matches) cableLayer.tick(cableDtSec);
      // Unthrottled, like audioMeters' fills (createControlRow's
      // updateSignalPills). Free for rows without `reads`.
      for (const row of sceneRowHandles) row.updateSignalPills(frame, anim);
      // The tick is FeatureFrame.level: absolute, fixed-window loudness that
      // Auto-gain doesn't touch, so it reads the room. The fill starts from
      // .energy (which Auto-gain shapes) and runs the render path's
      // sensitivity+expansion curve, so it shows what the scene reacts to.
      const tick = Math.min(1, Math.max(0, frame?.level ?? 0));
      const energy = Math.min(1, Math.max(0, frame?.energy ?? 0));
      const sceneId = deps.currentSceneId();
      const sensitivity = deps.isSettingAutoEnabled(sceneId, deps.getSensitivitySpec().key)
        ? deps.resolveSensitivityValue(sceneId)
        : deps.getSensitivity(sceneId);
      const expansion = deps.isSettingAutoEnabled(sceneId, deps.getExpansionSpec().key)
        ? deps.resolveExpansionValue(sceneId)
        : deps.getExpansion(sceneId);
      const shaped = Math.min(
        1,
        Math.max(0, shapeExpansion(shapeLevel(energy, sensitivity), expansion)),
      );
      const tickPct = Math.round(tick * 100);
      const shapedPct = Math.round(shaped * 100);
      inputCard.el.style.backgroundSize = `${tickPct}% 100%, ${shapedPct}% 100%`;

      // From the unrounded shaped level so the ramp starts exactly at HOT_START, not in 1% steps.
      const wash = washColor(shaped);
      if (wash !== lastWash) {
        inputCard.el.style.setProperty("--wash", wash);
        lastWash = wash;
      }

      // The processed feed is the render path's sensitivity+expansion pipeline
      // (applySensitivity in app.ts); the raw feed shows the mic as-is. The
      // ghost is the same pipeline over the pre-fader frame and goes first:
      // applySensitivity returns one shared scratch buffer on its fast path, so
      // the ghost must be copied into the strip before the second call
      // overwrites it.
      spectrumStrip.setGhost(ungained ? applySensitivity(ungained, sensitivity, expansion).bands : null);
      spectrumStrip.setPinned(pinnedBands);
      const processedBands = frame ? applySensitivity(frame, sensitivity, expansion).bands : null;
      spectrumStrip.update(rawBands, processedBands);
      // The Frequencies overlay draws on this strip's own canvas
      // (bandLineEditor.ts header) from this tick's live excess, unthrottled
      // like the strip. Skipped without lineMode or with the Bands card
      // folded.
      const nowMs = performance.now();
      if (lineMode && !bandsCard.fold?.isFolded()) {
        lineEditor.update(drives?.excess(lineMode.spec.key) ?? null);
      }
      // Sparklines: every drive row's valueOf() plus the pinned row's output
      // graph; canvas draws only. Skipped while the Scene card is folded or
      // nothing is readable.
      if (drives && driveRowHandles.length && !sceneCard.fold?.isFolded()) {
        notePeaks(drives);
        let slots = Math.floor((nowMs - lastSparklineMs) / SPARKLINE_REFRESH_MS);
        if (slots > SPARKLINE_MAX_SLOTS) {
          slots = 1;
          lastSparklineMs = nowMs;
        } else {
          lastSparklineMs += slots * SPARKLINE_REFRESH_MS;
        }
        if (slots > 0) {
          for (const h of driveRowHandles) h.tickSparkline(drives, frame, anim, slots);
          activeOutputTick?.(drives, slots);
          peakSeen.clear();
        }
      }

      // Heat strips and row colours, at most every HEAT_REFRESH_MS.
      if (nowMs - lastHeatMs >= HEAT_REFRESH_MS && !sceneCard.fold?.isFolded()) {
        lastHeatMs = nowMs;
        refreshHeatPips(nowMs / 1000);
      }
      // The lens glow, every tick while it's on (a write only when a row's level changes).
      if (heatLensOn && !sceneCard.fold?.isFolded()) {
        for (const h of driveRowHandles) h.tickHeatGlow();
      }

      // Picture: the Overall trace plus one per measure (pictureMeter.ts),
      // drawn every tick (canvas draws are cheap; the DOM write is throttled).
      // getPictureReading() is null once the meter goes stale: a gap in the
      // trace and "--". While the column is scrolled past, traces record and
      // skip the draw; app.ts stops sampling the frame (isPictureOnScreen), so
      // they record gaps.
      const pictureShown = pictureOnScreen();
      if (leashOnScreen()) {
        leashGauge.draw({
          normal: deps.getSceneMaster() / SCENE_MASTER_MAX,
          expansion: deps.getSceneExpansion(),
          excursion: drives?.masterExcursion() ?? null,
        });
      }

      const pictureReading = deps.getPictureReading();
      const pictureTextDue = nowMs - lastPictureTextMs >= PICTURE_TEXT_REFRESH_MS;
      if (pictureTextDue) lastPictureTextMs = nowMs;
      const pictureLevels = pictureRows.map((row) =>
        displayLevel(row.measure, pictureReading ? pictureReading[row.measure.key] : null),
      );
      const pictureOverall = overallLevel(pictureLevels);
      pictureSummaryStrip.push([...pictureLevels, pictureOverall], nowMs);
      if (pictureShown) pictureSummaryStrip.draw();
      if (pictureTextDue) {
        const text = pictureOverall === null ? "--" : String(Math.round(pictureOverall * 100));
        if (text !== pictureSummaryText) {
          pictureSummaryText = text;
          setLiveText(pictureSummaryReadout, text); // inside the Picture block's press target
          pictureSummaryReadout.style.cssText = text === "--" ? pictureReadoutTextStyle : pictureReadoutDigitsStyle;
        }
      }
      pictureRows.forEach((row, i) => {
        const level = pictureLevels[i]!;
        // Folded rows still record; they skip only the redraw and the readout.
        row.strip.push([level], nowMs);
        if (!pictureOpen || !pictureShown) return;
        row.strip.draw();
        if (!pictureTextDue) return;
        const text = level === null ? "--" : String(Math.round(level * 100));
        if (text === row.lastText) return;
        row.lastText = text;
        setLiveText(row.readout, text);
        row.readout.style.cssText = text === "--" ? pictureReadoutTextStyle : pictureReadoutDigitsStyle;
      });

      if (nowMs - lastAutoRefreshMs < AUTO_UI_REFRESH_MS) return;
      lastAutoRefreshMs = nowMs;

      refreshSpectrumHeader();
      powerCard.setTitle(deps.isPreview() ? "Preview" : "Power");
      powerCard.refresh();
      const outputShown = deps.getOutputPowerStatus() !== null;
      if (outputShown !== outputPowerShown) {
        outputPowerShown = outputShown;
        outputPowerCard.setVisible(outputShown);
        // A hidden card can't count toward "everything folded".
        refreshColumnsFold();
      }
      if (outputShown) outputPowerCard.refresh();
      sourceRow.refresh();
      for (const { row } of inputRows) row.refreshAuto();
      autoGainRow.refreshAuto();
      // The gate rows ease continuously while their auto is on; without this
      // they'd show the value from when last touched.
      silenceClosedRow.refreshAuto();
      silenceOpenRow.refreshAuto();
      for (const row of sceneRowHandles) row.refreshAuto();
      // The two Auto buttons follow their rows' auto flags, which an
      // external change (a paired device, a drag elsewhere) can flip.
      refreshAutoMaster();
      refreshMicAuto();
      // The Set's markers move when Play or Autopilot acts, and a paired
      // device or the pop-out can change its pads; it redraws only on change.
      setCard.refresh();
      // The pinned patch panel is re-synced here, not every tick, for an
      // external change (a paired device's command). Compared by value so an
      // unrelated tick never rebuilds a panel with a pointer down on it
      // (click-loss rule).
      if (pinned?.spec.drive) {
        const current = deps.getDriveSetting(pinned.sceneId, pinned.spec);
        if (!sameDriveSetting(current, lastPinnedSetting ?? "scene")) patchChanged(pinned.sceneId, pinned.spec);
      }
    },
  };
}
