import { FONT_DIGITS, FONT_LABEL, FONT_MONO, glassCardStyle, scanlineStyle } from "./controlsTheme.ts";
import { isFolded, setFolded } from "./panelFolds.ts";

/**
 * The DOM grammar the controls panel (src/ui/deviceMenu.ts) and its meters
 * (src/ui/audioMeters.ts) share: the glass card, the small bordered chip
 * button, the spacer between rows, the group heading, and the styles of a
 * row head — label · seven-segment readout + unit — that a slider row and a
 * meter row are both built on. Tokens (fonts, accents, the stylesheet) live
 * in controlsTheme.ts; this is only what's assembled from them. One owner,
 * so the meters can't drift from the panel's rows by re-typing these.
 *
 * A card opts into a persisted collapse toggle via CardSpec.foldId: a
 * chevron at the far right of its header, a click anywhere on the header
 * outside `right`, and its fold state remembered in panelFolds.ts. Un-opted
 * cards (the controls column, today) are unaffected. The header's
 * margin-bottom and the pad's padding live in controlsTheme.ts's
 * .vc-card-head/.vc-card-pad rules rather than the inline styles below, so
 * .vc-folded can tighten them — an inline style would otherwise win over
 * that class rule. While folded the `right` slot is hidden too (a Reset or
 * RAW chip has nothing to act on), so a folded header is just title +
 * chevron.
 */

const cardPadStyle = `position: relative;`;
const cardHeaderStyle = `display: flex; align-items: center; gap: 8px;`;
// flex: 1 so the title takes the slack and everything after it — the
// `right` slot, then the chevron — clusters at the row's end.
const cardTitleStyle = (accent: string) =>
  `flex: 1; min-width: 0; font: 500 10.5px/1 ${FONT_MONO}; letter-spacing: 0.13em; text-transform: uppercase; color: ${accent};`;

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
// "--") fall back to the mono face via digitsTextStyle.
// The transparent stroke draws nothing; it's there to widen the text's ink
// overflow. DSEG7's ink runs edge to edge (ascent = em, descent = 0), so a
// digit's top and bottom segments sit flush with the metric box a text swap
// repaints. On a fractional baseline their antialiased edge row falls just
// outside that box and survives the swap — a "7" turning into a "1" left a
// faint hairline of the old top segment above the new digit. Every engine
// folds text-stroke width into ink overflow, unlike @font-face metric
// overrides, which WebKit ignores.
export const digitsStyle = `font-family: ${FONT_DIGITS}; font-size: 11.5px; letter-spacing: 1px; -webkit-text-stroke: 1px transparent;`;
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
  /** Opts this card into a persisted collapse toggle (panelFolds.ts): a
   *  chevron in the header, and a click anywhere on the header outside
   *  `right`. Unique per mounted card ("bands", "scope", "signal", …). */
  foldId?: string;
}

export interface CardFold {
  isFolded(): boolean;
}

/** A glass card: scanline overlay, header row (title + optional right slot),
 *  and a body the caller fills. Returns `title` too, so a caller that's also
 *  a keyboard block (deviceMenu.ts's markBlock) can badge it, and `fold`
 *  when `spec.foldId` is set, so a caller can read whether it's currently
 *  folded (audioMeters.ts skips a folded card's per-frame work). */
export function createCard(
  spec: CardSpec,
): { el: HTMLDivElement; body: HTMLDivElement; title: HTMLDivElement; fold?: CardFold } {
  const el = document.createElement("div");
  el.className = "vc-card";
  el.style.cssText = glassCardStyle;
  const scanlines = document.createElement("div");
  scanlines.style.cssText = scanlineStyle;
  const pad = document.createElement("div");
  pad.className = "vc-card-pad";
  pad.style.cssText = cardPadStyle;

  const header = document.createElement("div");
  header.className = "vc-card-head";
  header.style.cssText = cardHeaderStyle;
  const title = document.createElement("div");
  title.textContent = spec.title;
  title.style.cssText = cardTitleStyle(spec.accent);
  header.appendChild(title);
  if (spec.right) {
    spec.right.classList.add("vc-card-right");
    header.appendChild(spec.right);
  }

  const body = document.createElement("div");
  body.className = "vc-card-body";

  let fold: CardFold | undefined;
  if (spec.foldId) {
    const foldId = spec.foldId;
    body.id = `vc-card-${foldId}`;
    // The chevron itself is drawn by the .vc-fold rule (controlsTheme.ts)
    // and turned by .vc-folded — no glyph, so it's crisp at any size.
    const foldBtn = document.createElement("button");
    foldBtn.type = "button";
    foldBtn.className = "vc-fold";
    foldBtn.setAttribute("aria-controls", body.id);
    header.appendChild(foldBtn);
    header.style.cursor = "pointer";

    const apply = (folded: boolean): void => {
      el.classList.toggle("vc-folded", folded);
      foldBtn.setAttribute("aria-expanded", String(!folded));
      foldBtn.title = folded ? `Expand ${spec.title}` : `Collapse ${spec.title}`;
    };
    apply(isFolded(foldId));

    const toggle = (): void => {
      const next = !el.classList.contains("vc-folded");
      apply(next);
      setFolded(foldId, next);
    };
    // stopPropagation so a chevron click doesn't also fire the header's own
    // click-to-toggle listener below and double-toggle.
    foldBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });
    header.addEventListener("click", (e) => {
      if (spec.right?.contains(e.target as Node)) return;
      toggle();
    });

    fold = { isFolded: () => el.classList.contains("vc-folded") };
  }

  pad.append(header, body);
  el.append(scanlines, pad);
  return { el, body, title, fold };
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
