/**
 * The pure half of the Overlay (a line of text and a logo drawn over the
 * visuals): what the settings are, how a stored value is parsed back into
 * them, where the block sits on a canvas of a given size, and which sizes a
 * logo is tried at so its PNG stays inside the room's limits. No DOM, no GL,
 * no storage — tests/overlayLayout.test.ts drives all of it. The store is
 * overlayStore.ts, the drawing is overlayLayer.ts, the panel card is
 * ui/overlayCard.ts.
 *
 * Everything scales with the canvas height (`u` below), so the block looks the
 * same on a 4K TV and on a laptop. `size` is the user's multiplier on top.
 * Text is one line; a logo sits beside it (left positions: logo first, right
 * positions: text first) or, at the Centre, above it. A line too long for the
 * canvas shrinks to fit rather than running off the edge.
 *
 * Logo sizes: a stored logo is a PNG data URL. In a room it travels inside
 * the look document (server/lookDoc.ts), whose whole document is capped by
 * LOOK_LIMITS.maxDocBytes and shared with every other store, so a logo may use
 * only LOGO_ROOM_SHARE of that cap (LOGO_ROOM_MAX_CHARS). One that cannot be
 * made to fit stays on this device (and its pop-out window) at a larger size,
 * LOGO_LOCAL_*; the card says so.
 */

import { LOOK_LIMITS } from "../../server/lookDoc.ts";

export type OverlayPosition = "topLeft" | "topRight" | "bottomLeft" | "bottomRight" | "centre";

export const OVERLAY_POSITIONS: readonly { id: OverlayPosition; label: string }[] = [
  { id: "topLeft", label: "Top left" },
  { id: "topRight", label: "Top right" },
  { id: "bottomLeft", label: "Bottom left" },
  { id: "bottomRight", label: "Bottom right" },
  { id: "centre", label: "Centre" },
];

export interface OverlaySettings {
  /** One line; "" = no text. */
  text: string;
  position: OverlayPosition;
  /** Multiplier on the base size, OVERLAY_SIZE_MIN..OVERLAY_SIZE_MAX. */
  size: number;
  /** OVERLAY_OPACITY_MIN..1; 1 is fully opaque. */
  opacity: number;
  /** A `data:image/png;base64,` URL, or "" for no logo. */
  logo: string;
}

export const OVERLAY_TEXT_MAX_CHARS = 80;
export const OVERLAY_SIZE_MIN = 0.5;
export const OVERLAY_SIZE_MAX = 3;
export const OVERLAY_SIZE_DEFAULT = 1;
export const OVERLAY_OPACITY_MIN = 0.1;
export const OVERLAY_OPACITY_DEFAULT = 1;
export const OVERLAY_POSITION_DEFAULT: OverlayPosition = "bottomLeft";

export const OVERLAY_DEFAULTS: OverlaySettings = {
  text: "",
  position: OVERLAY_POSITION_DEFAULT,
  size: OVERLAY_SIZE_DEFAULT,
  opacity: OVERLAY_OPACITY_DEFAULT,
  logo: "",
};

/** Whether there is anything to draw: no text and no logo means no GPU work. */
export function overlayVisible(s: OverlaySettings): boolean {
  return s.text !== "" || s.logo !== "";
}

// ---- Parsing --------------------------------------------------------------

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function isPosition(v: unknown): v is OverlayPosition {
  return OVERLAY_POSITIONS.some((p) => p.id === v);
}

/** One line, no control characters, capped. A look from another device is
 *  untrusted, so everything the store reads goes through here. */
export function cleanOverlayText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const oneLine = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return oneLine.slice(0, OVERLAY_TEXT_MAX_CHARS);
}

/** A logo is only ever a PNG data URL no longer than `maxChars`; anything else
 *  (a remote URL, a script, an oversized blob) reads as no logo. */
export function cleanOverlayLogo(raw: unknown, maxChars: number): string {
  if (typeof raw !== "string" || raw.length > maxChars || !raw.startsWith(PNG_DATA_URL_PREFIX)) return "";
  return BASE64_BODY.test(raw.slice(PNG_DATA_URL_PREFIX.length)) ? raw : "";
}

/** The settings part of the store (everything but the logo), from its stored
 *  JSON text. Bad or missing text gives the defaults field by field. */
