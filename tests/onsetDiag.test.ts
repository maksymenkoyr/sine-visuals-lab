import { describe, it, expect } from "vitest";
import { verdictOf, type OnsetDiag } from "../src/audio/onsetDiag.ts";

describe("verdictOf", () => {
  const base: OnsetDiag = { ratio: 0, gated: false, blocked: false, sinceOnsetSec: Infinity };

  it("fired beats everything else", () => {
    expect(verdictOf(true, { ...base, gated: true, blocked: true })).toBe("fired");
  });

  it("gated beats blocked", () => {
    expect(verdictOf(false, { ...base, gated: true, blocked: true })).toBe("gated");
  });

  it("blocked beats miss", () => {
    expect(verdictOf(false, { ...base, blocked: true })).toBe("blocked");
  });

  it("miss when nothing else applies", () => {
    expect(verdictOf(false, base)).toBe("miss");
  });
});
