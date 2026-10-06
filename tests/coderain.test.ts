import { describe, it, expect } from "vitest";
import { ATLAS_COLS, ATLAS_PX, GLYPH_COUNT, GLYPHS, MIRRORED_COUNT, TILE_PX, buildGlyphAtlas, glyphDistance } from "../src/render/scenes/coderain/glyphs.ts";
import { buildColumns } from "../src/render/scenes/coderain/index.ts";
import { createFigure, FIGURE_CAPSULES, FIGURE_HEIGHT } from "../src/render/scenes/coderain/figure.ts";
import type { AnimFrame } from "../src/render/animClock.ts";

function tile(atlas: Uint8Array, g: number): Uint8Array {
  const out = new Uint8Array(TILE_PX * TILE_PX);
  const ox = (g % ATLAS_COLS) * TILE_PX;
  const oy = Math.floor(g / ATLAS_COLS) * TILE_PX;
  for (let y = 0; y < TILE_PX; y++) out.set(atlas.subarray((oy + y) * ATLAS_PX + ox, (oy + y) * ATLAS_PX + ox + TILE_PX), y * TILE_PX);
  return out;
}

describe("coderain glyph atlas", () => {
  const atlas = buildGlyphAtlas();

  it("draws every glyph with solid strokes", () => {
    for (let g = 0; g < GLYPH_COUNT; g++) {
      const t = tile(atlas, g);
      expect(Math.max(...t), `glyph ${g}`).toBeGreaterThan(250);
      const inked = t.filter((v) => v > 128).length / t.length;
      expect(inked, `glyph ${g}`).toBeGreaterThan(0.01);
      expect(inked, `glyph ${g}`).toBeLessThan(0.5);
    }
  });

  it("keeps strokes off the tile's edge, so lower mips don't bleed a glyph into its neighbour", () => {
    for (let g = 0; g < GLYPH_COUNT; g++) {
      const t = tile(atlas, g);
      for (let i = 0; i < TILE_PX; i++) {
        for (const v of [t[i], t[(TILE_PX - 1) * TILE_PX + i], t[i * TILE_PX], t[i * TILE_PX + TILE_PX - 1]]) {
          expect(v, `glyph ${g}`).toBeLessThan(64);
        }
      }
    }
  });

  it("gives every glyph its own shape", () => {
    const seen = new Set<string>();
    for (let g = 0; g < GLYPH_COUNT; g++) {
      const key = Array.from(tile(atlas, g), (v) => (v > 128 ? 1 : 0)).join("");
      expect(seen.has(key), `glyph ${g} duplicates another`).toBe(false);
      seen.add(key);
    }
  });

  it("mirrors the kana and not the digits", () => {
    // Ink's mean x over a band of rows.
    const centroidX = (t: Uint8Array, y0: number, y1: number): number => {
      let sum = 0;
      let w = 0;
      for (let y = y0; y < y1; y++) for (let x = 0; x < TILE_PX; x++) {
        sum += x * t[y * TILE_PX + x];
        w += t[y * TILE_PX + x];
      }
      return sum / w;
    };
    // イ (GLYPHS[1]): drawn from the top right, so mirrored its top sits left.
    expect(GLYPHS[1][0].slice(0, 2)).toEqual([4, 0]);
    expect(centroidX(tile(atlas, 1), 0, TILE_PX / 4)).toBeLessThan(TILE_PX / 2);
    // 7 (after the kana and 0–6): its stem ends bottom left, and stays there.
    const seven = MIRRORED_COUNT + 6;
    expect(GLYPHS[seven]).toEqual([[0, 0, 4, 0, 1.5, 6]]);
    expect(centroidX(tile(atlas, seven), (TILE_PX * 3) / 4, TILE_PX)).toBeLessThan(TILE_PX / 2);
    expect(glyphDistance(GLYPHS[seven], 0, 0)).toBeGreaterThan(0);
  });
});

describe("coderain columns", () => {
  it("places every column inside the wrapped field with a share and a speed factor", () => {
    const grid = 12;
    const cols = buildColumns(grid, 7);
    expect(cols.length).toBe(grid * grid * 4);
    let maxX = 0;
    for (let i = 0; i < grid * grid; i++) {
      const [x, z, share, speed] = cols.subarray(i * 4, i * 4 + 4);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(z).toBeGreaterThanOrEqual(0);
      maxX = Math.max(maxX, x, z);
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThan(1);
      expect(speed).toBeGreaterThanOrEqual(0.55);
      expect(speed).toBeLessThanOrEqual(1.45);
    }
    // Same seed, same field.
    expect(buildColumns(grid, 7)).toEqual(cols);
    expect(maxX).toBeGreaterThan(0);
  });
});

describe("coderain figure", () => {
  it("poses a figure whose capsules stay finite and inside the figure's quad", () => {
    const fig = createFigure();
    const anim = {
      beatPhase: 0, barPhase: 0, tempoLock: 1, beatPulse: 0, lowPulse: 0, sectionIntensity: 0.6,
      dropPulse: 0, flowPhase: 0, timeSec: 0, profile: { pulse: 0.5 },
    } as unknown as AnimFrame;
    for (let i = 0; i < 240; i++) {
      anim.timeSec = i / 60;
      anim.beatPhase = (i / 30) % 1;
      anim.barPhase = (i / 120) % 1;
      const f = fig.advance(anim, 120, 1 / 60, 1);
      expect(f.caps.length).toBe(FIGURE_CAPSULES * 4);
      for (const v of f.caps) expect(Number.isFinite(v)).toBe(true);
      for (let c = 0; c < FIGURE_CAPSULES; c++) {
        expect(f.caps[c * 4 + 1]).toBeGreaterThanOrEqual(-0.05);
        expect(f.caps[c * 4 + 1]).toBeLessThanOrEqual(FIGURE_HEIGHT);
      }
      expect(f.skull[1] + f.skull[2]).toBeLessThanOrEqual(FIGURE_HEIGHT);
    }
  });
});
