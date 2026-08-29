import { describe, it, expect, beforeEach } from "vitest";
import { getPowerMode, setPowerMode, POWER_MODE_DEFAULT } from "../src/render/powerMode.ts";

// Like autoGain/bandSplit, powerMode has no per-scene keying — it's one
// global value — so every test must reset first to avoid leaking state from
// whichever test ran before it (vitest runs a file's tests in one module
// instance, sharing the module-level cache).
describe("power mode persistence", () => {
  beforeEach(() => {
    setPowerMode(POWER_MODE_DEFAULT);
  });

  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — this also proves the module tolerates that.
  it("defaults to auto", () => {
    expect(POWER_MODE_DEFAULT).toBe("auto");
    expect(getPowerMode()).toBe("auto");
  });

  it("round-trips a set", () => {
    setPowerMode("on");
    expect(getPowerMode()).toBe("on");
    setPowerMode("off");
    expect(getPowerMode()).toBe("off");
    setPowerMode("auto");
    expect(getPowerMode()).toBe("auto");
  });
});
