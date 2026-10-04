/**
 * Layout facts a panel widget needs on every tick — whether an element is on
 * screen, and how big it is — observed rather than read on the tick itself.
 *
 * The panel ticks on every animation frame and writes styles as it goes (a
 * meter's fill, a box's colour, a readout's text). A `clientWidth` or
 * `getBoundingClientRect()` read after any of those writes makes the browser
 * run style and layout right there, once per read — the leash gauge and the
 * strain boxes doing that cost Physarum 2's panel about a seventh of the
 * main thread (measured 2026-10-04).
 * canvasSizer.ts is the same rule for the meters' canvases; these two are
 * for everything else.
 *
 * - `watchOnScreen`: the element is scrolled into view, the panel is open and
 *   no card has folded it away (an IntersectionObserver). The answer arrives
 *   a frame or so after a change — an element just scrolled into view reads
 *   false for that long — which is fine for work that only matters while
 *   someone can see it. The one costly user: the Master card's Picture block,
 *   which asks app.ts for a GPU readback of the finished frame, a synchronous
 *   round trip in Chrome that waits behind whatever the GPU is still doing
 *   (the Panel blur's re-filtering included).
 * - `watchSize`: the element's CSS content size, rounded to whole pixels like
 *   `clientWidth` (a ResizeObserver). Until the first observation lands it
 *   falls back to a direct read, so a first draw still has a size.
 *
 * Without the observer APIs, `watchOnScreen` always says on screen (so the
 * caller's own gating, the panel being open, is all that applies) and
 * `watchSize` reads the element directly, as the widgets used to.
 */
export function watchOnScreen(el: Element): () => boolean {
  if (typeof IntersectionObserver === "undefined") return () => true;
  let onScreen = false;
  new IntersectionObserver((entries) => {
    const last = entries[entries.length - 1];
    if (last) onScreen = last.isIntersecting;
  }).observe(el);
  return () => onScreen;
}

export interface WatchedSize {
  /** CSS width and height in whole pixels; 0 while the element has no layout. */
  readonly w: number;
  readonly h: number;
  /** Stops observing — call from the widget's dispose. */
  disconnect(): void;
}

export function watchSize(el: HTMLElement): WatchedSize {
  let seen: { w: number; h: number } | null = null;
  const ro =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => {
          const last = entries[entries.length - 1];
          if (last) seen = { w: Math.round(last.contentRect.width), h: Math.round(last.contentRect.height) };
        });
  ro?.observe(el);
  return {
    get w() {
      return seen ? seen.w : el.clientWidth;
    },
    get h() {
      return seen ? seen.h : el.clientHeight;
    },
    disconnect: () => ro?.disconnect(),
  };
}
