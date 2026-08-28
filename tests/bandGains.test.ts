import { describe, it, expect } from "vitest";
import {
  BAND_GAIN_DEFAULT,
  BAND_GAIN_MAX,
  BAND_GAIN_MIN,
  BAND_TILT_DEFAULT,
  BAND_TILT_MAX,
  BAND_TILT_MIN,
  TILT_FAR_END_WEIGHT,
  applyBandGains,
  getBandGain,
  getBandGains,
  getBandTilt,
  resetBandGains,
  setBandGain,
  setBandTilt,
  tiltWeight,
} from "../src/audio/bandGains.ts";
import { LOW_MID_DEFAULT, MID_HIGH_DEFAULT } from "../src/audio/bandSplit.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";

function frame(fill: number): FeatureFrame {
  const bands = new Float32Array(NUM_BANDS).fill(fill);
  return { time: 1.5, bands, energy: 0.5, beat: true, bpm: 120, beatPhase: 0.3, level: 0.6 };
}

const FLAT = { low: 1, mid: 1, high: 1, tilt: 0 };

describe("band gain persistence", () => {
  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — this also proves the module tolerates that.
  it("returns the default for a scene that's never been set", () => {
    expect(getBandGains("nonexistent-scene")).toEqual({
      low: BAND_GAIN_DEFAULT,
      mid: BAND_GAIN_DEFAULT,
      high: BAND_GAIN_DEFAULT,
      tilt: BAND_TILT_DEFAULT,
    });
  });

  it("stores each group independently per scene", () => {
    setBandGain("scene-a", "low", 2);
    setBandGain("scene-a", "mid", 3);
    setBandGain("scene-a", "high", 0.5);
    expect(getBandGains("scene-a")).toEqual({ low: 2, mid: 3, high: 0.5, tilt: BAND_TILT_DEFAULT });
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
      tilt: BAND_TILT_DEFAULT,
    });
  });
});

describe("band tilt persistence", () => {
  it("returns the default for a scene that's never been set", () => {
    expect(getBandTilt("nonexistent-scene")).toBe(BAND_TILT_DEFAULT);
  });

  it("stores per scene without leaking, and rides along in getBandGains", () => {
    setBandTilt("tilt-a", 0.5);
    setBandTilt("tilt-b", -0.25);
    expect(getBandTilt("tilt-a")).toBe(0.5);
    expect(getBandTilt("tilt-b")).toBe(-0.25);
    expect(getBandGains("tilt-a").tilt).toBe(0.5);
  });

  it("clamps to the tilt range", () => {
    setBandTilt("tilt-clamp", 99);
    expect(getBandTilt("tilt-clamp")).toBe(BAND_TILT_MAX);
    setBandTilt("tilt-clamp", -99);
    expect(getBandTilt("tilt-clamp")).toBe(BAND_TILT_MIN);
  });

  it("resetBandGains also resets the tilt", () => {
    setBandTilt("tilt-reset", 0.8);
    resetBandGains("tilt-reset");
    expect(getBandTilt("tilt-reset")).toBe(BAND_TILT_DEFAULT);
  });
});

describe("applyBandGains", () => {
  it("is a no-op at all-default gains and tilt (fast path, same object)", () => {
    const f = frame(0.5);
    const out = applyBandGains(f, FLAT);
    expect(out).toBe(f);
  });

  it("scales exactly the band indices its group owns, under the default split", () => {
    const f = frame(0.2);
    const out = applyBandGains(f, { ...FLAT, low: 2 });
    for (let b = 0; b < LOW_MID_DEFAULT; b++) {
      expect(out.bands[b]).toBeCloseTo(0.4);
    }
    for (let b = LOW_MID_DEFAULT; b < NUM_BANDS; b++) {
      expect(out.bands[b]).toBeCloseTo(0.2);
    }
  });

  it("a zero low gain kills bands [0, lowMid) and leaves the rest untouched", () => {
    const f = frame(0.6);
    const out = applyBandGains(f, { ...FLAT, low: 0 });
    for (let b = 0; b < LOW_MID_DEFAULT; b++) {
      expect(out.bands[b]).toBe(0);
    }
    for (let b = LOW_MID_DEFAULT; b < NUM_BANDS; b++) {
      expect(out.bands[b]).toBeCloseTo(0.6);
    }
  });

  it("scales the mid and high groups independently", () => {
    const f = frame(0.1);
    const out = applyBandGains(f, { ...FLAT, mid: 3, high: 0 });
    expect(out.bands[LOW_MID_DEFAULT]).toBeCloseTo(0.3);
    expect(out.bands[MID_HIGH_DEFAULT - 1]).toBeCloseTo(0.3);
    expect(out.bands[MID_HIGH_DEFAULT]).toBe(0);
    expect(out.bands[NUM_BANDS - 1]).toBe(0);
  });

  it("clamps the scaled result to [0,1]", () => {
    const f = frame(0.9);
    const out = applyBandGains(f, { ...FLAT, low: BAND_GAIN_MAX });
    expect(out.bands[0]).toBeLessThanOrEqual(1);
  });

  it("passes energy/level/time/beat/bpm/beatPhase through unchanged — this is a per-band control, not broadband", () => {
    const f = frame(0.3);
    const out = applyBandGains(f, { low: 2, mid: 2, high: 2, tilt: 0.5 });
    expect(out.energy).toBe(f.energy);
    expect(out.level).toBe(f.level);
    expect(out.time).toBe(f.time);
    expect(out.beat).toBe(f.beat);
    expect(out.bpm).toBe(f.bpm);
    expect(out.beatPhase).toBe(f.beatPhase);
  });
});

