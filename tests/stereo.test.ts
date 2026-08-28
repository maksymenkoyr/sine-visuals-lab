import { describe, it, expect } from "vitest";
import { deriveStereoRead } from "../src/audio/stereo.ts";

function sine(n: number, cycles: number, amplitude = 1): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * cycles * i) / n);
  return out;
}

describe("deriveStereoRead", () => {
  it("identical L/R reads as mono-width and perfectly correlated", () => {
    const l = sine(1024, 10);
    const r = l.slice();
    const out = new Float32Array(1024);
    const read = deriveStereoRead(l, r, out);
    expect(read.hasStereo).toBe(true);
    expect(read.width).toBeCloseTo(0, 5);
    expect(read.correlation).toBeCloseTo(1, 3);
    expect(read.balance).toBeCloseTo(0, 5);
  });

  it("uncorrelated L/R (a quarter cycle apart) reads as fully wide, correlation 0", () => {
    const n = 1024;
    const l = sine(n, 10);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) r[i] = Math.cos((2 * Math.PI * 10 * i) / n);
    const read = deriveStereoRead(l, r, new Float32Array(n));
    // Side and mid carry equal power here, so the side-to-mid ratio is 1 —
    // the top of the meter, not the 0.5 that side's share of the total gives.
    expect(read.width).toBeCloseTo(1, 3);
    expect(read.correlation).toBeCloseTo(0, 3);
  });

  it("a slightly widened mix sits low on the meter, not at zero", () => {
    const n = 1024;
    const l = sine(n, 10);
    const r = new Float32Array(n);
    // Mostly the same signal, with a 20% uncorrelated component on the right.
    for (let i = 0; i < n; i++) r[i] = l[i] + 0.2 * Math.cos((2 * Math.PI * 10 * i) / n);
    const read = deriveStereoRead(l, r, new Float32Array(n));
    expect(read.width).toBeGreaterThan(0.05);
    expect(read.width).toBeLessThan(0.3);
  });

  it("an inverted right channel reads as fully wide and negatively correlated", () => {
    const l = sine(1024, 10);
    const r = l.map((v) => -v);
    const out = new Float32Array(1024);
    const read = deriveStereoRead(l, r, out);
    expect(read.width).toBeCloseTo(1, 3);
    expect(read.correlation).toBeCloseTo(-1, 3);
  });

  it("signal only in the right channel reads as hard right", () => {
    const l = new Float32Array(1024); // silent
    const r = sine(1024, 10);
    const out = new Float32Array(1024);
    const read = deriveStereoRead(l, r, out);
    expect(read.balance).toBeCloseTo(1, 3);
  });

  it("signal only in the left channel reads as hard left", () => {
    const l = sine(1024, 10);
    const r = new Float32Array(1024); // silent
    const out = new Float32Array(1024);
    const read = deriveStereoRead(l, r, out);
    expect(read.balance).toBeCloseTo(-1, 3);
  });

  it("a declared-mono source (right: null) reports hasStereo false and holds mono defaults", () => {
    const l = sine(1024, 10);
    const out = new Float32Array(1024);
    const read = deriveStereoRead(l, null, out);
    expect(read.hasStereo).toBe(false);
    expect(read.width).toBe(0);
    expect(read.balance).toBe(0);
    expect(read.correlation).toBe(1);
  });

  it("writes the mono mix into the caller-owned buffer", () => {
    const l = new Float32Array([1, 1, 1]);
    const r = new Float32Array([0.5, 0.5, 0.5]);
    const out = new Float32Array(3);
    const read = deriveStereoRead(l, r, out);
    expect(read.mono).toBe(out);
    expect(Array.from(out)).toEqual([0.75, 0.75, 0.75]);
  });

  it("a silent buffer produces no NaN", () => {
    const silence = new Float32Array(512);
    const out = new Float32Array(512);
    const read = deriveStereoRead(silence, silence.slice(), out);
    expect(Number.isFinite(read.balance)).toBe(true);
    expect(Number.isFinite(read.width)).toBe(true);
    expect(Number.isFinite(read.correlation)).toBe(true);
  });
});
