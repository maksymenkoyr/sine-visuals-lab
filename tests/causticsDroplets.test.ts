// causticsDroplets.ts's pure side: the drop cap per quality preset, how
// often a free block opens a hole, and how fast the water stops a drop. The
// GPU passes themselves are checked headless (docs/scenes/caustics.md,
// Droplets' Decisions entry).
import { describe, expect, it } from "vitest";
import {
  blockLife,
  dropCap,
  dropDrag,
  dropFade,
  dropRadius,
  DROPS_PER_HOLE,
  dropThrow,
  holeStrength,
  MAX_DROPS,
  openChance,
  relativeSpeed,
} from "../src/render/scenes/causticsDroplets.ts";
import { qualitySettings, QUALITY_PRESET_ORDER } from "../src/render/quality.ts";
import { causticsScene } from "../src/render/scenes/caustics.ts";

const setting = (key: string) => (causticsScene.settings ?? []).find((s) => s.key === key)!;
const DEFAULT_SIZE = setting("dropSize").default;
const DEFAULT_THROW = setting("dropThrow").default;
const DEFAULT_WEIGHT = setting("dropWeight").default;

describe("dropCap", () => {
  it("is a whole number of holes, at most MAX_DROPS, and grows with the preset", () => {
    let last = 0;
    for (const preset of QUALITY_PRESET_ORDER) {
      const cap = dropCap(qualitySettings(preset).maxParticles);
      expect(cap % DROPS_PER_HOLE, preset).toBe(0);
      expect(cap, preset).toBeLessThanOrEqual(MAX_DROPS);
      expect(cap, preset).toBeGreaterThanOrEqual(last);
      last = cap;
    }
    expect(dropCap(qualitySettings("high").maxParticles)).toBe(MAX_DROPS);
  });

  it("never drops below one hole's worth", () => {
    expect(dropCap(0)).toBe(DROPS_PER_HOLE);
  });
});

describe("openChance", () => {
  it("opens nothing without pressure, Amount, Sparkle or time", () => {
    expect(openChance(1 / 60, 0, 1, 1)).toBe(0);
    expect(openChance(1 / 60, 1, 0, 1)).toBe(0);
    expect(openChance(1 / 60, 1, 1, 0)).toBe(0);
    expect(openChance(0, 1, 1, 1)).toBe(0);
    expect(openChance(1 / 60, -0.5, 1, 1)).toBe(0); // Bell's swing below zero
  });

  it("grows with each of pressure, Amount and Sparkle", () => {
    const base = openChance(1 / 60, 0.5, 0.5, 0.5);
    expect(openChance(1 / 60, 1, 0.5, 0.5)).toBeGreaterThan(base);
    expect(openChance(1 / 60, 0.5, 1, 0.5)).toBeGreaterThan(base);
    expect(openChance(1 / 60, 0.5, 0.5, 1)).toBeGreaterThan(base);
  });

  it("is the same over a second at any frame rate", () => {
    const stayClosed = (fps: number) => Math.pow(1 - openChance(1 / fps, 0.8, 0.5, 0.41), fps);
    expect(stayClosed(30)).toBeCloseTo(stayClosed(144), 10);
  });
});

describe("holeStrength", () => {
  it("is the pressure, never below zero and capped", () => {
    expect(holeStrength(-1)).toBe(0);
    expect(holeStrength(0.7)).toBe(0.7);
    expect(holeStrength(5)).toBeLessThan(5);
    expect(holeStrength(5)).toBe(holeStrength(50));
  });
});

describe("the water stops a drop", () => {
  const v0 = dropThrow(DEFAULT_THROW);

  it("to within 0.05 p/s of the current by 0.4 s for a typical drop at the defaults", () => {
    expect(relativeSpeed(v0, 0.4, dropRadius(DEFAULT_SIZE), DEFAULT_WEIGHT)).toBeLessThan(0.05);
  });

  it("by 0.8 s even for the largest drop the spread allows (four times typical)", () => {
    expect(relativeSpeed(v0, 0.8, 4 * dropRadius(DEFAULT_SIZE), DEFAULT_WEIGHT)).toBeLessThan(0.05);
  });

  it("sooner when the drop is smaller or lighter", () => {
    const r = dropRadius(DEFAULT_SIZE);
    expect(relativeSpeed(v0, 0.1, r / 2, DEFAULT_WEIGHT)).toBeLessThan(relativeSpeed(v0, 0.1, r, DEFAULT_WEIGHT));
    expect(relativeSpeed(v0, 0.1, r, 0)).toBeLessThan(relativeSpeed(v0, 0.1, r, 1));
    expect(dropDrag(0)).toBeGreaterThan(dropDrag(1));
  });
});

describe("the dials", () => {
  it("run from small, short and slow to big, long and fast", () => {
    expect(dropRadius(1)).toBeGreaterThan(dropRadius(0));
    expect(dropThrow(1)).toBeGreaterThan(dropThrow(0));
    expect(dropFade(1)).toBeGreaterThan(dropFade(0));
  });

  it("keep a hole's jet alive longer than its light's time constant", () => {
    for (const life of [0, 0.5, 1]) expect(blockLife(life)).toBeGreaterThan(2 * dropFade(life));
  });
});
