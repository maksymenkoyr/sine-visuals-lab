import { describe, it, expect } from "vitest";
import { bandLineDrive, isDefaultLine, sanitizeLine, LINE_HEIGHT_DEFAULT } from "../src/audio/bandLine.ts";
import { NUM_BANDS } from "../src/audio/types.ts";

function flatLine(v: number): Float32Array {
  return new Float32Array(NUM_BANDS).fill(v);
}

describe("bandLineDrive", () => {
  it("a flat-0 line at strength 1 equals the mean of the bands (FeatureFrame.energy)", () => {
    const bands = Float32Array.from({ length: NUM_BANDS }, (_, i) => (i % 5) / 10);
    const mean = Array.from(bands).reduce((a, b) => a + b, 0) / NUM_BANDS;
    const { drive } = bandLineDrive(bands, flatLine(0), 1);
    expect(drive).toBeCloseTo(mean, 6);
  });

  it("an all-1 line has no headroom anywhere, so drive is always 0", () => {
    const bands = flatLine(1);
    const { drive } = bandLineDrive(bands, flatLine(1), 1);
    expect(drive).toBe(0);
  });

  it("a band drawn to the top is ignored even at full signal", () => {
    const bands = flatLine(1);
    const line = flatLine(0);
    line[3] = 1;
    const { drive, excess } = bandLineDrive(bands, line, 1);
    expect(excess[3]).toBe(0);
    // Every other band is fully in and maxed out, so drive still saturates.
    expect(drive).toBe(1);
  });

  it("excess is normalised to the line's own headroom", () => {
    const { drive } = bandLineDrive(flatLine(0.75), flatLine(0.5), 1);
    expect(drive).toBeCloseTo(0.5, 6);
  });

  it("strength scales the drive and clamps at 1", () => {
    const bands = flatLine(0.6);
    const line = flatLine(0.5);
    const at1x = bandLineDrive(bands, line, 1).drive;
    const at2x = bandLineDrive(bands, line, 2).drive;
    expect(at2x).toBeCloseTo(Math.min(1, at1x * 2), 6);
    expect(bandLineDrive(bands, line, 100).drive).toBe(1);
  });

  it("sanitizes non-finite bands/line/strength rather than propagating NaN", () => {
    const bands = flatLine(0.5);
    bands[0] = Number.NaN;
    const line = flatLine(0.2);
    line[1] = Number.NaN;
    const { drive } = bandLineDrive(bands, line, Number.NaN);
    expect(Number.isFinite(drive)).toBe(true);
  });

  it("writes into the caller's own `out` rather than always allocating", () => {
    const out = { drive: 0, excess: new Float32Array(NUM_BANDS) };
    const result = bandLineDrive(flatLine(0.5), flatLine(0), 1, out);
    expect(result).toBe(out);
  });
});

describe("isDefaultLine", () => {
  it("is true only for the undrawn line (every band at the top)", () => {
    expect(isDefaultLine(flatLine(LINE_HEIGHT_DEFAULT))).toBe(true);
    expect(isDefaultLine(flatLine(0))).toBe(false);
    const line = flatLine(0);
    line[10] = 0.01;
    expect(isDefaultLine(line)).toBe(false);
  });
});

describe("sanitizeLine", () => {
  it("returns null for the wrong shape (wrong length, not an array)", () => {
    expect(sanitizeLine([0.1, 0.2])).toBeNull(); // wrong length
    expect(sanitizeLine("nope")).toBeNull();
    expect(sanitizeLine(null)).toBeNull();
    expect(sanitizeLine(undefined)).toBeNull();
  });

  it("sanitizes a non-numeric entry to LINE_HEIGHT_DEFAULT rather than failing the whole line", () => {
    const raw = Array.from({ length: NUM_BANDS }, () => "not a number");
    const line = sanitizeLine(raw);
    expect(line).not.toBeNull();
    for (let b = 0; b < NUM_BANDS; b++) expect(line![b]).toBe(LINE_HEIGHT_DEFAULT);
  });

  it("clamps out-of-range numeric entries into [0,1]", () => {
    const raw = Array.from({ length: NUM_BANDS }, (_, i) => (i === 0 ? -5 : i === 1 ? 5 : i / NUM_BANDS));
    const line = sanitizeLine(raw)!;
    expect(line[0]).toBe(0);
    expect(line[1]).toBe(1);
    for (let b = 2; b < NUM_BANDS; b++) expect(line[b]).toBeCloseTo(raw[b] as number);
  });

  it("passes a well-formed line through unchanged", () => {
    const raw = Array.from({ length: NUM_BANDS }, (_, i) => i / NUM_BANDS);
    const line = sanitizeLine(raw)!;
    for (let b = 0; b < NUM_BANDS; b++) expect(line[b]).toBeCloseTo(raw[b] as number);
  });
});
