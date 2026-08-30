import { describe, it, expect, beforeEach } from "vitest";
import {
  getAutoGain,
  setAutoGain,
  AUTO_GAIN_DEFAULT,
  AUTO_GAIN_MIN,
  AUTO_GAIN_MAX,
  isAutoGainAuto,
  setAutoGainAuto,
  resolveAutoGain,
  autoGainForSpan,
  feedAutoGainMeasurement,
} from "../src/audio/autoGain.ts";

// Like bandSplit, autoGain has no per-scene keying — it's one global value —
// so every test must reset first to avoid leaking state from whichever test
// ran before it (vitest runs a file's tests in one module instance, sharing
// the module-level cache).
describe("auto-gain persistence", () => {
  beforeEach(() => {
    setAutoGain(AUTO_GAIN_DEFAULT);
  });

  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — this also proves the module tolerates that.
  it("defaults to the fixed mapping (the bottom of the range)", () => {
    expect(AUTO_GAIN_DEFAULT).toBe(AUTO_GAIN_MIN);
    expect(getAutoGain()).toBe(AUTO_GAIN_MIN);
  });

  it("round-trips a set anywhere in the range", () => {
    setAutoGain(0.35);
    expect(getAutoGain()).toBeCloseTo(0.35);
    setAutoGain(AUTO_GAIN_MAX);
    expect(getAutoGain()).toBe(AUTO_GAIN_MAX);
  });

  it("clamps out-of-range and non-finite values", () => {
    setAutoGain(7);
    expect(getAutoGain()).toBe(AUTO_GAIN_MAX);
    setAutoGain(-2);
    expect(getAutoGain()).toBe(AUTO_GAIN_MIN);
    setAutoGain(Number.NaN);
    expect(getAutoGain()).toBe(AUTO_GAIN_DEFAULT);
  });
});

// autoGainForSpan is the pure mapping the auto mode below leans on — a wider
// measured room span should never ask for more auto-gain than a narrower one.
describe("autoGainForSpan", () => {
  it("asks for full auto-gain at or below the crushed-span knee", () => {
    expect(autoGainForSpan(0)).toBe(AUTO_GAIN_MAX);
    expect(autoGainForSpan(15)).toBe(AUTO_GAIN_MAX);
  });

  it("asks for none at or above the full-span knee — agreeing with the shipped default", () => {
    expect(autoGainForSpan(45)).toBe(AUTO_GAIN_MIN);
    expect(autoGainForSpan(90)).toBe(AUTO_GAIN_MIN);
    expect(autoGainForSpan(90)).toBe(AUTO_GAIN_DEFAULT);
  });

  it("is monotonically non-increasing as span widens", () => {
    let prev = autoGainForSpan(0);
    for (let span = 5; span <= 90; span += 5) {
      const value = autoGainForSpan(span);
      expect(value).toBeLessThanOrEqual(prev + 1e-9);
      prev = value;
    }
  });

  it("falls back to the default on a non-finite reading — no trackers primed yet", () => {
    expect(autoGainForSpan(Number.NaN)).toBe(AUTO_GAIN_DEFAULT);
  });
});

describe("auto-gain auto mode", () => {
  beforeEach(() => {
    // Auto must be off before resetting the manual value, or setAutoGain
    // wouldn't be the thing driving resolveAutoGain() during the reset itself.
    setAutoGainAuto(false);
    setAutoGain(AUTO_GAIN_DEFAULT);
  });

  it("defaults off, and resolves to the manual value while off", () => {
    expect(isAutoGainAuto()).toBe(false);
    setAutoGain(0.4);
    expect(resolveAutoGain()).toBe(0.4);
  });

  it("is a no-op to feed measurements while off — resolveAutoGain stays on the manual value", () => {
    setAutoGain(0.2);
    feedAutoGainMeasurement(0, 5);
    expect(resolveAutoGain()).toBe(0.2);
  });

  it("toggling on seeds from the current manual value — no jump on the chip click", () => {
    setAutoGain(0.6);
    setAutoGainAuto(true);
    expect(resolveAutoGain()).toBeCloseTo(0.6);
  });

  it("round-trips the flag", () => {
    setAutoGainAuto(true);
    expect(isAutoGainAuto()).toBe(true);
    setAutoGainAuto(false);
    expect(isAutoGainAuto()).toBe(false);
  });

  it("eases gradually toward the target — a short dt only moves it partway", () => {
    setAutoGain(AUTO_GAIN_MIN); // seed point
    setAutoGainAuto(true);
    // A crushed span asks for AUTO_GAIN_MAX; one second in should be well on
    // the way but nowhere near arrived, given the ~10s time constant.
    feedAutoGainMeasurement(0, 1);
    const afterOneSec = resolveAutoGain();
    expect(afterOneSec).toBeGreaterThan(AUTO_GAIN_MIN);
    expect(afterOneSec).toBeLessThan(AUTO_GAIN_MAX * 0.5);
  });

  it("converges to the target given enough time", () => {
    setAutoGain(AUTO_GAIN_MIN);
    setAutoGainAuto(true);
    feedAutoGainMeasurement(0, 120);
    expect(resolveAutoGain()).toBeCloseTo(AUTO_GAIN_MAX, 3);
  });
});
