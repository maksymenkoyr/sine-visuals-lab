import { describe, it, expect } from "vitest";
import {
  CATCH_UP_GAP,
  GATE_TOLERANCE_MS,
  RENDER_FPS_CAP,
  RENDER_FPS_CAP_FLOOR,
  createRenderGate,
  nextRenderAnchor,
  shouldRenderFrame,
  targetFrameIntervalMs,
} from "../src/render/framePace.ts";

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
      // 144 and 165 Hz land ~61.7: the gate admits a tick up to the tolerance early.
      expect(n, `${hz} Hz`).toBeLessThan(hz === 144 || hz === 165 ? 625 : 612);
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

describe("createRenderGate", () => {
  const interval = targetFrameIntervalMs("high");

  /** The times a gate draws at over `seconds` of rAF ticks at `hz`, with small
   *  timing jitter. `lost(k)` drops tick k, as a busy main thread or GPU does. */
  function draws(hz: number, intervalMs: number, seconds: number, lost: (k: number) => boolean = () => false): number[] {
    const gate = createRenderGate();
    const vsync = 1000 / hz;
    const out: number[] = [];
    let seed = 12345;
    const jitter = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff - 0.5) * 0.6; // +-0.3 ms
    };
    for (let k = 1; k * vsync < seconds * 1000; k++) {
      const now = k * vsync + jitter();
      if (lost(k)) continue;
      if (gate.pass(now, intervalMs)) out.push(now);
    }
    return out;
  }

  const gaps = (times: number[]) => times.slice(1).map((t, i) => t - times[i]);

  it("still draws ~60 fps on every display refresh at or above 60 Hz", () => {
    for (const hz of [60, 75, 90, 100, 120, 144, 165, 240]) {
      const n = draws(hz, interval, 10).length;
      expect(n, `${hz} Hz`).toBeGreaterThan(588);
      expect(n, `${hz} Hz`).toBeLessThan(hz === 144 || hz === 165 ? 625 : 612);
    }
  });

  it("draws every tick of a panel a hair faster than 60 Hz", () => {
    for (const hz of [60.02, 60.06, 60.5, 61]) {
      expect(draws(hz, interval, 60).length, `${hz} Hz`).toBeGreaterThanOrEqual(Math.floor(hz * 60) - 2);
    }
  });

  // Not a display four times the cap (240 Hz at 60, 120 Hz at the floor's
  // 30): there a frame one tick late is followed by a gap of three ticks,
  // three quarters of an interval, which the gate can't tell from the healthy
  // short gaps of other refresh rates without knowing the display's. The
  // frame it shortens was only one tick late.
  it("draws no catch-up frames after a hiccup: no gap shorter than the display's own healthy ones", () => {
    for (const [hz, intervalMs] of [
      [120, interval],
      [144, interval],
      [165, interval],
      [60, targetFrameIntervalMs("floor")],
    ]) {
      const shortest = Math.min(...gaps(draws(hz, intervalMs, 10)));
      // Every run of 1 to 6 lost ticks, at every phase against the grid.
      for (let run = 1; run <= 6; run++) {
        for (let phase = 0; phase < 8; phase++) {
          const start = 300 + phase;
          const times = draws(hz, intervalMs, 10, (k) => k >= start && k < start + run);
          expect(Math.min(...gaps(times)), `${hz} Hz, ${run} lost from tick ${start}`).toBeGreaterThan(shortest - 1);
        }
      }
    }
  });

  it("follows a frame late on a 120 Hz panel with one interval, not a back-to-back frame", () => {
    // Two ticks lost: the frame lands one tick after its slot.
    const times = draws(120, interval, 1, (k) => k === 9 || k === 10);
    const late = gaps(times).findIndex((g) => g > 1.25 * interval);
    expect(late).toBeGreaterThan(0);
    expect(gaps(times)[late + 1]).toBeGreaterThan(interval - GATE_TOLERANCE_MS);
  });

  it("refuses a tick closer than CATCH_UP_GAP intervals to the last drawn frame", () => {
    const gate = createRenderGate();
    expect(gate.pass(1000, interval)).toBe(true);
    // A frame half an interval late: the grid stays one interval behind it.
    const lateMs = 1000 + 1.5 * interval;
    expect(gate.pass(lateMs, interval)).toBe(true);
    const tooSoon = lateMs + CATCH_UP_GAP * interval - 0.1;
    expect(shouldRenderFrame(tooSoon, 1000 + interval, interval)).toBe(true); // the grid alone would draw it
    expect(gate.due(tooSoon, interval)).toBe(false);
    expect(gate.pass(tooSoon, interval)).toBe(false);
    expect(gate.pass(lateMs + interval, interval)).toBe(true);
  });

  it("due() answers like pass() without moving the gate", () => {
    const gate = createRenderGate();
    expect(gate.due(1000, interval)).toBe(true);
    expect(gate.due(1000, interval)).toBe(true);
    expect(gate.pass(1000, interval)).toBe(true);
    expect(gate.due(1000 + interval / 2, interval)).toBe(false);
    expect(gate.due(1000 + interval, interval)).toBe(true);
  });

  it("draws the first tick after reset()", () => {
    const gate = createRenderGate();
    gate.pass(1000, interval);
    gate.reset();
    expect(gate.pass(1001, interval)).toBe(true);
  });
});
