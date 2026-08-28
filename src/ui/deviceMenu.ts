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

export interface MenuItem {
  id: string;
  name: string;
}

export interface DeviceMenuDeps {
  getPalettes: () => MenuItem[];
  currentSceneId: () => string;
  currentPaletteId: () => string;
  onPickPalette: (id: string) => void;
  getSensitivity: (sceneId: string) => number;
  onSensitivityChange: (sceneId: string, value: number) => void;
  getAcceleration: (sceneId: string) => number;
  onAccelerationChange: (sceneId: string, value: number) => void;
  getSmoothing: (sceneId: string) => number;
  onSmoothingChange: (sceneId: string, value: number) => void;
  /** Empty for scenes with nothing to tune — the box hides itself. */
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
  /** Global per-band adaptive-normalization switch — see src/audio/autoGain.ts.
   *  Off falls back to a fixed mapping against the analyser's own dB window,
   *  matching the spectrum strip's "before processing" feed. */
  getAutoGainEnabled: () => boolean;
  onAutoGainChange: (value: boolean) => void;
  /** The button that opens this menu — excluded from the tap-outside-to-close check. */
  toggleButton: HTMLElement;
}

export interface DeviceMenu {
  toggle(): void;
  close(): void;
  /** Fed every frame while in a viz (either may be null: frame before audio is
   *  up, rawBands additionally on a mic-less renderer device) — drives the
   *  Sensitivity box's level wash and the spectrum strip's two feeds. */
  update(frame: FeatureFrame | null, rawBands: Float32Array | null): void;
  /** Whether the panel is currently open — lets immersive fullscreen mode
   *  (src/ui/fullscreen.ts) skip idle-hiding the gear out from under it. */
  isOpen(): boolean;
}

