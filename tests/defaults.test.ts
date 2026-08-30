import { describe, it, expect } from "vitest";
import { getDefaultOverride, setDefaultOverride } from "../src/tuning/defaults.ts";

describe("default overrides map", () => {
  it("getDefaultOverride returns undefined until set, then the set value", () => {
    expect(getDefaultOverride("scene-def-1", "amplitude")).toBeUndefined();
    setDefaultOverride("scene-def-1", "amplitude", 1.5);
    expect(getDefaultOverride("scene-def-1", "amplitude")).toBe(1.5);
  });

  it("round-trips a value far outside any plausible spec range unchanged", () => {
    setDefaultOverride("scene-def-huge", "focus", 4.2);
    expect(getDefaultOverride("scene-def-huge", "focus")).toBe(4.2);
    setDefaultOverride("scene-def-huge", "negative", -999);
    expect(getDefaultOverride("scene-def-huge", "negative")).toBe(-999);
  });

  it("rejects non-finite values, leaving any existing override untouched", () => {
    setDefaultOverride("scene-def-nan", "focus", 0.5);
    setDefaultOverride("scene-def-nan", "focus", NaN);
    expect(getDefaultOverride("scene-def-nan", "focus")).toBe(0.5);
    setDefaultOverride("scene-def-nan", "focus", Infinity);
    expect(getDefaultOverride("scene-def-nan", "focus")).toBe(0.5);
  });

  it("keeps different keys within the same scene independent", () => {
    setDefaultOverride("scene-def-2", "focus", 0.1);
    setDefaultOverride("scene-def-2", "breathe", 0.9);
    expect(getDefaultOverride("scene-def-2", "focus")).toBe(0.1);
    expect(getDefaultOverride("scene-def-2", "breathe")).toBe(0.9);
  });

  it("keeps the same key independent across different scenes", () => {
    setDefaultOverride("scene-def-3a", "focus", 0.2);
    setDefaultOverride("scene-def-3b", "focus", 0.8);
    expect(getDefaultOverride("scene-def-3a", "focus")).toBe(0.2);
    expect(getDefaultOverride("scene-def-3b", "focus")).toBe(0.8);
  });

  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — proves the module tolerates that, the
  // same way pins.ts's equivalent test does.
  it("works with no localStorage global — everything above already proved this, this just names it", () => {
    expect(typeof localStorage).toBe("undefined");
    setDefaultOverride("scene-def-nostore", "focus", 1);
    expect(getDefaultOverride("scene-def-nostore", "focus")).toBe(1);
  });
});
