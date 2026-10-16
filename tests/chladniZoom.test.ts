import { describe, it, expect } from "vitest";
import {
  ZOOM_BASE,
  ZOOM_LAYERS,
  ZOOM_OCTAVES_PER_MIN,
  ZOOM_PEAK_SCALE,
  zoomBell,
  zoomFinestScale,
  zoomLayers,
  zoomPhaseStep,
  zoomRespawnShare,
  zoomShrink,
  type ZoomLayer,
} from "../src/render/scenes/chladniZoom.ts";
import { chladniScene } from "../src/render/scenes/chladni.ts";

const PHASES = Array.from({ length: 101 }, (_, i) => i / 100);

/** The weighted layer set as (scale, weight) pairs with any weight, coarsest first. */
function liveSet(phase: number): ZoomLayer[] {
  return zoomLayers(phase).filter((l) => l.weight > 0).map((l) => ({ ...l }));
}

describe("zoom out layers", () => {
  it("weights are never negative and always sum to 1", () => {
    for (const u of PHASES) {
      const layers = zoomLayers(u);
      expect(layers).toHaveLength(ZOOM_LAYERS);
      let sum = 0;
      for (const l of layers) {
        expect(l.weight).toBeGreaterThanOrEqual(0);
        sum += l.weight;
      }
      expect(sum).toBeCloseTo(1, 12);
    }
  });

  it("the bell is exactly 0 at both ends of the stack", () => {
    expect(zoomBell(0)).toBe(0);
    expect(zoomBell(1)).toBe(0);
    expect(zoomBell(0.5)).toBeGreaterThan(0);
  });

  it("each layer is an octave finer than the one before", () => {
    for (const u of [0, 0.3, 0.9]) {
      const layers = zoomLayers(u);
      for (let k = 1; k < layers.length; k++) expect(layers[k].scale / layers[k - 1].scale).toBeCloseTo(2, 12);
      expect(layers[0].scale).toBeCloseTo(ZOOM_BASE * 2 ** u, 12);
    }
  });

  it("only the fractional part of the phase counts", () => {
    for (const u of [0.1, 0.55, 0.97]) {
      const a = zoomLayers(u + 7).map((l) => ({ ...l }));
      const b = zoomLayers(u);
      for (let k = 0; k < b.length; k++) {
        expect(a[k].scale).toBeCloseTo(b[k].scale, 12);
        expect(a[k].weight).toBeCloseTo(b[k].weight, 12);
      }
    }
  });

  it("no seam at the wrap: the set just before an octave is the set just after it", () => {
    for (const eps of [1e-3, 1e-6]) {
      const before = liveSet(1 - eps);
      const after = liveSet(eps);
      // Same field: the same scales carry the same weights, to within the step.
      expect(before).toHaveLength(after.length);
      for (let i = 0; i < before.length; i++) {
        expect(Math.abs(Math.log2(before[i].scale / after[i].scale))).toBeLessThan(3 * eps);
        expect(Math.abs(before[i].weight - after[i].weight)).toBeLessThan(1e3 * eps);
      }
    }
  });

  it("is continuous across the whole octave", () => {
    let prev = zoomLayers(0).map((l) => l.weight * l.scale);
    for (let i = 1; i <= 1000; i++) {
      const cur = zoomLayers(i / 1000).map((l) => l.weight * l.scale);
      // A layer index can shift only at the wrap, which the test above covers.
      if (i < 1000) for (let k = 0; k < cur.length; k++) expect(Math.abs(cur[k] - prev[k])).toBeLessThan(0.05);
      prev = cur;
    }
  });

  it("the strongest layer at mid octave sits at ZOOM_PEAK_SCALE", () => {
    const mid = zoomLayers(0.5);
    const top = mid.reduce((a, b) => (b.weight > a.weight ? b : a));
    expect(top.scale).toBeCloseTo(ZOOM_PEAK_SCALE, 12);
  });

  it("the step cap counts the finest layer with any weight", () => {
    for (const u of PHASES) {
      const layers = zoomLayers(u);
      const finest = Math.max(...layers.filter((l) => l.weight > 0).map((l) => l.scale));
      expect(zoomFinestScale(layers)).toBe(finest);
    }
  });
});

describe("zoom out speed", () => {
  it("runs at ZOOM_OCTAVES_PER_MIN for setting and drive both at 1", () => {
    expect(zoomPhaseStep(60, 1, 1)).toBeCloseTo(ZOOM_OCTAVES_PER_MIN, 12);
    expect(zoomPhaseStep(1, 0.5, 0.6)).toBeCloseTo((ZOOM_OCTAVES_PER_MIN / 60) * 0.3, 12);
  });

  it("stands still at setting 0 or a silent drive, and never runs backwards", () => {
    expect(zoomPhaseStep(1 / 60, 0, 1)).toBe(0);
    expect(zoomPhaseStep(1 / 60, 1, 0)).toBe(0);
    expect(zoomPhaseStep(1 / 60, 1, -0.4)).toBe(0);
    expect(zoomPhaseStep(1 / 60, -1, 1)).toBe(0);
    expect(zoomPhaseStep(Number.NaN, 1, 1)).toBe(0);
    expect(zoomPhaseStep(1 / 60, 1, Number.NaN)).toBe(0);
  });

  it("clamps the setting to the slider", () => {
    expect(zoomPhaseStep(1, 3, 1)).toBe(zoomPhaseStep(1, 1, 1));
  });
});

