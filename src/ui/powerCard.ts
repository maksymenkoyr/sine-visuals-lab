import type { PowerMode } from "../render/powerMode.ts";
import type { QualityChoice } from "../render/qualityPref.ts";
import { RESOLUTION_MAX, RESOLUTION_MIN, type PreviewSize } from "../render/outputPower.ts";
import type { QualityPreset } from "../render/quality.ts";
import { AUTO_SKY, FONT_MONO, POWER_SQUARE_PX, POWER_TEAL, STACK_BELOW_PX, withAlpha } from "./controlsTheme.ts";
import { setHintText } from "./hintSwatches.ts";
import {
  chipBtnLitStyle,
  chipBtnStyle,
  createCard,
  digitsStyle,
  digitsTextStyle,
  groupHeadingStyle,
  readoutStyle,
  rowHeadStyle,
  rowLabelStyle,
  spacer,
  unitStyle,
} from "./controlsKit.ts";

/**
 * The Power card (deviceMenu.ts) — its own column, sitting immediately left
 * of the settings column on the right (the Bands+meters column docks
 * independently to the opposite screen edge; see controlsTheme.ts's
 * CABLE_GUTTER_PX comment for how the two sides are laid out). A
 * quality-preset override plus a 3-way Auto/On/Off override for
 * the quality governor (src/render/governor.ts, src/render/powerMode.ts),
 * plus a status line and readouts explaining what the governor actually
 * decided this session and why — including the one state a frame-gap-only
 * governor can reach that isn't "GPU load": paced by something outside the
 * page (a browser energy-saver mode, an OS refresh-rate cap), where it has
 * deliberately stood down rather than cutting quality for nothing (see
 * governor.ts's "Authority probe").
 *
 * Shape, top to bottom: the status line right under the title (the Bands
 * column's own live-dot · source line is the model — small caps mono with
 * a coloured dot, hover/tap for the long explanation), then the controls —
 * Quality (src/render/qualityPref.ts), Resolution and Energy saving; the
 * chip rows are in the panel's grammar with a chip group where a slider
 * would sit, and Resolution is the one real slider — then a "Readouts"
 * group of diagnostics. Those are deliberately not rows: a row's
 * 14.5px label is for something you act on, and four of them made this card
 * read as a settings form. They're a small mono caption beside a
 * seven-segment value, the same register as the band captions under the
 * spectrum strip.
 *
 * The same card is built twice (deviceMenu.ts), differing only in the deps and
 * options it is given: the main window's, which reads "Preview" and gains the
 * Preview size and Resolution rows while a pop-out output is open
 * (src/render/outputPower.ts), and the "Output" card that edits and reads
 * back that window's own settings. Resolution is a plain scale on the
 * drawing buffer, multiplied into the quality's own scale where the window
 * resizes its canvas; the Resolution readout below shows the pixels that
 * come out. Its slider is a `.vc-slider` but sits outside the panel's Tab
 * ring (deviceMenu.ts's ringElements), as the chips do.
 *
 * Read-only except the mode chips; every value comes from
 * PowerCardDeps.getPowerStatus(), polled at the panel's existing ~10Hz
 * auto-refresh tick (see deviceMenu.ts's update()), not per frame. The mode
 * chips are never auto-tunable and stay out of the Tab ring, same as the
 * palette chips they're modeled on (deviceMenu.ts).
 *
 * It starts folded (CardSpec.defaultFolded) until someone first opens it —
 * the quality governor runs on its own, and these readouts are diagnostics.
 * Folded, in the wide layout, this card is a small square (POWER_SQUARE_PX)
 * showing a power glyph in place of a title bar — it sits directly against
 * the settings column (deviceMenu.ts), so a plain full-width folded bar
 * would leave a wide empty strip between the two; a square instead hugs the
 * column it's next to. Unfolding animates the width open first (growing
 * leftward, away from the settings column, square -> 200px) and only then
 * the height open (growing downward) — the reverse on folding — so the
 * motion always reads as a clip opening/closing rather than the card
 * resizing in place. The card's content stays laid out at full width
 * throughout (never reflowing) and is simply clipped by the card's own
 * overflow: hidden (glassCardStyle), which is what makes that clip-opening
 * reading possible — see createPowerCard's foldTransition and
 * controlsTheme.ts's .vc-power-card rules. Below STACK_BELOW_PX the panel
 * stacks into one column and Power folds to a plain title bar like every
 * other card, no square, no animation.
 */

