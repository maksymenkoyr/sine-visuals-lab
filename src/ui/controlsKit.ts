import { FONT_DIGITS, FONT_LABEL, FONT_MONO, glassCardStyle, scanlineStyle } from "./controlsTheme.ts";

/**
 * The DOM grammar the controls panel (src/ui/deviceMenu.ts) and its meters
 * (src/ui/audioMeters.ts) share: the glass card, the small bordered chip
 * button, the spacer between rows, the group heading, and the styles of a
 * row head — label · seven-segment readout + unit — that a slider row and a
 * meter row are both built on. Tokens (fonts, accents, the stylesheet) live
 * in controlsTheme.ts; this is only what's assembled from them. One owner,
 * so the meters can't drift from the panel's rows by re-typing these.
 */

const cardBodyStyle = `position: relative; padding: 10px 12px 12px;`;
const cardHeaderStyle = `display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 9px;`;
const cardTitleStyle = (accent: string) =>
  `font: 500 10.5px/1 ${FONT_MONO}; letter-spacing: 0.13em; text-transform: uppercase; color: ${accent};`;

// Small bordered text button — "Reset" in card headers, "RAW" in the
// spectrum header. Lit variant = currently active.
export const chipBtnStyle = `
  font: 400 9.5px/1.2 ${FONT_MONO}; letter-spacing: 0.04em; color: rgba(255,255,255,0.55);
  background: transparent; border: 1px solid rgba(255,255,255,0.18); border-radius: 4px;
  padding: 2.5px 7px; cursor: pointer;
`;
export const chipBtnLitStyle = `${chipBtnStyle} color: #fff; border-color: rgba(255,255,255,0.5);`;

export const rowHeadStyle = `display: flex; align-items: center; justify-content: space-between; gap: 8px;`;
// Color lives in the .vc-label rule (controlsTheme.ts) so the hover/focus
// tint can override it — an inline color would win over the stylesheet.
export const rowLabelStyle = `
  font: 300 14.5px/1.2 ${FONT_LABEL}; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
export const rowRightStyle = `display: flex; align-items: center; gap: 7px; flex-shrink: 0;`;
export const readoutStyle = `display: flex; align-items: baseline; gap: 4px; color: #fff;`;
// Seven-segment digits; DSEG7 has no letters, so text readouts ("Off"/"On",
// "mono") fall back to the mono face via digitsTextStyle.
export const digitsStyle = `font-family: ${FONT_DIGITS}; font-size: 11.5px; letter-spacing: 1px;`;
export const digitsTextStyle = `font: 400 11px/1 ${FONT_MONO};`;
export const unitStyle = `font: 400 10.5px/1 ${FONT_MONO}; color: rgba(255,255,255,0.75);`;

const rowSpacerStyle = `height: 12px;`;
// A divider-with-caption between blocks of rows — a step down from a card
// title, not a second one.
export const groupHeadingStyle = `
  font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(255,255,255,0.45); margin: 14px 0 8px; padding-top: 10px;
  border-top: 1px solid rgba(255,255,255,0.1);
`;
export const groupHeadingFirstStyle = `
  font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(255,255,255,0.45); margin: 2px 0 8px;
`;

export function createChipButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = text;
  btn.title = title;
  btn.style.cssText = chipBtnStyle;
  btn.addEventListener("click", onClick);
  return btn;
}

export interface CardSpec {
  title: string;
  accent: string;
  /** Right-hand header slot — a Reset chip, a readout, … */
  right?: HTMLElement;
}

/** A glass card: scanline overlay, header row (title + optional right slot),
 *  and a body the caller fills. */
export function createCard(spec: CardSpec): { el: HTMLDivElement; body: HTMLDivElement } {
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

export function spacer(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = rowSpacerStyle;
  return el;
}

export function groupHeading(text: string, first = false): HTMLElement {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = first ? groupHeadingFirstStyle : groupHeadingStyle;
  return el;
}
