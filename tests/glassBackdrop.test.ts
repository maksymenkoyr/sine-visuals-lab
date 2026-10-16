import { describe, expect, it } from "vitest";
import {
  type GlassPane,
  halvingChain,
  halvingsFor,
  MIN_SIGMA_TEXELS,
  packPanes,
  PANES_PER_BATCH,
} from "../src/render/glassBackdrop.ts";

function pane(over: Partial<GlassPane> = {}): GlassPane {
  return { x: 10, y: 20, w: 100, h: 50, clipX0: -1e9, clipY0: -1e9, clipX1: 1e9, clipY1: 1e9, radius: 3, alpha: 1, ...over };
}

function buffers() {
  return {
    rect: new Float32Array(PANES_PER_BATCH * 4),
    quad: new Float32Array(PANES_PER_BATCH * 4),
    misc: new Float32Array(PANES_PER_BATCH * 4),
  };
}

describe("halvingsFor", () => {
  it("leaves the blur at least MIN_SIGMA_TEXELS texels wide, and less than twice that", () => {
    for (const sigma of [7, 10, 20, 40, 60, 123]) {
      const n = halvingsFor(sigma);
      const texels = sigma / 2 ** n;
      expect(texels).toBeGreaterThanOrEqual(MIN_SIGMA_TEXELS);
      expect(texels).toBeLessThan(MIN_SIGMA_TEXELS * 2);
    }
  });

  it("never halves a blur already narrower than that, or a bad one", () => {
    expect(halvingsFor(MIN_SIGMA_TEXELS / 2)).toBe(0);
    expect(halvingsFor(0)).toBe(0);
    expect(halvingsFor(Number.NaN)).toBe(0);
  });
});

describe("halvingChain", () => {
  it("floors each step and never goes below one pixel", () => {
    expect(halvingChain(2913, 1805, 3)).toEqual([
      { w: 1456, h: 902 },
      { w: 728, h: 451 },
      { w: 364, h: 225 },
    ]);
    expect(halvingChain(3, 2, 3)).toEqual([
      { w: 1, h: 1 },
      { w: 1, h: 1 },
      { w: 1, h: 1 },
    ]);
  });
});

describe("packPanes", () => {
  it("maps CSS px onto the buffer with GL's origin at the bottom", () => {
    const b = buffers();
    const n = packPanes([pane()], 0, 1, 2, 2, 1000, b.rect, b.quad, b.misc);
    expect(n).toBe(1);
    // x 10..110, y 20..70 in CSS px, doubled, then flipped in a 1000 px buffer.
    expect(Array.from(b.rect.slice(0, 4))).toEqual([20, 860, 220, 960]);
    expect(Array.from(b.quad.slice(0, 4))).toEqual([20, 860, 220, 960]);
    expect(Array.from(b.misc.slice(0, 2))).toEqual([6, 1]);
  });

  it("cuts the drawn quad to the clip but keeps the whole box for the blur", () => {
    const b = buffers();
    packPanes([pane({ clipY0: 40 })], 0, 1, 1, 1, 100, b.rect, b.quad, b.misc);
    expect(Array.from(b.rect.slice(0, 4))).toEqual([10, 30, 110, 80]);
    expect(Array.from(b.quad.slice(0, 4))).toEqual([10, 30, 110, 60]);
  });

  it("leaves out a pane that is clipped away or invisible, and packs the rest together", () => {
    const b = buffers();
    const panes = [pane({ clipX0: 200 }), pane({ alpha: 0 }), pane({ x: 0, alpha: 0.4 })];
    const n = packPanes(panes, 0, panes.length, 1, 1, 100, b.rect, b.quad, b.misc);
    expect(n).toBe(1);
    expect(b.rect[0]).toBe(0);
    expect(b.misc[1]).toBeCloseTo(0.4);
  });

  it("packs only the panes from..to", () => {
    const b = buffers();
    const panes = [pane({ x: 1 }), pane({ x: 2 }), pane({ x: 3 })];
    expect(packPanes(panes, 1, 3, 1, 1, 100, b.rect, b.quad, b.misc)).toBe(2);
    expect(b.rect[0]).toBe(2);
    expect(b.rect[4]).toBe(3);
  });
});
