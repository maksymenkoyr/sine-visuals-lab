import { describe, it, expect } from "vitest";
import {
  dyeSide,
  createDropGate,
  nozzlePosition,
  beadPositions,
  pourScene,
  FALLBACK_STAMP_SEC,
  OLIVE_MIN_GAP_SEC,
  BEAD_MAX,
  DYE_SIDE_MIN,
} from "../src/render/scenes/pour.ts";
import { computeAutoTarget } from "../src/render/autoTune.ts";
import { NEUTRAL } from "../src/render/musicProfile.ts";

describe("dyeSide", () => {
  it("clamps to [DYE_SIDE_MIN, the preset's own side] regardless of maxDim", () => {
    for (const preset of ["high", "mid", "low", "floor"] as const) {
      expect(dyeSide(preset, 10)).toBeGreaterThanOrEqual(DYE_SIDE_MIN);
      expect(dyeSide(preset, 100_000)).toBeLessThanOrEqual(1024);
    }
  });

  it("shrinks to the screen's own max dimension when that's the tighter bound", () => {
    expect(dyeSide("high", 500)).toBe(500);
    expect(dyeSide("floor", 200)).toBeGreaterThanOrEqual(DYE_SIDE_MIN);
  });

  it("returns the preset's own table value when the screen is roomy", () => {
    expect(dyeSide("high", 100_000)).toBe(1024);
    expect(dyeSide("mid", 100_000)).toBe(768);
    expect(dyeSide("low", 100_000)).toBe(512);
    expect(dyeSide("floor", 100_000)).toBe(384);
  });

  it("is always a finite positive integer for degenerate input", () => {
    for (const maxDim of [0, -5, NaN]) {
      const side = dyeSide("high", maxDim);
      expect(Number.isInteger(side)).toBe(true);
      expect(side).toBeGreaterThan(0);
    }
  });
});

describe("createDropGate", () => {
  it("fires on the first kick", () => {
    const gate = createDropGate();
    const r = gate.advance(1 / 60, true, false, 0, 0, 0.7, () => 0);
    expect(r.crimson).toBe(true);
  });

  it("refuses a second kick inside the tempo hold, accepts one after it passes", () => {
    const gate = createDropGate();
    expect(gate.advance(1 / 60, true, false, 0, 0, 1, () => 0).crimson).toBe(true);
    // Immediately after: well inside even the unlocked 0.35s floor.
    expect(gate.advance(1 / 60, true, false, 0, 0, 1, () => 0).crimson).toBe(false);
    // Past the unlocked minimum gap (bpm=0/tempoLock=0 -> the flat floor applies).
    expect(gate.advance(0.4, true, false, 0, 0, 1, () => 0).crimson).toBe(true);
  });

  it("uses the tempo-derived gap once a tempo is locked", () => {
    const gate = createDropGate();
    // 120 bpm, locked: gap = max(0.25, 0.6 * 60/120) = 0.3s.
    expect(gate.advance(1 / 60, true, false, 0.5, 120, 1, () => 0).crimson).toBe(true);
    expect(gate.advance(0.2, true, false, 0.5, 120, 1, () => 0).crimson).toBe(false);
    expect(gate.advance(0.2, true, false, 0.5, 120, 1, () => 0).crimson).toBe(true);
  });

  it("falls back after FALLBACK_STAMP_SEC of silence", () => {
    const gate = createDropGate();
    let t = 0;
    let firedEarly = false;
    while (t < FALLBACK_STAMP_SEC - 0.5) {
      firedEarly ||= gate.advance(0.1, false, false, 0, 0, 0.7, () => 0.99).crimson;
      t += 0.1;
    }
    expect(firedEarly).toBe(false);
    let firedLate = false;
    while (t < FALLBACK_STAMP_SEC + 0.5) {
      firedLate ||= gate.advance(0.1, false, false, 0, 0, 0.7, () => 0.99).crimson;
      t += 0.1;
    }
    expect(firedLate).toBe(true);
  });

  it("ignores a gated onset when drops = 0", () => {
    const gate = createDropGate();
    for (let i = 0; i < 10; i++) {
      expect(gate.advance(0.05, true, false, 0, 0, 0, () => 0).crimson).toBe(false);
    }
  });

  it("stamps olive on a high-band onset, independent of drops/crimson gating", () => {
    const gate = createDropGate();
    expect(gate.advance(1 / 60, false, true, 0, 0, 0, () => 0).olive).toBe(true);
    expect(gate.advance(1 / 60, false, false, 0, 0, 0, () => 0).olive).toBe(false);
  });

  it("keeps olive an accent: a second high onset inside OLIVE_MIN_GAP_SEC is ignored", () => {
    const gate = createDropGate();
    expect(gate.advance(1 / 60, false, true, 0, 0, 0, () => 0).olive).toBe(true);
    expect(gate.advance(OLIVE_MIN_GAP_SEC / 2, false, true, 0, 0, 0, () => 0).olive).toBe(false);
    expect(gate.advance(OLIVE_MIN_GAP_SEC, false, true, 0, 0, 0, () => 0).olive).toBe(true);
  });
});

describe("nozzlePosition", () => {
  it("stays inside the unit square and is deterministic", () => {
    for (let t = 0; t < 100; t += 3.3) {
      const [x, y] = nozzlePosition(t, 4);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(1);
    }
    expect(nozzlePosition(12.5, 3)).toEqual(nozzlePosition(12.5, 3));
  });

  it("moves as the epoch advances, for the same t", () => {
    const a = nozzlePosition(5, 0);
    const b = nozzlePosition(5, 1);
    expect(a).not.toEqual(b);
  });

  it("survives non-finite input", () => {
    const [x, y] = nozzlePosition(NaN, NaN);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });
});

describe("beadPositions", () => {
  it("stays inside [0,1) and is deterministic", () => {
    for (const count of [0, 1, 2, 4]) {
      const beads = beadPositions(17.3, count);
      expect(beads.length).toBe(count);
      for (const b of beads) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x).toBeLessThan(1);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeLessThan(1);
      }
    }
    expect(beadPositions(5, 3)).toEqual(beadPositions(5, 3));
  });

  it("clamps count to [0, BEAD_MAX]", () => {
    expect(beadPositions(0, -3).length).toBe(0);
    expect(beadPositions(0, 999).length).toBe(BEAD_MAX);
  });
});

describe("pour's auto settings reproduce their default at NEUTRAL", () => {
  it("every setting with an auto table resolves to spec.default when every dial sits at NEUTRAL", () => {
    const settings = pourScene.settings ?? [];
    const withAuto = settings.filter((s) => s.auto);
    expect(withAuto.length).toBeGreaterThan(0);
    for (const spec of withAuto) {
      expect(computeAutoTarget(spec, NEUTRAL, 1)).toBe(spec.default);
    }
  });
});
