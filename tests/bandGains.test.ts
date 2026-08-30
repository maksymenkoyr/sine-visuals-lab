import { describe, it, expect } from "vitest";
import {
  BAND_FADER_COUNT,
  BAND_GAIN_DEFAULT,
  BAND_GAIN_LOG_FLOOR,
  BAND_GAIN_MAX,
  BAND_GAIN_MIN,
  FADER_CENTER_POS,
  FADER_DETENT,
  FADER_OFF_ZONE,
  applyBandGains,
  faderBandSpan,
  faderCenterHz,
  faderPosToGain,
  faderWeights,
  gainToFaderPos,
  getBandGain,
  getBandGains,
  isDefaultGains,
  pinnedBands,
  resetBandGains,
  setBandGain,
} from "../src/audio/bandGains.ts";
import { nominalBandEdgesHz } from "../src/audio/bandScale.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";

function frame(fill: number): FeatureFrame {
  const bands = new Float32Array(NUM_BANDS).fill(fill);
  return { time: 1.5, bands, energy: 0.5, onset: true, bpm: 120, onsetPhase: 0.3, level: 0.6 };
}

function flat(): Float32Array {
  return new Float32Array(BAND_FADER_COUNT).fill(BAND_GAIN_DEFAULT);
}

function withFader(fader: number, gain: number): Float32Array {
  const g = flat();
  g[fader] = gain;
  return g;
}

describe("band gain persistence", () => {
  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — this also proves the module tolerates that.
  it("returns the default for every fader of a scene that's never been set", () => {
    const gains = getBandGains("nonexistent-scene", new Float32Array(BAND_FADER_COUNT));
    expect(Array.from(gains)).toEqual(Array(BAND_FADER_COUNT).fill(BAND_GAIN_DEFAULT));
    expect(isDefaultGains(gains)).toBe(true);
  });

  it("stores each fader independently per scene", () => {
    setBandGain("scene-a", 0, 2);
    setBandGain("scene-a", 2, 3);
    setBandGain("scene-a", BAND_FADER_COUNT - 1, 0.5);
    const gains = getBandGains("scene-a");
    expect(gains[0]).toBe(2);
    expect(gains[1]).toBe(BAND_GAIN_DEFAULT);
    expect(gains[2]).toBe(3);
    expect(gains[BAND_FADER_COUNT - 1]).toBe(0.5);
    expect(isDefaultGains(gains)).toBe(false);
  });

  it("doesn't leak between scenes", () => {
    setBandGain("scene-b1", 1, 4);
    setBandGain("scene-b2", 1, 1);
    expect(getBandGain("scene-b1", 1)).toBe(4);
    expect(getBandGain("scene-b2", 1)).toBe(1);
  });

  it("clamps out-of-range values on set, preserving 0 as an explicit Off", () => {
    setBandGain("scene-clamp", 0, 999);
    expect(getBandGain("scene-clamp", 0)).toBe(BAND_GAIN_MAX);
    setBandGain("scene-clamp", 0, -5);
    expect(getBandGain("scene-clamp", 0)).toBe(BAND_GAIN_MIN);
    setBandGain("scene-clamp", 1, 0);
    expect(getBandGain("scene-clamp", 1)).toBe(0);
  });

  it("resetBandGains returns every fader to the default", () => {
    for (let i = 0; i < BAND_FADER_COUNT; i++) setBandGain("scene-reset", i, i % 2 ? 0 : 4);
    resetBandGains("scene-reset");
    expect(isDefaultGains(getBandGains("scene-reset"))).toBe(true);
  });

  it("getBandGains writes into the caller's array when given one", () => {
    const mine = new Float32Array(BAND_FADER_COUNT);
    expect(getBandGains("nonexistent-scene", mine)).toBe(mine);
  });
});

