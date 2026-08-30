import { describe, it, expect } from "vitest";
import { NUM_BANDS } from "../src/audio/types.ts";
import { bandIndexCentroid, createSpectralCentroid } from "../src/render/spectralCentroid.ts";

const DT = 1 / 60;

function bassHeavyBands(): Float32Array {
  const bands = new Float32Array(NUM_BANDS);
  for (let b = 0; b < NUM_BANDS; b++) bands[b] = b < 4 ? 0.8 : 0.02;
  return bands;
}

function trebleHeavyBands(): Float32Array {
  const bands = new Float32Array(NUM_BANDS);
  for (let b = 0; b < NUM_BANDS; b++) bands[b] = b >= NUM_BANDS - 4 ? 0.8 : 0.02;
  return bands;
}

// A mild, controllable tilt around a flat baseline — much subtler than
// bassHeavy/trebleHeavy's dramatic separation, for testing the adaptive
// range against a spectrum that barely moves on its own.
function tiltedBands(slope: number, base = 0.5): Float32Array {
  const bands = new Float32Array(NUM_BANDS);
  const center = (NUM_BANDS - 1) / 2;
  for (let b = 0; b < NUM_BANDS; b++) bands[b] = Math.max(0.01, base + slope * (b - center));
  return bands;
}

function primeSilence(): Float32Array {
  return new Float32Array(NUM_BANDS);
}

describe("spectralCentroid", () => {
  it("separates raw centroid for a bass-heavy vs. treble-heavy spectrum", () => {
    const dark = createSpectralCentroid();
    const bass = bassHeavyBands();
    for (let i = 0; i < 60; i++) dark.advance(DT, bass);

    const bright = createSpectralCentroid();
    const treble = trebleHeavyBands();
    for (let i = 0; i < 60; i++) bright.advance(DT, treble);

    expect(bright.raw).toBeGreaterThan(dark.raw);
    expect(dark.raw).toBeLessThan(0.4);
    expect(bright.raw).toBeGreaterThan(0.6);
  });

  it("ranges a mild spectral tilt into a much wider swing than the raw centroid itself", () => {
    const c = createSpectralCentroid();
    const rawValues: number[] = [];
    const centroidValues: number[] = [];

    for (let cycle = 0; cycle < 6; cycle++) {
      const bands = cycle % 2 === 0 ? tiltedBands(0.01) : tiltedBands(-0.01);
      for (let i = 0; i < 200; i++) {
        c.advance(DT, bands);
        rawValues.push(c.raw);
        centroidValues.push(c.centroid);
      }
    }

    const rawSpan = Math.max(...rawValues) - Math.min(...rawValues);
    const centroidSpan = Math.max(...centroidValues) - Math.min(...centroidValues);
    expect(rawSpan).toBeLessThan(0.15);
    expect(centroidSpan).toBeGreaterThan(0.5);
  });

  it("freezes centroid and raw through silence rather than drifting to neutral", () => {
    const c = createSpectralCentroid();
    const treble = trebleHeavyBands();
    for (let i = 0; i < 300; i++) c.advance(DT, treble);
    const rawBefore = c.raw;
    const centroidBefore = c.centroid;

    const silent = primeSilence();
    for (let i = 0; i < 300; i++) c.advance(DT, silent);

    expect(c.raw).toBe(rawBefore);
    expect(c.centroid).toBe(centroidBefore);
  });

  it("clamps the adaptive window so a static spectrum's own noise isn't amplified to full scale", () => {
    const c = createSpectralCentroid();
    const bands = tiltedBands(0.002);
    for (let i = 0; i < 600; i++) c.advance(DT, bands);

    // Tiny per-frame jitter around the same near-static spectrum — with the
    // floor/peak window pinned to MIN_CENTROID_SPAN, this must not blow the
    // ranged output across the full 0..1 scale frame to frame.
    let prev = c.centroid;
    for (let i = 0; i < 120; i++) {
      const jittered = tiltedBands(0.002 + (i % 2 === 0 ? 1 : -1) * 1e-4);
      c.advance(DT, jittered);
      expect(Number.isFinite(c.centroid)).toBe(true);
      expect(c.centroid).toBeGreaterThanOrEqual(0);
      expect(c.centroid).toBeLessThanOrEqual(1);
      expect(Math.abs(c.centroid - prev)).toBeLessThan(0.3);
      prev = c.centroid;
    }
  });

  it("is frame-rate independent", () => {
    function run(fps: number): number {
      const dt = 1 / fps;
      const c = createSpectralCentroid();
      for (let i = 0; i < Math.round(2 / dt); i++) c.advance(dt, bassHeavyBands());
      for (let i = 0; i < Math.round(1 / dt); i++) c.advance(dt, trebleHeavyBands());
      return c.centroid;
    }

    const at30 = run(30);
    const at120 = run(120);
    expect(Math.abs(at30 - at120)).toBeLessThan(0.05);
  });
});

describe("bandIndexCentroid", () => {
  // The stateless formula spectrumStrip.ts's live marker calls directly
  // against whatever buffer it's currently drawing (see that file's
  // header) — covered separately from the stateful SpectralCentroid tests
  // above since it has no smoothing/freezing behavior of its own to verify.
  it("separates a bass-heavy vs. treble-heavy spectrum", () => {
    const dark = bandIndexCentroid(bassHeavyBands());
    const bright = bandIndexCentroid(trebleHeavyBands());
    expect(dark).not.toBeNull();
    expect(bright).not.toBeNull();
    expect(dark!).toBeLessThan(0.4);
    expect(bright!).toBeGreaterThan(0.6);
  });

  it("is null on a silent bands array — no spectrum to locate", () => {
    expect(bandIndexCentroid(new Float32Array(NUM_BANDS))).toBeNull();
  });

  it("is null just below the silence gate and defined just above it", () => {
    const quiet = new Float32Array(NUM_BANDS).fill(0.02);
    expect(bandIndexCentroid(quiet)).toBeNull();

    const audible = new Float32Array(NUM_BANDS).fill(0.02);
    audible[12] = 0.5;
    expect(bandIndexCentroid(audible)).not.toBeNull();
  });

  it("stays within [0,1] at the band-ladder extremes", () => {
    const high = new Float32Array(NUM_BANDS);
    high[NUM_BANDS - 1] = 1;
    expect(bandIndexCentroid(high)).toBeCloseTo(1, 5);

    const low = new Float32Array(NUM_BANDS);
    low[0] = 1;
    expect(bandIndexCentroid(low)).toBeCloseTo(0, 5);
  });
});
