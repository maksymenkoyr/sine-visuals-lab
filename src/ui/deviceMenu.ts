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
import type { SceneSetting } from "../render/sceneSettings.ts";
import type { SceneLook } from "../render/sceneLooks.ts";
import { createLooksCard } from "./looksCard.ts";
import { AUTO_STRENGTH_DEFAULT, AUTO_STRENGTH_MIN, AUTO_STRENGTH_MAX } from "../render/autoTune.ts";
import { SIGNALS, type SignalSpec } from "../render/signals.ts";
import { NUM_BANDS, type FeatureFrame } from "../audio/types.ts";
import { type BandSplit } from "../audio/bandSplit.ts";
import { AUTO_GAIN_DEFAULT, AUTO_GAIN_MAX, AUTO_GAIN_MIN } from "../audio/autoGain.ts";
import type { LufsReading } from "../audio/lufs.ts";
import { BAND_FADER_COUNT } from "../audio/bandGains.ts";
import { createBandFaders } from "./bandFaders.ts";
import { createAudioMeters } from "./audioMeters.ts";
import { createPowerCard, type PowerStatus } from "./powerCard.ts";
import { isFolded, setFolded, METERS_COLUMN } from "./panelFolds.ts";
import type { PowerMode } from "../render/powerMode.ts";
import type { QualityChoice } from "../render/qualityPref.ts";
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
  ensureControlsStyles,
  withAlpha,
} from "./controlsTheme.ts";
import {
  chipBtnLitStyle,
  chipBtnStyle,
  createAdvancedSection,
  createCard,
  createChipButton,
  createSignalStrip,
  createTraceLegend,
  digitsStyle,
  digitsTextStyle,
  groupHeading,
  readoutStyle,
  rowHeadStyle,
  rowLabelStyle,
  rowRightStyle,
  spacer,
  unitStyle,
} from "./controlsKit.ts";

