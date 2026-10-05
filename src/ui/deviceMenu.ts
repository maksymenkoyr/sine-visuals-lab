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
import { createSetCard, type SetCardDeps } from "./setCard.ts";
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
  GENERIC_THRESHOLD_DEFAULT,
  sameDriveSetting,
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
import { BEAT_GRIDS, type BeatGridIndex } from "../audio/beatGrid.ts";
import {
  DRIVE_ADD_GROUPS,
  DRIVE_WHITE,
  driveGridDivisionLabel,
  driveSourceColor,
  driveSourceDescription,
  driveSourceLabel,
  isGridSourceChoice,
  isLineSourceChoice,
  jackKey,
} from "./driveSources.ts";
import { hideTooltip, showTooltip } from "./tooltip.ts";
import { setHintText } from "./hintSwatches.ts";
import { installKeyHints, noteKeyUse, SHORTCUTS, welcomeOnce } from "./keyHints.ts";
import { createBandFaders } from "./bandFaders.ts";
import { createBandLineEditor } from "./bandLineEditor.ts";
import { createAudioMeters, createMeterRow, createTraceStrip, meterGroupHeading } from "./audioMeters.ts";
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
import type { PreviewSize } from "../render/outputPower.ts";
import type { OutputRenderStatus } from "../net/outputSync.ts";
import { isFolded, setFolded, METERS_COLUMN } from "./panelFolds.ts";
import type { PowerMode } from "../render/powerMode.ts";
import type { QualityChoice } from "../render/qualityPref.ts";
import { DISPLAY_SHARE_GUIDE, type AudioSourceChoice, type SourceState } from "../audio/sourcePref.ts";
import { inputKind, isInputHidden, INPUT_KIND_TEXT, type InputDeviceOption, type InputDevicePref, type InputKind } from "../audio/inputDevice.ts";
import type { InputHealthReading } from "../audio/inputHealth.ts";
import type { AnimFrame } from "../render/animClock.ts";
import { createLeashGauge } from "./leashGauge.ts";
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
  readoutStyle,
  rowHeadStyle,
  rowLabelStyle,
  rowResetStyle,
  rowRightStyle,
  spacer,
  unitStyle,
} from "./controlsKit.ts";

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
 * update(), skipped while the panel is closed). None of the three is a fork
 * of createControlRow — they're its `port`/`summary`/`below` slots, filled
 * in by appendSettingRow only for a setting with `spec.drive`.
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
 * line per source (colour dot, name, weight 0–2×, a hit source's Height
 * Graded/Fixed/Loud, a grid source's division chips, the line source's
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
 * Character) plus this file's own Bands level rows (BAND_LEVEL_CHOICES) and
 * its Frequencies corner (mountBandsJack) — grows a jack (src/ui/jack.ts): a
 * ring in its source's colour, filled when it feeds the shown (preview ??
 * pinned) setting, with tiny usage dots around the ring for how many of
 * this scene's settings use it. While a signal's row is lit (hover or
 * focus), every one of those wires is drawn to its port (litSignalFan,
 * cableLayer.ts's fan group). Clicking one with a pinned setting toggles it into that
 * patch (onJackClick); with nothing pinned, it pins whichever setting was
 * last previewed (`lastPreview`, since `preview` itself goes back to null
 * the moment the pointer leaves) and plugs in in the same click, or shows a
 * toast if nothing ever was. Hovering a jack highlights every scene row it
 * already feeds (onJackHover, independent of the shown-setting highlight).
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
 * the row (drag, ↺, a card Reset, auto taking over) forgets that restore
 * point and unlights it — it's a toggle, not a memory. ↺ only appears once a value is
 * off its default, doubling as a "you changed this" marker. A chip's letter
 * *is* its hotkey once the row's control has keyboard focus — and
 * wireHoverFocus gives it that focus on genuine pointer movement over the
 * row, matching the identical hover/focus styling below, so pointing at a
 * row is enough; no click needed first. The hint under a row (a setting's
 * `description`) stays collapsed until hover/focus, and while auto holds the
 * row a second line beneath it invites the user to take over. Each card's accent
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

/** What the Source row's device list shows — see DeviceMenuDeps.getInputDevices. */
export interface InputDevicesState {
  /** Pickable inputs; empty until the mic permission's first grant, which
   *  shows a single "Microphone" placeholder row instead (there's nothing
   *  nameable to choose between yet). */
  options: InputDeviceOption[];
  /** The OS default's device name — its own row gets a "System default"
   *  sub-line. */
  defaultLabel: string | null;
  /** A chosen input that isn't plugged in — its own dashed "not connected"
   *  row, so the list still says what was picked while the default fills in. */
  missing: InputDevicePref | null;
  /** The device the live mic is actually hearing, or null. */
  liveLabel: string | null;
}
export interface AudioStatus {
  source: AudioSource;
  /** The local AudioContext's rate, when there is one. */
  sampleRate: number | null;
}

/** A palette as the Palette card shows it. */
export interface PaletteMenuItem extends MenuItem {
  /** Rows are grouped by this, in the order groups first appear. */
  group: string;
  /** The palette's ramp, darkest first, drawn as the chip's swatch. */
  swatch: readonly string[];
}

export interface DeviceMenuDeps {
  getPalettes: () => PaletteMenuItem[];
  currentSceneId: () => string;
  currentPaletteId: () => string;
  onPickPalette: (id: string) => void;
  /** Shown in the column head's status line, above the Bands card — where
   *  the bars are coming from. */
  getAudioStatus: () => AudioStatus;
  /** This device's mic-vs-screen capture state (src/audio/sourcePref.ts's
   *  SourceState) — drives the Input card's Source row, including whether the
   *  lit chip means "listening now" (the only thing it ever highlights — see
   *  SourceState's doc comment). Same signal drives the gallery masthead's
   *  picker (src/ui/gallery.ts's refreshSource). Null on a renderer or the
   *  synthetic feed (no local capture to choose a source for), which is what
   *  hides the row — the same null-hides-itself convention as the Loudness
   *  card's `lufs` frame field. */
  getSourceState: () => SourceState | null;
  onAudioSourceChange: (choice: AudioSourceChoice) => void;
  /** A tap on the row that's already live: disconnect it, so it can be
   *  picked again (src/app.ts's stopOwnCapture). */
  onStopAudio: () => void;
  /** The Source row's device list — which device the Mic source opens
   *  (src/audio/inputDevice.ts). Read on the row's own refresh timer, so
   *  src/app.ts answers from a cache, never a fresh enumerateDevices(). */
  getInputDevices: () => InputDevicesState;
  /** A pick from that list. src/app.ts also switches to it (see its
   *  chooseInputDevice). */
  onInputDeviceChange: (deviceId: string) => void;
  /** Whether this browser can offer the Screen option at all — see
   *  sourcePref.ts's header for the exact browser/OS matrix. */
  canCaptureDisplay: () => boolean;
  /** This tick's src/audio/inputHealth.ts reading for the live capture. Null
   *  wherever there's no local tap to read one off (a renderer, the
   *  synthetic feed, or before the very first tick after a capture starts) —
   *  a healthy input reads `{ kind: "ok" }`, never null. Read on the Source
   *  row's own refresh(), not every rAF tick — see createSourceRow's
   *  refresh. */
  getInputHealth: () => InputHealthReading | null;
  /** 0..1 signal-preview level for a device that ISN'T the live one, or null
   *  wherever its preview isn't open (src/audio/inputPreview.ts — an
   *  unsupported browser, or it just hasn't opened yet). The live row uses
   *  this tick's FeatureFrame.level instead (handed to DeviceMenu.update()),
   *  not this — see createSourceRow's updateMeters. */
  getInputLevel: (deviceId: string) => number | null;
  /** Whether the Source row's idle meters should be running at all — true
   *  only while the panel is open; see inputPreview.ts's header for why it's
   *  gated further (browser support, whether there's anything to preview). */
  setInputPreviewActive: (active: boolean) => void;
  /** The Source row's Edit mode hid or showed an input, by label (see
   *  inputDevice.ts's hidden-inputs paragraph). src/app.ts stores it and
   *  re-syncs the idle preview, which skips hidden inputs. */
  onInputHiddenChange: (label: string, hide: boolean) => void;
  getSensitivity: (sceneId: string) => number;
  onSensitivityChange: (sceneId: string, value: number) => void;
  getExpansion: (sceneId: string) => number;
  onExpansionChange: (sceneId: string, value: number) => void;
  getSmoothing: (sceneId: string) => number;
  onSmoothingChange: (sceneId: string, value: number) => void;
  /** Empty for scenes with nothing to tune — the card hides itself. */
  getSceneSettings: (sceneId: string) => SceneSetting[];
  /** The active scene object, for its optional `panel` (src/render/scene.ts)
   *  — used only to render a scene-declared item widget ahead of the flat
   *  settings loop; nothing else here reaches into a Scene directly. */
  getScene: (sceneId: string) => Scene | undefined;
  getSceneSettingValue: (sceneId: string, spec: SceneSetting) => number;
  /** A setting's resting value under the scene's current variant (see
   *  SceneSetting.variant) — what the row's reset arrow returns it to. */
  getSceneSettingDefault: (sceneId: string, spec: SceneSetting) => number;
  onSceneSettingChange: (
    sceneId: string,
    spec: SceneSetting,
    value: number,
  ) => void;
  onSceneSettingsReset: (sceneId: string) => void;
  /** Named, shareable snapshots of the Scene card's own settings — see
   *  src/render/sceneLooks.ts. Rendered by the Looks card, next to Scene. */
  listLooks: (sceneId: string) => SceneLook[];
  onSaveLook: (sceneId: string, name: string) => void;
  onApplyLook: (look: SceneLook) => void;
  onDeleteLook: (sceneId: string, name: string) => void;
  decodeLook: (code: string) => SceneLook | null;
  buildShareLink: (look: SceneLook) => string;
  hasLookUndo: (sceneId: string) => boolean;
  onUndoLook: (sceneId: string) => void;
  /** The Set card's pads and Autopilot — see src/ui/setCard.ts for what each
   *  call means; the card's scene names come from `getScene` above. */
  set: Omit<SetCardDeps, "sceneName">;
  /** Low/mid/high crossover, global per device (not per scene) — fixed, not
   *  user-facing, and unrelated to the faders: it only colors the spectrum
   *  strip's bars by pulse group. See src/audio/bandSplit.ts. */
  getBandSplit: () => BandSplit;
  /** This device's real Hz band edges once the analyser exists; falls back to
   *  the nominal ladder before mic access is granted. Also labels the faders. */
  getBandEdgesHz: () => Float32Array;
  /** Per-scene band fader gains, by fader index — see src/audio/bandGains.ts. */
  getBandGain: (sceneId: string, fader: number) => number;
  onBandGainChange: (sceneId: string, fader: number, value: number) => void;
  onBandGainsReset: (sceneId: string) => void;
  /** A drive setting's whole patch (src/render/drives.ts's DriveSetting —
   *  `"scene"` or a DrivePatch), and the store-level editing helpers the
   *  patch panel's controls call through — named to match
   *  driveStore.ts's own exports 1:1, keyed per (scene, setting) rather than
   *  per scene: two drive settings on the same scene keep independent
   *  patches (and, while a patch has a source on Frequencies, independent
   *  drawn lines — see getDriveLine below). */
  getDriveSetting: (sceneId: string, spec: SceneSetting) => DriveSetting;
  /** Writes a whole DriveSetting straight through (driveStore.ts's own
   *  `setDriveSetting`) — the one generic primitive every other `onSetXxx`
   *  below is a narrower pure-function wrapper around. appendSettingRow's
   *  multi-item-selection bridge (registry.ts's `appendRow` `linked` option)
   *  is the only caller today: after any patch edit on a row with `linked`
   *  siblings, it copies the row's own freshly-written DriveSetting onto
   *  each of them verbatim — correct even for a `"scene"` choice, since two
   *  items' own scene defaults can legitimately differ (see
   *  itemBoxes.ts/physarum2.ts's Nutrient, whose scene default is each
   *  strain's own band). */
  onSetDriveSetting: (sceneId: string, spec: SceneSetting, setting: DriveSetting) => void;
  onResetDriveSetting: (sceneId: string, spec: SceneSetting) => void;
  /** Leaves the setting with nothing plugged in — it stops reacting to the
   *  music (drives.ts's normalizeDriveSetting keeps an empty patch empty).
   *  The panel offers it while the setting plays its scene's own mix, which
   *  otherwise has no source line of its own to unplug. */
  onUnplugAll: (sceneId: string, spec: SceneSetting) => void;
  onTogglePatchSource: (sceneId: string, spec: SceneSetting, choice: DriveSourceChoice) => void;
  onSetSourceWeight: (sceneId: string, spec: SceneSetting, choice: DriveSourceChoice, weight: number) => void;
  onSetSourceHeight: (sceneId: string, spec: SceneSetting, choice: DriveSourceChoice, height: HitHeight) => void;
  /** Beat wave's own every-N-beats divider (buildEverySeg) — only ever shown
   *  on a plain Beat wave source line. See drives.ts's setSourceEvery. */
  onSetSourceEvery: (sceneId: string, spec: SceneSetting, choice: DriveSourceChoice, every: number) => void;
  onSetSourceGrid: (sceneId: string, spec: SceneSetting, grid: BeatGridIndex) => void;
  onSetPatchMix: (sceneId: string, spec: SceneSetting, mix: DriveMix) => void;
  /** The Only when role toggle (buildRoleToggle) — marks `sources[index]`
   *  "plays" or "when". See drives.ts's setSourceRole. */
  onSetSourceRole: (sceneId: string, spec: SceneSetting, index: number, role: "plays" | "when") => void;
  /** The source line's own mute switch (buildMuteSwitch) — turns
   *  `sources[index]` off without unplugging it, or back on. See
   *  drives.ts's setSourceMuted. */
  onSetSourceMuted: (sceneId: string, spec: SceneSetting, index: number, muted: boolean) => void;
  getDriveLine: (sceneId: string, spec: SceneSetting) => Float32Array;
  setDriveLineBand: (sceneId: string, spec: SceneSetting, band: number, height: number) => void;
  setDriveLine: (sceneId: string, spec: SceneSetting, heights: ArrayLike<number>) => void;
  resetDriveLine: (sceneId: string, spec: SceneSetting) => void;
  getDriveLineStrength: (sceneId: string, spec: SceneSetting) => number;
  /** Every drive setting's own threshold row, under its graph: on/off +
   *  value — driveStore.ts's getDriveThresholdState/setDriveThreshold/
   *  setDriveThresholdOn. Scene-handled (SceneSetting.drive.threshold
   *  declared) or the generic engine gate every other drive setting gets
   *  (drives.ts's header's threshold paragraph) — the row looks the same
   *  either way, just with a different label/hint. */
  getDriveThresholdState: (sceneId: string, spec: SceneSetting) => DriveThresholdState;
  onSetDriveThreshold: (sceneId: string, spec: SceneSetting, value: number) => void;
  onSetDriveThresholdOn: (sceneId: string, spec: SceneSetting, on: boolean) => void;
  setDriveLineStrength: (sceneId: string, spec: SceneSetting, value: number) => void;
  /** The Dynamics card's Reset chip (its header, beside Loudness) — starts
   *  the integrated LUFS reading over (src/audio/lufsAnalyser.ts). */
  onLufsReset: () => void;
  /** Auto-resolved live value for a row currently on auto — see autoTune.ts. */
  resolveSceneSettingValue: (sceneId: string, spec: SceneSetting) => number;
  resolveSensitivityValue: (sceneId: string) => number;
  resolveExpansionValue: (sceneId: string) => number;
  resolveSmoothingValue: (sceneId: string) => number;
  /** Synthetic SceneSettings for the Sensitivity/Expansion/Smoothing
   *  pseudo-params, so they can drive an auto chip through the same
   *  isSettingAutoEnabled/onSettingAutoToggle contract as a real scene
   *  setting row. */
  getSensitivitySpec: () => SceneSetting;
  getExpansionSpec: () => SceneSetting;
  getSmoothingSpec: () => SceneSetting;
  isSettingAutoEnabled: (sceneId: string, key: string) => boolean;
  onSettingAutoToggle: (sceneId: string, spec: SceneSetting, on: boolean) => void;
  /** Whether every auto-capable setting on this scene (incl. Sensitivity/Expansion/Smoothing) is auto. */
  isSceneAuto: (sceneId: string) => boolean;
  onSceneAutoToggle: (sceneId: string, on: boolean) => void;
  /** The device-wide scene master (sceneSettings.ts's getSceneMaster) — one
   *  dial over every numeric scene param, resolved in autoTune.ts's
   *  resolveSceneSetting. Device-local, so it is neither captured in a Look
   *  nor sent to the TV. */
  getSceneMaster: () => number;
  onSceneMasterChange: (value: number) => void;
  /** The master's Expansion dial (sceneSettings.ts's getSceneExpansion) —
   *  how far and how long every drive reading may pull the picture away
   *  from the normal line Scale sets (drives.ts's header, "Master
   *  Expansion"). Device-local like Scale. */
  getSceneExpansion: () => number;
  onSceneExpansionChange: (value: number) => void;
  /** Expansion's shape chip, as an index into sceneSettings.ts's
   *  EXPANSION_SHAPES (getSceneExpansionShape). Device-local like Scale. */
  getSceneExpansionShape: () => number;
  onSceneExpansionShapeChange: (index: number) => void;
  /** This tick's picture reading for the Master card's Picture block — null
   *  whenever the meter has gone stale (the panel was just opened, or
   *  nothing has forced sampling with the panel closed) rather than a frozen
   *  last value. See src/render/pictureMeter.ts for what each measure
   *  means. */
  getPictureReading: () => PictureReading | null;
  /** Dev-only: read/write/clear an unclamped pin for a param row (see
   *  tuning/pins.ts) — its presence is what turns a row's readout into a
   *  typable field, and its absence in a production build is what hides
   *  that affordance entirely. */
  devPin?: {
    get(sceneId: string, key: string): number | undefined;
    set(sceneId: string, key: string, value: number): void;
    clear(sceneId: string, key: string): void;
  };
  /** Global per-band adaptive-normalization amount — see src/audio/autoGain.ts.
   *  AUTO_GAIN_MIN (the default) is the fixed mapping against the analyser's
   *  own dB window, matching the spectrum strip's raw feed; AUTO_GAIN_MAX is
   *  fully adaptive. */
  getAutoGain: () => number;
  onAutoGainChange: (value: number) => void;
  /** The row's own "A" chip — auto-resolves the amount from the room's
   *  measured span rather than MUSIC_DIALS (see autoGain.ts's header for
   *  why). Independent of the master Auto button: that toggle is scoped to
   *  isSceneAuto's per-scene auto-on store, and this setting is device-global
   *  like getAutoGain above. */
  isAutoGainAuto: () => boolean;
  onAutoGainAutoToggle: (on: boolean) => void;
  resolveAutoGain: () => number;
  /** The two silence-gate marks (src/audio/silenceGate.ts) — the Input
   *  card's Silence below/Sound above rows. Device-wide, like Auto-gain
   *  above: how quiet this room/mic actually is describes the input, not one
   *  scene's look. Setting one can push the other (the invariant `open >=
   *  closed + SILENCE_GATE_MIN_WIDTH`), which is why both rows re-sync from
   *  getSilenceGate() after either change rather than trusting the value the
   *  row that fired onChange was itself showing. */
  getSilenceGate: () => SilenceGateMarks;
  onSilenceGateClosedChange: (value: number) => void;
  onSilenceGateOpenChange: (value: number) => void;
  /** The gate rows' own "A" chips — one flag for both marks (see
   *  silenceGate.ts's "Auto mode" header paragraph for why steadiness, not
   *  MUSIC_DIALS, is what they resolve against). Independent of the master
   *  Auto button the same way isAutoGainAuto above is. */
  isSilenceGateAuto: () => boolean;
  onSilenceGateAutoToggle: (on: boolean) => void;
  resolveSilenceGate: () => SilenceGateMarks;
  /** The Hits card's Shape sliders (src/audio/hitStrength.ts) — see
   *  audioMeters.ts's AudioMetersDeps.hitShape. Global per device, like
   *  getSilenceGate above, not per scene: how a hit's stand-out and
   *  loudness should blend into its pulse height is a taste about
   *  detection itself, not one scene's look. */
  getHitShape: () => HitShape;
  setHitShape: (partial: HitShapePatch) => void;
  /** Whether every member of "the whole mic" is on auto for this scene —
   *  drives the Input card's own Auto button. See src/audio/micAuto.ts's
   *  header for exactly what that membership is and how it overlaps
   *  isSceneAuto above. */
  isMicAuto: (sceneId: string) => boolean;
  onMicAutoToggle: (sceneId: string, on: boolean) => void;
  /** Energy saving mode (src/render/powerMode.ts) — the Power card's
   *  Auto/On/Off override for the quality governor. Device-wide, like
   *  Auto-gain above. */
  getPowerMode: () => PowerMode;
  onPowerModeChange: (mode: PowerMode) => void;
  /** Quality choice (src/render/qualityPref.ts) — the Power card's
   *  Auto/High/Mid/Low/Floor override for which preset the governor steps
   *  from. Device-wide, like Power mode above. */
  getQualityChoice: () => QualityChoice;
  onQualityChoiceChange: (choice: QualityChoice) => void;
  /** Snapshot for the Power card's status line and readouts — what the
   *  governor actually decided this session, and why. Polled at the panel's
   *  existing ~10Hz auto-refresh tick, not per frame. */
  getPowerStatus: () => PowerStatus;
  /** True while a pop-out output window is open: the main Power card then
   *  describes this window's preview (titled "Preview", Quality bound to the
   *  preview's own choice) and gains the size and resolution rows. */
  isPreview: () => boolean;
  /** False when the preview has no box to resize (a phone controller's), which
   *  hides the Size row; absent means it can. */
  canResizePreview?: () => boolean;
  getPreviewSize: () => PreviewSize;
  onPreviewSizeChange: (size: PreviewSize) => void;
  /** The preview's and the output's Resolution scale (src/render/outputPower.ts),
   *  a fraction from RESOLUTION_MIN to RESOLUTION_MAX. */
  getPreviewResolution: () => number;
  onPreviewResolutionChange: (value: number) => void;
  /** The pop-out output's live render readouts, null while none is open —
   *  the second, "Output" Power card shows only while this is non-null. */
  getOutputPowerStatus: () => OutputRenderStatus | null;
  /** The output's own Quality choice, Resolution and Energy saving
   *  (src/render/outputPower.ts), edited on the Output card and sent to its window. */
  getOutputQualityChoice: () => QualityChoice;
  onOutputQualityChoiceChange: (choice: QualityChoice) => void;
  getOutputResolution: () => number;
  onOutputResolutionChange: (value: number) => void;
  getOutputPowerMode: () => PowerMode;
  onOutputPowerModeChange: (mode: PowerMode) => void;
  /** The button that opens this menu — excluded from the tap-outside
   *  focus reset, and ringed (aria-pressed) while the panel is open. */
  toggleButton: HTMLElement;
}

export interface DeviceMenu {
  toggle(): void;
  close(): void;
  /** Fed every frame while in a viz (any may be null: frame/ungained/anim
   *  before audio is up, rawBands/mono additionally on a mic-less renderer
   *  device) — drives the Input card's level wash, the spectrum strip's
   *  feeds, and the meters. `frame` has the band faders applied; `ungained`
   *  is the same frame before them (the strip's ghost bars); `pinnedBands`
   *  is which bands the gain stage clamped (bandGains.ts's own pinnedBands);
   *  `anim`/`mono`/`fixedEnergy`/`lufs` feed the meters (audioMeters.ts) —
   *  `fixedEnergy` is FeatureExtractor.fixedEnergy, null wherever this
   *  device isn't running its own extractor (renderer, synthetic feed);
   *  `lufs` is this device's lufsAnalyser reading, null on the same paths
   *  (the Dynamics card's Loudness row hides itself). `rateScale` is app.ts's
   *  already-resolved sensitivity.ts's smoothingRateScale for this tick's
   *  Smoothing value — forwarded to the meters so their own BPM settle and
   *  waveform peak-hold bypass at Smoothing's Off stop the same way the rest
   *  of the pipeline does; not re-resolved here, since resolveSmoothing()
   *  slews its auto value and this runs every rAF tick. `beatDiag` is
   *  FeatureExtractor.onsetDiag, null on the same paths as `fixedEnergy`.
   *  `gate` is this device's own SilenceGateReading (src/audio/silenceGate.ts)
   *  — app.ts's `lastGate` — null on the same paths as `fixedEnergy`, for the
   *  Dynamics card's Gate row. `drives` is this tick's SceneDrives (src/render/drives.ts),
   *  off the same *un-latched* AnimFrame as `anim` — null on the same paths.
   *  A drive row's live pill reads its uniformPair() (the same number a
   *  scene's u<Key>Drive uniform gets), and the Frequencies overlay reads
   *  its excess(); neither ever calls fired(), so polling it here every
   *  tick can't steal a grid setting's pending edge out from under the
   *  scene that's about to render it. */
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
  ): void;
  /** Whether the panel is currently open — lets immersive fullscreen mode
   *  (src/ui/fullscreen.ts) skip idle-hiding the gear out from under it. */
  isOpen(): boolean;
  /** The scene (or its palette) changed from outside the panel — a Set pad,
   *  a key, Autopilot: rebuilds everything that follows the active scene, as
   *  open() does. No-op while closed (open() does it then). */
  sceneChanged(): void;
}

// ---- styles --------------------------------------------------------------
// Layout-level rules (columns, slider, hint reveal, toggle) are class rules in
// controlsTheme.ts; the card and row-head grammar shared with the meters is
// in controlsKit.ts; everything else per-element is inline here, in the same
// cssText-constant convention as the rest of src/ui/.

