import { describe, it, expect } from "vitest";
import {
  ABSOLUTE_GATE_LUFS,
  BS1770_HIGHPASS_48K,
  BS1770_RATE_HZ,
  BS1770_SHELF_48K,
  biquad,
  createLufsMeter,
  kWeightingCoefficients,
  magnitudeDb,
  resampleBiquad,
  type BiquadCoefficients,
} from "../src/audio/lufs.ts";

// Analytic fixtures, like tests/waveform.test.ts: identities from the spec
// rather than golden numbers. The one number worth knowing by heart: a
// single channel holding a 997 Hz sine at -20 dBFS *peak* has a mean square
// of 0.005, and 10·log10(0.005) − 0.691 = −23.70… plus the +0.691 dB the
// K-weighting adds at 997 Hz lands on −23.01 LUFS. (EBU Tech 3341's
// "−23 dBFS → −23 LUFS" is the stereo dual-mono case; mono reads 3 dB lower
// than that pairing, which is exactly this.)
const MONO_997_AT_MINUS_20_DBFS_LUFS = -23.01;

function sine(seconds: number, hz: number, amplitude: number, sampleRate = BS1770_RATE_HZ): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

function kWeight(samples: Float32Array, sampleRate = BS1770_RATE_HZ): Float32Array {
  const k = kWeightingCoefficients(sampleRate);
  return biquad(biquad(samples, k.shelf), k.highpass);
}

function cascadeDb(sampleRate: number, hz: number): number {
  const k = kWeightingCoefficients(sampleRate);
  return magnitudeDb(k.shelf, hz, sampleRate) + magnitudeDb(k.highpass, hz, sampleRate);
}

function expectCoefficients(actual: BiquadCoefficients, expected: BiquadCoefficients, digits: number): void {
  for (let i = 0; i < 3; i++) {
    expect(actual.b[i]).toBeCloseTo(expected.b[i], digits);
    expect(actual.a[i]).toBeCloseTo(expected.a[i], digits);
  }
}

describe("K-weighting coefficients", () => {
  it("reproduces the spec's tables exactly at the spec's own rate", () => {
    const k = kWeightingCoefficients(BS1770_RATE_HZ);
    expectCoefficients(k.shelf, BS1770_SHELF_48K, 9);
    expectCoefficients(k.highpass, BS1770_HIGHPASS_48K, 9);
  });

  it("resampleBiquad at ratio 1 is the identity", () => {
    expectCoefficients(resampleBiquad(BS1770_SHELF_48K, 1), BS1770_SHELF_48K, 12);
  });

  it("keeps the spec's response shape at other sample rates", () => {
    // The spec's reference: 997 Hz sits at +0.691 dB, which is what the
    // −0.691 offset in the LUFS formula cancels.
    for (const rate of [44100, 48000, 96000]) {
      expect(cascadeDb(rate, 997)).toBeCloseTo(0.691, 1);
      // The shelf's +4 dB plateau, and the high-pass biting below ~38 Hz.
      expect(cascadeDb(rate, 10000)).toBeGreaterThan(3.7);
      expect(cascadeDb(rate, 10000)).toBeLessThan(4.3);
      expect(cascadeDb(rate, 20)).toBeLessThan(-3);
    }
  });

  it("biquad() runs the direct-form recurrence", () => {
    const impulse = new Float32Array(4);
    impulse[0] = 1;
    const y = biquad(impulse, BS1770_SHELF_48K);
    const [b0, b1, b2] = BS1770_SHELF_48K.b;
    const [, a1, a2] = BS1770_SHELF_48K.a;
    const y0 = b0;
    const y1 = b1 - a1 * y0;
    const y2 = b2 - a1 * y1 - a2 * y0;
    expect(y[0]).toBeCloseTo(y0, 6);
    expect(y[1]).toBeCloseTo(y1, 6);
    expect(y[2]).toBeCloseTo(y2, 6);
  });
});

describe("LUFS meter", () => {
  it("reads a mono 997 Hz sine at -20 dBFS as about -23 LUFS on every window", () => {
    const meter = createLufsMeter(BS1770_RATE_HZ);
    meter.push(kWeight(sine(4, 997, 0.1)));
    const r = meter.read();
    expect(r.momentary).toBeCloseTo(MONO_997_AT_MINUS_20_DBFS_LUFS, 1);
    expect(r.shortTerm).toBeCloseTo(MONO_997_AT_MINUS_20_DBFS_LUFS, 1);
    expect(r.integrated).toBeCloseTo(MONO_997_AT_MINUS_20_DBFS_LUFS, 1);
  });

  it("reports -Infinity until a window has filled, and for silence", () => {
    const meter = createLufsMeter(BS1770_RATE_HZ);
    expect(meter.read()).toEqual({ momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity });
    meter.push(kWeight(sine(1, 997, 0.1)));
    expect(meter.read().momentary).toBeCloseTo(MONO_997_AT_MINUS_20_DBFS_LUFS, 1);
    expect(meter.read().shortTerm).toBe(-Infinity); // only 1 s of the 3 s window
    meter.push(new Float32Array(BS1770_RATE_HZ)); // 1 s of digital silence
    expect(meter.read().momentary).toBe(-Infinity);
  });

  it("absolute gate: silence after a burst leaves the integrated reading where the burst put it", () => {
    const meter = createLufsMeter(BS1770_RATE_HZ);
    meter.push(kWeight(sine(2, 997, 0.1)));
    const before = meter.read().integrated;
    meter.push(new Float32Array(BS1770_RATE_HZ * 5));
    // Within half an LU: the gating blocks straddling the edge into silence carry
    // partial power and legitimately pass the relative gate.
    expect(Math.abs(meter.read().integrated - before)).toBeLessThan(0.5);
    expect(before).toBeCloseTo(MONO_997_AT_MINUS_20_DBFS_LUFS, 1);
  });

  it("relative gate: a quiet passage well above the absolute gate is still dropped beside a loud one", () => {
    const meter = createLufsMeter(BS1770_RATE_HZ);
    // ~ -60 LUFS: 37 dB below the -23 passage, but 10 dB above the -70 gate.
    const quietAmplitude = 0.1 * Math.pow(10, -37 / 20);
    meter.push(kWeight(sine(3, 997, 0.1)));
    meter.push(kWeight(sine(3, 997, quietAmplitude)));
    expect(meter.read().momentary).toBeLessThan(-55);
    expect(meter.read().momentary).toBeGreaterThan(ABSOLUTE_GATE_LUFS);
    expect(Math.abs(meter.read().integrated - MONO_997_AT_MINUS_20_DBFS_LUFS)).toBeLessThan(0.5);
  });

  it("reset() starts the integrated reading over while momentary keeps running", () => {
    const meter = createLufsMeter(BS1770_RATE_HZ);
    meter.push(kWeight(sine(1, 997, 0.1)));
    expect(meter.read().integrated).not.toBe(-Infinity);
    meter.reset();
    expect(meter.read().integrated).toBe(-Infinity);
    expect(meter.read().momentary).toBeCloseTo(MONO_997_AT_MINUS_20_DBFS_LUFS, 1);
  });

  it("push(samples, from) only reads the tail", () => {
    const meter = createLufsMeter(BS1770_RATE_HZ);
    const loud = kWeight(sine(1, 997, 0.1));
    const buf = new Float32Array(loud.length * 2);
    buf.set(loud, 0); // a loud head that must be ignored…
    // …followed by silence that is the actual tail.
    meter.push(buf, loud.length);
    expect(meter.read().momentary).toBe(-Infinity);
  });
});
