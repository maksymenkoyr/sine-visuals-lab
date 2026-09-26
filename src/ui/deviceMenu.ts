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
  SCENE_MASTER_DEFAULT,
  SCENE_MASTER_MAX,
  SCENE_MASTER_MIN,
  type SceneSetting,
} from "../render/sceneSettings.ts";
import type { SceneLook } from "../render/sceneLooks.ts";
import { createLooksCard } from "./looksCard.ts";
import { AUTO_STRENGTH_DEFAULT, AUTO_STRENGTH_MIN, AUTO_STRENGTH_MAX } from "../render/autoTune.ts";
import { SIGNALS, type SignalId, type SignalSpec } from "../render/signals.ts";
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
import type { HitShape } from "../audio/hitStrength.ts";
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
import { createBandFaders } from "./bandFaders.ts";
import { createBandLineEditor } from "./bandLineEditor.ts";
import { createAudioMeters, createMeterRow } from "./audioMeters.ts";
import { createJack, setRowFed, type JackHandle } from "./jack.ts";
import { createCableLayer, type CableGroupSpec, type CableSourceSpec } from "./cableLayer.ts";
import { createPowerCard, type PowerStatus } from "./powerCard.ts";
import { isFolded, setFolded, METERS_COLUMN } from "./panelFolds.ts";
import type { PowerMode } from "../render/powerMode.ts";
import type { QualityChoice } from "../render/qualityPref.ts";
import { DISPLAY_SHARE_GUIDE, type AudioSourceChoice, type SourceState } from "../audio/sourcePref.ts";
import type { AnimFrame } from "../render/animClock.ts";
import {
  AUTO_SKY,
  BANDS_AMBER,
  FONT_LABEL,
  FONT_MONO,
  GLASS_FILTER,
  HAIRLINE,
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
  paletteChipLitStyle,
  paletteChipStyle,
  paletteListStyle,
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
 * controls column anchored top-right alongside Power, whose cards run Auto
 * strength (with the Auto master block welded to it) → Input
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
 * and expands its patch panel inline in the row, below the sparkline; the
 * slider alone never pins, only previews, so dragging an amount can't
 * accidentally swap which panel is open. Escape, clicking the pinned row's
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
 * Jacks and cables (Phase 2b) are how a meter actually gets plugged in.
 * Every reactive meter row/lane — audioMeters.ts's own (Rhythm/Signal/
 * Character) plus this file's own Bands level rows (BAND_LEVEL_CHOICES) and
 * its Frequencies corner (mountBandsJack) — grows a jack (src/ui/jack.ts): a
 * ring in its source's colour, filled when it feeds the shown (preview ??
 * pinned) setting, with tiny usage dots for how many of this scene's
 * settings use it. Clicking one with a pinned setting toggles it into that
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
 * (cableLayer.tick, flow speed off each source's own live value).
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
 * this file's own "cover everything with hints" pass): a `title` (the
 * browser's native delayed tooltip, and an `aria-description` alongside it
 * for a screen reader) and a `data-hint` the panel's own bottom hint line
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
 * The Bands card is plain again: scene name, audio source, the live bars
 * with the band faders drawn over them (src/ui/bandFaders.ts) — always
 * showing its knobs and readouts, *except* while the pinned setting's patch
 * has a source on Frequencies, when the strip swaps to that line's drawing
 * overlay (src/ui/bandLineEditor.ts, backed by src/audio/bandLine.ts;
 * refreshLineMode derives this from the pinned patch, not from focus). Under
 * the Bands card, the read-only meters (audioMeters.ts) scroll in their own
 * strip. Below the breakpoint in controlsTheme.ts everything stacks into one
 * scrolling column with the meters last, so the knobs stay in reach. It's
 * corner-docked, not a modal: the whole point is to watch the scene react
 * while you tune it, so it also stays open across palette taps.
 *
 * Every card in that left column — Power, Bands, and each meter card —
 * collapses to just its title bar (createCard's foldId, controlsKit.ts):
 * click the chevron or anywhere on the header outside a Reset-style chip.
 * The Bands+meters column can also go away at once — "Hide meters" in the
 * footer strip, or M — which leaves Power and the controls where they are
 * rather than reflowing anything. Separately, once every card in Power and
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
 * Row grammar (createControlRow, exported for audioMeters.ts's Hit strength
 * card to reuse directly rather than duplicate; most meter rows instead
 * follow the same grammar with a meter in the slider's place — the shared
 * pieces live in controlsKit.ts): label · seven-segment readout + unit ·
 * "A" chip · "T" chip · ↺. The A chip *is* the auto indicator — filled when
 * auto owns the value, outlined when the user has taken the row manual,
 * absent when the setting has no auto weights (see autoTune.ts). The T chip
 * mutes the row to its floor (0 for a zeroAtMin row, spec.min otherwise) and
 * restores the value it had on a second press; any other write to the row
 * (drag, ↺, a card Reset, auto taking over) forgets that restore point and
 * unlights it — it's a toggle, not a memory. ↺ only appears once a value is
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
 * Keyboard layer, live only while the panel is open (see onKeyDown): H
 * closes it, M hides/shows the meters column. Tab / Shift+Tab walk a ring over every
 * .vc-slider/.vc-toggle/.vc-picker/.vc-fader in document order, wrapping at both ends
 * and skipping every chip and button — so Tab alone never leaves the panel
 * and never lands anywhere but a control. On whichever control has focus, A
 * toggles auto, R resets, T mutes/restores (see above; a fader's arrow keys
 * are its own, in bandFaders.ts). A focused
 * slider also takes Home/End to its min/max — the browser's own native
 * range-input behavior, left alone by onKeyDown below — plus z/x/c
 * (wireSliderQuickJump) to jump straight to the middle of the track, the
 * top, or wherever the pointer last hovered along it. Digit
 * keys 1-9 jump to a numbered block —
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
export interface AudioStatus {
  source: AudioSource;
  /** The local AudioContext's rate, when there is one. */
  sampleRate: number | null;
}

export interface DeviceMenuDeps {
  getPalettes: () => MenuItem[];
  currentSceneId: () => string;
  currentSceneName: () => string;
  currentPaletteId: () => string;
  onPickPalette: (id: string) => void;
  /** Shown in the Bands card's status line — where the bars are coming from. */
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
  /** Whether this browser can offer the Screen option at all — see
   *  sourcePref.ts's header for the exact browser/OS matrix. */
  canCaptureDisplay: () => boolean;
  getSensitivity: (sceneId: string) => number;
  onSensitivityChange: (sceneId: string, value: number) => void;
  getExpansion: (sceneId: string) => number;
  onExpansionChange: (sceneId: string, value: number) => void;
  getSmoothing: (sceneId: string) => number;
  onSmoothingChange: (sceneId: string, value: number) => void;
  /** Empty for scenes with nothing to tune — the card hides itself. */
  getSceneSettings: (sceneId: string) => SceneSetting[];
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
  onResetDriveSetting: (sceneId: string, spec: SceneSetting) => void;
  onTogglePatchSource: (sceneId: string, spec: SceneSetting, choice: DriveSourceChoice) => void;
  onSetSourceWeight: (sceneId: string, spec: SceneSetting, choice: DriveSourceChoice, weight: number) => void;
  onSetSourceHeight: (sceneId: string, spec: SceneSetting, choice: DriveSourceChoice, height: HitHeight) => void;
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
  setDriveLineStrength: (sceneId: string, spec: SceneSetting, value: number) => void;
  /** The Loudness card's Reset chip — starts the integrated LUFS reading
   *  over (src/audio/lufsAnalyser.ts). */
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
  getAutoStrength: () => number;
  onAutoStrengthChange: (value: number) => void;
  /** The device-wide scene master (sceneSettings.ts's getSceneMaster) — one
   *  dial over every numeric scene param, resolved in autoTune.ts's
   *  resolveSceneSetting. Device-local like getAutoStrength above, so it is
   *  neither captured in a Look nor sent to the TV. */
  getSceneMaster: () => number;
  onSceneMasterChange: (value: number) => void;
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
  /** The Hit strength card's four sliders (src/audio/hitStrength.ts) — see
   *  audioMeters.ts's AudioMetersDeps.hitShape. Global per device, like
   *  getSilenceGate above, not per scene: how a hit's stand-out and
   *  loudness should blend into its pulse height is a taste about
   *  detection itself, not one scene's look. */
  getHitShape: () => HitShape;
  setHitShape: (partial: Partial<HitShape>) => void;
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
  /** The button that opens this menu — excluded from the tap-outside-to-close
   *  check, and ringed (aria-pressed) while the panel is open. */
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
   *  (the Loudness card hides itself). `rateScale` is app.ts's
   *  already-resolved sensitivity.ts's smoothingRateScale for this tick's
   *  Smoothing value — forwarded to the meters so their own BPM settle and
   *  waveform peak-hold bypass at Smoothing's Off stop the same way the rest
   *  of the pipeline does; not re-resolved here, since resolveSmoothing()
   *  slews its auto value and this runs every rAF tick. `beatDiag` is
   *  FeatureExtractor.onsetDiag, null on the same paths as `fixedEnergy`.
   *  `gate` is this device's own SilenceGateReading (src/audio/silenceGate.ts)
   *  — app.ts's `lastGate` — null on the same paths as `fixedEnergy`, for the
   *  Gate card. `drives` is this tick's SceneDrives (src/render/drives.ts),
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
}

// ---- styles --------------------------------------------------------------
// Layout-level rules (columns, slider, hint reveal, toggle) are class rules in
// controlsTheme.ts; the card and row-head grammar shared with the meters is
// in controlsKit.ts; everything else per-element is inline here, in the same
// cssText-constant convention as the rest of src/ui/.

// "A" chip: filled when auto owns the row, outlined when the user does.
const autoChipBaseStyle = `
  width: 17px; height: 16px; display: grid; place-items: center; border-radius: 3px;
  font: 500 9.5px/1 ${FONT_MONO}; cursor: pointer; padding: 0; flex-shrink: 0;
`;
const autoChipLitStyle = (accent: string) =>
  `${autoChipBaseStyle} background: ${accent}; border: 1px solid ${accent}; color: #070a09;`;
const autoChipManualStyle = (accent: string) =>
  `${autoChipBaseStyle} background: transparent; border: 1px solid ${withAlpha(accent, 0.7)}; color: ${accent};`;
// "T" chip: mutes the row to its floor and back (see the header comment).
// Shares the A chip's geometry; filled in a neutral tone rather than the
// row's accent since "muted" is a state, not one of the per-card systems.
const offChipLitStyle = `${autoChipBaseStyle} background: rgba(255,255,255,0.82); border: 1px solid rgba(255,255,255,0.82); color: #070a09;`;
const offChipManualStyle = (accent: string) =>
  `${autoChipBaseStyle} background: transparent; border: 1px solid ${withAlpha(accent, 0.7)}; color: ${accent};`;
const AUTO_HOLDING_HINT = "Auto is holding this — drag to take over";
const AUTO_STRENGTH_HINT = "How hard auto pushes every A control";

// Auto strength card + the master block welded to its right.
const autoRowStyle = `display: flex; gap: 4px; align-items: stretch;`;
const autoMasterBaseStyle = `
  width: 74px; flex-shrink: 0; display: grid; place-items: center; text-align: center;
  cursor: pointer; padding: 0; border-radius: 3px;
  -webkit-backdrop-filter: ${GLASS_FILTER}; backdrop-filter: ${GLASS_FILTER};
`;
const autoMasterStyle = `${autoMasterBaseStyle} background: rgba(8,11,10,0.2); border: 1px solid ${withAlpha(AUTO_SKY, 0.3)};`;
const autoMasterLitStyle = `${autoMasterBaseStyle} background: ${withAlpha("#1479b0", 0.28)}; border: 1px solid ${withAlpha(AUTO_SKY, 0.6)};`;
const autoMasterLabelStyle = (lit: boolean) =>
  `font: 500 13px/1.2 ${FONT_LABEL}; color: ${lit ? "#a0e7ff" : "rgba(255,255,255,0.55)"};`;
const autoMasterSubStyle = (lit: boolean) =>
  `font: 400 8.5px/1.4 ${FONT_MONO}; letter-spacing: 0.14em; color: ${lit ? withAlpha("#8dccf9", 0.8) : "rgba(255,255,255,0.4)"};`;

// The Input card's own "Auto" button (see micAuto.ts's header for what
// "the whole mic" covers) — a compact, header-sized member of the
// autoMaster* family above: same lit/unlit shape, same backdrop-filtered
// pill, scaled down to sit beside a Reset chip in a card header instead of
// welded to the strength card, and given the Input card's own accent
// (INPUT_GREEN) rather than the strength card's sky blue.
const micAutoBaseStyle = `
  font: 500 9.5px/1.2 ${FONT_MONO}; letter-spacing: 0.04em; padding: 2.5px 8px;
  border-radius: 4px; cursor: pointer;
  -webkit-backdrop-filter: ${GLASS_FILTER}; backdrop-filter: ${GLASS_FILTER};
`;
const micAutoStyle = `${micAutoBaseStyle} background: rgba(8,11,10,0.2); border: 1px solid ${withAlpha(INPUT_GREEN, 0.35)}; color: rgba(255,255,255,0.55);`;
const micAutoLitStyle = `${micAutoBaseStyle} background: ${withAlpha(INPUT_GREEN, 0.28)}; border: 1px solid ${withAlpha(INPUT_GREEN, 0.7)}; color: #eafff0;`;
// Wraps the Auto button and the Reset chip in the Input card's header —
// createCard's `right` slot takes one element, not a list.
const inputCardHeaderRightStyle = `display: flex; align-items: center; gap: 6px;`;

// The Bands card's status line (scene name · live dot · audio source), under
// its title row and above the strip.
const spectrumHeaderStyle = `display: flex; align-items: center; justify-content: space-between; gap: 8px;`;
const spectrumTitleStyle = `
  font: 500 12px/1.2 ${FONT_MONO}; letter-spacing: 0.18em; text-transform: uppercase;
  color: rgba(255,255,255,0.85); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const spectrumStatusStyle = `display: flex; align-items: center; gap: 6px; flex-shrink: 0;`;
const liveDotStyle = (on: boolean) =>
  `width: 4px; height: 4px; border-radius: 50%; background: ${on ? LIVE_DOT : "rgba(255,255,255,0.3)"};`;
const statusTextStyle = `font: 400 10.5px/1 ${FONT_MONO}; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.5);`;
const hairlineStyle = `height: 1px; background: ${withAlpha(HAIRLINE, 0.45)}; margin: 8px 0 9px;`;

// The Equaliser readouts' hint — plain text, not .vc-hint: that class waits
// for hover/focus on an enclosing .vc-row, and this line has no row of its
// own to wait on (it's always on screen alongside the readouts, not tucked
// under a control someone has to find).
const eqHintStyle = `font: 400 11px/1.5 ${FONT_LABEL}; color: rgba(255,255,255,0.5); margin-top: 6px;`;
const FADER_HINT_TEXT =
  "Drag a knob up to boost a band, down to cut it. Pin a reactive setting to plug meters into it.";

// ---- The patch bay (a drive row's port/summary/sparkline, and its pinned
// patch panel) — see this file's own header doc-comment paragraph. Every
// colour/label comes from src/ui/driveSources.ts; this is only layout.

// createControlRow's own drivePanel slot: the label + summary wrapper that
// pins on click. Stacked (label, then the summary on its own line) rather
// than side by side — inline, the summary had nowhere left to grow in the
// narrow controls column and ellipsized to unreadable ("Scene mix: bas…")
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


// Footer strip.
const footerStyle = `
  display: flex; align-items: center; justify-content: space-between; padding: 7px 12px;
  background: rgba(8,11,10,0.26);
  -webkit-backdrop-filter: blur(20px) saturate(.6) brightness(.5); backdrop-filter: blur(20px) saturate(.6) brightness(.5);
  border: 1px solid rgba(255,255,255,0.13); border-radius: 3px;
  font: 400 9.5px/1.2 ${FONT_MONO}; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.5);
