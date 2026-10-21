/**
 * The LIVE monitor on the desk (issue #621, plans/controls-first.md answer 1):
 * a 2D canvas in the red LIVE slot that shows what the pop-out output shows.
 *
 * The output is opened `noopener` (outputBridge.ts), so this window cannot
 * read its canvas. Two sources therefore stand in for it. While the output
 * shows NEXT (following: NEXT = LIVE, or Cue held) the monitor copies this
 * window's own scene canvas, which is the same picture. While they differ the
 * output sends small frames of its own picture (`thumbs` / `thumb`), and the
 * monitor draws the latest one. The thumbnails are only requested while the
 * monitor is shown and they differ, so nothing is copied or sent otherwise.
 */

export interface LiveMonitorDeps {
  slot: HTMLElement;
  /** The main scene canvas (#gl). */
  source: HTMLCanvasElement;
  /** bridge.status(): open, and NEXT = LIVE or Cue held. */
  following(): boolean;
  setThumbs(on: boolean): void;
  onThumb(cb: (bmp: ImageBitmap) => void): void;
}

/** Copies of the scene canvas go no faster than this; the scene draws at its own cadence. */
const FOLLOW_MS = 1000 / 30;
/** How often the slot's size is checked for a change. */
const SIZE_CHECK_MS = 500;
/** Above this the backing store only costs memory; the slot is small. */
const MAX_DPR = 2;

export function createLiveMonitor(deps: LiveMonitorDeps): { afterDraw(nowMs: number): void; setActive(on: boolean): void } {
  const canvas = document.createElement("canvas");
  canvas.className = "desk-live";
  deps.slot.appendChild(canvas);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

  let active = false;
  let lastCopyMs = -Infinity;
  let nextSizeCheckMs = -Infinity;

  function syncSize(nowMs: number): void {
    if (nowMs < nextSizeCheckMs) return;
    nextSizeCheckMs = nowMs + SIZE_CHECK_MS;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(deps.slot.clientWidth * dpr));
    const h = Math.max(1, Math.round(deps.slot.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  deps.onThumb((bmp) => {
    try {
      if (!active || deps.following()) return;
      syncSize(performance.now());
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    } finally {
      bmp.close();
    }
  });

  return {
    afterDraw(nowMs) {
      if (!active) return;
      if (!deps.following()) {
        deps.setThumbs(true);
        return;
      }
      deps.setThumbs(false);
      syncSize(nowMs);
      if (nowMs - lastCopyMs < FOLLOW_MS) return;
      lastCopyMs = nowMs;
      ctx.drawImage(deps.source, 0, 0, canvas.width, canvas.height);
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) {
        syncSize(performance.now());
        return;
      }
      deps.setThumbs(false);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