// "A" chip: filled when auto owns the row, outlined when the user does. The
// "T" chip below shares the outlined style (autoChipManualStyle) unlit.
const autoChipBaseStyle = `
  width: 17px; height: 16px; display: grid; place-items: center; border-radius: 3px;
  font: 500 9.5px/1 ${FONT_MONO}; cursor: pointer; padding: 0; flex-shrink: 0;
`;
const autoChipLitStyle = (accent: string) =>
  `${autoChipBaseStyle} background: ${accent}; border: 1px solid ${accent}; color: #070a09;`;
const autoChipManualStyle = (accent: string) =>
  `${autoChipBaseStyle} background: transparent; border: 1px solid ${withAlpha(accent, 0.7)}; color: ${accent};`;
// "T" chip: mutes the row to its floor and back (see the header comment).
// Shares the A chip's geometry and unlit style, but lit it fills with FADER_OFF — the panel's
// one "this is off" colour, the band faders' too — rather than the row's
// accent, so a muted row never reads as a lit A chip at a glance.
const offChipLitStyle = `${autoChipBaseStyle} background: ${FADER_OFF}; border: 1px solid ${FADER_OFF}; color: #070a09;`;
const AUTO_HOLDING_HINT = "Auto is holding this — drag to take over";
/** The Master card's Expansion shape chips by name, in sceneSettings.ts's
 *  EXPANSION_SHAPES order — the chips' own labels and the output graph's
 *  Expansion tag both read these. */
const EXPANSION_SHAPE_NAMES = ["Even", "Soft top", "Big moves only", "Up only", "Down only"] as const;

// The Auto master bar — its own slim full-width strip at the top of the
// settings column, a folded card's title-bar height (FOLDED_BAR_PX,
// controlsTheme.ts).
const autoMasterBaseStyle = `
  width: 100%; box-sizing: border-box; height: ${FOLDED_BAR_PX}px; flex-shrink: 0;
  cursor: pointer; padding: 0; border-radius: 3px;
  -webkit-backdrop-filter: ${GLASS_FILTER}; backdrop-filter: ${GLASS_FILTER};
`;
const autoMasterStyle = `${autoMasterBaseStyle} background: ${GLASS_BG}; border: 1px solid ${withAlpha(AUTO_SKY, 0.3)};`;
const autoMasterLitStyle = `${autoMasterBaseStyle} background: linear-gradient(${withAlpha("#1479b0", 0.28)}, ${withAlpha("#1479b0", 0.28)}), ${GLASS_BG}; border: 1px solid ${withAlpha(AUTO_SKY, 0.6)};`;
// Label + ON/OFF sub-label inline on one line, centred in the bar.
const autoMasterInnerStyle = `display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 100%;`;
const autoMasterLabelStyle = (lit: boolean) =>
  `font: 500 13px/1.2 ${FONT_LABEL}; color: ${lit ? "#a0e7ff" : "rgba(255,255,255,0.55)"};`;
const autoMasterSubStyle = (lit: boolean) =>
  `font: 400 8.5px/1.4 ${FONT_MONO}; letter-spacing: 0.14em; color: ${lit ? withAlpha("#8dccf9", 0.8) : "rgba(255,255,255,0.4)"};`;

// The Input card's own "Auto" button (see micAuto.ts's header for what
// "the whole mic" covers) — a compact, header-sized member of the
// autoMaster* family above: same lit/unlit shape, same glass-tinted
// pill, scaled down to sit beside a Reset chip in a card header instead of
// spanning the settings column, and given the Input card's own accent
// (INPUT_GREEN) rather than the Auto bar's sky blue.
const micAutoBaseStyle = `
  font: 500 9.5px/1.2 ${FONT_MONO}; letter-spacing: 0.04em; padding: 2.5px 8px;
  border-radius: 4px; cursor: pointer;
  -webkit-backdrop-filter: ${GLASS_FILTER}; backdrop-filter: ${GLASS_FILTER};
`;
const micAutoStyle = `${micAutoBaseStyle} background: ${GLASS_BG}; border: 1px solid ${withAlpha(INPUT_GREEN, 0.35)}; color: rgba(255,255,255,0.55);`;
const micAutoLitStyle = `${micAutoBaseStyle} background: linear-gradient(${withAlpha(INPUT_GREEN, 0.28)}, ${withAlpha(INPUT_GREEN, 0.28)}), ${GLASS_BG}; border: 1px solid ${withAlpha(INPUT_GREEN, 0.7)}; color: #eafff0;`;
// Wraps the Auto button and the Reset chip in the Input card's header —
// createCard's `right` slot takes one element, not a list.
const inputCardHeaderRightStyle = `display: flex; align-items: center; gap: 6px;`;

// The column head above the Bands card (live dot · audio source, and the
// column's one RAW chip) — a plain label side and a chip side, no card of
// its own, the same shape audioMeters.ts's own meterGroupHeading rides
// alongside (that file's meterGroupHeadingStyle sizes its own top margin
// for sitting flush under a strip like this one).
const columnHeadStyle = `display: flex; align-items: center; justify-content: space-between; margin: 2px 0 10px;`;
const spectrumStatusStyle = `display: flex; align-items: center; gap: 6px; flex-shrink: 0;`;
const liveDotStyle = (on: boolean) =>
  `width: 4px; height: 4px; border-radius: 50%; background: ${on ? LIVE_DOT : "rgba(255,255,255,0.3)"};`;
const statusTextStyle = `font: 400 10.5px/1 ${FONT_MONO}; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.5);`;

// The Equaliser readouts' hint — plain text, not .vc-hint: that class waits
// for hover/focus on an enclosing .vc-row, and this line has no row of its
// own to wait on (it's always on screen alongside the readouts, not tucked
// under a control someone has to find).
const eqHintStyle = `font: 400 11px/1.5 ${FONT_LABEL}; color: rgba(255,255,255,0.5); margin-top: 6px;`;
const FADER_HINT_TEXT =
  "Drag a knob up to boost a band, down to cut it. Pin a reactive setting to plug signals into it.";

// The Bands card's Levels row: a small caption, then a 3-column grid of
// BAND_LEVEL_CHOICES's own compact meters (below) — one row rather than
// three full-width ones, since Low/Mid/High only ever need a bar and a jack.
const levelsRowStyle = `display: flex; flex-direction: column; gap: 4px; margin-top: 10px;`;
const levelsLabelStyle = `font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.45);`;
const levelsGridStyle = `display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;`;
// Each cell is ~110px wide (377px card minus padding, over three columns and
// two gaps) — tight enough that the row grammar's own label wants a smaller
// font than a full-width row; no readout to shrink (bandLevelRows never
// calls setReadout — the bar and jack already say everything one of these
// needs to). padding/margin match the old full-width rows' own trick: a
// `.vc-row`'s hover glow (controlsTheme.ts) reaches past its content, so
// this cancels it back to the grid cell's own edge.
const levelsCellStyle = `padding: 2px 8px; margin: -2px -8px;`;
const levelsCellLabelStyle = `font-size: 11.5px;`;

// The column head's one RAW chip — see its own build site (below, near
// spectrumCol) for why one chip drives two independent raw modes at once.
// The Smoothing paragraph is the useful half of audioMeters.ts's own former
// RAW_CHIP_TITLE (that file no longer owns a chip to title).
const RAW_CHIP_TITLE =
  "Raw: the spectrum before the adaptive envelope and Bands gain, and every meter reading below its pre-smoothing value. Drag Smoothing (Input card) to Off instead to close that second gap for good — at Off, every eased reading already lands on exactly what this shows.";

// ---- The patch bay (a drive row's port/summary/sparkline, and its pinned
// patch panel) — see this file's own header doc-comment paragraph. Every
// colour/label comes from src/ui/driveSources.ts; this is only layout.

// createControlRow's own drivePanel slot: the label + summary wrapper that
// pins on click. Stacked (label, then the summary on its own line) rather
// than side by side — inline, the summary had nowhere left to grow in the
// narrow controls column and ellipsized to unreadable ("Built-in: two-st…")
// even at a middling width; a second line wraps instead, however long the
// source list gets.
const driveRowLeftStyle = `display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; cursor: pointer;`;
const driveSummaryStyle = `
  font: 400 11px/1.35 ${FONT_MONO}; color: rgba(255,255,255,0.45); min-width: 0;
  overflow-wrap: break-word;
`;
// The input port: a 10 px ring at the row's own left edge, facing the
// meters column (which docks to the screen's own left edge — see
// controlsTheme.ts's .vc-spectrum-col). Position/size/shape live in
// controlsTheme.ts's own .vc-drive-port class rule, not here; drivePortStyle()
// below only ever writes what actually depends on this row's own live
// state — the setting's plugged sources' colours, and the pinned/preview
// ring.

const driveSparkWrapStyle = `margin-top: 4px; height: 20px;`;
const driveSparkCanvasStyle = `display: block; width: 100%; height: 100%;`;

// The pinned row's expanded panel.
const drivePatchPanelStyle = `
  margin-top: 8px; padding: 9px 9px 8px; border-radius: 7px;
  background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.08);
  display: flex; flex-direction: column; gap: 8px; cursor: default;
`;
const drivePatchHeadStyle = `display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;`;
const driveEyebrowStyle = `font: 500 9.5px/1 ${FONT_LABEL}; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(255,255,255,0.4);`;

// Mix segmented control (Add/Strongest/Only when).
const driveSegStyle = `display: inline-flex; border: 1px solid rgba(255,255,255,0.18); border-radius: 6px; overflow: hidden;`;
const driveSegBtnBase = `
  font: 500 10px/1 ${FONT_LABEL}; letter-spacing: 0.08em; text-transform: uppercase;
  background: none; border: none; border-left: 1px solid rgba(255,255,255,0.1); padding: 6px 9px; cursor: pointer;
`;
const driveSegBtnStyle = `${driveSegBtnBase} color: rgba(255,255,255,0.6);`;
const driveSegBtnLitStyle = `${driveSegBtnBase} color: #fff; background: rgba(255,255,255,0.12);`;
const driveSegBtnDisabledStyle = `${driveSegBtnBase} color: rgba(255,255,255,0.22); cursor: not-allowed;`;

// One source line. Five fixed columns so every line — condition or plain,
// muted or not — aligns identically (this file's own header): a left gutter
// for the condition marker (driveSrcGutterStyle, never a border+padding on
// the whole line — see controlsTheme.ts's .vc-drive-gutter-cond), the mute
// switch, the colour dot, the name, then the unplug button; driveSrcCtrlsStyle
// (row 2) spans from the name's own column so it indents under the name, not
// under the gutter/switch/dot.
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

// Height (mini) segmented control, the grid division chips, and the role
// toggle — smaller than the mix control, since a source line already
// carries a lot.
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

// The Line add-chip's own tooltip — a source line has no room for a fourth
// line of prose once it's plugged in (buildSourceLine's own drawHint is the
// short version shown there instead).
const LINE_HINT_TEXT =
  "Draw the line down onto the bars this setting listens to — keep it just above where they rest so only the hits poke over it. A band left at the top is ignored.";

// "+ Add by name" chip groups — always open in the stacked layout (jacks
// are far away there, this phase has none yet either); behind a small
// disclosure in the wide layout.
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

// The output graph — 4 s of sourceValues()/valueOf().
const driveOutHeadStyle = `display: flex; justify-content: space-between; align-items: baseline;`;
const driveOutValStyle = `font: 400 12px/1 ${FONT_MONO}; color: #fff;`;
const driveOutCanvasStyle = `display: block; width: 100%; height: 56px; border-radius: 5px; background: rgba(255,255,255,0.02);`;

const driveResetLinkStyle = `
  align-self: flex-start; background: none; border: none; padding: 0;
  font: 500 11px/1 ${FONT_LABEL}; color: ${SCENE_VIOLET}; text-decoration: underline; text-underline-offset: 3px; cursor: pointer;
`;


/** Solo's eye (positionSoloEye) — its box, which controlsTheme.ts's
 *  .vc-solo-eye rule sizes to match. */
const SOLO_EYE_PX = 18;

// Footer strip.
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

// The Input card doubles as a level meter: two stacked background washes
// (sized per frame in update()) under the glass, not separate bars — a bar
// stacked over a slider read as a second, draggable control it wasn't:
//  - the tick: a 2px hard edge at FeatureFrame.level, the room's absolute
//    loudness against a fixed dB window — always input-green, and unmoved by
//    the Auto-gain toggle below or by Sensitivity, since neither ever
//    touches it.
//  - the fill: a solid wash out to the shaped (post-Auto-gain,
//    post-sensitivity) level — where the scene is actually reacting right
//    now. Its color rides the --wash custom property (see washColor()) so
//    only that one value needs writing each frame as the level nears
//    clipping.
// The gap between tick and fill edge is Auto-gain and Sensitivity together,
// visibly: flip Auto-gain on in a quiet room and the gap visibly opens.
//
// Hot-zone ramp for the fill wash: green all the way up to HOT_START, then
// green -> yellow over the next slice, then yellow -> red in the last
// PEAK_START..1 sliver — a silent "the scene has stopped reacting, you're
// pinned at max" cue that the flat level wash alone doesn't give.
const HOT_START = 0.96; // last 4%: green -> yellow
const PEAK_START = 0.99; // last 1%: yellow -> red
const WASH_ALPHA = 0x26; // resting fill alpha
const WASH_HOT_ALPHA = 0x40; // fill alpha at full clip — needs to be more opaque to read as a warning

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

/** The fill wash's color for a shaped level in [0,1]: input-green below
 *  HOT_START, ramping through yellow to red as the level nears 1 (clipped). */
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

/** Marks a heading as a keyboard block — see the header comment's keyboard
 *  paragraph. Idempotent (safe to call on every render of a heading that's
 *  rebuilt fresh each time, and a no-op on one that's already marked), so a
 *  static card title can be marked once at construction while a per-scene
 *  group heading gets marked on every renderSceneSettings without doubling
 *  up. The badge itself is filled in later by renumberBlocks. `data-key`
 *  (keyHints.ts) is the badge's own, not the heading's, since the badge is
 *  what actually shows the digit the hover tooltip reads off — it carries
 *  no `data-keycap`, on purpose: it already shows that digit as plain text. */
function markBlock(heading: HTMLElement): void {
  if (heading.classList.contains("vc-block")) return;
  heading.classList.add("vc-block");
  const badge = document.createElement("span");
  badge.className = "vc-block-n";
  badge.dataset.key = "block";
  heading.prepend(badge);
}

/** The other half of markBlock — used where a heading's block-ness depends on
 *  the active scene (the Scene card title, see renderSceneSettings). */
function unmarkBlock(heading: HTMLElement): void {
  if (!heading.classList.contains("vc-block")) return;
  heading.classList.remove("vc-block");
  heading.querySelector(".vc-block-n")?.remove();
}

// Exported so audioMeters.ts's Hits card's Shape section
// (src/audio/hitStrength.ts) can reuse this same slider row instead of
// duplicating it — the meters panel already builds one control this way.
export interface ControlRowSpec {
  label: string;
  accent: string;
  min: number;
  max: number;
  /** Linear rows only — the slider's native step. */
  step?: number;
  defaultValue: number;
  /** log: the slider is a 0..100 position mapped so the midpoint lands near
   *  defaultValue (the gain rows); linear: the slider is the value itself. */
  mapping: "log" | "linear";
  /** Log rows only. When set, the slider's bottom position snaps to exactly 0
   *  (an explicit kill, DJ-mixer style) instead of continuing the log curve
   *  down to `min` — log(0) has no position, so 0 needs this special case.
   *  The curve itself still spans `min`..`max` across the rest of the track. */
  zeroAtMin?: boolean;
  /** Mono suffix after the digits ("×"). */
  unit?: string;
  format: (value: number) => string;
  description?: string;
  /** Wires the auto chip — see autoTune.ts. Omit to leave the row manual-only. */
  auto?: {
    isEnabled: () => boolean;
    toggle: (on: boolean) => void;
    resolveLive: () => number;
    /** The manually-stored value — read when the chip turns auto off, since
     *  that reveals whatever's stored, not whatever the slider happened to be showing. */
    getManual: () => number;
  };
  /** Fires after every chip click that flips `auto` (either direction), and
   *  after every commit() — a drag or reset hands the row back to manual
   *  through its own onChange, which flips the flag just the same — the one
   *  hook the Input card's rows use to keep its own Auto button in
   *  sync (deviceMenu.ts's refreshMicAuto) instead of each row sprinkling
   *  that call individually, and the scene rows use to keep the Auto
   *  master bar in sync (refreshAutoMaster). Omit for a row nothing else
   *  needs to hear about. */
  onAutoToggled?: () => void;
  /** Dev-only: makes the readout typable, bound to a scene+key already —
   *  see DeviceMenuDeps.devPin. Omit to leave the readout the plain
   *  non-interactive span it's always been (any prod build, or a row this
   *  affordance doesn't apply to). */
  pin?: {
    get(): number | undefined;
    set(value: number): void;
    clear(): void;
    /** What to fall back to once a pin is cleared by an invalid/empty typed
     *  value — the row's already-resolved live value (auto/override-aware,
     *  same getter the row's own auto path uses), not a raw manual read, so
     *  clearing a pin never fights whatever else currently owns the row. */
    resolve(): number;
  };
  /** SceneSetting.reads (sceneSettings.ts), resolved to concrete signals and
   *  callbacks by appendSettingRow below — see ResolvedSignalRead. Omit for
   *  a setting with no `reads` entries. */
  reads?: readonly ResolvedSignalRead[];
  /** The one extension point a drive setting's row needs (this file's own
   *  doc-comment paragraph) — built by appendSettingRow's buildDriveRow,
   *  never forked out of this function: `port` mounts absolutely at the
   *  row's left edge (`.vc-row` is already `position: relative`); `summary`
   *  mounts inline right after the label, inside the same clickable wrapper;
   *  `below` mounts as the row's last child (the sparkline, and — once
   *  pinned — the patch panel); `onPin` fires on a click anywhere in the
   *  label/summary wrapper or on `port` (stopPropagation'd so it never also
   *  triggers this row's own click-to-focus-slider handler below) and
   *  toggles. Omit for a setting with no `drive`. */
  drivePanel?: {
    port: HTMLElement;
    summary: HTMLElement;
    below: HTMLElement;
    onPin: () => void;
  };
  /** Fires on a click anywhere on the card, the slider included, that isn't
   *  one of its side controls (isCardPress) — pin-only, so a stray click on
   *  a pinned card can't close it. Every Scene-card row passes it, drive or
   *  not; omit for a row that can't be pinned. */
  onCardPin?: () => void;
  /** Other selected items' own current value for this exact setting — the
   *  multi-item-selection bridge (registry.ts's `appendRow` `linked` option,
   *  itemBoxes.ts's multi-strain edit). Present (possibly with 0 entries)
   *  only for a row appendSettingRow built with `linked`; every other row
   *  omits this field entirely, so it never allocates the tick-mark DOM at
   *  all. A tick is drawn on the slider track at a linked value's own
   *  position (its own colour, or a neutral one) only while it disagrees
   *  with this row's current value — `row.setLinkedTicks` (the returned
   *  object) is how a caller keeps this current after its own commit
   *  changes which of them still disagree, since only this row's own edits
   *  can ever change any of them (their own rows never render while
   *  selected together). */
  linkedTicks?: readonly { value: number; colour?: string }[];
}

/** One SceneSetting.reads entry (sceneSettings.ts's SignalLink) resolved
 *  against the active scene: `active` closes over the sibling-setting getter
 *  a SignalLink.activeWhen predicate needs (built once in appendSettingRow,
 *  not per frame), and `onReveal`, present only when the SignalSpec itself
 *  has a `monitor` anchor, is the click target for its pill — unfold/scroll/
 *  flash the meter row that shows it (audioMeters.ts's revealRow). */
interface ResolvedSignalRead {
  signal: SignalSpec;
  active: () => boolean;
  onReveal?: () => void;
}

/** Shared by every document-level hotkey (H, Tab, the digits) and by
 *  wireHoverFocus below, and imported into app.ts for its own beat-trim keys
 *  (B, [, ], comma, period): ignored while typing somewhere (a range slider
 *  keeping focus after a drag is fine — that's still "in the panel", there's
 *  just nothing to type in the panel itself). */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "TEXTAREA" || t.isContentEditable) return true;
  if (tag === "INPUT" && (t as HTMLInputElement).type !== "range") return true;
  return false;
}

/** Wires A/R/T on a row's own focusable control (the slider or the toggle
 *  pill) — kept on the control itself, not the document, so the keys always
 *  act on whichever row the Tab ring last focused. Routes through the row's
 *  existing click handlers (`.click()`) rather than re-implementing them, so
 *  a hotkey and its chip can never drift apart. `auto` is omitted for rows
 *  with no auto weights (the A key then no-ops, matching the hidden chip).
 *  The single place all three keys report to keyHints.ts's noteKeyUse, so
 *  every row (this file's own scene-setting rows, and the hand-rolled Auto
 *  strength row that also calls this) shares one count per id rather than
 *  each call site remembering to. */
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

// How far from the thumb (in px) the magnetic pull starts, and how much
// extra scale it stacks on top of the row's existing 1.7x hover/focus boost
// (controlsTheme.ts) at zero distance — see wireThumbMagnet below.
const THUMB_MAGNET_RADIUS_PX = 48;
const THUMB_MAGNET_MAX_BOOST = 1.3;

/** Makes a slider's thumb grow further as the pointer nears it, on top of
 *  the row's existing hover/focus scale-up — a bigger target exactly where
 *  the pointer already is, rather than uniformly across the row. Written as
 *  a --vc-thumb-boost custom property that the thumb's transform multiplies
 *  in (controlsTheme.ts), so it composes with that existing rule instead of
 *  fighting it, and costs nothing when the pointer is elsewhere (falls back
 *  to 1). Purely a mouse nicety — keyboard/touch interaction never sets it. */
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

// The last real mouse position seen anywhere in the panel — shared across
// every wireHoverFocus call (there's exactly one device menu instance) rather
// than kept per-row, because the case this exists to catch is cross-row:
// scrolling `.vc-controls-col` (or a keyboard jumpToBlock's scrollIntoView)
// with a stationary cursor carries a *different* row under it and fires a
// synthetic mousemove there at the unchanged coordinates. A per-row last-seen
// position wouldn't catch that — the newly-arrived row has never seen this
// position before even though the real cursor didn't move — so the check has
// to be panel-wide to recognize "nothing actually moved."
let lastHoverX = -1;
let lastHoverY = -1;

// True only for the duration of a wireHoverFocus-triggered control.focus()
// call below — appendSettingRow's onRowFocusIn reads this (synchronously,
// from inside the focusin its own control.focus() call below dispatches) to
// tell a real pointer-originated focus apart from a keyboard/click one, so
// only the former waits out HOVER_SELECT_DELAY_MS before selecting. One
// shared flag rather than per-row state, same reasoning as lastHoverX/Y
// above — there's exactly one device menu instance.
let pointerFocusOriginated = false;

// How long a pointer-originated row focus waits before it actually selects
// (appendSettingRow's onRowFocusIn) — long enough that a fast diagonal
// sweep toward the spectrum strip never lands, short enough that resting
// the pointer on a row still feels immediate.
const HOVER_SELECT_DELAY_MS = 150;

/** Focuses `control` on real pointer movement over `row` — a hover row reads
 *  as focused already (controlsTheme.ts styles :hover and :focus-within
 *  identically), so this makes the keyboard agree without a click first.
 *  Must use `preventScroll` — the panel's columns are `.vc-scroll`, and a bare
 *  focus() would scroll the row into view, sliding it out from under the
 *  cursor (see bandFaders.ts's own hit.focus() for the same reason). Never
 *  steals focus from a typing target (the pin input's blur commits its
 *  value, so mid-type is off limits) — checked against document.activeElement,
 *  not the event target, since the pointer is over this row, not the input
 *  holding focus elsewhere. */
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

/** What a click on a row's card leaves alone rather than pinning
 *  (isCardPress): anything that's a control in its own right — the A/T/reset
 *  chips, the signal pills — and the pinned patch panel, whose own chips and
 *  buttons rebuild it. The row's own value control counts as the card. */
const ROW_OWN_CONTROLS = "button, input, select, textarea, a, [role], .vc-drive-patch";

/** A click on `row` counts as pressing the card itself — its padding, text,
 *  sparkline, or its own value control `main` (the slider, switch or picker
 *  strip; `click` only lands once the pointer is up, so a slider drag
 *  finishes before a patch panel elsewhere collapses and shifts the row) —
 *  rather than one of its side controls. */
function isCardPress(row: HTMLElement, main: HTMLElement, target: EventTarget | null): boolean {
  const own = (target as Element | null)?.closest(ROW_OWN_CONTROLS);
  return !own || !row.contains(own) || main.contains(own);
}

/** The pointer's fraction along `slider`'s track (0 at min, 1 at max,
 *  clamped) — used by wireSliderQuickJump's c binding below. A keydown
 *  carries no coordinates, so this reads lastHoverX/lastHoverY, the same
 *  panel-wide last-real-cursor-position wireHoverFocus above maintains.
 *  Undefined when the pointer hasn't entered the panel yet, or sits outside
 *  `row` — the desync wireHoverFocus's own comment describes, where
 *  scrolling carries a different row under a stationary cursor without
 *  moving focus there; c should no-op then rather than edit a row the
 *  pointer has left. Maps across the slider's full rect, not its thumb's
 *  inset travel, matching both wireThumbMagnet's thumbX above and the
 *  --vc-fill percentage (controlsTheme.ts) that paints the track — the
 *  boundary the eye reads as "the value" sits at this position, and the
 *  thumb itself is only 3px wide, so the half-thumb inset this skips is
 *  sub-pixel. */
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

