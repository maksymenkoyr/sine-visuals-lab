import {
  ACCELERATION_DEFAULT,
  ACCELERATION_MAX,
  ACCELERATION_MIN,
  applySensitivity,
  SENSITIVITY_DEFAULT,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  SMOOTHING_DEFAULT,
  SMOOTHING_MAX,
  SMOOTHING_MIN,
  shapeAcceleration,
  shapeLevel,
} from "../audio/sensitivity.ts";
import type { SceneSetting } from "../render/sceneSettings.ts";
import { type FeatureFrame } from "../audio/types.ts";
import { type BandSplit } from "../audio/bandSplit.ts";
import {
  BAND_GAIN_DEFAULT,
  BAND_GAIN_LOG_FLOOR,
  BAND_GAIN_MAX,
  type BandGroup,
} from "../audio/bandGains.ts";
import { createSpectrumStrip } from "./spectrumStrip.ts";
import {
  AUTO_SKY,
  BANDS_AMBER,
  FONT_DIGITS,
  FONT_LABEL,
  FONT_MONO,
  GLASS_FILTER,
  HAIRLINE,
  INPUT_GREEN,
  LIVE_DOT,
  SCENE_VIOLET,
  ensureControlsStyles,
  glassCardStyle,
  scanlineStyle,
  withAlpha,
} from "./controlsTheme.ts";

/**
 * The controller's controls panel — the "Viz Controls" design.
 *
 * Two glass columns anchored top-right over the live scene: the spectrum
 * card (scene name, audio source, live bars) beside the controls column,
 * whose cards run Bands → Auto strength (with the Auto master block welded
 * to it) → Input → Scene → Palette → a footer strip. Below the breakpoint in
 * controlsTheme.ts the columns stack into one scrolling column. It's
 * corner-docked, not a modal: the whole point is to watch the scene react
 * while you tune it, so it also stays open across palette taps.
 *
 * Row grammar (createControlRow): label · seven-segment readout + unit ·
 * "A" chip · ↺. The chip *is* the auto indicator — filled when auto owns
 * the value, outlined when the user has taken the row manual, absent when
 * the setting has no auto weights (see autoTune.ts). ↺ only appears once a
 * value is off its default, doubling as a "you changed this" marker. The
 * hint under a row (a setting's `description`) stays collapsed until
 * hover/focus, and while auto holds the row it reads as an invitation to
 * take over instead. Each card's accent names its system — the constants
 * and their meanings live in controlsTheme.ts.
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
  /** Shown in the spectrum card header — where the bars are coming from. */
  getAudioStatus: () => AudioStatus;
  getSensitivity: (sceneId: string) => number;
  onSensitivityChange: (sceneId: string, value: number) => void;
  getAcceleration: (sceneId: string) => number;
  onAccelerationChange: (sceneId: string, value: number) => void;
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
  /** Low/mid/high crossover, global per device (not per scene) — fixed, no
   *  longer user-facing, but still needed to color the spectrum strip's bars
   *  by group. See src/audio/bandSplit.ts. */
  getBandSplit: () => BandSplit;
  /** This device's real Hz band edges once the analyser exists; falls back to
   *  the nominal ladder before mic access is granted. */
  getBandEdgesHz: () => Float32Array;
  /** Per-scene low/mid/high band gain — see src/audio/bandGains.ts. */
  getBandGain: (sceneId: string, group: BandGroup) => number;
  onBandGainChange: (sceneId: string, group: BandGroup, value: number) => void;
  onBandGainsReset: (sceneId: string) => void;
  /** Auto-resolved live value for a row currently on auto — see autoTune.ts. */
  resolveSceneSettingValue: (sceneId: string, spec: SceneSetting) => number;
  resolveSensitivityValue: (sceneId: string) => number;
  resolveAccelerationValue: (sceneId: string) => number;
  resolveSmoothingValue: (sceneId: string) => number;
  /** Synthetic SceneSettings for the Sensitivity/Acceleration/Smoothing
   *  pseudo-params, so they can drive an auto chip through the same
   *  isSettingAutoEnabled/onSettingAutoToggle contract as a real scene
   *  setting row. */
  getSensitivitySpec: () => SceneSetting;
  getAccelerationSpec: () => SceneSetting;
  getSmoothingSpec: () => SceneSetting;
  isSettingAutoEnabled: (sceneId: string, key: string) => boolean;
  onSettingAutoToggle: (sceneId: string, spec: SceneSetting, on: boolean) => void;
  /** Whether every auto-capable setting on this scene (incl. Sensitivity/Acceleration/Smoothing) is auto. */
  isSceneAuto: (sceneId: string) => boolean;
  onSceneAutoToggle: (sceneId: string, on: boolean) => void;
  getAutoStrength: () => number;
  onAutoStrengthChange: (value: number) => void;
  /** The button that opens this menu — excluded from the tap-outside-to-close
   *  check, and ringed (aria-pressed) while the panel is open. */
  toggleButton: HTMLElement;
}

