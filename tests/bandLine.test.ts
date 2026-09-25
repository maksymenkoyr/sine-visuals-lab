import { describe, it, expect, vi, afterEach } from "vitest";
import {
  LINE_STRENGTH_DEFAULT,
  LINE_STRENGTH_MAX,
  LINE_STRENGTH_MIN,
  bandLineDrive,
  getBandLine,
  getBandLineStrength,
  isDefaultLine,
  resetBandLine,
  resetBandLineStrength,
  setBandLine,
  setBandLineBand,
  setBandLineStrength, LINE_HEIGHT_DEFAULT } from "../src/audio/bandLine.ts";
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

describe("band line store", () => {
  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — this also proves the module tolerates that.
  it("a scene that's never been drawn on reads as flat LINE_HEIGHT_DEFAULT (the top: ignored)", () => {
    const line = getBandLine("nonexistent-scene");
    for (let b = 0; b < NUM_BANDS; b++) expect(line[b]).toBe(LINE_HEIGHT_DEFAULT);
    expect(isDefaultLine(line)).toBe(true);
  });

  it("stores each band independently per scene and clamps out-of-range heights", () => {
    setBandLineBand("scene-a", 0, 1.5);
    setBandLineBand("scene-a", 5, -1);
    setBandLineBand("scene-a", 10, 0.4);
    const line = getBandLine("scene-a");
    expect(line[0]).toBe(1);
    expect(line[5]).toBe(0);
    expect(line[10]).toBeCloseTo(0.4);
    expect(isDefaultLine(line)).toBe(false);
  });

  it("doesn't leak between scenes", () => {
    setBandLineBand("scene-b1", 2, 0.9);
    setBandLineBand("scene-b2", 2, 0.1);
    expect(getBandLine("scene-b1")[2]).toBeCloseTo(0.9);
    expect(getBandLine("scene-b2")[2]).toBeCloseTo(0.1);
  });

  it("setBandLine round-trips a whole line and clamps every entry", () => {
    const heights = Array.from({ length: NUM_BANDS }, (_, i) => (i === 0 ? -5 : i === 1 ? 5 : i / NUM_BANDS));
    setBandLine("scene-whole", heights);
    const line = getBandLine("scene-whole");
    expect(line[0]).toBe(0);
    expect(line[1]).toBe(1);
    for (let b = 2; b < NUM_BANDS; b++) expect(line[b]).toBeCloseTo(heights[b] as number);
  });

  it("resetBandLine returns a scene to the undrawn default", () => {
    setBandLineBand("scene-reset", 4, 0.8);
    resetBandLine("scene-reset");
    expect(isDefaultLine(getBandLine("scene-reset"))).toBe(true);
  });

  it("getBandLine writes into the caller's array when given one", () => {
    const mine = new Float32Array(NUM_BANDS);
    expect(getBandLine("nonexistent-scene", mine)).toBe(mine);
  });

  it("ignores an out-of-range band index on write", () => {
    setBandLineBand("scene-oob", -1, 0.5);
    setBandLineBand("scene-oob", NUM_BANDS, 0.5);
    expect(isDefaultLine(getBandLine("scene-oob"))).toBe(true);
  });
});

describe("band line strength store", () => {
  it("defaults to LINE_STRENGTH_DEFAULT for an untouched scene", () => {
    expect(getBandLineStrength("nonexistent-scene")).toBe(LINE_STRENGTH_DEFAULT);
  });

  it("round-trips and clamps to LINE_STRENGTH_MIN/MAX", () => {
    setBandLineStrength("scene-s", 2.5);
    expect(getBandLineStrength("scene-s")).toBe(2.5);
    setBandLineStrength("scene-s", 999);
    expect(getBandLineStrength("scene-s")).toBe(LINE_STRENGTH_MAX);
    setBandLineStrength("scene-s", -1);
    expect(getBandLineStrength("scene-s")).toBe(LINE_STRENGTH_MIN);
  });

  it("resetBandLineStrength returns to the default", () => {
    setBandLineStrength("scene-s2", 3);
    resetBandLineStrength("scene-s2");
    expect(getBandLineStrength("scene-s2")).toBe(LINE_STRENGTH_DEFAULT);
  });
});

describe("band line store with a stubbed localStorage", () => {
  // The cache is seeded once at module load — so exercising "garbage in
  // storage" means installing a fake localStorage *before* a fresh import of
  // the module, via vi.resetModules(), same recipe as
  // tests/sensitivity.test.ts's own legacy-migration block.
  function makeFakeLocalStorage() {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      raw: store,
    };
  }

  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
    vi.resetModules();
  });

  it("a garbage stored line (wrong length, non-array, non-numeric entries) falls back to the default", async () => {
    const fake = makeFakeLocalStorage();
    fake.setItem(
      "vibe.bandLine",
      JSON.stringify({
        "scene-short": [0.1, 0.2], // wrong length
        "scene-not-array": "nope",
        "scene-nan": Array.from({ length: NUM_BANDS }, () => "not a number"),
      }),
    );
    (globalThis as { localStorage?: unknown }).localStorage = fake;

    vi.resetModules();
    const fresh = await import("../src/audio/bandLine.ts");

    expect(fresh.isDefaultLine(fresh.getBandLine("scene-short"))).toBe(true);
    expect(fresh.isDefaultLine(fresh.getBandLine("scene-not-array"))).toBe(true);
    expect(fresh.isDefaultLine(fresh.getBandLine("scene-nan"))).toBe(true);
  });

  it("a well-formed stored line loads correctly", async () => {
    const fake = makeFakeLocalStorage();
    const heights = Array.from({ length: NUM_BANDS }, (_, i) => i / NUM_BANDS);
    fake.setItem("vibe.bandLine", JSON.stringify({ "scene-good": heights }));
    (globalThis as { localStorage?: unknown }).localStorage = fake;

    vi.resetModules();
    const fresh = await import("../src/audio/bandLine.ts");

    const line = fresh.getBandLine("scene-good");
    for (let b = 0; b < NUM_BANDS; b++) expect(line[b]).toBeCloseTo(heights[b] as number);
  });
});
