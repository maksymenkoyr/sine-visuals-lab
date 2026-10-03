import { describe, it, expect } from "vitest";
import {
  PALETTES,
  PALETTE_GROUPS,
  PALETTE_INK_COUNT,
  PALETTE_RAMP_STOPS,
  fitInkCycle,
  getPalette,
  paletteRampHex,
  paletteVecs,
} from "../src/render/palette.ts";
import { hexToRgb, mixOklab, oklabDistance, oklabLightness, oklabToRgb, rgbToHex, rgbToOklab } from "../src/render/oklab.ts";

// The promises palette.ts's header makes on every palette's roles. A scene
// on roles relies on these instead of tuning around one palette, so a new
// palette that breaks one fails here rather than in a scene.
const RAMP_MIN_STEP = 0.03; // OKLab L between neighbouring authored stops
const RAMP_DARK_END_MAX = 0.3;
const RAMP_BRIGHT_END_MIN = 0.8;
const GROUND_MAX = 0.2;
const INK_L_MIN = 0.5;
const INK_L_MAX = 0.97;
const INK_MIN_DISTANCE = 0.08;
const ACCENT_L_MIN = 0.6;

describe("oklab", () => {
  it("round-trips sRGB", () => {
    for (const hex of ["#000000", "#ffffff", "#ff2bd6", "#1f7a7a", "#e0892f"]) {
      expect(rgbToHex(oklabToRgb(rgbToOklab(hexToRgb(hex))))).toBe(hex);
    }
  });

  it("keeps lightness even through a mix that sRGB would grey out", () => {
    const teal = hexToRgb("#1f7a7a");
    const orange = hexToRgb("#e0892f");
    const mid = oklabLightness(mixOklab(teal, orange, 0.5));
    const ends = (oklabLightness(teal) + oklabLightness(orange)) / 2;
    expect(Math.abs(mid - ends)).toBeLessThan(0.01);
  });
});

describe("palette roles", () => {
  for (const p of PALETTES) {
    describe(p.id, () => {
      const r = p.roles;

      it("ramp rises in lightness from a dark end to a bright end", () => {
        const ls = r.ramp.map((h) => oklabLightness(hexToRgb(h)));
        for (let i = 1; i < ls.length; i++) expect(ls[i] - ls[i - 1], `stop ${i}`).toBeGreaterThanOrEqual(RAMP_MIN_STEP);
        expect(ls[0]).toBeLessThanOrEqual(RAMP_DARK_END_MAX);
        expect(ls[ls.length - 1]).toBeGreaterThanOrEqual(RAMP_BRIGHT_END_MIN);
      });

      it("ground is dark", () => {
        expect(oklabLightness(hexToRgb(r.ground))).toBeLessThanOrEqual(GROUND_MAX);
      });

      it("inks are readable and stay apart", () => {
        expect(r.inks).toHaveLength(PALETTE_INK_COUNT);
        for (const h of r.inks) {
          const l = oklabLightness(hexToRgb(h));
          expect(l, h).toBeGreaterThanOrEqual(INK_L_MIN);
          expect(l, h).toBeLessThanOrEqual(INK_L_MAX);
        }
        for (let i = 0; i < r.inks.length; i++) {
          for (let j = i + 1; j < r.inks.length; j++) {
            expect(oklabDistance(hexToRgb(r.inks[i]), hexToRgb(r.inks[j])), `${i}/${j}`).toBeGreaterThanOrEqual(INK_MIN_DISTANCE);
          }
        }
      });

      it("accent is bright", () => {
        expect(oklabLightness(hexToRgb(r.accent))).toBeGreaterThanOrEqual(ACCENT_L_MIN);
      });
    });
  }

  it("ids are unique and every group is known", () => {
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
    for (const p of PALETTES) expect(PALETTE_GROUPS).toContain(p.group);
  });
});

