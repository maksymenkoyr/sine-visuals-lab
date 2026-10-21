// LED Hearts' endless zoom (src/render/scenes/ledhearts/motion.ts's header):
// the layers grow together, wrap back to the smallest size unseen and with a
// new seed, and the spin clock's wrap never shows on a heart.

import { describe, it, expect } from "vitest";
import { LAYER_STEP, LAYERS, MIN_SCALE, SPIN_RATE_UNIT, layerAt, wrapSpin } from "../src/render/scenes/ledhearts/motion.ts";

describe("LED Hearts zoom layers", () => {
  it("never pops: every layer's fade moves only a little per small step, across wraps too", () => {
    const step = 0.001;
    for (let k = 0; k < LAYERS; k++) {
      let prev = layerAt(0, k);
      for (let z = step; z < 3 * LAYERS * LAYER_STEP; z += step) {
        const cur = layerAt(z, k);
        expect(Math.abs(cur.fade - prev.fade)).toBeLessThan(0.01);
        prev = cur;
      }
    }
  });

  it("changes a layer's seed when it wraps, and only then", () => {
    const span = LAYERS * LAYER_STEP;
    const a = layerAt(span - 0.01, 0);
    const b = layerAt(span + 0.01, 0);
    expect(b.seed).not.toBe(a.seed);
    expect(b.scale).toBeLessThan(a.scale);
    expect(layerAt(0.2, 0).seed).toBe(layerAt(0.3, 0).seed);
  });

  it("keeps the layers a step apart in scale and inside the span", () => {
    for (const z of [0, 0.4, 1.7, 123.45, -5]) {
      const scales = Array.from({ length: LAYERS }, (_, k) => layerAt(z, k).scale).sort((x, y) => x - y);
      for (const s of scales) {
        expect(s).toBeGreaterThanOrEqual(MIN_SCALE * 0.999);
        expect(s).toBeLessThan(MIN_SCALE * Math.exp(LAYERS * LAYER_STEP));
      }
      for (let i = 1; i < LAYERS; i++) expect(Math.log(scales[i] / scales[i - 1])).toBeCloseTo(LAYER_STEP, 6);
    }
  });

  it("keeps seeds in the hash's range for any zoom", () => {
    for (const z of [-1e4, -3, 0, 7, 1e6]) {
      for (let k = 0; k < LAYERS; k++) {
        const { seed } = layerAt(z, k);
        expect(Number.isInteger(seed)).toBe(true);
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(seed).toBeLessThan(1024);
      }
    }
  });
});

describe("LED Hearts spin clock", () => {
  it("wraps where every heart's turn is whole", () => {
    for (const phase of [0.3, 17.2, 400.9, 1e5 + 0.25]) {
      for (let m = 1; m <= 4; m++) {
        const rate = m * SPIN_RATE_UNIT;
        expect(Math.cos(wrapSpin(phase) * rate)).toBeCloseTo(Math.cos(phase * rate), 6);
      }
    }
  });
});
