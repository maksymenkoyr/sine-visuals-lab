/**
 * Panel blur: whether the controls panel's glass blurs the scene behind it.
 * Global per device, like src/render/qualityPref.ts.
 *
 * The blur is a CSS backdrop-filter, and the browser re-filters the WebGL
 * canvas behind it every frame (the canvas changes every frame) at full
 * device resolution. That is a real GPU cost — measured 2026-09-29 at
 * roughly 1 ms/frame on a light scene and 5+ ms on Caustics. It defaults on
 * anyway: the frosted panel is the intended look, the quality governor
 * (src/render/governor.ts) absorbs the cost on a scene that runs out of
 * budget, and "Off" stays one click away in the Power card. "Off" is a
 * darker flat tint rather than the lighter one the blur needs, to keep the
 * text readable without it.
 *
 * What the cost scales with (2026-10-02, headless Metal, dpr 2, Caustics
 * open panel): the blurred *area*. Neither the blur radius nor the number of
 * filtered layers matters — one filter per column cost the same as one per
 * card, while a lone 1px filtered element cost next to nothing. A copy of
 * the canvas into a small 2D canvas, blurred there and drawn back under the
 * cards, cost as much again just for the cross-context copy. So the one
 * cheaper blur left is inside the renderer: a downsampled, blurred copy of
 * the finished frame (the halving blits src/render/pictureReadback.ts
 * already does) drawn into the canvas under the cards' rects.
 *
 * Both looks are CSS custom properties on <html> (see applyGlassBlur and
 * controlsTheme.ts's GLASS_BG / GLASS_FILTER): every glass surface reads
 * `var(--vc-glass-bg)` / `var(--vc-glass-filter)` from its inline style, so
 * flipping this is one class toggle, not a restyle of each card.
 *
 * Same in-memory-cache-over-localStorage pattern as qualityPref.ts.
 */

const STORAGE_KEY = "vibe.panelBlur";
export const GLASS_BLUR_DEFAULT = true;

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
