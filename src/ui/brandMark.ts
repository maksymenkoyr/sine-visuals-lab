/**
 * The Sine Visuals Lab mark, built as DOM: a red-ruled black square with SINE
 * over LAB and a red VISUALS band through the middle. Typeset rather than
 * shipped as an image so it stays sharp at any size and costs nothing beyond
 * one latin font face (Shippori Mincho B1, self-hosted through Vite like the
 * panel fonts in controlsTheme.ts; license in THIRD-PARTY-NOTICES.md).
 *
 * Every dimension is the design's value at its drawn size, scaled by the
 * requested size — so the proportions live in one place, here.
 *
 * This file's code is AGPL like the rest of the app; only the mark itself —
 * the name and logo as a trademark — is reserved, which the AGPL's license
 * grant doesn't touch — see src/brand.ts.
 */
import "@fontsource/shippori-mincho-b1/latin-800.css";
import { PRODUCT_NAME } from "../brand.ts";

export const BRAND_RED = "#e8322a";
const FONT_MARK = "'Shippori Mincho B1', serif";
/** The size the design's numbers below were drawn at. */
const DRAWN_PX = 72;

export function createBrandMark(sizePx: number): HTMLElement {
  const k = sizePx / DRAWN_PX;
  const px = (n: number): string => `${(n * k).toFixed(2)}px`;

  const mark = document.createElement("div");
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", `${PRODUCT_NAME} logo`);
  mark.style.cssText = `
    width: ${px(72)}; height: ${px(72)}; box-sizing: border-box; flex: none;
    padding: ${px(5)} ${px(5.8)}; background: #000; border: ${px(1.5)} solid ${BRAND_RED};
    display: flex; flex-direction: column; justify-content: space-between;
    position: relative; overflow: hidden; user-select: none;
  `;

  const band = document.createElement("div");
  band.textContent = "VISUALS";
  band.style.cssText = `
    position: absolute; left: ${px(-2)}; right: ${px(-2)}; top: ${px(31.7)}; height: ${px(9.4)};
    background: ${BRAND_RED}; color: #000; display: flex; align-items: center; justify-content: center;
    font: 800 ${px(5.6)}/1 ${FONT_MARK}; letter-spacing: .42em; text-indent: .42em;
  `;

  const word = (letters: string): HTMLElement => {
    const row = document.createElement("div");
    row.style.cssText = `
      display: flex; justify-content: space-between; color: ${BRAND_RED};
      font: 800 ${px(22.3)}/.8 ${FONT_MARK}; letter-spacing: -.03em; transform: scaleY(1.1);
    `;
    for (const ch of letters) {
      const span = document.createElement("span");
      span.textContent = ch;
      row.appendChild(span);
    }
    return row;
  };

  const gap = document.createElement("div");
  gap.style.height = px(9.4);

  mark.append(band, word("SINE"), gap, word("LAB"));
  return mark;
}
