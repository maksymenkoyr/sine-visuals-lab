/**
 * The little picture next to each saved look in the Looks card: a green
 * alien-cat meme the user picked to go with the alien-language look names
 * (src/render/lookNames.ts), shrunk to `ICON_W` × `ICON_H` pixels and drawn
 * one CSS pixel each with hard edges, so a 2x screen shows crisp blocks
 * rather than a smeared upscale. Its author and license are unknown —
 * THIRD-PARTY-NOTICES.md says so; the full-size picture is not in this repo.
 *
 * Every look tints it differently: one of the `FILTERS` (each a CSS filter
 * with a hue slot) and the hue it's turned to both come from a hash of the
 * look's name. No new field on SceneLook, so the share-code format is
 * untouched, and a shared look shows the same colour on both ends. Renaming
 * a look recolours it.
 *
 * The PNG is inline (a data: URI in this module) rather than a file next to
 * it: an image the page fetched later could 404 after a deploy — see
 * src/pinnedAssets.ts's header. It was made with Pillow from the full
 * picture: converted to sRGB (a pasted screenshot carries its display's
 * colour profile, and keeping it would multiply the bytes), cropped to the
 * icon's shape, box-filter downscaled to `ICON_W` × `ICON_H` and quantized to
 * a small palette to keep the bytes down.
 */

const ICON_SRC =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB4AAAAYCAMAAADat72NAAAAYFBMVEX09e7r797q6tnd5snR1sLGyrrBzK6xzJnCwbu5vq+4t62vq6GauYGbpIt8sGRwo1SCk25hkEdrf1pYeEYziCYzeCQ+bjElaxkmXhoPXAkHWQMHUwMNSggFSAIJKgUFDwLAT5I/AAABjUlEQVR42j3S27arIAwFUFBEqVwENIi3/v9fnhXcp3myYyaQ0AjvvR1HPU2TMZ//MbuwlrKOWvg1xuitMazzX7hcyhat1mIMSFvj4ma3LEtCLItzIQY76mEQBl4LxdQo5ZxbBhCqxKS1XcuWad+Jcgt8lhysVkqJQWvtaSv1vs+6b5RT3s7zrJTsoHoxwNP1PM99t4TsY7nv5/tNWffMw7h/OZ7mBH74J2UF1j9mP48tBGJ+9qXvOmZD9/PjEn3EXVfdRvmyzsd5v3EeNfpA9ahb0AI8gVOpx4F2T+bV+0gU/dg1hru8lVLfFLDlZx6VlJ0ET8OciCdvfBRv+Un7Dle/rF0m+jsfvVmP6sZ8OGJOmRl+VLTuW3XX950wzMalxoi6xhC81eBOSmFM2wOXynt1xb/7qhQIkGn1VHn4q/IeKBTKxtgNTsDxpV73tVPGUL0QrwqHaPuTCL5TXDBy9+PfejFjJRI2U6Oa+0bKx7Tep8a8VYtFY1JIxdGeZVDqs2QqWCLCyFgjTMz1/T+czirA7e51RQAAAABJRU5ErkJggg==";
const ICON_W = 30;
const ICON_H = 24;

/** `#` is the hue angle in degrees. */
const FILTERS = [
  "hue-rotate(#deg) saturate(1.6)",
  "hue-rotate(#deg) saturate(3) contrast(1.3)",
  "invert(1) hue-rotate(#deg) saturate(1.4)",
  "sepia(1) hue-rotate(#deg) saturate(4)",
];

/** FNV-1a: a cheap, stable 32-bit hash of the name. */
function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The CSS filter a look named `name` is tinted with. */
export function lookIconFilter(name: string): string {
  const h = hashName(name);
  return FILTERS[(h >>> 9) % FILTERS.length].replace("#", String(h % 360));
}

export function createLookIcon(name: string): HTMLImageElement {
  const img = document.createElement("img");
  img.src = ICON_SRC;
  img.alt = "";
  img.width = ICON_W;
  img.height = ICON_H;
  img.style.cssText = `
    flex-shrink: 0; image-rendering: pixelated; border-radius: 3px;
    filter: ${lookIconFilter(name)};
  `;
  return img;
}
