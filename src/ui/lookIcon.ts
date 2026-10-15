/**
 * The little picture next to each saved look in the Looks card: a green
 * alien-cat meme the user picked to go with the alien-language look names
 * (src/render/lookNames.ts), shrunk to `ICON_W` × `ICON_H` pixels so it reads
 * as a blurry blob of a face, and drawn `ICON_SCALE` times larger with hard
 * pixel edges. Its author and license are unknown — THIRD-PARTY-NOTICES.md
 * says so; the full-size picture is not in this repo.
 *
 * Every look tints it differently: one of the `FILTERS` (each a CSS filter
 * with a hue slot) and the hue it's turned to both come from a hash of the
 * look's name. No new field on SceneLook, so the share-code format is
 * untouched, and a shared look shows the same colour on both ends. Renaming
 * a look recolours it.
 *
 * The PNG is inline (a data: URI in this module) rather than a file next to
 * it: an image the page fetched later could 404 after a deploy — see
 * src/pinnedAssets.ts's header. It was made with Pillow: a box-filter
 * downscale of the whole frame to `ICON_W` × `ICON_H`, quantized to a small
 * palette to keep the bytes down.
 */

const ICON_SRC =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAQCAMAAAAhxq8pAAAAYFBMVEXt7ubn6t3k59jb4svR1MTIycDEzLS3yp/Dw7y8wLK7u7OzsquoupKsrKGatoCIsmeXo4Z+o2GBmWp8jmpilEJkhkpmgVBSfjhMdjFAcyU3ax80Zxw1Yh8rVxcaMg4JEwT/XrIdAAAA3klEQVR42h3PWxLEEBAF0A5hSKS9CWLsf5fTmVs+1HG1AsZaNPo4z/N6E1L1GjSmlPC6nAsxOOc9SgFKYqo5lkKLEsh2Qmny/cyn1RLv8dxO7iClDGut75w92/Zdq0gOWshI2zXnSLbSaeGMUIQxKc+o6FuvuG2glTC19T7GaBaTRw5/1LESj9G98XbfqHkooVypb7UlJGSMwXEodbjcR+8tWfwwtgEhqQ6NHuvJSkaXAei/50nVNp/sPxz+IaIQthoM4cbfmUoJoWIl9Gh2BoxzINr3K9b7zoQf+Q74AY+MEvImAeZNAAAAAElFTkSuQmCC";
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
