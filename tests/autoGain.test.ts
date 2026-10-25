import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  AUTO_GAIN_MIN,
  AUTO_GAIN_MAX,
  resetAutoGain,
  resolveAutoGain,
  autoGainForSpan,
  feedAutoGainMeasurement,
} from "../src/audio/autoGain.ts";

// autoGainForSpan is the pure mapping the tracker below leans on — a wider
// measured room span should never ask for more auto-gain than a narrower one.
describe("autoGainForSpan", () => {
  it("asks for full auto-gain at or below the crushed-span knee", () => {
    expect(autoGainForSpan(0)).toBe(AUTO_GAIN_MAX);
    expect(autoGainForSpan(15)).toBe(AUTO_GAIN_MAX);
  });

  it("asks for none at or above the full-span knee", () => {
    expect(autoGainForSpan(45)).toBe(AUTO_GAIN_MIN);
    expect(autoGainForSpan(90)).toBe(AUTO_GAIN_MIN);
  });

  it("is monotonically non-increasing as span widens", () => {
    let prev = autoGainForSpan(0);
    for (let span = 5; span <= 90; span += 5) {
      const value = autoGainForSpan(span);
      expect(value).toBeLessThanOrEqual(prev + 1e-9);
      prev = value;
    }
  });

  it("falls back to the fixed mapping on a non-finite reading — no trackers primed yet", () => {
    expect(autoGainForSpan(Number.NaN)).toBe(AUTO_GAIN_MIN);
  });
});

// One amount per device, shared by every test in this module instance, so
// each starts from a reset.
describe("auto-gain tracker", () => {
  beforeEach(() => {
    resetAutoGain();
  });

  it("starts at the fixed mapping, before the room has been measured", () => {
    expect(resolveAutoGain()).toBe(AUTO_GAIN_MIN);
  });

  it("eases gradually toward the target — a very short tick only moves it partway", () => {
    // warmRate's ceiling (1/WARM_T0_SEC, at warmSec=0) is the fastest this
    // ever eases — even that isn't an instant snap to the target on one
    // small tick.
    feedAutoGainMeasurement(0, 0.05);
    const afterOneTick = resolveAutoGain();
    expect(afterOneTick).toBeGreaterThan(AUTO_GAIN_MIN);
    expect(afterOneTick).toBeLessThan(AUTO_GAIN_MAX * 0.5);
  });

  // The regression test for warmStart.ts's whole point: fed in realistic
  // per-tick slices (not one giant dt), ~3s should already be most of the
  // way there — where an unwarmed ease (EASE_RATE alone, no warmRate) would
  // still be nowhere close.
  it("warm start gets most of the way to the target within ~3s of realistic ticks", () => {
    const dt = 0.1;
    for (let t = 0; t < 3; t += dt) feedAutoGainMeasurement(0, dt);
    expect(resolveAutoGain()).toBeGreaterThan(AUTO_GAIN_MAX * 0.8);
  });

  it("converges to the target given enough time", () => {
    feedAutoGainMeasurement(0, 120);
    expect(resolveAutoGain()).toBeCloseTo(AUTO_GAIN_MAX, 3);
  });
});

// An older version stored a manual amount and an Auto flag; a profile that
// still holds them must come up on the tracker like a fresh one.
describe("auto-gain on module load", () => {
  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
    vi.resetModules();
  });

  it("ignores a stored manual amount and Auto off", async () => {
    const store = new Map<string, string>([
      ["vibe.autoGain", "0.7"],
      ["vibe.autoGainAuto", "0"],
    ]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    vi.resetModules();
    const fresh = await import("../src/audio/autoGain.ts");
    expect(fresh.resolveAutoGain()).toBe(fresh.AUTO_GAIN_MIN);
    fresh.feedAutoGainMeasurement(0, 120);
    expect(fresh.resolveAutoGain()).toBeCloseTo(fresh.AUTO_GAIN_MAX, 3);
  });
});
