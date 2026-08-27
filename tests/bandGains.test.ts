import { describe, it, expect } from "vitest";
import {
  BAND_GAIN_DEFAULT,
  BAND_GAIN_MAX,
  BAND_GAIN_MIN,
  applyBandGains,
  getBandGain,
  getBandGains,
  resetBandGains,
  setBandGain,
} from "../src/audio/bandGains.ts";
import { LOW_MID_DEFAULT, MID_HIGH_DEFAULT } from "../src/audio/bandSplit.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";

function frame(fill: number): FeatureFrame {
  const bands = new Float32Array(NUM_BANDS).fill(fill);
  return { time: 1.5, bands, energy: 0.5, beat: true, bpm: 120, beatPhase: 0.3, level: 0.6 };
}

describe("band gain persistence", () => {
  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — this also proves the module tolerates that.
  it("returns the default for a scene that's never been set", () => {
    expect(getBandGains("nonexistent-scene")).toEqual({
      low: BAND_GAIN_DEFAULT,
      mid: BAND_GAIN_DEFAULT,
      high: BAND_GAIN_DEFAULT,
    });
  });

  it("stores each group independently per scene", () => {
    setBandGain("scene-a", "low", 2);
    setBandGain("scene-a", "mid", 3);
    setBandGain("scene-a", "high", 0.5);
    expect(getBandGains("scene-a")).toEqual({ low: 2, mid: 3, high: 0.5 });
  });

  it("doesn't leak between scenes", () => {
    setBandGain("scene-b1", "low", 4);
    setBandGain("scene-b2", "low", 1);
    expect(getBandGain("scene-b1", "low")).toBe(4);
    expect(getBandGain("scene-b2", "low")).toBe(1);
  });

  it("clamps out-of-range values on set, preserving 0 as an explicit kill", () => {
    setBandGain("scene-clamp", "low", 999);
    expect(getBandGain("scene-clamp", "low")).toBe(BAND_GAIN_MAX);
    setBandGain("scene-clamp", "low", -5);
    expect(getBandGain("scene-clamp", "low")).toBe(BAND_GAIN_MIN);
    setBandGain("scene-clamp", "mid", 0);
    expect(getBandGain("scene-clamp", "mid")).toBe(0);
  });

  it("resetBandGains returns every group to the default", () => {
    setBandGain("scene-reset", "low", 3);
    setBandGain("scene-reset", "mid", 0);
    setBandGain("scene-reset", "high", 4);
    resetBandGains("scene-reset");
    expect(getBandGains("scene-reset")).toEqual({
      low: BAND_GAIN_DEFAULT,
      mid: BAND_GAIN_DEFAULT,
      high: BAND_GAIN_DEFAULT,
    });
  });
});

describe("applyBandGains", () => {
  it("is a no-op at all-default gains (fast path, same object)", () => {
    const f = frame(0.5);
    const out = applyBandGains(f, { low: 1, mid: 1, high: 1 });
    expect(out).toBe(f);
  });

  it("scales exactly the band indices its group owns, under the default split", () => {
    const f = frame(0.2);
    const out = applyBandGains(f, { low: 2, mid: 1, high: 1 });
    for (let b = 0; b < LOW_MID_DEFAULT; b++) {
      expect(out.bands[b]).toBeCloseTo(0.4);
    }
    for (let b = LOW_MID_DEFAULT; b < NUM_BANDS; b++) {
      expect(out.bands[b]).toBeCloseTo(0.2);
    }
  });

  it("a zero low gain kills bands [0, lowMid) and leaves the rest untouched", () => {
    const f = frame(0.6);
    const out = applyBandGains(f, { low: 0, mid: 1, high: 1 });
    for (let b = 0; b < LOW_MID_DEFAULT; b++) {
      expect(out.bands[b]).toBe(0);
    }
    for (let b = LOW_MID_DEFAULT; b < NUM_BANDS; b++) {
      expect(out.bands[b]).toBeCloseTo(0.6);
    }
  });

  it("scales the mid and high groups independently", () => {
    const f = frame(0.1);
    const out = applyBandGains(f, { low: 1, mid: 3, high: 0 });
    expect(out.bands[LOW_MID_DEFAULT]).toBeCloseTo(0.3);
    expect(out.bands[MID_HIGH_DEFAULT - 1]).toBeCloseTo(0.3);
    expect(out.bands[MID_HIGH_DEFAULT]).toBe(0);
    expect(out.bands[NUM_BANDS - 1]).toBe(0);
  });

  it("clamps the scaled result to [0,1]", () => {
    const f = frame(0.9);
    const out = applyBandGains(f, { low: BAND_GAIN_MAX, mid: 1, high: 1 });
    expect(out.bands[0]).toBeLessThanOrEqual(1);
  });

  it("passes energy/level/time/beat/bpm/beatPhase through unchanged — this is a per-band control, not broadband", () => {
    const f = frame(0.3);
    const out = applyBandGains(f, { low: 2, mid: 2, high: 2 });
    expect(out.energy).toBe(f.energy);
    expect(out.level).toBe(f.level);
    expect(out.time).toBe(f.time);
    expect(out.beat).toBe(f.beat);
    expect(out.bpm).toBe(f.bpm);
    expect(out.beatPhase).toBe(f.beatPhase);
  });
});
