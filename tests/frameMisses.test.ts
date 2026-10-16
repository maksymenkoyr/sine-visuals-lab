// The missed-frame counter behind the Power card's Missed frames and Longest
// gap readouts (src/render/frameMisses.ts header): what counts as late, how a
// late frame leaves the window, and each way a run of drawing starts over
// without counting the gap across it.
import { describe, expect, it } from "vitest";
import {
  createFrameMisses,
  LATE_AFTER_INTERVALS,
  MISS_STEP_MS,
  MISS_WINDOW_MS,
  PAUSE_MS,
  WARMUP_FRAMES,
} from "../src/render/frameMisses.ts";

/** One frame at a 60 fps cap, and at the floor's 30 fps one. */
const CAP = 1000 / 60;
const CAP_FLOOR = 1000 / 30;
const NOTHING = { missedFrames: null, longestGapMs: null };

type Counter = ReturnType<typeof createFrameMisses>;

/** Draws one frame per gap (ms after the previous frame), starting from `t`;
 *  returns the last frame's time. */
function draw(m: Counter, t: number, gaps: number[], intervalMs = CAP, hidden = false): number {
  for (const gap of gaps) {
    t += gap;
    m.frame(t, intervalMs, hidden);
  }
  return t;
}

const steady = (count: number, gap = CAP): number[] => Array.from({ length: count }, () => gap);

/** A counter whose run has just finished warming up, nothing measured yet. */
function warmedUp(intervalMs = CAP): { m: Counter; t: number } {
  const m = createFrameMisses();
  m.frame(1000, intervalMs, false);
  return { m, t: draw(m, 1000, steady(WARMUP_FRAMES, intervalMs), intervalMs) };
}

describe("createFrameMisses", () => {
  it("reads nothing until a gap after the warm-up is measured", () => {
    const m = createFrameMisses();
    expect(m.read(0)).toEqual(NOTHING);
    m.frame(1000, CAP, false);
    // However late, the warm-up's gaps are not measured.
    const t = draw(m, 1000, steady(WARMUP_FRAMES, 10 * CAP));
    expect(m.read(t)).toEqual(NOTHING);
    const end = draw(m, t, [CAP]);
    expect(m.read(end).missedFrames).toBe(0);
    expect(m.read(end).longestGapMs).toBeCloseTo(CAP, 6);
  });

  it("counts nothing on a steady run at the cap", () => {
    const { m, t } = warmedUp();
    const end = draw(m, t, steady(300));
    expect(m.read(end).missedFrames).toBe(0);
    expect(m.read(end).longestGapMs).toBeCloseTo(CAP, 6);
  });

  it("counts a dropped frame as one miss, and a longer gap as the frames that fit in it", () => {
    const { m, t } = warmedUp();
    let end = draw(m, t, [2 * CAP]);
    expect(m.read(end).missedFrames).toBe(1);
    end = draw(m, end, [CAP, 3 * CAP]);
    expect(m.read(end).missedFrames).toBe(3);
    end = draw(m, end, [CAP, 500]);
    expect(m.read(end).missedFrames).toBe(3 + Math.round(500 / CAP) - 1);
    expect(m.read(end).longestGapMs).toBeCloseTo(500, 6);
  });

  it("leaves healthy uneven cadences alone, up to the late threshold", () => {
    const { m, t } = warmedUp();
    // A 75 Hz display at a 60 fps cap draws on one refresh, then two
    // (governor.ts's MAX_ACHIEVABLE_MULT comment).
    const at75 = 1000 / 75;
    let end = draw(m, t, [2 * at75, at75, at75, at75, 2 * at75, at75, at75, at75]);
    // A frame one refresh late on a 144 Hz display, caught up on the next tick.
    const at144 = 1000 / 144;
    end = draw(m, end, [4 * at144, at144]);
    end = draw(m, end, [LATE_AFTER_INTERVALS * CAP - 0.5]);
    expect(m.read(end).missedFrames).toBe(0);
    end = draw(m, end, [LATE_AFTER_INTERVALS * CAP + 0.5]);
    expect(m.read(end).missedFrames).toBe(1);
  });

  it("counts nothing drawn while hidden, nor the gap back into view", () => {
    const { m, t } = warmedUp();
    let end = draw(m, t, steady(10));
    // The background clock draws unevenly while the tab is hidden.
    end = draw(m, end, [3 * CAP, 2 * CAP, 40 * CAP], CAP, true);
    end = draw(m, end, [2000, ...steady(WARMUP_FRAMES, 3 * CAP)]);
    expect(m.read(end).missedFrames).toBe(0);
    expect(m.read(end).longestGapMs).toBeCloseTo(CAP, 6);
    end = draw(m, end, [2 * CAP]);
    expect(m.read(end).missedFrames).toBe(1);
  });

  it("does not count the gap across restart(), and warms up again after it", () => {
    const { m, t } = warmedUp();
    let end = draw(m, t, steady(10));
    m.restart();
    // A scene mounting: a long compile, then slow first frames.
    end = draw(m, end, [400, ...steady(WARMUP_FRAMES, 2 * CAP)]);
    expect(m.read(end).missedFrames).toBe(0);
    end = draw(m, end, [2 * CAP]);
    expect(m.read(end).missedFrames).toBe(1);
  });

  it("starts a new run when the cap changes, so the gap across the change is not counted", () => {
    const { m, t } = warmedUp(CAP_FLOOR);
    let end = draw(m, t, steady(10, CAP_FLOOR), CAP_FLOOR);
    // Energy saving back off: the gap that ends at the change is two of the new intervals.
    end = draw(m, end, [CAP_FLOOR, ...steady(WARMUP_FRAMES + 20)]);
    expect(m.read(end).missedFrames).toBe(0);
    end = draw(m, end, [2 * CAP]);
    expect(m.read(end).missedFrames).toBe(1);
  });

  it("counts a long stall in full, but takes a gap of PAUSE_MS or more as a new run", () => {
    const { m, t } = warmedUp();
    const stall = PAUSE_MS - 100;
    let end = draw(m, t, [stall]);
    const stalled = Math.round(stall / CAP) - 1;
    expect(m.read(end).missedFrames).toBe(stalled);
    expect(m.read(end).longestGapMs).toBeCloseTo(stall, 6);
    end = draw(m, end, [PAUSE_MS, ...steady(WARMUP_FRAMES, 3 * CAP)]);
    expect(m.read(end).missedFrames).toBe(stalled);
  });

  it("lets a late frame roll out of the window", () => {
    const { m, t } = warmedUp();
    const late = draw(m, t, [3 * CAP]);
    expect(m.read(late).missedFrames).toBe(2);
    // Still drawing: the miss stays until the window has passed it.
    let end = draw(m, late, steady(Math.floor((MISS_WINDOW_MS - MISS_STEP_MS) / CAP) - 1));
    expect(m.read(end).missedFrames).toBe(2);
    end = draw(m, end, steady(Math.ceil((2 * MISS_STEP_MS) / CAP)));
    expect(m.read(end).missedFrames).toBe(0);
    expect(m.read(end).longestGapMs).toBeCloseTo(CAP, 6);
    // Drawing stopped: nothing measured in the window any more.
    expect(m.read(end + MISS_WINDOW_MS + MISS_STEP_MS)).toEqual(NOTHING);
  });
});