// Corner-docked over the live scene, not a full-screen modal — the whole point of
// these controls is to watch the scene react while you tune it.
const panelStyle = `
  position: fixed; right: 10px; bottom: 58px; z-index: 30; display: none;
  width: min(320px, 88vw); max-height: calc(100vh - 120px); overflow-y: auto;
  background: rgba(17, 17, 17, 0.82);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  border: 1px solid #fff2; border-radius: 16px; padding: 20px;
  color: #fff; font-family: system-ui, sans-serif;
`;
const headingStyle = `font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.5; margin: 16px 0 8px;`;
const itemStyle = `
  display: block; width: 100%; text-align: left; padding: 10px 12px; margin-bottom: 6px;
  border-radius: 8px; border: 1px solid #fff1; background: #fff0; color: #fff;
  font: inherit; font-size: 14px; cursor: pointer;
`;
const MIC_GREEN = "#22c55e";
// Live level is painted as two stacked background washes (sized per frame in
// update()), not separate bars — a bar stacked over the slider read as a
// second, draggable control it wasn't. Each layer is a two-stop flat-color
// gradient sized independently via background-size, so only that one property
// animates each frame:
//  - the tick: a 2px hard edge at the raw (pre-sensitivity) mic level, always
//    mic-green — it's a different quantity from the fill below.
//  - the fill: a solid wash out to the shaped (post-sensitivity) level — i.e.
//    where the scene is actually reacting right now. Its color rides the
//    --wash custom property (see washColor()) so only that one value needs
//    writing each frame as the level nears clipping.
// The gap between tick and fill edge is the sensitivity, visibly.
const sensitivityBoxStyle = `
  border: 1px solid ${MIC_GREEN}66; border-radius: 10px; padding: 12px; margin-bottom: 4px;
  --wash: ${MIC_GREEN}26;
  background-image:
    linear-gradient(90deg, transparent calc(100% - 2px), ${MIC_GREEN}aa 0),
    linear-gradient(var(--wash), var(--wash));
  background-repeat: no-repeat, no-repeat;
  background-size: 0% 100%, 0% 100%;
  transition: background-size 80ms linear;
`;
const boxHeadingRowStyle = `display: flex; align-items: center; gap: 6px;`;
// Second+ gain row within the same box (e.g. Acceleration below Sensitivity) —
// same layout, just separated from the row above it.
const subHeadingRowStyle = `${boxHeadingRowStyle} margin-top: 14px;`;
const boxHeadingStyle = `font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.7; flex: 1;`;
const micIconStyle = `display: flex; color: ${MIC_GREEN}; flex-shrink: 0;`;
// Standalone row, same mic-green system as the Sensitivity box below (this
// switch governs the input those controls shape) but its own compact box
// rather than another row inside sensitivityBox, since it has no slider and
// sits above the spectrum strip it directly explains.
const autoGainBoxStyle = `
  border: 1px solid ${MIC_GREEN}66; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
`;
const autoGainLabelStyle = `
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.85; color: ${MIC_GREEN};
`;
const autoGainRightStyle = `display: flex; align-items: center; gap: 8px;`;
const autoGainReadoutStyle = `font-size: 11px; opacity: 0.6; font-variant-numeric: tabular-nums;`;
const autoGainCheckboxStyle = `accent-color: ${MIC_GREEN}; width: 15px; height: 15px; margin: 0; flex-shrink: 0;`;
const sliderRowStyle = `padding: 10px 2px 0;`;
// A function, not a constant, since createGainRow instances live in more
// than one accent color now (mic-green Sensitivity/Acceleration/Smoothing, amber Bands).
const gainSliderStyle = (accent: string) => `width: 100%; accent-color: ${accent};`;
const readoutStyle = `
  flex-shrink: 0; font-variant-numeric: tabular-nums; font-size: 13px; opacity: 0.85;
`;
const resetBtnStyle = `
  background: #fff0; color: #fff; border: 1px solid #fff2; border-radius: 6px;
  padding: 4px 8px; font: inherit; font-size: 12px; cursor: pointer; opacity: 0.8;
`;
// Distinct accent from mic green, so the two boxes read as separate systems
// (mic input gain vs. this scene's own look) at a glance.
const SCENE_ACCENT = "#a78bfa";
const sceneBoxStyle = `
  border: 1px solid ${SCENE_ACCENT}66; border-radius: 10px; padding: 12px; margin-bottom: 4px;
`;
const sceneHeadingRowStyle = `display: flex; align-items: center; justify-content: space-between;`;
const sceneHeadingStyle = `
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.85; color: ${SCENE_ACCENT};
`;
const settingRowStyle = `margin-top: 10px;`;
const settingLabelRowStyle = `display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: 0.85; margin-bottom: 4px;`;
const settingLabelStyle = `flex: 1;`;
const settingReadoutStyle = `flex-shrink: 0; font-variant-numeric: tabular-nums;`;
const settingResetBtnStyle = `
  background: #fff0; color: #fff; border: none; border-radius: 4px; padding: 0 2px;
  font: inherit; font-size: 13px; line-height: 1; cursor: pointer; opacity: 0.7; flex-shrink: 0;
`;
const settingSliderStyle = `width: 100%; accent-color: ${SCENE_ACCENT};`;
const settingCheckboxStyle = `accent-color: ${SCENE_ACCENT}; width: 15px; height: 15px; margin: 0;`;
const settingDescriptionStyle = `font-size: 11px; opacity: 0.5; margin-top: 4px; line-height: 1.35;`;
// Third accent (amber), distinct from mic-green and scene-violet, so the
// Bands box reads as its own system — same reasoning as SCENE_ACCENT above.
const BANDS_ACCENT = "#f59e0b";
const bandsBoxStyle = `
  border: 1px solid ${BANDS_ACCENT}66; border-radius: 10px; padding: 12px; margin-bottom: 4px;
`;
const bandsHeadingRowStyle = `display: flex; align-items: center; justify-content: space-between;`;
const bandsHeadingStyle = `
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.85; color: ${BANDS_ACCENT};
`;
// Sits inside the (already-labelled) "Scene" box, so it's a step down from
// headingStyle rather than a repeat of it — a divider-with-caption between
// blocks of sliders, not a second top-level heading.
const settingGroupStyle = `
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.55;
  margin-top: 14px; padding-top: 10px; border-top: 1px solid #fff1;
`;
const settingGroupFirstStyle = `font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.55; margin-top: 8px;`;
// "A" chip: same base metrics as the ↺ reset button so rows don't jitter,
// but always visible when auto-capable (unlike the reset button, which is a
// change indicator) — lit means auto is driving this row right now.
const autoChipStyle = `
  background: #fff0; border: 1px solid #fff3; border-radius: 4px; padding: 0 5px;
  font: inherit; font-size: 10px; font-weight: 600; line-height: 1.5; cursor: pointer;
  flex-shrink: 0; opacity: 0.5; color: #fff;
`;
const autoChipLitStyle = `
  background: ${SCENE_ACCENT}33; border: 1px solid ${SCENE_ACCENT}; border-radius: 4px; padding: 0 5px;
  font: inherit; font-size: 10px; font-weight: 600; line-height: 1.5; cursor: pointer;
  flex-shrink: 0; opacity: 1; color: ${SCENE_ACCENT};
`;
const autoChipLitMicStyle = `
  background: ${MIC_GREEN}33; border: 1px solid ${MIC_GREEN}; border-radius: 4px; padding: 0 5px;
  font: inherit; font-size: 10px; font-weight: 600; line-height: 1.5; cursor: pointer;
  flex-shrink: 0; opacity: 1; color: ${MIC_GREEN};
`;
// Fourth accent (sky-blue), distinct from mic-green/bands-amber/scene-violet
// — the global auto system (strength knob + master switch) is its own
// system, same reasoning as the other boxes' accents.
const AUTO_ACCENT = "#38bdf8";
// flex: 1 + min-width: 0 so this box shares the row with autoMasterBtn below
// instead of spanning the panel's full width — see autoRowStyle.
const autoBoxStyle = `
  border: 1px solid ${AUTO_ACCENT}66; border-radius: 10px; padding: 12px;
  flex: 1; min-width: 0;
`;
const autoHeadingStyle = `
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.85; color: ${AUTO_ACCENT}; flex: 1;
`;
const autoStrengthSliderStyle = `width: 100%; accent-color: ${AUTO_ACCENT};`;
// Wraps autoBox + autoMasterBtn side by side — the button renders outside
// the box's border, not inside it. align-items: stretch so the button
// matches the box's height instead of floating at its vertical centre.
const autoRowStyle = `display: flex; align-items: stretch; gap: 8px; margin-bottom: 4px;`;
// The global "Auto" master switch (toggles every auto-capable row — scene
// settings plus Sensitivity/Dynamics, see app.ts's isSceneAuto wiring) sits
// outside the Auto box, in the row wrapper, so it shares that box's accent
// without being nested inside its border.
const autoMasterStyle = `
  background: #fff0; border: 1px solid ${AUTO_ACCENT}66; border-radius: 10px; padding: 4px 14px;
  font: inherit; font-size: 12px; cursor: pointer; opacity: 0.85; color: #fff; flex-shrink: 0;
`;
const autoMasterLitStyle = `
  background: ${AUTO_ACCENT}33; border: 1px solid ${AUTO_ACCENT}; border-radius: 10px; padding: 4px 14px;
  font: inherit; font-size: 12px; cursor: pointer; opacity: 1; color: ${AUTO_ACCENT}; flex-shrink: 0;
`;
// Feather "mic" icon — recolored to MIC_GREEN via currentColor.
const MIC_ICON_SVG = `
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
    <line x1="12" y1="19" x2="12" y2="23"></line>
    <line x1="8" y1="23" x2="16" y2="23"></line>
  </svg>
`;

