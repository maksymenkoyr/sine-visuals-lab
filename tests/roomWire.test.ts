import { describe, it, expect } from "vitest";
import { cleanName, isValidDeviceId, MAX_NAME_CHARS, parseViewport } from "../server/roomWire.ts";

describe("parseViewport", () => {
  it("accepts four numbers", () => {
    expect(parseViewport({ x: 0, y: 0.5, w: 1, h: 0.5 })).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });
  it("rejects a missing or non-number field, and non-objects", () => {
    expect(parseViewport({ x: 0, y: 0, w: 1 })).toBeUndefined();
    expect(parseViewport({ x: 0, y: 0, w: 1, h: "1" })).toBeUndefined();
    expect(parseViewport(null)).toBeUndefined();
    expect(parseViewport("full")).toBeUndefined();
  });
});

describe("isValidDeviceId", () => {
  it("accepts what the client generates", () => {
    expect(isValidDeviceId(crypto.randomUUID())).toBe(true);
  });
  it("rejects empty, over-long and odd-character ids", () => {
    expect(isValidDeviceId("")).toBe(false);
    expect(isValidDeviceId("x".repeat(300))).toBe(false);
    expect(isValidDeviceId("a b")).toBe(false);
  });
});

describe("cleanName", () => {
  it("keeps a string up to the cap", () => {
    expect(cleanName("mesh")).toBe("mesh");
    expect(cleanName("x".repeat(MAX_NAME_CHARS))).toHaveLength(MAX_NAME_CHARS);
  });
  it("drops non-strings and over-long strings", () => {
    expect(cleanName(undefined)).toBeUndefined();
    expect(cleanName(7)).toBeUndefined();
    expect(cleanName({})).toBeUndefined();
    expect(cleanName("x".repeat(MAX_NAME_CHARS + 1))).toBeUndefined();
  });
});
