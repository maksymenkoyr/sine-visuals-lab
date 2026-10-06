import { describe, it, expect } from "vitest";
import {
  HEAD_START,
  MAX_STACKS,
  PALETTES,
  ROOM_PALETTE,
  SHAPE_REACH,
  SW,
  bezier,
  endScales,
  headOf,
  newPathDivisor,
  packFrame,
  progressFor,
  rollPath,
  span,
  stackGeometry,
  type Knobs,
} from "../src/render/scenes/sweep/stack.ts";
import { SWEEP_FRAG_BODY } from "../src/render/scenes/sweep/glsl.ts";
import { sweepScene } from "../src/render/scenes/sweep/index.ts";
import { KEPT_BY_PIECES, PIECES, presetValues } from "../src/render/scenes/sweep/pieces.ts";
import { presetWrites, pressedPreset, type PresetPillsOptions } from "../src/ui/widgets/presetPills.ts";
import { quantize } from "../src/ui/widgets/consoleMath.ts";
import { COMMON_UNIFORMS_GLSL, settingUniformName } from "../src/render/sceneCommon.ts";

const KNOBS: Knobs = {
  shape: 4,
  stretch: 1,
  copies: 40,
  size: 0.17,
  taper: -0.9,
  twist: 0,
  pair: true,
  travel: 0.85,
  bend: 0.3,
  aim: 0,
  spread: 0,
  trail: 1,
  palette: 1,
  bands: 1.5,
  head: 1,
  rim: 0.3,
  sheen: 0,
  faces: 1,
  opacity: 1,
  multiply: 0,
  outline: 0.008,
  outlineStyle: 1,
  outlineReach: 1,
  blur: 0.1,
  headBlur: 0,
  fade: 0,
  steps: 0,
};

describe("sweep head motion", () => {
  it("headOf and progressFor invert each other, and the head never reaches the end", () => {
    for (const h of [0, HEAD_START, 0.5, 0.9]) expect(headOf(progressFor(h))).toBeCloseTo(h, 6);
    expect(headOf(1e6)).toBeLessThanOrEqual(1);
    expect(headOf(2)).toBeGreaterThan(headOf(1));
  });

  it("New path's divisor: the default waits the base count, right waits fewer, 0 never re-rolls", () => {
    expect(newPathDivisor(0.5, 0.5, 2)).toBe(2);
    expect(newPathDivisor(1, 0.5, 2)).toBe(1);
    expect(newPathDivisor(0.25, 0.5, 2)).toBe(4);
    expect(newPathDivisor(0, 0.5, 2)).toBe(0);
  });
});

describe("sweep span", () => {
  it("Spread 0 grows from the path's start; Spread 1 spreads both ways from its middle", () => {
    expect(span(0, 0, 1)).toEqual([0, 0]);
    expect(span(0.6, 0, 1)).toEqual([0, 0.6]);
    expect(span(0, 1, 1)).toEqual([0.5, 0.5]);
    const [t, h] = span(0.5, 1, 1);
    expect(t).toBeCloseTo(0.25, 9);
    expect(h).toBeCloseTo(0.75, 9);
  });

  it("Trail keeps only the head's end of the span", () => {
    const [t, h] = span(0.8, 0, 0.25);
    expect(h).toBeCloseTo(0.8, 9);
    expect(t).toBeCloseTo(0.6, 9);
  });

  it("Size is the geometric middle of the two end scales; Taper −1 makes the head a quarter of the tail", () => {
    const [a, b] = endScales(0.2, -1);
    expect(Math.sqrt(a * b)).toBeCloseTo(0.2, 9);
    expect(b / a).toBeCloseTo(0.25, 9);
  });
});

describe("sweep paths", () => {
  it("a seed always rolls the same path", () => {
    expect(rollPath(42)).toEqual(rollPath(42));
    expect(rollPath(42)).not.toEqual(rollPath(43));
  });

  it("Aim −1 ends the path at the centre, +1 starts it there, and Travel is its length", () => {
    const roll = { ...rollPath(7), centre: [0, 0] as const };
    const end = stackGeometry(roll, { ...KNOBS, aim: -1, bend: 0 }, 0).p;
    expect(end[3][0]).toBeCloseTo(0, 9);
    expect(end[3][1]).toBeCloseTo(0, 9);
    const start = stackGeometry(roll, { ...KNOBS, aim: 1, bend: 0 }, 0).p;
    expect(start[0][0]).toBeCloseTo(0, 9);
    expect(start[0][1]).toBeCloseTo(0, 9);
    expect(Math.hypot(start[3][0] - start[0][0], start[3][1] - start[0][1])).toBeCloseTo(KNOBS.travel, 9);
  });

  it("each stack's box holds every copy of its span", () => {
    for (let seed = 1; seed < 20; seed++) {
      const roll = rollPath(seed);
      const out = packFrame({ roll, head: 0.7, phase: 0 }, KNOBS);
      expect(out.length).toBe(SW.LEN * 4);
      expect(out[SW.LOOK3 * 4 + 1]).toBe(2);
      for (let j = 0; j < MAX_STACKS; j++) {
        const g = stackGeometry(roll, KNOBS, j);
        const box = out.slice((SW.BOX0 + j) * 4, (SW.BOX0 + j) * 4 + 4);
        const st = SW.STACK0 + j * 4 + 3;
        const [uTail, uHead] = [out[st * 4], out[st * 4 + 1]];
        const [a, b] = endScales(KNOBS.size, KNOBS.taper);
        for (let i = 0; i <= 50; i++) {
          const s = uTail + ((uHead - uTail) * i) / 50;
          const [x, y] = bezier(g.p, s);
          const r = a * Math.pow(b / a, s) * SHAPE_REACH;
          expect(x - r).toBeGreaterThanOrEqual(box[0] - 1e-6);
          expect(y - r).toBeGreaterThanOrEqual(box[1] - 1e-6);
          expect(x + r).toBeLessThanOrEqual(box[2] + 1e-6);
          expect(y + r).toBeLessThanOrEqual(box[3] + 1e-6);
        }
      }
    }
  });

  it("the Room choice sets the shader's room flag", () => {
    const roll = rollPath(3);
    expect(packFrame({ roll, head: 0.5, phase: 0 }, { ...KNOBS, palette: 1 })[SW.FLAGS * 4]).toBe(0);
    expect(packFrame({ roll, head: 0.5, phase: 0 }, { ...KNOBS, palette: ROOM_PALETTE })[SW.FLAGS * 4]).toBe(1);
  });
});

