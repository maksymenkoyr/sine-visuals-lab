import { describe, it, expect } from "vitest";
import { rms, peak, crest, zeroCrossingRate, isClipping, downsampleForDisplay } from "../src/audio/waveform.ts";

function sine(n: number, cycles: number, amplitude = 1): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * cycles * i) / n);
  return out;
}

function square(n: number, cycles: number, amplitude = 1): Float32Array {
  const out = new Float32Array(n);
  const period = n / cycles;
  for (let i = 0; i < n; i++) out[i] = (i % period) < period / 2 ? amplitude : -amplitude;
  return out;
}

describe("waveform", () => {
  it("a sine's crest factor is ~sqrt(2)", () => {
    const s = sine(2048, 20);
    expect(crest(s)).toBeCloseTo(Math.SQRT2, 2);
  });

  it("a square wave's crest factor is ~1 (no dynamic range)", () => {
    const s = square(2048, 20);
    expect(crest(s)).toBeCloseTo(1, 2);
  });

  it("a silent buffer produces no NaN across rms/peak/crest/zeroCrossingRate", () => {
    const silence = new Float32Array(2048);
    expect(Number.isFinite(rms(silence))).toBe(true);
    expect(Number.isFinite(peak(silence))).toBe(true);
    expect(Number.isFinite(crest(silence))).toBe(true);
    expect(Number.isFinite(zeroCrossingRate(silence))).toBe(true);
    expect(crest(silence)).toBe(0);
  });

  it("flags clipping when samples ride the rail, not on an ordinary sine", () => {
    const clipped = new Float32Array(512).fill(0.995);
    expect(isClipping(clipped)).toBe(true);
    expect(isClipping(sine(512, 5, 0.8))).toBe(false);
  });

  it("zero-crossing rate is high for a fast tone and low for a slow one", () => {
    const fast = zeroCrossingRate(sine(2048, 200));
    const slow = zeroCrossingRate(sine(2048, 2));
    expect(fast).toBeGreaterThan(slow);
  });

  it("downsampleForDisplay preserves a single-sample spike naive decimation would skip", () => {
    const n = 1000;
    const targetPoints = 50; // stride 20 — a naive pick-every-20th would land on index 0, 20, 40...
    const samples = new Float32Array(n); // all zero
    const spikeIndex = 15; // inside the first bucket, but not at its start
    samples[spikeIndex] = 1;

    const { min, max } = downsampleForDisplay(samples, targetPoints);
    expect(max[0]).toBeCloseTo(1, 5);
    expect(min[0]).toBeCloseTo(0, 5);
    // Every other bucket stayed flat at zero.
    for (let i = 1; i < targetPoints; i++) {
      expect(max[i]).toBeCloseTo(0, 5);
      expect(min[i]).toBeCloseTo(0, 5);
    }
  });

  it("downsampleForDisplay handles an empty buffer without throwing", () => {
    const { min, max } = downsampleForDisplay(new Float32Array(0), 10);
    expect(min.length).toBe(10);
    expect(max.length).toBe(10);
    expect(Array.from(min).every((v) => v === 0)).toBe(true);
  });
});
