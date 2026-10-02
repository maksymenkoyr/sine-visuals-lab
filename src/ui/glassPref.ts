/**
 * Panel blur: whether the controls panel's glass blurs the scene behind it.
 * Global per device, like src/render/qualityPref.ts.
 *
 * The blur is a CSS backdrop-filter, and every filtered layer re-reads the
 * WebGL canvas behind it each frame (the canvas changes every frame). With a
 * panel's worth of cards that is a real GPU cost — measured 2026-09-29 at
 * roughly 1 ms/frame on a light scene and 5+ ms on Caustics — and the blur
 * radius made no difference, only whether a filter exists at all. So it
 * defaults off, and "off" is a darker flat tint rather than the lighter one
 * the blur needed, to keep the text readable without it.
 *
 * Both looks are CSS custom properties on <html> (see applyGlassBlur and
 * controlsTheme.ts's GLASS_BG / GLASS_FILTER): every glass surface reads
 * `var(--vc-glass-bg)` / `var(--vc-glass-filter)` from its inline style, so
 * flipping this is one class toggle, not a restyle of each card.
 *
 * Same in-memory-cache-over-localStorage pattern as qualityPref.ts.
 */

const STORAGE_KEY = "vibe.panelBlur";
export const GLASS_BLUR_DEFAULT = false;

function loadInitial(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? GLASS_BLUR_DEFAULT : raw === "1";
  } catch {
    return GLASS_BLUR_DEFAULT;
  }
}

let cache: boolean = loadInitial();

export function getGlassBlur(): boolean {
  return cache;
}

export function setGlassBlur(next: boolean): void {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Not fatal — the choice just won't persist across reloads.
  }
  applyGlassBlur();
}

/** Mirrors the preference onto <html> as the `vc-glass-blur` class that
 *  controlsTheme.ts's stylesheet keys the two glass looks off. Safe to call
 *  any time; a no-op where there is no document (the node test env). */
export function applyGlassBlur(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("vc-glass-blur", cache);
}
