import { describe, it, expect, beforeEach } from "vitest";
import { getQualityChoice, setQualityChoice, QUALITY_CHOICE_DEFAULT } from "../src/render/qualityPref.ts";

// Like powerMode/autoGain/bandSplit, qualityPref has no per-scene keying —
// it's one global value — so every test must reset first to avoid leaking
// state from whichever test ran before it (vitest runs a file's tests in one
// module instance, sharing the module-level cache).
describe("quality choice persistence", () => {
  beforeEach(() => {
    setQualityChoice(QUALITY_CHOICE_DEFAULT);
  });

  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — this also proves the module tolerates that.
  it("defaults to auto", () => {
    expect(QUALITY_CHOICE_DEFAULT).toBe("auto");
    expect(getQualityChoice()).toBe("auto");
  });

  it("round-trips a set", () => {
    for (const choice of ["high", "mid", "low", "floor", "auto"] as const) {
      setQualityChoice(choice);
      expect(getQualityChoice()).toBe(choice);
    }
  });
});
