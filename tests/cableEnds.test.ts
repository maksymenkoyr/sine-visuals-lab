// Which end a click on a cable unplugs, so its retract runs from there
// (src/ui/cableLayer.ts header); the pointer wiring is checked in a browser.
import { describe, expect, it } from "vitest";
import { nearerEnd } from "../src/ui/cableLayer.ts";

describe("nearerEnd", () => {
  it("unplugs the end nearer the click", () => {
    expect(nearerEnd({ x: 100 }, { x: 900 }, 300)).toBe("jack");
    expect(nearerEnd({ x: 100 }, { x: 900 }, 700)).toBe("port");
  });

  it("goes by distance, not side, when the port sits left of the jack", () => {
    expect(nearerEnd({ x: 900 }, { x: 100 }, 300)).toBe("port");
    expect(nearerEnd({ x: 900 }, { x: 100 }, 700)).toBe("jack");
  });
});
