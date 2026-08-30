import { describe, it, expect, beforeEach } from "vitest";
import { getAutoGain, setAutoGain, AUTO_GAIN_DEFAULT, AUTO_GAIN_MIN, AUTO_GAIN_MAX } from "../src/audio/autoGain.ts";

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
