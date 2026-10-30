import { describe, it, expect } from "vitest";
import { ATLAS_COLS, ATLAS_PX, GLYPH_COUNT, GLYPHS, MIRRORED_COUNT, TILE_PX, buildGlyphAtlas, glyphDistance } from "../src/render/scenes/coderain/glyphs.ts";
import { buildColumns } from "../src/render/scenes/coderain/index.ts";
import { createFigure, FIGURE_CAPSULES, FIGURE_HEIGHT } from "../src/render/scenes/coderain/figure.ts";
import { createExplorer } from "../src/render/scenes/coderain/explorer.ts";
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
      beatPhase: 0, barPhase: 0, tempoLock: 1, beatPulse: 0, song: { kickPulse: 0 }, sectionIntensity: 0.6,
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

describe("coderain explorer", () => {
  const seeded = (seed: number): (() => number) => {
    let a = seed;
    return () => {
      a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
      return a / 4294967296;
    };
  };
  const walk = (seconds: number, dt: number, seed = 7) => {
    const ex = createExplorer(seeded(seed));
    const poses = [];
    for (let t = 0; t < seconds; t += dt) poses.push({ ...ex.step(dt) });
    return poses;
  };

  const deg = Math.PI / 180;

  it("never stops: it only speeds up and slows down, smoothly", () => {
    const poses = walk(240, 1 / 60);
    expect(poses[0].pace).toBeGreaterThan(0.8);
    expect(Math.min(...poses.map((p) => p.pace))).toBeGreaterThan(0.3);
    expect(Math.max(...poses.map((p) => p.pace))).toBeGreaterThan(0.95);
    for (let i = 1; i < poses.length; i++) expect(Math.abs(poses[i].pace - poses[i - 1].pace)).toBeLessThan(0.01);
  });

  it("looks well away from where it walks, high into the rain and down below", () => {
    const poses = walk(240, 1 / 60);
    expect(Math.max(...poses.map((p) => Math.abs(p.gaze - p.body)))).toBeGreaterThan(60 * deg);
    expect(Math.max(...poses.map((p) => p.pitch))).toBeGreaterThan(30 * deg);
    expect(Math.min(...poses.map((p) => p.pitch))).toBeLessThan(-12 * deg);
  });

  it("rises and sinks through the columns", () => {
    const ys = walk(240, 1 / 60).map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(4);
  });

  it("never jerks the head or snaps its heading", () => {
    const poses = walk(240, 1 / 60);
    for (let i = 1; i < poses.length; i++) {
      expect(Math.abs(poses[i].gaze - poses[i - 1].gaze)).toBeLessThan(0.07);
      expect(Math.abs(poses[i].pitch - poses[i - 1].pitch)).toBeLessThan(0.07);
      expect(Math.abs(poses[i].body - poses[i - 1].body)).toBeLessThan(0.01);
    }
  });

  it("stays steady on long frames at top Speed", () => {
    for (const p of walk(600, 0.75)) {
      expect(Math.abs(p.pitch)).toBeLessThan(70 * deg);
      expect(Math.abs(p.roll)).toBeLessThan(10 * deg);
      expect(Math.abs(p.gaze - p.body)).toBeLessThan(160 * deg);
    }
  });

  it("walks the same path for the same seed", () => {
    expect(walk(30, 1 / 60, 3).at(-1)).toEqual(walk(30, 1 / 60, 3).at(-1));
  });
});
