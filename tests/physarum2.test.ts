import { describe, it, expect } from "vitest";
import {
  physarum2TrailSide,
  stepAccumulator,
  physarum2Scene,
  SPECIES,
  SPECIES_COUNT,
  ATTRACT_ROWS,
  PALETTE,
  TRAIL_SIDE_CAP,
  TRAIL_SIDE_MIN,
  AGENTS_PER_TEXEL,
  AGENT_MULTIPLIER,
  MAX_STEPS_PER_FRAME,
} from "../src/render/scenes/physarum2.ts";
import { computeAutoTarget } from "../src/render/autoTune.ts";
import { NEUTRAL } from "../src/render/musicProfile.ts";
import { qualitySettings } from "../src/render/quality.ts";

describe("physarum2TrailSide", () => {
  it("holds agent density per texel roughly constant across the quality presets' agent counts", () => {
    for (const preset of ["high", "mid", "low", "floor"] as const) {
      const count = qualitySettings(preset).maxParticles * AGENT_MULTIPLIER;
      const side = physarum2TrailSide(count, TRAIL_SIDE_CAP);
      const density = count / (side * side);
      expect(density).toBeCloseTo(AGENTS_PER_TEXEL, 0);
    }
  });

  it("clamps to [TRAIL_SIDE_MIN, maxSide]", () => {
    expect(physarum2TrailSide(1, 1024)).toBeGreaterThanOrEqual(TRAIL_SIDE_MIN);
    expect(physarum2TrailSide(10_000_000, 1024)).toBeLessThanOrEqual(1024);
    expect(physarum2TrailSide(10_000_000, 10)).toBeLessThanOrEqual(10);
  });

  it("is always an integer, never 0, for a 0/negative/NaN count", () => {
    for (const count of [0, -5, NaN]) {
      const side = physarum2TrailSide(count, TRAIL_SIDE_CAP);
      expect(Number.isInteger(side)).toBe(true);
      expect(side).toBeGreaterThan(0);
    }
  });

  it("is monotonically non-decreasing in agent count", () => {
    let prev = physarum2TrailSide(1, TRAIL_SIDE_CAP);
    for (const count of [10, 100, 1000, 10_000, 100_000, 800_000]) {
      const side = physarum2TrailSide(count, TRAIL_SIDE_CAP);
      expect(side).toBeGreaterThanOrEqual(prev);
      prev = side;
    }
  });
});

describe("stepAccumulator", () => {
  it("never returns more than MAX_STEPS_PER_FRAME steps even for a huge dt/rate", () => {
    const { steps } = stepAccumulator(0, 1, 120);
    expect(steps).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
  });

  it("accumulates fractional progress across frames rather than dropping it", () => {
    // At 30 steps/sec, a 1/60s frame owes half a step — two such frames
    // should produce exactly one step total, not zero.
    const a = stepAccumulator(0, 1 / 60, 30);
    expect(a.steps).toBe(0);
    const b = stepAccumulator(a.acc, 1 / 60, 30);
    expect(b.steps).toBe(1);
  });

  it("drops backlog past the cap instead of carrying it forward", () => {
    // A huge dt owes far more than MAX_STEPS_PER_FRAME steps; the leftover
    // accumulator should be reset rather than left large enough to replay
    // the backlog over the next few frames.
    const { steps, acc } = stepAccumulator(0, 10, 120);
    expect(steps).toBe(MAX_STEPS_PER_FRAME);
    expect(acc).toBeLessThanOrEqual(1);
  });

  it("tolerates non-finite input without throwing or producing NaN", () => {
    const r = stepAccumulator(NaN, NaN, NaN);
    expect(Number.isFinite(r.steps)).toBe(true);
    expect(Number.isFinite(r.acc)).toBe(true);
  });

  it("never lets the accumulator grow unboundedly", () => {
    let acc = 0;
    for (let i = 0; i < 1000; i++) {
      ({ acc } = stepAccumulator(acc, 1 / 60, 120));
    }
    expect(acc).toBeLessThanOrEqual(1);
  });
});

describe("SPECIES / ATTRACT_ROWS / PALETTE shape", () => {
  it("each has exactly SPECIES_COUNT entries", () => {
    expect(SPECIES.length).toBe(SPECIES_COUNT);
    expect(ATTRACT_ROWS.length).toBe(SPECIES_COUNT);
    expect(PALETTE.length).toBe(SPECIES_COUNT);
  });

  it("every attraction row has SPECIES_COUNT weights, own-species weight positive", () => {
    for (let k = 0; k < SPECIES_COUNT; k++) {
      const row = ATTRACT_ROWS[k];
      expect(row.length).toBe(SPECIES_COUNT);
      expect(row[k]).toBeGreaterThan(0);
    }
  });

  it("every species has finite, positive motion parameters", () => {
    for (const s of SPECIES) {
      expect(s.sensorAngleRad).toBeGreaterThan(0);
      expect(s.sensorDist).toBeGreaterThan(0);
      expect(s.rotationRad).toBeGreaterThan(0);
      expect(s.stepDist).toBeGreaterThan(0);
    }
  });

  it("every palette colour has channels in [0, 1]", () => {
    for (const c of PALETTE) {
      for (const channel of c) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("physarum2's auto settings reproduce their default at NEUTRAL", () => {
  it("every setting with an auto table resolves to spec.default when every dial sits at NEUTRAL", () => {
    const settings = physarum2Scene.settings ?? [];
    const withAuto = settings.filter((s) => s.auto);
    expect(withAuto.length).toBeGreaterThan(0);
    for (const spec of withAuto) {
      expect(computeAutoTarget(spec, NEUTRAL, 1)).toBe(spec.default);
    }
  });
});