export function parseOverlaySettings(raw: string | null): Omit<OverlaySettings, "logo"> {
  const out = {
    text: OVERLAY_DEFAULTS.text,
    position: OVERLAY_DEFAULTS.position,
    size: OVERLAY_DEFAULTS.size,
    opacity: OVERLAY_DEFAULTS.opacity,
  };
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object") return out;
  const o = parsed as Record<string, unknown>;
  out.text = cleanOverlayText(o.text);
  if (isPosition(o.position)) out.position = o.position;
  if (typeof o.size === "number" && Number.isFinite(o.size)) out.size = clamp(o.size, OVERLAY_SIZE_MIN, OVERLAY_SIZE_MAX);
  if (typeof o.opacity === "number" && Number.isFinite(o.opacity)) {
    out.opacity = clamp(o.opacity, OVERLAY_OPACITY_MIN, 1);
  }
  return out;
}

// ---- Logo sizes -----------------------------------------------------------

/** The share of a look document's byte cap a logo may use (the rest belongs to
 *  every other store in the look). */
export const LOGO_ROOM_SHARE = 0.3;
export const LOGO_ROOM_MAX_CHARS = Math.floor(LOOK_LIMITS.maxDocBytes * LOGO_ROOM_SHARE);
/** A logo kept on this device only: bigger, but still bounded, because the
 *  pop-out window gets a copy of every store whenever one changes. */
export const LOGO_LOCAL_MAX_CHARS = LOOK_LIMITS.maxValueBytes * 2;

/** Longest side, in pixels, a logo is tried at for the room: the first that
 *  encodes within LOGO_ROOM_MAX_CHARS wins. */
export const LOGO_ROOM_SIDES: readonly number[] = [384, 256, 192, 128, 96];
/** The same for a logo that stays on this device. */
export const LOGO_LOCAL_SIDES: readonly number[] = [768, 512, 384, 256];

/** The sizes to try, largest first, for an image of this natural size: each
 *  scaled so its longest side is one of `sides`, never above the image's own
 *  size (no upscaling), and always at least one entry. */
export function logoSizeCandidates(
  naturalW: number,
  naturalH: number,
  sides: readonly number[],
): { w: number; h: number }[] {
  const longest = Math.max(naturalW, naturalH, 1);
  const out: { w: number; h: number }[] = [];
  const seen = new Set<number>();
  for (const side of sides) {
    const k = Math.min(1, side / longest);
    const w = Math.max(1, Math.round(naturalW * k));
    const h = Math.max(1, Math.round(naturalH * k));
    const key = Math.max(w, h);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ w, h });
  }
  return out;
}

// ---- Layout ---------------------------------------------------------------

/** Base text height, as a fraction of the canvas height `u`, at size 1. */
const FONT_FRACTION = 0.04;
/** Logo height at size 1, in text heights. */
const LOGO_HEIGHT_IN_FONTS = 2;
/** Gap between logo and text, in text heights. */
const GAP_IN_FONTS = 0.5;
/** Distance from the canvas edge, as a fraction of `u`. */
const MARGIN_FRACTION = 0.04;
/** The widest a logo may be, as a fraction of the canvas width. */
const LOGO_MAX_WIDTH_FRACTION = 0.4;
/** Line box height as a multiple of the font size. */
const LINE_HEIGHT = 1.25;
/** The shadow's blur and downward offset, in font sizes. */
const SHADOW_BLUR_IN_FONTS = 0.3;
const SHADOW_DY_IN_FONTS = 0.06;
const FONT_PX_MIN = 6;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlayLayoutInput {
  canvasW: number;
  canvasH: number;
  position: OverlayPosition;
  size: number;
  /** Text width per pixel of font size (measured by the caller); 0 = no text. */
  textAdvance: number;
  /** Logo width / height; 0 = no logo. */
  logoAspect: number;
}

export interface OverlayLayout {
  /** The pixels of the canvas the block covers, shadow room included (integers, top-left origin). */
  box: Rect;
  fontPx: number;
  /** Where the text's left edge and vertical centre are, relative to `box`. */
  textX: number;
  textMidY: number;
  /** The logo's rect relative to `box`; null = no logo. */
  logo: Rect | null;
  shadowBlurPx: number;
  shadowDyPx: number;
}

