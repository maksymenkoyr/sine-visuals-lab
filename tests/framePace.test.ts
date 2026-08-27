import { describe, it, expect } from "vitest";
import { RENDER_FPS_CAP, RENDER_FPS_CAP_FLOOR, shouldRenderFrame, targetFrameIntervalMs } from "../src/render/framePace.ts";

describe("targetFrameIntervalMs", () => {
  it("is 1000/30 on floor tier", () => {
    expect(targetFrameIntervalMs("floor")).toBeCloseTo(1000 / RENDER_FPS_CAP_FLOOR, 6);
  });

  it("is 1000/60 on every other tier", () => {
    for (const tier of ["high", "mid", "low"] as const) {
      expect(targetFrameIntervalMs(tier)).toBeCloseTo(1000 / RENDER_FPS_CAP, 6);
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
