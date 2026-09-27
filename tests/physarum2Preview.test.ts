import { describe, it, expect } from "vitest";
import { createStrainPreview, type StrainPreviewMotion } from "../src/render/scenes/physarum2Preview.ts";

// A representative "coarse cells / spots" motion — sensor angle/reach/turn
// on the wide, sharp-turning end of the range physarum2.ts's own STRAINS/
// LEGACY_MOTION span (PP-C3's own profile: 95deg sensor layout, a 45-texel
// range and a 100deg turn on the real scene's 1024-wide field) — the
// prototype's own measurement note (this file's own createStrainPreview doc
// comment, ported from strainPreview.js) found this is the strain that
// coarsens fastest without RESPAWN_PER_STEP, so it's the sharpest test of
// the respawn claim.
const DEG = Math.PI / 180;
const SPOTTY_MOTION: StrainPreviewMotion = {
  sensorAngle: 95 * DEG,
  reach: 4,
  turn: 100 * DEG,
  step: 1.4,
  deposit: 0.03,
};

function runSteps(preview: ReturnType<typeof createStrainPreview>, motion: StrainPreviewMotion, n: number): void {
  for (let i = 0; i < n; i++) preview.step(motion);
}

describe("physarum2Preview: createStrainPreview", () => {
  it("is fully deterministic for a fixed seed — two identical runs produce identical pixels", () => {
    const a = createStrainPreview({ size: 32, agents: 300, seed: 42 });
    const b = createStrainPreview({ size: 32, agents: 300, seed: 42 });
    for (let i = 0; i < 60; i++) {
      a.step(SPOTTY_MOTION);
      b.step(SPOTTY_MOTION);
    }
    expect(a.pixels([1, 1, 1])).toEqual(b.pixels([1, 1, 1]));
  });

  it("a different seed diverges (not a hidden shared/global RNG)", () => {
    const a = createStrainPreview({ size: 32, agents: 300, seed: 1 });
    const b = createStrainPreview({ size: 32, agents: 300, seed: 2 });
    for (let i = 0; i < 60; i++) {
      a.step(SPOTTY_MOTION);
      b.step(SPOTTY_MOTION);
    }
    expect(a.pixels([1, 1, 1])).not.toEqual(b.pixels([1, 1, 1]));
  });

  it("size/pixels shape: size*size*4 bytes, alpha always opaque", () => {
    const size = 24;
    const preview = createStrainPreview({ size, agents: 200, seed: 7 });
    expect(preview.size).toBe(size);
    runSteps(preview, SPOTTY_MOTION, 5);
    const buf = preview.pixels([1, 0.5, 0.2]);
    expect(buf.length).toBe(size * size * 4);
    for (let i = 3; i < buf.length; i += 4) expect(buf[i]).toBe(255);
  });

  it("tints each channel independently — a zeroed channel in `rgb` stays zero everywhere", () => {
    const preview = createStrainPreview({ size: 24, agents: 400, seed: 3 });
    runSteps(preview, SPOTTY_MOTION, 40);
    const buf = preview.pixels([1, 0, 0]);
    for (let i = 0; i < buf.length; i += 4) {
      expect(buf[i + 1]).toBe(0); // g
      expect(buf[i + 2]).toBe(0); // b
    }
  });

  it("never produces NaN/negative trail even over many steps with a large deposit", () => {
    const preview = createStrainPreview({ size: 24, agents: 500, seed: 9 });
    const hot: StrainPreviewMotion = { ...SPOTTY_MOTION, deposit: 1 };
    runSteps(preview, hot, 300);
    const buf = preview.pixels([1, 1, 1]);
    for (const v of buf) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  // The respawn claim (this module's own RESPAWN_PER_STEP comment, and
  // physarum2.ts's file header "Phase 3" paragraph): measured 2026-09-27
  // with a node harness, the densest 2% of a pure culture's cells held 76%
  // of the trail after 900 steps *without* RESPAWN_PER_STEP, falling to
  // about 12% *with* it. This test doesn't re-measure that exact number (a
  // fast, small-field test can't reproduce a 900-step/large-field run
  // bit-for-bit) — it checks the qualitative claim RESPAWN_PER_STEP exists
  // for: the trail stays spread across a real share of the field instead of
  // collapsing onto a tiny hot spot, at a size/step count that still runs in
  // well under a second.
  it("keeps a real share of the field lit (the respawn claim): visible share above a floor, densest-2% share below a ceiling", () => {
    const size = 48;
    const preview = createStrainPreview({ size, agents: 700, seed: 1234 });
    runSteps(preview, SPOTTY_MOTION, 400);
    const buf = preview.pixels([1, 1, 1]);
    const cells = size * size;
    const values: number[] = new Array(cells);
    let visible = 0;
    let total = 0;
    for (let i = 0; i < cells; i++) {
      const v = buf[i * 4]!; // tinted [1,1,1] — r === the raw (gamma'd) trail reading
      values[i] = v;
      total += v;
      if (v > 8) visible++; // "lit" floor — well above the gamma curve's black floor
    }
    const visibleShare = visible / cells;
    expect(visibleShare).toBeGreaterThan(0.15);

    values.sort((a, b) => b - a);
    const top2pct = Math.max(1, Math.round(cells * 0.02));
    const denseSum = values.slice(0, top2pct).reduce((a, b) => a + b, 0);
    const denseShare = total > 0 ? denseSum / total : 0;
    expect(denseShare).toBeLessThan(0.4);
  });
});