/** Where the block goes and how big its parts are. A request that gives
 *  nothing to draw, or a canvas with no area, returns null. */
export function layoutOverlay(i: OverlayLayoutInput): OverlayLayout | null {
  const hasText = i.textAdvance > 0;
  const hasLogo = i.logoAspect > 0;
  if (!hasText && !hasLogo) return null;
  if (!(i.canvasW > 0) || !(i.canvasH > 0)) return null;

  const u = i.canvasH;
  const margin = Math.round(u * MARGIN_FRACTION);
  const stacked = i.position === "centre";
  const maxW = Math.max(1, i.canvasW - 2 * margin);

  let fontPx = Math.max(FONT_PX_MIN, Math.round(u * FONT_FRACTION * i.size));
  let logoH = hasLogo ? fontPx * LOGO_HEIGHT_IN_FONTS : 0;
  let logoW = hasLogo ? logoH * i.logoAspect : 0;
  const logoCap = Math.min(maxW, i.canvasW * LOGO_MAX_WIDTH_FRACTION);
  if (hasLogo && logoW > logoCap) {
    logoW = logoCap;
    logoH = logoW / i.logoAspect;
  }
  const gap = hasLogo && hasText ? fontPx * GAP_IN_FONTS : 0;

  // A line too wide for what is left shrinks (down to FONT_PX_MIN).
  if (hasText) {
    const room = stacked ? maxW : maxW - logoW - gap;
    const fit = Math.floor(room / i.textAdvance);
    if (fit < fontPx) fontPx = Math.max(FONT_PX_MIN, fit);
  }
  const textW = hasText ? i.textAdvance * fontPx : 0;
  const lineH = hasText ? fontPx * LINE_HEIGHT : 0;

  const blockW = stacked ? Math.max(logoW, textW) : logoW + gap + textW;
  const blockH = stacked ? logoH + gap + lineH : Math.max(logoH, lineH);

  let bx: number;
  if (i.position === "topLeft" || i.position === "bottomLeft") bx = margin;
  else if (i.position === "topRight" || i.position === "bottomRight") bx = i.canvasW - margin - blockW;
  else bx = (i.canvasW - blockW) / 2;
  let by: number;
  if (i.position === "topLeft" || i.position === "topRight") by = margin;
  else if (i.position === "bottomLeft" || i.position === "bottomRight") by = i.canvasH - margin - blockH;
  else by = (i.canvasH - blockH) / 2;

  const shadowBlurPx = Math.max(2, fontPx * SHADOW_BLUR_IN_FONTS);
  const shadowDyPx = fontPx * SHADOW_DY_IN_FONTS;
  const pad = Math.ceil(shadowBlurPx * 1.5 + shadowDyPx);

  const x0 = Math.max(0, Math.floor(bx - pad));
  const y0 = Math.max(0, Math.floor(by - pad));
  const x1 = Math.min(i.canvasW, Math.ceil(bx + blockW + pad));
  const y1 = Math.min(i.canvasH, Math.ceil(by + blockH + pad));
  const box: Rect = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };

  // The parts, in canvas coordinates first.
  let logo: Rect | null = null;
  let textX: number;
  let textMidY: number;
  if (stacked) {
    if (hasLogo) logo = { x: bx + (blockW - logoW) / 2, y: by, w: logoW, h: logoH };
    textX = bx + (blockW - textW) / 2;
    textMidY = by + blockH - lineH / 2;
  } else {
    const rowMid = by + blockH / 2;
    if (i.position === "topLeft" || i.position === "bottomLeft") {
      if (hasLogo) logo = { x: bx, y: rowMid - logoH / 2, w: logoW, h: logoH };
      textX = bx + logoW + gap;
    } else {
      textX = bx;
      if (hasLogo) logo = { x: bx + textW + gap, y: rowMid - logoH / 2, w: logoW, h: logoH };
    }
    textMidY = rowMid;
  }

  return {
    box,
    fontPx,
    textX: textX - box.x,
    textMidY: textMidY - box.y,
    logo: logo && { x: logo.x - box.x, y: logo.y - box.y, w: logo.w, h: logo.h },
    shadowBlurPx,
    shadowDyPx,
  };
}