export interface PowerStatus {
  mode: PowerMode;
  /** The user's quality-preset choice — Auto or a pinned preset. */
  choice: QualityChoice;
  /** What Auto currently resolves to — detectQuality()'s benchmark result,
   *  or the dev `?quality=`/`?tier=` pin. Marked as recommended in the
   *  Quality row regardless of whether the user has overridden it. */
  recommended: QualityPreset;
  /** Rendered-frame rate (app.ts's lastFps). */
  fps: number;
  /** Governor step index, 0 = full quality; null while a dev
   *  `?quality=`/`?tier=` pin has skipped the governor entirely (see
   *  app.ts's boot()). */
  level: number | null;
  maxLevel: number;
  /** QUALITY_STEPS[level] as a fraction of baseline — the Detail readout. */
  fraction: number;
  /** The governor's authority probe found a step down bought nothing —
   *  something outside the page is setting the render pace, not GPU load. */
  standingDown: boolean;
  /** The live drawing-buffer size in device pixels — what quality.renderScale
   *  actually produced this frame (see src/render/gl.ts's
   *  resizeCanvasToDisplaySize). */
  bufferWidth: number;
  bufferHeight: number;
}

export interface PowerCardDeps {
  getPowerMode: () => PowerMode;
  onPowerModeChange: (mode: PowerMode) => void;
  getQualityChoice: () => QualityChoice;
  onQualityChoiceChange: (choice: QualityChoice) => void;
  getPowerStatus: () => PowerStatus;
  /** True while the card describes the main window's preview of a pop-out
   *  output (app.ts's previewActive) rather than the device itself: shows the
   *  Preview size row. The three below are only read then. */
  isPreview?: () => boolean;
  getPreviewSize?: () => PreviewSize;
  onPreviewSizeChange?: (size: PreviewSize) => void;
  /** The Resolution slider's value, a fraction from RESOLUTION_MIN to
   *  RESOLUTION_MAX. The row shows when both are given, and — if `isPreview`
   *  is — only while previewing. */
  getResolution?: () => number;
  onResolutionChange?: (value: number) => void;
}

/** What tells one Power card from another: the main window's (defaults) and
 *  the Output card, which drives the pop-out window's own settings. */
export interface PowerCardOptions {
  title?: string;
  /** Key for the card's remembered fold state. */
  foldId?: string;
  /** Names the folded square for assistive tech and its tooltip, like the title. */
  glyphLabel?: string;
}

export interface PowerCard {
  el: HTMLElement;
  title: HTMLElement;
  /** Pulls a fresh PowerStatus and updates the chips/status/readouts. */
  refresh(): void;
  /** Renames the card ("Preview" while an output is open), keeping the Beta badge. */
  setTitle(text: string): void;
  /** Shows or hides the whole card. */
  setVisible(on: boolean): void;
}

const IDLE_DOT = "rgba(255,255,255,0.3)";
const modeListStyle = `display: flex; gap: 4px; margin-top: 4px;`;
const modeChipStyle = `${chipBtnStyle} flex: 1; text-align: center; padding-top: 4px; padding-bottom: 4px;`;
const modeChipLitStyle = `${chipBtnLitStyle} flex: 1; text-align: center; padding-top: 4px; padding-bottom: 4px;`;

const MODE_OPTIONS: { mode: PowerMode; text: string; title: string }[] = [
  { mode: "auto", text: "Auto", title: "Let the quality governor decide, stepping down under load and back up once comfortable" },
  { mode: "on", text: "On", title: "Force energy saving: half the frame rate, full resolution kept" },
  { mode: "off", text: "Off", title: "Never reduce quality or frame rate, no matter the load" },
];

/** The card's one interactive row: the label plus a 3-way chip group where a
 *  slider or toggle would sit in every other row. The hint beneath explains
 *  whichever mode is currently selected. */