describe("zoom out sand", () => {
  it("one octave of shrinks halves the bed", () => {
    let c = 1;
    for (let i = 0; i < 100; i++) c *= zoomShrink(0.01);
    expect(c).toBeCloseTo(0.5, 12);
    expect(zoomShrink(0)).toBe(1);
    expect(zoomRespawnShare(0)).toBe(0);
  });

  it("the respawn share is the area the shrink frees", () => {
    for (const du of [1e-4, 0.01, 0.5]) {
      const c = zoomShrink(du);
      expect(zoomRespawnShare(du)).toBeCloseTo(1 - c * c, 12);
    }
  });

  /** Ring densities (1 = even, centre first, equal-area rings by Chebyshev
   *  radius) after a seeded walk of SIM_FRAG's zoom rule on an even bed over
   *  the frame [-1,1]^2, octaves at `du` a frame: shrink; the respawn share to
   *  a uniform spot in the freed strip (respawnInRim); then a random hop of up
   *  to `hop` per axis for every grain, a refilled one too unless
   *  `refillSitsStill`; a grain hopped off the frame folded back in across
   *  the edge (foldIntoPlate), or, with `spillAnywhere`, respawned anywhere. */
  function walkBed(opts: { hop: number; spillAnywhere?: boolean; refillSitsStill?: boolean }): number[] {
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    const N = 30000;
    const xs = new Float64Array(N);
    const ys = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      xs[i] = rnd() * 2 - 1;
      ys[i] = rnd() * 2 - 1;
    }
    const du = 0.02;
    const c = zoomShrink(du);
    const share = zoomRespawnShare(du);
    const fold = (q: number) => Math.max(-1, Math.min(1, q > 1 ? 2 - q : q < -1 ? -2 - q : q));
    // Three octaves.
    for (let step = 0; step < 3 / du; step++) {
      for (let i = 0; i < N; i++) {
        let x = xs[i] * c;
        let y = ys[i] * c;
        if (rnd() < share) {
          // Mirrors respawnInRim: top/bottom strips hold 1 / (1 + c) of the area.
          const u = rnd(), v = rnd(), w = rnd(), z = rnd();
          const side = z < 0.5 ? -1 : 1;
          const depth = c + (1 - c) * u;
          if (w * (1 + c) < 1) {
            x = v * 2 - 1;
            y = side * depth;
          } else {
            x = side * depth;
            y = (v * 2 - 1) * c;
          }
          if (opts.refillSitsStill) {
            xs[i] = x;
            ys[i] = y;
            continue;
          }
        }
        x += (rnd() - 0.5) * 2 * opts.hop;
        y += (rnd() - 0.5) * 2 * opts.hop;
        if (Math.abs(x) > 1 || Math.abs(y) > 1) {
          if (opts.spillAnywhere) {
            x = rnd() * 2 - 1;
            y = rnd() * 2 - 1;
          } else {
            x = fold(x);
            y = fold(y);
          }
        }
        xs[i] = x;
        ys[i] = y;
      }
    }
    const RINGS = 5;
    const counts = new Array(RINGS).fill(0);
    for (let i = 0; i < N; i++) {
      const r = Math.max(Math.abs(xs[i]), Math.abs(ys[i]));
      counts[Math.min(RINGS - 1, Math.floor(r * r * RINGS))]++;
    }
    return counts.map((n) => n / (N / RINGS));
  }

  it("shrinking, then moving that share to the freed strip, keeps an even bed even", () => {
    for (const d of walkBed({ hop: 0 })) expect(Math.abs(d - 1)).toBeLessThan(0.04);
  });

  it("stays even with the sand hopping and spilling off the frame's edges", () => {
    for (const hop of [0.02, 0.05]) {
      for (const d of walkBed({ hop })) expect(Math.abs(d - 1)).toBeLessThan(0.04);
    }
  });

  it("would not stay even if spills respawned anywhere, or refilled grains sat still", () => {
    // The two ways the rule above can go wrong, so this walk can see them.
    expect(walkBed({ hop: 0.05, spillAnywhere: true })[0]).toBeGreaterThan(1.3);
    expect(walkBed({ hop: 0.05, refillSitsStill: true })[4]).toBeGreaterThan(1.05);
  });
});

describe("zoom out setting", () => {
  const spec = chladniScene.settings!.find((x) => x.key === "zoomOut")!;
  it("is off by default, manual, and driven by the All level", () => {
    expect(spec.default).toBe(0);
    expect(spec.auto).toBeUndefined();
    expect(spec.drive?.default).toBe("anim.energy");
    expect(spec.group).toBe("Motion");
  });
  it("sits right after Toss", () => {
    const keys = chladniScene.settings!.map((x) => x.key);
    expect(keys.indexOf("zoomOut")).toBe(keys.indexOf("toss") + 1);
  });
});
