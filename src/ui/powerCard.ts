import type { PowerMode } from "../render/powerMode.ts";
import type { Tier } from "../render/tier.ts";
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
  unitStyle,
} from "./controlsKit.ts";

/**
 * The Power card — leftmost column in the panel (deviceMenu.ts), left of the
 * Bands card. A 3-way Auto/On/Off override for the quality governor
 * (src/render/governor.ts, src/render/powerMode.ts), plus a status line and
 * readouts explaining what the governor actually decided this session and
 * why — including the one state a frame-gap-only governor can reach that
 * isn't "GPU load": paced by something outside the page (a browser
 * energy-saver mode, an OS refresh-rate cap), where it has deliberately
 * stood down rather than cutting quality for nothing (see governor.ts's
 * "Authority probe").
 *
 * Shape, top to bottom: the status line right under the title (the Bands
 * card's scene · live-dot · source line is the model — small caps mono with
 * a coloured dot, hover/tap for the long explanation), then the one control
 * — Energy saving, a row in the panel's grammar with a chip group where a
 * slider would sit — then a "Readouts" group of diagnostics. Those are
 * deliberately not rows: a row's 14.5px label is for something you act on,
 * and four of them made this card read as a settings form. They're a small
 * mono caption beside a seven-segment value, the same register as the band
 * captions under the spectrum strip.
 *
 * Read-only except the three mode chips; every value comes from
 * PowerCardDeps.getPowerStatus(), polled at the panel's existing ~10Hz
 * auto-refresh tick (see deviceMenu.ts's update()), not per frame. The mode
 * chips are never auto-tunable and stay out of the Tab ring, same as the
 * palette chips they're modeled on (deviceMenu.ts).
 */

export interface PowerStatus {
  mode: PowerMode;
  /** Detected quality tier — what "full quality" means on this device. */
  tier: Tier;
  /** Rendered-frame rate (app.ts's lastFps). */
  fps: number;
  /** Governor step index, 0 = full tier quality; null while a dev `?tier=`
   *  pin has skipped the governor entirely (see app.ts's boot()). */
  level: number | null;
  maxLevel: number;
  /** The governor's authority probe found a step down bought nothing —
   *  something outside the page is setting the render pace, not GPU load. */
  standingDown: boolean;
  /** The live drawing-buffer size in device pixels — what tier.renderScale
   *  actually produced this frame (see src/render/gl.ts's
   *  resizeCanvasToDisplaySize). */
  bufferWidth: number;
  bufferHeight: number;
}

export interface PowerCardDeps {
  getPowerMode: () => PowerMode;
  onPowerModeChange: (mode: PowerMode) => void;
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

/** What the status line and its hint say for a given snapshot — the
 *  "indication when suggested" this card exists to surface: standingDown is
 *  the one state that means "the browser is limiting frames, not this
 *  page," so it gets its own color rather than reading as either "fine" or
 *  "saving." */
function describeStatus(status: PowerStatus, accent: string): { text: string; dot: string; detail: string } {
  if (status.level === null) {
    return {
      text: "Tier pinned",
      dot: IDLE_DOT,
      detail: "A dev ?tier= override is active for this session — the governor never runs.",
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
      text: `Saving · step ${status.level}/${status.maxLevel}`,
      dot: accent,
      detail: "Sustained GPU load — quality stepped down automatically, and recovers once frames are comfortable again.",
    };
  }
  return { text: "Full quality", dot: IDLE_DOT, detail: "Rendering at the detected tier's full quality." };
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
// parts so mixed content ("2880 × 1800", "0 / 4") sets its digits in the
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
  const card = createCard({ title: "Power", accent: POWER_TEAL });
  const statusRow = createStatusRow(POWER_TEAL);
  const hairline = document.createElement("div");
  hairline.style.cssText = hairlineStyle;
  const modeRow = createModeRow(deps, POWER_TEAL);

  const readoutsHeading = document.createElement("div");
  readoutsHeading.textContent = "Readouts";
  readoutsHeading.style.cssText = groupHeadingStyle;
  const readouts = document.createElement("div");
  readouts.style.cssText = readoutListStyle;
  const fps = createReadoutLine("FPS");
  const res = createReadoutLine("Resolution");
  const step = createReadoutLine("Step");
  const tier = createReadoutLine("Tier");
  readouts.append(fps.el, res.el, step.el, tier.el);

  card.body.append(statusRow.el, hairline, modeRow.el, readoutsHeading, readouts);

  function refresh(): void {
    const status = deps.getPowerStatus();
    statusRow.refresh(status);
    modeRow.refresh(status.mode);
    fps.set(status.fps > 0 ? [digits(String(Math.round(status.fps)))] : [text("--")]);
    res.set([digits(String(status.bufferWidth)), join("×"), digits(String(status.bufferHeight))]);
    step.set(
      status.level === null
        ? [text("--")]
        : [digits(String(status.level)), join("/"), digits(String(status.maxLevel))],
    );
    tier.set([text(status.tier)]);
  }
  refresh();

  return { el: card.el, title: card.title, refresh };
}