function createModeRow(deps: PowerCardDeps, accent: string) {
  const el = document.createElement("div");
  el.className = "vc-row";
  el.style.setProperty("--vc-accent", accent);

  const head = document.createElement("div");
  head.style.cssText = rowHeadStyle;
  const label = document.createElement("div");
  label.textContent = "Energy saving";
  label.className = "vc-label";
  label.style.cssText = rowLabelStyle;
  head.appendChild(label);

  const list = document.createElement("div");
  list.style.cssText = modeListStyle;
  const buttons = MODE_OPTIONS.map((opt) => {
    const btn = document.createElement("button");
    btn.textContent = opt.text;
    btn.title = opt.title;
    btn.style.cssText = modeChipStyle;
    btn.addEventListener("click", () => deps.onPowerModeChange(opt.mode));
    return { mode: opt.mode, btn };
  });
  list.append(...buttons.map((b) => b.btn));

  const hint = document.createElement("div");
  hint.className = "vc-hint";

  el.append(head, list, hint);

  return {
    el,
    refresh(mode: PowerMode): void {
      for (const { mode: m, btn } of buttons) {
        btn.style.cssText = m === mode ? modeChipLitStyle : modeChipStyle;
      }
      setHintText(hint, MODE_OPTIONS.find((o) => o.mode === mode)?.title ?? "");
    },
  };
}

const SIZE_OPTIONS: { size: PreviewSize; text: string }[] = [
  { size: "third", text: "1/3" },
  { size: "half", text: "1/2" },
  { size: "full", text: "Full" },
];
const SIZE_HINT = "Preview drawn at a third, half or the full window size while the output is open";

/** The Preview size row, shown only while the card describes a preview:
 *  createModeRow's shape (label, chips, hint), small to large left to right. */
function createSizeRow(deps: PowerCardDeps, accent: string) {
  const el = document.createElement("div");
  el.className = "vc-row";
  el.style.setProperty("--vc-accent", accent);

  const head = document.createElement("div");
  head.style.cssText = rowHeadStyle;
  const label = document.createElement("div");
  label.textContent = "Preview size";
  label.className = "vc-label";
  label.style.cssText = rowLabelStyle;
  head.appendChild(label);

  const list = document.createElement("div");
  list.style.cssText = modeListStyle;
  const buttons = SIZE_OPTIONS.map((opt) => {
    const btn = document.createElement("button");
    btn.textContent = opt.text;
    btn.style.cssText = modeChipStyle;
    btn.addEventListener("click", () => deps.onPreviewSizeChange?.(opt.size));
    return { size: opt.size, btn };
  });
  list.append(...buttons.map((b) => b.btn));

  const hint = document.createElement("div");
  hint.className = "vc-hint";
  setHintText(hint, SIZE_HINT);

  el.append(head, list, hint);

  return {
    el,
    refresh(size: PreviewSize): void {
      for (const { size: s, btn } of buttons) {
        btn.style.cssText = s === size ? modeChipLitStyle : modeChipStyle;
      }
    },
  };
}

const RESOLUTION_HINT =
  "Pixels drawn, as a share of the full count: 50% draws a quarter of them. Applies on top of Quality, and the Resolution readout below shows the result";
const resolutionOutStyle = `${readoutStyle} min-width: 38px; justify-content: flex-end;`;

/** The Resolution row: label and a seven-segment percentage over a plain
 *  slider, where the other rows have chips — it is a continuous scale, not a
 *  pick. Right = more pixels, up to the full count at the right end. The row
 *  commits on every drag frame (no rebuild, so the slider being dragged is
 *  never torn out). */