interface GainRowSpec {
  label: string;
  /** The log curve's lower end. With zeroAtMin, this is a floor the curve
   *  approaches, not the row's actual minimum — see zeroAtMin below. */
  min: number;
  max: number;
  defaultValue: number;
  /** Only the first (Sensitivity) row gets the mic icon — subsequent rows in the same box don't repeat it. */
  icon?: string;
  /** Separates this row from one above it in the same box; omit for the first row. */
  spaced?: boolean;
  /** accent-color for this row's slider thumb/track. Defaults to mic-green
   *  (Sensitivity/Acceleration/Smoothing's own color) when omitted. */
  accent?: string;
  /** When set, the slider's bottom position snaps to exactly 0 (an explicit
   *  kill, DJ-mixer style) instead of continuing the log curve down to
   *  `min` — log(0) has no position, so 0 needs this special case. The
   *  curve itself still spans `min`..`max` across the rest of the track. */
  zeroAtMin?: boolean;
  /** Wires an auto chip into the heading row — see autoTune.ts. Omit to leave the row manual-only. */
  auto?: {
    isEnabled: () => boolean;
    toggle: (on: boolean) => void;
    resolveLive: () => number;
    /** The manually-stored value — read when the chip turns auto off, since
     *  that reveals whatever's stored, not whatever the slider happened to be showing. */
    getManual: () => number;
  };
}

/** A labeled log-mapped slider row: heading (icon + label + value + Reset) plus
 *  the slider itself. Sensitivity, Acceleration, and Smoothing are three
 *  instances of this same shape, so the construction and pos<->value mapping
 *  live here once. */
