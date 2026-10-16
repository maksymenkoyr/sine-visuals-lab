/**
 * Missed frames: how many frames came too late to be shown in the last
 * MISS_WINDOW_MS, and the longest gap between two drawn frames — the Power
 * card's Missed frames and Longest gap readouts (ui/powerCard.ts). The main
 * window feeds one from app.ts's drawScene. The pop-out output feeds its own
 * from output.ts's loop and sends the reading with its other readouts
 * (net/outputSync.ts's `status`) to the main window's Output card.
 *
 * Each gap is measured against the render cap in force (framePace.ts, or
 * Energy saving's own): a gap over LATE_AFTER_INTERVALS cap intervals is
 * late, and counts as round(gap / interval) − 1 missed frames. The
 * threshold sits above what a healthy display produces at the cap. A refresh
 * rate the cap doesn't divide spaces frames unevenly (governor.ts's
 * MAX_ACHIEVABLE_MULT comment lists the cadences), and neither counts. A
 * frame one refresh late on a fast display stays under the threshold too:
 * the gate restarts its grid from it rather than drawing a catch-up frame
 * (framePace.ts's CATCH_UP_GAP), so its gap is the only uneven one.
 *
 * Only gaps inside one steady run of drawing count. The caller calls
 * restart() wherever drawing stops or starts over: a scene mounting, the tab
 * hidden, a tick with nothing to draw. A frame drawn while the tab is hidden
 * (app.ts's background clock) passes `hidden` and counts nothing. A change of
 * the cap starts a new run by itself, and so does a gap of PAUSE_MS or more:
 * that is the page not running at all (the machine slept, a debugger stopped
 * it), not frames coming late. The first WARMUP_FRAMES gaps of a run are not
 * counted either, since a scene's first frames can still be compiling
 * shaders and filling buffers.
 *
 * The window rolls in steps of MISS_STEP_MS, so a late frame leaves the
 * reading between one step short of MISS_WINDOW_MS and MISS_WINDOW_MS after
 * it. It is kept in fixed arrays, not a list of frames: frame() runs on every
 * drawn frame and allocates nothing, since garbage collection pauses are
 * among the misses it counts.
 */

/** How far back the readouts look. */
export const MISS_WINDOW_MS = 10_000;
/** The window rolls in steps this long; MISS_WINDOW_MS is a whole number of them. */
export const MISS_STEP_MS = 1000;
const STEPS = MISS_WINDOW_MS / MISS_STEP_MS;
/** A gap over this many cap intervals is late (the header says why it sits here). */
export const LATE_AFTER_INTERVALS = 1.8;
/** Gaps not counted at the start of each run of drawing. */
export const WARMUP_FRAMES = 10;
/** A gap this long or longer is a pause, not late frames: it starts a new run. */
export const PAUSE_MS = 5000;

interface FrameMissReading {
  /** Frames missed in the window; null while no gap in it was measured. */
  missedFrames: number | null;
  /** The longest measured gap in the window, in ms; null with missedFrames. */
  longestGapMs: number | null;
}

interface FrameMisses {
  /** A frame was drawn at `nowMs` under a render cap of `intervalMs`.
   *  `hidden`: nobody can see the page, so the frame ends the run instead. */
  frame(nowMs: number, intervalMs: number, hidden: boolean): void;
  /** Drawing stopped or starts over: the next frame measures no gap, and the warm-up begins again. */
  restart(): void;
  /** Missed frames and the longest gap in the window that ends at `nowMs`. */
  read(nowMs: number): FrameMissReading;
}

export function createFrameMisses(): FrameMisses {
  // One slot per step of the window: which step it holds (-1: none yet),
  // the frames missed in it and its longest gap.
  const stepOf = new Float64Array(STEPS).fill(-1);
  const missedIn = new Float64Array(STEPS);
  const longestIn = new Float64Array(STEPS);
  /** When the run's last frame was drawn; null between runs. */
  let lastMs: number | null = null;
  let lastIntervalMs = 0;
  let warmupLeft = 0;

  function record(nowMs: number, missed: number, gapMs: number): void {
    const step = Math.floor(nowMs / MISS_STEP_MS);
    const slot = step % STEPS;
    if (stepOf[slot] !== step) {
      stepOf[slot] = step;
      missedIn[slot] = 0;
      longestIn[slot] = 0;
    }
    missedIn[slot] += missed;
    if (gapMs > longestIn[slot]) longestIn[slot] = gapMs;
  }

  return {
    frame(nowMs, intervalMs, hidden) {
      if (hidden) {
        lastMs = null;
        return;
      }
      if (lastMs === null || intervalMs !== lastIntervalMs || nowMs - lastMs >= PAUSE_MS) {
        // A new run: this frame is its first, and the gaps after it warm up.
        lastMs = nowMs;
        lastIntervalMs = intervalMs;
        warmupLeft = WARMUP_FRAMES;
        return;
      }
      const gapMs = nowMs - lastMs;
      lastMs = nowMs;
      if (warmupLeft > 0) {
        warmupLeft--;
        return;
      }
      const missed = gapMs > LATE_AFTER_INTERVALS * intervalMs ? Math.round(gapMs / intervalMs) - 1 : 0;
      record(nowMs, missed, gapMs);
    },
    restart() {
      lastMs = null;
    },
    read(nowMs) {
      const now = Math.floor(nowMs / MISS_STEP_MS);
      let missed = 0;
      let longest = 0;
      let measured = false;
      for (let slot = 0; slot < STEPS; slot++) {
        const step = stepOf[slot];
        if (step < 0 || step > now || step <= now - STEPS) continue;
        measured = true;
        missed += missedIn[slot];
        if (longestIn[slot] > longest) longest = longestIn[slot];
      }
      return measured ? { missedFrames: missed, longestGapMs: longest } : { missedFrames: null, longestGapMs: null };
    },
  };
}
