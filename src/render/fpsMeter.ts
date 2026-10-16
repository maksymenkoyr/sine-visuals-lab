/**
 * The FPS readout — the Power card's for this window, and the pop-out's,
 * which it sends to the Output card with its other readouts: frames drawn
 * over the last FPS_WINDOW_MS, not one over the gap since the frame before.
 * Read per frame, a single late frame shows as half the cap and the frames
 * around it as up to double, so the number would jump on every hiccup;
 * averaged, a hiccup moves it by a frame or two. Hiccups themselves are what Missed
 * frames and Longest gap count (frameMisses.ts).
 *
 * The reading changes once a window. A gap of a whole window or more is the
 * loop pausing (a hidden tab, a scene switch, nothing to draw), not its frame
 * rate: counting starts over after it, and the reading holds until a full
 * window has been counted again.
 */

/** How long each reading averages over. */
export const FPS_WINDOW_MS = 500;

interface FpsMeter {
  /** A frame was drawn at `nowMs`. */
  frame(nowMs: number): void;
  /** Frames per second over the last full window; 0 before one has been counted. */
  read(): number;
}

export function createFpsMeter(): FpsMeter {
  let startMs = 0;
  let lastMs = -Infinity;
  let gaps = 0;
  let fps = 0;
  return {
    frame(nowMs) {
      if (nowMs - lastMs >= FPS_WINDOW_MS) {
        startMs = nowMs;
        gaps = 0;
      } else gaps++;
      lastMs = nowMs;
      if (nowMs - startMs >= FPS_WINDOW_MS) {
        fps = (gaps * 1000) / (nowMs - startMs);
        startMs = nowMs;
        gaps = 0;
      }
    },
    read: () => fps,
  };
}