/** z centers a focused slider, x maxes it out, c jumps it to wherever the
 *  pointer last was along the track (pointerFraction above) — a fast way to
 *  land on any value without dragging. No key for the low end: Home already
 *  jumps a native range input to its min for free (onKeyDown, below, doesn't
 *  intercept it), so the only capabilities worth adding are the ones
 *  Home/End don't cover. Plain single keys, not a chord — z/x/c collide with
 *  nothing else live while a slider has focus (A/R/T/D, the panel's
 *  H/M/Tab/Shift+1-9, the arrows, and Home/End are all spoken for). c no-ops when
 *  pointerFraction returns undefined, rather than falling back to some other
 *  value — see its comment for why. Sets .value then redispatches "input"
 *  rather than duplicating each slider's own commit logic, so this stays a
 *  one-line addition at every call site regardless of what that site's
 *  "input" listener does. */
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

/** One slider row in the panel's grammar — label, readout, chip, ↺, slider,
 *  hint. Gain rows (log-mapped) and scene setting rows (linear) are the same
 *  shape, so the construction and pos<->value mapping live here once. */
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

  // Last value display() actually rendered — the typed field's prefill, and
  // (with editingPin) whether display() needs to keep the field showing
  // instead of the digits it would otherwise reassert every refresh.
  let lastValue = spec.defaultValue;
  let editingPin = false;

  // Dev-only typed entry — see ControlRowSpec.pin. The digits span becomes
  // the click trigger for a plain text field swapped in over it (not reached
  // by Tab — the panel's ring (ringElements() below) only walks
  // .vc-slider/.vc-toggle/.vc-fader, so this is mouse/touch-only, matching
  // the rest of the row's pointer-only affordances like the thumb magnet). A
  // `*` marks a pinned (out-of-range) value in BANDS_AMBER, a cross-card
  // color chosen so it reads as "outside the slider" regardless of which
  // card's own accent this row is using.
  let pinMark: HTMLSpanElement | null = null;
  let pinInput: HTMLInputElement | null = null;
  if (spec.pin) {
    pinMark = document.createElement("span");
    pinMark.textContent = "*";
    pinMark.title = "Pinned — typed value outside the slider's range";
    pinMark.style.cssText = `color: ${BANDS_AMBER}; font: 400 11px/1 ${FONT_MONO}; display: none;`;
    readout.appendChild(pinMark);

    digits.style.cursor = "text";
    digits.title = "Click to type a value";

    pinInput = document.createElement("input");
    pinInput.type = "text";
    pinInput.inputMode = "decimal";
    pinInput.className = "vc-pin-input";
    // Color/border/background live in the .vc-pin-input rule (controlsTheme.ts),
    // not here — an inline color would win over it and inputs don't inherit
    // color the way a span does, which is how this used to render black
    // text on the panel's dark glass.
    pinInput.style.cssText = `${digitsStyle} width: 4.5em; display: none;`;
    readout.insertBefore(pinInput, digits);

    // stopPropagation on both the trigger and the field itself so el's own
    // click-to-focus-slider handler (below) never steals focus back out.
    digits.addEventListener("click", (e) => {
      e.stopPropagation();
      pinOpenEdit();
    });
    pinInput.addEventListener("click", (e) => e.stopPropagation());
    // Escape sets this so the blur that display:none triggers on the
    // focused field (browsers fire it automatically) is a no-op instead of
    // re-committing whatever text was left in the box.
    let suppressBlurCommit = false;
    pinInput.addEventListener("blur", () => {
      if (suppressBlurCommit) {
        suppressBlurCommit = false;
        return;
      }
      pinCommitTyped();
    });
    pinInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        pinInput!.blur(); // triggers the blur listener above -> commits
      } else if (e.key === "Escape") {
        e.preventDefault();
        suppressBlurCommit = true;
        pinCloseEdit();
      }
    });
  }
  // Bound to the assigned functions further down (pinOpenEdit etc. are
  // function declarations, hoisted within this same call), once display(),
  // commit(), and clearOff() exist below to close over.
  function pinOpenEdit(): void {
    if (!pinInput) return;
    editingPin = true;
    pinInput.value = String(lastValue);
    digits.style.display = "none";
    pinInput.style.display = "";
    pinInput.focus();
    pinInput.select();
  }
  function pinCloseEdit(): void {
    if (!pinInput) return;
    editingPin = false;
    pinInput.style.display = "none";
    digits.style.display = "";
  }
  function pinCommitTyped(): void {
    if (!spec.pin || !pinInput) return;
    const text = pinInput.value.trim();
    const value = Number(text);
    pinCloseEdit();
    if (text === "" || !Number.isFinite(value)) {
      spec.pin.clear();
      display(spec.pin.resolve(), false);
    } else if (value >= spec.min && value <= spec.max) {
      spec.pin.clear();
      clearOff();
      commit(value);
    } else {
      clearOff();
      spec.pin.set(value);
      display(value, false);
    }
  }

  const chip = document.createElement("button");
  chip.textContent = "A";
  chip.title = `Auto-tune ${spec.label} (A)`;
  chip.style.cssText = autoChipManualStyle(spec.accent);
  // data-key/data-keycap (keyHints.ts): every row's A chip shares the one
  // "auto" id, so a keys-list hover/click (deviceMenu.ts's flashOn) and a
  // held Shift's keycap reach all of them at once, not just this row's.
  chip.classList.add("vc-keycap-anchor");
  chip.dataset.key = "auto";
  chip.dataset.keycap = "A";
  // A row with no auto weights has nothing for the chip to do — leave it out
  // rather than show a toggle that can't change anything.
  if (!spec.auto) chip.style.display = "none";

  // Mutes the row to its floor and restores it on a second press — see the
  // header comment's row-grammar paragraph for the full contract.
  const offChip = document.createElement("button");
  offChip.textContent = "T";
  offChip.title = `Turn ${spec.label} off (T)`;
  offChip.style.cssText = autoChipManualStyle(spec.accent);
  offChip.classList.add("vc-keycap-anchor");
  offChip.dataset.key = "mute";
  offChip.dataset.keycap = "T";

  // visibility (not display) keeps the row from reflowing while dragging.
  const resetBtn = document.createElement("button");
  resetBtn.textContent = "↺";
  resetBtn.title = `Reset ${spec.label} (R)`;
  resetBtn.style.cssText = rowResetStyle;
  // Keycap is the shortcut key (R), not the glyph this button shows.
  resetBtn.classList.add("vc-keycap-anchor");
  resetBtn.dataset.key = "reset";
  resetBtn.dataset.keycap = "R";

  // src/render/signals.ts's link from this setting to the live values that
  // drive it — a small always-on chip in `right` (leftmost, read as a badge
  // on the row rather than another action) plus a hover-revealed pill strip
  // appended below, outside .vc-hint (see the .vc-reads rule,
  // controlsTheme.ts, for why that placement matters). Omit both entirely
  // for the common case of no `reads` — most rows have none.
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
  right.append(chip, offChip, resetBtn);
  if (spec.drivePanel) {
    const left = document.createElement("div");
    left.style.cssText = driveRowLeftStyle;
    // Room for the port at this row's own left edge (controlsTheme.ts's
    // .vc-drive-row-left/.vc-drive-port) — a plain gap would leave the
    // port floating over the text.
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
  // The accent rides the row (not just the slider) so the hover/focus
  // highlight on the title and track share it — see controlsTheme.ts.
  el.style.setProperty("--vc-accent", spec.accent);
  const isLog = spec.mapping === "log";
  // Continuous, not stepped: a declared `step` is the uniform's meaningful
  // resolution, not a detent, and snapping to it made a 0..1 row jump in
  // twenty visible hops across the track. Only a step of 1 or more marks a
  // genuinely discrete control (integer counts), which keeps its detents.
  const discrete = !isLog && spec.step !== undefined && spec.step >= 1;
  if (isLog) {
    slider.min = "0";
    slider.max = "100";
  } else {
    slider.min = String(spec.min);
    slider.max = String(spec.max);
  }
  slider.step = discrete ? String(spec.step) : "any";

  // Two lines: the setting's own description, always present when it has
  // one, and beneath it the auto takeover note, shown only while auto holds
  // the row — an addition, never a replacement, so the description stays
  // readable whichever side owns the value.
  const hint = document.createElement("div");
  hint.className = "vc-hint";
  const hintDesc = document.createElement("div");
  setHintText(hintDesc, spec.description ?? "");
  const hintAuto = document.createElement("div");
  hintAuto.className = "vc-hint-auto";
  hintAuto.textContent = AUTO_HOLDING_HINT;
  hint.append(hintDesc, hintAuto);

  // A divergent-value tick per linked item (ControlRowSpec.linkedTicks) is
  // drawn absolutely inside a small wrapper sized exactly to the slider's own
  // box, rather than over the whole row — only built when a row actually
  // has `linkedTicks` at all (undefined, not just empty, so an ordinary
  // single-item row never allocates this). See renderTicks()/setLinkedTicks
  // below for how a tick's own left offset matches the slider's log/linear
  // mapping.
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
    // The pinned patch panel sits inside this row, so its clicks bubble
    // here too: they keep their own focus, since pulling it to the slider
    // (far above, once the panel's scrolled into view) scrolled the column
    // up under the pointer. preventScroll for the same reason as
    // wireHoverFocus.
    if (!spec.drivePanel?.below.contains(e.target as Node)) slider.focus({ preventScroll: true });
    if (spec.onCardPin && isCardPress(el, slider, e.target)) spec.onCardPin();
  });
  wireHoverFocus(el, slider);
  wireThumbMagnet(el, slider);
  wireSliderQuickJump(el, slider);

  // Log-mapped so the midpoint lands close to defaultValue instead of skewing
  // toward the wide "more reactive" end. With zeroAtMin, position 0 is carved
  // out as an explicit kill and the log curve covers 1..100 instead of 0..100
  // — reserving a single position for it (vs. letting the curve asymptote
  // toward 0) is what makes the kill a deliberate, findable stop rather than
  // something you might land on by accident.
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

  function setReadout(value: number, muted: boolean): void {
    if (muted || (spec.zeroAtMin && value <= 0)) {
      digits.textContent = "Off";
      digits.style.cssText = `${digitsTextStyle} color: ${FADER_OFF};`;
      unit.style.display = "none";
      return;
    }
    digits.textContent = spec.format(value);
    digits.style.cssText = digitsStyle;
    if (spec.unit) unit.style.display = "";
  }

  function setHint(auto: boolean): void {
    hintDesc.style.display = spec.description ? "" : "none";
    hintAuto.style.display = auto ? "" : "none";
    hint.style.display = spec.description || auto ? "" : "none";
  }

  // The slider's own left-offset percentage for `value`, sharing the exact
  // log/linear/zeroAtMin mapping display() uses for its own fill — a
  // linked-item tick (renderTicks below) has to land at the same spot on the
  // track a slider drag to that same value would.
  function valueToPercent(value: number): number {
    const sliderValue = valueToSlider(value);
    const lo = Number(slider.min);
    const hi = Number(slider.max);
    const pct = hi > lo ? ((sliderValue - lo) / (hi - lo)) * 100 : 0;
    return Math.max(0, Math.min(100, pct));
  }

  // Other selected items' own values (ControlRowSpec.linkedTicks) — kept
  // live by setLinkedTicks below, initialized from the spec so the very
  // first render (a fresh selection with already-differing values) shows
  // them without waiting for an edit.
  let linkedTicksData: readonly { value: number; colour?: string }[] = spec.linkedTicks ?? [];
  function renderTicks(): void {
    if (!ticksWrap) return;
    ticksWrap.replaceChildren();
    for (const t of linkedTicksData) {
      if (Math.abs(t.value - lastValue) <= 1e-6) continue; // only while they differ
      const tick = document.createElement("i");
      tick.className = "vc-slider-tick";
      tick.style.left = `${valueToPercent(t.value)}%`;
      if (t.colour) tick.style.setProperty("--c", t.colour);
      ticksWrap.appendChild(tick);
    }
  }

  // Non-null while the row is muted (T pressed) — the value to restore on the
  // next T, and where display() holds the thumb meanwhile. Any write to the
  // row that isn't the mute/restore itself forgets this, via clearOff(), so
  // the chip never claims a restore point that no longer means anything.
  let offStoredValue: number | null = null;

  function display(value: number, auto: boolean): void {
    lastValue = value;
    // Muted (T): the setting runs at its floor, but the thumb stays where it
    // was — on the value a second T brings back — and the row greys out
    // (.vc-row-off, controlsTheme.ts) instead of sliding to the left end.
    const muted = offStoredValue !== null && !auto;
    const shown = muted ? offStoredValue! : value;
    slider.value = String(valueToSlider(shown));
    slider.style.setProperty("--vc-fill", `${valueToPercent(shown)}%`);
    el.classList.toggle("vc-row-off", muted);
    renderTicks();
    setReadout(value, muted);
    // setReadout just overwrote digits.style.cssText wholesale, which would
    // silently pop the digits back over an open typed-entry field on every
    // refresh (e.g. an auto row's ~100ms tick) — reassert the field's
    // visibility every call rather than only where it was opened.
    if (spec.pin) {
      if (editingPin) {
        digits.style.display = "none";
        pinInput!.style.display = "";
      }
      pinMark!.style.display = spec.pin.get() !== undefined ? "" : "none";
    }
    resetBtn.style.visibility = Math.abs(value - spec.defaultValue) > 1e-6 ? "visible" : "hidden";
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
    spec.pin?.clear();
    commit(sliderToValue());
  });
  resetBtn.addEventListener("click", () => {
    clearOff();
    spec.pin?.clear();
    commit(spec.defaultValue);
  });
  offChip.addEventListener("click", () => {
    // Any of the row's own controls taking over clears a pin the same way —
    // see the slider/reset handlers above.
    spec.pin?.clear();
    if (offStoredValue !== null) {
      const restore = offStoredValue;
      offStoredValue = null;
      commit(restore);
      refreshOffChip();
    } else {
      offStoredValue = sliderToValue();
      refreshOffChip();
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
        // A pin beats auto in resolve()'s precedence, so without this the
        // chip would light up while the row visibly stayed put — clearing it
        // here is what actually hands the row to auto.
        spec.pin?.clear();
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
    /** Called from the throttled per-frame refresh — pulls the live
     *  auto-resolved value while auto is on and this row isn't being dragged
     *  or mid-edit in the typed-entry field (editingPin — same reasoning as
     *  dragging: don't overwrite what the user is actively doing). */
    refreshAuto(): void {
      if (!spec.auto || dragging || editingPin || !spec.auto.isEnabled()) return;
      display(spec.auto.resolveLive(), true);
    },
    refreshChip,
    /** Forgets this row's T restore point — for the card-level Reset chips
     *  (Bands, Input), which write straight through setValue() rather than
     *  this row's own resetBtn. Call it BEFORE setValue(): display() renders
     *  the row muted while a restore point is held, and clearOff() itself
     *  only repaints the T chip. */
    clearOff,
    /** Show whatever's right for the row now: the live auto value if auto
     *  owns it (resolveLive() already reflects a pin ahead of auto — see
     *  autoTune.ts's resolve() — so no separate check is needed there), a
     *  pin ahead of the manual store otherwise. */
    sync(manualValue: () => number): void {
      refreshChip();
      if (spec.auto && spec.auto.isEnabled()) {
        // Auto owns the row, so a T restore point means nothing any more —
        // drop it, or the T chip stays lit and the next T would write the
        // stale value and take the row off auto. The manual branch keeps it:
        // open() syncs every row, and a muted manual row must stay muted.
        clearOff();
        display(spec.auto.resolveLive(), true);
      } else display(spec.pin?.get() ?? manualValue(), false);
    },
    /** Called every rAF tick DeviceMenu.update() runs, unconditionally and
     *  unthrottled — a no-op when this row has no `reads`, otherwise pushes
     *  each linked SignalSpec's live read() (0 while frame/anim aren't up
     *  yet) and activeWhen predicate into the strip. Unthrottled to match
     *  the meters' own "fills move every frame" rule (audioMeters.ts) — a
     *  beat-driven pill should feel as live as the meter it points at. */
    updateSignalPills(frame: FeatureFrame | null, anim: AnimFrame | null): void {
      if (!signalIndicator || !spec.reads) return;
      signalIndicator.update(
        spec.reads.map((r) => ({
          value: frame && anim ? r.signal.read(frame, anim) : 0,
          active: r.active(),
        })),
      );
    },
    /** Replaces linkedTicks with fresh values and redraws — the caller
     *  (appendSettingRow) calls this right after propagating its own commit
     *  to every linked setting, so a tick that just became equal disappears
     *  immediately rather than waiting for the next full rebuild. A no-op
     *  when this row was never built with `linkedTicks` in the first place. */
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
  /** A drive-capable toggle's port, summary and sparkline (the same slot
   *  createControlRow has; buildDriveRow makes them), so a trigger toggle can
   *  be wired to any signal like a slider row. */
  drivePanel?: { port: HTMLElement; summary: HTMLElement; below: HTMLElement; onPin: () => void };
}

/** A boolean setting's row: same head as a slider row, a pill toggle where
 *  the slider would be. Never auto-tunable (see autoTune.ts — a display
 *  toggle between two discrete states doesn't fit the continuous glide
 *  model), so no chip and nothing to refresh per frame. Its own on/off state
 *  already *is* an "off state", so the T hotkey just flips it rather than
 *  adding a redundant chip — see wireRowKeys below. */
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
    // As createControlRow's drive head: the port at the row's left edge, the
    // summary under the label, either one pins.
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

  // ---- power column: energy saving mode ----
  // Leftmost — a compact card, not a scrolling stack, so it isn't wired into
  // the digit-block keyboard jump (renumberBlocks/markBlock): its controls
  // are plain chip buttons plus the Resolution slider, all kept outside the
  // Tab ring (ringElements() skips this column), the same as the palette
  // chips they're modeled on.
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
  // The pop-out output's own Power card, under the main one, shown only
  // while an output window is open. Same card, other deps: its status is
  // what the output reports (net/outputSync.ts's OutputRenderStatus).
  const outputPowerCard = createPowerCard(
    {
      getPowerMode: deps.getOutputPowerMode,
      onPowerModeChange: deps.onOutputPowerModeChange,
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

  // ---- spectrum column: the Bands card ----
  // The live spectrum and the band gains are one card: the strip is the
  // control (bandFaders.ts draws the faders over the bars), so what you
  // tune and what you watch are the same pixels — and a standing "is the
  // mic actually hearing anything" check comes free. Always mounted (unlike
  // the Scene card) since it isn't tied to which scene is active; the
  // per-scene fader values are pushed in by refreshBandFaders on open() and
  // after a Reset, the same way the Input rows are synced.
  const bandFaders = createBandFaders({
    onChange: (fader, gain) => deps.onBandGainChange(deps.currentSceneId(), fader, gain),
  });
  const spectrumStrip = bandFaders.strip;
  // The meters beneath the Bands card — see audioMeters.ts.
  const audioMeters = createAudioMeters({
    onLufsReset: deps.onLufsReset,
    getSilenceGate: () => deps.getSilenceGate(),
    hitShape: {
      get: () => deps.getHitShape(),
      set: (partial) => deps.setHitShape(partial),
    },
    // Every function referenced below is a plain (hoisted) function
    // declaration further down this same closure, in the patch-bay
    // section — see each one's own doc comment there. Referencing them
    // here, ahead of their textual declaration, is safe: none of these are
    // ever called until well after createDeviceMenu() has finished running
    // and every one of them exists.
    patch: {
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
    },
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

  // The column head above the Bands card: live dot + audio-source status on
  // the left, this column's one RAW chip on the right. No scene name/
  // "Equaliser" label here any more — the top bar already names the scene.
  // See columnHeadStyle above for its own shape.
  const columnHead = document.createElement("div");
  columnHead.style.cssText = columnHeadStyle;
  const spectrumStatus = document.createElement("div");
  spectrumStatus.style.cssText = spectrumStatusStyle;
  const liveDot = document.createElement("div");
  liveDot.style.cssText = liveDotStyle(false);
  const statusLabel = document.createElement("div");
  statusLabel.style.cssText = statusTextStyle;
  spectrumStatus.append(liveDot, statusLabel);
  // One chip, two raw modes: lit shows the raw mic signal exactly as it
  // comes in — no adaptive envelope (features.ts), no Bands gain (NOT "no
  // sensitivity": Sensitivity/Expansion are applied later, only on the
  // render path — applySensitivity in app.ts, after this strip is already
  // fed — so the processed side shown here never had them either) — and, in
  // the same click, every meter row's own raw mode (audioMeters.ts's
  // AudioMeters.setRaw; see that file's header for which of its rows this
  // changes and why). The two halves differ in what "raw" actually undoes:
  // the spectrum's half always shows something different whenever Auto-gain
  // is on, since the two sides normalize against different windows
  // regardless of Smoothing (features.ts's autoGain doc); the meters' half
  // is a genuine no-op once Smoothing (Input card) is dragged to Off, since
  // every eased reading there already lands on exactly what raw shows.
  const rawChip = createChipButton("RAW", RAW_CHIP_TITLE, () => {
    const on = !spectrumStrip.showRaw();
    spectrumStrip.setShowRaw(on);
    audioMeters.setRaw(on);
    rawChip.style.cssText = on ? chipBtnLitStyle : chipBtnStyle;
  });
  columnHead.append(spectrumStatus, rawChip);

  // The fader bank sits in a .vc-row so it wakes (glow) on hover and on
  // focus-within exactly like a slider row.
  const fadersRow = document.createElement("div");
  // vc-row-keep: the primary spectrum display opts out of .vc-patching's
  // flat dim (controlsTheme.ts) — it gets its own band-range dimming
  // instead (refreshSpectrumDriveHighlight, below).
  fadersRow.className = "vc-row vc-row-keep";
  fadersRow.style.setProperty("--vc-accent", BANDS_AMBER);
  // Always-on: explains the sky-blue marker spectrumStrip.ts's
  // drawCentroidMarker draws over the bars (same AUTO_SKY constant, so the
  // swatch can't drift from the line) — the spectral centroid, same signal
  // as the Character card's Brightness row traces beneath its own bar
  // (audioMeters.ts).
  const spectrumLegend = createTraceLegend([
    { color: AUTO_SKY, label: "Centroid", note: "where the spectrum's energy balances" },
  ]);
  fadersRow.append(bandFaders.el, spectrumLegend.el);
  // R/T on a focused fader, through the same wiring as every row; no A —
  // the faders have no auto weights.
  bandFaders.faders.forEach((el, i) => {
    wireRowKeys(el, {
      reset: () => bandFaders.reset(i),
      toggleOff: () => bandFaders.toggleOff(i),
    });
    wireHoverFocus(el, el);
  });

  // Equaliser readouts + hint — hidden by default (in flow: the card grows
  // while shown, rather than reserving the space at all times), revealed by
  // hover/focus/drag over fadersRow (refreshEqLayer/its wiring below, past
  // lineMode's own declaration) and forced hidden whenever the pinned
  // setting's patch has a source on Frequencies instead (refreshLineMode
  // below) — refreshEqLayer is the one writer of eqLayer.style.display, so
  // the two conditions can't stomp each other the way two direct writers
  // once did.
  const fadersHint = document.createElement("div");
  fadersHint.style.cssText = eqHintStyle;
  fadersHint.textContent = FADER_HINT_TEXT;
  const eqLayer = document.createElement("div");
  eqLayer.append(bandFaders.readouts, fadersHint);
  eqLayer.style.display = "none";

  // ---------------------------------------------------------------------
  // The patch bay: every drive-capable scene-setting row (appendSettingRow
  // below) gets an input port, a source summary and a live sparkline
  // (createControlRow's own `drivePanel` slot — see its doc comment).
  // Clicking a row's label, summary or port pins it and expands its patch
  // panel inline, below the sparkline. See this file's own header
  // doc-comment paragraph for the full contract.
  // ---------------------------------------------------------------------

  /** Previewed on hover/keyboard-focus — port lit only, no layout change.
   *  Written only by previewDrive() below. */
  let preview: { sceneId: string; spec: SceneSetting } | null = null;
  /** Pinned by an explicit click on a row's label/summary/port — expands
   *  that row's patch panel. One at a time; written only by togglePin()
   *  below, Escape (onKeyDown), or a scene switch (renderSceneSettings's
   *  own tail). */
  let pinned: { sceneId: string; spec: SceneSetting } | null = null;
  // Solo's on/off (setSolo/applySolo, by the footer) — declared up here
  // because togglePin and every pinned patch panel's own Solo chip read it.
  let soloOn = false;
  // Whether the wide layout's "+ Add by name" disclosure is open
  // (buildAddChips). Kept here, not per panel, because adding a source
  // rebuilds the patch panel, and a fresh `false` closed the chip list
  // under the pointer after every add. View state for this session only,
  // like Solo.
  let addChipsOpen = false;
  // Whether the panel is open (open/close, below) — declared up here since
  // setSolo's cable-visibility refresh runs during construction.
  let isOpen = false;
  // Set by a mountRows dispose that removed the pinned row; consumed by the
  // very next mountRows (see mountRows).
  let pinHandoff: { family: string; param: string; other?: number } | null = null;
  /** The last setting `previewDrive` was actually handed a non-null value
   *  for — unlike `preview` itself, this never goes back to null when the
   *  pointer leaves. It's what a jack click reaches for when nothing's
   *  pinned (Phase 2b's own plan): "pin whatever I was just looking at,
   *  then plug this in", rather than a bare toast every time. */
  let lastPreview: { sceneId: string; spec: SceneSetting } | null = null;
  /** The Bands card's line-drawing mode — derived from `pinned`'s own patch
   *  by refreshLineMode() below, not from focus: only a pinned setting's
   *  panel can actually add/remove its line source. Kept as its own
   *  variable (like the picker system it replaces) because
   *  DeviceMenu.update()'s per-tick overlay refresh needs to know which
   *  setting's excess() to read without re-deriving it every tick. */
  let lineMode: { sceneId: string; spec: SceneSetting } | null = null;
  /** The pinned setting's own DriveSetting as of the last time its panel
   *  was built — what DeviceMenu.update()'s ~10 Hz refresh compares against
   *  to notice an external change (a paired device's own command) without
   *  rebuilding the panel every tick regardless (this file's own carried
   *  click-loss rule). `null` whenever nothing's pinned. */
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
  // Appended after the fader hit divs already in bandFaders.el, so it sits
  // on top of them in DOM/paint order and captures every pointer event over
  // the strip while visible — no separate suppression of the faders' own
  // pointer handlers needed, only spectrumStrip.setShowFaders for the drawn
  // markers themselves.
  bandFaders.el.appendChild(lineEditor.el);
  // Reused inside the pinned row's own patch panel (buildSourceLine below)
  // for its line source's controls — see this file's header doc comment.
  const clearLineChip = createChipButton("Clear line", "Erase the drawn line — every band is ignored again.", () => {
    if (!lineMode) return;
    deps.resetDriveLine(lineMode.sceneId, lineMode.spec);
    deps.setDriveLineStrength(lineMode.sceneId, lineMode.spec, LINE_STRENGTH_DEFAULT);
    lineEditor.setLine(deps.getDriveLine(lineMode.sceneId, lineMode.spec));
    lineEditor.setStrength(deps.getDriveLineStrength(lineMode.sceneId, lineMode.spec));
  });
  clearLineChip.dataset.hint = clearLineChip.title;
  // Static (this row's own text never changes), so set once here rather
  // than every buildSourceLine() rebuild — the panel's bottom hint line
  // reads it off this same element wherever it's currently appended.
  lineEditor.strengthRow.title = "How hard the drawn line drives the setting when bars rise above it.";
  lineEditor.strengthRow.dataset.hint = lineEditor.strengthRow.title;

  /** Derives lineMode from `pinned`'s own current patch — called after
   *  every pin change and every patch edit (patchChanged below), never per
   *  tick. Swaps the strip's fader markers for the line overlay the same
   *  way the picker this replaces did. */
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

  // ---- eqLayer's own hover/focus/drag reveal — see its own comment above
  // for why refreshEqLayer is the one writer of its display style. Showing
  // is immediate; hiding waits EQ_HIDE_DELAY_MS so a pointer crossing a knob
  // gap, or a quick refocus between faders, doesn't flash it off and back on.
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
      // The drawing overlay needs the space now, so hide at once rather
      // than waiting out the delay below.
      eqLayer.style.display = "none";
    } else {
      eqHideTimer = setTimeout(() => {
        eqHideTimer = null;
        eqLayer.style.display = "none";
      }, EQ_HIDE_DELAY_MS);
    }
  }
  fadersRow.addEventListener("pointerenter", () => {
    eqHovering = true;
    refreshEqLayer();
  });
  fadersRow.addEventListener("pointerleave", () => {
    eqHovering = false;
    refreshEqLayer();
  });
  // Keyboard focus only: wireHoverFocus also focuses a fader on plain
  // pointer movement, and that focus outlives the pointer — counting it
  // would leave the readouts up after the pointer has gone. Its
  // pointerFocusOriginated flag is true exactly during that focus() call.
  fadersRow.addEventListener("focusin", () => {
    eqFocused = !pointerFocusOriginated;
    refreshEqLayer();
  });
  fadersRow.addEventListener("focusout", () => {
    eqFocused = false;
    refreshEqLayer();
  });
  fadersRow.addEventListener("pointerdown", () => {
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

  // ---- The Bands card's own jacks: the spectrum's own Frequencies corner,
  // plus BAND_LEVEL_CHOICES's own three-across Levels row below eqLayer.
  // Built here (rather than through audioMeters.ts's mountJack) since the
  // Bands card lives in this file; onJackClick/onJackHover/jackIsShown/etc.
  // below are plain (hoisted) functions in this same closure, the same ones
  // createAudioMeters's own `patch` deps call through, so every jack in the
  // panel — meters or Bands — answers to identical logic. bandsJackEls is
  // this card's own half of the cable layer's source-endpoint lookup (see
  // combinedJackElements below).
  const bandsJackEls = new Map<string, HTMLElement>();
  function mountBandsJack(choice: DriveSourceChoice, host: HTMLElement, feedEl: HTMLElement): JackHandle {
    const jack = createJack(
      driveSourceColor(choice),
      () => onJackClick(choice),
      (on) => onJackHover(choice, on),
    );
    host.appendChild(jack.el);
    bandsJacks.push({ choice, jack, feedEl });
    bandsJackEls.set(jackKey(choice), jack.el);
    return jack;
  }
  const bandsJacks: { choice: DriveSourceChoice; jack: JackHandle; feedEl: HTMLElement }[] = [];

  const lineJack = mountBandsJack({ source: "line" }, fadersRow, fadersRow);
  lineJack.el.style.cssText += "position: absolute; top: 4px; right: 4px; z-index: 2;";

  const BAND_LEVEL_CHOICES: readonly DriveSourceChoice[] = ["anim.low", "anim.mid", "anim.high"];
  const levelsLabel = document.createElement("div");
  levelsLabel.textContent = "Levels";
  levelsLabel.style.cssText = levelsLabelStyle;
  const levelsGrid = document.createElement("div");
  levelsGrid.style.cssText = levelsGridStyle;
  // "Bass level"/"Mid level"/"Treble level" (driveSourceLabel) minus the
  // " level" every other source-picker context needs to disambiguate from a
  // hit — redundant here, where the Levels caption and the grid shape
  // already say what these three are.
  const bandLevelRows = BAND_LEVEL_CHOICES.map((choice) => {
    const row = createMeterRow({
      label: driveSourceLabel(choice).replace(/ level$/, ""),
      accent: driveSourceColor(choice),
    });
    row.el.style.cssText += levelsCellStyle;
    row.el.querySelector<HTMLElement>(".vc-label")!.style.cssText += levelsCellLabelStyle;
    mountBandsJack(choice, row.right, row.el);
    levelsGrid.appendChild(row.el);
    return { choice, row };
  });
  const levelsRow = document.createElement("div");
  levelsRow.style.cssText = levelsRowStyle;
  levelsRow.append(levelsLabel, levelsGrid);

  bandsCard.body.append(fadersRow, eqLayer, levelsRow);

  // One at a time — set by buildPatchPanel() below whenever the pinned row
  // builds an output graph, cleared by togglePin()/patchChanged() when
  // there's nothing (any more) to feed. DeviceMenu.update() calls through
  // this rather than iterating every row, since only the pinned row ever
  // has a graph.
  let activeOutputTick: ((drives: SceneDrives, slots: number) => void) | null = null;

  // Every drive row appendSettingRow builds below, reset at the top of
  // renderSceneSettings alongside sceneRowHandles — a scene switch/Look
  // apply/undo/card Reset rebuilds the whole Scene card from scratch.
  interface DriveRowHandle {
    sceneId: string;
    spec: SceneSetting;
    /** The row's own input-port ring — a cable's target endpoint
     *  (src/ui/cableLayer.ts). */
    portEl: HTMLElement;
    /** The whole row element — a jack-hover's own highlight target
     *  (onJackHover below). */
    rowEl: HTMLElement;
    refreshMeta(): void;
    refreshPin(): void;
    refreshPreviewLit(): void;
    rebuildIfPinned(): void;
    tickSparkline(drives: SceneDrives, frame: FeatureFrame | null, anim: AnimFrame | null, slots: number): void;
  }
  let driveRowHandles: DriveRowHandle[] = [];

  /** The output graph's corner tag while Expansion moves a reading: the
   *  dial, plus the shape chip's name when it isn't the first (Even). */
  const expansionTagText = (expansion: number, shapeIndex: number): string =>
    `Expansion ${expansion.toFixed(2)}×` + (shapeIndex > 0 ? ` · ${EXPANSION_SHAPE_NAMES[shapeIndex] ?? ""}` : "");

  // Peak-hold between graph samples. The sparklines and the output graph
  // sample at SPARKLINE_REFRESH_MS, but a hit is a one-tick spike that
  // decays right away — a sample landing a tick or two after the hit drew
  // a Fixed hit (every one starts at exactly 1) at 0.8-0.9 and the peaks
  // looked uneven. notePeaks() runs every frame and remembers the highest
  // reading per setting (combined and per source); the 30 Hz tick draws
  // max(now, that), then the update loop clears it.
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

  /** Every Scene-card row that can be pinned — all of them, drive or not,
   *  in document order: what togglePin refreshes, Tab walks (moveTabPin)
   *  and a rebuild re-finds the pin in. A drive row's refreshPin is its
   *  DriveRowHandle's (patch panel and all); any other row's just toggles
   *  the .vc-drive-pinned ring, so Solo, its eye and Tab treat both alike. */
  interface PinRowHandle {
    sceneId: string;
    spec: SceneSetting;
    rowEl: HTMLElement;
    refreshPin(): void;
  }
  let pinRowHandles: PinRowHandle[] = [];
  // Every row's sparkline canvas, so renderSceneSettings can unobserve them
  // (driveCanvasRO below) before discarding the old Scene card's rows —
  // otherwise a scene switch would leave the observer holding a detached
  // canvas per old row for the rest of the session.
  let driveSparkCanvases: HTMLCanvasElement[] = [];

  // Sparkline/output-graph canvases are sized only from ResizeObserver
  // entries, never measured in a draw call (this file's own carried rule:
  // no per-tick layout reads) — the Scene card's rows are built while the
  // panel is still `display:none` (open() calls renderSceneSettings()
  // before adding vc-open below), so a synchronous read at creation time
  // would just read zero anyway.
  interface CanvasSize {
    w: number;
    h: number;
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
  /** The drive graphs' one fixed top — the row sparkline and the "What it
   *  receives" graph alike: one source at the most weight it can have
   *  (DRIVE_WEIGHT_MAX) reading full scale, times the setting's own gain.
   *  It never moves — not with a weight drag, a source plugged in or muted,
   *  or a peak scrolling past — so a taller line always means the setting is
   *  receiving more. A weight-1 source peaks at `gain` (the dotted line);
   *  anything past the top clips. */
  function driveGraphTop(spec: SceneSetting): number {
    return Math.max(1e-3, DRIVE_WEIGHT_MAX * (spec.drive?.gain ?? 1));
  }

  function trackDriveCanvas(canvas: HTMLCanvasElement): CanvasSize {
    const size: CanvasSize = { w: 0, h: 0 };
    driveCanvasSizes.set(canvas, size);
    driveCanvasRO.observe(canvas);
    return size;
  }
  function untrackDriveCanvas(canvas: HTMLCanvasElement | null): void {
    if (!canvas) return;
    driveCanvasRO.unobserve(canvas);
    driveCanvasSizes.delete(canvas);
  }

  /** A `drive.sceneLabel` as the built-in summary shows it: the scene's
   *  own "Scene: " prefix and a leading "this scene's own " dropped, since
   *  "Built-in: " already says both (docs/vocabulary.md). Empty when the
   *  scene names no label. */
  function builtInText(spec: SceneSetting): string {
    return (spec.drive?.sceneLabel ?? "").replace(/^Scene:\s*/, "").replace(/^this scene's own\s+/, "");
  }

  /** A row's own one-line source summary — every muted source is left out
   *  of the plain-language list (this file's header's Muting paragraph) and
   *  folded into one short "· N off" suffix instead, so a summary never
   *  grows a parenthetical per muted source. */
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

  /** `Reset to scene default`'s own hint (buildPatchPanel) — the setting's
   *  own default patch, described in the same words a normal summary uses,
   *  so the hint reads as "this is what you'd get" rather than jargon. */
  function driveDefaultSummary(spec: SceneSetting): string {
    return driveSummaryText(spec, defaultDriveSetting(spec));
  }

  /** The short form driveSummaryText's own "scene" branch would otherwise
   *  spell out ("Built-in: bass level") — just "Built-in", for the "Mixed —
   *  …" line below, where every part has to stay short enough to read as a
   *  list. */
  function driveShortSummary(spec: SceneSetting, setting: DriveSetting): string {
    return setting === "scene" ? "Built-in" : driveSummaryText(spec, setting);
  }

  /** A drive row's own summary text, "Mixed — …" once its linked siblings
   *  (registry.ts's `appendRow` `linked` option) actually disagree with
   *  `setting` — the multi-item-selection bridge's drive-summary half (the
   *  tick marks on a numeric row are createControlRow's own concern; this is
   *  buildDriveRow's). Plain `driveSummaryText` otherwise, identical to a
   *  row with no `linked` at all. */
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

  /** The setting's own first plugged source's colour, or SCENE_VIOLET for
   *  a `"scene"` mix with nothing plugged in — shared by drivePortStyle's
   *  own glow below and refreshMeta's --vc-pin-color (controlsTheme.ts's
   *  .vc-drive-pinned/.vc-drive-preview), so a row's pinned/preview border
   *  always matches what its own port is showing. */
  function driveRowAccent(setting: DriveSetting): string {
    if (setting === "scene" || !setting.sources.length) return SCENE_VIOLET;
    return driveSourceColor(setting.sources[0]!.choice);
  }

  /** `state` is "none" while the row is neither pinned nor being previewed
   *  (hover/focus short of a click): pinned gets a solid, glowing ring —
   *  this *is* the shown patch right now; preview gets a bare outline, no
   *  glow — a passing look, not a commitment (see this file's header doc
   *  comment's row-grammar paragraph for why only a click expands the
   *  patch panel). */
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
   *  setting, or for several that one port wires together — theirs when they
   *  all receive the same, else every wire colour among them on a dashed
   *  ring ("mixed"). */
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

  // ---- Patch-panel sub-builders — each takes the (sceneId, spec) pair and
  // whatever local data it needs, and wires its own controls straight to
  // `deps`; patchChanged() below is the one place a mutation is followed by
  // a rebuild. ----

  /** Sets a control's plain-language hint: `data-hint` (buildPatchPanel's
   *  own bottom hint line reads this off whichever control is hovered/
   *  focused right now — the "cover everything with hints" pass's one
   *  delegated mechanism, never a per-control listener) and
   *  `aria-description` for a screen reader. Deliberately no `title`: the
   *  native tooltip repeated the bottom line's text a second time on top of
   *  the panel. Every element inside the patch panel goes through this, so
   *  the two never drift apart. */
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

  const HEIGHT_OPTIONS: { h: HitHeight; label: string; hint: string }[] = [
    { h: "graded", label: "Graded", hint: "Each hit is as tall as how hard it hit — shaped by Shape on the Hits card." },
    { h: "fixed", label: "Fixed", hint: "Every hit is a full-height pulse, however quiet." },
    { h: "loud", label: "Loud", hint: "Each hit is as tall as its band was loud at that moment." },
  ];

  // Beat wave's own every-N-beats divider (DriveSource.every) — only shown
  // on a plain Beat wave source line (buildSourceLine below); every other
  // source ignores it outright (drives.ts's own doc on that field).
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
      setHint(btn, disabled ? "Plug in a second signal to gate one against the other." : opt.hint);
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

  /** Beat wave's own every-N-beats divider — a visible "Every" label (the
   *  numbers alone don't say what they count, unlike Height's own
   *  self-explanatory Graded/Fixed/Loud) plus a buildHeightSeg-styled row of
   *  chips, one per EVERY_OPTIONS value. Live write + patchChanged, same as
   *  buildHeightSeg. Only ever built for a plain Beat wave source line
   *  (buildSourceLine below). */
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

  /** The Only when role toggle (drives.ts's setSourceRole) — shown on every
   *  source line while the patch is gating. Both halves are independently
   *  clickable now (this file's own header): marking this line "when" never
   *  touches any other line's own role, so several can be conditions at
   *  once. "Only when" disables itself — with `ROLE_REFUSE_HINT` — on the
   *  one line whose marking would leave zero "plays" sources among the
   *  rest, mirroring drives.ts's own refusal there rather than letting a
   *  click visibly do nothing. `index` is this source's own current
   *  position in `patch.sources` (buildSourceLine's own loop index), which
   *  is exactly what setSourceRole wants. */
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
    "An adaptive noise gate: the dotted line follows this setting's resting level, and anything under it counts as nothing. Right: only clear peaks get through. Off: everything gets through.";

  /** Every drive setting's own threshold row — On/Off + a labelled 0..1
   *  slider, right under its graph (or where the graph would be with
   *  nothing plugged in yet). Scene-handled (SceneSetting.drive.threshold
   *  declared — Physarum 2's Dose threshold) uses its own label/hint
   *  and starts on; every other drive setting uses the generic label/hint
   *  and starts off, gated by drives.ts's own engine (that file's header's
   *  threshold paragraph) — driveStore.ts's getDriveThresholdState/
   *  setDriveThreshold/setDriveThresholdOn either way. Same live-write,
   *  no-rebuild rule as buildWeightSlider below; the On/Off buttons share
   *  buildHeightSeg's own mini-segment styling. */
  function buildThresholdRow(sceneId: string, spec: SceneSetting, onLiveEdit: () => void): HTMLElement {
    const declared = spec.drive?.threshold;
    const label = declared?.label ?? "Threshold";
    const hint = declared?.hint ?? GENERIC_THRESHOLD_HINT;

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

    const name = document.createElement("span");
    name.style.cssText = driveDrawHintStyle + " white-space: nowrap;";
    name.textContent = label;
    const rng = document.createElement("input");
    rng.type = "range";
    rng.className = "vc-slider";
    rng.min = "0";
    rng.max = "1";
    rng.step = "0.05";
    rng.setAttribute("aria-label", label);
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

    const state = deps.getDriveThresholdState(sceneId, spec);
    showValue(state.value);
    showOnOff(state.on);

    rng.addEventListener("input", () => {
      const v = Number(rng.value);
      showValue(v);
      deps.onSetDriveThreshold(sceneId, spec, v);
      onLiveEdit();
    });
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

    wrap.append(seg, name, rng, out);
    return wrap;
  }

  function buildWeightSlider(sceneId: string, spec: SceneSetting, src: DriveSource, onLiveEdit: () => void): HTMLElement {
    const wrap = document.createElement("label");
    wrap.style.cssText = driveWeightWrapStyle;
    setHint(wrap, WEIGHT_HINT);
    const rng = document.createElement("input");
    rng.type = "range";
    rng.setAttribute("aria-description", WEIGHT_HINT);
    // The same track/thumb/fill CSS every other slider in the panel uses
    // (controlsTheme.ts's .vc-slider rules, reading --vc-accent/--vc-fill)
    // — without this class an <input type="range"> renders as the bare
    // native control, and this one also joins the panel's own Tab ring
    // (ringElements() below) for free, same as a setting row's own slider.
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
    // Live store write + readout on every drag frame, no rebuild — a full
    // buildPatchPanel() here would tear out the very slider being dragged
    // (this file's own carried click-loss rule). The snapshot moves with the
    // write for the same reason: sameDriveSetting compares weights, so a
    // stale lastPinnedSetting reads this drag as an external change and
    // update()'s ~10 Hz check rebuilds the panel mid-drag anyway.
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

  /** The source line's own on/off switch (drives.ts's setSourceMuted) —
   *  lives in its own gutter column (driveSrcLineStyle) on every line, so
   *  it never shifts alignment depending on whether a line happens to have
   *  one. Styled like the panel's own boolean toggle (`.vc-toggle`,
   *  controlsTheme.ts) at a compact size of its own (`.vc-mute-switch`)
   *  rather than reusing that class outright — `.vc-toggle` is also this
   *  file's own Tab-ring selector (ringElements()), and a mute switch inside
   *  a pinned setting's own patch panel isn't meant to join that ring. */
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

    // The condition marker lives in its own gutter column, not a
    // border+padding on the whole line — every line's dots/names/controls
    // align regardless of role (this file's own header).
    const gutter = document.createElement("span");
    gutter.style.cssText = driveSrcGutterStyle;
    gutter.classList.toggle("vc-drive-gutter-cond", isCondition);

    const muteBtn = buildMuteSwitch(sceneId, spec, i, src);

    const dot = document.createElement("span");
    dot.style.cssText = driveSrcDotStyle(driveSourceColor(src.choice));
    const name = document.createElement("div");
    name.style.cssText = driveSrcNameStyle;
    name.textContent = driveSourceLabel(src.choice);
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
    // Fixed/Loud height only mean anything for a hit-kind source — an
    // edge-kind catalogue entry or a beat grid (drives.ts's own header).
    const isHitKind = isGridSourceChoice(src.choice) || (typeof src.choice === "string" && SIGNALS[src.choice].kind === "edge");
    if (isHitKind) ctrls.appendChild(buildHeightSeg(sceneId, spec, src));
    // Every-N-beats only ever means anything for a plain Beat wave source
    // (DriveSource.every's own doc) — never a grid/line/hit-kind source, all
    // handled by other branches here.
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
      ctrls.appendChild(buildWeightSlider(sceneId, spec, src, onLiveEdit));
    }

    line.append(gutter, muteBtn, dot, name, removeBtn, ctrls);
    return line;
  }

  function buildAddChips(sceneId: string, spec: SceneSetting, patch: DrivePatch): HTMLElement {
    const wrap = document.createElement("div");
    // Always open in the stacked layout (jacks — the primary way in once
    // Phase 2b lands — are far away there); behind a small disclosure in
    // the wide layout. A one-time check, not a resize listener: this panel
    // is rebuilt on every patch edit anyway (this file's own carried rule
    // against per-tick layout work), and a live breakpoint crossing
    // mid-edit is a vanishingly rare case to chase.
    const stacked = window.matchMedia(`(max-width: ${STACK_BELOW_PX}px)`).matches;
    let groupsHost = wrap;
    if (!stacked) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.style.cssText = driveAddDisclosureStyle;
      toggle.textContent = "+ Add by name";
      groupsHost = document.createElement("div");
      // A plain style toggle, not the `hidden` attribute: `driveAddGroupsStyle`
      // already sets an inline `display`, which would otherwise outrank the
      // UA stylesheet's `[hidden] { display: none }` rule and leave this
      // visible regardless of the attribute.
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
    for (const group of DRIVE_ADD_GROUPS) {
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
        // The Tempo chip is generic ("Beat grid", not "Beat grid · Beat") —
        // it adds a rhythmic pulse source; which division plays is the
        // source line's own division chips (buildGridChips), not this one.
        const chipLabel = isTempo ? "Beat grid" : driveSourceLabel(choice);
        btn.textContent = chipLabel;
        btn.setAttribute("aria-pressed", String(pressed));
        btn.style.cssText = pressed ? driveChipLitStyle(driveSourceColor(choice)) : driveChipStyle;
        // The line chip keeps its own longer draw-it-yourself instructions
        // (LINE_HINT_TEXT) — every other chip gets "Plug <Source> in" plus
        // driveSources.ts's own one-line description of what it is.
        setHint(btn, isLineSourceChoice(choice) ? LINE_HINT_TEXT : `Plug ${chipLabel} in — ${driveSourceDescription(choice)}`);
        btn.addEventListener("click", () => {
          // The Tempo chip toggles whichever grid source is already
          // present, not just this exact division — see driveSources.ts's
          // own comment on DRIVE_ADD_GROUPS.
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
      "The last 4 seconds, on a scale that never changes: the top is one wire at full weight, the dotted line across the middle one wire at weight 1. White: what this setting receives. Thin coloured lines: each wire (dashed: a condition). Violet: what the Master card's Expansion moved — solid where it pushed this setting up, hatched where it pulled it down; none at 1× with Even. Dark: the gate was closed. Other dotted lines and cyan dots, when shown: see the key under the graph.",
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
    // Key for a scene's own marks (settingMarks.ts), shown only once the
    // scene has published some: the first line's label for the dotted trace,
    // and the cyan dot for a reaction.
    const key = document.createElement("div");
    key.style.cssText = "display:none;gap:12px;margin-top:4px;font-size:11px;color:rgba(255,255,255,0.6);";
    const keyReaction = document.createElement("span");
    keyReaction.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:rgba(110,235,225,0.95);margin-right:5px;vertical-align:0"></span>ring sent';
    const keyLine = document.createElement("span");
    const keyLineSwatch = '<span style="display:inline-block;width:14px;border-top:1px dotted rgba(255,255,255,0.7);margin-right:5px;vertical-align:3px"></span>';
    key.append(keyReaction, keyLine);
    wrap.append(head, canvas, key);
    const ctx = canvas.getContext("2d")!;
    const size = trackDriveCanvas(canvas);

    const RING = 120; // 4 s at 30 Hz
    const combined = new Float32Array(RING);
    const perSource = patch.sources.map(() => new Float32Array(RING));
    // Every marked condition (there can be more than one now — this file's
    // own header) draws its trace dashed; `gateOpen` below tracks the same
    // AND-of-smoothsteps combine()/fired() gate on (drives.ts's
    // GATE_OPEN_LOW/HIGH, reused rather than re-typed), reduced to a bit per
    // tick for the shading.
    const isGate = patch.mix === "gate";
    const conditionIdxs = isGate ? gateConditionIndices(patch) : [];
    const gateOpen = new Uint8Array(RING);
    // A scene's own reference lines and reactions for this setting
    // (settingMarks.ts) — e.g. Beat ripple's salience bar and each ring sent.
    // Lines are recorded per tick (a scene's line can move — Beat ripple's
    // rides the signal) and drawn as traces, labelled at their latest point.
    const reactions = new Float32Array(RING);
    // The Master Expansion's own gap (drives.ts expansionPair): the reading
    // before and after it, NaN on a tick it passed the reading through.
    const expBefore = new Float32Array(RING).fill(NaN);
    const expAfter = new Float32Array(RING).fill(NaN);
    let expansionTag = "";
    const markTraces = new Map<string, Float32Array>();
    let ringHead = 0;
    let filled = 0;

    // The panel's own polish pass: darken the BLOCKED time clearly (not a
    // faint wash over the open time — that read too subtly on the synthetic
    // feed) plus a thin lit-when-open strip along the graph's own bottom
    // edge, in a neutral white rather than picking one condition's colour
    // when several are marked.
    const BLOCKED_FILL = "rgba(0,0,0,0.4)";
    const STRIP_OPEN = "rgba(255,255,255,0.9)";
    const STRIP_BLOCKED = "rgba(255,255,255,0.16)";
    const STRIP_H = 3;
    const MARK_LINE = "rgba(255,255,255,0.55)";
    const MARK_REACTION = "rgba(110,235,225,0.9)";
    // Expansion's gap in the Master card's own colour (its dial and leash
    // gauge): a solid fill where it pushed the reading up, a hatch where it
    // pulled it down.
    const EXP_UP = withAlpha(SCENE_VIOLET, 0.45);
    const EXP_DOWN = withAlpha(SCENE_VIOLET, 0.14);
    const EXP_HATCH = withAlpha(SCENE_VIOLET, 0.6);
    // The generic engine gate's own line has no scene of its own to name it
    // (unlike Beat ripple's "reach to ring") — one fixed label, used as both
    // this trace's key in `markTraces` and the text the key row shows for it.
    const GENERIC_GATE_LINE_LABEL = "below this counts as nothing";

    function draw(): void {
      const { w, h } = size;
      if (w <= 1 || h <= 1) return;
      ctx.clearRect(0, 0, w, h);
      const n = Math.min(filled, RING);
      if (n < 2) return;
      const xs = (k: number) => (k / (RING - 1)) * w;
      const at = (k: number) => (ringHead - RING + k + 1 + RING * 2) % RING;
      // driveGraphTop: fixed, so the trace never rescales. A scene's own
      // mark line that rides above the signal clips at the top.
      // `sourceValues()` and the generic gate's line are un-gained
      // (weight·value — drives.ts's header), the combined value and this top
      // are gained: every trace is scaled by `gain` below so they share one
      // axis (a 0.15-gain setting drew its source traces 7× off the top).
      const gain = spec.drive?.gain ?? 1;
      const top = driveGraphTop(spec);
      const ys = (v: number) => h - 3 - Math.max(0, Math.min(1, v / top)) * (h - 6);

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
        if (patch.sources[i]!.off) continue; // muted — no trace at all
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
      // Where one weight-1 source peaks (gain), and the top's own number.
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

      // Expansion's gap, under the white line: one column per tick.
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

      // A reaction that spans several ticks (a slow climb) is one dot, at the
      // tick it started, sized by its total — drawn on the white line so it
      // sits on the bump that caused it.
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

    /** `slots` is how many SPARKLINE_REFRESH_MS columns this call covers
     *  (more than 1 after a slow frame — see the update loop), so the graph's
     *  x axis stays real time: the held peak lands in the first, the live
     *  reading fills the rest, and the scene's own marks (taken once) land
     *  with the peak. */
    function tick(drives: SceneDrives, slots: number): void {
      const src = drives.sourceValues(spec.key);
      const now = drives.valueOf(spec.key);
      const v = heldValue(spec.key, now);
      const pairNow = drives.expansionPair(spec.key);
      const pairHeld = pairNow && heldExpansion(spec.key, pairNow);
      expansionTag = pairNow ? expansionTagText(deps.getSceneExpansion(), deps.getSceneExpansionShape()) : "";
      const marks = takeSettingMarks(sceneId, spec.key, "graph");
      // The generic engine gate's own line (drives.ts's header's threshold
      // paragraph) — undefined for a scene-handled setting (it draws its own
      // line above instead, through settingMarks.ts) or while the gate is
      // off. Drawn the same dotted way as a scene's own mark lines, under
      // one fixed label so it gets its own key entry.
      const gateLine = drives.gateLine(spec.key);
      for (const line of marks?.lines ?? []) {
        if (!markTraces.has(line.label)) markTraces.set(line.label, new Float32Array(RING).fill(NaN));
      }
      if (gateLine !== undefined && !markTraces.has(GENERIC_GATE_LINE_LABEL)) {
        markTraces.set(GENERIC_GATE_LINE_LABEL, new Float32Array(RING).fill(NaN));
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
        reactions[ringHead] = first ? (marks?.reaction ?? 0) : 0;
        if (isGate) gateOpen[ringHead] = open > 0.5 ? 1 : 0;
      }
      if (key.style.display === "none" && (marks || gateLine !== undefined)) {
        key.style.display = "flex";
        keyReaction.style.display = marks ? "" : "none"; // no reaction concept for the generic gate alone
        const lineLabel = marks ? marks.lines[0]?.label : GENERIC_GATE_LINE_LABEL;
        keyLine.innerHTML = lineLabel ? `${keyLineSwatch}${lineLabel}` : "";
      }
      filled = Math.min(RING, filled + slots);
      val.textContent = v.toFixed(2);
      draw();
    }

    return { el: wrap, canvas, tick };
  }

  /** Rebuilds the pinned row's whole patch panel — called only on a genuine
   *  patch edit (patchChanged) or a fresh pin (DriveRowHandle.refreshPin),
   *  never from the panel's periodic refresh or a slider's own `input`
   *  event (this file's own carried click-loss rule). */
  function buildPatchPanel(
    sceneId: string,
    spec: SceneSetting,
  ): { el: HTMLElement; outputCanvas: HTMLCanvasElement | null; tick: ((drives: SceneDrives, slots: number) => void) | null } {
    const setting = deps.getDriveSetting(sceneId, spec);
    const patch: DrivePatch = setting === "scene" ? { mix: "add", sources: [] } : setting;

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
      // A moved threshold counts too — on/off or value, scene-handled or
      // generic (this row's own default is "on" for the former, "off" for
      // the latter, mirroring driveStore.ts's getDriveThresholdState).
      const declared = spec.drive?.threshold;
      const thresholdState = spec.drive ? deps.getDriveThresholdState(sceneId, spec) : undefined;
      const thresholdMoved =
        !!thresholdState &&
        (thresholdState.on !== (declared !== undefined) || thresholdState.value !== (declared?.default ?? GENERIC_THRESHOLD_DEFAULT));
      resetBtn.hidden = !thresholdMoved && sameDriveSetting(deps.getDriveSetting(sceneId, spec), defaultDriveSetting(spec));
    }

    const head = document.createElement("div");
    head.style.cssText = drivePatchHeadStyle;
    const eyebrow = document.createElement("span");
    eyebrow.style.cssText = driveEyebrowStyle;
    eyebrow.textContent = "Wires";
    head.append(eyebrow, buildMixSeg(sceneId, spec, patch));
    panel.appendChild(head);

    const list = document.createElement("div");
    list.style.cssText = driveSrcListStyle;
    if (setting === "scene") {
      // The built-in reaction has no wire line of its own, so it gets its
      // own Unplug — without it the built-in could never be disconnected.
      const empty = document.createElement("div");
      empty.style.cssText = driveEmptySrcStyle;
      const builtIn = builtInText(spec);
      empty.textContent = builtIn
        ? `Built-in: ${builtIn}. Plug in a signal to replace it.`
        : "Built-in reaction. Plug in a signal to replace it.";
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
      // An empty patch stays empty (normalizeDriveSetting): nothing plugged
      // in, so the setting holds still.
      const empty = document.createElement("div");
      empty.style.cssText = driveEmptySrcStyle;
      empty.textContent = "Nothing plugged in, so this doesn't react to the music. Plug in a signal, or reset to the scene default.";
      list.appendChild(empty);
    }
    patch.sources.forEach((src, i) => {
      list.appendChild(buildSourceLine(sceneId, spec, patch, src, i, refreshResetVisibility));
    });
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
    panel.appendChild(buildThresholdRow(sceneId, spec, refreshResetVisibility));

    panel.appendChild(resetBtn);
    refreshResetVisibility();

    // The panel's own bottom hint line (the "cover everything with hints"
    // pass): a fixed-height readout of whichever control inside this panel
    // is hovered or keyboard-focused right now, so nothing else in the
    // panel has to grow/shrink to show its own description. One delegated
    // pointerover/pointerout/focusin/focusout pair, reading each control's
    // own `data-hint` (set by setHint above) — never a per-control
    // listener, never touched by refreshAuto/update(). In the stacked
    // layout jacks are far away, so the rest state points at the add-by-
    // name chips instead of a signal's jack.
    const stacked = window.matchMedia(`(max-width: ${STACK_BELOW_PX}px)`).matches;
    const restHint = stacked ? "Add a signal by name below." : "Click a signal's jack to plug it in or out.";
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

  /** Builds one drive-capable setting's port/summary/sparkline trio —
   *  appendSettingRow passes `port`/`summary`/`below` into
   *  createControlRow's own `drivePanel` slot, then calls `bind(row.el)`
   *  once the row exists (this needs the finished element for the pinned
   *  row's own highlight; the row needs `port`/`summary` before it exists —
   *  see appendSettingRow below for the two-step order this implies). */
  function buildDriveRow(
    sceneId: string,
    spec: SceneSetting,
  ): { port: HTMLElement; summary: HTMLElement; below: HTMLElement; bind: (rowEl: HTMLElement) => DriveRowHandle } {
    const port = document.createElement("button");
    port.type = "button";
    port.className = "vc-drive-port";
    // The row port's own instant tooltip (outside the pinned panel, so it
    // gets the floating tooltip rather than the panel's bottom hint line —
    // this file's header's "cover everything with hints" pass). Reads
    // port.title live at hover/focus time (refreshMeta below keeps it
    // current), so this never needs its own state.
    port.addEventListener("pointerenter", () => showTooltip(port, driveRowAccent(deps.getDriveSetting(sceneId, spec)), [port.title]));
    port.addEventListener("pointerleave", hideTooltip);
    port.addEventListener("focus", () => showTooltip(port, driveRowAccent(deps.getDriveSetting(sceneId, spec)), [port.title]));
    port.addEventListener("blur", hideTooltip);
    const summary = document.createElement("span");
    summary.style.cssText = driveSummaryStyle;

    const below = document.createElement("div");
    const sparkWrap = document.createElement("div");
    sparkWrap.style.cssText = driveSparkWrapStyle;
    const sparkCanvas = document.createElement("canvas");
    sparkCanvas.className = "vc-drive-spark";
    sparkCanvas.style.cssText = driveSparkCanvasStyle;
    const SPARK_TOOLTIP = "Live: what this setting is receiving (last 3 s). Colour shows which wire is contributing most.";
    sparkCanvas.title = SPARK_TOOLTIP;
    sparkCanvas.addEventListener("pointerenter", () =>
      showTooltip(sparkCanvas, driveRowAccent(deps.getDriveSetting(sceneId, spec)), [SPARK_TOOLTIP]),
    );
    sparkCanvas.addEventListener("pointerleave", hideTooltip);
    sparkWrap.appendChild(sparkCanvas);
    const sparkCtx = sparkCanvas.getContext("2d")!;
    const sparkSize = trackDriveCanvas(sparkCanvas);
    driveSparkCanvases.push(sparkCanvas);
    const patchContainer = document.createElement("div");
    patchContainer.className = "vc-drive-patch";
    patchContainer.style.display = "none";
    below.append(sparkWrap, patchContainer);

    const SPARK_LEN = 90; // ~3 s at 30 Hz
    const sparkVals = new Float32Array(SPARK_LEN);
    const sparkCols: string[] = new Array(SPARK_LEN).fill(DRIVE_WHITE);
    // The scene's own reactions for this setting (settingMarks.ts — Beat
    // ripple's rings), read under this view's own "row" slot. While the
    // scene reports any, the sparkline shows what the setting *did* (a dot
    // per reaction) over a dimmed trace of what it received.
    const sparkReact = new Float32Array(SPARK_LEN);
    let sparkHasMarks = false;
    let sparkHead = 0;
    let sparkFilled = 0;
    // The same fixed top as the panel's "What it receives" graph
    // (driveGraphTop), so the two read on one scale. A Scene row's
    // approximation is an un-gained catalogue signal, so its top drops the
    // gain to put full scale at the same height.
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
      // --vc-pin-color: read by controlsTheme.ts's .vc-drive-pinned/
      // .vc-drive-preview for this row's own border/tint — always kept
      // current even at state "none" so it's already right the instant
      // either class lands.
      boundRowEl?.style.setProperty("--vc-pin-color", driveRowAccent(setting));
    }

    /** Always resyncs .vc-drive-preview from the current global `preview`
     *  first (so a stale preview class left over from a different row/
     *  click gets cleared here too — see togglePin's own call), then only
     *  bails out of a full refreshMeta() if this row is pinned, which
     *  always wins visually over a preview elsewhere. */
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
      const { w, h } = sparkSize;
      if (w <= 1 || h <= 1) return;
      sparkCtx.clearRect(0, 0, w, h);
      const n = Math.min(sparkFilled, SPARK_LEN);
      if (n < 2) return;
      const at = (k: number) => (sparkHead - SPARK_LEN + k + 1 + SPARK_LEN * 2) % SPARK_LEN;
      const xs = (k: number) => (k / (SPARK_LEN - 1)) * w;
      const top = sparkTop;
      const pad = sparkHasMarks ? 3 : 1;
      const ys = (v: number) => h - pad - Math.max(0, Math.min(1, v / top)) * (h - 2 * pad);
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
          // Start the new colour from the previous point, so a change of
          // loudest source doesn't leave a gap in the line.
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

    /** `slots`: same as the output graph's own tick — the held peak in the
     *  first column, the live reading in the rest. */
    function tickSparkline(drives: SceneDrives, frame: FeatureFrame | null, anim: AnimFrame | null, slots: number): void {
      const setting = deps.getDriveSetting(sceneId, spec);
      let now: number;
      let v: number;
      let col: string;
      if (setting === "scene") {
        // drives.valueOf() is defined to return 0 for "scene" (there's no
        // patch to sum) — without this branch every scene-mix row's own
        // sparkline drew flat. Its composite isn't the engine's to read, so
        // this approximates it from the loudest of the catalogue signals it
        // honestly listens to (drive.sceneSources — display-only, see
        // drives.ts's header), at a dimmed alpha that visibly marks it as
        // an approximation rather than the setting's own real output.
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
          // No sceneSources to approximate from — a faint flat baseline
          // rather than a literal 0 (invisible at the track's very bottom).
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
        return { sceneId, spec, portEl: port, rowEl, refreshMeta, refreshPin, refreshPreviewLit, rebuildIfPinned, tickSparkline };
      },
    };
  }

  /** The multi-item-selection bridge's drive/patch choke point (registry.ts's
   *  `appendRow` `linked` option) — copies `spec`'s own just-written
   *  DriveSetting onto every linked setting verbatim (`deps.onSetDriveSetting`
   *  — DeviceMenuDeps's own doc comment on why a straight copy, "scene"
   *  included, is always correct here). A no-op when `spec.key` has no
   *  `linked` entries (every ordinary row). Called from `patchChanged` below
   *  and, separately, from buildWeightSlider's own live `input` (which never
   *  calls patchChanged — see that comment) since a weight drag is still a
   *  patch mutation this bridge has to fan out, even though it doesn't
   *  otherwise rebuild anything. */
  function syncLinkedDriveSetting(sceneId: string, spec: SceneSetting): void {
    const entry = linkedByKey.get(spec.key);
    if (!entry?.linked.length) return;
    const setting = deps.getDriveSetting(sceneId, spec);
    for (const l of entry.linked) deps.onSetDriveSetting(sceneId, l.spec, setting);
  }

  /** The only place a patch mutation is followed by a rebuild — every
   *  control inside buildPatchPanel() calls through here after writing to
   *  `deps`, except a weight slider's own `input` (buildWeightSlider's
   *  onLiveEdit only refreshes the reset link, never rebuilds — this file's
   *  own carried click-loss rule; it calls syncLinkedDriveSetting itself
   *  instead of going through here). */
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
    if (sameDriveSetting(setting, defaultDriveSetting(spec))) deps.onResetDriveSetting(sceneId, spec);
    else deps.onSetDriveSetting(sceneId, spec, setting);
    const h = driveRowHandles.find((r) => r.sceneId === sceneId && r.spec.key === spec.key);
    h?.refreshMeta();
    h?.rebuildIfPinned();
    refreshLineMode();
    refreshPatchHighlight();
  }

  /** Pins/unpins — the only place `pinned` is written (besides Escape in
   *  onKeyDown and the scene-mismatch check in renderSceneSettings's own
   *  tail). Clears any pending preview so a click doesn't leave a stale
   *  dwell timer racing it. */
  function togglePin(sceneId: string, spec: SceneSetting): void {
    cancelPendingPreview();
    const next = { sceneId, spec };
    pinned = samePair(pinned, next) ? null : next;
    preview = null;
    activeOutputTick = null;
    if (!pinned) lastPinnedSetting = null;
    for (const h of pinRowHandles) h.refreshPin();
    // preview just went to null above — resyncs every row's own
    // .vc-drive-preview against that, since refreshPin() (above) never
    // touches it and a row other than the one just clicked could otherwise
    // be left showing a stale preview tint.
    for (const h of driveRowHandles) h.refreshPreviewLit();
    refreshLineMode();
    refreshPatchHighlight();
    // Solo follows the pin: onto the newly pinned row, or back to the
    // Scene card once nothing is pinned — and its eye follows the row.
    if (soloOn) applySolo();
    scheduleCableRecompute();
  }

  /** Pins without ever unpinning — a press on a card (isCardPress). */
  function pinSetting(sceneId: string, spec: SceneSetting): void {
    if (!samePair(pinned, { sceneId, spec })) togglePin(sceneId, spec);
  }

  /** Registers `rowEl` into `pinRowHandles` outside the drive system's own
   *  `DriveRowHandle` path — `appendSettingRow`'s own `registerPinRow` calls
   *  this for its non-drive branch (a toggle/enum/plain-slider row), and
   *  `WidgetCtx.registerCard` (registry.ts's own doc comment has the full
   *  contract, including why `spec` is often a synthetic identity rather
   *  than a real setting) is the exact same call for a widget's own custom
   *  row. `main`, when given, is the row's own value control: a click
   *  anywhere on `rowEl` that isn't some OTHER in-row control (isCardPress)
   *  pins — passing `rowEl` itself as `main` (every WidgetCtx.registerCard
   *  caller does) makes every press anywhere in the row count, pads/faders/
   *  buttons included, matching this file's header's "press anywhere on the
   *  card pins it" rule for an ordinary row. */
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

  /** The only place `preview` is written. See previewDrive's own callers
   *  (appendSettingRow's onRowFocusIn) for the hover-dwell contract this
   *  mirrors from the row-selection system it replaces. */
  function previewDrive(next: { sceneId: string; spec: SceneSetting } | null): void {
    cancelPendingPreview();
    if (samePair(preview, next)) return;
    preview = next;
    if (next) lastPreview = next;
    for (const h of driveRowHandles) h.refreshPreviewLit();
    refreshPatchHighlight();
  }

  // ---------------------------------------------------------------------
  // Jacks (src/ui/jack.ts) and cables (src/ui/cableLayer.ts) — Phase 2b of
  // this file's own plan. Every predicate below answers "does `choice` feed
  // the shown (preview ?? pinned) setting" purely from `pinned`/`preview`
  // and `deps.getDriveSetting`, so createAudioMeters's own jacks and this
  // card's own (mountBandsJack, above) both call through the exact same
  // logic — one contract, two mount points. driveSources.ts's jackKey is
  // the identity every comparison below uses: it collapses every beat-grid
  // division to one shared key, since a patch carries at most one and the
  // Timing strip's Grid jack always means "whichever one's there", never a
  // specific division.
  // ---------------------------------------------------------------------

  function shownSelection(): { sceneId: string; spec: SceneSetting } | null {
    return preview ?? pinned;
  }

  /** `preview`, but only when it's a genuinely *different* setting from
   *  whatever's pinned — hovering the pinned row itself (or nothing) isn't
   *  a competing preview to draw a second cable group for or fade the
   *  pinned one over (see cableSpecsForShown/refreshBandsJacks below, and
   *  cableLayer.ts's own two-group recompute). */
  function activePreview(): { sceneId: string; spec: SceneSetting } | null {
    return preview && !samePair(preview, pinned) ? preview : null;
  }

  /** How many of the *active scene's* settings currently use `choice` —
   *  each jack's own usage dots, independent of selection. */
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

  function jackIsShown(choice: DriveSourceChoice): boolean {
    const sel = shownSelection();
    if (!sel) return false;
    const setting = deps.getDriveSetting(sel.sceneId, sel.spec);
    return setting !== "scene" && setting.sources.some((s) => jackKey(s.choice) === jackKey(choice));
  }

  function jackIsPinned(choice: DriveSourceChoice): boolean {
    if (!pinned) return false;
    const setting = deps.getDriveSetting(pinned.sceneId, pinned.spec);
    return setting !== "scene" && setting.sources.some((s) => jackKey(s.choice) === jackKey(choice));
  }

  /** `choice` is a source of the *active preview* specifically (see
   *  activePreview() above) — a row/lane's soft glow, always taking
   *  priority over a competing pinned feed on the same row. */
  function jackFeedsPreview(choice: DriveSourceChoice): boolean {
    const ap = activePreview();
    if (!ap) return false;
    const setting = deps.getDriveSetting(ap.sceneId, ap.spec);
    return setting !== "scene" && setting.sources.some((s) => jackKey(s.choice) === jackKey(choice));
  }

  /** The matching `DriveSource` for `choice` in `setting`, or undefined —
   *  jackIsPinnedActive/jackFeedsPreviewActive below share this rather than
   *  each re-deriving "which source is this jack" a second way. */
  function sourceForChoice(setting: DriveSetting, choice: DriveSourceChoice): DriveSource | undefined {
    if (setting === "scene") return undefined;
    const key = jackKey(choice);
    return setting.sources.find((s) => jackKey(s.choice) === key);
  }

  /** `jackIsPinned`, but false for a *muted* source — the mute-aware pair
   *  (with jackFeedsPreviewActive below) refreshBandsJacks/audioMeters.ts's
   *  refreshPatchView use specifically for a row/lane's own fed glow, so a
   *  muted source's jack still fills solid (jackIsPinned/jackIsShown stay
   *  mute-agnostic — it's still plugged in) while its row stops lighting up
   *  (this file's own header's Muting paragraph). */
  function jackIsPinnedActive(choice: DriveSourceChoice): boolean {
    if (!pinned) return false;
    const src = sourceForChoice(deps.getDriveSetting(pinned.sceneId, pinned.spec), choice);
    return !!src && !src.off;
  }

  /** `jackFeedsPreview`, but false for a *muted* source — see
   *  jackIsPinnedActive above. */
  function jackFeedsPreviewActive(choice: DriveSourceChoice): boolean {
    const ap = activePreview();
    if (!ap) return false;
    const src = sourceForChoice(deps.getDriveSetting(ap.sceneId, ap.spec), choice);
    return !!src && !src.off;
  }

  /** `choice` is named in the shown setting's own display-only
   *  `drive.sceneSources` (drives.ts's header) — never a real patch source,
   *  so never a jack fill, only a row/lane's softer glow. */
  function jackIsSceneSource(choice: DriveSourceChoice): boolean {
    if (typeof choice !== "string") return false;
    const sel = shownSelection();
    if (!sel) return false;
    const setting = deps.getDriveSetting(sel.sceneId, sel.spec);
    if (setting !== "scene") return false;
    return (sel.spec.drive?.sceneSources ?? []).includes(choice);
  }

  /** Something (preview ?? pinned) is currently shown at all — the Bands
   *  card's own `.vc-patching` dim-everything-unfed switch. */
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
    const target = jackTarget();
    if (!target) return { aria: `${name} — pick a setting first`, title: name };
    const already = jackFeeds(target, choice);
    const verb = already ? "Unplug" : "Plug";
    const prep = already ? "from" : "into";
    return { aria: `${verb} ${name} ${prep} ${target.spec.label}`, title: name };
  }

  /** The jack's own instant tooltip lines (onJackHover below) — line 1
   *  names the source and what it is (driveSources.ts's own description),
   *  line 2 says what a click on it would do right now: nothing pinned or
   *  previewed yet, unplug what's already there, or plug in. */
  function jackTooltipLines(choice: DriveSourceChoice): string[] {
    const line1 = `${driveSourceLabel(choice)} — ${driveSourceDescription(choice)}`;
    const target = jackTarget();
    if (!target) return [line1, "Pin a setting first"];
    const line2 = jackFeeds(target, choice) ? `Click to unplug from ${target.spec.label}` : `Click to plug into ${target.spec.label}`;
    return [line1, line2];
  }

  // The most recent jack toggled ON, for one recompute — buildCables below
  // consumes it to draw that one cable on rather than snapping in instantly
  // (controlsTheme.ts's vc-cable-new rule), then clears it. Set right
  // before the store write that adds it, since add-vs-remove has to be
  // known ahead of the toggle.
  let justAddedKey: string | null = null;

  function onJackClick(choice: DriveSourceChoice): void {
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

  /** Hovering a jack highlights every scene row it feeds right now —
   *  independent of the preview/pin highlight above (this fires for *any*
   *  jack, fed or not, pinned setting or none) — and shows/hides its own
   *  instant tooltip (jackTooltipLines above), the jack half of the
   *  "cover everything with hints" pass. Called from every jack's own
   *  pointerenter/pointerleave/focus/blur (jack.ts's createJack), never a
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

  /** The Bands card's own 4 jacks (mountBandsJack, above) — the same
   *  fill/pressed/uses/aria refresh audioMeters.ts's own refreshPatchView
   *  does for its jacks, plus the same row-level fed/dim (jack.ts's
   *  setRowFed) for the 3 level rows and the faders row itself. Priority
   *  for a shared row's own glow: the active preview always wins (soft)
   *  over a competing pinned feed (full when uncontested, faint when
   *  a different preview is live), which in turn wins over the softer
   *  scene-mix fallback (jackIsSceneSource — a `"scene"` setting has no
   *  patch sources of its own, so it can never win the pinned/preview
   *  checks above; see jack.ts's setRowFed for what each kind draws). */
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
      // The mute-aware pair — a muted source keeps its jack filled (above)
      // but stops lighting the row it feeds (this file's own header).
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

  /** The spectrum strip's own dim-the-unheard-bands overlay for the shown
   *  setting — real patch sources for an editable patch, `sceneSources` for
   *  a `"scene"` one (both narrowed to a plain SignalId; a grid/line source
   *  has no band range of its own). Recomputed alongside every other
   *  selection-driven refresh here, never per frame or per hover — a drive
   *  row has no `reads` of its own for wireBandHighlight to key off. */
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
  // Also drives the Bands card's own level rows, bandLevelRows (setValue's
  // dtSec is only ever a peak-hold decay rate, so a rough per-tick delta is
  // plenty).
  let lastCableTickMs = performance.now();
  const narrowMQ = window.matchMedia(`(max-width: ${STACK_BELOW_PX}px)`);

  function combinedJackElements(): ReadonlyMap<string, HTMLElement> {
    const merged = new Map(audioMeters.jackElements());
    for (const [k, v] of bandsJackEls) merged.set(k, v);
    return merged;
  }

  // The latest tick's own SceneDrives/frame/anim — cableSpecsForShown's own
  // per-source getValue() closures read these fresh every tick (via
  // cableLayer.tick, never a snapshot), so a cable's flow speed always
  // tracks the live signal even though geometry itself is rebuilt far less
  // often. Written once per update() call below.
  let lastDrives: SceneDrives | null = null;
  let lastFrame: FeatureFrame | null = null;
  let lastAnim: AnimFrame | null = null;

  /** One cable group (src/ui/cableLayer.ts's CableGroupSpec) for whichever
   *  (sceneId, spec) pair is passed — `pinned` or activePreview(), called
   *  once each from cableSpecsForShown below. `isNew`/justAddedKey only
   *  ever applies to the pinned group in practice (a patch can't be edited
   *  without pinning it first — see onJackClick), but there's no reason to
   *  special-case that away here. `interactive` marks the pinned group: its
   *  real patch sources get cableLayer.ts's own onPress, so pressing a
   *  cable unplugs that source — the same toggle the source line's own ×
   *  button takes (below). A preview group is never interactive (a hover
   *  preview isn't a committed patch), and a `"scene"` setting's display-
   *  only sceneSources are never interactive from either group (they have
   *  no per-source unplug — the row's own Unplug button owns that). */
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
      // Every marked condition (there can be more than one now — this
      // file's own header) draws with the same dashed-long style
      // (controlsTheme.ts's .vc-cable-cond), consistent with the source
      // line's own dashed marker and the output graph's dashed trace. A
      // muted source draws in the flat, dashed `.vc-cable-muted` style
      // instead (no glow/flow) regardless of role.
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
          // Press-to-unplug, pinned group only — the same toggle the
          // source line's own × button takes (see this function's header).
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

  /** Both groups cableLayer.ts's own two-path-group recompute takes — see
   *  its header and activePreview() above for why these are independent
   *  rather than one "shown" selection. */
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
      positionSoloEye();
      if (!isOpen) return;
      const { pinned: pinnedGroup, preview: previewGroup } = cableSpecsForShown();
      cableLayer.recompute(pinnedGroup, previewGroup, litSignalFan());
    });
  }

  // ---- The lit signal's fan (cableLayer.ts's third group) ----
  // A signal row lights on hover or focus (controlsTheme.ts's
  // `.vc-row:hover, .vc-row:focus-within`); while it's lit, every wire
  // leaving its jack(s) — the very ones its usage dots count (jackUsage) —
  // is drawn to its port. Tracked by one delegated pointer/focus pair on
  // the panel root, both kept because the glow itself answers to either:
  // a pointer over one row while focus sits on another lights both.
  let hoverJackRow: HTMLElement | null = null;
  let focusJackRow: HTMLElement | null = null;
  /** The signal row `t` sits in — a `.vc-row` carrying at least one jack
   *  (a Hits row carries one per lane) — or null. */
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
  }
  root.addEventListener("pointerover", (e) => setLitJackRows(jackRowOf(e.target), focusJackRow));
  root.addEventListener("pointerleave", () => setLitJackRows(null, focusJackRow));
  root.addEventListener("focusin", (e) => setLitJackRows(hoverJackRow, jackRowOf(e.target)));
  root.addEventListener("focusout", (e) => setLitJackRows(hoverJackRow, jackRowOf(e.relatedTarget)));

  /** One fan group per port the lit row's jack(s) reach in the active
   *  scene — one cable per (setting, jack), so a jack draws exactly as
   *  many cables as it has usage dots. */
  function litSignalFan(): CableGroupSpec[] {
    const rows = [hoverJackRow, focusJackRow].filter((r): r is HTMLElement => r !== null);
    if (!rows.length) return [];
    const keyOfEl = new Map<HTMLElement, string>();
    for (const [key, el] of combinedJackElements()) keyOfEl.set(el, key);
    const litJacks = new Map<string, HTMLElement>();
    for (const row of rows) {
      for (const el of row.querySelectorAll<HTMLElement>(".vc-jack")) {
        const key = keyOfEl.get(el);
        if (key) litJacks.set(key, el);
      }
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
    // Soloed, the meters column is hidden, so a cable would run to a jack
    // that isn't on screen — the cables go with it.
    cableLayer.setVisible(isOpen && !narrowMQ.matches && !soloOn);
  }
  narrowMQ.addEventListener("change", () => {
    refreshCableVisibility();
    scheduleCableRecompute();
  });
  window.addEventListener("resize", scheduleCableRecompute);
  // Geometry is recomputed on every layout trigger the plan names: scroll
  // of the two scrolling columns and of the root itself (the stacked
  // layout's own scroller — cables are hidden there, but a resize crossing
  // the breakpoint mid-scroll should still land on fresh geometry), resize,
  // and a ResizeObserver on both columns (spectrumCol here; controlsCol —
  // declared further down — observes itself once it exists) and on every
  // card in them (observed once the panel is assembled, below). A column is
  // a fixed-height scroller, so a card growing inside it — a row's .vc-hint
  // unfolding on hover/focus — never resizes the column itself; without the
  // per-card observation every jack/port below that card moved while its
  // cable stayed put. The hint's max-height
  // transition fires this observer every frame it animates, which
  // scheduleCableRecompute's rAF batching folds into one recompute per
  // frame. Card fold/unfold piggybacks on the existing columnsWrap
  // MutationObserver (refreshColumnsFold, below); renderSceneSettings
  // schedules one from its own tail.
  const cableColumnsRO = new ResizeObserver(scheduleCableRecompute);
  cableColumnsRO.observe(spectrumCol);
  audioMeters.el.addEventListener("scroll", scheduleCableRecompute, { passive: true });
  root.addEventListener("scroll", scheduleCableRecompute, { passive: true });

  // ---- "Pick a setting first" toast (also keyHints.ts's tips/welcome,
  // given a longer durationMs than a plain patch-bay toast needs) ----
  // Solo's eye: one floating button just outside the pinned row's left
  // edge, under its port (positionSoloEye) — on <body>, not in the row,
  // since the Scene card's overflow: hidden clips anything hung past the
  // row's own edge. A tile in the pin colour with an eye-shaped hole cut
  // through it — dark depth and a pupil down inside, behind two rounded
  // lids that draw apart to open (controlsTheme.ts's .vc-solo-eye rules).
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
    // one shade over both lids (user space), so shut they read as a single rounded bump
    '<radialGradient id="vc-eye-lidshade" gradientUnits="userSpaceOnUse" cx="12" cy="12" r="8.4"><stop offset="0.35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></radialGradient>' +
    '<mask id="vc-eye-hole"><rect width="24" height="24" fill="#fff"/><path d="M4.2 12 Q12 4.6 19.8 12 Q12 19.4 4.2 12Z" fill="#000"/></mask>' +
    '<clipPath id="vc-eye-clip"><path d="M4.2 12 Q12 4.6 19.8 12 Q12 19.4 4.2 12Z"/></clipPath>' +
    "</defs>" +
    // the tile with the hole cut out, and a faint bevel
    '<rect x="1.4" y="1.4" width="21.2" height="21.2" rx="4.2" fill="url(#vc-eye-tile)" mask="url(#vc-eye-hole)"/>' +
    '<path d="M3.2 19.5 V5.6 Q3.2 3.2 5.6 3.2 H19.5" fill="none" stroke="#fff" stroke-opacity="0.2" stroke-width="0.9" stroke-linecap="round"/>' +
    '<path d="M20.8 4.5 V18.4 Q20.8 20.8 18.4 20.8 H4.5" fill="none" stroke="#000" stroke-opacity="0.2" stroke-width="0.9" stroke-linecap="round"/>' +
    '<g clip-path="url(#vc-eye-clip)">' +
    // down in the hole: depth, the pupil, the upper rim's shadow
    '<rect width="24" height="24" fill="url(#vc-eye-depth)"/>' +
    '<circle cx="12" cy="12.4" r="3.3" fill="url(#vc-eye-ball)"/>' +
    '<path d="M4.2 12 Q12 4.6 19.8 12 Q12 19.4 4.2 12Z" fill="none" stroke="#000" stroke-opacity="0.7" stroke-width="2.2" transform="translate(0 -1.1)"/>' +
    // the lids: upper and lower meet at a seam when shut, and draw back
    // toward the hole's top and bottom edges to open
    '<g class="vc-eye-lid-top"><path d="M2 2 H22 V12 Q12 13.2 2 12 Z" fill="currentColor"/><path d="M2 2 H22 V12 Q12 13.2 2 12 Z" fill="url(#vc-eye-lidshade)"/>' +
    '<path d="M2 12 Q12 13.2 22 12" fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="0.9"/></g>' +
    '<g class="vc-eye-lid-bot"><path d="M2 22 H22 V12 Q12 13.2 2 12 Z" fill="currentColor"/><path d="M2 22 H22 V12 Q12 13.2 2 12 Z" fill="url(#vc-eye-lidshade)"/></g>' +
    "</g>" +
    '<path d="M4.2 12 Q12 4.6 19.8 12 Q12 19.4 4.2 12Z" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="0.8"/>' +
    "</svg>";
  soloEyeEl.addEventListener("click", () => setSolo(!soloOn));
  document.body.appendChild(soloEyeEl);
  /** Parks the eye beside the pinned row, in the row's own pin colour, or
   *  hides it — closed panel, nothing pinned, or the row scrolled out of
   *  its column. Rides every cable recompute (scroll, resize, pin, solo). */
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

  /** The one place every selection-driven visual gets recomputed together —
   *  called on a pin, a preview change, and a patch edit (togglePin,
   *  previewDrive, patchChanged above) and once more from
   *  renderSceneSettings's own tail (a scene switch/Look apply rebuilds
   *  every row, including the pinned one's). Content only — never a layout
   *  read itself; scheduleCableRecompute() is what actually measures
   *  anything, on its own rAF-batched schedule. */
  function refreshPatchHighlight(): void {
    audioMeters.refreshPatchView();
    refreshBandsJacks();
    refreshSpectrumDriveHighlight();
    spectrumCol.classList.toggle("vc-patching", isAnythingShown());
    scheduleCableRecompute();
  }

  // A hover-scheduled preview change not yet committed — see
  // wireHoverFocus's own pointerFocusOriginated flag and appendSettingRow's
  // onRowFocusIn below for the dwell this exists to implement (only a
  // pointer-originated focus waits; keyboard/click focus previews
  // immediately). One shared timer, not per-row, since only one such change
  // can ever be in flight.
  let pendingPreviewTimer: ReturnType<typeof setTimeout> | null = null;
  function cancelPendingPreview(): void {
    if (pendingPreviewTimer !== null) {
      clearTimeout(pendingPreviewTimer);
      pendingPreviewTimer = null;
    }
  }

  // The column head, the "Sound" heading (audioMeters.ts's own
  // meterGroupHeading, reused so the three group headings can't drift apart
  // in look), and the Bands card travel as one unit — named vc-bands-block
  // and carrying .vc-spectrum-card (which used to sit on bandsCard.el
  // alone) for the stacked layout in controlsTheme.ts, so a narrow screen
  // keeps head+heading+card together rather than scattering them across
  // the single stacked column.
  const bandsBlock = document.createElement("div");
  bandsBlock.className = "vc-bands-block vc-spectrum-card";
  bandsBlock.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
  bandsBlock.append(columnHead, meterGroupHeading("Sound"), bandsCard.el);

  spectrumCol.append(bandsBlock, audioMeters.el);

  // Power travels with this column for the purposes of the all-folded
  // triangle collapse below: they're wrapped together so the CSS
  // (vc-cols-wrap, controlsTheme.ts) can hide both as a unit. columnsToggle
  // stays in the DOM at all times and is the one element vc-cols-folded
  // keeps visible; clicking it unfolds every folded card by clicking its
  // own chevron (jumpToBlock below does the same for a single card).
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

  // Recomputed off each card's own vc-folded class (via the observer below)
  // rather than a callback threaded through createCard/audioMeters.ts.
  // When "Hide left" is active, Bands and the meter cards are excluded
  // from the check (isFolded(METERS_COLUMN), not an offsetParent probe —
  // that forces a synchronous layout on every class mutation in the
  // column, which stalled the panel once enough cards had folded) — and so
  // is Power itself, since folded Power is already its own compact square
  // (powerCard.ts) in the wide layout; the wrapper only ever needs the "▸"
  // triangle to stand in for a folded *card*, so with meters hidden there's
  // nothing left for it to collapse for. With meters shown, every card in
  // Power + the meters column folded still counts as "everything folded".
  function refreshColumnsFold(): void {
    const cards = [...columnsWrap.querySelectorAll<HTMLElement>(".vc-card")].filter((c) => c.style.display !== "none");
    columnsWrap.classList.toggle(
      "vc-cols-folded",
      !isFolded(METERS_COLUMN) && cards.length > 0 && cards.every((c) => c.classList.contains("vc-folded")),
    );
    // This MutationObserver already fires for every fold/unfold in the
    // Power+Bands+meters column (it observes columnsWrap's own subtree) —
    // reused here as the cable layer's own fold trigger rather than a
    // second observer over the same nodes.
    scheduleCableRecompute();
  }
  new MutationObserver(refreshColumnsFold).observe(columnsWrap, {
    attributes: true,
    attributeFilter: ["class"],
    subtree: true,
  });

  let lastStatusText = "";
  // Only the column head's dot + text now — the scene name it used to carry
  // alongside them ("<scene> · Equaliser") is gone; the top bar already
  // names the scene, so this is a pure audio-source status line.
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


  // The split is fixed (it only tints the bars by pulse group), so the strip
  // needs it set up once — the Hz edges do still depend on the analyser's
  // real sample rate, though, which isn't known until mic access is granted,
  // so this is re-run on every open(). The edges also label the faders. The
  // Frequencies overlay draws on top of this same strip, so it needs neither.
  function refreshBandsSplit(): void {
    bandFaders.setEdgesHz(deps.getBandEdgesHz());
    spectrumStrip.setSplit(deps.getBandSplit());
  }

  // ---- controls column ----
  const controlsCol = document.createElement("div");
  controlsCol.className = "vc-controls-col vc-scroll";
  cableColumnsRO.observe(controlsCol);
  controlsCol.addEventListener("scroll", scheduleCableRecompute, { passive: true });

  // The global "Auto" master switch — toggles every auto-capable row, scene
  // settings plus Sensitivity/Expansion/Smoothing (see app.ts's
  // isSceneAuto wiring). Its own slim full-width bar at the top of the
  // settings column, beside folded Power's square.
  // Overlaps the Input card's own Auto button (below, and see micAuto.ts's
  // header) on the Sensitivity/Expansion/Smoothing rows only — a scene's own
  // settings stay this button's alone — so toggling either refreshes the
  // other's lit state (see toggleAutoMaster/toggleMicAuto).
  const autoMasterBtn = document.createElement("button");
  autoMasterBtn.title = "Auto-tune everything — sensitivity, expansion, smoothing, and every scene setting";
  const autoMasterLabel = document.createElement("div");
  autoMasterLabel.textContent = "Auto";
  const autoMasterSub = document.createElement("div");
  const autoMasterInner = document.createElement("div");
  autoMasterInner.style.cssText = autoMasterInnerStyle;
  autoMasterInner.append(autoMasterLabel, autoMasterSub);
  autoMasterBtn.appendChild(autoMasterInner);

  // Master: device-wide dials. Scale sets every numeric scene param's normal
  // line at autoTune.ts's resolveSceneSetting (once, never on drives,
  // enums/booleans, or the Input card's gain stages — see that doc);
  // Expansion sets how far and how long the music pulls the picture away
  // from it, in the drive engine (drives.ts's header, "Master Expansion"). Sits
  // between the Auto bar and Input as its own always-visible card: it is
  // not part of the auto system, and unlike the Scene card below it must
  // not disappear on a scene that declares no settings of its own — those
  // scenes simply have nothing for it to move. The Scene card's violet,
  // because what it scales is that card's contents.
  //
  // Below the Scale row, the Picture block answers "how intense is the
  // *picture*, in every way" — five compact traces (Brightness/Colour/
  // Motion/Detail/Flashes), measured from the rendered frame itself rather
  // than from any setting or drive, since a setting carries no "more
  // intense" direction of its own. See src/render/pictureMeter.ts for what
  // each measure means and why; tools/master-sweep.mjs walks the same five
  // numbers across every scene and every Scale value headlessly.
  const masterCard = createCard({ title: "Master", accent: SCENE_VIOLET });
  markBlock(masterCard.title);
  const masterRow = createControlRow({
    label: "Scale",
    accent: SCENE_VIOLET,
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
  // Acts on every drive reading around its own recent level — see
  // drives.ts's header, "Master Expansion".
  const masterExpansionRow = createControlRow({
    label: "Expansion",
    accent: SCENE_VIOLET,
    min: SCENE_EXPANSION_MIN,
    max: SCENE_EXPANSION_MAX,
    defaultValue: SCENE_EXPANSION_DEFAULT,
    mapping: "log",
    unit: "×",
    format: formatGain,
    description: "How far the music pulls the picture from its normal, and how long it stays away — 1 is as dialed",
  });
  masterExpansionRow.onChange((value) => deps.onSceneExpansionChange(value));
  // Expansion's shape (drives.ts's header, "Master Expansion"): icon chips
  // in EXPANSION_SHAPES order, so the chosen index is what's stored. Each
  // icon draws its curve — the music's change from usual across, the
  // picture's change from normal up — and the name rides as its tooltip
  // and, with what it does, in the hint line under the strip.
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
  // The leash gauge (leashGauge.ts): Scale's normal as a notch, Expansion's
  // reach as a band, the picture now as a needle — drawn every tick below.
  const leashGauge = createLeashGauge(SCENE_VIOLET);
  const leashRow = document.createElement("div");
  leashRow.className = "vc-row";
  leashRow.append(leashGauge.el);
  masterCard.body.append(masterRow.el, masterExpansionRow.el, masterShapeRow.el, leashRow);

  // Picture block — see the comment above const masterCard. A plain
  // .vc-row/.vc-hint block (not createMeterRow's bar-meter shape: there's no
  // single "amount" here to fill a track with, just independent readouts).
  // Folded (the default) it's one Overall row: a taller trace overlaying
  // every PICTURE_MEASURES entry in its PICTURE_COLORS colour, with
  // overallLevel's combined line on top in the card's violet and its number
  // as the readout. A click (or Enter/Space) unfolds one grid row per
  // measure: caption · 10s trace (createTraceStrip, exported from
  // audioMeters.ts for this) · 0-100 readout, each caption in its trace's
  // colour so the rows double as the legend. They fold to zero height, not
  // display: none — a trace strip only records while its canvas has a width
  // (createColumnRing's ensureSize), so this way each row unfolds with its
  // last 10 s already drawn. caption uses the same register as powerCard.ts's
  // own readoutCaptionStyle (kept local — the two files' row shapes
  // otherwise share nothing worth a third file).
  const pictureHeading = groupHeading("Picture");
  const pictureCaptionStyle = `
    font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.12em; text-transform: uppercase;
    color: rgba(255,255,255,0.5); white-space: nowrap;
  `;
  // digitsTextStyle for "--": DSEG7 (digitsStyle's face) has no dashes — the
  // same textual/digits swap createMeterRow's own setReadout makes.
  const pictureReadoutDigitsStyle = `${digitsStyle} font-size: 11px; color: #fff; display: block; text-align: right;`;
  const pictureReadoutTextStyle = `${digitsTextStyle} font-size: 11px; color: #fff; display: block; text-align: right;`;
  // One colour per measure, shared by its own row and its line in the Overall
  // overlay. Kept clear of SCENE_VIOLET, which is the Overall line itself; a
  // Record so a new PictureMeasureKey can't ship without one.
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

  // Folded, the overlay's colours need naming somewhere: a one-line key
  // under the combined trace, hidden once the rows (whose captions carry the
  // same colours) show.
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

  // Binds a row's typed-entry field to deps.devPin for one (scene, key) —
  // undefined (no typable readout) whenever devPin itself is, i.e. every
  // production build. `sceneId` is a getter rather than a plain string
  // because the Input card's three rows are built once and outlive scene
  // switches (see makeInputRow below); a scene-setting row is rebuilt fresh
  // per scene by renderSceneSettings and could just close over a constant,
  // but taking a getter here either way keeps this one function correct for
  // both callers instead of needing two shapes.
  function pinConfig(sceneId: () => string, key: string, resolve: () => number): ControlRowSpec["pin"] {
    const pin = deps.devPin;
    if (!pin) return undefined;
    return {
      get: () => pin.get(sceneId(), key),
      set: (value) => pin.set(sceneId(), key, value),
      clear: () => pin.clear(sceneId(), key),
      resolve,
    };
  }

  // Input: Sensitivity/Expansion/Smoothing — three instances of the same
  // log-mapped row, sharing the auto-refresh call sites below (master
  // toggle, open(), live-drift refresh) through one array, which is what
  // keeps a future fourth row from shipping half-wired to Auto.
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
      // This row is one of the whole-mic Auto button's own members (see
      // micAuto.ts's header) — refreshMicAuto keeps that button's lit state
      // honest whenever a chip click could have changed it. It also
      // refreshes the Auto master bar (refreshMicAutoAndMaster).
      onAutoToggled: refreshMicAutoAndMaster,
      pin: pinConfig(() => deps.currentSceneId(), spec().key, resolveLive),
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
    // Widens or narrows the gap between quiet and loud, independent of the
    // overall gain Sensitivity controls — see shapeExpansion for the curve.
    makeInputRow(
      "Expansion",
      { min: EXPANSION_MIN, max: EXPANSION_MAX, defaultValue: EXPANSION_DEFAULT },
      deps.getExpansionSpec,
      () => deps.getExpansion(deps.currentSceneId()),
      () => deps.resolveExpansionValue(deps.currentSceneId()),
      (value) => deps.onExpansionChange(deps.currentSceneId(), value),
      "Distance between the quiet parts and the loud parts",
    ),
    // How fast the visuals chase the audio, independent of Sensitivity's gain
    // and Expansion's curve — see smoothingRateScale for the rate mapping.
    // zeroAtMin: unlike Sensitivity/Expansion, this row's slider bottom is
    // a carved-out Off stop rather than SMOOTHING_MIN — genuinely unsmoothed,
    // not just the calmest setting (see sensitivity.ts's header). Auto-tune
    // never lands here on its own: SMOOTHING_SPEC.min in autoTune.ts stays
    // SMOOTHING_MIN, so this is reachable only by a deliberate drag or R-reset-then-drag.
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
    // Auto-gain and the Silence gate rows aren't in inputRows (see their own
    // comments below on why they're built separately) but need the same
    // resync wherever this is called.
    autoGainRow.sync(() => deps.getAutoGain());
    syncSilenceGateRows();
  }

  // Source: one list of every pickable input, plus Screen at the bottom
  // (src/audio/sourcePref.ts for mic-vs-display, src/audio/inputDevice.ts for
  // which device Mic opens). Not gain-mapped like the rows below, so it's not
  // built through createControlRow — a label plus a list of rows where a
  // slider would sit. Sits first in the card, above Auto-gain, since it
  // decides what everything below is even listening to. Deliberately left
  // out of this card's Reset chip below, same as Auto-gain and the Silence
  // gate rows further down — that chip resets per-scene taste, not a
  // device-wide input choice — and out of inputRows, since it has no Auto
  // behavior to wire through that array's shared call sites.
  //
  // CRITICAL: refresh() runs on the panel's own ~10Hz timer (this file's own
  // update()) — rebuilding the row list's DOM there breaks a click in
  // progress (pointerdown lands on one node, pointerup on its replacement,
  // and the browser never fires "click" across that gap). buildRows() below
  // is called only when a structure key says the actual set of rows changed
  // (which options exist, the missing device, the default label, whether
  // Screen is offered); every other refresh() call updates the existing
  // nodes' classes/text in place, same as this file's other polled rows.
  const sourceListStyle = `display: flex; flex-direction: column; gap: 4px; margin-top: 4px;`;
  // One row: [dot or glyph] [name + optional dim sub-line] [meter] [kind tag].
  // Shared by a real device, the "not connected" placeholder, the
  // pre-permission "Microphone" placeholder, and the Screen row.
  const sourceRowStyle = `
    display: grid; grid-template-columns: 12px 1fr auto; gap: 8px; align-items: center;
    width: 100%; box-sizing: border-box; text-align: left; cursor: pointer;
    background: transparent; color: rgba(255,255,255,0.75);
    border: 1px solid rgba(255,255,255,0.14); border-radius: 4px; padding: 7px 8px;
    font: 400 12.5px/1.25 ${FONT_LABEL};
  `;
  // Live = green border + green tint, the same INPUT_GREEN language as the
  // gallery masthead's .gal-src[data-state="live"] and this row's own accent
  // (--vc-accent, set below) — echoing "listening now" in the same colour on
  // both surfaces rather than a generic "lit" look.
  const sourceRowLiveStyle = `${sourceRowStyle} border-color: ${withAlpha(INPUT_GREEN, 0.7)}; background: ${withAlpha(INPUT_GREEN, 0.12)}; color: #fff;`;
  // Dashed = not a real, present option right now — the missing device and
  // the Screen row (a share, not a device, always reads this way) both use it.
  const sourceRowDashedStyle = `${sourceRowStyle} border-style: dashed; border-color: rgba(255,255,255,0.22); color: rgba(255,255,255,0.55);`;
  const sourceRowDotStyle = `width: 8px; height: 8px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.45); box-sizing: border-box;`;
  const sourceRowDotLiveStyle = `${sourceRowDotStyle} background: ${INPUT_GREEN}; border-color: ${INPUT_GREEN};`;
  // The name truncates on one line (device names run long — "Steam Streaming
  // Microphone"); the sub-line under it wraps instead, since it's the hint a
  // truncation would cut in half.
  const sourceRowNameWrapStyle = `min-width: 0; display: flex; flex-direction: column;`;
  const sourceRowNameStyle = `display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
  const sourceRowSubStyle = `display: block; white-space: normal; font: 400 10.5px/1.3 ${FONT_MONO}; color: rgba(255,255,255,0.45);`;
  // The missing row's own sub-line ("not connected") reads as a warning, not
  // just a description — same amber this file uses for any other "pay
  // attention" text (BANDS_AMBER).
  const sourceRowSubWarnStyle = `${sourceRowSubStyle} color: ${BANDS_AMBER};`;
  const sourceRowRightStyle = `display: flex; align-items: center; gap: 8px; flex-shrink: 0;`;
  // Kind tag: what the browser's device name sounds like (inputDevice.ts's
  // inputKind) — neutral for a mic, INPUT_GREEN for a line input (this
  // file's own accent for "the input actually carrying signal"), a cool
  // violet-blue for a loopback driver so it reads as clearly different from
  // both.
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
  // 12-segment level meter, reused for the live row (green, taller) and an
  // idle row's signal preview (grey, shorter — see inputPreview.ts). Segment
  // nodes are fixed once built; only their own style is ever touched, on
  // every rAF tick while the panel's open (this file's own update(), not
  // this row's slower structural refresh() — see the CRITICAL note above).
  const SOURCE_METER_SEGMENTS = 12;
  const sourceMeterStyle = (tall: boolean) =>
    `display: inline-grid; grid-template-columns: repeat(${SOURCE_METER_SEGMENTS}, 3px); gap: 1.5px; height: ${tall ? 9 : 7}px; align-items: stretch; flex-shrink: 0;`;
  const sourceMeterSegLiveOnStyle = `background: ${INPUT_GREEN}; border-radius: 1px;`;
  const sourceMeterSegLiveOffStyle = `background: rgba(255,255,255,0.12); border-radius: 1px;`;
  const sourceMeterSegIdleOnStyle = `background: rgba(255,255,255,0.35); border-radius: 1px;`;
  const sourceMeterSegIdleOffStyle = `background: rgba(255,255,255,0.08); border-radius: 1px;`;
  // The small caption over the Screen row — set apart from the device list
  // above it (a share isn't a device this computer has), same mono/uppercase
  // idiom as driveEyebrowStyle elsewhere in this file, dimmer since it's not
  // a card-level label.
  // The "2 hidden" line under the device rows — plain dim text that opens
  // Edit, deliberately quieter than a row so it never reads as an input.
  const sourceHiddenLineStyle = `align-self: flex-start; margin-top: 2px; padding: 2px 0; background: none; border: 0; cursor: pointer; font: 400 10.5px/1.3 ${FONT_MONO}; color: rgba(255,255,255,0.4); text-decoration: underline dotted rgba(255,255,255,0.25); text-underline-offset: 3px;`;
  const sourceScreenCaptionStyle = `margin-top: 10px; font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.35);`;
  // Always visible while Screen is the active source, not a .vc-hint: the hint
  // only reveals on hover/focus, and on touch that means after the tap that
  // already opened the picker — too late to be a guide. Same reasoning as
  // createTraceLegend's always-on comment in controlsKit.ts.
  const sourceGuideStyle = `margin-top: 6px; font: 400 11px/1.45 ${FONT_LABEL}; color: rgba(255,255,255,0.55);`;
  // Same always-on reasoning as sourceGuideStyle just above — the status line
  // built from this state (refresh() below) is the row's answer to "which
  // one is picked and is it actually listening", so it can't be hover-gated
  // either. No inline color: the .vc-src-status class (controlsTheme.ts) owns
  // it instead, so its [data-prompting] shimmer override — set in refresh()
  // below — can actually win; an inline color here would beat any class rule
  // regardless of specificity.
  const sourceStatusStyle = `margin-top: 6px; font: 400 11px/1.45 ${FONT_LABEL};`;

  const SVG_NS = "http://www.w3.org/2000/svg";
  // A small monitor glyph in place of a device row's dot — Screen isn't a
  // device this computer has, so it gets its own icon rather than borrowing
  // the dot language real inputs use.
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

  // One row's live nodes, built once and reused across refresh()es that
  // don't change the row list itself — see the CRITICAL note above.
  interface SourceRowHandle {
    btn: HTMLButtonElement;
    dot: HTMLSpanElement | null;
    glyph: SVGSVGElement | null;
    name: HTMLSpanElement;
    sub: HTMLSpanElement;
    meter: HTMLSpanElement;
    segments: HTMLSpanElement[];
    tag: HTMLSpanElement | null;
    /** null for the Screen row and the pre-permission placeholder — nothing
     *  to hand onInputDeviceChange. */
    deviceId: string | null;
    isScreen: boolean;
    /** The chosen-but-absent device's own row — dashed, fixed "not
     *  connected" sub-line, never the live row's default-label/loopback text. */
    isMissing: boolean;
    isLive: boolean; // set by refresh(), read by the per-tick meter update
    /** The build-time tooltip, kept by refresh() while the live row's own
     *  "tap to disconnect" one stands in for it. */
    idleTitle?: string;
    /** What updateMeters last painted (live flag + lit segment count, or
     *  hidden), so a tick where nothing changed skips every style write. */
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

  /** silent's wording depends on what kind of input is live — a line, mic or
   *  loopback device, or a screen share — unlike clipping/skipping/hum's
   *  fixed text, so it's broken out. Screen share is checked via
   *  state.choice, same as the status line's own "Listening to screen
   *  share" branch in refresh(); a real device via inputDevice.ts's
   *  inputKind on liveLabel, defaulting to the mic wording where the label
   *  itself is unknown — the same fallback the "Listening to …" line uses. */
  function silentSourceText(state: SourceState, liveLabel: string | null): string {
    if (state.choice === "display") return "Nothing playing";
    const kind = liveLabel ? inputKind(liveLabel) : "mic";
    if (kind === "loopback") return "Nothing playing";
    if (kind === "line") return "No sound coming in — check the cable and the mixer's REC/booth level";
    return "The mic hears nothing";
  }

  /** The Source row's status line while a deps.getInputHealth() reading is
   *  anything but "ok" — src/audio/inputHealth.ts's header explains what
   *  triggers each kind. Null for "ok" (nothing to show — refresh() falls
   *  back to "Listening to …"). Red only for clipping, the one kind with an
   *  immediate, obvious fix (turn something down); the rest are amber
   *  "check your setup" nudges. */
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

    // Edit mode: tapping an input hides or shows it instead of picking it
    // (inputDevice.ts's hidden inputs). A mode, not a per-row ✕, because the
    // rows are buttons already (no nesting a second one inside) and a hover-
    // only control would be unreachable on touch.
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

    // The pre-permission placeholder is its own row, not a device row: it
    // has no deviceId, no kind tag, and starts the mic instead of switching
    // input — one tap grants the permission that fills the real list in.
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
          // The input being listened to stays — hiding it would hide the
          // answer to "what am I hearing".
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
      // Apps (Spotify, a DJ app) aren't inputs, so they never appear in the
      // list above — sharing the app's window (just its sound; see
      // sourcePref.ts's share-TYPE paragraph) or the Entire screen is how a
      // browser hears them.
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

    // Rebuilds the row list only when what it should contain changed — see
    // the CRITICAL note above buildRow for why a rebuild on every refresh()
    // would eat clicks. Returns the live device's label, same contract
    // refreshInputSelect used to have.
    function syncRowList(): string | null {
      const devices = deps.getInputDevices();
      const canDisplay = deps.canCaptureDisplay();
      // Outside Edit a hidden input drops out of the list — unless it's the
      // one being heard, which always shows. In Edit every input shows (the
      // hidden ones dimmed, see refresh()) so any of them can come back.
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
        // The caption sits directly above the Screen row, whatever came
        // before it (real devices, the missing placeholder, or the
        // pre-permission row) — it's what marks Screen as not one of them.
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
          // The missing row's own sub-line ("not connected") and the
          // pre-permission placeholder's ("allow access to list every
          // input") are fixed at build time and never touched here — only a
          // real, present device row's sub-line depends on live/default/kind
          // state that can change without the row list itself being rebuilt.
          const label = row.name.textContent ?? "";
          const isHidden = row.deviceId !== null && !row.isMissing && isInputHidden(label);
          if (!row.isScreen && !row.isMissing && row.deviceId !== null) {
            row.sub.textContent = editing
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
            row.sub.style.display = row.sub.textContent ? "block" : "none";
          }
          row.btn.style.cssText = isLive ? sourceRowLiveStyle : row.isMissing || row.isScreen ? sourceRowDashedStyle : sourceRowStyle;
          if (editing && isHidden) row.btn.style.opacity = "0.45";
          if (row.dot) row.dot.style.cssText = isLive ? sourceRowDotLiveStyle : sourceRowDotStyle;
          if (row.glyph) row.glyph.style.color = isLive ? INPUT_GREEN : "rgba(255,255,255,0.55)";
        }
        guide.style.display = state.choice === "display" && !editing ? "" : "none";
        // See .vc-src-status[data-prompting] (controlsTheme.ts) for the
        // shimmer this drives while nothing's live yet.
        status.toggleAttribute("data-prompting", !state.live && !editing);
        // src/audio/inputHealth.ts's reading, worded by inputHealthText
        // above — takes over the status line in place of "Listening to …"
        // whenever the live input isn't ok. Never checked while editing:
        // that state already owns the line ("Tap an input to hide or show
        // it"), and while nothing's live there's no input to read health on.
        const warning = state.live && !editing ? inputHealthText(deps.getInputHealth() ?? { kind: "ok" }, state, liveLabel) : null;
        // See .vc-src-status[data-warn] (controlsTheme.ts) for the colour —
        // absent (not just falsy) so its CSS rule doesn't match at all.
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
      // Meter segments only — called every rAF tick while the panel's open
      // (this file's own update(), unthrottled like the Bands strip), so the
      // live meter tracks frame.level as closely as the rest of the panel's
      // live meters. `liveLevel` is this tick's FeatureFrame.level; idle rows
      // read deps.getInputLevel(id) instead (src/audio/inputPreview.ts),
      // null wherever that device's preview isn't open (unsupported browser,
      // or it just hasn't opened yet) — its meter keeps its slot but shows
      // no lit segments.
      updateMeters(liveLevel: number | null): void {
        for (const row of rows) {
          const level = row.isLive ? Math.min(1, Math.max(0, liveLevel ?? 0)) : row.deviceId ? deps.getInputLevel(row.deviceId) : null;
          const lit = level === null ? 0 : Math.round(level * SOURCE_METER_SEGMENTS);
          // The level is quantised to a few steps and idle rows mostly sit at
          // zero, so most ticks repeat the last paint — assigning cssText
          // re-parses and invalidates style even for an identical string.
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

  // Auto-gain: how much of the per-band adaptive normalization in features.ts
  // reaches the output. At the bottom (the default) the mic's real levels
  // show — bass louder than treble, like real music — which the adaptive
  // path otherwise flattens by re-normalizing each band to its own recent
  // range; at the top different mics/rooms converge toward the same look at
  // the cost of that balance, and a Bands boost clamps against an
  // already-full band. Between, some of each. Linear, not log-mapped like
  // the three gain rows below: it's a mix amount, and 50% should sit at the
  // middle of the track. Sits first in this card since it changes what the
  // three rows below it are even shaping. Global per device, like Bands'
  // crossover (getBandSplit), so it's deliberately left out of this card's
  // own Reset chip below — that chip resets per-scene taste
  // (Sensitivity/Expansion/Smoothing), not a device-wide input
  // preference. Its "A" chip resolves from the room's own measured span
  // (FeatureExtractor.bandSpanDb), not MUSIC_DIALS like the rows below —
  // no dial describes how much of the analyser's window the room is
  // actually using, which is exactly what this amount fixes — and eases
  // slowly (autoGain.ts's EASE_RATE) so the Dynamics card's history trace
  // still reads as room drift, not something chasing the beat.
  const autoGainRow = createControlRow({
    label: "Auto-gain",
    accent: INPUT_GREEN,
    min: AUTO_GAIN_MIN,
    max: AUTO_GAIN_MAX,
    defaultValue: AUTO_GAIN_DEFAULT,
    mapping: "linear",
    unit: "%",
    format: (value) => String(Math.round(value * 100)),
    description:
      "How much each band is rescaled to fill the display. 0 shows the mic's real levels; higher flattens bass-vs-treble balance but converges different mics and rooms toward the same look.",
    auto: {
      isEnabled: () => deps.isAutoGainAuto(),
      toggle: (on) => deps.onAutoGainAutoToggle(on),
      resolveLive: () => deps.resolveAutoGain(),
      getManual: () => deps.getAutoGain(),
    },
    // Auto-gain is one of the whole-mic Auto button's own members (see
    // micAuto.ts's header) — refreshMicAuto keeps that button's lit state
    // honest whenever this chip is clicked.
    onAutoToggled: refreshMicAuto,
  });
  autoGainRow.onChange((value) => deps.onAutoGainChange(value));
  autoGainRow.sync(() => deps.getAutoGain());

  // Silence gate: two volume marks in FeatureFrame.level units (see
  // src/audio/silenceGate.ts for the why — relative onset detection
  // misfiring on mic hiss in a quiet room). Both rows share one `auto`
  // block, driven by isSilenceGateAuto/resolveSilenceGate: unlike a scene
  // setting's own auto weights, this doesn't resolve against MUSIC_DIALS —
  // nothing there describes "how quiet is this room" — it leans on
  // silenceGate.ts's own room-floor tracker instead, the same reason
  // Auto-gain's own "A" chip above leans on FeatureExtractor.bandSpanDb
  // rather than the music profile (see that file's "Auto mode" header
  // paragraph for the tracker itself). One flag drives both marks (they're
  // one gate — silenceGate.ts's own ordering invariant couples them
  // anyway), which is why each row's own `toggle` below also refreshes the
  // other row's chip: nothing else would. `syncSilenceGateRows` still
  // re-reads both *manual* marks from the store after either row's own
  // manual drag, since moving one can push the other — trusting just the
  // row that fired onChange would leave the other stale.
  const silenceClosedRow = createControlRow({
    label: "Silence below",
    accent: INPUT_GREEN,
    min: SILENCE_GATE_MIN,
    max: SILENCE_GATE_MAX,
    defaultValue: SILENCE_GATE_CLOSED_DEFAULT,
    mapping: "linear",
    zeroAtMin: true,
    unit: "%",
    format: (value) => String(Math.round(value * 100)),
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
    unit: "%",
    format: (value) => String(Math.round(value * 100)),
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

  // The Input card's own Auto button — hands the whole mic to auto in one
  // tap (see micAuto.ts's header for exactly what that covers). refreshMicAuto
  // and toggleMicAuto themselves live further down, by refreshAutoMaster/
  // toggleAutoMaster — the scene master toggle they overlap on the
  // Sensitivity/Expansion/Smoothing rows — but the button is built here
  // since it's part of this card's own header.
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
        // for as long as one is held, so clearing after would leave it
        // showing "Off" over the restored default.
        row.clearOff();
        row.setValue(defaultValue);
        row.refreshChip();
      }
      // onChange above took those rows back to manual without going through
      // a row's own commit(), so its onAutoToggled hook never heard about it.
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

  // Scene: per-scene look knobs (e.g. Caustics' focus/breathe/ripple/flash).
  // Rebuilt on every open() since the set of rows depends on which scene is
  // active.
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
  // Cards a widget mounts alongside the Scene card (WidgetCtx.mountCard,
  // registry.ts — Physarum 2's Affinity card is the first) — a plain host,
  // not a card of its own, sitting right after the Scene card in the
  // controls column (controlsCol.append below) so a mounted card reads as
  // "one more block after the Scene card" rather than a floating extra.
  // Cleared at the top of every renderSceneSettings() call exactly like
  // sceneRows.innerHTML, so a widget card never survives a scene switch/Look
  // apply/card Reset it wasn't rebuilt by. pinnableCards()/findPinnedRowEl()
  // below search it alongside sceneCard.el for whichever card holds the
  // currently pinned row, since a row built through WidgetCtx.registerCard
  // pins exactly like a Scene-card row (registerPinnableRow, below) but can
  // live in either card.
  const sceneWidgetCardsHost = document.createElement("div");
  /** Every top-level card a Scene-setting row's pin can live in — the Scene
   *  card itself, plus whatever `sceneWidgetCardsHost` currently holds. */
  function pinnableCards(): HTMLElement[] {
    return [sceneCard.el, ...sceneWidgetCardsHost.querySelectorAll<HTMLElement>(":scope > .vc-card")];
  }
  /** The currently `.vc-drive-pinned` row, wherever it lives — replaces the
   *  several `sceneCard.el.querySelector(".vc-drive-pinned")` call sites
   *  Solo/the solo eye/jumpToBlock used before a widget could mount a second
   *  pinnable card. */
  function findPinnedRowEl(): HTMLElement | null {
    for (const card of pinnableCards()) {
      const row = card.querySelector<HTMLElement>(".vc-drive-pinned");
      if (row) return row;
    }
    return null;
  }
  // What the per-tick loop and the auto refresh need from a scene row — a
  // slider row (createControlRow) satisfies it as is; an enum picker with
  // `reads` supplies its own pair (see appendSettingRow).
  interface SceneRowHandle {
    updateSignalPills(frame: FeatureFrame | null, anim: AnimFrame | null): void;
    refreshAuto(): void;
  }
  let sceneRowHandles: SceneRowHandle[] = [];
  // Cleanup callbacks a widget registered via WidgetCtx.onDispose
  // (widgets/registry.ts) — run once, right before the next full rebuild.
  let widgetDisposers: (() => void)[] = [];

  // registry.ts's `appendRow` `linked` option, by the primary row's own
  // spec.key — rebuilt from scratch on every renderSceneSettings() call
  // exactly like sceneRowHandles/driveRowHandles above, since it's only ever
  // read for a row on the currently-mounted card. `ownLabel` is the primary
  // item's own short name, needed only to build a "Mixed — …" drive summary
  // alongside `linked`'s own labels (see buildDriveRow's refreshMeta and
  // patchChanged's syncLinkedDriveSetting below).
  let linkedByKey: Map<string, { ownLabel?: string; linked: readonly LinkedSetting[] }> = new Map();

  // Looks: named snapshots of the Scene card's own settings above — see
  // src/render/sceneLooks.ts. Hidden the same way sceneCard is when the
  // active scene has no settings to snapshot (renderSceneSettings below).
  const looksCard = createLooksCard({
    currentSceneId: deps.currentSceneId,
    listLooks: deps.listLooks,
    onSaveLook: deps.onSaveLook,
    onApplyLook: (look) => {
      deps.onApplyLook(look);
      renderSceneSettings();
    },
    onDeleteLook: deps.onDeleteLook,
    decodeLook: deps.decodeLook,
    buildShareLink: deps.buildShareLink,
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

  // Walks every .vc-block heading in document order and writes its digit —
  // called whenever the block set can change (only renderSceneSettings does:
  // group headings come and go with the active scene). Blanks anything past
  // the ninth rather than doubling up on "9", so a scene with more groups
  // than digit keys degrades to "those last ones aren't reachable by number"
  // instead of a wrong or ambiguous badge.
  function renumberBlocks(): void {
    const blocks = root.querySelectorAll<HTMLElement>(".vc-block");
    blocks.forEach((heading, i) => {
      const badge = heading.querySelector<HTMLElement>(".vc-block-n");
      if (badge) badge.textContent = i < 9 ? String(i + 1) : "";
    });
  }

  // "all"/"low"/"mid"/"high" (SignalSpec.bandRange, signals.ts) resolved
  // against the *live* split rather than a fixed index range, since
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

  // Lights the bands a signal-linked row actually listens to on the
  // spectrum strip while the row is being touched — hover, keyboard focus,
  // or a drag — and clears back to the normal view on release. A no-op for
  // a row with no `reads`, or whose reads are all band-agnostic (drop
  // detection: section loudness, not a frequency read) — which in practice
  // makes this a non-drive-row-only affordance, since a drive setting
  // declares no static `reads` at all (signals.ts's own header). A drive
  // row has no spectrum tint of its own in this phase — see this file's
  // header doc comment; Phase 2b's jacks/cables own that instead.
  // Recomputed on every `input` (not just on entry) since dragging Ripple
  // source across its own threshold changes which signal is actually active
  // mid-drag — see RIPPLE_SRC_BEAT_THRESHOLD's own comment in caustics.ts.
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


  // Builds one setting's row (enum picker, boolean toggle or slider) into `container` —
  // shared by the direct-to-sceneRows path and the advanced-section path
  // below, so a row behaves identically wherever it lands.
  // `specs` is the active scene's full settings list, needed only to resolve
  // a SignalLink.activeWhen predicate against a *sibling* setting by key
  // (spec.reads below) — every other branch here only ever touches `spec`
  // itself. `accent` defaults to the Scene card's usual SCENE_VIOLET;
  // renderSceneSettings passes a family's own colour instead for a row
  // in a family (spec.family), so the A/T chips — styled
  // directly from this parameter, not from the row's `--vc-accent` CSS
  // variable — tint correctly too.
  // `opts.linked`/`opts.ownLabel` are registry.ts's `appendRow` own
  // multi-item-selection bridge (itemBoxes.ts's multi-strain edit,
  // 2026-09-27) — see that file's doc comment on `appendRow` for the full
  // contract; `setLinkedValue` below is the one choke point every plain
  // value edit (slider drag, typed value, reset arrow, T mute, an Auto
  // toggle) goes through, so `linked` only has to be threaded once here
  // rather than at each of the three branches below. A drive/patch edit's
  // own choke point is `patchChanged`/`syncLinkedDriveSetting`, further down
  // this file, since a patch mutation is never a `deps.onSceneSettingChange`
  // call in the first place.
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

    // A sibling setting's live (auto-aware) value, by key — what a
    // SignalLink.activeWhen predicate reads (see signals.ts's SignalLink doc
    // comment). Falls back to 0 for an unknown key rather than throwing: a
    // typo here is exactly what tests/signals.test.ts's key check exists to
    // catch ahead of time, not something a live panel should crash over.
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

    // The preview signal (see previewDrive's own doc comment) — every
    // scene-setting row gets this, regardless of type, so focusing a
    // non-drive row (an enum picker, a toggle) correctly clears a previous
    // preview too, not just sliders. Pointer-originated focus
    // (wireHoverFocus's pointerFocusOriginated flag) waits out
    // HOVER_SELECT_DELAY_MS before actually previewing, canceled by
    // whichever comes first: a newer focusin (any row, cancelPendingPreview
    // at the top of both this and previewDrive) or this row losing focus
    // before the timer fires (wirePreviewFocus's focusout below) — together
    // these are what let a fast sweep across several rows toward the spectrum
    // strip leave the starting preview alone. Keyboard/click focus (not
    // pointer-originated) previews immediately. Never touches `pinned` —
    // only an explicit click (togglePin) does that.
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

    /** Makes this row pinnable (pinRowHandles). A drive row brings its own
     *  handle, and createControlRow wires its card press (onCardPin); any
     *  other row's `main` control is passed so a press on it, or on the card
     *  around it, pins — the non-drive case is `registerPinnableRow`, shared
     *  with `WidgetCtx.registerCard` (see that function's own doc comment). */
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

    /** Wires `el`'s focusin to onRowFocusIn, and a focusout that cancels
     *  this row's own still-pending hover preview if focus leaves it for
     *  somewhere that never calls onRowFocusIn at all (the spectrum
     *  strip, the meters, another card) before the dwell fires — a newer
     *  row's own focusin already cancels via onRowFocusIn's own call, but
     *  that only fires for focus landing on *another row*, not for focus
     *  leaving the ring of rows entirely. `el` is the whole row (slider,
     *  A/T/reset chips and all), so a focus change *within* it (e.g. Tab to
     *  its own reset chip) isn't a leave. */
    function wirePreviewFocus(el: HTMLElement): void {
      el.addEventListener("focusin", onRowFocusIn);
      el.addEventListener("focusout", (e) => {
        if (!el.contains(e.relatedTarget as Node | null)) cancelPendingPreview();
      });
    }

    if (spec.type === "enum" && spec.options) {
      // An enum's `reads` get the same chip + pill strip a slider row builds
      // for itself inside createControlRow — here the host builds it, since
      // the picker only mounts it (PickerRowSpec.signals). The pills are
      // how a picker that chooses *what the scene listens to* (shards' Cut
      // on: Beat vs Bass hit, via complementary activeWhen predicates)
      // shows which trigger the current choice actually rides.
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
      // A trigger toggle (Toon Rave's Drop on big hits) gets the same port and
      // patch panel as a slider row, so its signal can be rewired.
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

    // A drive-capable setting (spec.drive) gets the patch bay's own port,
    // summary and sparkline — built before the row itself (createControlRow
    // needs them ready in its `drivePanel` slot) and bound after (bind()
    // needs the finished row element for the pinned-row highlight) — see
    // buildDriveRow's own doc comment.
    const driveBuild = spec.drive ? buildDriveRow(sceneId, spec) : null;

    const row = createControlRow({
      label: spec.label,
      accent,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      defaultValue: deps.getSceneSettingDefault(sceneId, spec),
      mapping: "linear",
      format: formatSetting,
      description: spec.description,
      // A macro-driven setting (spec.macro) is auto-capable the same way an
      // `auto` one is — it just tracks another setting instead of the music
      // profile — so it gets the same A chip and live-refresh wiring.
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
      // isSceneAuto is true only while EVERY auto-capable row is auto, so any
      // one row's A chip or a drag off auto flips the master bar's state.
      onAutoToggled: refreshAutoMaster,
      pin: pinConfig(() => sceneId, spec.key, () => deps.resolveSceneSettingValue(sceneId, spec)),
      reads,
      drivePanel: driveBuild
        ? { port: driveBuild.port, summary: driveBuild.summary, below: driveBuild.below, onPin: () => togglePin(sceneId, spec) }
        : undefined,
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

  /** registry.ts's `WidgetCtx.mountRows` — a scoped sibling of
   *  `appendSettingRow` above: builds `rows` into a single host div appended
   *  to `container`, snapshotting `sceneRowHandles`/`driveRowHandles`/
   *  `driveSparkCanvases` before and after so the returned `dispose()` can
   *  unregister exactly what this call added (and `linkedByKey` entries by
   *  the same rows' own keys) rather than the whole card's worth
   *  `renderSceneSettings` resets. Mirrors that function's own pinned-row
   *  reconciliation (its tail, below) for just the rows this call built: a
   *  mount that happens to recreate the currently-pinned row picks the
   *  patch panel back up instead of waiting for the next full rebuild. See
   *  registry.ts's header for why a widget (itemBoxes.ts's selection
   *  change) reaches for this instead of `ctx.rerender()`. */
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
    // A pin handed off by the previous mount's dispose (below): re-pin the
    // same per-item control on whichever item this mount shows, so switching
    // strains keeps the patch bay aimed at "Nutrient", not at a hidden row.
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
        // Never leave the pin (or a hover preview) on a row that no longer
        // exists: unpin, and remember which per-item control it was so the
        // next mountRows can re-pin its counterpart (see above).
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
    // Not scene-specific like the rest of this function, but this is the
    // one place that already re-syncs on every open()/scene-change/Look
    // apply (see this function's own callers) — piggybacking here means
    // mic-auto's own asymmetry (see micAuto.ts's header: some members are
    // per-scene, some device-wide) can never leave the button stale after a
    // scene switch without a second call site to remember.
    refreshMicAuto();

    let lastGroup: string | undefined;
    let first = true;
    let hasGroups = false;
    // The currently-open advanced-section body a run of consecutive
    // spec.advanced entries is being appended into, or null between runs —
    // reset whenever a group heading appears so a run never spans a group.
    let advancedBody: HTMLElement | null = null;
    // familyAccents hands out FAMILY_ACCENTS (SceneSetting.family) in the
    // order this scene's family names are first seen, wrapping past the
    // end, and remembers the assignment for the rest of this render so
    // every row of a family gets the same colour.
    const familyAccents = new Map<string, string>();
    const accentForFamily = (family: string): string => {
      let accent = familyAccents.get(family);
      if (!accent) {
        accent = FAMILY_ACCENTS[familyAccents.size % FAMILY_ACCENTS.length];
        familyAccents.set(family, accent);
      }
      return accent;
    };

    // Scene-declared item widgets (src/render/sceneItems.ts, scene.ts's
    // Scene.panel) render first, inside this same card — see
    // src/ui/widgets/registry.ts's header. Every setting whose
    // `item.family` a section claims is then skipped by the flat loop
    // below, exactly as if it weren't in `specs` at all.
    const scene = deps.getScene(sceneId);
    const panelSections = scene?.panel ?? [];
    const claimedFamilies = new Set(
      panelSections.map((s) => s.items).filter((x): x is string => x !== undefined),
    );
    // Plain settings a section renders itself (PanelSection.settings) — the
    // flat loop below skips these too.
    const claimedKeys = new Set(panelSections.flatMap((s) => s.settings ?? []));
    for (const section of panelSections) {
      const build = getWidget(section.widget);
      // tests/sceneKeys.test.ts checks every panel widget id is registered
      // ahead of time — a missing one here just renders nothing rather than
      // throwing in a live panel.
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
          // Own class beyond the generic .vc-card so a script (padcheck.mjs)
          // or a future second widget card can find "a card a widget
          // mounted" without matching on its title text.
          card.el.classList.add("vc-widget-card");
          markBlock(card.title);
          sceneWidgetCardsHost.appendChild(card.el);
          return { el: card.el, body: card.body };
        },
        registerCard: (rowEl, spec) => registerPinnableRow(sceneId, spec, SCENE_VIOLET, rowEl, rowEl),
        // The exact same live reading a row's own sparkline draws — see
        // WidgetCtx.driveValue's own doc comment (registry.ts).
        driveValue: (spec, rest) => lastDrives?.valueOf(spec.key, rest) ?? rest ?? 0,
        probe: () => deps.getScene(sceneId)?.probe?.() ?? null,
        command: (name, args) => deps.getScene(sceneId)?.command?.(name, args),
        onTick: (fn) => tickFns.push(fn),
        onDispose: (fn) => widgetDisposers.push(fn),
        // A whole-card rebuild rather than patching this section's own DOM
        // — see registry.ts's header for why that's the right amount of
        // work here (it reuses every bit of jack/cable/pin teardown below
        // for free).
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
        // Families don't reach into an advanced run — see SceneSetting.family's
        // own doc comment (sceneSettings.ts).
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
      // A family's own colour rides straight in as this row's `accent` (not
      // a post-hoc --vc-accent override) so the A/T chips — styled directly
      // from the accent passed to createControlRow/createPickerRow/
      // createToggleRow, not from that CSS variable — tint correctly too,
      // not just the slider fill and label.
      const accent = spec.family !== undefined ? accentForFamily(spec.family) : SCENE_VIOLET;
      appendSettingRow(sceneRows, sceneId, spec, specs, accent);
    }

    // The Scene card title is itself the block only when the active scene
    // has settings but emits no group headings — otherwise it and the first
    // group heading would both resolve to the same first row. Every scene
    // with settings groups them today (tests/settingGroups.test.ts requires
    // it — see SETTING_GROUPS in sceneSettings.ts), so this branch is dead
    // until some future scene's settings all go ungrouped again.
    if (specs.length > 0 && !hasGroups) markBlock(sceneCard.title);
    else unmarkBlock(sceneCard.title);
    renumberBlocks();

    // A preview never survives a rebuild — it's transient by design, and
    // the row it pointed at may not even exist any more (a variant switch
    // changes which settings are on the card). A pin does survive, but its
    // panel has to be rebuilt against the freshly-built row (every caller
    // here — a scene switch, a Look apply/undo, a variant switch, a card
    // Reset, every open() — replaces every row from scratch above): found
    // by (sceneId, key) in the new driveRowHandles, or dropped if the pinned
    // setting no longer exists on this scene (including a genuine scene
    // switch, since every row just built carries the *new* sceneId).
    preview = null;
    cancelPendingPreview();
    if (pinned) {
      const stillHere = pinRowHandles.find((r) => r.sceneId === pinned!.sceneId && r.spec.key === pinned!.spec.key);
      if (stillHere) stillHere.refreshPin();
      else {
        pinned = null;
        lastPinnedSetting = null;
        // The old output graph is detached with its patch panel — stop
        // update() redrawing it (togglePin clears this the same way).
        activeOutputTick = null;
      }
    }
    // A jack click with nothing pinned reaches for lastPreview — drop it on
    // a genuine scene switch, same reasoning as the pinned check above,
    // rather than let a jack click quietly pin a setting on the scene that
    // was just left.
    if (lastPreview && lastPreview.sceneId !== sceneId) lastPreview = null;
    refreshLineMode();
    refreshPatchHighlight();
    // The rows were just rebuilt, unmarked — re-hide around whatever solo
    // now isolates.
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
        // Stay open — the scene isn't hidden behind a backdrop, so tapping
        // through palettes to watch the scene recolor is the point.
        renderPalettes();
      });
      row.appendChild(btn);
    }
  }

  // Footer strip: the view toggles (keys, solo, the meters column) and a way
  // out. It lives in the column that never hides, rather than above Bands: a
  // chip up there had to be its own row, which pushed the whole column down
  // out of line with Power and the Auto bar. The dock that holds it is
  // sticky to the bottom of that column (.vc-dock, controlsTheme.ts) — at
  // the bottom of the scroll, the buttons were out of sight whenever the
  // column overflowed, which it almost always does.
  const footer = document.createElement("div");
  footer.style.cssText = footerStyle;
  // data-key/data-keycap (keyHints.ts): each footer button *is* the control
  // its shortcut performs, so it's tagged at creation rather than looked
  // up later — the hover tooltip, the held-Shift keycap, and the keys
  // list's own hover/click flash (targetsFor below) all key off this.
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

  // The keys list behind "Keys" — one row per src/ui/keyHints.ts's own
  // SHORTCUTS entry, built here (not there) since a row is also this
  // file's own click/hover target: hovering it flashes every visible
  // `[data-key="<id>"]` control it names (targetsFor/flashOn — capped,
  // since a busy scene can carry many rows' worth of A/R/T chips); clicking
  // it performs the action for the handful of ids with exactly one
  // (singleAction), or just re-flashes for the rest (⇧1–9, 1–9, A/R/T, Z X C,
  // Esc — nothing single to do for those from a click).
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
  // Reuses each control's own click handler rather than re-implementing its
  // effect, so the two can never drift apart — a side effect is that
  // keyHints.ts's own delegated click listener then also credits that
  // control with a genuine mouse use. "panel" has no button local to this
  // file (the gear lives in app.ts) — deps.toggleButton is that same
  // data-key="panel" control, so clicking it here still reaches it, and
  // since the panel is open, still closes it (deviceMenu.toggle()).
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
  // Not a SHORTCUTS entry: it names no single control of its own (holding
  // it reveals every tagged control's keycap at once), so it's neither a
  // click action nor a flash target — disabled rather than wired.
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
    // Hiding/showing the column changes which cards have a layout box
    // without touching any card's own vc-folded class, so the observer
    // above never fires for it on its own — recompute here instead.
    refreshColumnsFold();
  }
  setMetersHidden(isFolded(METERS_COLUMN));

  // ---- solo ----
  // Everything but the pinned setting (or, unpinned, the Scene card)
  // hidden, until O again — hidden by walking up from it and the dock
  // (which always stays) to the root, and marking every sibling off those
  // paths .vc-solo-hidden — so no
  // column, heading or neighbouring button needs its own rule, in either
  // layout. View state for this session only, like the keys list.
  function setSolo(on: boolean): void {
    // Soloed, what's isolated slides down to the bottom of the column, just
    // above the footer (.vc-solo's rules in controlsTheme.ts). Un-soloed it
    // stays where it is — the column scrolls so the rest of the panel comes
    // back around it; only when the column can't scroll that far (a pane
    // near the top of the list) does it slide the rest of the way.
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
  /** Plays `el` from `dy` px away back to where layout now puts it — a
   *  quick ease-out, skipped under reduced motion. Cables and the solo eye
   *  are re-placed once it lands. */
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
    // A pinned setting (its row plus its patch pane, the one outlined in
    // its source colour) is the thing being worked on — it alone stays, the
    // meters column included in what goes. The pinned row can live in the
    // Scene card or a card a widget mounted beside it (WidgetCtx.mountCard);
    // whichever one holds it is unfolded the same way the Scene card alone
    // used to be.
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

  // keyHints.ts's hover badge, hold-to-reveal keycaps, and the mouse half
  // of its light-suggestion tracking — one install for the panel's whole
  // lifetime (there's exactly one device menu instance). A tip gets longer
  // on screen than showToast's own default toast duration.
  installKeyHints((text) => showToast(text, 4000));

  // What each button last painted — refreshAutoMaster/refreshMicAuto also run
  // on the 10 Hz tick, and re-assigning four cssTexts every time is wasteful.
  // null until the first paint, so that one always writes.
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

  // Overlaps the Input card's own Auto button (micAuto.ts) on the
  // Sensitivity/Expansion/Smoothing rows, which both toggles share — refresh
  // that button too, since flipping every scene setting to manual/auto here
  // can just as easily have flipped it out from under mic-auto's own lit
  // state as the reverse.
  function toggleAutoMaster(): void {
    const sceneId = deps.currentSceneId();
    deps.onSceneAutoToggle(sceneId, !deps.isSceneAuto(sceneId));
    renderSceneSettings();
    syncInputRows();
    refreshMicAuto();
  }
  autoMasterBtn.addEventListener("click", toggleAutoMaster);

  // The Input card's own Auto button — see micAuto.ts's header for exactly
  // which members "the whole mic" covers, and this file's card-anatomy
  // header comment for how it relates to the scene master above.
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
    // The Sensitivity/Expansion/Smoothing members are shared with the scene
    // master (see toggleAutoMaster above) — a mic-auto toggle can just as
    // easily have flipped that button's own lit state.
    refreshAutoMaster();
  }

  controlsCol.append(autoMasterBtn, masterCard.el, inputCard.el, sceneCard.el, sceneWidgetCardsHost, looksCard.el, setCard.el, paletteCard.el, dock);
  root.append(columnsWrap, controlsCol);
  // Every card is built once above and lives for the panel's lifetime, so
  // one pass covers them all — see cableColumnsRO's own comment.
  for (const card of root.querySelectorAll<HTMLElement>(".vc-card")) cableColumnsRO.observe(card);
  document.body.appendChild(root);

  // ---- open / close ----
  // (isOpen itself is declared up with soloOn — setSolo reads it.)

  // A tap outside the panel leaves it open — it's corner-docked so you can
  // work the scene beside it, and it closes only from the gear, Hide UI, S
  // or H — but it does let go of whatever the panel was holding: keyboard
  // focus (so A/R/T/z/x/c stop landing on the last row), a pinned patch (as
  // Escape does) and the keys list. Solo (always the Scene card now) stays
  // as it was. With no full-screen backdrop to catch outside taps, this
  // listens on the document instead; the gear is excluded since it's the
  // panel's own switch.
  function onDocPointerDown(e: PointerEvent) {
    const t = e.target as Node | null;
    // The cable layer sits on <body>, outside root (cableLayer.ts's own
    // header — it's above every card on purpose), but pressing a cable is a
    // patch edit like a jack click, not a click on the scene: without this
    // clause a cable press would unpin the setting it just unplugged from.
    if (t && (root.contains(t) || deps.toggleButton.contains(t) || soloEyeEl.contains(t) || cableLayer.el.contains(t)))
      return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && root.contains(active)) active.blur();
    if (pinned) togglePin(pinned.sceneId, pinned.spec);
    setKeysShown(false);
  }

  // The Tab ring: every param control, in document order — see the header
  // comment. Derived from the DOM each call rather than cached, so a Scene
  // card rebuilt by renderSceneSettings can never leave it stale. Filtered
  // to controls with a layout box: a folded card's body is display:none, a
  // pinned setting's patch panel is display:none while unpinned, and
  // lineEditor.strengthRow sits detached entirely outside line mode (it's
  // only ever appended into a source line, this card's own assembly
  // section) — a control inside any of those would otherwise sit in the
  // ring and fail to focus.
  // The Power column's Resolution slider is left out, as its chips are: a
  // folded Power card is only visibility:hidden (it keeps its layout box), so
  // it would pass the filter below and Tab would dead-end on a hidden control.
  function ringElements(): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(".vc-slider, .vc-toggle, .vc-picker, .vc-fader")].filter(
      (el) => el.getClientRects().length > 0 && !el.closest(".vc-power-col"),
    );
  }

  /** Tab while something is pinned: the pin moves to the next/previous
   *  visible drive row (wrapping), and keyboard focus follows onto that
   *  row's own control — focused first, pinned second, since togglePin
   *  clears the preview that focus just set. */
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

  // A digit key resolves the nth .vc-block heading (numbered by
  // renumberBlocks) and focuses the first ring control after it in document
  // order — found by document position rather than by walking a specific
  // container, since a block heading is sometimes a card title (siblings:
  // its card's body) and sometimes a group heading (siblings: the following
  // rows in the same Scene card body).
  function jumpToBlock(n: number): void {
    const heading = [...root.querySelectorAll<HTMLElement>(".vc-block")][n - 1];
    if (!heading) return;
    // Soloed, a jump outside what's soloed needs the rest of the panel
    // back rather than trying to move the solo onto it.
    if (soloOn && !(findPinnedRowEl() ?? sceneCard.el).contains(heading)) setSolo(false);
    // A folded card's controls have no layout box and are invisible to
    // ringElements() below — unfold first, or the jump would silently land
    // on the next block's control instead.
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

  // Everything in the panel that follows the active scene or palette — what
  // open() brings up to date, and what a scene change from outside (a Set
  // pad, Autopilot) does again while the panel stays open.
  function syncToScene(): void {
    renderPalettes();
    syncInputRows();
    // The panel may have been closed on a different scene since `pinned`
    // was last checked — renderSceneSettings()'s own tail unpins it if so,
    // and rebuilds its patch panel for whatever's still pinned either way.
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

  // Cache of the last --wash value written, so update() (called every rAF
  // tick while open) only touches the DOM when the fill color actually moves.
  let lastWash = "";
  // ~10Hz — auto-driven values move on a multi-second timescale, so per-frame
  // DOM writes here would be pure cost. The spectrum header rides the same
  // tick; its status changes even more rarely.
  const AUTO_UI_REFRESH_MS = 100;
  let lastAutoRefreshMs = 0;
  // ~30 Hz — every drive row's own sparkline, plus the pinned row's output
  // graph if it has one (this file's own carried rule: canvas draws, not
  // DOM rebuilds, so this rides its own faster cadence rather than
  // AUTO_UI_REFRESH_MS's 10 Hz).
  // A fixed clock, not "whenever 1/30 s has passed since the last draw":
  // a frame that arrives late owes the graphs every column it spanned, so
  // "last 4 s" is 4 s of real time at any frame rate and evenly timed hits
  // land evenly spaced, as on the meters' own time-axis strips (the old
  // reset-to-now dropped the remainder, so a 40 fps panel drew at 20 Hz and
  // a heavy scene's graph covered 6 s, unevenly). A gap past
  // SPARKLINE_MAX_SLOTS (folded card, closed panel, hidden tab) restarts the
  // clock instead of filling seconds with one reading.
  const SPARKLINE_REFRESH_MS = 1000 / 30;
  const SPARKLINE_MAX_SLOTS = 15;
  let lastSparklineMs = 0;
  // The Picture block's five readouts (its traces redraw every tick, same
  // reasoning as the sparklines above); the readout text itself rides this
  // slower cadence, same reasoning and rate as AUTO_UI_REFRESH_MS but kept
  // separate since the two blocks' DOM writes are otherwise independent.
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
    ) {
      // Skip the DOM write while closed — the panel is re-opened via open()
      // anyway, and this runs every rAF tick while in a viz.
      if (!isOpen) return;
      // A scene switch (or a renderer with nothing playing) leaves `pinned`
      // pointing at a setting that no longer belongs to the active scene —
      // checked here rather than at every scene-change call site, since this
      // runs every tick regardless of how the switch happened (gallery pick,
      // Look apply, a paired device's own command). Cheap when nothing's
      // pinned or the scene hasn't changed — togglePin() only actually
      // rebuilds anything on the rare tick this fires.
      if (pinned && pinned.sceneId !== deps.currentSceneId()) togglePin(pinned.sceneId, pinned.spec);
      audioMeters.update(frame, anim, mono, rawBands, rateScale, fixedEnergy, lufs, beatDiag, gate);
      // Unthrottled, same reasoning as the Bands strip a few lines below —
      // the live row's meter should track frame.level as closely as any
      // other live meter in this panel, not just at the row list's own
      // AUTO_UI_REFRESH_MS structural-refresh cadence.
      sourceRow.updateMeters(frame?.level ?? null);
      // The cable layer's own per-tick flow (dashoffset only, no reads —
      // see cableLayer.ts's header) and the Bands card's own level rows;
      // both need a live dtSec and the freshest anim/drives this tick.
      lastDrives = drives;
      lastFrame = frame;
      lastAnim = anim;
      const cableNowMs = performance.now();
      const cableDtSec = Math.min(1 / 15, Math.max(1e-4, (cableNowMs - lastCableTickMs) / 1000));
      lastCableTickMs = cableNowMs;
      if (!bandsCard.fold?.isFolded()) {
        for (const r of bandLevelRows) {
          const v = anim ? (r.choice === "anim.low" ? anim.low : r.choice === "anim.mid" ? anim.mid : anim.high) : null;
          r.row.setValue(v, cableDtSec);
        }
      }
      if (!narrowMQ.matches) cableLayer.tick(cableDtSec);
      // Unthrottled, same reasoning as audioMeters' own fills — see
      // createControlRow's updateSignalPills doc comment. A no-op per row
      // with no `reads`, so this costs nothing for the common case.
      for (const row of sceneRowHandles) row.updateSignalPills(frame, anim);
      // The tick is FeatureFrame.level — absolute, fixed-window loudness,
      // untouched by Auto-gain — so it reads the room regardless of that
      // amount. The fill starts from .energy, which Auto-gain does shape,
      // then runs the same sensitivity+expansion curve the render path
      // applies, so it reads what the scene is actually reacting to.
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

      // Driven off the unrounded shaped level (not shapedPct) so the ramp
      // starts exactly at HOT_START rather than snapping in 1%-wide steps.
      const wash = washColor(shaped);
      if (wash !== lastWash) {
        inputCard.el.style.setProperty("--wash", wash);
        lastWash = wash;
      }

      // The strip's raw feed shows the mic as-is; the default processed feed
      // is the exact same sensitivity+expansion pipeline the render path
      // applies before scene.render() (see applySensitivity in app.ts) — so
      // it always shows literally what the visuals are reacting to. The
      // ghost is that same pipeline over the pre-fader frame, and it goes in
      // first: applySensitivity hands back one shared scratch buffer off its
      // fast path, so the ghost must be copied into the strip before the
      // second call overwrites it.
      spectrumStrip.setGhost(ungained ? applySensitivity(ungained, sensitivity, expansion).bands : null);
      spectrumStrip.setPinned(pinnedBands);
      const processedBands = frame ? applySensitivity(frame, sensitivity, expansion).bands : null;
      spectrumStrip.update(rawBands, processedBands);
      // The Frequencies overlay draws on this same strip's own canvas (no
      // second one — see bandLineEditor.ts's header) and reads this same
      // tick's live excess, unthrottled like the strip above (a beat
      // driving the line should feel as live as the meters it's shaping).
      // Skipped entirely while lineMode is unset or the Bands card is
      // folded — a folded card has nothing to show it on (the meters' own
      // cards skip the same way).
      const nowMs = performance.now();
      if (lineMode && !bandsCard.fold?.isFolded()) {
        lineEditor.update(drives?.excess(lineMode.spec.key) ?? null);
      }
      // Sparklines: every drive row's own `valueOf()`, drawn at ~30 Hz — the
      // pinned row's output graph (if it has one) rides the same tick.
      // Skipped while the Scene card is folded or there's nothing to read
      // yet — canvas draws only, never a DOM rebuild.
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

      // Picture: the Overall trace plus one compact trace per measure of the
      // finished frame's own intensity (src/render/pictureMeter.ts) — drawn every tick, same
      // reasoning as the sparklines above (canvas draws are cheap; a DOM
      // write is what's throttled). deps.getPictureReading() is null
      // whenever the meter's gone stale, which a null level draws as a gap
      // in the trace and "--" in the readout, same as every other meter row.
      leashGauge.draw({
        normal: deps.getSceneMaster() / SCENE_MASTER_MAX,
        expansion: deps.getSceneExpansion(),
        excursion: drives?.masterExcursion() ?? null,
      });

      const pictureReading = deps.getPictureReading();
      const pictureTextDue = nowMs - lastPictureTextMs >= PICTURE_TEXT_REFRESH_MS;
      if (pictureTextDue) lastPictureTextMs = nowMs;
      const pictureLevels = pictureRows.map((row) =>
        displayLevel(row.measure, pictureReading ? pictureReading[row.measure.key] : null),
      );
      const pictureOverall = overallLevel(pictureLevels);
      pictureSummaryStrip.push([...pictureLevels, pictureOverall], nowMs);
      pictureSummaryStrip.draw();
      if (pictureTextDue) {
        const text = pictureOverall === null ? "--" : String(Math.round(pictureOverall * 100));
        if (text !== pictureSummaryText) {
          pictureSummaryText = text;
          pictureSummaryReadout.textContent = text;
          pictureSummaryReadout.style.cssText = text === "--" ? pictureReadoutTextStyle : pictureReadoutDigitsStyle;
        }
      }
      pictureRows.forEach((row, i) => {
        const level = pictureLevels[i]!;
        // Folded rows still record (see the Picture block's comment); they
        // only skip the redraw and the readout nobody can see.
        row.strip.push([level], nowMs);
        if (!pictureOpen) return;
        row.strip.draw();
        if (!pictureTextDue) return;
        const text = level === null ? "--" : String(Math.round(level * 100));
        if (text === row.lastText) return;
        row.lastText = text;
        row.readout.textContent = text;
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
      // The gate rows ease continuously while their own auto is on, same as
      // Auto-gain above — without this they'd only ever show the value they
      // had when the row was last touched.
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
      // The pinned setting's patch panel — re-synced here rather than every
      // tick, same reasoning as every other refreshAuto() above (an
      // external change, e.g. a paired device's own command, could move the
      // pinned setting's patch without a click here). Compared by value, not
      // just presence, so an unrelated 100ms tick never rebuilds a panel the
      // user might have a pointer down on (this file's own carried
      // click-loss rule).
      if (pinned?.spec.drive) {
        const current = deps.getDriveSetting(pinned.sceneId, pinned.spec);
        if (!sameDriveSetting(current, lastPinnedSetting ?? "scene")) patchChanged(pinned.sceneId, pinned.spec);
      }
    },
  };
}
