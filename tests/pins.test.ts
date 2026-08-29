import { describe, it, expect, afterEach } from "vitest";
import { clearAllPins, clearPin, getPin, pinSnapshot, setPin } from "../src/tuning/pins.ts";

afterEach(() => {
  clearAllPins();
});

describe("pins map", () => {
  it("getPin returns undefined until set, then the set value", () => {
    expect(getPin("scene-pin-1", "amplitude")).toBeUndefined();
    setPin("scene-pin-1", "amplitude", 1.5);
    expect(getPin("scene-pin-1", "amplitude")).toBe(1.5);
  });

  // The load-bearing case: this is the one property that distinguishes a pin
  // from sceneSettings.ts's store, whose clamp() would silently clip either
  // of these to a spec's min/max. A pin has no spec at all — nothing here
  // clamps.
  it("round-trips a value far outside any plausible spec range unchanged", () => {
    setPin("scene-pin-huge", "focus", 4.2);
    expect(getPin("scene-pin-huge", "focus")).toBe(4.2);
    setPin("scene-pin-huge", "negative", -999);
    expect(getPin("scene-pin-huge", "negative")).toBe(-999);
  });

  it("rejects non-finite values, leaving any existing pin untouched", () => {
    setPin("scene-pin-nan", "focus", 0.5);
    setPin("scene-pin-nan", "focus", NaN);
    expect(getPin("scene-pin-nan", "focus")).toBe(0.5);
    setPin("scene-pin-nan", "focus", Infinity);
    expect(getPin("scene-pin-nan", "focus")).toBe(0.5);
  });

  it("clearPin removes exactly the one key", () => {
    setPin("scene-pin-2", "a", 1);
    setPin("scene-pin-2", "b", 2);
    clearPin("scene-pin-2", "a");
    expect(getPin("scene-pin-2", "a")).toBeUndefined();
    expect(getPin("scene-pin-2", "b")).toBe(2);
  });

  it("clearPin on a key that was never set is a no-op", () => {
    expect(() => clearPin("scene-pin-missing", "nope")).not.toThrow();
  });

  it("clearAllPins drops every key regardless of scene", () => {
    setPin("scene-pin-3", "a", 1);
    setPin("scene-pin-4", "b", 2);
    clearAllPins();
    expect(getPin("scene-pin-3", "a")).toBeUndefined();
    expect(getPin("scene-pin-4", "b")).toBeUndefined();
  });

  it("keeps different keys within the same scene independent", () => {
    setPin("scene-pin-5", "focus", 0.1);
    setPin("scene-pin-5", "breathe", 0.9);
    expect(getPin("scene-pin-5", "focus")).toBe(0.1);
    expect(getPin("scene-pin-5", "breathe")).toBe(0.9);
  });

  it("keeps the same key independent across different scenes", () => {
    setPin("scene-pin-6a", "focus", 0.2);
    setPin("scene-pin-6b", "focus", 0.8);
    expect(getPin("scene-pin-6a", "focus")).toBe(0.2);
    expect(getPin("scene-pin-6b", "focus")).toBe(0.8);
  });

  it("pinSnapshot reports every active pin, keyed by scene:key", () => {
    setPin("scene-pin-7", "focus", 3);
    setPin("scene-pin-8", "breathe", -1);
    const snap = pinSnapshot();
    expect(snap["scene-pin-7:focus"]).toBe(3);
    expect(snap["scene-pin-8:breathe"]).toBe(-1);
  });

  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — proves the module tolerates that
  // (getPin/setPin/clearPin all reach through the same lazy store() /
  // persist() as sceneSettings.ts's equivalent functions).
  it("works with no localStorage global — everything above already proved this, this just names it", () => {
    expect(typeof localStorage).toBe("undefined");
    setPin("scene-pin-nostore", "focus", 1);
    expect(getPin("scene-pin-nostore", "focus")).toBe(1);
  });
});
