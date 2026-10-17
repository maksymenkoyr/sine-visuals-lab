// What a screen reader says for a panel slider (src/ui/sliderValueText.ts):
// the readout's number and unit, or "Off". Pure, so checked in node. The DOM
// wiring in createControlRow has no node test (there is no DOM here).
import { describe, it, expect } from "vitest";
import { isOffReadout, sliderValueText } from "../src/ui/sliderValueText.ts";

describe("sliderValueText", () => {
  it("formats the setting's value through format, with a glued × unit", () => {
    expect(sliderValueText(0.4567, { format: (v) => v.toFixed(2), unit: "×" })).toBe("0.46×");
  });

  it("glues % to a percent readout, rounding the scaled value", () => {
    expect(sliderValueText(0.456, { format: (v) => String(Math.round(v * 100)), unit: "%" })).toBe("46%");
  });

  it("puts a space before a word unit", () => {
    expect(sliderValueText(12.5, { format: (v) => v.toFixed(1), unit: "ms" })).toBe("12.5 ms");
    expect(sliderValueText(2, { format: (v) => v.toFixed(1), unit: "s" })).toBe("2.0 s");
  });

  it("adds no trailing space when there is no unit", () => {
    expect(sliderValueText(3.14159, { format: (v) => v.toFixed(3) })).toBe("3.142");
  });

  it("says Off when muted, whatever the value", () => {
    expect(sliderValueText(7.3, { format: (v) => v.toFixed(1), unit: "×", muted: true })).toBe("Off");
  });

  it("says Off on a zeroAtMin row at or below zero, and the number above it", () => {
    const o = { format: (v: number) => v.toFixed(2), unit: "×", zeroAtMin: true };
    expect(sliderValueText(0, o)).toBe("Off");
    expect(sliderValueText(-0, o)).toBe("Off");
    expect(sliderValueText(-2, o)).toBe("Off");
    expect(sliderValueText(0.01, o)).toBe("0.01×");
  });

  it("keeps a zero reading as a number when the row has no Off stop", () => {
    const format = (v: number) => v.toFixed(2);
    expect(sliderValueText(0, { format, unit: "×", zeroAtMin: false })).toBe("0.00×");
    expect(sliderValueText(0, { format, unit: "×" })).toBe("0.00×");
  });
});

describe("isOffReadout", () => {
  it("is off only for a live value on a zeroAtMin row, or when muted", () => {
    expect(isOffReadout(0.5, false, true)).toBe(false);
    expect(isOffReadout(0, false, undefined)).toBe(false);
    expect(isOffReadout(0, true, false)).toBe(true);
  });
});
