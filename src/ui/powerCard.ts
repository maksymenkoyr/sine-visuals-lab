import type { PowerMode } from "../render/powerMode.ts";
import type { Tier } from "../render/tier.ts";
import { AUTO_SKY, POWER_TEAL } from "./controlsTheme.ts";
import {
  chipBtnLitStyle,
  chipBtnStyle,
  createCard,
  digitsTextStyle,
  rowHeadStyle,
  rowLabelStyle,
  rowRightStyle,
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
const modeListStyle = `display: flex; gap: 4px; margin-top: 2px;`;
const modeChipStyle = `${chipBtnStyle} flex: 1; text-align: center;`;
const modeChipLitStyle = `${chipBtnLitStyle} flex: 1; text-align: center;`;
const dotStyle = (color: string) =>
  `width: 4px; height: 4px; border-radius: 50%; background: ${color}; flex-shrink: 0;`;
const textReadoutStyle = `${digitsTextStyle} color: #fff;`;

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
    btn.style.cssText = chipBtnStyle;
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
      text: "Pinned — full quality",
      dot: IDLE_DOT,
      detail: "Energy saving is off: quality never drops, even under sustained load.",
    };
  }
  if (status.mode === "on") {
    return {
      text: "Forced — 30fps cap",
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
      text: `Saving — step ${status.level}/${status.maxLevel}`,
      dot: accent,
      detail: "Sustained GPU load — quality stepped down automatically, and recovers once frames are comfortable again.",
    };
  }
  return { text: "Full quality", dot: IDLE_DOT, detail: "Rendering at the detected tier's full quality." };
}

// The status text varies a lot in length ("Full quality" vs. "Paced by the
// browser") — too long to sit beside the "Status" label in a 200px column
// without squeezing the label down to an ellipsis (rowHeadStyle's
// justify-content: space-between never shrinks the right side). So unlike
// createReadoutRow below, this row puts its content on its own line under
// the label, the same shape createModeRow uses for its chip group.
const statusLineStyle = `display: flex; align-items: center; gap: 6px; margin-top: 4px;`;

function createStatusRow(accent: string) {
  const el = document.createElement("div");
  el.className = "vc-row";
  el.tabIndex = 0;
  el.style.setProperty("--vc-accent", accent);

  const head = document.createElement("div");
  head.style.cssText = rowHeadStyle;
  const label = document.createElement("div");
  label.textContent = "Status";
  label.className = "vc-label";
  label.style.cssText = rowLabelStyle;
  head.appendChild(label);

  const line = document.createElement("div");
  line.style.cssText = statusLineStyle;
  const dot = document.createElement("div");
  const text = document.createElement("span");
  text.style.cssText = textReadoutStyle;
  line.append(dot, text);

  const hint = document.createElement("div");
  hint.className = "vc-hint";

  el.append(head, line, hint);

  return {
    el,
    refresh(status: PowerStatus): void {
      const described = describeStatus(status, accent);
      text.textContent = described.text;
      dot.style.cssText = dotStyle(described.dot);
      hint.textContent = described.detail;
    },
  };
}

/** A plain label/value row with no control beneath it — FPS, resolution,
 *  step, tier. Still `.vc-row` for the same padding and hover "wake" as
 *  every other row in the panel (audioMeters.ts's meter rows follow the
 *  same convention for their own read-only readouts). */
function createReadoutRow(label: string, accent: string) {
  const el = document.createElement("div");
  el.className = "vc-row";
  el.style.setProperty("--vc-accent", accent);

  const head = document.createElement("div");
  head.style.cssText = rowHeadStyle;
  const labelEl = document.createElement("div");
  labelEl.textContent = label;
  labelEl.className = "vc-label";
  labelEl.style.cssText = rowLabelStyle;
  const right = document.createElement("div");
  right.style.cssText = rowRightStyle;
  const text = document.createElement("span");
  text.style.cssText = textReadoutStyle;
  right.appendChild(text);
  head.append(labelEl, right);
  el.appendChild(head);

  return {
    el,
    setText(value: string): void {
      text.textContent = value;
    },
  };
}

export function createPowerCard(deps: PowerCardDeps): PowerCard {
  const card = createCard({ title: "Power", accent: POWER_TEAL });
  const modeRow = createModeRow(deps, POWER_TEAL);
  const statusRow = createStatusRow(POWER_TEAL);
  const fpsRow = createReadoutRow("FPS", POWER_TEAL);
  const resRow = createReadoutRow("Resolution", POWER_TEAL);
  const stepRow = createReadoutRow("Step", POWER_TEAL);
  const tierRow = createReadoutRow("Tier", POWER_TEAL);
  card.body.append(modeRow.el, statusRow.el, fpsRow.el, resRow.el, stepRow.el, tierRow.el);

  function refresh(): void {
    const status = deps.getPowerStatus();
    modeRow.refresh(status.mode);
    statusRow.refresh(status);
    fpsRow.setText(status.fps > 0 ? String(Math.round(status.fps)) : "--");
    resRow.setText(`${status.bufferWidth}×${status.bufferHeight}`);
    stepRow.setText(status.level === null ? "--" : `${status.level} / ${status.maxLevel}`);
    tierRow.setText(status.tier);
  }
  refresh();

  return { el: card.el, title: card.title, refresh };
}
