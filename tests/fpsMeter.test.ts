import { describe, expect, it } from "vitest";
import { FPS_WINDOW_MS, createFpsMeter } from "../src/render/fpsMeter.ts";

// The FPS readout (src/render/fpsMeter.ts header): frames averaged over a
// window, so one late frame moves it a little instead of swinging it.

const frameMs = 1000 / 60;

/** Feeds a 60 fps run from `fromMs` for `ms`, skipping the frames `skip` names. */
function feed(meter: ReturnType<typeof createFpsMeter>, fromMs: number, ms: number, skip: (i: number) => boolean = () => false) {
  for (let i = 0; i * frameMs <= ms; i++) if (!skip(i)) meter.frame(fromMs + i * frameMs);
}

describe("createFpsMeter", () => {
  it("reads 0 until a full window has been counted", () => {
    const meter = createFpsMeter();
    feed(meter, 1000, FPS_WINDOW_MS / 2);
    expect(meter.read()).toBe(0);
  });

  it("reads the cap on a steady run", () => {
    const meter = createFpsMeter();
    feed(meter, 1000, 3 * FPS_WINDOW_MS);
    expect(meter.read()).toBeCloseTo(60, 0);
  });

  it("moves by a frame or two for one late frame, not to half or double", () => {
    const meter = createFpsMeter();
    const seen: number[] = [];
    for (let i = 0; i * frameMs <= 4 * FPS_WINDOW_MS; i++) {
      if (i === 70) continue; // one frame late: a 33 ms gap
      meter.frame(1000 + i * frameMs);
      if (meter.read() > 0) seen.push(meter.read());
    }
    expect(Math.min(...seen)).toBeGreaterThan(56);
    expect(Math.max(...seen)).toBeLessThan(61);
  });

  it("holds through a pause and isn't dragged down by it", () => {
    const meter = createFpsMeter();
    feed(meter, 1000, 2 * FPS_WINDOW_MS);
    const before = meter.read();
    // A hidden tab: nothing drawn for seconds, then the run resumes.
    feed(meter, 10_000, FPS_WINDOW_MS / 2);
    expect(meter.read()).toBe(before);
    feed(meter, 10_000 + FPS_WINDOW_MS / 2 + frameMs, 2 * FPS_WINDOW_MS);
    expect(meter.read()).toBeCloseTo(60, 0);
  });
});