export interface DeviceMenu {
  toggle(): void;
  close(): void;
  /** Fed every frame while in a viz (either may be null: frame before audio is
   *  up, rawBands additionally on a mic-less renderer device) — drives the
   *  Input card's level wash and the spectrum strip's two feeds. */
  update(frame: FeatureFrame | null, rawBands: Float32Array | null): void;
  /** Whether the panel is currently open — lets immersive fullscreen mode
   *  (src/ui/fullscreen.ts) skip idle-hiding the gear out from under it. */
  isOpen(): boolean;
}

// ---- styles --------------------------------------------------------------
// Layout-level rules (columns, slider, hint reveal, toggle) are class rules in
// controlsTheme.ts; everything per-element is inline here, in the same
// cssText-constant convention as the rest of src/ui/.

const cardBodyStyle = `position: relative; padding: 10px 12px 12px;`;
const cardHeaderStyle = `display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 9px;`;
const cardTitleStyle = (accent: string) =>
  `font: 500 10.5px/1 ${FONT_MONO}; letter-spacing: 0.13em; text-transform: uppercase; color: ${accent};`;
// Small bordered text button — "Reset" in card headers, "RAW" in the
// spectrum header. Lit variant = currently active.
const chipBtnStyle = `
  font: 400 9.5px/1.2 ${FONT_MONO}; letter-spacing: 0.04em; color: rgba(255,255,255,0.55);
  background: transparent; border: 1px solid rgba(255,255,255,0.18); border-radius: 4px;
  padding: 2.5px 7px; cursor: pointer;
`;
const chipBtnLitStyle = `${chipBtnStyle} color: #fff; border-color: rgba(255,255,255,0.5);`;

const rowHeadStyle = `display: flex; align-items: center; justify-content: space-between; gap: 8px;`;
const rowLabelStyle = `
  font: 300 14.5px/1.2 ${FONT_LABEL}; color: #fff; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const rowRightStyle = `display: flex; align-items: center; gap: 7px; flex-shrink: 0;`;
const readoutStyle = `display: flex; align-items: baseline; gap: 4px; color: #fff;`;
// Seven-segment digits; DSEG7 has no letters, so text readouts ("Off"/"On")
// fall back to the mono face via digitsTextStyle.
const digitsStyle = `font-family: ${FONT_DIGITS}; font-size: 11.5px; letter-spacing: 1px;`;
const digitsTextStyle = `font: 400 11px/1 ${FONT_MONO};`;
const unitStyle = `font: 400 10.5px/1 ${FONT_MONO}; color: rgba(255,255,255,0.75);`;
// "A" chip: filled when auto owns the row, outlined when the user does.
const autoChipBaseStyle = `
  width: 17px; height: 16px; display: grid; place-items: center; border-radius: 3px;
  font: 500 9.5px/1 ${FONT_MONO}; cursor: pointer; padding: 0; flex-shrink: 0;
`;
const autoChipLitStyle = (accent: string) =>
  `${autoChipBaseStyle} background: ${accent}; border: 1px solid ${accent}; color: #070a09;`;
const autoChipManualStyle = (accent: string) =>
  `${autoChipBaseStyle} background: transparent; border: 1px solid ${withAlpha(accent, 0.7)}; color: ${accent};`;
