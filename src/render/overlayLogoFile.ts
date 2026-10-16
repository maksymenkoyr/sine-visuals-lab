import {
  LOGO_LOCAL_MAX_CHARS,
  LOGO_LOCAL_SIDES,
  LOGO_ROOM_MAX_CHARS,
  LOGO_ROOM_SIDES,
  logoSizeCandidates,
} from "./overlayLayout.ts";

/**
 * Turns a logo file the user picked (PNG, JPEG, SVG or WebP) into the PNG data
 * URL the overlay stores (render/overlayStore.ts). The image is redrawn
 * smaller, never larger, trying the sizes in LOGO_ROOM_SIDES from the biggest
 * down until the encoded PNG fits LOGO_ROOM_MAX_CHARS, so it can travel in a
 * room's look to a TV. When even the smallest is over, it is redrawn at the
 * LOGO_LOCAL_SIDES sizes instead and the result says `device`: the card tells
 * the user it stays on this device. Null means the file is not an image the
 * browser can read, or could not be made small enough for either.
 *
 * Browser-only (Image, canvas); the size rules are in overlayLayout.ts.
 */

/** Natural size to assume for a vector image that declares none. */
const SVG_FALLBACK_SIDE = 512;

export interface EncodedLogo {
  dataUrl: string;
  /** `room`: small enough for a room's look; `device`: this device only. */
  scope: "room" | "device";
}

function decode(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function encodeAt(img: HTMLImageElement, w: number, h: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

export async function encodeLogoFile(file: File): Promise<EncodedLogo | null> {
  const img = await decode(file);
  if (!img) return null;
  const naturalW = img.naturalWidth || SVG_FALLBACK_SIDE;
  const naturalH = img.naturalHeight || SVG_FALLBACK_SIDE;

  const tries: { sides: readonly number[]; max: number; scope: "room" | "device" }[] = [
    { sides: LOGO_ROOM_SIDES, max: LOGO_ROOM_MAX_CHARS, scope: "room" },
    { sides: LOGO_LOCAL_SIDES, max: LOGO_LOCAL_MAX_CHARS, scope: "device" },
  ];
  for (const t of tries) {
    for (const size of logoSizeCandidates(naturalW, naturalH, t.sides)) {
      const dataUrl = encodeAt(img, size.w, size.h);
      if (dataUrl && dataUrl.length <= t.max) return { dataUrl, scope: t.scope };
    }
  }
  return null;
}
