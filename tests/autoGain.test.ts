import { describe, it, expect, beforeEach } from "vitest";
import { isAutoGainEnabled, setAutoGainEnabled, AUTO_GAIN_DEFAULT } from "../src/audio/autoGain.ts";

// Like bandSplit, autoGain has no per-scene keying — it's one global value —
// so every test must reset first to avoid leaking state from whichever test
// ran before it (vitest runs a file's tests in one module instance, sharing
// the module-level cache).
describe("auto-gain persistence", () => {
  beforeEach(() => {
    setAutoGainEnabled(AUTO_GAIN_DEFAULT);
  });

  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — this also proves the module tolerates that.
  it("defaults to off", () => {
    expect(AUTO_GAIN_DEFAULT).toBe(false);
    expect(isAutoGainEnabled()).toBe(false);
  });

  it("round-trips a set", () => {
    setAutoGainEnabled(false);
    expect(isAutoGainEnabled()).toBe(false);
    setAutoGainEnabled(true);
    expect(isAutoGainEnabled()).toBe(true);
  });
});