function createResolutionRow(deps: PowerCardDeps, accent: string) {
  const el = document.createElement("div");
  el.className = "vc-row";
  el.style.setProperty("--vc-accent", accent);

  const head = document.createElement("div");
  head.style.cssText = rowHeadStyle;
  const label = document.createElement("div");
  label.textContent = "Resolution";
  label.className = "vc-label";
  label.style.cssText = rowLabelStyle;
  const out = document.createElement("div");
  out.style.cssText = resolutionOutStyle;
  const outDigits = document.createElement("span");
  outDigits.style.cssText = digitsStyle;
  const outUnit = document.createElement("span");
  outUnit.textContent = "%";
  outUnit.style.cssText = unitStyle;
  out.append(outDigits, outUnit);
  head.append(label, out);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "vc-slider";
  slider.min = String(Math.round(RESOLUTION_MIN * 100));
  slider.max = String(Math.round(RESOLUTION_MAX * 100));
  slider.step = "5";
  slider.setAttribute("aria-label", "Resolution");
  slider.setAttribute("aria-description", RESOLUTION_HINT);

  const hint = document.createElement("div");
  hint.className = "vc-hint";
  setHintText(hint, RESOLUTION_HINT);

  el.append(head, slider, hint);

  const show = (fraction: number): void => {
    const pct = Math.round(fraction * 100);
    slider.value = String(pct);
    const lo = Number(slider.min);
    slider.style.setProperty("--vc-fill", `${((pct - lo) / (Number(slider.max) - lo)) * 100}%`);
    outDigits.textContent = String(pct);
  };
  slider.addEventListener("input", () => {
    const fraction = Number(slider.value) / 100;
    show(fraction);
    deps.onResolutionChange?.(fraction);
  });

  return { el, refresh: show };
}

// Quality row's chip group wraps rather than squeezing five chips onto one
// line — the open card (controlsTheme.ts's .vc-power-card) is 200px, too
// narrow for [Auto][High][Mid][Low][Floor] on a single row at a legible size.
const qualityListStyle = `display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;`;
const qualityChipStyle = `${chipBtnStyle} flex: 1 1 auto; text-align: center; padding-top: 4px; padding-bottom: 4px; min-width: 38px;`;
const qualityChipLitStyle = `${chipBtnLitStyle} flex: 1 1 auto; text-align: center; padding-top: 4px; padding-bottom: 4px; min-width: 38px;`;
// Independent of selected/lit: an inset underline in the accent color marks
// whichever chip Auto currently resolves to, so the recommendation stays
// visible even when the user has picked something else — and composes with
// the lit background when it's also the selected chip.
const recommendedShadow = `inset 0 -2px 0 ${withAlpha(POWER_TEAL, 0.55)}`;

const QUALITY_OPTIONS: { choice: QualityChoice; text: string }[] = [
  { choice: "auto", text: "Auto" },
  { choice: "high", text: "High" },
  { choice: "mid", text: "Mid" },
  { choice: "low", text: "Low" },
  { choice: "floor", text: "Floor" },
];

const PRESET_LABEL: Record<QualityPreset, string> = { high: "High", mid: "Mid", low: "Low", floor: "Floor" };

/** The new editable row: a wrapping chip group covering Auto plus every
 *  QualityPreset. Mirrors createModeRow's shape (label, chips, hint) but
 *  layers a second visual signal — the recommended chip's underline — on
 *  top of the ordinary selected/unselected one. */
function createQualityRow(deps: PowerCardDeps, accent: string) {
  const el = document.createElement("div");
  el.className = "vc-row";
  el.style.setProperty("--vc-accent", accent);

  const head = document.createElement("div");
  head.style.cssText = rowHeadStyle;
  const label = document.createElement("div");
  label.textContent = "Quality";
  label.className = "vc-label";
  label.style.cssText = rowLabelStyle;
  head.appendChild(label);

  const list = document.createElement("div");
  list.style.cssText = qualityListStyle;
  const buttons = QUALITY_OPTIONS.map((opt) => {
    const btn = document.createElement("button");
    btn.textContent = opt.text;
    btn.style.cssText = qualityChipStyle;
    btn.addEventListener("click", () => deps.onQualityChoiceChange(opt.choice));
    return { choice: opt.choice, btn };
  });
  list.append(...buttons.map((b) => b.btn));

  const hint = document.createElement("div");
  hint.className = "vc-hint";

  el.append(head, list, hint);

  return {
    el,
    refresh(choice: QualityChoice, recommended: QualityPreset): void {
      for (const { choice: c, btn } of buttons) {
        const selected = c === choice;
        const isRecommended = c === recommended;
        btn.style.cssText = selected ? qualityChipLitStyle : qualityChipStyle;
        if (isRecommended) btn.style.boxShadow = recommendedShadow;
        btn.title =
          c === "auto"
            ? `Follow this device's detected quality (currently ${PRESET_LABEL[recommended]})`
            : isRecommended
              ? `${PRESET_LABEL[c]} — this device's recommended quality`
              : PRESET_LABEL[c];
      }
      setHintText(
        hint,
        choice === "auto"
          ? `Auto — following this device (${PRESET_LABEL[recommended]})`
          : choice === recommended
            ? `${PRESET_LABEL[choice]} — matches this device's recommendation`
            : `${PRESET_LABEL[choice]} — overriding the recommended ${PRESET_LABEL[recommended]}`,
      );
    },
  };
}

