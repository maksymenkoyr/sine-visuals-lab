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
import { AUTO_STRENGTH_DEFAULT, AUTO_STRENGTH_MIN, AUTO_STRENGTH_MAX } from "../render/autoTune.ts";
import { type FeatureFrame } from "../audio/types.ts";
import { type BandSplit } from "../audio/bandSplit.ts";
import { AUTO_GAIN_DEFAULT, AUTO_GAIN_MAX, AUTO_GAIN_MIN } from "../audio/autoGain.ts";
import type { LufsReading } from "../audio/lufs.ts";
import { BAND_FADER_COUNT } from "../audio/bandGains.ts";
import { createBandFaders } from "./bandFaders.ts";
import { createAudioMeters } from "./audioMeters.ts";
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
  createCard,
  createChipButton,
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
 * *is* its hotkey when the row has keyboard focus. The hint under a row (a
 * setting's `description`) stays collapsed until hover/focus, and while auto
 * holds the row it reads as an invitation to take over instead. Each card's
 * accent names its system — the constants and their meanings live in
 * controlsTheme.ts.
 *
 * Keyboard layer, live only while the panel is open (see onKeyDown): Tab /
 * Shift+Tab walk a ring over every .vc-slider/.vc-toggle/.vc-fader in
 * document order, wrapping at both ends and skipping every chip and button —
 * so Tab alone never leaves the panel and never lands anywhere but a control.
 * On whichever control has focus, A toggles auto, R resets, T mutes/restores
 * (see above; a fader's arrow keys are its own, in bandFaders.ts).
 * Digit keys 1-9 jump to a numbered block — each card title and each scene
 * group heading carries a .vc-block badge, renumbered by renumberBlocks()
 * whenever the block set can change (i.e. on every renderSceneSettings) — and
 * focus the first control inside it.
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
  /** Global per-band adaptive-normalization amount — see src/audio/autoGain.ts.
   *  AUTO_GAIN_MIN (the default) is the fixed mapping against the analyser's
   *  own dB window, matching the spectrum strip's raw feed; AUTO_GAIN_MAX is
   *  fully adaptive. */
  getAutoGain: () => number;
  onAutoGainChange: (value: number) => void;
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
   *  `anim`/`mono`/`fixedEnergy` feed the meters (audioMeters.ts) —
   *  `fixedEnergy` is FeatureExtractor.fixedEnergy, null wherever this
   *  device isn't running its own extractor (renderer, synthetic feed);
   *  `lufs` is this device's lufsAnalyser reading, null on the same paths
   *  (the Loudness card hides itself). */
  update(
    frame: FeatureFrame | null,
    rawBands: Float32Array | null,
    ungained: FeatureFrame | null,
    pinned: Uint8Array | null,
    anim: AnimFrame | null,
    mono: Float32Array | null,
    fixedEnergy: number | null,
    lufs: LufsReading | null,
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
const footerBtnStyle = `
  font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit;
  background: none; border: none; padding: 0; cursor: pointer;
`;

// The Input card doubles as a level meter: two stacked background washes
// (sized per frame in update()) under the glass, not separate bars — a bar
// stacked over a slider read as a second, draggable control it wasn't:
//  - the tick: a 2px hard edge at the raw (pre-sensitivity) mic level,
//    always input-green — it's a different quantity from the fill below.
//  - the fill: a solid wash out to the shaped (post-sensitivity) level —
//    where the scene is actually reacting right now. Its color rides the
//    --wash custom property (see washColor()) so only that one value needs
//    writing each frame as the level nears clipping.
// The gap between tick and fill edge is the sensitivity, visibly.
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
  el.addEventListener("click", () => slider.focus());
  wireThumbMagnet(el, slider);

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
    const sliderValue = valueToSlider(value);
    slider.value = String(sliderValue);
    const lo = Number(slider.min);
    const hi = Number(slider.max);
    const pct = hi > lo ? ((sliderValue - lo) / (hi - lo)) * 100 : 0;
    slider.style.setProperty("--vc-fill", `${Math.max(0, Math.min(100, pct))}%`);
    setReadout(value);
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
    commit(sliderToValue());
  });
  resetBtn.addEventListener("click", () => {
    clearOff();
    commit(spec.defaultValue);
  });
  offChip.addEventListener("click", () => {
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
      if (on) clearOff();
      refreshChip();
      display(on ? auto.resolveLive() : auto.getManual(), on);
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
     *  auto-resolved value while auto is on and this row isn't being dragged. */
    refreshAuto(): void {
      if (!spec.auto || dragging || !spec.auto.isEnabled()) return;
      display(spec.auto.resolveLive(), true);
    },
    refreshChip,
    /** Forgets this row's T restore point — for the card-level Reset chips
     *  (Bands, Input), which write straight through setValue() rather than
     *  this row's own resetBtn. */
    clearOff,
    /** Show whatever's right for the row now: the live auto value if auto
     *  owns it, the manual store otherwise. */
    sync(manualValue: () => number): void {
      refreshChip();
      if (spec.auto && spec.auto.isEnabled()) display(spec.auto.resolveLive(), true);
      else display(manualValue(), false);
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
  // no adaptive envelope, no gain, no sensitivity; unlit (default) shows the
  // processed signal that's actually driving the visuals.
  const rawChip = createChipButton("RAW", "Listening post — show the raw mic signal instead of what the visuals see", () => {
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
  const bandsCard = createCard({ title: "Bands", accent: BANDS_AMBER, right: bandsHeaderRight });
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
  const fadersHint = document.createElement("div");
  fadersHint.className = "vc-hint";
  fadersHint.textContent = "Middle is 1× — drag up to boost a band, down to cut it, all the way down to switch it off";
  fadersRow.append(bandFaders.el, fadersHint);
  // R/T on a focused fader, through the same wiring as every row; no A —
  // the faders have no auto weights.
  bandFaders.faders.forEach((el, i) => {
    wireRowKeys(el, {
      reset: () => bandFaders.reset(i),
      toggleOff: () => bandFaders.toggleOff(i),
    });
  });

  bandsCard.body.append(spectrumHeader, hairline, fadersRow);
  spectrumCol.append(bandsCard.el, audioMeters.el);

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
  wireThumbMagnet(autoCard.el, autoStrengthSlider);

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

  // Input: Sensitivity/Expansion/Smoothing — three instances of the same
  // log-mapped row, sharing the auto-refresh call sites below (master
  // toggle, open(), live-drift refresh) through one array, which is what
  // keeps a future fourth row from shipping half-wired to Auto.
  function makeInputRow(
    label: string,
    range: { min: number; max: number; defaultValue: number },
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
      unit: "×",
      format: formatGain,
      description,
      auto: {
        isEnabled: () => deps.isSettingAutoEnabled(deps.currentSceneId(), spec().key),
        toggle: (on) => deps.onSettingAutoToggle(deps.currentSceneId(), spec(), on),
        resolveLive,
        getManual,
      },
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
    makeInputRow(
      "Smoothing",
      { min: SMOOTHING_MIN, max: SMOOTHING_MAX, defaultValue: SMOOTHING_DEFAULT },
      deps.getSmoothingSpec,
      () => deps.getSmoothing(deps.currentSceneId()),
      () => deps.resolveSmoothingValue(deps.currentSceneId()),
      (value) => deps.onSmoothingChange(deps.currentSceneId(), value),
      "How quickly the picture follows the sound",
    ),
  ];
  function syncInputRows(): void {
    for (const { row, getManual } of inputRows) row.sync(getManual);
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
  // preference. Never auto-tuned (no `auto` block): auto mode reads
  // FeatureFrame.level, which this doesn't touch, but an amount that moves
  // by itself would make the Signal card's history trace unreadable.
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
  });
  autoGainRow.onChange((value) => deps.onAutoGainChange(value));
  autoGainRow.setValue(deps.getAutoGain());

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

  function renderSceneSettings(): void {
    const sceneId = deps.currentSceneId();
    const specs = deps.getSceneSettings(sceneId);
    sceneRows.innerHTML = "";
    sceneRowHandles = [];
    sceneCard.el.style.display = specs.length === 0 ? "none" : "";
    refreshAutoMaster();

    let lastGroup: string | undefined;
    let first = true;
    let hasGroups = false;
    for (const spec of specs) {
      if (spec.group !== undefined && spec.group !== lastGroup) {
        hasGroups = true;
        const heading = groupHeading(spec.group, lastGroup === undefined);
        markBlock(heading);
        sceneRows.appendChild(heading);
      } else if (!first) {
        sceneRows.appendChild(spacer());
      }
      lastGroup = spec.group;
      first = false;

      if (spec.type === "boolean") {
        sceneRows.appendChild(
          createToggleRow({
            label: spec.label,
            accent: SCENE_VIOLET,
            defaultValue: spec.default,
            description: spec.description,
            get: () => deps.getSceneSettingValue(sceneId, spec),
            set: (value) => deps.onSceneSettingChange(sceneId, spec, value),
          }),
        );
        continue;
      }

      const row = createControlRow({
        label: spec.label,
        accent: SCENE_VIOLET,
        min: spec.min,
        max: spec.max,
        step: spec.step,
        defaultValue: spec.default,
        mapping: "linear",
        format: formatSetting,
        description: spec.description,
        auto: spec.auto
          ? {
              isEnabled: () => deps.isSettingAutoEnabled(sceneId, spec.key),
              toggle: (on) => deps.onSettingAutoToggle(sceneId, spec, on),
              resolveLive: () => deps.resolveSceneSettingValue(sceneId, spec),
              getManual: () => deps.getSceneSettingValue(sceneId, spec),
            }
          : undefined,
      });
      row.onChange((value) => deps.onSceneSettingChange(sceneId, spec, value));
      row.sync(() => deps.getSceneSettingValue(sceneId, spec));
      sceneRows.appendChild(row.el);
      sceneRowHandles.push(row);
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

  // Footer strip: auto state at a glance, and a way out.
  const footer = document.createElement("div");
  footer.style.cssText = footerStyle;
  const footerStatus = document.createElement("span");
  const hideBtn = document.createElement("button");
  hideBtn.textContent = "Hide UI  H";
  hideBtn.title = "Close the panel (H)";
  hideBtn.style.cssText = footerBtnStyle;
  hideBtn.addEventListener("click", () => close());
  footer.append(footerStatus, hideBtn);

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

  controlsCol.append(autoRow, inputCard.el, sceneCard.el, paletteCard.el, footer);
  root.append(spectrumCol, controlsCol);
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

  // Shared by every document-level hotkey below (H, Tab, the digits):
  // ignored while typing somewhere (a range slider keeping focus after a
  // drag is fine — that's still "in the panel", there's just nothing to
  // type in the panel itself).
  function isTypingTarget(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    const tag = t.tagName;
    if (tag === "TEXTAREA" || t.isContentEditable) return true;
    if (tag === "INPUT" && (t as HTMLInputElement).type !== "range") return true;
    return false;
  }

  // The Tab ring: every param control, in document order — see the header
  // comment. Derived from the DOM each call rather than cached, so a Scene
  // card rebuilt by renderSceneSettings can never leave it stale.
  function ringElements(): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(".vc-slider, .vc-toggle, .vc-fader")];
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
      fixedEnergy: number | null,
      lufs: LufsReading | null,
    ) {
      // Skip the DOM write while closed — the panel is re-opened via open()
      // anyway, and this runs every rAF tick while in a viz.
      if (!isOpen) return;
      audioMeters.update(frame, anim, mono, fixedEnergy, lufs);
      // Raw (pre-sensitivity) energy, so the level wash reflects the actual
      // mic signal regardless of where the sensitivity slider is set.
      const level = frame?.energy ?? 0;
      const raw = Math.min(1, Math.max(0, level));
      const sceneId = deps.currentSceneId();
      const sensitivity = deps.isSettingAutoEnabled(sceneId, deps.getSensitivitySpec().key)
        ? deps.resolveSensitivityValue(sceneId)
        : deps.getSensitivity(sceneId);
      const expansion = deps.isSettingAutoEnabled(sceneId, deps.getExpansionSpec().key)
        ? deps.resolveExpansionValue(sceneId)
        : deps.getExpansion(sceneId);
      const shaped = Math.min(
        1,
        Math.max(0, shapeExpansion(shapeLevel(raw, sensitivity), expansion)),
      );
      const rawPct = Math.round(raw * 100);
      const shapedPct = Math.round(shaped * 100);
      inputCard.el.style.backgroundSize = `${rawPct}% 100%, ${shapedPct}% 100%`;

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
      for (const { row } of inputRows) row.refreshAuto();
      for (const row of sceneRowHandles) row.refreshAuto();
    },
  };
}
