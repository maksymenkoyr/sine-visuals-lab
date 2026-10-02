/**
 * The one place a meter canvas's backing store is sized to its card.
 *
 * Every rolling meter in the panel (the spectrum strip, the column rings
 * behind the Hits/Loudness/Level history, the waveform, the hit-curve plot)
 * draws into a canvas whose CSS width is whatever its card gives it and whose
 * backing store must be that width times devicePixelRatio, or the browser
 * stretches it. Each used to carry its own copy of this logic; they all
 * share this one so they agree on three rules:
 *
 *  - No layout means no size: a width of 0 (panel closed, card folded)
 *    returns false from `ensure()` and touches nothing, so a hidden meter
 *    keeps its history and never sizes itself to a clamped 1px that gets
 *    stretched across the card when it opens.
 *  - The width is *observed*, not measured per draw: a ResizeObserver keeps
 *    the number, so a tick costs no forced layout (a getBoundingClientRect
 *    interleaved with canvas writes made the browser re-run style and layout
 *    several times per frame while the panel was open). Observed content
 *    width also ignores CSS transforms, so the panel's slide-in animation
 *    doesn't resize — and so clear — a history mid-animation. Without
 *    ResizeObserver (or with `observe: false`, for a component that only
 *    draws on its own input events and so can't tolerate a skipped first
 *    draw) it falls back to a rect read.
 *  - devicePixelRatio is part of the key: dragging the window to another
 *    display moves the ratio without changing any CSS width, and the backing
 *    store must follow. A ratio-only change re-applies the backing store but
 *    is NOT a width change, so `onWidthChange` (where a history buffer is
 *    rebuilt) does not fire and the history survives.
 *
 * Resizing a canvas's backing store clears it, so `version` counts every
 * (re)size: a meter that skips redundant redraws keys its memo on it.
 */

export interface CanvasSizerOpts {
  /** CSS height of the plot; the backing store is this times the ratio. The
   *  canvas's own style fixes its CSS height — this only sizes the pixels. */
  heightCssPx: number;
  /** Track the width with a ResizeObserver (default true). False reads the
   *  rect on every `ensure()` — only for a canvas that isn't redrawn on a
   *  per-tick loop. */
  observe?: boolean;
  /** The CSS width changed (not just the ratio): rebuild any per-column
   *  buffer here. Called after the backing store is resized. */
  onWidthChange?: (cssWidth: number) => void;
}

export interface CanvasSizer {
  /** Sizes the backing store if the width or ratio moved. False while the
   *  canvas has no layout — the caller skips its draw. */
  ensure(): boolean;
  /** CSS pixel width last sized to (0 before the first layout). */
  readonly width: number;
  /** Bumped each time the backing store is (re)sized, i.e. each time its
   *  pixels were cleared. */
  readonly version: number;
}

export function createCanvasSizer(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  opts: CanvasSizerOpts,
): CanvasSizer {
  let cssWidth = 0;
  let lastDpr = 0;
  let version = 0;

  let observed = 0;
  let observer: ResizeObserver | null = null;
  if (opts.observe !== false && typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) observed = Math.round(last.contentRect.width);
    });
    observer.observe(canvas);
  }

  function ensure(): boolean {
    const w = observer ? observed : Math.round(canvas.getBoundingClientRect().width);
    if (w <= 0) return false;
    const dpr = window.devicePixelRatio || 1;
    if (w === cssWidth && dpr === lastDpr) return true;
    const widthChanged = w !== cssWidth;
    cssWidth = w;
    lastDpr = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(opts.heightCssPx * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    version++;
    if (widthChanged) opts.onWidthChange?.(w);
    return true;
  }

  return {
    ensure,
    get width() {
      return cssWidth;
    },
    get version() {
      return version;
    },
  };
}