/** What the status line and its hint say for a given snapshot — the
 *  "indication when suggested" this card exists to surface: standingDown is
 *  the one state that means "the browser is limiting frames, not this
 *  page," so it gets its own color rather than reading as either "fine" or
 *  "saving." */
function describeStatus(status: PowerStatus, accent: string): { text: string; dot: string; detail: string } {
  if (status.level === null) {
    return {
      text: "Quality pinned",
      dot: IDLE_DOT,
      detail: "A dev ?quality= override is active for this session — the governor never runs.",
    };
  }
  if (status.mode === "off") {
    return {
      text: "Pinned · full quality",
      dot: IDLE_DOT,
      detail: "Energy saving is off: quality never drops, even under sustained load.",
    };
  }
  if (status.mode === "on") {
    return {
      text: "Forced · 30 fps cap",
      dot: accent,
      detail: "Energy saving is forced on: the render rate is capped, full resolution is kept.",
    };
  }
  if (status.standingDown) {
    return {
      text: "Paced by the browser",
      dot: AUTO_SKY,
      detail:
        "Frames are arriving slower than this device can otherwise manage — likely a browser or OS power-saving mode, not GPU load. Quality is left alone.",
    };
  }
  if (status.level > 0) {
    return {
      text: `Saving · ${Math.round(status.fraction * 100)}% detail`,
      dot: accent,
      detail: "Sustained GPU load — quality stepped down automatically, and recovers once frames are comfortable again.",
    };
  }
  return { text: "Full quality", dot: IDLE_DOT, detail: "Rendering at the chosen quality's full detail." };
}

// The status line: the same small-caps mono register as the Bands card's
// "● SYNTHETIC" source line (deviceMenu.ts's statusTextStyle), a shade
// brighter since here it's the headline, not a footnote. It's a .vc-row so
// hovering or tapping it unfolds the explanation the way every row's hint
// does; the hairline beneath closes the header block the way the Bands
// card's does.
const statusLineStyle = `display: flex; align-items: center; gap: 7px; min-height: 16px;`;
const statusTextStyle = `
  font: 400 10.5px/1 ${FONT_MONO}; letter-spacing: 0.1em; text-transform: uppercase;
  color: rgba(255,255,255,0.8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const statusDotStyle = (color: string) =>
  `width: 4px; height: 4px; border-radius: 50%; background: ${color}; flex-shrink: 0; transition: background-color 0.3s ease;`;
const hairlineStyle = `height: 1px; background: ${withAlpha(POWER_TEAL, 0.35)}; margin: 10px 0 12px;`;
// Small pill after the title text, flagging the governor's readouts/modes as
// still settling — same mono/uppercase register as the title, dimmer.
const betaBadgeStyle = `
  display: inline-block; margin-left: 6px; font: 500 8px/1 ${FONT_MONO}; letter-spacing: 0.08em;
  text-transform: uppercase; color: ${POWER_TEAL}; background: ${withAlpha(POWER_TEAL, 0.15)};
  border: 1px solid ${withAlpha(POWER_TEAL, 0.4)}; border-radius: 999px; padding: 1px 6px;
  vertical-align: middle;
