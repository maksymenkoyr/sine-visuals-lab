import { describe, it, expect } from "vitest";
import { createPlayKey, glideMsForHold, PLAY_TAP_MAX_MS } from "../src/ui/outputKeys.ts";
import { GLIDE_MAX_MS, GLIDE_MIN_MS } from "../src/net/outputGlide.ts";

describe("glideMsForHold", () => {
  it("is a tap (null) under the threshold", () => {
    expect(glideMsForHold(0)).toBeNull();
    expect(glideMsForHold(PLAY_TAP_MAX_MS - 1)).toBeNull();
  });
  it("glides twice as long as the hold: 3 s held -> 6 s", () => {
    expect(glideMsForHold(3000)).toBe(6000);
  });
  it("clamps to the shortest and longest glide", () => {
    expect(glideMsForHold(PLAY_TAP_MAX_MS)).toBe(GLIDE_MIN_MS);
    expect(glideMsForHold(10 * GLIDE_MAX_MS)).toBe(GLIDE_MAX_MS);
  });
});

describe("createPlayKey", () => {
  it("returns the hold length on a clean press and release", () => {
    const k = createPlayKey();
    k.down(1000);
    expect(k.holdMs(1500)).toBe(500);
    expect(k.up(4000)).toBe(3000);
    expect(k.holdMs(4100)).toBeNull();
  });

  it("ignores a second down while held (auto-repeat, the other Option key)", () => {
    const k = createPlayKey();
    k.down(1000);
    k.down(2000);
    expect(k.up(3000)).toBe(2000);
  });

  it("is not a Play when another key or a click came in between", () => {
    const k = createPlayKey();
    k.down(0);
    k.cancel();
    expect(k.holdMs(100)).toBeNull();
    expect(k.up(200)).toBeNull();
    k.down(1000); // and the next press is clean again
    expect(k.up(1100)).toBe(100);
  });

  it("a cancel with nothing held does not poison the next press", () => {
    const k = createPlayKey();
    k.cancel();
    k.down(0);
    expect(k.up(50)).toBe(50);
  });

  it("an up that never saw a down is nothing", () => {
    expect(createPlayKey().up(10)).toBeNull();
  });

  it("reset (window lost focus) clears a held press so the next one starts clean", () => {
    const k = createPlayKey();
    k.down(0);
    k.reset();
    k.down(5000);
    expect(k.up(5300)).toBe(300);
  });
});
