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
  STROBE_FALLBACK_BPM,
  STROBE_FLASHES_PER_BEAT,
  STROBE_ON_FRACTION,
  STROBE_PEAK,
  strobeBeatPhase,
  strobeLevel,
} from "../src/render/heldEffects.ts";

describe("effects list", () => {
  it("has one distinct physical key per effect", () => {
    expect(new Set(EFFECTS.map((e) => e.code)).size).toBe(EFFECTS.length);
    expect(new Set(EFFECTS.map((e) => e.id)).size).toBe(EFFECTS.length);
  });
  it("finds an effect by its key code", () => {
    expect(effectForCode("KeyQ")?.id).toBe("blackout");
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

describe("strobeLevel", () => {
  it("is lit at the start of every eighth note and dark after it", () => {
    for (let i = 0; i < STROBE_FLASHES_PER_BEAT; i++) {
      const start = i / STROBE_FLASHES_PER_BEAT;
      expect(strobeLevel(start)).toBe(STROBE_PEAK);
      expect(strobeLevel(start + (STROBE_ON_FRACTION * 0.9) / STROBE_FLASHES_PER_BEAT)).toBe(STROBE_PEAK);
      expect(strobeLevel(start + (STROBE_ON_FRACTION * 1.1) / STROBE_FLASHES_PER_BEAT)).toBe(0);
    }
  });
  it("flashes STROBE_FLASHES_PER_BEAT times across one beat", () => {
    let edges = 0;
    let prev = 0;
    for (let p = 0; p < 1; p += 0.001) {
      const v = strobeLevel(p);
      if (v > 0 && prev === 0) edges++;
      prev = v;
    }
    expect(edges).toBe(STROBE_FLASHES_PER_BEAT);
  });
});

describe("strobeBeatPhase", () => {
  it("follows the metronome while a tempo is settled", () => {
    expect(strobeBeatPhase({ tempoOn: true, metronomePhase: 0.37, timeSec: 99 })).toBe(0.37);
  });
  it("free-runs at the fallback tempo otherwise", () => {
    const beatSec = 60 / STROBE_FALLBACK_BPM;
    expect(strobeBeatPhase({ tempoOn: false, metronomePhase: 0.9, timeSec: beatSec * 3 })).toBeCloseTo(0, 5);
    expect(strobeBeatPhase({ tempoOn: false, metronomePhase: 0.9, timeSec: beatSec * 3.25 })).toBeCloseTo(0.25, 5);
  });
});

describe("effectLook", () => {
  it("passes engaged effects through and flashes only with Strobe", () => {
    const e = { ...NO_EFFECTS, invert: true };
    expect(effectLook(e, 0.4, 0)).toEqual({ invert: true, flash: 0, black: 0.4 });
    expect(effectLook({ ...NO_EFFECTS, strobe: true }, 0, 0).flash).toBe(STROBE_PEAK);
  });
});
