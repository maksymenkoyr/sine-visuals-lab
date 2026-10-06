import { describe, expect, it } from "vitest";
import { allowedChar, fitTyped, parseTyped } from "../src/ui/typedValue.ts";

describe("parseTyped", () => {
  it("reads plain, signed and point-led numbers", () => {
    expect(parseTyped("0.42")).toBe(0.42);
    expect(parseTyped(" 3 ")).toBe(3);
    expect(parseTyped("-1.5")).toBe(-1.5);
    expect(parseTyped(".5")).toBe(0.5);
    expect(parseTyped("2.")).toBe(2);
  });

  it("takes a comma as the decimal point", () => {
    expect(parseTyped("1,25")).toBe(1.25);
  });

  it("rejects empty and malformed text rather than guessing", () => {
    for (const t of ["", " ", "-", ".", "1.2.3", "1,2,3", "--1", "1-", "abc", "1e3", "Infinity", "0x10"]) {
      expect(parseTyped(t)).toBeNull();
    }
  });
});

describe("fitTyped", () => {
  const linear = { min: 0, max: 2 };

  it("keeps an in-range value exactly as typed", () => {
    expect(fitTyped(0.123, linear)).toBe(0.123);
  });

  it("clamps to the slider's ends", () => {
    expect(fitTyped(5, linear)).toBe(2);
    expect(fitTyped(-1, linear)).toBe(0);
  });

  it("divides by the readout's scale (a % row)", () => {
    expect(fitTyped(40, { min: 0, max: 1, scale: 100 })).toBeCloseTo(0.4);
    expect(fitTyped(250, { min: 0, max: 1, scale: 100 })).toBe(1);
  });

  it("snaps a discrete row to its nearest detent, from min", () => {
    expect(fitTyped(3.4, { min: 1, max: 8, step: 1 })).toBe(3);
    expect(fitTyped(3.6, { min: 1, max: 8, step: 1 })).toBe(4);
    expect(fitTyped(7, { min: 1, max: 9, step: 2 })).toBe(7);
    expect(fitTyped(6.2, { min: 1, max: 9, step: 2 })).toBe(7);
    expect(fitTyped(100, { min: 1, max: 8, step: 1 })).toBe(8);
  });

  it("leaves a fine step (below 1) continuous, like the slider", () => {
    expect(fitTyped(0.123, { min: 0, max: 1, step: 0.05 })).toBe(0.123);
  });

  it("reads 0 and below as Off on a row with an Off stop", () => {
    const gain = { min: 0.1, max: 10, zeroAtMin: true };
    expect(fitTyped(0, gain)).toBe(0);
    expect(fitTyped(-3, gain)).toBe(0);
    expect(fitTyped(0.01, gain)).toBe(0.1);
    expect(fitTyped(4, gain)).toBe(4);
  });
});

describe("allowedChar", () => {
  it("lets digits, a point, a comma and a minus through", () => {
    for (const c of "0123456789.,-") expect(allowedChar(c)).toBe(true);
  });

  it("blocks letters, units and pasted runs", () => {
    for (const c of ["a", "e", "%", "×", "+", " ", "12"]) expect(allowedChar(c)).toBe(false);
  });
});