`;
const footerBtnsStyle = `display: flex; gap: 16px;`;
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
 *  up. The badge itself is filled in later by renumberBlocks. */
function markBlock(heading: HTMLElement): void {
  if (heading.classList.contains("vc-block")) return;
  heading.classList.add("vc-block");
  const badge = document.createElement("span");
  badge.className = "vc-block-n";
  heading.prepend(badge);
}

/** The other half of markBlock — used where a heading's block-ness depends on
 *  the active scene (the Scene card title, see renderSceneSettings). */
function unmarkBlock(heading: HTMLElement): void {
  if (!heading.classList.contains("vc-block")) return;
  heading.classList.remove("vc-block");
  heading.querySelector(".vc-block-n")?.remove();
}

// Exported so audioMeters.ts's Hit strength card (src/audio/hitStrength.ts)
// can reuse this same slider row instead of duplicating it — the meters
// panel already builds one control this way (the Rhythm card's Beat grid
// row is a picker, not a slider; see createControlRow's own doc comment for
// the row grammar this shares).
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
   *  that call individually. Omit for a row nothing else needs to hear
   *  about (every scene-setting row today). */
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
   *  triggers this row's own click-to-focus-slider handler below). Omit for
   *  a setting with no `drive`. */
  drivePanel?: {
    port: HTMLElement;
    summary: HTMLElement;
    below: HTMLElement;
    onPin: () => void;
  };
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
 *  wireHoverFocus below: ignored while typing somewhere (a range slider
 *  keeping focus after a drag is fine — that's still "in the panel", there's
 *  just nothing to type in the panel itself). */
function isTypingTarget(t: EventTarget | null): boolean {
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
 *  with no auto weights (the A key then no-ops, matching the hidden chip). */
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
        actions.auto();
        break;
      case "r":
        e.preventDefault();
        actions.reset();
        break;
      case "t":
        e.preventDefault();
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
 *  H/M/Tab/1-9, the arrows, and Home/End are all spoken for). c no-ops when
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
      spec.pin.set(value);
      display(value, false);
    }
  }

  const chip = document.createElement("button");
  chip.textContent = "A";
  chip.title = `Auto-tune ${spec.label} (A)`;
  chip.style.cssText = autoChipManualStyle(spec.accent);
  // A row with no auto weights has nothing for the chip to do — leave it out
  // rather than show a toggle that can't change anything.
  if (!spec.auto) chip.style.display = "none";

  // Mutes the row to its floor and restores it on a second press — see the
  // header comment's row-grammar paragraph for the full contract.
  const offChip = document.createElement("button");
  offChip.textContent = "T";
  offChip.title = `Turn ${spec.label} off (T)`;
  offChip.style.cssText = offChipManualStyle(spec.accent);

  // visibility (not display) keeps the row from reflowing while dragging.
  const resetBtn = document.createElement("button");
  resetBtn.textContent = "↺";
  resetBtn.title = `Reset ${spec.label} (R)`;
  resetBtn.style.cssText = rowResetStyle;

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
  hintDesc.textContent = spec.description ?? "";
  const hintAuto = document.createElement("div");
  hintAuto.className = "vc-hint-auto";
  hintAuto.textContent = AUTO_HOLDING_HINT;
  hint.append(hintDesc, hintAuto);

  el.append(head, slider, hint);
  if (signalIndicator) el.appendChild(signalIndicator.strip);
  if (spec.drivePanel) el.appendChild(spec.drivePanel.below);
  el.addEventListener("click", () => slider.focus());
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

  function setReadout(value: number): void {
    if (spec.zeroAtMin && value <= 0) {
      digits.textContent = "Off";
      digits.style.cssText = digitsTextStyle;
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

  function display(value: number, auto: boolean): void {
    lastValue = value;
    const sliderValue = valueToSlider(value);
    slider.value = String(sliderValue);
    const lo = Number(slider.min);
    const hi = Number(slider.max);
    const pct = hi > lo ? ((sliderValue - lo) / (hi - lo)) * 100 : 0;
    slider.style.setProperty("--vc-fill", `${Math.max(0, Math.min(100, pct))}%`);
    setReadout(value);
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

  // Non-null while the row is muted (T pressed) — the value to restore on the
  // next T. Any write to the row that isn't the mute/restore itself forgets
  // this, via clearOff(), so the chip never claims a restore point that no
  // longer means anything.
  let offStoredValue: number | null = null;
  function refreshOffChip(): void {
    offChip.style.cssText = offStoredValue !== null ? offChipLitStyle : offChipManualStyle(spec.accent);
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
     *  this row's own resetBtn. */
    clearOff,
    /** Show whatever's right for the row now: the live auto value if auto
     *  owns it (resolveLive() already reflects a pin ahead of auto — see
     *  autoTune.ts's resolve() — so no separate check is needed there), a
     *  pin ahead of the manual store otherwise. */
    sync(manualValue: () => number): void {
      refreshChip();
      if (spec.auto && spec.auto.isEnabled()) display(spec.auto.resolveLive(), true);
      else display(spec.pin?.get() ?? manualValue(), false);
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
  };
}

interface ToggleRowSpec {
  label: string;
  accent: string;
  defaultValue: number;
  description?: string;
  get: () => number;
  set: (value: number) => void;
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
  right.append(readout, resetBtn);
  head.append(label, right);

  const toggle = document.createElement("button");
  toggle.className = "vc-toggle";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-label", spec.label);
  el.style.setProperty("--vc-accent", spec.accent);

  const hint = document.createElement("div");
  hint.className = "vc-hint";
  hint.textContent = spec.description ?? "";
  if (!spec.description) hint.style.display = "none";

  el.append(head, toggle, hint);
  el.addEventListener("click", () => toggle.focus());
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
  // the digit-block keyboard jump (renumberBlocks/markBlock): its only
  // controls are plain chip buttons, outside the .vc-slider/.vc-toggle/
  // .vc-fader Tab ring, the same as the palette chips they're modeled on.
  const powerCard = createPowerCard({
    getPowerMode: deps.getPowerMode,
    onPowerModeChange: deps.onPowerModeChange,
    getQualityChoice: deps.getQualityChoice,
    onQualityChoiceChange: deps.onQualityChoiceChange,
    getPowerStatus: deps.getPowerStatus,
  });
  const powerCol = document.createElement("div");
  powerCol.className = "vc-power-col";
  powerCol.appendChild(powerCard.el);

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

  // "Listening post": lit shows the raw mic signal exactly as it comes in —
  // no adaptive envelope (features.ts), no Bands gain. NOT "no sensitivity":
  // Sensitivity/Expansion are applied later, only on the render path
  // (applySensitivity in app.ts, after this strip is already fed) — so the
  // processed side shown here never had them either. This is a different RAW
  // chip from the meters panel's (audioMeters.ts): that one's Smoothing's Off
  // stop makes a genuine no-op; this one always differs whenever Auto-gain is
  // on, since the two sides normalize against different windows regardless
  // of Smoothing (see features.ts's autoGain doc).
  const rawChip = createChipButton("RAW", "Listening post — the raw mic signal, before the adaptive envelope and Bands gain", () => {
    spectrumStrip.setShowRaw(!spectrumStrip.showRaw());
    rawChip.style.cssText = spectrumStrip.showRaw() ? chipBtnLitStyle : chipBtnStyle;
  });
  const bandsResetChip = createChipButton("Reset", "Every fader back to 1×", () => {
    deps.onBandGainsReset(deps.currentSceneId());
    refreshBandFaders();
  });
  const bandsHeaderRight = document.createElement("div");
  bandsHeaderRight.style.cssText = rowRightStyle;
  bandsHeaderRight.append(rawChip, bandsResetChip);
  const bandsCard = createCard({
    title: "Bands",
    accent: BANDS_AMBER,
    right: bandsHeaderRight,
    foldId: "bands",
  });
  // Named for the stacked layout in controlsTheme.ts, where this card and
  // the meters strip become root items of their own.
  bandsCard.el.classList.add("vc-spectrum-card");
  markBlock(bandsCard.title);

  // Status line — plain: the scene name and whether audio is live. No tabs;
  // a drive setting's source picker now lives in its own row's pinned patch
  // panel (this file's own doc-comment paragraph), not a swap zone here.
  const spectrumHeader = document.createElement("div");
  spectrumHeader.style.cssText = spectrumHeaderStyle;
  const spectrumTitlePlain = document.createElement("span");
  spectrumTitlePlain.style.cssText = spectrumTitleStyle;
  const spectrumStatus = document.createElement("div");
  spectrumStatus.style.cssText = spectrumStatusStyle;
  const liveDot = document.createElement("div");
  liveDot.style.cssText = liveDotStyle(false);
  const statusLabel = document.createElement("div");
  statusLabel.style.cssText = statusTextStyle;
  spectrumStatus.append(liveDot, statusLabel);
  spectrumHeader.append(spectrumTitlePlain, spectrumStatus);

  const hairline = document.createElement("div");
  hairline.style.cssText = hairlineStyle;

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
  // swatch can't drift from the line).
  const spectrumLegend = createTraceLegend([
    { color: AUTO_SKY, label: "Brightness", note: "where the spectrum's energy balances" },
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

  // Always-visible equaliser readouts + hint — hidden only while the pinned
  // setting's patch has a source on Frequencies (refreshLineMode below).
  const fadersHint = document.createElement("div");
  fadersHint.style.cssText = eqHintStyle;
  fadersHint.textContent = FADER_HINT_TEXT;
  const eqLayer = document.createElement("div");
  eqLayer.append(bandFaders.readouts, fadersHint);

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
        eqLayer.style.display = "none";
      }
      lineEditor.setLine(deps.getDriveLine(lineMode.sceneId, lineMode.spec));
      lineEditor.setStrength(deps.getDriveLineStrength(lineMode.sceneId, lineMode.spec));
    } else if (lineMode) {
      lineMode = null;
      spectrumStrip.setShowFaders(true);
      lineEditor.el.style.display = "none";
      eqLayer.style.display = "";
    }
  }

  // ---- The Bands card's own jacks: the spectrum's own Frequencies corner,
  // plus BAND_LEVEL_CHOICES's own compact level rows under the strip. Built here (rather than
  // through audioMeters.ts's mountJack) since the Bands card lives in this
  // file; onJackClick/onJackHover/jackIsShown/etc. below are plain
  // (hoisted) functions in this same closure, the same ones
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
  const levelRowsWrap = document.createElement("div");
  levelRowsWrap.style.cssText = "display: flex; flex-direction: column; gap: 3px; margin-top: 6px;";
  const bandLevelRows = BAND_LEVEL_CHOICES.map((choice) => {
    const row = createMeterRow({ label: driveSourceLabel(choice), accent: driveSourceColor(choice) });
    row.el.style.padding = "2px 8px";
    row.el.style.margin = "-2px -8px";
    mountBandsJack(choice, row.right, row.el);
    levelRowsWrap.appendChild(row.el);
    return { choice, row };
  });

  bandsCard.body.append(spectrumHeader, hairline, fadersRow, levelRowsWrap, eqLayer);

  // One at a time — set by buildPatchPanel() below whenever the pinned row
  // builds an output graph, cleared by togglePin()/patchChanged() when
  // there's nothing (any more) to feed. DeviceMenu.update() calls through
  // this rather than iterating every row, since only the pinned row ever
  // has a graph.
  let activeOutputTick: ((drives: SceneDrives) => void) | null = null;

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
    tickSparkline(drives: SceneDrives, frame: FeatureFrame | null, anim: AnimFrame | null): void;
  }
  let driveRowHandles: DriveRowHandle[] = [];
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

  /** A row's own one-line source summary — every muted source is left out
   *  of the plain-language list (this file's header's Muting paragraph) and
   *  folded into one short "· N off" suffix instead, so a summary never
   *  grows a parenthetical per muted source. */
  function driveSummaryText(spec: SceneSetting, setting: DriveSetting): string {
    if (setting === "scene") {
      const label = spec.drive?.sceneLabel ?? "Scene mix";
      return label.replace(/^Scene:\s*/, "Scene mix: ");
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

  // ---- Patch-panel sub-builders — each takes the (sceneId, spec) pair and
  // whatever local data it needs, and wires its own controls straight to
  // `deps`; patchChanged() below is the one place a mutation is followed by
  // a rebuild. ----

  /** Sets a control's plain-language hint two ways at once: `title` (the
   *  browser's own delayed native tooltip, and a screen reader's
   *  accessible description) and `data-hint` (buildPatchPanel's own bottom
   *  hint line reads this off whichever control is hovered/focused right
   *  now — the "cover everything with hints" pass's one delegated
   *  mechanism, never a per-control listener). Every interactive element
   *  inside the patch panel goes through this rather than setting `title`
   *  by hand, so the two never drift apart. */
  function setHint(el: HTMLElement, text: string): void {
    el.title = text;
    el.dataset.hint = text;
  }

  const MIX_OPTIONS: { mix: DriveMix; label: string; hint: string }[] = [
    { mix: "add", label: "Add", hint: "Stack the sources: each adds its share, so together they push harder." },
    { mix: "max", label: "Strongest", hint: "Only the strongest source at each moment counts — they don't stack." },
    {
      mix: "gate",
      label: "Only when",
      hint: "Some sources play, but only while the condition is high — e.g. treble hits, only when the song is intense.",
    },
  ];

  const HEIGHT_OPTIONS: { h: HitHeight; label: string; hint: string }[] = [
    { h: "graded", label: "Graded", hint: "Each hit is as tall as how hard it hit — shaped by the Hit strength card." },
    { h: "fixed", label: "Fixed", hint: "Every hit is a full-height pulse, however quiet." },
    { h: "loud", label: "Loud", hint: "Each hit is as tall as its band was loud at that moment." },
  ];

  const ROLE_OPTIONS: { role: "plays" | "when"; label: string; hint: string }[] = [
    { role: "plays", label: "Plays", hint: "This source makes the setting move." },
    {
      role: "when",
      label: "Only when",
      hint: "A condition: the playing sources only get through while this one is high. Mark more than one and every condition has to be high at once.",
    },
  ];
  const ROLE_REFUSE_HINT = "At least one source has to play.";

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
      setHint(btn, disabled ? "Plug in a second source to gate one against the other." : opt.hint);
      btn.setAttribute("aria-description", opt.hint);
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
      btn.setAttribute("aria-description", opt.hint);
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
      btn.setAttribute("aria-description", disabled ? ROLE_REFUSE_HINT : opt.hint);
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
      btn.setAttribute("aria-description", hint);
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

  const WEIGHT_HINT = "This source's share: 0 ignores it, 1× is normal, 2× doubles it.";

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
    // (this file's own carried click-loss rule).
    rng.addEventListener("input", () => {
      const w = Number(rng.value);
      setFill(w);
      setOut(w);
      deps.onSetSourceWeight(sceneId, spec, src.choice, w);
      onLiveEdit();
    });
    wrap.append(rng, out);
    return wrap;
  }

  const MUTE_HINT_ON = "Switch this source off without unplugging it — its settings are kept.";
  const MUTE_HINT_OFF = "Switch this source back on.";

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
    setHint(removeBtn, "Unplug this source.");
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
      toggle.setAttribute("aria-expanded", "false");
      groupsHost = document.createElement("div");
      groupsHost.style.cssText = `${driveAddGroupsStyle} display: none;`;
      // A plain style toggle, not the `hidden` attribute: `driveAddGroupsStyle`
      // already sets an inline `display`, which would otherwise outrank the
      // UA stylesheet's `[hidden] { display: none }` rule and leave this
      // visible regardless of the attribute.
      let open = false;
      toggle.addEventListener("click", () => {
        open = !open;
        groupsHost.style.display = open ? "flex" : "none";
        toggle.setAttribute("aria-expanded", String(open));
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
    spec: SceneSetting,
    patch: DrivePatch,
  ): { el: HTMLElement; canvas: HTMLCanvasElement; tick: (drives: SceneDrives) => void } {
    const wrap = document.createElement("div");
    setHint(
      wrap,
      "What this setting receives over the last 4 seconds. Thin lines: each source after its weight (dashed: a condition; a muted source draws no trace). Dark: the gate was blocked. Bottom strip: lit while open. White: the result.",
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
    wrap.append(head, canvas);
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

    function draw(): void {
      const { w, h } = size;
      if (w <= 1 || h <= 1) return;
      ctx.clearRect(0, 0, w, h);
      const n = Math.min(filled, RING);
      if (n < 2) return;
      const xs = (k: number) => (k / (RING - 1)) * w;
      const ys = (v: number) => h - 3 - Math.max(0, Math.min(1, v)) * (h - 6);
      const at = (k: number) => (ringHead - RING + k + 1 + RING * 2) % RING;

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
          const y = ys(perSource[i]![idx]!);
          if (k === RING - n) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
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

    function tick(drives: SceneDrives): void {
      ringHead = (ringHead + 1) % RING;
      const src = drives.sourceValues(spec.key);
      for (let i = 0; i < perSource.length; i++) perSource[i]![ringHead] = src?.[i] ?? 0;
      const v = drives.valueOf(spec.key);
      combined[ringHead] = v;
      if (isGate) {
        let open = 1;
        let anyCondition = false;
        for (const idx of conditionIdxs) {
          if (patch.sources[idx]!.off) continue; // muted condition — excluded from the AND, same as the engine
          anyCondition = true;
          open *= smoothstep(GATE_OPEN_LOW, GATE_OPEN_HIGH, src?.[idx] ?? 0);
        }
        gateOpen[ringHead] = !anyCondition || open > 0.5 ? 1 : 0;
      }
      filled = Math.min(RING, filled + 1);
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
  ): { el: HTMLElement; outputCanvas: HTMLCanvasElement | null; tick: ((drives: SceneDrives) => void) | null } {
    const setting = deps.getDriveSetting(sceneId, spec);
    const patch: DrivePatch = setting === "scene" ? { mix: "add", sources: [] } : setting;

    const panel = document.createElement("div");
    panel.style.cssText = drivePatchPanelStyle;

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.style.cssText = driveResetLinkStyle;
    resetBtn.textContent = "Reset to scene default";
    setHint(resetBtn, `Back to what this scene does on its own: ${driveDefaultSummary(spec)}.`);
    resetBtn.addEventListener("click", () => {
      deps.onResetDriveSetting(sceneId, spec);
      patchChanged(sceneId, spec);
    });
    function refreshResetVisibility(): void {
      resetBtn.hidden = sameDriveSetting(deps.getDriveSetting(sceneId, spec), defaultDriveSetting(spec));
    }

    const head = document.createElement("div");
    head.style.cssText = drivePatchHeadStyle;
    const eyebrow = document.createElement("span");
    eyebrow.style.cssText = driveEyebrowStyle;
    eyebrow.textContent = "Receives";
    head.append(eyebrow, buildMixSeg(sceneId, spec, patch));
    panel.appendChild(head);

    const list = document.createElement("div");
    list.style.cssText = driveSrcListStyle;
    if (!patch.sources.length) {
      const empty = document.createElement("div");
      empty.style.cssText = driveEmptySrcStyle;
      // An empty patch is always "scene" (normalizeDriveSetting), so the
      // setting is playing its scene's own mix — not standing still.
      const mix = spec.drive?.sceneLabel?.replace(/^Scene:\s*/, "");
      empty.textContent = mix
        ? `Playing the scene's own mix: ${mix}. Plug in a meter to replace it.`
        : "Playing the scene's own mix. Plug in a meter to replace it.";
      list.appendChild(empty);
    }
    patch.sources.forEach((src, i) => {
      list.appendChild(buildSourceLine(sceneId, spec, patch, src, i, refreshResetVisibility));
    });
    panel.appendChild(list);
    panel.appendChild(buildAddChips(sceneId, spec, patch));

    let outputCanvas: HTMLCanvasElement | null = null;
    let tick: ((drives: SceneDrives) => void) | null = null;
    if (patch.sources.length) {
      const graph = buildOutputGraph(spec, patch);
      panel.appendChild(graph.el);
      outputCanvas = graph.canvas;
      tick = graph.tick;
    }

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
    // name chips instead of a meter's jack.
    const stacked = window.matchMedia(`(max-width: ${STACK_BELOW_PX}px)`).matches;
    const restHint = stacked ? "Add a source by name below." : "Click a meter's jack to plug it in or out.";
    const hintBar = document.createElement("div");
    hintBar.className = "vc-drive-bottom-hint";
    hintBar.textContent = restHint;
    function hintedAncestor(target: EventTarget | null): HTMLElement | null {
      return target instanceof HTMLElement ? target.closest<HTMLElement>("[data-hint]") : null;
    }
    function leftHintedAncestor(el: HTMLElement, related: EventTarget | null): boolean {
      return !(related instanceof Node) || !el.contains(related);
    }
    panel.addEventListener("pointerover", (e) => {
      const el = hintedAncestor(e.target);
      if (el) hintBar.textContent = el.dataset.hint!;
    });
    panel.addEventListener("pointerout", (e) => {
      const el = hintedAncestor(e.target);
      if (el && leftHintedAncestor(el, e.relatedTarget)) hintBar.textContent = restHint;
    });
    panel.addEventListener("focusin", (e) => {
      const el = hintedAncestor(e.target);
      if (el) hintBar.textContent = el.dataset.hint!;
    });
    panel.addEventListener("focusout", (e) => {
      const el = hintedAncestor(e.target);
      if (el && leftHintedAncestor(el, e.relatedTarget)) hintBar.textContent = restHint;
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
    const SPARK_TOOLTIP = "Live: what this setting is receiving (last 3 s). Colour shows which source is contributing most.";
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
    let sparkHead = 0;
    let sparkFilled = 0;
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
      summary.textContent = driveSummaryText(spec, setting);
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
      const xs = (k: number) => (k / (SPARK_LEN - 1)) * w;
      const ys = (v: number) => h - 1 - Math.max(0, Math.min(1, v)) * (h - 2);
      sparkCtx.lineWidth = 1.3;
      sparkCtx.lineJoin = "round";
      let runColor = "";
      for (let k = SPARK_LEN - n; k < SPARK_LEN; k++) {
        const idx = (sparkHead - SPARK_LEN + k + 1 + SPARK_LEN * 2) % SPARK_LEN;
        const col = sparkCols[idx]!;
        const px = xs(k);
        const py = ys(sparkVals[idx]!);
        if (col !== runColor) {
          if (runColor) sparkCtx.stroke();
          sparkCtx.strokeStyle = col;
          sparkCtx.beginPath();
          sparkCtx.moveTo(px, py);
          runColor = col;
        } else {
          sparkCtx.lineTo(px, py);
        }
      }
      if (runColor) sparkCtx.stroke();
    }

    function tickSparkline(drives: SceneDrives, frame: FeatureFrame | null, anim: AnimFrame | null): void {
      const setting = deps.getDriveSetting(sceneId, spec);
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
          v = best;
          col = withAlpha(driveSourceColor(bestId), 0.55);
        } else {
          // No sceneSources to approximate from — a faint flat baseline
          // rather than a literal 0 (invisible at the track's very bottom).
          v = 0.04;
          col = withAlpha(SCENE_VIOLET, 0.35);
        }
      } else {
        v = drives.valueOf(spec.key);
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
      sparkHead = (sparkHead + 1) % SPARK_LEN;
      sparkVals[sparkHead] = v;
      sparkCols[sparkHead] = col;
      sparkFilled = Math.min(SPARK_LEN, sparkFilled + 1);
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

  /** The only place a patch mutation is followed by a rebuild — every
   *  control inside buildPatchPanel() calls through here after writing to
   *  `deps`, except a weight slider's own `input` (buildWeightSlider's
   *  onLiveEdit only refreshes the reset link, never rebuilds — this file's
   *  own carried click-loss rule). */
  function patchChanged(sceneId: string, spec: SceneSetting): void {
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
    for (const h of driveRowHandles) h.refreshPin();
    // preview just went to null above — resyncs every row's own
    // .vc-drive-preview against that, since refreshPin() (above) never
    // touches it and a row other than the one just clicked could otherwise
    // be left showing a stale preview tint.
    for (const h of driveRowHandles) h.refreshPreviewLit();
    refreshLineMode();
    refreshPatchHighlight();
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
  // Beat row's jack always means "whichever one's there", never a specific
  // division.
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

  function jackDescribe(choice: DriveSourceChoice): { aria: string; title: string } {
    const name = driveSourceLabel(choice);
    const target = pinned ?? lastPreview;
    if (!target) return { aria: `${name} — pick a setting first`, title: name };
    const already = jackIsPinned(choice);
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
    const target = pinned ?? lastPreview;
    if (!target) return [line1, "Pin a setting first"];
    const line2 = jackIsPinned(choice) ? `Click to unplug from ${target.spec.label}` : `Click to plug into ${target.spec.label}`;
    return [line1, line2];
  }

  // The most recent jack toggled ON, for one recompute — buildCables below
  // consumes it to draw that one cable on rather than snapping in instantly
  // (controlsTheme.ts's vc-cable-new rule), then clears it. Set right
  // before the store write that adds it, since add-vs-remove has to be
  // known ahead of the toggle.
  let justAddedKey: string | null = null;

  function onJackClick(choice: DriveSourceChoice): void {
    const target = pinned ?? lastPreview;
    if (!target) {
      showToast("Pick a setting first");
      return;
    }
    if (!pinned) togglePin(target.sceneId, target.spec);
    const setting = deps.getDriveSetting(target.sceneId, target.spec);
    const existed = setting !== "scene" && setting.sources.some((s) => jackKey(s.choice) === jackKey(choice));
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
   *  special-case that away here. */
  function cableGroupFor(sel: { sceneId: string; spec: SceneSetting } | null): CableGroupSpec {
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
      // instead (no glow, no flow) regardless of role.
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
        });
      });
    }
    return { sources, portEl: handle.portEl };
  }

  /** Both groups cableLayer.ts's own two-path-group recompute takes — see
   *  its header and activePreview() above for why these are independent
   *  rather than one "shown" selection. */
  function cableSpecsForShown(): { pinned: CableGroupSpec; preview: CableGroupSpec } {
    const pinnedGroup = cableGroupFor(pinned);
    const previewGroup = cableGroupFor(activePreview());
    justAddedKey = null;
    return { pinned: pinnedGroup, preview: previewGroup };
  }

  let cableRecomputeQueued = false;
  function scheduleCableRecompute(): void {
    if (cableRecomputeQueued) return;
    cableRecomputeQueued = true;
    requestAnimationFrame(() => {
      cableRecomputeQueued = false;
      if (!isOpen) return;
      const { pinned: pinnedGroup, preview: previewGroup } = cableSpecsForShown();
      cableLayer.recompute(pinnedGroup, previewGroup);
    });
  }
  function refreshCableVisibility(): void {
    cableLayer.setVisible(isOpen && !narrowMQ.matches);
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
  // declared further down — observes itself once it exists). Card
  // fold/unfold piggybacks on the existing columnsWrap MutationObserver
  // (refreshColumnsFold, below); renderSceneSettings schedules one from its
  // own tail.
  const cableColumnsRO = new ResizeObserver(scheduleCableRecompute);
  cableColumnsRO.observe(spectrumCol);
  audioMeters.el.addEventListener("scroll", scheduleCableRecompute, { passive: true });
  root.addEventListener("scroll", scheduleCableRecompute, { passive: true });

  // ---- "Pick a setting first" toast ----
  const toastEl = document.createElement("div");
  toastEl.className = "vc-toast";
  toastEl.setAttribute("role", "status");
  document.body.appendChild(toastEl);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function showToast(text: string): void {
    toastEl.textContent = text;
    toastEl.classList.add("vc-toast-show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("vc-toast-show"), 2200);
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

  spectrumCol.append(bandsCard.el, audioMeters.el);

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
  // When "Hide meters" is active, Bands and the meter cards are excluded
  // from the check (isFolded(METERS_COLUMN), not an offsetParent probe —
  // that forces a synchronous layout on every class mutation in the
  // column, which stalled the panel once enough cards had folded), so
  // folding Power alone while meters are hidden also counts as "everything
  // folded".
  function refreshColumnsFold(): void {
    const cards = [...columnsWrap.querySelectorAll<HTMLElement>(".vc-card")];
    const relevant = isFolded(METERS_COLUMN) ? cards.filter((c) => c === powerCard.el) : cards;
    columnsWrap.classList.toggle(
      "vc-cols-folded",
      relevant.length > 0 && relevant.every((c) => c.classList.contains("vc-folded")),
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
  function refreshSpectrumHeader(): void {
    spectrumTitlePlain.textContent = `${deps.currentSceneName()} · Equaliser`;
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

  // Auto strength: how far auto is allowed to push a setting from its default
  // (see autoTune.ts's computeAutoTarget). Global per device.
  const autoStrengthReadout = document.createElement("div");
  autoStrengthReadout.style.cssText = readoutStyle;
  const autoStrengthDigits = document.createElement("span");
  autoStrengthDigits.style.cssText = digitsStyle;
  autoStrengthReadout.appendChild(autoStrengthDigits);
  const autoCard = createCard({ title: "Auto strength", accent: AUTO_SKY, right: autoStrengthReadout });
  markBlock(autoCard.title);
  autoCard.el.style.flex = "1";
  autoCard.el.style.minWidth = "0";
  const autoStrengthRow = document.createElement("div");
  autoStrengthRow.className = "vc-row";
  const autoStrengthSlider = document.createElement("input");
  autoStrengthSlider.type = "range";
  autoStrengthSlider.className = "vc-slider";
  autoStrengthSlider.setAttribute("aria-label", "Auto strength");
  autoStrengthSlider.min = String(AUTO_STRENGTH_MIN);
  autoStrengthSlider.max = String(AUTO_STRENGTH_MAX);
  autoStrengthSlider.step = "any";
  autoStrengthRow.style.setProperty("--vc-accent", AUTO_SKY);
  autoStrengthSlider.style.marginTop = "0";
  const autoStrengthHint = document.createElement("div");
  autoStrengthHint.className = "vc-hint";
  autoStrengthHint.textContent = AUTO_STRENGTH_HINT;
  autoStrengthRow.append(autoStrengthSlider, autoStrengthHint);
  autoCard.body.appendChild(autoStrengthRow);
  autoCard.el.style.cursor = "pointer";
  autoCard.el.addEventListener("click", () => autoStrengthSlider.focus());
  // Scoped to the row, not autoCard.el like the click handler above: click's
  // wider scope (hovering the card title still focuses the slider) is a
  // deliberate convenience, but hover-focus firing there too would mean just
  // reading the card's title steals focus onto the slider.
  wireHoverFocus(autoStrengthRow, autoStrengthSlider);
  wireThumbMagnet(autoCard.el, autoStrengthSlider);
  wireSliderQuickJump(autoStrengthRow, autoStrengthSlider);

  function showAutoStrength(value: number): void {
    autoStrengthSlider.value = String(value);
    autoStrengthSlider.style.setProperty(
      "--vc-fill",
      `${((value - AUTO_STRENGTH_MIN) / (AUTO_STRENGTH_MAX - AUTO_STRENGTH_MIN)) * 100}%`,
    );
    autoStrengthDigits.textContent = value.toFixed(2);
  }
  function refreshAutoStrengthDisplay(): void {
    showAutoStrength(deps.getAutoStrength());
  }
  autoStrengthSlider.addEventListener("input", () => {
    autoStrengthOffStored = null;
    const value = Number(autoStrengthSlider.value);
    showAutoStrength(value);
    deps.onAutoStrengthChange(value);
  });

  // The global "Auto" master switch — toggles every auto-capable row, scene
  // settings plus Sensitivity/Expansion/Smoothing (see app.ts's
  // isSceneAuto wiring). Welded to the strength card's right edge, sharing
  // its accent without being nested inside its border. Overlaps the Input
  // card's own Auto button (below, and see micAuto.ts's header) on the
  // Sensitivity/Expansion/Smoothing rows only — a scene's own settings stay
  // this button's alone — so toggling either refreshes the other's lit
  // state (see toggleAutoMaster/toggleMicAuto).
  const autoMasterBtn = document.createElement("button");
  autoMasterBtn.title = "Auto-tune everything — sensitivity, expansion, smoothing, and every scene setting";
  const autoMasterLabel = document.createElement("div");
  autoMasterLabel.textContent = "Auto";
  const autoMasterSub = document.createElement("div");
  const autoMasterInner = document.createElement("div");
  autoMasterInner.append(autoMasterLabel, autoMasterSub);
  autoMasterBtn.appendChild(autoMasterInner);

  const autoRow = document.createElement("div");
  autoRow.style.cssText = autoRowStyle;
  autoRow.append(autoCard.el, autoMasterBtn);

  // Master: one device-wide dial over every numeric scene param, multiplied
  // in at autoTune.ts's resolveSceneSetting (scaled once, never on drives,
  // enums/booleans, or the Input card's gain stages — see that doc). Sits
  // between Auto strength and Input as its own always-visible card: it is
  // not part of the auto system, and unlike the Scene card below it must
  // not disappear on a scene that declares no settings of its own — those
  // scenes simply have nothing for it to move. The Scene card's violet,
  // because what it scales is that card's contents.
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
  masterCard.body.appendChild(masterRow.el);

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
      // honest whenever a chip click could have changed it.
      onAutoToggled: refreshMicAuto,
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
      "How quickly the picture follows the sound — drag to the bottom for Off, the meters panel's RAW chip with nothing left to bypass",
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

  // Source: mic vs. captured screen/tab audio (src/audio/sourcePref.ts). Not
  // gain-mapped like the rows below, so it's not built through
  // createControlRow — a label plus a chip group where a slider would sit,
  // same pattern as powerCard.ts's Energy-saving row (its chips are outside
  // the Tab ring for the same reason: cycling through settings numbers, not
  // switching device, is what Tab is for). Sits first in the card, above
  // Auto-gain, since it decides what everything below is even listening to.
  // Deliberately left out of this card's Reset chip below, same as
  // Auto-gain and the Silence gate rows further down — that chip resets
  // per-scene taste, not a device-wide input choice — and out of inputRows,
  // since it has no Auto behavior to wire through that array's shared call
  // sites.
  const sourceListStyle = `display: flex; gap: 4px; margin-top: 4px;`;
  const sourceChipStyle = `${chipBtnStyle} flex: 1; text-align: center; padding-top: 4px; padding-bottom: 4px;`;
  // Live = green border + green tint, the same INPUT_GREEN language as the
  // gallery masthead's .gal-src[data-state="live"] and this row's own accent
  // (--vc-accent, set below) — echoing "listening now" in the same colour on
  // both surfaces rather than the generic white "lit" chip look every other
  // enum picker in this panel uses.
  const sourceChipLiveStyle = `${chipBtnStyle} flex: 1; text-align: center; padding-top: 4px; padding-bottom: 4px; border-color: ${withAlpha(INPUT_GREEN, 0.7)}; background: ${withAlpha(INPUT_GREEN, 0.12)}; color: #fff;`;
  // The chip's status dot — same status-light idiom as the gallery's
  // .gal-src-dot, one small element whose border/fill swaps with the same
  // two states as the chip itself (idle/live) in refresh() below.
  const sourceDotStyle = `display: inline-block; width: 6px; height: 6px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.45); box-sizing: border-box; margin-right: 6px; vertical-align: middle;`;
  const sourceDotLiveStyle = `${sourceDotStyle} background: ${INPUT_GREEN}; border-color: ${INPUT_GREEN};`;
  // Always visible while Screen is the active source, not a .vc-hint: the hint
  // only reveals on hover/focus, and on touch that means after the tap that
  // already opened the picker — too late to be a guide. Same reasoning as
  // createTraceLegend's always-on comment in controlsKit.ts.
  const sourceGuideStyle = `margin-top: 6px; font: 400 11px/1.45 ${FONT_LABEL}; color: rgba(255,255,255,0.55);`;
  // Same always-on reasoning as sourceGuideStyle just above — the status line
  // built from this state (refresh() below) is the row's answer to "which
  // one is picked and is it actually listening", so it can't be hover-gated
  // either. Per-option description now lives only in the chip's title
  // tooltip (SOURCE_OPTIONS.title) rather than duplicated here. No inline
  // color: the .vc-src-status class (controlsTheme.ts) owns it instead, so
  // its [data-prompting] shimmer override — set in refresh() below — can
  // actually win; an inline color here would beat any class rule regardless
  // of specificity.
  const sourceStatusStyle = `margin-top: 6px; font: 400 11px/1.45 ${FONT_LABEL};`;
  const SOURCE_OPTIONS: { choice: AudioSourceChoice; text: string; title: string }[] = [
    { choice: "mic", text: "Mic", title: "The room's microphone" },
    {
      choice: "display",
      text: "Screen",
      title: "A shared screen or tab's audio — cleaner than the room mic",
    },
  ];
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

    const list = document.createElement("div");
    list.style.cssText = sourceListStyle;
    const buttons = SOURCE_OPTIONS.map((opt) => {
      const btn = document.createElement("button");
      btn.title = opt.title;
      btn.style.cssText = sourceChipStyle;
      const dot = document.createElement("span");
      dot.style.cssText = sourceDotStyle;
      btn.append(dot, document.createTextNode(opt.text));
      btn.addEventListener("click", () => deps.onAudioSourceChange(opt.choice));
      return { choice: opt.choice, btn, dot };
    });
    list.append(...buttons.map((b) => b.btn));

    const guide = document.createElement("div");
    guide.style.cssText = sourceGuideStyle;
    guide.textContent = DISPLAY_SHARE_GUIDE;

    const status = document.createElement("div");
    status.className = "vc-src-status";
    status.style.cssText = sourceStatusStyle;

    el.append(head, list, guide, status);

    return {
      el,
      refresh(): void {
        const state = deps.getSourceState();
        el.style.display = state === null ? "none" : "";
        if (state === null) return;
        const canDisplay = deps.canCaptureDisplay();
        for (const { choice: c, btn, dot } of buttons) {
          // Live is the only state a chip ever paints — a stored preference
          // or a granted mic permission never highlights a chip on its own
          // (see SourceState's doc comment in sourcePref.ts).
          const isLive = c === state.choice && state.live;
          btn.style.cssText = isLive ? sourceChipLiveStyle : sourceChipStyle;
          dot.style.cssText = isLive ? sourceDotLiveStyle : sourceDotStyle;
          btn.hidden = c === "display" && !canDisplay;
        }
        guide.style.display = state.choice === "display" ? "" : "none";
        // See .vc-src-status[data-prompting] (controlsTheme.ts) for the
        // shimmer this drives while nothing's live yet.
        status.toggleAttribute("data-prompting", !state.live);
        const name = SOURCE_OPTIONS.find((o) => o.choice === state.choice)?.text ?? "";
        status.textContent = state.live ? `${name} — listening` : "Pick a source above";
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
  // slowly (autoGain.ts's EASE_RATE) so the Signal card's history trace
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
      "Quieter than this on the Signal card's Level, the room counts as silent and no beat can fire. All the way down turns the gate off.",
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
        row.setValue(defaultValue);
        row.refreshChip();
        row.clearOff();
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
  // What the per-tick loop and the auto refresh need from a scene row — a
  // slider row (createControlRow) satisfies it as is; an enum picker with
  // `reads` supplies its own pair (see appendSettingRow).
  interface SceneRowHandle {
    updateSignalPills(frame: FeatureFrame | null, anim: AnimFrame | null): void;
    refreshAuto(): void;
  }
  let sceneRowHandles: SceneRowHandle[] = [];

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
  // itself.
  function appendSettingRow(container: HTMLElement, sceneId: string, spec: SceneSetting, specs: SceneSetting[]): void {
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
    // before the timer fires (onRowFocusOut below) — together these are
    // what let a fast sweep across several rows toward the spectrum strip
    // leave the starting preview alone. Keyboard/click focus (not
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

    /** Cancels this row's own still-pending hover preview if focus leaves
     *  it for somewhere that never calls onRowFocusIn at all (the spectrum
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
            SCENE_VIOLET,
          )
        : undefined;
      const picker = createPickerRow({
        label: spec.label,
        accent: SCENE_VIOLET,
        options: spec.options,
        defaultValue: deps.getSceneSettingDefault(sceneId, spec),
        description: spec.description,
        get: () => deps.getSceneSettingValue(sceneId, spec),
        set: (value) => {
          deps.onSceneSettingChange(sceneId, spec, value);
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
      const toggleEl = createToggleRow({
        label: spec.label,
        accent: SCENE_VIOLET,
        defaultValue: deps.getSceneSettingDefault(sceneId, spec),
        description: spec.description,
        get: () => deps.getSceneSettingValue(sceneId, spec),
        set: (value) => deps.onSceneSettingChange(sceneId, spec, value),
      });
      wirePreviewFocus(toggleEl);
      container.appendChild(toggleEl);
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
      accent: SCENE_VIOLET,
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
            toggle: (on) => deps.onSettingAutoToggle(sceneId, spec, on),
            resolveLive: () => deps.resolveSceneSettingValue(sceneId, spec),
            getManual: () => deps.getSceneSettingValue(sceneId, spec),
          }
        : undefined,
      pin: pinConfig(() => sceneId, spec.key, () => deps.resolveSceneSettingValue(sceneId, spec)),
      reads,
      drivePanel: driveBuild
        ? { port: driveBuild.port, summary: driveBuild.summary, below: driveBuild.below, onPin: () => togglePin(sceneId, spec) }
        : undefined,
    });
    row.onChange((value) => deps.onSceneSettingChange(sceneId, spec, value));
    row.sync(() => deps.getSceneSettingValue(sceneId, spec));
    wirePreviewFocus(row.el);
    container.appendChild(row.el);
    sceneRowHandles.push(row);
    if (driveBuild) driveRowHandles.push(driveBuild.bind(row.el));
    wireBandHighlight(row.el, reads);
  }

  function renderSceneSettings(): void {
    const sceneId = deps.currentSceneId();
    const specs = deps.getSceneSettings(sceneId);
    sceneRows.innerHTML = "";
    sceneRowHandles = [];
    for (const c of driveSparkCanvases) untrackDriveCanvas(c);
    driveSparkCanvases = [];
    driveRowHandles = [];
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
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
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
      appendSettingRow(sceneRows, sceneId, spec, specs);
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
      const stillHere = driveRowHandles.find((r) => r.sceneId === pinned!.sceneId && r.spec.key === pinned!.spec.key);
      if (stillHere) stillHere.refreshPin();
      else {
        pinned = null;
        lastPinnedSetting = null;
      }
    }
    // A jack click with nothing pinned reaches for lastPreview — drop it on
    // a genuine scene switch, same reasoning as the pinned check above,
    // rather than let a jack click quietly pin a setting on the scene that
    // was just left.
    if (lastPreview && lastPreview.sceneId !== sceneId) lastPreview = null;
    refreshLineMode();
    refreshPatchHighlight();
  }

  // Palette: the only picker left in the panel.
  const paletteCard = createCard({ title: "Palette", accent: "rgba(255,255,255,0.7)" });
  const paletteList = document.createElement("div");
  paletteList.style.cssText = paletteListStyle;
  paletteCard.body.appendChild(paletteList);

  function renderPalettes(): void {
    paletteList.innerHTML = "";
    const currentId = deps.currentPaletteId();
    for (const item of deps.getPalettes()) {
      const btn = document.createElement("button");
      btn.textContent = item.name;
      btn.style.cssText = item.id === currentId ? paletteChipLitStyle : paletteChipStyle;
      btn.addEventListener("click", () => {
        deps.onPickPalette(item.id);
        // Stay open — the scene isn't hidden behind a backdrop, so tapping
        // through palettes to watch the scene recolor is the point.
        renderPalettes();
      });
      paletteList.appendChild(btn);
    }
  }

  // Footer strip: auto state at a glance, the meters column's on/off, and a
  // way out. The column toggle lives here, in the column that never hides,
  // rather than above Bands: a chip up there had to be its own row, which
  // pushed the whole column down out of line with Power and Auto strength.
  const footer = document.createElement("div");
  footer.style.cssText = footerStyle;
  const footerStatus = document.createElement("span");
  const footerBtns = document.createElement("span");
  footerBtns.style.cssText = footerBtnsStyle;
  const metersBtn = document.createElement("button");
  metersBtn.style.cssText = footerBtnStyle;
  metersBtn.addEventListener("click", () => setMetersHidden(!isFolded(METERS_COLUMN)));
  const hideBtn = document.createElement("button");
  hideBtn.textContent = "Hide UI  H";
  hideBtn.title = "Close the panel (H)";
  hideBtn.style.cssText = footerBtnStyle;
  hideBtn.addEventListener("click", () => close());
  footerBtns.append(metersBtn, hideBtn);
  footer.append(footerStatus, footerBtns);

  function setMetersHidden(hidden: boolean): void {
    setFolded(METERS_COLUMN, hidden);
    root.classList.toggle("vc-meters-hidden", hidden);
    metersBtn.textContent = hidden ? "Show meters  M" : "Hide meters  M";
    metersBtn.title = hidden
      ? "Bring back the Bands card and the meters (M)"
      : "Hide the Bands card and the meters, keep the controls (M)";
    // Hiding/showing the column changes which cards have a layout box
    // without touching any card's own vc-folded class, so the observer
    // above never fires for it on its own — recompute here instead.
    refreshColumnsFold();
  }
  setMetersHidden(isFolded(METERS_COLUMN));

  function refreshAutoMaster(): void {
    const lit = deps.isSceneAuto(deps.currentSceneId());
    autoMasterBtn.style.cssText = lit ? autoMasterLitStyle : autoMasterStyle;
    autoMasterLabel.style.cssText = autoMasterLabelStyle(lit);
    autoMasterSub.style.cssText = autoMasterSubStyle(lit);
    autoMasterSub.textContent = lit ? "ON" : "OFF";
    footerStatus.textContent = lit ? "Auto on" : "Auto off";
  }

  // Shared by the master button's own click and the Auto strength row's A
  // hotkey (see wireRowKeys below) — the master switch *is* that block's auto
  // control, so A on the strength slider reaches for it rather than no-oping.
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
    micAutoBtn.style.cssText = lit ? micAutoLitStyle : micAutoStyle;
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

  // R/T for the strength slider itself — same reset/restore-point contract as
  // a row built through createControlRow (see the header comment), hand-
  // rolled since this one-off row isn't built through it.
  let autoStrengthOffStored: number | null = null;
  function resetAutoStrength(): void {
    autoStrengthOffStored = null;
    showAutoStrength(AUTO_STRENGTH_DEFAULT);
    deps.onAutoStrengthChange(AUTO_STRENGTH_DEFAULT);
  }
  function toggleAutoStrengthOff(): void {
    if (autoStrengthOffStored !== null) {
      const restore = autoStrengthOffStored;
      autoStrengthOffStored = null;
      showAutoStrength(restore);
      deps.onAutoStrengthChange(restore);
    } else {
      autoStrengthOffStored = Number(autoStrengthSlider.value);
      showAutoStrength(AUTO_STRENGTH_MIN);
      deps.onAutoStrengthChange(AUTO_STRENGTH_MIN);
    }
  }
  wireRowKeys(autoStrengthSlider, {
    auto: toggleAutoMaster,
    reset: resetAutoStrength,
    toggleOff: toggleAutoStrengthOff,
  });

  controlsCol.append(autoRow, masterCard.el, inputCard.el, sceneCard.el, looksCard.el, paletteCard.el, footer);
  root.append(columnsWrap, controlsCol);
  document.body.appendChild(root);

  // ---- open / close ----
  let isOpen = false;

  // With no full-screen backdrop to catch outside taps, listen on the document
  // instead. The toggle button is excluded: pointerdown fires before click, so
  // without this guard a gear tap would close the panel here and then the
  // button's own click handler would immediately reopen it.
  function onDocPointerDown(e: PointerEvent) {
    const t = e.target as Node | null;
    if (t && (root.contains(t) || deps.toggleButton.contains(t))) return;
    close();
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
  function ringElements(): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(".vc-slider, .vc-toggle, .vc-picker, .vc-fader")].filter(
      (el) => el.getClientRects().length > 0,
    );
  }

  function handleTab(e: KeyboardEvent): void {
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
      close();
      return;
    }
    if (e.key === "m" || e.key === "M") {
      setMetersHidden(!isFolded(METERS_COLUMN));
      return;
    }
    if (e.key === "Tab") {
      handleTab(e);
      return;
    }
    if (e.key.length === 1 && e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      jumpToBlock(Number(e.key));
    }
  }

  function open() {
    refreshSpectrumHeader();
    renderPalettes();
    sourceRow.refresh();
    syncInputRows();
    // The panel may have been closed on a different scene since `pinned`
    // was last checked — renderSceneSettings()'s own tail unpins it if so,
    // and rebuilds its patch panel for whatever's still pinned either way.
    renderSceneSettings();
    refreshBandsSplit();
    refreshBandFaders();
    refreshAutoStrengthDisplay();
    masterRow.sync(() => deps.getSceneMaster());
    root.classList.add("vc-open");
    deps.toggleButton.setAttribute("aria-pressed", "true");
    isOpen = true;
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
    refreshCableVisibility();
    scheduleCableRecompute();
  }

  function close() {
    root.classList.remove("vc-open");
    deps.toggleButton.setAttribute("aria-pressed", "false");
    isOpen = false;
    document.removeEventListener("pointerdown", onDocPointerDown);
    document.removeEventListener("keydown", onKeyDown);
    refreshCableVisibility();
    toastEl.classList.remove("vc-toast-show");
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
  const SPARKLINE_REFRESH_MS = 1000 / 30;
  let lastSparklineMs = 0;

  return {
    toggle() {
      if (isOpen) close();
      else open();
    },
    close,
    isOpen: () => isOpen,
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
      if (drives && driveRowHandles.length && !sceneCard.fold?.isFolded() && nowMs - lastSparklineMs >= SPARKLINE_REFRESH_MS) {
        lastSparklineMs = nowMs;
        for (const h of driveRowHandles) h.tickSparkline(drives, frame, anim);
        activeOutputTick?.(drives);
      }

      if (nowMs - lastAutoRefreshMs < AUTO_UI_REFRESH_MS) return;
      lastAutoRefreshMs = nowMs;

      refreshSpectrumHeader();
      powerCard.refresh();
      sourceRow.refresh();
      for (const { row } of inputRows) row.refreshAuto();
      autoGainRow.refreshAuto();
      // The gate rows ease continuously while their own auto is on, same as
      // Auto-gain above — without this they'd only ever show the value they
      // had when the row was last touched.
      silenceClosedRow.refreshAuto();
      silenceOpenRow.refreshAuto();
      for (const row of sceneRowHandles) row.refreshAuto();
      // The pinned setting's patch panel — re-synced here rather than every
      // tick, same reasoning as every other refreshAuto() above (an
      // external change, e.g. a paired device's own command, could move the
      // pinned setting's patch without a click here). Compared by value, not
      // just presence, so an unrelated 100ms tick never rebuilds a panel the
      // user might have a pointer down on (this file's own carried
      // click-loss rule).
      if (pinned) {
        const current = deps.getDriveSetting(pinned.sceneId, pinned.spec);
        if (!sameDriveSetting(current, lastPinnedSetting ?? "scene")) patchChanged(pinned.sceneId, pinned.spec);
      }
    },
  };
}
