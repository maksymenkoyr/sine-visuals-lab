import type { GlassLook } from "../render/glassBackdrop.ts";

/**
 * Panel blur: how the controls panel's glass shows the scene behind it.
 * Global per device, like src/render/qualityPref.ts. Three looks:
 *
 * - On: the browser blurs, with a CSS backdrop-filter. The browser re-filters
 *   the WebGL canvas behind every glass surface every frame (the canvas
 *   changes every frame) at full device resolution. That is a real GPU cost —
 *   measured 2026-09-29 at roughly 1 ms/frame on a light scene and 5+ ms on
 *   Caustics, and in #551 (2026-10-16) as most of what the open panel costs
 *   the GPU process. It is the default anyway: the frosted panel is the
 *   intended look, the quality governor (src/render/governor.ts) absorbs the
 *   cost on a scene that runs out of budget, and "Off" stays one click away
 *   in the Power card.
 * - Fast: the same glass drawn by the renderer (render/glassBackdrop.ts) from
 *   a small copy of the finished frame, under the surfaces that sit straight
 *   on the scene (ui/glassPanes.ts says which, and why the rest keep the
 *   browser's blur). Being tried: #561.
 * - Off: a darker flat tint rather than the lighter one the blur needs, to
 *   keep the text readable without it.
 *
 * What the browser's cost scales with (2026-10-02, headless Metal, dpr 2,
 * Caustics open panel): the blurred *area*. Neither the blur radius nor the
 * number of filtered layers matters — one filter per column cost the same as
 * one per card, while a lone 1px filtered element cost next to nothing. A
 * copy of the canvas into a small 2D canvas, blurred there and drawn back
 * under the cards, cost as much again just for the cross-context copy. A
 * blur inside the renderer needs no copy: the frame is already on the GPU.
 *
 * Fast against On (2026-10-16, #561: production build, the panel open with
 * its default cards, M1 Pro at dpr 2, the three looks interleaved over six
 * rounds, medians). GPU-process CPU per drawn frame, headless: Caustics Off
 * 3.3 ms, On 4.7, Fast 3.3; Physarum 2 Off 3.6, On 5.8, Fast 4.2, where On
 * also dropped to about 92 fps while Off and Fast held 120. In a visible
 * window (three rounds, a 120 Hz display): Caustics Off 5.2 ms at 120 fps,
 * On 8.3 at 76, Fast 5.8 at 104; Physarum 2 Off 6.4 at 80, On 9.1 at 63,
 * Fast 7.1 at 73. So Fast removes most of the blur's cost but not all of it.
 * The renderer's passes themselves cost about 0.8 ms of GPU a frame at
 * 2912×1804 with those cards, whatever the scene (measured alone, synced by
 * a one-pixel read).
 *
 * The looks are CSS custom properties on <html> (see applyGlassBlur and
 * controlsTheme.ts's GLASS_BG / GLASS_FILTER): every glass surface reads
 * `var(--vc-glass-bg)` / `var(--vc-glass-filter)` from its inline style, so
 * flipping this is a class toggle, not a restyle of each card. Fast keeps
 * On's classes and adds `vc-glass-drawn` only while the renderer is actually
 * drawing (setGlassDrawn, from app.ts each frame), which drops the
 * backdrop-filter on the surfaces it draws under; whenever it can't (the
 * panel closed, a clip recording the canvas, a GPU that can't build its
 * passes) those surfaces fall back to the browser's blur.
 *
 * Same in-memory-cache-over-localStorage pattern as qualityPref.ts. On and
 * Off keep the stored values they had before Fast existed.
 */

export type GlassMode = "off" | "fast" | "on";

const STORAGE_KEY = "vibe.panelBlur";
export const GLASS_MODE_DEFAULT: GlassMode = "on";
const STORED: Record<GlassMode, string> = { off: "0", fast: "fast", on: "1" };

/** The glass's blur and colour, for both the CSS filter (glassFilterCss) and
 *  the renderer's copy of it. */
export const GLASS_LOOK: GlassLook = { blurCssPx: 20, saturate: 0.6, brightness: 0.5, contrast: 1.08 };

/** `look` as a CSS filter chain, in the order the renderer applies it. */
export function glassFilterCss(look: GlassLook): string {
  return `blur(${look.blurCssPx}px) saturate(${look.saturate}) brightness(${look.brightness}) contrast(${look.contrast})`;
}

/** The mode a stored value names; anything unknown is the default. */
export function parseGlassMode(raw: string | null): GlassMode {
  for (const mode of Object.keys(STORED) as GlassMode[]) if (STORED[mode] === raw) return mode;
  return GLASS_MODE_DEFAULT;
}

function loadInitial(): GlassMode {
  try {
    return parseGlassMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return GLASS_MODE_DEFAULT;
  }
}

let cache: GlassMode = loadInitial();
let drawn = false;

export function getGlassMode(): GlassMode {
  return cache;
}

export function setGlassMode(next: GlassMode): void {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, STORED[next]);
  } catch {
    // Not fatal — the choice just won't persist across reloads.
  }
  applyGlassBlur();
}

/** Whether the renderer draws the glass this frame (see the file header).
 *  Only touches <html> when it changes. */
export function setGlassDrawn(next: boolean): void {
  if (next === drawn) return;
  drawn = next;
  applyGlassBlur();
}

/** Mirrors the preference onto <html> as the classes controlsTheme.ts's
 *  stylesheet keys the looks off: `vc-glass-blur` for the lighter, blurred
 *  glass (On and Fast), `vc-glass-drawn` while the renderer draws it. Safe to
 *  call any time; a no-op where there is no document (the node test env). */
export function applyGlassBlur(): void {
  if (typeof document === "undefined") return;
  const classes = document.documentElement.classList;
  classes.toggle("vc-glass-blur", cache !== "off");
  classes.toggle("vc-glass-drawn", cache === "fast" && drawn);
}