`;

function createStatusRow(accent: string) {
  const el = document.createElement("div");
  el.className = "vc-row";
  el.tabIndex = 0;
  el.style.setProperty("--vc-accent", accent);

  const line = document.createElement("div");
  line.style.cssText = statusLineStyle;
  const dot = document.createElement("div");
  dot.style.cssText = statusDotStyle(IDLE_DOT);
  const text = document.createElement("span");
  text.style.cssText = statusTextStyle;
  line.append(dot, text);

  const hint = document.createElement("div");
  hint.className = "vc-hint";

  el.append(line, hint);

  return {
    el,
    refresh(status: PowerStatus): void {
      const described = describeStatus(status, accent);
      text.textContent = described.text;
      el.title = described.detail;
      dot.style.backgroundColor = described.dot;
      setHintText(hint, described.detail);
    },
  };
}

// One diagnostic line: caption left, value right. The value is a run of
// parts so mixed content ("2880 × 1800", "60 %") sets its digits in the
// seven-segment face and the joiners in the mono face DSEG7 lacks — the
// same split every readout in the panel makes between digits and unit.
const readoutListStyle = `display: flex; flex-direction: column; gap: 7px;`;
const readoutLineStyle = `display: flex; align-items: baseline; justify-content: space-between; gap: 8px;`;
const readoutCaptionStyle = `
  font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(255,255,255,0.5); white-space: nowrap;
`;
const readoutValueStyle = `display: flex; align-items: baseline; gap: 3px; color: #fff; flex-shrink: 0;`;
const readoutDigitsStyle = `${digitsStyle} font-size: 11px;`;
const readoutTextStyle = `${digitsTextStyle} letter-spacing: 0.08em; text-transform: uppercase;`;
const readoutJoinStyle = `${unitStyle} font-size: 10px;`;

type ReadoutPart = { kind: "digits" | "text" | "join"; text: string };
const digits = (text: string): ReadoutPart => ({ kind: "digits", text });
const text = (text: string): ReadoutPart => ({ kind: "text", text });
const join = (text: string): ReadoutPart => ({ kind: "join", text });

function createReadoutLine(caption: string) {
  const el = document.createElement("div");
  el.style.cssText = readoutLineStyle;
  const captionEl = document.createElement("div");
  captionEl.textContent = caption;
  captionEl.style.cssText = readoutCaptionStyle;
  const value = document.createElement("div");
  value.style.cssText = readoutValueStyle;
  el.append(captionEl, value);

  let last = "";
  return {
    el,
    set(parts: ReadoutPart[]): void {
      const key = parts.map((p) => `${p.kind}:${p.text}`).join("|");
      if (key === last) return;
      last = key;
      value.replaceChildren(
        ...parts.map((p) => {
          const span = document.createElement("span");
          span.textContent = p.text;
          span.style.cssText =
            p.kind === "digits" ? readoutDigitsStyle : p.kind === "text" ? readoutTextStyle : readoutJoinStyle;
          return span;
        }),
      );
    },
  };
}