/**
 * The controller's controls panel — the "Viz Controls" design.
 *
 * Two glass columns anchored top-right over the live scene: the Bands card
 * (scene name, audio source, and the live bars with the band faders drawn
 * over them — see src/ui/bandFaders.ts) beside the controls column, whose
 * cards run Auto strength (with the Auto master block welded to it) → Input
 * → Scene → Palette → a footer strip. Under the Bands card, the read-only
 * meters (audioMeters.ts) scroll in their own strip. Below the breakpoint
 * in controlsTheme.ts everything stacks into one scrolling column with the
 * meters last, so the knobs stay in reach. It's corner-docked, not a modal:
 * the whole point is to watch the scene react while you tune it, so it
 * also stays open across palette taps.
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
 * Row grammar (createControlRow; the meters follow it too, with a meter in
 * the slider's place — the shared pieces live in controlsKit.ts): label ·
 * seven-segment readout + unit ·
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
 * row it reads as an invitation to take over instead. Each card's accent
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
 * are its own, in bandFaders.ts). D is dev-only (DeviceMenuDeps.devDefault):
 * on a scene-setting row, it persists the row's current value as its new
 * default, so R/↺ from then on snaps back to that instead of the value
 * baked into the scene's SceneSetting spec (see tuning/defaults.ts) — a
 * production build never sets devDefault, so the key no-ops there. A focused
 * slider also takes Home/End to its min/max — the browser's own native
 * range-input behavior, left alone by onKeyDown below — plus z/x
 * (wireSliderQuickJump) to jump straight to the middle of the track or the
 * top, the one landing Home/End can't reach. Digit
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

export type AudioSource = "mic" | "remote" | "synthetic" | "none";
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
  getSensitivity: (sceneId: string) => number;
  onSensitivityChange: (sceneId: string, value: number) => void;
  getExpansion: (sceneId: string) => number;
  onExpansionChange: (sceneId: string, value: number) => void;
  getSmoothing: (sceneId: string) => number;
  onSmoothingChange: (sceneId: string, value: number) => void;
  /** Empty for scenes with nothing to tune — the card hides itself. */
  getSceneSettings: (sceneId: string) => SceneSetting[];
  getSceneSettingValue: (sceneId: string, spec: SceneSetting) => number;
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
  /** Dev-only: read/write/clear an unclamped pin for a param row (see
   *  tuning/pins.ts) — its presence is what turns a row's readout into a
   *  typable field, and its absence in a production build is what hides
   *  that affordance entirely. */
  devPin?: {
    get(sceneId: string, key: string): number | undefined;
    set(sceneId: string, key: string, value: number): void;
    clear(sceneId: string, key: string): void;
  };
  /** Dev-only: read/write a per-(scene,key) override of a scene setting's
   *  shipped default — see tuning/defaults.ts. Its presence is what turns on
   *  a scene-setting row's D hotkey ("set current value as default") and its
   *  absence in a production build hides that affordance, same as devPin
   *  above. */
  devDefault?: {
    get(sceneId: string, key: string): number | undefined;
    set(sceneId: string, key: string, value: number): void;
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
   *  isSceneAuto's per-scene exceptions, and this setting is device-global
   *  like getAutoGain above. */
  isAutoGainAuto: () => boolean;
  onAutoGainAutoToggle: (on: boolean) => void;
  resolveAutoGain: () => number;
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
   *  is the same frame before them (the strip's ghost bars); `pinned` is
   *  which bands the gain stage clamped (bandGains.ts's pinnedBands);
   *  `anim`/`mono`/`fixedEnergy`/`lufs` feed the meters (audioMeters.ts) —
   *  `fixedEnergy` is FeatureExtractor.fixedEnergy, null wherever this
   *  device isn't running its own extractor (renderer, synthetic feed);
   *  `lufs` is this device's lufsAnalyser reading, null on the same paths
   *  (the Loudness card hides itself). `rateScale` is app.ts's
   *  already-resolved sensitivity.ts's smoothingRateScale for this tick's
   *  Smoothing value — forwarded to the meters so their own BPM settle and
   *  waveform peak-hold bypass at Smoothing's Off stop the same way the rest
   *  of the pipeline does; not re-resolved here, since resolveSmoothing()
   *  slews its auto value and this runs every rAF tick. `fluxRatio` is
   *  FeatureExtractor.fluxRatio, null on the same paths as `fixedEnergy`. */
  update(
    frame: FeatureFrame | null,
    rawBands: Float32Array | null,
    ungained: FeatureFrame | null,
    pinned: Uint8Array | null,
    anim: AnimFrame | null,
    mono: Float32Array | null,
    rateScale: number,
    fixedEnergy: number | null,
    lufs: LufsReading | null,
    fluxRatio: number | null,
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
const rowResetStyle = `
  font: 400 11px/1 ${FONT_MONO}; color: rgba(255,255,255,0.45); background: none; border: none;
  padding: 0; cursor: pointer; flex-shrink: 0;
`;
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

// Palette chips.
const paletteListStyle = `display: flex; flex-wrap: wrap; gap: 4px;`;
const paletteChipStyle = `
  font: 400 10.5px/1.2 ${FONT_MONO}; letter-spacing: 0.06em; color: rgba(255,255,255,0.7);
  background: transparent; border: 1px solid rgba(255,255,255,0.18); border-radius: 4px;
  padding: 4px 8px; cursor: pointer;
`;
const paletteChipLitStyle = `${paletteChipStyle} color: #fff; background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.5);`;

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

interface ControlRowSpec {
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
  /** Dev-only: makes D (while this row's control has focus) persist the
   *  row's current value as its new default — see DeviceMenuDeps.devDefault.
   *  Omit to leave the D hotkey a no-op for this row (any prod build, or a
   *  row this affordance doesn't apply to). */
  devDefault?: {
    set(value: number): void;
  };
  /** SceneSetting.reads (sceneSettings.ts), resolved to concrete signals and
   *  callbacks by appendSettingRow below — see ResolvedSignalRead. Omit for
   *  a setting with no `reads` entries. */
  reads?: readonly ResolvedSignalRead[];
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
  actions: { auto?: () => void; reset: () => void; toggleOff: () => void; setDefault?: () => void },
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
      case "d":
        if (!actions.setDefault) return;
        e.preventDefault();
        actions.setDefault();
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
    control.focus({ preventScroll: true });
  });
}

/** z centers a focused slider, x maxes it out — a fast way to land on either
 *  without dragging. No key for the low end: Home already jumps a native
 *  range input to its min for free (onKeyDown, below, doesn't intercept it),
 *  so the only capability worth adding is the one Home/End don't cover.
 *  Plain single keys, not a chord — z/x collide with nothing else live while
 *  a slider has focus (A/R/T/D, the panel's H/M/Tab/1-9, the arrows, and
 *  Home/End are all spoken for; z/x aren't). Sets .value then redispatches
 *  "input" rather than duplicating each slider's own commit logic, so this
 *  stays a one-line addition at every call site regardless of what that
 *  site's "input" listener does. */
function wireSliderQuickJump(slider: HTMLInputElement): void {
  slider.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const frac = { z: 0.5, x: 1 }[e.key];
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
function createControlRow(spec: ControlRowSpec) {
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

  right.append(readout, chip, offChip, resetBtn);
  head.append(label, right);

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

  const hint = document.createElement("div");
  hint.className = "vc-hint";

  el.append(head, slider, hint);
  if (signalIndicator) el.appendChild(signalIndicator.strip);
  el.addEventListener("click", () => slider.focus());
  wireHoverFocus(el, slider);
  wireThumbMagnet(el, slider);
  wireSliderQuickJump(slider);

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
    const text = auto ? AUTO_HOLDING_HINT : spec.description ?? "";
    hint.textContent = text;
    hint.style.display = text ? "" : "none";
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
    });
  }

  wireRowKeys(slider, {
    auto: spec.auto ? () => chip.click() : undefined,
    reset: () => resetBtn.click(),
    toggleOff: () => offChip.click(),
    // Persists the row's current value, then mutates spec.defaultValue in
    // place — resetBtn's click handler and display() both read it fresh off
    // this same captured spec object on every call, so ↺/R immediately
    // target the new default with no row rebuild needed.
    setDefault: spec.devDefault
      ? () => {
          spec.devDefault!.set(lastValue);
          spec.defaultValue = lastValue;
          resetBtn.style.visibility = "hidden";
        }
      : undefined,
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

interface PickerRowSpec {
  label: string;
  accent: string;
  /** Names in value order — the stored value is the chosen index. */
  options: readonly string[];
  defaultValue: number;
  description?: string;
  get: () => number;
  set: (value: number) => void;
}

/** An enum setting's row: same head as a toggle row, a strip of named chips
 *  (the palette picker's chips) where the slider would be. The strip is the
 *  one focusable control so it sits in the Tab ring like a slider; ←/→ (and
 *  the T hotkey) cycle the choice. Never auto-tunable, for the same reason
 *  a toggle isn't — see createToggleRow. */
function createPickerRow(spec: PickerRowSpec): HTMLElement {
  const el = document.createElement("div");
  el.className = "vc-row";

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

  const strip = document.createElement("div");
  strip.className = "vc-picker";
  strip.tabIndex = 0;
  strip.setAttribute("role", "radiogroup");
  strip.setAttribute("aria-label", spec.label);
  strip.style.cssText = paletteListStyle;
  el.style.setProperty("--vc-accent", spec.accent);
  wireHoverFocus(el, strip);
  const chips = spec.options.map((name, i) => {
    const btn = document.createElement("button");
    btn.textContent = name;
    btn.setAttribute("role", "radio");
    btn.tabIndex = -1; // the strip is the ring's stop, not each chip
    btn.addEventListener("click", () => {
      apply(i);
      spec.set(i);
      strip.focus();
    });
    strip.appendChild(btn);
    return btn;
  });

  const hint = document.createElement("div");
  hint.className = "vc-hint";
  hint.textContent = spec.description ?? "";
  if (!spec.description) hint.style.display = "none";

  el.append(head, strip, hint);

  const clampIndex = (value: number): number =>
    Math.min(spec.options.length - 1, Math.max(0, Math.round(value)));

  let current = clampIndex(spec.get());
  function apply(value: number): void {
    current = clampIndex(value);
    chips.forEach((chip, i) => {
      chip.style.cssText = i === current ? paletteChipLitStyle : paletteChipStyle;
      chip.setAttribute("aria-checked", String(i === current));
    });
    readout.textContent = spec.options[current];
    resetBtn.style.visibility = current !== clampIndex(spec.defaultValue) ? "visible" : "hidden";
  }
  apply(current);

  const cycle = (step: number): void => {
    const next = (current + step + spec.options.length) % spec.options.length;
    apply(next);
    spec.set(next);
  };
  strip.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      cycle(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      cycle(-1);
    }
  });
  resetBtn.addEventListener("click", () => {
    apply(spec.defaultValue);
    spec.set(clampIndex(spec.defaultValue));
  });

  wireRowKeys(strip, {
    reset: () => resetBtn.click(),
    toggleOff: () => cycle(1),
  });

  return el;
}

function statusText(status: AudioStatus): string {
  switch (status.source) {
    case "mic":
      return status.sampleRate ? `Mic live · ${Math.round(status.sampleRate / 1000)}k` : "Mic live";
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
  const audioMeters = createAudioMeters({ onLufsReset: deps.onLufsReset });

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

  // Status line: which scene, whether audio is flowing, and from where.
  const spectrumHeader = document.createElement("div");
  spectrumHeader.style.cssText = spectrumHeaderStyle;
  const spectrumTitle = document.createElement("div");
  spectrumTitle.style.cssText = spectrumTitleStyle;
  const spectrumStatus = document.createElement("div");
  spectrumStatus.style.cssText = spectrumStatusStyle;
  const liveDot = document.createElement("div");
  liveDot.style.cssText = liveDotStyle(false);
  const statusLabel = document.createElement("div");
  statusLabel.style.cssText = statusTextStyle;
  spectrumStatus.append(liveDot, statusLabel);
  spectrumHeader.append(spectrumTitle, spectrumStatus);

  const hairline = document.createElement("div");
  hairline.style.cssText = hairlineStyle;

  // The fader bank sits in a .vc-row so it wakes (glow, hint) on hover and
  // on focus-within exactly like a slider row.
  const fadersRow = document.createElement("div");
  fadersRow.className = "vc-row";
  fadersRow.style.setProperty("--vc-accent", BANDS_AMBER);
  // Always-on, unlike fadersHint below: explains the sky-blue marker
  // spectrumStrip.ts's drawCentroidMarker draws over the bars (same
  // AUTO_SKY constant, so the swatch can't drift from the line). A sibling
  // of .vc-hint, not nested in it, so it doesn't inherit the hover-reveal —
  // see the createSignalStrip .vc-reads reasoning above for why that split
  // matters. Not the same reading as the Character card's Centroid row:
  // that one is range-adapted against the track's own recent swing and has
  // no position on this strip's band-index axis, so the note doesn't claim
  // the two match.
  const spectrumLegend = createTraceLegend([
    { color: AUTO_SKY, label: "Brightness", note: "where the spectrum's energy balances" },
  ]);
  const fadersHint = document.createElement("div");
  fadersHint.className = "vc-hint";
  fadersHint.textContent = "Middle is 1× — drag up to boost a band, down to cut it, all the way down to switch it off";
  fadersRow.append(bandFaders.el, spectrumLegend.el, fadersHint);
  // R/T on a focused fader, through the same wiring as every row; no A —
  // the faders have no auto weights.
  bandFaders.faders.forEach((el, i) => {
    wireRowKeys(el, {
      reset: () => bandFaders.reset(i),
      toggleOff: () => bandFaders.toggleOff(i),
    });
    // Scoped to the hit div itself, not fadersRow: fadersRow also contains the
    // spectrum plot and the gain/Hz readouts, which aren't any one band's
    // control, so hovering the row as a whole would resolve to an arbitrary
    // fader. Each hit div already covers exactly its own band's hit region
    // (bandFaders.ts's `left`/`width`), so it's its own correct hover scope.
    wireHoverFocus(el, el);
  });

  bandsCard.body.append(spectrumHeader, hairline, fadersRow);
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
  }
  new MutationObserver(refreshColumnsFold).observe(columnsWrap, {
    attributes: true,
    attributeFilter: ["class"],
    subtree: true,
  });

  let lastStatusText = "";
  function refreshSpectrumHeader(): void {
    spectrumTitle.textContent = deps.currentSceneName();
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
  // so this is re-run on every open(). The edges also label the faders.
  function refreshBandsSplit(): void {
    bandFaders.setEdgesHz(deps.getBandEdgesHz());
    spectrumStrip.setSplit(deps.getBandSplit());
  }

  // ---- controls column ----
  const controlsCol = document.createElement("div");
  controlsCol.className = "vc-controls-col vc-scroll";

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
  wireSliderQuickJump(autoStrengthSlider);

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
  // its accent without being nested inside its border.
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
    // Auto-gain isn't in inputRows (see its own comment below on why it's
    // built separately) but needs the same resync wherever this is called.
    autoGainRow.sync(() => deps.getAutoGain());
  }

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
  });
  autoGainRow.onChange((value) => deps.onAutoGainChange(value));
  autoGainRow.sync(() => deps.getAutoGain());

  const inputCard = createCard({
    title: "Input",
    accent: INPUT_GREEN,
    right: createChipButton("Reset", "Reset sensitivity, expansion and smoothing", () => {
      for (const { row, defaultValue, onChange } of inputRows) {
        onChange(defaultValue);
        row.setValue(defaultValue);
        row.refreshChip();
        row.clearOff();
      }
    }),
  });
  markBlock(inputCard.title);
  inputCard.el.style.cssText += inputCardWashStyle;
  inputCard.body.append(
    autoGainRow.el,
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
  let sceneRowHandles: ReturnType<typeof createControlRow>[] = [];

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

  // "all"/"low" (SignalSpec.bandRange, signals.ts) resolved against the
  // *live* split rather than a fixed index range, since bandSplit.ts's
  // crossover is user-configurable.
  function resolveBandRange(kind: "all" | "low", split: BandSplit): { lo: number; hi: number } {
    return kind === "low" ? { lo: 0, hi: split.lowMid } : { lo: 0, hi: NUM_BANDS };
  }

  // Lights the bands a signal-linked row actually listens to on the
  // spectrum strip while the row is being touched — hover, keyboard focus,
  // or a drag — and clears back to the normal view on release. A no-op for
  // a row with no `reads`, or whose reads are all band-agnostic (drop
  // detection: section loudness, not a frequency read). Recomputed on
  // every `input` (not just on entry) since dragging Ripple source across
  // its own threshold changes which signal is actually active mid-drag —
  // see RIPPLE_SRC_BEAT_THRESHOLD's own comment in caustics.ts.
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
    if (spec.type === "enum" && spec.options) {
      container.appendChild(
        createPickerRow({
          label: spec.label,
          accent: SCENE_VIOLET,
          options: spec.options,
          defaultValue: spec.default,
          description: spec.description,
          get: () => deps.getSceneSettingValue(sceneId, spec),
          set: (value) => deps.onSceneSettingChange(sceneId, spec, value),
        }),
      );
      return;
    }
    if (spec.type === "boolean") {
      container.appendChild(
        createToggleRow({
          label: spec.label,
          accent: SCENE_VIOLET,
          defaultValue: spec.default,
          description: spec.description,
          get: () => deps.getSceneSettingValue(sceneId, spec),
          set: (value) => deps.onSceneSettingChange(sceneId, spec, value),
        }),
      );
      return;
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

    const devDefault = deps.devDefault;
    const row = createControlRow({
      label: spec.label,
      accent: SCENE_VIOLET,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      defaultValue: devDefault?.get(sceneId, spec.key) ?? spec.default,
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
      devDefault: devDefault ? { set: (value) => devDefault.set(sceneId, spec.key, value) } : undefined,
      reads,
    });
    row.onChange((value) => deps.onSceneSettingChange(sceneId, spec, value));
    row.sync(() => deps.getSceneSettingValue(sceneId, spec));
    container.appendChild(row.el);
    sceneRowHandles.push(row);
    wireBandHighlight(row.el, reads);
  }

  function renderSceneSettings(): void {
    const sceneId = deps.currentSceneId();
    const specs = deps.getSceneSettings(sceneId);
    sceneRows.innerHTML = "";
    sceneRowHandles = [];
    sceneCard.el.style.display = specs.length === 0 ? "none" : "";
    looksCard.el.style.display = specs.length === 0 ? "none" : "";
    looksCard.refresh();
    refreshAutoMaster();

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
    // emits no group headings (e.g. Mesh Grid) — otherwise it and the first
    // group heading would both resolve to the same first row.
    if (specs.length > 0 && !hasGroups) markBlock(sceneCard.title);
    else unmarkBlock(sceneCard.title);
    renumberBlocks();
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
  function toggleAutoMaster(): void {
    const sceneId = deps.currentSceneId();
    deps.onSceneAutoToggle(sceneId, !deps.isSceneAuto(sceneId));
    renderSceneSettings();
    syncInputRows();
  }
  autoMasterBtn.addEventListener("click", toggleAutoMaster);

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

  controlsCol.append(autoRow, inputCard.el, sceneCard.el, looksCard.el, paletteCard.el, footer);
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
  // to controls with a layout box: a folded card's body is display:none, and
  // a control inside it would otherwise sit in the ring and fail to focus.
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
    syncInputRows();
    renderSceneSettings();
    refreshBandsSplit();
    refreshBandFaders();
    refreshAutoStrengthDisplay();
    root.classList.add("vc-open");
    deps.toggleButton.setAttribute("aria-pressed", "true");
    isOpen = true;
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
  }

  function close() {
    root.classList.remove("vc-open");
    deps.toggleButton.setAttribute("aria-pressed", "false");
    isOpen = false;
    document.removeEventListener("pointerdown", onDocPointerDown);
    document.removeEventListener("keydown", onKeyDown);
  }

  // Cache of the last --wash value written, so update() (called every rAF
  // tick while open) only touches the DOM when the fill color actually moves.
  let lastWash = "";
  // ~10Hz — auto-driven values move on a multi-second timescale, so per-frame
  // DOM writes here would be pure cost. The spectrum header rides the same
  // tick; its status changes even more rarely.
  const AUTO_UI_REFRESH_MS = 100;
  let lastAutoRefreshMs = 0;

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
      pinned: Uint8Array | null,
      anim: AnimFrame | null,
      mono: Float32Array | null,
      rateScale: number,
      fixedEnergy: number | null,
      lufs: LufsReading | null,
      fluxRatio: number | null,
    ) {
      // Skip the DOM write while closed — the panel is re-opened via open()
      // anyway, and this runs every rAF tick while in a viz.
      if (!isOpen) return;
      audioMeters.update(frame, anim, mono, rawBands, rateScale, fixedEnergy, lufs, fluxRatio);
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
      spectrumStrip.setPinned(pinned);
      const processedBands = frame ? applySensitivity(frame, sensitivity, expansion).bands : null;
      spectrumStrip.update(rawBands, processedBands);

      const nowMs = performance.now();
      if (nowMs - lastAutoRefreshMs < AUTO_UI_REFRESH_MS) return;
      lastAutoRefreshMs = nowMs;

      refreshSpectrumHeader();
      powerCard.refresh();
      for (const { row } of inputRows) row.refreshAuto();
      autoGainRow.refreshAuto();
      for (const row of sceneRowHandles) row.refreshAuto();
    },
  };
}