const rowResetStyle = `
  font: 400 11px/1 ${FONT_MONO}; color: rgba(255,255,255,0.45); background: none; border: none;
  padding: 0; cursor: pointer; flex-shrink: 0;
`;
const rowSpacerStyle = `height: 12px;`;
// A divider-with-caption between blocks of scene rows — a step down from a
// card title, not a second one.
const groupHeadingStyle = `
  font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(255,255,255,0.45); margin: 14px 0 8px; padding-top: 10px;
  border-top: 1px solid rgba(255,255,255,0.1);
`;
const groupHeadingFirstStyle = `
  font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(255,255,255,0.45); margin: 2px 0 8px;
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

// Spectrum card header.
const spectrumBodyStyle = `position: relative; padding: 11px 14px 12px;`;
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
const HOT_YELLOW = "#eab308"; // yellow-500
const HOT_RED = "#ef4444"; // red-500
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

function createChipButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = text;
  btn.title = title;
  btn.style.cssText = chipBtnStyle;
  btn.addEventListener("click", onClick);
  return btn;
}

interface CardSpec {
  title: string;
  accent: string;
  /** Right-hand header slot — a Reset chip, a readout, … */
  right?: HTMLElement;
}

/** A glass card: scanline overlay, header row (title + optional right slot),
 *  and a body the caller fills. */
function createCard(spec: CardSpec) {
  const el = document.createElement("div");
  el.style.cssText = glassCardStyle;
  const scanlines = document.createElement("div");
  scanlines.style.cssText = scanlineStyle;
  const body = document.createElement("div");
  body.style.cssText = cardBodyStyle;

  const header = document.createElement("div");
  header.style.cssText = cardHeaderStyle;
  const title = document.createElement("div");
  title.textContent = spec.title;
  title.style.cssText = cardTitleStyle(spec.accent);
  header.appendChild(title);
  if (spec.right) header.appendChild(spec.right);

  body.appendChild(header);
  el.append(scanlines, body);
  return { el, body };
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

/** One slider row in the panel's grammar — label, readout, chip, ↺, slider,
 *  hint. Gain rows (log-mapped) and scene setting rows (linear) are the same
 *  shape, so the construction and pos<->value mapping live here once. */
function createControlRow(spec: ControlRowSpec) {
  const el = document.createElement("div");
  el.className = "vc-row";

  const head = document.createElement("div");
  head.style.cssText = rowHeadStyle;
  const label = document.createElement("div");
  label.textContent = spec.label;
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
  chip.title = `Auto-tune ${spec.label}`;
  chip.style.cssText = autoChipManualStyle(spec.accent);
  // A row with no auto weights has nothing for the chip to do — leave it out
  // rather than show a toggle that can't change anything.
  if (!spec.auto) chip.style.display = "none";

  // visibility (not display) keeps the row from reflowing while dragging.
  const resetBtn = document.createElement("button");
  resetBtn.textContent = "↺";
  resetBtn.title = `Reset ${spec.label}`;
  resetBtn.style.cssText = rowResetStyle;

  right.append(readout, chip, resetBtn);
  head.append(label, right);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "vc-slider";
  slider.setAttribute("aria-label", spec.label);
  slider.style.setProperty("--vc-accent", spec.accent);
  const isLog = spec.mapping === "log";
  if (isLog) {
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
  } else {
    slider.min = String(spec.min);
    slider.max = String(spec.max);
    slider.step = String(spec.step ?? "any");
  }

  const hint = document.createElement("div");
  hint.className = "vc-hint";

  el.append(head, slider, hint);

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
    return Math.round(loPos + t * (100 - loPos));
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
  slider.addEventListener("input", () => commit(sliderToValue()));
  resetBtn.addEventListener("click", () => commit(spec.defaultValue));

  if (spec.auto) {
    chip.addEventListener("click", () => {
      const auto = spec.auto!;
      const on = !auto.isEnabled();
      auto.toggle(on);
      refreshChip();
      display(on ? auto.resolveLive() : auto.getManual(), on);
    });
  }

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
 *  model), so no chip and nothing to refresh per frame. */
function createToggleRow(spec: ToggleRowSpec): HTMLElement {
  const el = document.createElement("div");
  el.className = "vc-row";

  const head = document.createElement("div");
  head.style.cssText = rowHeadStyle;
  const label = document.createElement("div");
  label.textContent = spec.label;
  label.style.cssText = rowLabelStyle;
  const right = document.createElement("div");
  right.style.cssText = rowRightStyle;
  const readout = document.createElement("span");
  readout.style.cssText = `${digitsTextStyle} color: #fff;`;
  const resetBtn = document.createElement("button");
  resetBtn.textContent = "↺";
  resetBtn.title = `Reset ${spec.label}`;
  resetBtn.style.cssText = rowResetStyle;
  right.append(readout, resetBtn);
  head.append(label, right);

  const toggle = document.createElement("button");
  toggle.className = "vc-toggle";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-label", spec.label);
  toggle.style.setProperty("--vc-accent", spec.accent);

  const hint = document.createElement("div");
  hint.className = "vc-hint";
  hint.textContent = spec.description ?? "";
  if (!spec.description) hint.style.display = "none";

  el.append(head, toggle, hint);

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

  return el;
}