describe("fader travel <-> gain", () => {
  it("rests on exactly 1× at the centre position, both ways", () => {
    expect(faderPosToGain(FADER_CENTER_POS)).toBe(BAND_GAIN_DEFAULT);
    expect(gainToFaderPos(BAND_GAIN_DEFAULT)).toBe(FADER_CENTER_POS);
  });

  it("is Off at the bottom of the travel and max at the top", () => {
    expect(faderPosToGain(0)).toBe(BAND_GAIN_MIN);
    expect(faderPosToGain(FADER_OFF_ZONE)).toBe(BAND_GAIN_MIN);
    expect(faderPosToGain(1)).toBeCloseTo(BAND_GAIN_MAX);
    expect(gainToFaderPos(0)).toBe(0);
    expect(gainToFaderPos(BAND_GAIN_MAX)).toBeCloseTo(1);
  });

  it("starts the log curve at the floor just above the Off zone", () => {
    expect(faderPosToGain(FADER_OFF_ZONE + 1e-9)).toBeCloseTo(BAND_GAIN_LOG_FLOOR);
  });

  it("round-trips across the travel outside the detent", () => {
    for (let p = FADER_OFF_ZONE + 0.01; p <= 1; p += 0.05) {
      if (Math.abs(p - FADER_CENTER_POS) < FADER_DETENT) continue;
      expect(gainToFaderPos(faderPosToGain(p))).toBeCloseTo(p, 6);
    }
  });

  it("snaps to 1× inside the detent", () => {
    expect(faderPosToGain(FADER_CENTER_POS + FADER_DETENT * 0.9)).toBe(BAND_GAIN_DEFAULT);
    expect(faderPosToGain(FADER_CENTER_POS - FADER_DETENT * 0.9)).toBe(BAND_GAIN_DEFAULT);
    expect(faderPosToGain(FADER_CENTER_POS + FADER_DETENT * 1.5)).toBeGreaterThan(BAND_GAIN_DEFAULT);
    expect(faderPosToGain(FADER_CENTER_POS - FADER_DETENT * 1.5)).toBeLessThan(BAND_GAIN_DEFAULT);
  });

  it("is log-symmetric around 1×: the floor is as far below as the max is above", () => {
    expect(BAND_GAIN_DEFAULT / BAND_GAIN_LOG_FLOOR).toBeCloseTo(BAND_GAIN_MAX / BAND_GAIN_DEFAULT);
  });
});

describe("fader spans", () => {
  it("tile the band ladder exactly, in order", () => {
    let expectLo = 0;
    for (let i = 0; i < BAND_FADER_COUNT; i++) {
      const [lo, hi] = faderBandSpan(i);
      expect(lo).toBe(expectLo);
      expect(hi).toBeGreaterThan(lo);
      expectLo = hi;
    }
    expect(expectLo).toBe(NUM_BANDS);
  });

  it("label each fader with a frequency strictly inside its span, rising left to right", () => {
    const edges = nominalBandEdgesHz();
    let last = 0;
    for (let i = 0; i < BAND_FADER_COUNT; i++) {
      const [lo, hi] = faderBandSpan(i);
      const hz = faderCenterHz(i, edges);
      expect(hz).toBeGreaterThan(edges[lo]);
      expect(hz).toBeLessThan(edges[hi]);
      expect(hz).toBeGreaterThan(last);
      last = hz;
    }
  });
});

