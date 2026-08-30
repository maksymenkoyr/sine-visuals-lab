import type { PowerMode } from "../render/powerMode.ts";
import type { QualityChoice } from "../render/qualityPref.ts";
import type { QualityPreset } from "../render/quality.ts";
import { AUTO_SKY, FONT_MONO, POWER_TEAL, withAlpha } from "./controlsTheme.ts";
import {
  chipBtnLitStyle,
  chipBtnStyle,
  createCard,
  digitsStyle,
  digitsTextStyle,
  groupHeadingStyle,
  rowHeadStyle,
  rowLabelStyle,
  spacer,
  unitStyle,
} from "./controlsKit.ts";

/**
 * The Power card — leftmost column in the panel (deviceMenu.ts), left of the
 * Bands card. A quality-preset override plus a 3-way Auto/On/Off override for
 * the quality governor (src/render/governor.ts, src/render/powerMode.ts),
 * plus a status line and readouts explaining what the governor actually
 * decided this session and why — including the one state a frame-gap-only
 * governor can reach that isn't "GPU load": paced by something outside the
 * page (a browser energy-saver mode, an OS refresh-rate cap), where it has
 * deliberately stood down rather than cutting quality for nothing (see
 * governor.ts's "Authority probe").
 *
 * Shape, top to bottom: the status line right under the title (the Bands
 * card's scene · live-dot · source line is the model — small caps mono with
 * a coloured dot, hover/tap for the long explanation), then two controls —
 * Quality (src/render/qualityPref.ts) and Energy saving, both rows in the
 * panel's grammar with a chip group where a slider would sit — then a
 * "Readouts" group of diagnostics. Those are deliberately not rows: a row's
 * 14.5px label is for something you act on, and four of them made this card
 * read as a settings form. They're a small mono caption beside a
 * seven-segment value, the same register as the band captions under the
 * spectrum strip.
 *
 * Read-only except the mode chips; every value comes from
 * PowerCardDeps.getPowerStatus(), polled at the panel's existing ~10Hz
 * auto-refresh tick (see deviceMenu.ts's update()), not per frame. The mode
 * chips are never auto-tunable and stay out of the Tab ring, same as the
 * palette chips they're modeled on (deviceMenu.ts).
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
}

export interface PowerCard {
  el: HTMLElement;
  title: HTMLElement;
  /** Pulls a fresh PowerStatus and updates the chips/status/readouts. */
  refresh(): void;
}

const IDLE_DOT = "rgba(255,255,255,0.3)";
const modeListStyle = `display: flex; gap: 4px; margin-top: 4px;`;
const modeChipStyle = `${chipBtnStyle} flex: 1; text-align: center; padding-top: 4px; padding-bottom: 4px;`;
const modeChipLitStyle = `${chipBtnLitStyle} flex: 1; text-align: center; padding-top: 4px; padding-bottom: 4px;`;

const MODE_OPTIONS: { mode: PowerMode; text: string; title: string }[] = [
  { mode: "auto", text: "Auto", title: "Let the quality governor decide — the recommended setting" },
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
      hint.textContent = MODE_OPTIONS.find((o) => o.mode === mode)?.title ?? "";
    },
  };
}

// Quality row's chip group wraps rather than squeezing five chips onto one
// line — the column (controlsTheme.ts's .vc-power-col) is 200px, too narrow
// for [Auto][High][Mid][Low][Floor] on a single row at a legible size.
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
      hint.textContent =
        choice === "auto"
          ? `Auto — following this device (${PRESET_LABEL[recommended]})`
          : choice === recommended
            ? `${PRESET_LABEL[choice]} — matches this device's recommendation`
            : `${PRESET_LABEL[choice]} — overriding the recommended ${PRESET_LABEL[recommended]}`;
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
      hint.textContent = described.detail;
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

export function createPowerCard(deps: PowerCardDeps): PowerCard {
  const card = createCard({ title: "Power", accent: POWER_TEAL, foldId: "power" });
  const betaBadge = document.createElement("span");
  betaBadge.textContent = "Beta";
  betaBadge.style.cssText = betaBadgeStyle;
  card.title.appendChild(betaBadge);
  const statusRow = createStatusRow(POWER_TEAL);
  const hairline = document.createElement("div");
  hairline.style.cssText = hairlineStyle;
  const qualityRow = createQualityRow(deps, POWER_TEAL);
  const modeRow = createModeRow(deps, POWER_TEAL);

  const readoutsHeading = document.createElement("div");
  readoutsHeading.textContent = "Readouts";
  readoutsHeading.style.cssText = groupHeadingStyle;
  const readouts = document.createElement("div");
  readouts.style.cssText = readoutListStyle;
  const fps = createReadoutLine("FPS");
  const res = createReadoutLine("Resolution");
  const detail = createReadoutLine("Detail");
  readouts.append(fps.el, res.el, detail.el);

  card.body.append(statusRow.el, hairline, qualityRow.el, spacer(), modeRow.el, readoutsHeading, readouts);

  function refresh(): void {
    const status = deps.getPowerStatus();
    statusRow.refresh(status);
    qualityRow.refresh(status.choice, status.recommended);
    modeRow.refresh(status.mode);
    fps.set(status.fps > 0 ? [digits(String(Math.round(status.fps)))] : [text("--")]);
    res.set([digits(String(status.bufferWidth)), join("×"), digits(String(status.bufferHeight))]);
    detail.set(status.level === null ? [text("--")] : [digits(String(Math.round(status.fraction * 100))), join("%")]);
  }
  refresh();

  return { el: card.el, title: card.title, refresh };
}
