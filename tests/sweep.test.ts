import { describe, it, expect } from "vitest";
import {
  HEAD_START,
  MAX_PATHS,
  RECIPES,
  SHAPE_REACH,
  SW,
  bezier,
  copySpan,
  createRng,
  createSweepState,
  headOf,
  newPieceDivisor,
  nextRecipe,
  packPiece,
  progressFor,
  rollPiece,
  stepSweep,
  type SweepInputs,
} from "../src/render/scenes/sweep/pieces.ts";
import { SWEEP_FRAG_BODY } from "../src/render/scenes/sweep/glsl.ts";

const QUIET: SweepInputs = { dt: 1 / 60, rate: 0.2, tick: false, ticksPerPiece: 2, pick: -1 };

describe("sweep head motion", () => {
  it("headOf and progressFor invert each other, and the head never reaches the end", () => {
    for (const h of [0, 0.12, 0.5, 0.9]) expect(headOf(progressFor(h))).toBeCloseTo(h, 6);
    expect(headOf(1e6)).toBeLessThanOrEqual(1);
    expect(headOf(2)).toBeGreaterThan(headOf(1));
  });

  it("progress grows by rate × dt and stands still at rate 0 (no signal, no movement)", () => {
    const rng = createRng(1);
    let s = createSweepState(rng);
    const p0 = s.progress;
    for (let i = 0; i < 60; i++) s = stepSweep(s, QUIET, rng);
    expect(s.progress - p0).toBeCloseTo(0.2, 6);
    const p1 = s.progress;
    for (let i = 0; i < 60; i++) s = stepSweep(s, { ...QUIET, rate: 0 }, rng);
    expect(s.progress).toBe(p1);
  });

  it("copies span from head × (1 − trail) to the head", () => {
    expect(copySpan(0.6, 1)).toEqual([0, 0.6]);
    const [a, b] = copySpan(0.6, 0.25);
    expect(a).toBeCloseTo(0.45, 9);
    expect(b).toBe(0.6);
  });
});

describe("sweep pieces", () => {
  it("cuts to a new piece after ticksPerPiece ticks and restarts the head", () => {
    const rng = createRng(2);
    let s = createSweepState(rng);
    s = stepSweep(s, { ...QUIET, dt: 2 }, rng);
    const first = s.piece;
    s = stepSweep(s, { ...QUIET, tick: true }, rng);
    expect(s.piece).toBe(first);
    s = stepSweep(s, { ...QUIET, tick: true }, rng);
    expect(s.piece).not.toBe(first);
    expect(s.piece.recipe).not.toBe(first.recipe);
    expect(headOf(s.progress)).toBeCloseTo(HEAD_START, 6);
  });

  it("never cuts with ticksPerPiece 0", () => {
    const rng = createRng(3);
    let s = createSweepState(rng);
    const first = s.piece;
    for (let i = 0; i < 20; i++) s = stepSweep(s, { ...QUIET, tick: true, ticksPerPiece: 0 }, rng);
    expect(s.piece).toBe(first);
  });

  it("a Look pick cuts at once to that recipe and holds it", () => {
    const rng = createRng(4);
    let s = createSweepState(rng);
    s = stepSweep(s, { ...QUIET, pick: 6 }, rng);
    expect(s.piece.recipe).toBe(6);
    for (let i = 0; i < 5; i++) s = stepSweep(s, { ...QUIET, pick: 6, tick: true, ticksPerPiece: 1 }, rng);
    expect(s.piece.recipe).toBe(6);
  });

  it("Mix never picks the current recipe again", () => {
    const rng = createRng(5);
    for (let cur = 0; cur < RECIPES.length; cur++) {
      for (let i = 0; i < 50; i++) expect(nextRecipe(cur, -1, rng)).not.toBe(cur);
    }
  });

  it("New piece's divisor: the default waits the base count, right waits fewer, 0 never cuts", () => {
    expect(newPieceDivisor(0.5, 0.5, 2)).toBe(2);
    expect(newPieceDivisor(1, 0.5, 2)).toBe(1);
    expect(newPieceDivisor(0.25, 0.5, 2)).toBe(4);
    expect(newPieceDivisor(0, 0.5, 2)).toBe(0);
  });

  it("a roll is deterministic for a seed and keeps the palette phase within its jitter", () => {
    for (let r = 0; r < RECIPES.length; r++) {
      const a = rollPiece(r, createRng(9));
      const b = rollPiece(r, createRng(9));
      expect(a).toEqual(b);
      const look = RECIPES[r].look;
      expect(a.stripePhase).toBeGreaterThanOrEqual(look.phase);
      expect(a.stripePhase).toBeLessThan(look.phase + look.phaseJitter + 1e-9);
    }
  });
});

describe("sweep recipes and packing", () => {
  it("every recipe fits the shader: paths, palette, copies", () => {
    for (const r of RECIPES) {
      expect(r.paths.length).toBeGreaterThan(0);
      expect(r.paths.length).toBeLessThanOrEqual(MAX_PATHS);
      for (const hex of [...r.look.palette, r.look.ground, r.look.ink, r.look.head]) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(r.look.copies).toBeGreaterThanOrEqual(2);
    }
  });

  it("each path's box holds every copy at the packed span", () => {
    for (let r = 0; r < RECIPES.length; r++) {
      const piece = rollPiece(r, createRng(11 + r));
      const out = packPiece(piece, { head: 0.7, trail: 1, copies: 1, blur: 1, outlines: 1 });
      expect(out.length).toBe(SW.LEN * 4);
      expect(out[SW.LOOK3 * 4 + 1]).toBe(piece.paths.length);
      piece.paths.forEach((path, j) => {
        const box = out.slice((SW.BOX0 + j) * 4, (SW.BOX0 + j) * 4 + 4);
        const sTail = out[(SW.PATH0 + j * 4 + 3) * 4];
        const head = out[(SW.PATH0 + j * 4 + 3) * 4 + 1];
        for (let i = 0; i <= 40; i++) {
          const s = sTail + ((head - sTail) * i) / 40;
          const [x, y] = bezier(path.p, s);
          const reach = (path.scale[0] + (path.scale[1] - path.scale[0]) * s) * SHAPE_REACH;
          expect(x - reach).toBeGreaterThanOrEqual(box[0] - 1e-6);
          expect(y - reach).toBeGreaterThanOrEqual(box[1] - 1e-6);
          expect(x + reach).toBeLessThanOrEqual(box[2] + 1e-6);
          expect(y + reach).toBeLessThanOrEqual(box[3] + 1e-6);
        }
      });
    }
  });

  it("the shader's slot defines come from the SW table", () => {
    for (const [k, v] of Object.entries(SW)) expect(SWEEP_FRAG_BODY).toContain(`#define SW_${k} ${v}`);
  });
});
