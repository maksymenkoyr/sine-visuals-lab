import { describe, it, expect } from "vitest";
import { RENDER_FPS_CAP, RENDER_FPS_CAP_FLOOR, nextRenderAnchor, shouldRenderFrame, targetFrameIntervalMs } from "../src/render/framePace.ts";

describe("targetFrameIntervalMs", () => {
  it("is 1000/30 on the floor preset", () => {
    expect(targetFrameIntervalMs("floor")).toBeCloseTo(1000 / RENDER_FPS_CAP_FLOOR, 6);
  });

  it("is 1000/60 on every other preset", () => {
    for (const preset of ["high", "mid", "low"] as const) {
      expect(targetFrameIntervalMs(preset)).toBeCloseTo(1000 / RENDER_FPS_CAP, 6);
    }
  });
});

describe("shouldRenderFrame", () => {
  const target = targetFrameIntervalMs("high"); // 16.667ms

  it("renders a tick that lands exactly on the cap", () => {
    expect(shouldRenderFrame(target, 0, target)).toBe(true);
  });

  it("renders a tick arriving a hair under the cap — the exact case that was failing", () => {
    // 16.60ms elapsed against a 16.667ms interval: previously this got
    // gated out (nowMs - lastRenderMs < targetIntervalMs), turning a
    // perfectly healthy 60Hz cadence into a stream of skipped frames.
    expect(shouldRenderFrame(16.6, 0, target)).toBe(true);
  });

  it("still gates out a tick that's genuinely early", () => {
    expect(shouldRenderFrame(target / 2, 0, target)).toBe(false);
  });

  it("a 60Hz cadence renders every tick", () => {
    let lastRenderMs = 0;
    let rendered = 0;
    for (let i = 1; i <= 60; i++) {
      const now = i * target;
      if (shouldRenderFrame(now, lastRenderMs, target)) {
        rendered++;
        lastRenderMs = now;
      }
    }
    expect(rendered).toBe(60);
  });

  it("a 120Hz cadence still renders every other tick, not every tick", () => {
    const tickMs = target / 2; // 120Hz raw ticks against a 60fps-cap interval
    let lastRenderMs = 0;
    let rendered = 0;
    for (let i = 1; i <= 60; i++) {
      const now = i * tickMs;
      if (shouldRenderFrame(now, lastRenderMs, target)) {
        rendered++;
        lastRenderMs = now;
      }
    }
    expect(rendered).toBeGreaterThanOrEqual(29);
    expect(rendered).toBeLessThanOrEqual(31);
  });

  it("the tolerance never lets the effective render rate exceed ~69fps", () => {
    // Sweep raw tick intervals from very fast (4ms) to right at the cap
    // (target) and confirm the achieved rate stays bounded — the tolerance
    // exists to swallow jitter around the cap, not to raise it.
    for (let tickMs = 4; tickMs <= target; tickMs += 0.5) {
      let lastRenderMs = 0;
      let rendered = 0;
      const totalMs = 5000;
      for (let now = tickMs; now <= totalMs; now += tickMs) {
        if (shouldRenderFrame(now, lastRenderMs, target)) {
          rendered++;
          lastRenderMs = now;
        }
      }
      const fps = rendered / (totalMs / 1000);
      expect(fps).toBeLessThan(69);
    }
  });
});

describe("nextRenderAnchor", () => {
  const interval = targetFrameIntervalMs("high");

  /** Counts renders over `seconds` of rAF ticks at `hz` with small timing jitter, gating like loop() does. */
  function renderCount(hz: number, intervalMs: number, seconds: number): number {
    const vsync = 1000 / hz;
    let last = 0;
    let renders = 0;
    let seed = 12345;
    const jitter = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff - 0.5) * 0.6; // +-0.3 ms
    };
    for (let t = vsync; t < seconds * 1000; t += vsync) {
      const now = t + jitter();
      if (!shouldRenderFrame(now, last, intervalMs)) continue;
      last = nextRenderAnchor(now, last, intervalMs);
      renders++;
    }
    return renders;
  }

  it("renders ~60 fps on every display refresh at or above 60 Hz, not refresh/2 or /3", () => {
    for (const hz of [60, 75, 90, 120, 144, 165]) {
      const n = renderCount(hz, interval, 10);
      expect(n, `${hz} Hz`).toBeGreaterThan(588);
      // 144 Hz lands ~61.7: the gate admits a tick up to the tolerance early.
      expect(n, `${hz} Hz`).toBeLessThan(625);
    }
  });

  it("doesn't drop frames on a panel a hair faster than 60 Hz", () => {
    for (const hz of [60.02, 60.06, 60.5, 61]) {
      const n = renderCount(hz, interval, 60);
      // One render per vsync: no skipped ticks (a skip is a 33 ms hitch).
      expect(n, `${hz} Hz`).toBeGreaterThanOrEqual(Math.floor(hz * 60) - 2);
    }
  });

  it("holds the 30 fps floor interval on 60 and 120 Hz displays", () => {
    for (const hz of [60, 120]) {
      const n = renderCount(hz, targetFrameIntervalMs("floor"), 10);
      expect(n, `${hz} Hz`).toBeGreaterThan(294);
      expect(n, `${hz} Hz`).toBeLessThan(306);
    }
  });

  it("steps by one interval while the gate is on time", () => {
    expect(nextRenderAnchor(1020, 1000, interval)).toBeCloseTo(1000 + interval, 6);
  });

  it("snaps to now on the first frame, so it isn't measured from time zero", () => {
    expect(nextRenderAnchor(5000, 0, interval)).toBe(5000);
  });

  it("snaps to now after a stall, so no burst of back-to-back renders follows", () => {
    const anchor = nextRenderAnchor(1500, 1000, interval); // 500 ms stall
    expect(anchor).toBe(1500);
    expect(shouldRenderFrame(1500 + 6.9, anchor, interval)).toBe(false);
  });
});