function spacer(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = rowSpacerStyle;
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

  // ---- spectrum column ----
  // Live spectrum, its own card — a standing "is the mic actually hearing
  // anything" check. Always mounted (unlike the scene card), since it's not
  // tied to which scene is active.
  const spectrumStrip = createSpectrumStrip();

  const spectrumCol = document.createElement("div");
  spectrumCol.className = "vc-spectrum-col";
  const spectrumCard = document.createElement("div");
  spectrumCard.style.cssText = glassCardStyle;
  const spectrumScan = document.createElement("div");
  spectrumScan.style.cssText = scanlineStyle;
  const spectrumBody = document.createElement("div");
  spectrumBody.style.cssText = spectrumBodyStyle;

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
  // "Listening post": lit shows the raw mic signal exactly as it comes in —
  // no adaptive envelope, no sensitivity gain; unlit (default) shows the
  // processed signal that's actually driving the visuals.
  const rawChip = createChipButton("RAW", "Listening post — show the raw mic signal instead of what the visuals see", () => {
    spectrumStrip.setShowRaw(!spectrumStrip.showRaw());
    rawChip.style.cssText = spectrumStrip.showRaw() ? chipBtnLitStyle : chipBtnStyle;
  });
  spectrumStatus.append(liveDot, statusLabel, rawChip);
  spectrumHeader.append(spectrumTitle, spectrumStatus);

  const hairline = document.createElement("div");
  hairline.style.cssText = hairlineStyle;

  spectrumBody.append(spectrumHeader, hairline, spectrumStrip.el);
  spectrumCard.append(spectrumScan, spectrumBody);
  spectrumCol.appendChild(spectrumCard);

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

  // ---- controls column ----
  const controlsCol = document.createElement("div");
  controlsCol.className = "vc-controls-col vc-scroll";

  // Bands: low/mid/high band gain — the DJ-mixer control (see bandGains.ts):
  // how hard each group drives the visuals, not where the dividing lines sit
  // (those are fixed — see getBandSplit below). Global per device like the
  // Auto card, not rebuilt per scene; only the Scene card needs that.
  function makeBandGainRow(label: string, group: BandGroup, description: string) {
    const row = createControlRow({
      label,
      accent: BANDS_AMBER,
      min: BAND_GAIN_LOG_FLOOR,
      max: BAND_GAIN_MAX,
      defaultValue: BAND_GAIN_DEFAULT,
      mapping: "log",
      zeroAtMin: true,
      unit: "×",
      format: formatGain,
      description,
    });
    row.onChange((value) => deps.onBandGainChange(deps.currentSceneId(), group, value));
    return row;
  }
  const bandGainRows: Record<BandGroup, ReturnType<typeof createControlRow>> = {
    low: makeBandGainRow("Low", "low", "How hard the bass drives the visuals — all the way down kills it"),
    mid: makeBandGainRow("Mid", "mid", "How hard the mids drive the visuals — all the way down kills them"),
    high: makeBandGainRow("High", "high", "How hard the hats and air drive the visuals — all the way down kills them"),
  };
  function refreshBandGainRows(): void {
    const sceneId = deps.currentSceneId();
    for (const group of ["low", "mid", "high"] as const) {
      bandGainRows[group].setValue(deps.getBandGain(sceneId, group));
    }
  }
  const bandsCard = createCard({
    title: "Bands",
    accent: BANDS_AMBER,
    right: createChipButton("Reset", "Reset band gains", () => {
      deps.onBandGainsReset(deps.currentSceneId());
      refreshBandGainRows();
    }),
  });
  bandsCard.body.append(bandGainRows.low.el, spacer(), bandGainRows.mid.el, spacer(), bandGainRows.high.el);

  // The split itself is fixed (no crossover sliders to drag), so the strip
  // only needs its group coloring set up once — the edges do still depend on
  // the analyser's real sample rate, though, which isn't known until mic
  // access is granted, so this is re-run on every open().
  function refreshBandsSplit(): void {
    spectrumStrip.setEdgesHz(deps.getBandEdgesHz());
    spectrumStrip.setSplit(deps.getBandSplit());
  }

  // Auto strength: how far auto is allowed to push a setting from its default
  // (see autoTune.ts's computeAutoTarget). Global per device.
  const autoStrengthReadout = document.createElement("div");
  autoStrengthReadout.style.cssText = readoutStyle;
  const autoStrengthDigits = document.createElement("span");
  autoStrengthDigits.style.cssText = digitsStyle;
  autoStrengthReadout.appendChild(autoStrengthDigits);
  const autoCard = createCard({ title: "Auto strength", accent: AUTO_SKY, right: autoStrengthReadout });
  autoCard.el.style.flex = "1";
  autoCard.el.style.minWidth = "0";
  const autoStrengthRow = document.createElement("div");
  autoStrengthRow.className = "vc-row";
  const autoStrengthSlider = document.createElement("input");
  autoStrengthSlider.type = "range";
  autoStrengthSlider.className = "vc-slider";
  autoStrengthSlider.setAttribute("aria-label", "Auto strength");
  autoStrengthSlider.min = "0";
  autoStrengthSlider.max = "2";
  autoStrengthSlider.step = "0.05";
  autoStrengthSlider.style.setProperty("--vc-accent", AUTO_SKY);
  autoStrengthSlider.style.marginTop = "0";
  const autoStrengthHint = document.createElement("div");
  autoStrengthHint.className = "vc-hint";
  autoStrengthHint.textContent = AUTO_STRENGTH_HINT;
  autoStrengthRow.append(autoStrengthSlider, autoStrengthHint);
  autoCard.body.appendChild(autoStrengthRow);

  function showAutoStrength(value: number): void {
    autoStrengthSlider.value = String(value);
    autoStrengthSlider.style.setProperty("--vc-fill", `${(value / 2) * 100}%`);
    autoStrengthDigits.textContent = value.toFixed(2);
  }
  function refreshAutoStrengthDisplay(): void {
    showAutoStrength(deps.getAutoStrength());
  }
  autoStrengthSlider.addEventListener("input", () => {
    const value = Number(autoStrengthSlider.value);
    showAutoStrength(value);
    deps.onAutoStrengthChange(value);
  });

  // The global "Auto" master switch — toggles every auto-capable row, scene
  // settings plus Sensitivity/Acceleration/Smoothing (see app.ts's
  // isSceneAuto wiring). Welded to the strength card's right edge, sharing
  // its accent without being nested inside its border.
  const autoMasterBtn = document.createElement("button");
  autoMasterBtn.title = "Auto-tune everything — sensitivity, acceleration, smoothing, and every scene setting";
  const autoMasterLabel = document.createElement("div");
  autoMasterLabel.textContent = "Auto";
  const autoMasterSub = document.createElement("div");
  const autoMasterInner = document.createElement("div");
  autoMasterInner.append(autoMasterLabel, autoMasterSub);
  autoMasterBtn.appendChild(autoMasterInner);

  const autoRow = document.createElement("div");
  autoRow.style.cssText = autoRowStyle;
  autoRow.append(autoCard.el, autoMasterBtn);

  // Input: Sensitivity/Acceleration/Smoothing — three instances of the same
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
    // overall gain Sensitivity controls — see shapeAcceleration for the curve.
    makeInputRow(
      "Acceleration",
      { min: ACCELERATION_MIN, max: ACCELERATION_MAX, defaultValue: ACCELERATION_DEFAULT },
      deps.getAccelerationSpec,
      () => deps.getAcceleration(deps.currentSceneId()),
      () => deps.resolveAccelerationValue(deps.currentSceneId()),
      (value) => deps.onAccelerationChange(deps.currentSceneId(), value),
      "Distance between the quiet parts and the loud parts",
    ),
    // How fast the visuals chase the audio, independent of Sensitivity's gain
    // and Acceleration's curve — see smoothingRateScale for the rate mapping.
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
  const inputCard = createCard({
    title: "Input",
    accent: INPUT_GREEN,
    right: createChipButton("Reset", "Reset sensitivity, acceleration and smoothing", () => {
      for (const { row, defaultValue, onChange } of inputRows) {
        onChange(defaultValue);
        row.setValue(defaultValue);
        row.refreshChip();
      }
    }),
  });
  inputCard.el.style.cssText += inputCardWashStyle;
  inputCard.body.append(inputRows[0].row.el, spacer(), inputRows[1].row.el, spacer(), inputRows[2].row.el);

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

  function renderSceneSettings(): void {
    const sceneId = deps.currentSceneId();
    const specs = deps.getSceneSettings(sceneId);
    sceneRows.innerHTML = "";
    sceneRowHandles = [];
    sceneCard.el.style.display = specs.length === 0 ? "none" : "";
    refreshAutoMaster();

    let lastGroup: string | undefined;
    let first = true;
    for (const spec of specs) {
      if (spec.group !== undefined && spec.group !== lastGroup) {
        const groupHeading = document.createElement("div");
        groupHeading.textContent = spec.group;
        groupHeading.style.cssText = lastGroup === undefined ? groupHeadingFirstStyle : groupHeadingStyle;
        sceneRows.appendChild(groupHeading);
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

  autoMasterBtn.addEventListener("click", () => {
    const sceneId = deps.currentSceneId();
    deps.onSceneAutoToggle(sceneId, !deps.isSceneAuto(sceneId));
    renderSceneSettings();
    syncInputRows();
  });

  controlsCol.append(bandsCard.el, autoRow, inputCard.el, sceneCard.el, paletteCard.el, footer);
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

  // "H" hides the panel. Ignored while typing somewhere (a range slider
  // keeping focus after a drag is fine — that's still "in the panel").
  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "h" && e.key !== "H") return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement | null;
    if (t) {
      const tag = t.tagName;
      if (tag === "TEXTAREA" || t.isContentEditable) return;
      if (tag === "INPUT" && (t as HTMLInputElement).type !== "range") return;
    }
    close();
  }

  function open() {
    refreshSpectrumHeader();
    renderPalettes();
    syncInputRows();
    renderSceneSettings();
    refreshBandsSplit();
    refreshBandGainRows();
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
    update(frame: FeatureFrame | null, rawBands: Float32Array | null) {
      // Skip the DOM write while closed — the panel is re-opened via open()
      // anyway, and this runs every rAF tick while in a viz.
      if (!isOpen) return;
      // Raw (pre-sensitivity) energy, so the level wash reflects the actual
      // mic signal regardless of where the sensitivity slider is set.
      const level = frame?.energy ?? 0;
      const raw = Math.min(1, Math.max(0, level));
      const sceneId = deps.currentSceneId();
      const sensitivity = deps.isSettingAutoEnabled(sceneId, deps.getSensitivitySpec().key)
        ? deps.resolveSensitivityValue(sceneId)
        : deps.getSensitivity(sceneId);
      const acceleration = deps.isSettingAutoEnabled(sceneId, deps.getAccelerationSpec().key)
        ? deps.resolveAccelerationValue(sceneId)
        : deps.getAcceleration(sceneId);
      const shaped = Math.min(
        1,
        Math.max(0, shapeAcceleration(shapeLevel(raw, sensitivity), acceleration)),
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
      // is the exact same sensitivity+acceleration pipeline the render path
      // applies before scene.render() (see applySensitivity in app.ts) — so
      // it always shows literally what the visuals are reacting to.
      const processedBands = frame ? applySensitivity(frame, sensitivity, acceleration).bands : null;
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