function createGainRow(spec: GainRowSpec) {
  const headingRow = document.createElement("div");
  headingRow.style.cssText = spec.spaced
    ? subHeadingRowStyle
    : boxHeadingRowStyle;

  // Always reserve the icon's width, even for rows without one, so labels
  // in the same box stay left-aligned with each other.
  const children: HTMLElement[] = [];
  const icon = document.createElement("span");
  if (spec.icon) icon.innerHTML = spec.icon;
  icon.style.cssText = micIconStyle + "width: 13px;";
  children.push(icon);

  const heading = document.createElement("div");
  heading.textContent = spec.label;
  heading.style.cssText = boxHeadingStyle;
  children.push(heading);

  const readout = document.createElement("span");
  readout.style.cssText = readoutStyle;
  children.push(readout);

  // Before Reset (matching the per-setting rows' label/readout/chip/reset order).
  const autoChip = document.createElement("button");
  autoChip.textContent = "A";
  autoChip.title = `Auto-tune ${spec.label}`;
  autoChip.style.cssText = autoChipStyle;
  if (spec.auto) children.push(autoChip);

  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset";
  resetBtn.style.cssText = resetBtnStyle;
  children.push(resetBtn);

  headingRow.append(...children);

  const sliderRow = document.createElement("div");
  sliderRow.style.cssText = sliderRowStyle;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.style.cssText = gainSliderStyle(spec.accent ?? MIC_GREEN);
  sliderRow.append(slider);

  // Log-mapped so the midpoint lands close to defaultValue (1x) instead of
  // skewing toward the wide "more reactive" end. With zeroAtMin, position 0
  // is carved out as an explicit kill and the log curve covers 1..100
  // instead of 0..100 — position 0 can't sit on the curve since log(0) is
  // undefined, and reserving a single position for it (vs. e.g. letting the
  // curve asymptote toward 0) is what makes the kill a deliberate, findable
  // stop rather than something you might land on by accident.
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
  function setReadout(value: number, auto: boolean): void {
    if (spec.zeroAtMin && value <= 0) {
      readout.textContent = `Off${auto ? " ~" : ""}`;
      return;
    }
    readout.textContent = `${value.toFixed(1)}×${auto ? " ~" : ""}`;
  }

  let onCommit: (value: number) => void = () => {};
  function commit(value: number): void {
    setReadout(value, false);
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
  slider.addEventListener("input", () =>
    commit(posToValue(Number(slider.value))),
  );
  resetBtn.addEventListener("click", () => {
    slider.value = String(valueToPos(spec.defaultValue));
    commit(spec.defaultValue);
  });

  function refreshChip(): void {
    if (!spec.auto) return;
    const on = spec.auto.isEnabled();
    autoChip.style.cssText = on ? autoChipLitMicStyle : autoChipStyle;
  }

  if (spec.auto) {
    autoChip.addEventListener("click", () => {
      const auto = spec.auto!;
      const on = !auto.isEnabled();
      auto.toggle(on);
      refreshChip();
      setValueInternal(on ? auto.resolveLive() : auto.getManual(), on);
    });
  }

  function setValueInternal(value: number, auto: boolean): void {
    slider.value = String(valueToPos(value));
    setReadout(value, auto);
  }

  return {
    headingRow,
    sliderRow,
    setValue(value: number): void {
      setValueInternal(value, false);
    },
    onChange(cb: (value: number) => void): void {
      onCommit = cb;
    },
    /** Called from the throttled per-frame refresh — pulls the live
     *  auto-resolved value while auto is on and this row isn't being dragged. */
    refreshAuto(): void {
      if (!spec.auto || dragging || !spec.auto.isEnabled()) return;
      setValueInternal(spec.auto.resolveLive(), true);
    },
    refreshChip,
  };
}

// Hot-zone ramp for the Sensitivity box's fill wash: green all the way up to
// HOT_START, then green -> yellow over the next slice, then yellow -> red in
// the last PEAK_START..1 sliver — a silent "the scene has stopped reacting,
// you're pinned at max" cue that the flat level wash alone doesn't give.
const HOT_YELLOW = "#eab308"; // yellow-500
const HOT_RED = "#ef4444"; // red-500
const HOT_START = 0.96; // last 4%: green -> yellow
const PEAK_START = 0.99; // last 1%: yellow -> red
const WASH_ALPHA = 0x26; // resting fill alpha (matches the old flat wash)
const WASH_HOT_ALPHA = 0x40; // fill alpha at full clip — needs to be more opaque to read as a warning

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
const MIC_GREEN_RGB = hexToRgb(MIC_GREEN);
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

/** The fill wash's color for a shaped level in [0,1]: mic-green below
 *  HOT_START, ramping through yellow to red as the level nears 1 (clipped). */
function washColor(level: number): string {
  let rgb = MIC_GREEN_RGB;
  let alpha = WASH_ALPHA;
  if (level >= HOT_START) {
    const t = Math.min(1, (level - HOT_START) / (PEAK_START - HOT_START));
    rgb =
      level < PEAK_START
        ? lerpRgb(MIC_GREEN_RGB, HOT_YELLOW_RGB, t)
        : lerpRgb(
            HOT_YELLOW_RGB,
            HOT_RED_RGB,
            (level - PEAK_START) / (1 - PEAK_START),
          );
    alpha = lerp(WASH_ALPHA, WASH_HOT_ALPHA, Math.min(1, (level - HOT_START) / (1 - HOT_START)));
  }
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}${toHex(alpha)}`;
}

/** Tap-to-open picker for this device's palette and per-scene mic sensitivity.
 *  Scene selection lives in the gallery — this panel no longer duplicates it. */
export function createDeviceMenu(deps: DeviceMenuDeps): DeviceMenu {
  const root = document.createElement("div");
  root.style.cssText = panelStyle;

  // Live spectrum, above everything else — a standing "is the mic actually
  // hearing anything" check, and the surface the Bands sliders' marker line
  // is drawn on. Always mounted (unlike sceneBox), since it's not tied to
  // which scene is active.
  const spectrumStrip = createSpectrumStrip();

  // Sits above the strip it directly explains: with it on, the strip's two
  // feeds ("before processing" vs. the default processed view) can look very
  // different even with every slider below at reset, because the adaptive
  // per-band auto-gain in src/audio/features.ts has no slider of its own.
  // Off trades that for a fixed mapping — same one "before processing" uses —
  // so the two feeds agree on scale, and Bands boosts (which otherwise clamp
  // against an already-maxed-out band) have real headroom to work with.
  const autoGainBox = document.createElement("div");
  autoGainBox.style.cssText = autoGainBoxStyle;
  autoGainBox.title =
    "On automatically rescales each frequency band to fill the display, converging different mics/rooms toward the same look — but flattens bass-vs-treble balance and clamps Bands boosts against an already-full band. Off (default) shows the mic's real levels; raise Sensitivity if it reads too quiet.";

  const autoGainLabel = document.createElement("span");
  autoGainLabel.textContent = "Auto-gain";
  autoGainLabel.style.cssText = autoGainLabelStyle;

  const autoGainReadout = document.createElement("span");
  autoGainReadout.style.cssText = autoGainReadoutStyle;

  const autoGainCheckbox = document.createElement("input");
  autoGainCheckbox.type = "checkbox";
  autoGainCheckbox.style.cssText = autoGainCheckboxStyle;

  function applyAutoGainChecked(enabled: boolean): void {
    autoGainCheckbox.checked = enabled;
    autoGainReadout.textContent = enabled ? "On" : "Off";
  }
  applyAutoGainChecked(deps.getAutoGainEnabled());

  autoGainCheckbox.addEventListener("change", () => {
    applyAutoGainChecked(autoGainCheckbox.checked);
    deps.onAutoGainChange(autoGainCheckbox.checked);
  });

  const autoGainRight = document.createElement("div");
  autoGainRight.style.cssText = autoGainRightStyle;
  autoGainRight.append(autoGainReadout, autoGainCheckbox);
  autoGainBox.append(autoGainLabel, autoGainRight);

  const sensitivityBox = document.createElement("div");
  sensitivityBox.style.cssText = sensitivityBoxStyle;

  const sensitivityRow = createGainRow({
    label: "Sensitivity",
    min: SENSITIVITY_MIN,
    max: SENSITIVITY_MAX,
    defaultValue: SENSITIVITY_DEFAULT,
    icon: MIC_ICON_SVG,
    auto: {
      isEnabled: () => deps.isSettingAutoEnabled(deps.currentSceneId(), deps.getSensitivitySpec().key),
      toggle: (on) => deps.onSettingAutoToggle(deps.currentSceneId(), deps.getSensitivitySpec(), on),
      resolveLive: () => deps.resolveSensitivityValue(deps.currentSceneId()),
      getManual: () => deps.getSensitivity(deps.currentSceneId()),
    },
  });
  sensitivityRow.onChange((value) =>
    deps.onSensitivityChange(deps.currentSceneId(), value),
  );

  // Widens or narrows the gap between quiet and loud, independent of the
  // overall gain Sensitivity controls — see shapeAcceleration for the curve.
  const accelerationRow = createGainRow({
    label: "Acceleration",
    min: ACCELERATION_MIN,
    max: ACCELERATION_MAX,
    defaultValue: ACCELERATION_DEFAULT,
    spaced: true,
    auto: {
      isEnabled: () => deps.isSettingAutoEnabled(deps.currentSceneId(), deps.getAccelerationSpec().key),
      toggle: (on) => deps.onSettingAutoToggle(deps.currentSceneId(), deps.getAccelerationSpec(), on),
      resolveLive: () => deps.resolveAccelerationValue(deps.currentSceneId()),
      getManual: () => deps.getAcceleration(deps.currentSceneId()),
    },
  });
  accelerationRow.onChange((value) =>
    deps.onAccelerationChange(deps.currentSceneId(), value),
  );

  // How fast the visuals chase the audio, independent of Sensitivity's gain
  // and Acceleration's curve — see smoothingRateScale for the rate mapping.
  const smoothingRow = createGainRow({
    label: "Smoothing",
    min: SMOOTHING_MIN,
    max: SMOOTHING_MAX,
    defaultValue: SMOOTHING_DEFAULT,
    spaced: true,
    auto: {
      isEnabled: () => deps.isSettingAutoEnabled(deps.currentSceneId(), deps.getSmoothingSpec().key),
      toggle: (on) => deps.onSettingAutoToggle(deps.currentSceneId(), deps.getSmoothingSpec(), on),
      resolveLive: () => deps.resolveSmoothingValue(deps.currentSceneId()),
      getManual: () => deps.getSmoothing(deps.currentSceneId()),
    },
  });
  smoothingRow.onChange((value) =>
    deps.onSmoothingChange(deps.currentSceneId(), value),
  );

  // Sensitivity/Acceleration/Smoothing share this row shape and, below, the
  // same three auto-refresh call sites (master toggle, open(), live-drift
  // refresh). Looping over one array there — instead of one hand-written
  // block per row — is what keeps a future fourth row from shipping
  // half-wired to Auto the way Smoothing initially did.
  const gainRows: { row: ReturnType<typeof createGainRow>; specKey: () => string; manualValue: () => number }[] = [
    {
      row: sensitivityRow,
      specKey: () => deps.getSensitivitySpec().key,
      manualValue: () => deps.getSensitivity(deps.currentSceneId()),
    },
    {
      row: accelerationRow,
      specKey: () => deps.getAccelerationSpec().key,
      manualValue: () => deps.getAcceleration(deps.currentSceneId()),
    },
    {
      row: smoothingRow,
      specKey: () => deps.getSmoothingSpec().key,
      manualValue: () => deps.getSmoothing(deps.currentSceneId()),
    },
  ];

  sensitivityBox.append(...gainRows.flatMap(({ row }) => [row.headingRow, row.sliderRow]));

  // Per-scene look knobs (e.g. Caustics' focus/breathe/ripple/flash). Rebuilt
  // on every open() since the set of sliders depends on which scene is active.
  const sceneBox = document.createElement("div");
  sceneBox.style.cssText = sceneBoxStyle;
  sceneBox.style.display = "none";

  const sceneHeadingRow = document.createElement("div");
  sceneHeadingRow.style.cssText = sceneHeadingRowStyle;
  const sceneHeading = document.createElement("div");
  sceneHeading.textContent = "Scene";
  sceneHeading.style.cssText = sceneHeadingStyle;
  const sceneHeadingRight = document.createElement("div");
  sceneHeadingRight.style.cssText = `display: flex; align-items: center; gap: 6px;`;
  // The global Auto master switch lives in the Auto box (below), not here —
  // it already toggles every auto-capable row, incl. Sensitivity/Dynamics,
  // via app.ts's isSceneAuto wiring, so this heading only needs Reset.
  const autoMasterBtn = document.createElement("button");
  autoMasterBtn.textContent = "Auto";
  autoMasterBtn.title = "Auto-tune everything — sensitivity, acceleration, smoothing, and every scene setting";
  autoMasterBtn.style.cssText = autoMasterStyle;
  const sceneResetBtn = document.createElement("button");
  sceneResetBtn.textContent = "Reset";
  sceneResetBtn.style.cssText = resetBtnStyle;
  sceneHeadingRight.append(sceneResetBtn);
  sceneHeadingRow.append(sceneHeading, sceneHeadingRight);

  const sceneRows = document.createElement("div");
  sceneBox.append(sceneHeadingRow, sceneRows);

  interface SceneRowHandle {
    spec: SceneSetting;
    slider: HTMLInputElement;
    readout: HTMLSpanElement;
    isDragging: () => boolean;
    updateRowResetVisibility: (value: number) => void;
  }
  let sceneRowHandles: SceneRowHandle[] = [];

  function refreshAutoMaster(): void {
    autoMasterBtn.style.cssText = deps.isSceneAuto(deps.currentSceneId())
      ? autoMasterLitStyle
      : autoMasterStyle;
  }

  autoMasterBtn.addEventListener("click", () => {
    const sceneId = deps.currentSceneId();
    const on = !deps.isSceneAuto(sceneId);
    deps.onSceneAutoToggle(sceneId, on);
    renderSceneSettings();
    for (const { row, specKey, manualValue } of gainRows) {
      row.refreshChip();
      if (deps.isSettingAutoEnabled(sceneId, specKey())) row.refreshAuto();
      else row.setValue(manualValue());
    }
  });

  function renderSceneSettings(): void {
    const sceneId = deps.currentSceneId();
    const specs = deps.getSceneSettings(sceneId);
    sceneRows.innerHTML = "";
    sceneRowHandles = [];
    sceneBox.style.display = specs.length === 0 ? "none" : "block";
    refreshAutoMaster();

    let lastGroup: string | undefined;
    for (const spec of specs) {
      if (spec.group !== undefined && spec.group !== lastGroup) {
        const groupHeading = document.createElement("div");
        groupHeading.textContent = spec.group;
        groupHeading.style.cssText = lastGroup === undefined ? settingGroupFirstStyle : settingGroupStyle;
        sceneRows.appendChild(groupHeading);
      }
      lastGroup = spec.group;

      const row = document.createElement("div");
      row.style.cssText = settingRowStyle;

      const labelRow = document.createElement("div");
      labelRow.style.cssText = settingLabelRowStyle;
      const label = document.createElement("span");
      label.textContent = spec.label;
      label.style.cssText = settingLabelStyle;
      const readout = document.createElement("span");
      readout.style.cssText = settingReadoutStyle;
      // A row with no auto weights has nothing for the chip to do — hide it
      // rather than show a toggle that can't change anything (see autoTune.ts).
      // Checkbox rows (spec.type === "boolean") never carry auto weights —
      // auto-tuning a display toggle between two discrete states doesn't fit
      // this chip's continuous glide model — so canAuto is always false
      // there and the chip stays hidden, same as any other auto-less row.
      const canAuto = !!spec.auto;
      const chip = document.createElement("button");
      chip.textContent = "A";
      chip.title = `Auto-tune ${spec.label}`;
      chip.style.cssText = autoChipStyle;
      chip.style.display = canAuto ? "" : "none";
      // Only shown once this control has actually been moved off its default —
      // doubles as a "you changed this one" marker, and visibility (not
      // display) keeps the row from reflowing while dragging.
      const rowResetBtn = document.createElement("button");
      rowResetBtn.textContent = "↺";
      rowResetBtn.title = `Reset ${spec.label}`;
      rowResetBtn.style.cssText = settingResetBtnStyle;
      labelRow.append(label, readout, chip, rowResetBtn);

      function updateRowResetVisibility(value: number): void {
        rowResetBtn.style.visibility =
          Math.abs(value - spec.default) > 1e-6 ? "visible" : "hidden";
      }

      if (spec.type === "boolean") {
        // Never auto-tunable (see the canAuto comment above), so this reads
        // straight from the manual store with no chip/resolve/slew involved.
        const current = deps.getSceneSettingValue(sceneId, spec);
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.style.cssText = settingCheckboxStyle;

        function applyChecked(value: number): void {
          checkbox.checked = value >= 0.5;
          readout.textContent = checkbox.checked ? "On" : "Off";
          updateRowResetVisibility(value);
        }
        applyChecked(current);

        checkbox.addEventListener("change", () => {
          const value = checkbox.checked ? 1 : 0;
          applyChecked(value);
          deps.onSceneSettingChange(sceneId, spec, value);
        });

        rowResetBtn.addEventListener("click", () => {
          applyChecked(spec.default);
          deps.onSceneSettingChange(sceneId, spec, spec.default);
        });

        row.append(labelRow, checkbox);
      } else {
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = String(spec.min);
        slider.max = String(spec.max);
        slider.step = String(spec.step);
        slider.style.cssText = settingSliderStyle;

        function refreshChip(): void {
          if (!canAuto) return;
          const on = deps.isSettingAutoEnabled(sceneId, spec.key);
          chip.style.cssText = on ? autoChipLitStyle : autoChipStyle;
        }

        function setDisplay(value: number, auto: boolean): void {
          slider.value = String(value);
          readout.textContent = `${value.toFixed(2)}${auto ? " ~" : ""}`;
          updateRowResetVisibility(value);
        }

        const autoNow = canAuto && deps.isSettingAutoEnabled(sceneId, spec.key);
        setDisplay(autoNow ? deps.resolveSceneSettingValue(sceneId, spec) : deps.getSceneSettingValue(sceneId, spec), autoNow);
        refreshChip();

        let dragging = false;
        slider.addEventListener("pointerdown", () => {
          dragging = true;
        });
        slider.addEventListener("pointerup", () => {
          dragging = false;
        });

        slider.addEventListener("input", () => {
          const value = Number(slider.value);
          setDisplay(value, false);
          deps.onSceneSettingChange(sceneId, spec, value);
          refreshChip();
        });

        rowResetBtn.addEventListener("click", () => {
          setDisplay(spec.default, false);
          deps.onSceneSettingChange(sceneId, spec, spec.default);
          refreshChip();
        });

        if (canAuto) {
          chip.addEventListener("click", () => {
            const on = !deps.isSettingAutoEnabled(sceneId, spec.key);
            deps.onSettingAutoToggle(sceneId, spec, on);
            refreshChip();
            setDisplay(on ? deps.resolveSceneSettingValue(sceneId, spec) : deps.getSceneSettingValue(sceneId, spec), on);
          });
        }

        row.append(labelRow, slider);

        // The live-update loop below only ever touches rows with spec.auto
        // set (see its own guard), which a checkbox row never has — so
        // there's nothing to register for one, and slider/dragging only
        // exist in this branch to begin with.
        sceneRowHandles.push({ spec, slider, readout, isDragging: () => dragging, updateRowResetVisibility });
      }

      if (spec.description) {
        const description = document.createElement("div");
        description.textContent = spec.description;
        description.style.cssText = settingDescriptionStyle;
        row.appendChild(description);
      }

      sceneRows.appendChild(row);
    }
  }

  sceneResetBtn.addEventListener("click", () => {
    deps.onSceneSettingsReset(deps.currentSceneId());
    renderSceneSettings();
  });

  // Global auto-tune strength knob — how far auto is allowed to push a
  // setting from its default (see autoTune.ts's computeAutoTarget). Global
  // per device like bandsBox below, not rebuilt per scene.
  const autoBox = document.createElement("div");
  autoBox.style.cssText = autoBoxStyle;

  const autoHeadingRow = document.createElement("div");
  autoHeadingRow.style.cssText = boxHeadingRowStyle;
  const autoHeading = document.createElement("div");
  autoHeading.textContent = "Auto strength";
  autoHeading.style.cssText = autoHeadingStyle;
  const autoStrengthReadout = document.createElement("span");
  autoStrengthReadout.style.cssText = settingReadoutStyle;
  autoHeadingRow.append(autoHeading, autoStrengthReadout);

  const autoStrengthSlider = document.createElement("input");
  autoStrengthSlider.type = "range";
  autoStrengthSlider.min = "0";
  autoStrengthSlider.max = "2";
  autoStrengthSlider.step = "0.05";
  autoStrengthSlider.style.cssText = autoStrengthSliderStyle;

  function refreshAutoStrengthDisplay(): void {
    const value = deps.getAutoStrength();
    autoStrengthSlider.value = String(value);
    autoStrengthReadout.textContent = value.toFixed(2);
  }

  autoStrengthSlider.addEventListener("input", () => {
    const value = Number(autoStrengthSlider.value);
    autoStrengthReadout.textContent = value.toFixed(2);
    deps.onAutoStrengthChange(value);
  });

  autoBox.append(autoHeadingRow, autoStrengthSlider);

  // Button sits outside autoBox's border, not inside it — see autoRowStyle.
  const autoRow = document.createElement("div");
  autoRow.style.cssText = autoRowStyle;
  autoRow.append(autoBox, autoMasterBtn);

  // Low/mid/high band gain — the DJ-mixer control (see bandGains.ts):
  // how hard each group drives the visuals, not where the dividing lines
  // sit (those are fixed — see getBandSplit below). Global per device like
  // autoBox above, not rebuilt per scene; only sceneBox needs that since its
  // set of rows depends on which scene is active.
  const bandsBox = document.createElement("div");
  bandsBox.style.cssText = bandsBoxStyle;

  const bandsHeadingRow = document.createElement("div");
  bandsHeadingRow.style.cssText = bandsHeadingRowStyle;
  const bandsHeading = document.createElement("div");
  bandsHeading.textContent = "Bands";
  bandsHeading.style.cssText = bandsHeadingStyle;
  const bandsResetBtn = document.createElement("button");
  bandsResetBtn.textContent = "Reset";
  bandsResetBtn.style.cssText = resetBtnStyle;
  bandsHeadingRow.append(bandsHeading, bandsResetBtn);

  function makeBandGainRow(label: string, group: BandGroup, spaced: boolean) {
    const gainRow = createGainRow({
      label,
      min: BAND_GAIN_LOG_FLOOR,
      max: BAND_GAIN_MAX,
      defaultValue: BAND_GAIN_DEFAULT,
      accent: BANDS_ACCENT,
      zeroAtMin: true,
      spaced,
    });
    gainRow.onChange((value) =>
      deps.onBandGainChange(deps.currentSceneId(), group, value),
    );
    return gainRow;
  }

  const lowGainRow = makeBandGainRow("Low", "low", false);
  const midGainRow = makeBandGainRow("Mid", "mid", true);
  const highGainRow = makeBandGainRow("High", "high", true);
  const bandGainRows = { low: lowGainRow, mid: midGainRow, high: highGainRow };

  bandsBox.append(
    bandsHeadingRow,
    lowGainRow.headingRow,
    lowGainRow.sliderRow,
    midGainRow.headingRow,
    midGainRow.sliderRow,
    highGainRow.headingRow,
    highGainRow.sliderRow,
  );

  // The split itself is fixed now (no more crossover sliders to drag), so
  // the strip only needs its group coloring set up once, not refreshed on
  // every open() — the edges do still depend on the analyser's real sample
  // rate, though, which isn't known until mic access is granted, so this
  // still needs to be called at least once open() has a chance to run.
  function refreshBandsSplit(): void {
    spectrumStrip.setEdgesHz(deps.getBandEdgesHz());
    spectrumStrip.setSplit(deps.getBandSplit());
  }

  function refreshBandGainRow(group: BandGroup): void {
    const sceneId = deps.currentSceneId();
    bandGainRows[group].setValue(deps.getBandGain(sceneId, group));
  }
  function refreshBandGainRows(): void {
    refreshBandGainRow("low");
    refreshBandGainRow("mid");
    refreshBandGainRow("high");
  }

  bandsResetBtn.addEventListener("click", () => {
    deps.onBandGainsReset(deps.currentSceneId());
    refreshBandGainRows();
  });

  const paletteHeading = document.createElement("div");
  paletteHeading.textContent = "Palette";
  paletteHeading.style.cssText = headingStyle;
  const paletteList = document.createElement("div");

  root.append(
    autoGainBox,
    spectrumStrip.el,
    bandsBox,
    autoRow,
    sensitivityBox,
    sceneBox,
    paletteHeading,
    paletteList,
  );
  document.body.appendChild(root);

  function renderList(
    container: HTMLElement,
    items: MenuItem[],
    currentId: string,
    onPick: (id: string) => void,
  ) {
    container.innerHTML = "";
    for (const item of items) {
      const btn = document.createElement("button");
      btn.textContent = item.id === currentId ? `● ${item.name}` : item.name;
      btn.style.cssText =
        itemStyle + (item.id === currentId ? "border-color:#fff6;" : "");
      btn.addEventListener("click", () => {
        onPick(item.id);
        // Stay open — the scene isn't hidden behind a backdrop any more, so
        // tapping through palettes to watch the scene recolor is the point.
        renderList(container, items, deps.currentPaletteId(), onPick);
      });
      container.appendChild(btn);
    }
  }

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

  function open() {
    renderList(
      paletteList,
      deps.getPalettes(),
      deps.currentPaletteId(),
      deps.onPickPalette,
    );
    const sceneId = deps.currentSceneId();
    for (const { row, specKey, manualValue } of gainRows) {
      row.refreshChip();
      if (deps.isSettingAutoEnabled(sceneId, specKey())) row.refreshAuto();
      else row.setValue(manualValue());
    }
    renderSceneSettings();
    refreshBandsSplit();
    refreshBandGainRows();
    refreshAutoStrengthDisplay();
    root.style.display = "block";
    isOpen = true;
    document.addEventListener("pointerdown", onDocPointerDown);
  }

  function close() {
    root.style.display = "none";
    isOpen = false;
    document.removeEventListener("pointerdown", onDocPointerDown);
  }

  // Cache of the last --wash value written, so update() (called every rAF
  // tick while open) only touches the DOM when the fill color actually moves.
  let lastWash = "";
  // ~10Hz — auto-driven values move on a multi-second timescale, so per-frame
  // DOM writes here would be pure cost.
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
      sensitivityBox.style.backgroundSize = `${rawPct}% 100%, ${shapedPct}% 100%`;

      // Driven off the unrounded shaped level (not shapedPct) so the ramp
      // starts exactly at HOT_START rather than snapping in 1%-wide steps.
      const wash = washColor(shaped);
      if (wash !== lastWash) {
        sensitivityBox.style.setProperty("--wash", wash);
        lastWash = wash;
      }

      // "Before processing" for the spectrum strip shows the raw feed as-is;
      // the default processed feed is the exact same sensitivity+acceleration
      // pipeline the render path applies before scene.render() (see
      // applySensitivity in app.ts) — so it always shows literally what the
      // visuals are reacting to.
      const processedBands = frame ? applySensitivity(frame, sensitivity, acceleration).bands : null;
      spectrumStrip.update(rawBands, processedBands);

      const nowMs = performance.now();
      if (nowMs - lastAutoRefreshMs < AUTO_UI_REFRESH_MS) return;
      lastAutoRefreshMs = nowMs;

      for (const { row } of gainRows) row.refreshAuto();
      for (const row of sceneRowHandles) {
        if (row.isDragging() || !row.spec.auto || !deps.isSettingAutoEnabled(sceneId, row.spec.key)) continue;
        const value = deps.resolveSceneSettingValue(sceneId, row.spec);
        row.slider.value = String(value);
        row.readout.textContent = `${value.toFixed(2)} ~`;
        row.updateRowResetVisibility(value);
      }
    },
  };
}
