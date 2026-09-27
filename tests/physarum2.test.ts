import { describe, it, expect } from "vitest";
import {
  physarum2TrailSide,
  stepAccumulator,
  physarum2Scene,
  STRAINS,
  SPECIES_COUNT,
  ATTRACT_ROWS,
  TRAIL_SIDE_CAP,
  TRAIL_SIDE_MIN,
  AGENTS_PER_TEXEL,
  AGENT_MULTIPLIER,
  MAX_STEPS_PER_FRAME,
  hueRotateRGB,
  sensorSliderToDist,
  distToSensorSlider,
  turnSliderToDeg,
  degToTurnSlider,
  strideSliderToDist,
  distToStrideSlider,
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

describe("STRAINS / ATTRACT_ROWS shape", () => {
  it("STRAINS and ATTRACT_ROWS each have exactly SPECIES_COUNT entries", () => {
    expect(STRAINS.length).toBe(SPECIES_COUNT);
    expect(ATTRACT_ROWS.length).toBe(SPECIES_COUNT);
  });

  it("every attraction row has SPECIES_COUNT weights, own-strain weight positive", () => {
    for (let k = 0; k < SPECIES_COUNT; k++) {
      const row = ATTRACT_ROWS[k];
      expect(row.length).toBe(SPECIES_COUNT);
      expect(row[k]).toBeGreaterThan(0);
    }
  });

  it("every strain has a positive fixed sensor angle and a channel colour in [0, 1]", () => {
    for (const s of STRAINS) {
      expect(s.sensorAngleRad).toBeGreaterThan(0);
      for (const channel of s.color) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it("every strain has a unique, non-empty code", () => {
    const codes = STRAINS.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code.length).toBeGreaterThan(0);
  });
});

describe("hueRotateRGB", () => {
  it("returns the input unchanged (not just close) at shift 0", () => {
    const rgb: [number, number, number] = [1.0, 0.3, 0.28];
    expect(hueRotateRGB(rgb, 0)).toEqual(rgb);
  });

  it("wraps a full turn back to (approximately) the same colour", () => {
    const rgb: [number, number, number] = [0.05, 0.78, 0.7];
    const rotated = hueRotateRGB(rgb, 1);
    rotated.forEach((c, i) => expect(c).toBeCloseTo(rgb[i]!, 5));
  });

  it("actually shifts hue for a non-zero shift (channels reorder)", () => {
    const rgb: [number, number, number] = [1.0, 0.3, 0.28];
    const rotated = hueRotateRGB(rgb, 1 / 3);
    expect(rotated).not.toEqual(rgb);
  });
});

describe("per-strain settings", () => {
  const settings = physarum2Scene.settings ?? [];

  it("removed the old shared feed/beatSurge settings", () => {
    expect(settings.find((s) => s.key === "feed")).toBeUndefined();
    expect(settings.find((s) => s.key === "beatSurge")).toBeUndefined();
  });

  it("generates nutrient/excite/sensor/turn/stride/stain for every strain, tagged item family strain", () => {
    for (const param of ["nutrient", "excite", "sensor", "turn", "stride", "stain"]) {
      for (let k = 0; k < SPECIES_COUNT; k++) {
        const spec = settings.find((s) => s.key === `${param}${k}`);
        expect(spec, `missing ${param}${k}`).toBeDefined();
        expect(spec!.item).toEqual({ family: "strain", index: k, param });
      }
    }
  });

  it("generates a full att<i><j> affinity matrix defaulting to ATTRACT_ROWS, tagged with `other`", () => {
    for (let i = 0; i < SPECIES_COUNT; i++) {
      for (let j = 0; j < SPECIES_COUNT; j++) {
        const spec = settings.find((s) => s.key === `att${i}${j}`);
        expect(spec, `missing att${i}${j}`).toBeDefined();
        expect(spec!.default).toBe(ATTRACT_ROWS[i]![j]);
        expect(spec!.item).toEqual({ family: "strain", index: i, param: "att", other: j });
      }
    }
  });

  it("nutrient defaults to 0.6 and excite to 0.1 for every strain (the old shared defaults)", () => {
    for (let k = 0; k < SPECIES_COUNT; k++) {
      expect(settings.find((s) => s.key === `nutrient${k}`)!.default).toBe(0.6);
      expect(settings.find((s) => s.key === `excite${k}`)!.default).toBe(0.1);
    }
  });

  it("sensor/turn/stride defaults round-trip through the slider mapping to the old fixed motion", () => {
    // The scene's own motion before per-strain sliders existed — physarum2.ts's
    // own LEGACY_MOTION, duplicated here as the regression's expected values.
    const legacy = [
      { sensorDist: 30, turnDeg: 40, strideDist: 1.4 },
      { sensorDist: 12, turnDeg: 35, strideDist: 0.9 },
      { sensorDist: 45, turnDeg: 100, strideDist: 1.8 },
      { sensorDist: 5, turnDeg: 20, strideDist: 0.45 },
    ];
    for (let k = 0; k < SPECIES_COUNT; k++) {
      const sensorDefault = settings.find((s) => s.key === `sensor${k}`)!.default;
      const turnDefault = settings.find((s) => s.key === `turn${k}`)!.default;
      const strideDefault = settings.find((s) => s.key === `stride${k}`)!.default;
      expect(sensorSliderToDist(sensorDefault)).toBeCloseTo(legacy[k]!.sensorDist, 9);
      expect(turnSliderToDeg(turnDefault)).toBeCloseTo(legacy[k]!.turnDeg, 9);
      expect(strideSliderToDist(strideDefault)).toBeCloseTo(legacy[k]!.strideDist, 9);
      // And the inverse direction agrees with the forward one.
      expect(distToSensorSlider(legacy[k]!.sensorDist)).toBeCloseTo(sensorDefault, 9);
      expect(degToTurnSlider(legacy[k]!.turnDeg)).toBeCloseTo(turnDefault, 9);
      expect(distToStrideSlider(legacy[k]!.strideDist)).toBeCloseTo(strideDefault, 9);
    }
  });

  it("stain defaults to 0 for every strain (Stain's own colour, unshifted)", () => {
    for (let k = 0; k < SPECIES_COUNT; k++) {
      expect(settings.find((s) => s.key === `stain${k}`)!.default).toBe(0);
    }
  });

  it("has one Strains panel section over the itemBoxes widget, claiming family \"strain\"", () => {
    const panel = physarum2Scene.panel ?? [];
    expect(panel.length).toBe(1);
    expect(panel[0]!.widget).toBe("itemBoxes");
    expect(panel[0]!.items).toBe("strain");
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
