/**
 * A clock that keeps ticking while the tab is hidden. The main window's
 * render loop (src/app.ts's `loop`) is a requestAnimationFrame loop, and a
 * hidden tab — another tab in front, the window minimised or fully covered —
 * gets no animation frames. That loop is also what samples the audio and
 * pushes a frame to the pop-out output window (net/outputBridge.ts), so
 * without a clock of its own the projector went black after the output's
 * STALE_MS (src/output.ts) the moment nobody was looking at the controller.
 *
 * The page's own timers don't help — a hidden page's setInterval is clamped
 * to once a second, and to once a minute after five minutes. A dedicated
 * Worker's timer isn't throttled that way, so the interval lives in a tiny
 * inline worker and posts a message per tick. The caller decides what a
 * tick does (app.ts: sample + push to the output, skip drawing); this file
 * only knows how to keep time.
 *
 * Inline (a Blob URL) rather than a worker file: it is five lines, needs no
 * build step, and fetches nothing from the page's origin (src/pinnedAssets.ts).
 */

/** About 60 Hz — the rate the output's frames arrive at while the tab is
 *  visible, so a hidden controller feeds the projector at the same pace. */
export const BACKGROUND_TICK_MS = 16;

export interface BackgroundTick {
  /** Stop the clock and free the worker. */
  stop(): void;
}

/**
 * Call `onTick` every BACKGROUND_TICK_MS from a worker thread, for as long as
 * the returned handle lives. Returns null where a worker can't be made (no
 * Worker/Blob/URL support, or the page forbids blob workers): the caller then
 * simply has no background clock, the same as before this existed.
 */
export function startBackgroundTick(onTick: () => void): BackgroundTick | null {
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL?.createObjectURL !== "function") {
    return null;
  }
  let url: string | null = null;
  let worker: Worker | null = null;
  try {
    url = URL.createObjectURL(
      new Blob([`setInterval(function(){postMessage(0)},${BACKGROUND_TICK_MS})`], { type: "text/javascript" }),
    );
    worker = new Worker(url);
    worker.onmessage = () => onTick();
  } catch {
    if (url) URL.revokeObjectURL(url);
    worker?.terminate();
    return null;
  }
  const w = worker;
  const u = url;
  return {
    stop() {
      w.terminate();
      URL.revokeObjectURL(u);
    },
  };
}

/**
 * Whether a background tick should run the loop body right now: only while
 * the page is hidden (a visible page has requestAnimationFrame, and running
 * both would double every tick) and only when something needs feeding.
 */
export function shouldTickInBackground(hidden: boolean, outputOpen: boolean): boolean {
  return hidden && outputOpen;
}