describe("sweep settings", () => {
  it("the palettes are valid and the enum offers each plus Room", () => {
    for (const p of PALETTES) for (const hex of [...p.stops, p.ground, p.ink, p.accent]) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const palette = sweepScene.settings!.find((s) => s.key === "palette")!;
    expect(palette.options).toEqual([...PALETTES.map((p) => p.name), "Room"]);
  });

  it("only Speed, Colour flow and New path start on a wire; every other jack starts unplugged", () => {
    const wired = new Set(["speed", "colourFlow", "newPath"]);
    for (const s of sweepScene.settings!) {
      if (!s.drive) continue;
      const def = s.drive.default;
      const empty = typeof def === "object" && "mix" in def && def.sources.length === 0;
      expect(empty, s.key).toBe(!wired.has(s.key));
    }
  });

  it("no setting's uniform collides with a common one (a `bands` key once redefined uBands)", () => {
    const common = new Set([...COMMON_UNIFORMS_GLSL.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]));
    for (const s of sweepScene.settings!) {
      const u = settingUniformName(s.key);
      for (const name of [u, `${u}Drive`, `${u}Custom`]) expect(common.has(name), name).toBe(false);
    }
  });

  it("the shader's slot defines come from the SW table", () => {
    for (const [k, v] of Object.entries(SW)) expect(SWEEP_FRAG_BODY).toContain(`#define SW_${k} ${v}`);
  });
});

describe("sweep presets (the reel's pieces)", () => {
  const settings = sweepScene.settings!;
  const presets = (sweepScene.panel![0]!.options as PresetPillsOptions).presets;

  it("the Presets row comes first in the card, one pill per piece", () => {
    expect(sweepScene.panel![0]!.widget).toBe("presetPills");
    expect(presets.map((p) => p.name)).toEqual(PIECES.map((p) => p.name));
    expect(new Set(PIECES.map((p) => p.name)).size).toBe(PIECES.length);
    expect(new Set(PIECES.map((p) => p.path)).size).toBe(PIECES.length);
  });

  it("every piece names real knobs, in range and on their steps", () => {
    for (const piece of PIECES) {
      for (const [key, v] of Object.entries(piece.values)) {
        const spec = settings.find((s) => s.key === key);
        expect(spec, `${piece.name}.${key}`).toBeDefined();
        expect(quantize(v, spec!), `${piece.name}.${key}`).toBe(v);
      }
    }
  });

  it("a piece sets every setting but the kept ones: its own knobs and path, the rest at their defaults", () => {
    for (const piece of PIECES) {
      const values = presetValues(piece, settings);
      for (const s of settings) {
        if (KEPT_BY_PIECES.includes(s.key)) expect(values[s.key], s.key).toBeUndefined();
        else expect(values[s.key], s.key).toBe(s.key === "path" ? piece.path : (piece.values[s.key] ?? s.default));
      }
    }
  });

  it("a press writes only what differs, and its pill then reads as pressed", () => {
    const store = new Map(settings.map((s) => [s.key, s.default]));
    const get = (s: { key: string }): number => store.get(s.key)!;
    expect(pressedPreset(presets, settings, get)).toBe(-1);
    const rings = presets.findIndex((p) => p.name === "Rings");
    const writes = presetWrites(presets[rings]!, settings, get);
    expect(writes.length).toBeGreaterThan(0);
    for (const [spec, v] of writes) store.set(spec.key, v);
    expect(pressedPreset(presets, settings, get)).toBe(rings);
    expect(presetWrites(presets[rings]!, settings, get)).toEqual([]);
    store.set("size", store.get("size")! + 0.1);
    expect(pressedPreset(presets, settings, get)).toBe(-1);
  });
});