describe("band tilt curve", () => {
  it("is flat at the default tilt", () => {
    for (let b = 0; b < NUM_BANDS; b++) {
      expect(tiltWeight(b, BAND_TILT_DEFAULT)).toBe(1);
    }
  });

  it("at full positive tilt anchors the top band at 1 and rolls the bottom off to the far-end weight", () => {
    const f = frame(0.5);
    const out = applyBandGains(f, { ...FLAT, tilt: BAND_TILT_MAX });
    expect(out.bands[NUM_BANDS - 1]).toBeCloseTo(0.5);
    expect(out.bands[0]).toBeCloseTo(0.5 * TILT_FAR_END_WEIGHT);
    for (let b = 1; b < NUM_BANDS; b++) {
      expect(out.bands[b]).toBeGreaterThanOrEqual(out.bands[b - 1]);
    }
  });

  it("at full negative tilt is the mirror: bottom band untouched, top rolled off", () => {
    const f = frame(0.5);
    const out = applyBandGains(f, { ...FLAT, tilt: BAND_TILT_MIN });
    expect(out.bands[0]).toBeCloseTo(0.5);
    expect(out.bands[NUM_BANDS - 1]).toBeCloseTo(0.5 * TILT_FAR_END_WEIGHT);
    for (let b = 1; b < NUM_BANDS; b++) {
      expect(out.bands[b]).toBeLessThanOrEqual(out.bands[b - 1]);
    }
  });

  it("is exponential in band index — a constant ratio between neighbours (constant dB/octave)", () => {
    const f = frame(0.5);
    const out = applyBandGains(f, { ...FLAT, tilt: 0.7 });
    const ratio = out.bands[1] / out.bands[0];
    expect(ratio).toBeGreaterThan(1);
    for (let b = 2; b < NUM_BANDS; b++) {
      expect(out.bands[b] / out.bands[b - 1]).toBeCloseTo(ratio, 5);
    }
  });

  it("a partial tilt reaches only part of the way to the far-end weight", () => {
    const half = tiltWeight(0, 0.5);
    expect(half).toBeGreaterThan(TILT_FAR_END_WEIGHT);
    expect(half).toBeLessThan(1);
    expect(half).toBeCloseTo(Math.sqrt(TILT_FAR_END_WEIGHT));
  });

  it("composes multiplicatively with a group gain", () => {
    const f = frame(0.1);
    const out = applyBandGains(f, { ...FLAT, low: 2, tilt: BAND_TILT_MAX });
    expect(out.bands[0]).toBeCloseTo(0.1 * 2 * TILT_FAR_END_WEIGHT);
    expect(out.bands[NUM_BANDS - 1]).toBeCloseTo(0.1);
  });

  it("never pushes a band above 1, even stacked on a max boost", () => {
    const f = frame(1);
    const out = applyBandGains(f, { low: BAND_GAIN_MAX, mid: BAND_GAIN_MAX, high: BAND_GAIN_MAX, tilt: BAND_TILT_MIN });
    for (let b = 0; b < NUM_BANDS; b++) {
      expect(out.bands[b]).toBeLessThanOrEqual(1);
    }
  });

  it("re-applies cleanly after the tilt value changes (weight cache refreshes)", () => {
    const f = frame(0.5);
    applyBandGains(f, { ...FLAT, tilt: BAND_TILT_MAX });
    const back = applyBandGains(f, { ...FLAT, tilt: -0.3 });
    expect(back.bands[0]).toBeCloseTo(0.5);
    expect(back.bands[NUM_BANDS - 1]).toBeCloseTo(0.5 * tiltWeight(NUM_BANDS - 1, -0.3));
  });
});
