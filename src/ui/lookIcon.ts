/**
 * The little picture next to each saved look in the Looks card: a green
 * alien face to go with the alien-language look names
 * (src/render/lookNames.ts), `ICON_W` × `ICON_H` pixels so it reads as a
 * blurry blob of a face, and drawn `ICON_SCALE` times larger with hard pixel
 * edges. It was drawn for this project by tools/look-icon.py (a few shapes,
 * blurred, box-downscaled and quantized to a small palette), which prints
 * the PNG below.
 *
 * Every look tints it differently: one of the `FILTERS` (each a CSS filter
 * with a hue slot) and the hue it's turned to both come from a hash of the
 * look's name. No new field on SceneLook, so the share-code format is
 * untouched, and a shared look shows the same colour on both ends. Renaming
 * a look recolours it.
 *
 * The PNG is inline (a data: URI in this module) rather than a file next to
 * it: an image the page fetched later could 404 after a deploy — see
 * src/pinnedAssets.ts's header.
 */

const ICON_SRC =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAQCAMAAAAhxq8pAAAASFBMVEXo7ODn7N/l6t3e59TP38K70qqkyI2MxGSXvn+BuV10r1ByqlJsqkhqqEhqo0lgm0BZkDxUjDhRgDlHbTIzTCUgKBwVGxIUGhLygKCiAAAAmElEQVR42lXPSxaDIAxAUQSDoBHCN/vfaVNRS98gh3MHAZQaLQbALGrOgPOSAzPZhvsm7ehf1Q4HekSn73WAkr8M0Y7Fayi1hC9ch3VgYW4un2e2jbkMNLlzb70UGdwfPGpn5lpl9HqM+xcru1olklHCfZEyPkSKEsXweyggpSs64f2RtnFgtFpNSinnRLMNTeT+TBS8h8c+NTcJqNsLlI4AAAAASUVORK5CYII=";
const ICON_W = 20;
const ICON_H = 16;
const ICON_SCALE = 1.5;

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
  img.width = ICON_W * ICON_SCALE;
  img.height = ICON_H * ICON_SCALE;
  img.style.cssText = `
    flex-shrink: 0; image-rendering: pixelated; border-radius: 3px;
    filter: ${lookIconFilter(name)};
  `;
  return img;
}
