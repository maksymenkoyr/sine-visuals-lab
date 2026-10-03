import { describe, expect, it } from "vitest";
import { earsChange, listensOwn } from "../src/net/ears.ts";

describe("listensOwn", () => {
  it("a solo page always listens, whatever the room would say", () => {
    expect(listensOwn("solo", null, null)).toBe(true);
    expect(listensOwn("solo", { ears: "follow" }, null)).toBe(true);
    expect(listensOwn("solo", null, "follow")).toBe(true);
  });

  it("before the first roster the role decides: the host listens, any other member follows", () => {
    expect(listensOwn("host", null, null)).toBe(true);
    expect(listensOwn("renderer", null, null)).toBe(false);
  });

  it("once the room lists this device its record decides, for either role", () => {
    expect(listensOwn("host", { ears: "follow" }, null)).toBe(false);
    expect(listensOwn("host", { ears: "own" }, null)).toBe(true);
    expect(listensOwn("renderer", { ears: "own" }, null)).toBe(true);
    expect(listensOwn("renderer", { ears: "follow" }, null)).toBe(false);
  });

  it("a choice just made wins over the record until the room echoes it", () => {
    expect(listensOwn("renderer", { ears: "follow" }, "own")).toBe(true);
    expect(listensOwn("host", { ears: "own" }, "follow")).toBe(false);
  });

  it("a pending choice also wins before any roster", () => {
    expect(listensOwn("renderer", null, "own")).toBe(true);
    expect(listensOwn("host", null, "follow")).toBe(false);
  });
});

describe("earsChange", () => {
  it("names the transition, or none when the answer did not change", () => {
    expect(earsChange(false, true)).toBe("start-own");
    expect(earsChange(true, false)).toBe("stop-own");
    expect(earsChange(true, true)).toBe("none");
    expect(earsChange(false, false)).toBe("none");
  });
});