export function createPowerCard(deps: PowerCardDeps, opts: PowerCardOptions = {}): PowerCard {
  const title = opts.title ?? "Power";
  const foldId = opts.foldId ?? "power";
  const glyphLabel = opts.glyphLabel ?? title;
  // Only read at the moment of a fold click, so a viewport/preference change
  // between clicks always takes effect on the next one — no resize listener
  // needed, matchMedia's own .matches is always current.
  const WIDE = window.matchMedia(`(min-width: ${STACK_BELOW_PX + 1}px)`);
  const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)");
  // Every animation of the transition in flight (size, content fade, glyph
  // fade) — a second click mid-transition cancels them all together.
  let running: Animation[] = [];
  const stopRunning = (): void => {
    for (const a of running) a.cancel();
    running = [];
  };
  // cardEl/pad/square are assigned right after createCard returns, below —
  // foldTransition itself only ever runs later, from a click.
  let cardEl!: HTMLDivElement;
  let pad!: HTMLElement;
  let square!: HTMLButtonElement;

  // Width and height are two eased moves, not one keyframe list with a
  // corner in it: that version came to a dead stop between the two phases
  // (one eased out to zero speed, the other eased in from rest). Starting
  // the second move OVERLAP_MS before the first ends rounds the corner off
  // while it still reads as "left, then down".
  const EASE = "cubic-bezier(.4,0,.2,1)";
  const PHASE_MS = 320;
  const OVERLAP_MS = 100;
  // The card's content and the glyph crossfade inside the square's own
  // footprint: at the tail of a fold, the start of an unfold. Without it the
  // square briefly shows the header's chevron (the pad's right end) before
  // the glyph arrives, or both at once.
  const FADE_MS = 180;

  // Folded, in the wide layout, Power is a square that opens leftward
  // (width) before downward (height) — see this file's own header comment
  // for why. Folding reverses that. The stacked layout, reduced motion, and
  // very old browsers without Element.animate all skip straight to the
  // plain class toggle (apply()).
  function foldTransition(folding: boolean, apply: () => void): void {
    const el = cardEl;
    if (!WIDE.matches || REDUCE.matches || typeof el.animate !== "function") {
      stopRunning();
      apply();
      return;
    }
    // Measured before cancelling, so a click mid-transition carries on from
    // wherever the previous one had got to rather than jumping.
    const wasFolded = el.classList.contains("vc-folded");
    const from = el.getBoundingClientRect();
    const padFrom = wasFolded ? 0 : Number(getComputedStyle(pad).opacity);
    const glyphFrom = wasFolded ? 1 : Number(getComputedStyle(square).opacity);
    stopRunning();
    // A move with nothing left to do (a click that reversed a transition
    // part-way) takes no time, so the other one doesn't sit waiting for it.
    const phase = (a: number, b: number): number => (Math.abs(a - b) < 0.5 ? 0 : PHASE_MS);
    const secondDelay = (firstMs: number): number => Math.max(0, firstMs - OVERLAP_MS);
    const move = (prop: "width" | "height", a: number, b: number, delay: number, duration: number, fill: FillMode) =>
      el.animate([{ [prop]: `${a}px` }, { [prop]: `${b}px` }], { delay, duration, easing: EASE, fill });
    const fade = (target: HTMLElement, a: number, b: number, delay: number, fill: FillMode) =>
      target.animate(
        [
          { visibility: "visible", opacity: a },
          { visibility: "visible", opacity: b },
        ],
        { delay, duration: FADE_MS, easing: "ease", fill },
      );
    if (folding) {
      // Up first, then right into the square. apply() — the class flip that
      // hides the pad and shows the glyph for good — lands only once both
      // moves finish; until then `fill` holds each end state.
      const upMs = phase(from.height, POWER_SQUARE_PX);
      const rightAt = secondDelay(upMs);
      const rightMs = phase(from.width, POWER_SQUARE_PX);
      const fadeAt = Math.max(0, rightAt + rightMs - FADE_MS);
      const up = move("height", from.height, POWER_SQUARE_PX, 0, upMs, "forwards");
      const right = move("width", from.width, POWER_SQUARE_PX, rightAt, rightMs, "both");
      running = [up, right, fade(pad, padFrom, 0, fadeAt, "both"), fade(square, glyphFrom, 1, fadeAt, "both")];
      Promise.all([up.finished, right.finished]).then(
        () => {
          apply();
          stopRunning();
        },
        // A cancelled animation's `finished` rejects — a newer transition
        // (e.g. a second click mid-fold) superseded this one, and it's that
        // transition's own apply() that gets to run, never this one.
        () => {},
      );
    } else {
      // Left first, then down.
      apply(); // class off -> natural size
      const to = el.getBoundingClientRect();
      const leftMs = phase(from.width, to.width);
      const left = move("width", from.width, to.width, 0, leftMs, "none");
      const down = move("height", from.height, to.height, secondDelay(leftMs), phase(from.height, to.height), "backwards");
      running = [left, down, fade(pad, padFrom, 1, 0, "backwards"), fade(square, glyphFrom, 0, 0, "none")];
      Promise.all([left.finished, down.finished]).then(stopRunning, () => {});
    }
  }

  const card = createCard({ title, accent: POWER_TEAL, foldId, defaultFolded: true, foldTransition });
  cardEl = card.el;
  cardEl.classList.add("vc-power-card");
  pad = cardEl.querySelector<HTMLElement>(".vc-card-pad")!;

  // The compact power glyph shown only while folded (controlsTheme.ts's
  // .vc-power-card.vc-folded > .vc-power-square) — appended to the card
  // element itself, not the pad, so it survives the pad's own
  // visibility: hidden while folded (see this file's header comment).
  square = document.createElement("button");
  square.type = "button";
  square.className = "vc-power-square";
  square.setAttribute("aria-label", `Expand ${glyphLabel}`);
  square.title = `Expand ${glyphLabel}`;
  square.setAttribute("aria-controls", card.body.id);
  square.innerHTML =
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M5.2 3.9a5.2 5.2 0 1 0 5.6 0"/>' +
    '<path d="M8 2v5.5"/>' +
    "</svg>";
  // stopPropagation: the header's own click-to-toggle listener (createCard)
  // doesn't cover this button (it isn't inside the header), but it costs
  // nothing to be explicit and it matches every other in-card control's
  // click handling.
  square.addEventListener("click", (e) => {
    e.stopPropagation();
    card.fold!.toggle();
  });
  cardEl.appendChild(square);

  const betaBadge = document.createElement("span");
  betaBadge.textContent = "Beta";
  betaBadge.style.cssText = betaBadgeStyle;
  card.title.appendChild(betaBadge);
  const statusRow = createStatusRow(POWER_TEAL);
  const hairline = document.createElement("div");
  hairline.style.cssText = hairlineStyle;
  const qualityRow = createQualityRow(deps, POWER_TEAL);
  const modeRow = createModeRow(deps, POWER_TEAL);
  const sizeRow = createSizeRow(deps, POWER_TEAL);
  sizeRow.el.style.display = "none";
  const resolutionRow = createResolutionRow(deps, POWER_TEAL);
  resolutionRow.el.style.display = "none";

  const readoutsHeading = document.createElement("div");
  readoutsHeading.textContent = "Readouts";
  readoutsHeading.style.cssText = groupHeadingStyle;
  const readouts = document.createElement("div");
  readouts.style.cssText = readoutListStyle;
  const fps = createReadoutLine("FPS");
  const res = createReadoutLine("Resolution");
  const detail = createReadoutLine("Detail");
  readouts.append(fps.el, res.el, detail.el);

  card.body.append(
    statusRow.el,
    hairline,
    qualityRow.el,
    resolutionRow.el,
    spacer(),
    sizeRow.el,
    modeRow.el,
    readoutsHeading,
    readouts,
  );

  function refresh(): void {
    const status = deps.getPowerStatus();
    statusRow.refresh(status);
    qualityRow.refresh(status.choice, status.recommended);
    const preview = deps.isPreview?.() ?? false;
    sizeRow.el.style.display = preview ? "" : "none";
    if (preview && deps.getPreviewSize) sizeRow.refresh(deps.getPreviewSize());
    // The Output card has no isPreview and always shows its row; the main
    // card's follows the preview, like the size row above.
    const resolutionShown = !!deps.getResolution && (deps.isPreview ? preview : true);
    resolutionRow.el.style.display = resolutionShown ? "" : "none";
    if (resolutionShown) resolutionRow.refresh(deps.getResolution!());
    modeRow.refresh(status.mode);
    fps.set(status.fps > 0 ? [digits(String(Math.round(status.fps)))] : [text("--")]);
    res.set([digits(String(status.bufferWidth)), join("×"), digits(String(status.bufferHeight))]);
    detail.set(status.level === null ? [text("--")] : [digits(String(Math.round(status.fraction * 100))), join("%")]);
  }
  refresh();

  function setTitle(text: string): void {
    const node = card.title.firstChild;
    if (node && node.nodeType === Node.TEXT_NODE) {
      if ((node as Text).data !== text) (node as Text).data = text;
    }
    const label = `Expand ${opts.glyphLabel ?? text}`;
    if (square.title !== label) {
      square.title = label;
      square.setAttribute("aria-label", label);
    }
  }

  function setVisible(on: boolean): void {
    card.el.style.display = on ? "" : "none";
  }

  return { el: card.el, title: card.title, refresh, setTitle, setVisible };
}