describe("cosine curve", () => {
  // The coefficients every palette() caller has always seen. A scene still
  // on palette() must look exactly the same under these.
  it("keeps the Classic palettes' coefficients exactly", () => {
    expect(getPalette("neon")).toMatchObject({ a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 1], d: [0, 0.33, 0.67] });
    expect(getPalette("sunset")).toMatchObject({ a: [0.6, 0.35, 0.3], b: [0.4, 0.35, 0.3], c: [1, 0.8, 0.6], d: [0, 0.15, 0.3] });
    expect(getPalette("acid")).toMatchObject({ a: [0.4, 0.5, 0.3], b: [0.5, 0.5, 0.3], c: [1.2, 0.9, 0.6], d: [0.1, 0.4, 0.6] });
    expect(getPalette("ice")).toMatchObject({ a: [0.35, 0.45, 0.55], b: [0.3, 0.35, 0.4], c: [0.8, 0.9, 1], d: [0.5, 0.55, 0.6] });
    expect(getPalette("fire")).toMatchObject({ a: [0.6, 0.35, 0.2], b: [0.5, 0.35, 0.2], c: [1, 0.7, 0.4], d: [0, 0.05, 0.15] });
  });

  it("a fitted curve stays close to [0,1] and passes near every ink", () => {
    for (const p of PALETTES.filter((q) => q.group !== "Classic")) {
      for (let ch = 0; ch < 3; ch++) {
        expect(p.a[ch] - p.b[ch], `${p.id} ch${ch}`).toBeGreaterThanOrEqual(-0.081);
        expect(p.a[ch] + p.b[ch], `${p.id} ch${ch}`).toBeLessThanOrEqual(1.081);
      }
      const curve = Array.from({ length: 200 }, (_, k) => {
        const t = k / 200;
        return [0, 1, 2].map((ch) => Math.min(1, Math.max(0, p.a[ch] + p.b[ch] * Math.cos(2 * Math.PI * (p.c[ch] * t + p.d[ch]))))) as [number, number, number];
      });
      for (const ink of p.roles.inks) {
        const nearest = Math.min(...curve.map((c) => oklabDistance(c, hexToRgb(ink))));
        expect(nearest, `${p.id} ${ink}`).toBeLessThan(0.15);
      }
    }
  });

  it("fitInkCycle is order-independent", () => {
    const inks = ["#2a9d9a", "#e58a2b", "#5a82c8", "#f4d7a1"] as const;
    const a = fitInkCycle(inks);
    const b = fitInkCycle([inks[2], inks[0], inks[3], inks[1]]);
    for (let ch = 0; ch < 3; ch++) {
      expect(b.a[ch]).toBeCloseTo(a.a[ch], 6);
      expect(b.b[ch]).toBeCloseTo(a.b[ch], 6);
    }
  });
});

describe("uniform views", () => {
  it("lay the roles out for uniform3fv", () => {
    const p = getPalette("sodium");
    const v = paletteVecs(p);
    expect(Array.from(v.ground)).toEqual(hexToRgb(p.roles.ground).map(Math.fround));
    expect(Array.from(v.accent)).toEqual(hexToRgb(p.roles.accent).map(Math.fround));
    expect(v.inks).toHaveLength(PALETTE_INK_COUNT * 3);
    expect(Array.from(v.inks.subarray(3, 6))).toEqual(hexToRgb(p.roles.inks[1]).map(Math.fround));
    expect(v.ramp).toHaveLength(PALETTE_RAMP_STOPS * 3);
  });

  it("bake the ramp's own ends and keep its lightness rising", () => {
    for (const p of PALETTES) {
      const v = paletteVecs(p).ramp;
      const stop = (i: number) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]] as [number, number, number];
      expect(rgbToHex(stop(0))).toBe(p.roles.ramp[0]);
      expect(rgbToHex(stop(PALETTE_RAMP_STOPS - 1))).toBe(p.roles.ramp[p.roles.ramp.length - 1]);
      for (let i = 1; i < PALETTE_RAMP_STOPS; i++) expect(oklabLightness(stop(i))).toBeGreaterThan(oklabLightness(stop(i - 1)));
    }
  });

  it("paletteRampHex draws the same ramp", () => {
    const p = getPalette("ember");
    const hexes = paletteRampHex(p, PALETTE_RAMP_STOPS);
    const v = paletteVecs(p).ramp;
    hexes.forEach((h, i) => expect(h).toBe(rgbToHex([v[i * 3], v[i * 3 + 1], v[i * 3 + 2]])));
  });
});
