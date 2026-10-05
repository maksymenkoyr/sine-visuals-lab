import { describe, it, expect } from "vitest";
import {
  anyEffect,
  BLACKOUT_FADE_MS,
  effectForCode,
  effectLook,
  EFFECTS,
  NO_EFFECTS,
  parseEffects,
  sameEffects,
  stepFade,
  STROBE_PEAK,
} from "../src/render/heldEffects.ts";

describe("effects list", () => {
  it("has one distinct physical key per effect", () => {
    expect(new Set(EFFECTS.map((e) => e.code)).size).toBe(EFFECTS.length);
    expect(new Set(EFFECTS.map((e) => e.id)).size).toBe(EFFECTS.length);
  });
  it("finds an effect by its key code", () => {
    expect(effectForCode("KeyQ")?.id).toBe("blackout");
    expect(effectForCode("KeyD")?.id).toBe("invert");
    expect(effectForCode("KeyZ")).toBeUndefined();
  });
});

describe("effect sets", () => {
  it("anyEffect and sameEffects", () => {
    expect(anyEffect(NO_EFFECTS)).toBe(false);
    expect(anyEffect({ ...NO_EFFECTS, invert: true })).toBe(true);
    expect(sameEffects(NO_EFFECTS, { ...NO_EFFECTS })).toBe(true);
    expect(sameEffects(NO_EFFECTS, { ...NO_EFFECTS, freeze: true })).toBe(false);
  });
  it("parses a message strictly: only true switches an effect on", () => {
    expect(parseEffects({ invert: true, strobe: 1, freeze: "yes", mirror: true })).toEqual({ ...NO_EFFECTS, invert: true });
    expect(parseEffects(null)).toEqual(NO_EFFECTS);
    expect(parseEffects("x")).toEqual(NO_EFFECTS);
  });
});

describe("stepFade", () => {
  it("fades in and out over the fade time and clamps", () => {
    expect(stepFade(0, true, BLACKOUT_FADE_MS / 2)).toBeCloseTo(0.5, 5);
    expect(stepFade(0.9, true, BLACKOUT_FADE_MS)).toBe(1);
    expect(stepFade(1, false, BLACKOUT_FADE_MS / 4)).toBeCloseTo(0.75, 5);
    expect(stepFade(0.1, false, BLACKOUT_FADE_MS)).toBe(0);
  });
  it("ignores a negative step", () => {
    expect(stepFade(0.5, true, -50)).toBe(0.5);
  });
});

describe("effectLook", () => {
  it("passes engaged effects through and flashes only with Strobe", () => {
    const e = { ...NO_EFFECTS, invert: true };
    expect(effectLook(e, 0.4)).toEqual({ invert: true, flash: 0, black: 0.4 });
    expect(effectLook({ ...NO_EFFECTS, strobe: true }, 0).flash).toBe(STROBE_PEAK);
  });
});