describe("faderWeights", () => {
  const out = () => new Float32Array(NUM_BANDS);

  it("is flat at all-default gains", () => {
    const w = faderWeights(flat(), out());
    for (let b = 0; b < NUM_BANDS; b++) expect(w[b]).toBe(1);
  });

  it("an outer fader's gain reaches the ladder's end bands in full", () => {
    const w = faderWeights(withFader(0, 3), out());
    expect(w[0]).toBeCloseTo(3);
    const wTop = faderWeights(withFader(BAND_FADER_COUNT - 1, 0.5), out());
    expect(wTop[NUM_BANDS - 1]).toBeCloseTo(0.5);
  });

  it("a boosted fader peaks inside its own span and eases into its neighbours, leaving the rest at 1", () => {
    const fader = 2;
    const w = faderWeights(withFader(fader, 3), out());
    const [lo, hi] = faderBandSpan(fader);
    let peakBand = 0;
    for (let b = 1; b < NUM_BANDS; b++) if (w[b] > w[peakBand]) peakBand = b;
    expect(peakBand).toBeGreaterThanOrEqual(lo);
    expect(peakBand).toBeLessThan(hi);
    // Rising up to the peak, falling after it — no bumps.
    for (let b = 1; b <= peakBand; b++) expect(w[b]).toBeGreaterThanOrEqual(w[b - 1]);
    for (let b = peakBand + 1; b < NUM_BANDS; b++) expect(w[b]).toBeLessThanOrEqual(w[b - 1]);
    // Faders two or more away are untouched.
    const [farLo] = faderBandSpan(fader + 2);
    for (let b = farLo; b < NUM_BANDS; b++) expect(w[b]).toBe(1);
    for (let b = 0; b < faderBandSpan(fader - 2)[1]; b++) expect(w[b]).toBe(1);
  });

  it("never leaves the range of the gains it blends", () => {
    const gains = Float32Array.from({ length: BAND_FADER_COUNT }, (_, i) => (i % 2 ? 0.25 : 4));
    const w = faderWeights(gains, out());
    for (let b = 0; b < NUM_BANDS; b++) {
      expect(w[b]).toBeGreaterThanOrEqual(0.25);
      expect(w[b]).toBeLessThanOrEqual(4);
    }
  });
});

describe("applyBandGains", () => {
  it("is a no-op at all-default gains (fast path, same object) and clears the pinned mask", () => {
    applyBandGains(frame(1), withFader(0, BAND_GAIN_MAX));
    expect(pinnedBands()[0]).toBe(1);
    const f = frame(0.5);
    expect(applyBandGains(f, flat())).toBe(f);
    for (let b = 0; b < NUM_BANDS; b++) expect(pinnedBands()[b]).toBe(0);
  });

  it("scales bands by the blended fader weights", () => {
    const f = frame(0.2);
    const gains = withFader(0, 2);
    const out = applyBandGains(f, gains);
    const w = faderWeights(gains, new Float32Array(NUM_BANDS));
    for (let b = 0; b < NUM_BANDS; b++) expect(out.bands[b]).toBeCloseTo(0.2 * w[b]);
  });

  it("an Off fader zeroes the bands at the ladder's end", () => {
    const out = applyBandGains(frame(0.6), withFader(0, 0));
    expect(out.bands[0]).toBe(0);
    expect(out.bands[NUM_BANDS - 1]).toBeCloseTo(0.6);
  });

  it("clamps to 1 and records exactly the clamped bands as pinned", () => {
    const f = frame(0.9);
    const gains = withFader(0, BAND_GAIN_MAX);
    const out = applyBandGains(f, gains);
    const w = faderWeights(gains, new Float32Array(NUM_BANDS));
    for (let b = 0; b < NUM_BANDS; b++) {
      expect(out.bands[b]).toBeLessThanOrEqual(1);
      expect(pinnedBands()[b]).toBe(0.9 * w[b] > 1 ? 1 : 0);
    }
    expect(pinnedBands()[0]).toBe(1);
    expect(pinnedBands()[NUM_BANDS - 1]).toBe(0);
  });

  it("passes energy/level/time/onset/bpm/onsetPhase through unchanged — this is a per-band control, not broadband", () => {
    const f = frame(0.3);
    const out = applyBandGains(f, withFader(3, 2));
    expect(out.energy).toBe(f.energy);
    expect(out.level).toBe(f.level);
    expect(out.time).toBe(f.time);
    expect(out.onset).toBe(f.onset);
    expect(out.bpm).toBe(f.bpm);
    expect(out.onsetPhase).toBe(f.onsetPhase);
  });
});
