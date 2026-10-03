import { describe, it, expect } from "vitest";
import { isValidRoomCode, normalizeRoomCodeInput, roomCodeFromParam } from "../src/net/roomCode.ts";

describe("normalizeRoomCodeInput", () => {
  it("upper-cases and drops spaces and punctuation", () => {
    expect(normalizeRoomCodeInput("k7 m-2")).toBe("K7M2");
  });
  it("caps at one code's length so a pasted URL tail can't overflow the field", () => {
    expect(normalizeRoomCodeInput("ABCDEFG")).toBe("ABCD");
  });
});

describe("isValidRoomCode", () => {
  it("accepts a code the Worker could issue", () => {
    expect(isValidRoomCode("K7M2")).toBe(true);
  });
  it("rejects look-alike characters the Worker never issues", () => {
    expect(isValidRoomCode("K7M0")).toBe(false);
    expect(isValidRoomCode("K7MI")).toBe(false);
  });
  it("rejects short and long input", () => {
    expect(isValidRoomCode("K7M")).toBe(false);
    expect(isValidRoomCode("K7M2X")).toBe(false);
  });
});

describe("roomCodeFromParam", () => {
  it("returns null for a missing or malformed value", () => {
    expect(roomCodeFromParam(null)).toBeNull();
    expect(roomCodeFromParam("hello")).toBeNull();
  });
  it("normalizes a lower-case link value", () => {
    expect(roomCodeFromParam("k7m2")).toBe("K7M2");
  });
});
