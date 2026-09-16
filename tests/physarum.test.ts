import { describe, it, expect } from "vitest";
import {
  trailSide,
  createBeatSeeder,
  attractorPositions,
  packUnit,
  unpackUnit,
  physarumScene,
  GROUP_COUNT,
  TRAIL_SIDE_CAP,
  TRAIL_SIDE_MIN,
  AGENTS_PER_TEXEL,
} from "../src/render/scenes/physarum.ts";
import { computeAutoTarget } from "../src/render/autoTune.ts";
import { NEUTRAL } from "../src/render/musicProfile.ts";
import { qualitySettings } from "../src/render/quality.ts";

describe("trailSide", () => {
  it("holds agent density per texel roughly constant across the quality presets' maxParticles", () => {
    for (const preset of ["high", "mid", "low", "floor"] as const) {
      const count = qualitySettings(preset).maxParticles;
      const side = trailSide(count, TRAIL_SIDE_CAP);
      const density = count / (side * side);
      expect(density).toBeCloseTo(AGENTS_PER_TEXEL, 1);
    }
  });

  it("clamps to [TRAIL_SIDE_MIN, maxSide]", () => {
    expect(trailSide(1, 1024)).toBeGreaterThanOrEqual(TRAIL_SIDE_MIN);
    expect(trailSide(10_000_000, 1024)).toBeLessThanOrEqual(1024);
    expect(trailSide(10_000_000, 10)).toBeLessThanOrEqual(10);
  });

  it("is always an integer, never 0, for a 0/negative/NaN count", () => {
    for (const count of [0, -5, NaN]) {
      const side = trailSide(count, TRAIL_SIDE_CAP);
      expect(Number.isInteger(side)).toBe(true);
      expect(side).toBeGreaterThan(0);
    }
  });

  it("is monotonically non-decreasing in agent count", () => {
    let prev = trailSide(1, TRAIL_SIDE_CAP);
    for (const count of [10, 100, 1000, 10_000, 100_000, 200_000]) {
      const side = trailSide(count, TRAIL_SIDE_CAP);
      expect(side).toBeGreaterThanOrEqual(prev);
      prev = side;
    }
  });
});

describe("createBeatSeeder", () => {
  it("starts at epoch 0 and steps on a pulse rise", () => {
    const seeder = createBeatSeeder();
    expect(seeder.epoch).toBe(0);
    const stepped = seeder.advance(1 / 60, 1.0, false);
    expect(stepped).toBe(true);
    expect(seeder.epoch).toBe(1);
  });

  it("does not step on a falling or flat pulse", () => {
    const seeder = createBeatSeeder();
    seeder.advance(1 / 60, 1.0, false);
    const epochAfterFirst = seeder.epoch;
    expect(seeder.advance(1 / 60, 1.0, false)).toBe(false);
    expect(seeder.advance(1, 0.5, false)).toBe(false);
    expect(seeder.epoch).toBe(epochAfterFirst);
  });

  it("does not step twice within the refractory window", () => {
    const seeder = createBeatSeeder();
    seeder.advance(1 / 1000, 0.5, false);
    const afterFirst = seeder.epoch;
    // A second rise a millisecond later, well inside the refractory.
    const stepped = seeder.advance(1 / 1000, 1.0, false);
    expect(stepped).toBe(false);
    expect(seeder.epoch).toBe(afterFirst);
  });

  it("steps again once the refractory has passed", () => {
    const seeder = createBeatSeeder();
    seeder.advance(1 / 60, 0.5, false);
    const first = seeder.epoch;
    seeder.advance(1, 0, false); // let the refractory clear
    const stepped = seeder.advance(1 / 60, 1.0, false);
    expect(stepped).toBe(true);
    expect(seeder.epoch).toBe(first + 1);
  });

  it("also steps on the one-shot onset flag, folded in as a bonus", () => {
    const seeder = createBeatSeeder();
    const stepped = seeder.advance(1 / 60, 0, true);
    expect(stepped).toBe(true);
    expect(seeder.epoch).toBe(1);
  });

  it("tolerates a 0 or NaN dt without throwing or advancing time incorrectly", () => {
    const seeder = createBeatSeeder();
    expect(() => seeder.advance(0, 1, false)).not.toThrow();
    expect(() => seeder.advance(NaN, 1, false)).not.toThrow();
    expect(Number.isFinite(seeder.epoch)).toBe(true);
  });
});

describe("attractorPositions", () => {
  it("writes one point per band group, all inside the unit square", () => {
    const out = new Float32Array(GROUP_COUNT * 2);
    for (let t = 0; t < 200; t += 1.7) {
      attractorPositions(t, out);
      for (let i = 0; i < GROUP_COUNT; i++) {
        expect(out[i * 2]).toBeGreaterThanOrEqual(0);
        expect(out[i * 2]).toBeLessThanOrEqual(1);
        expect(out[i * 2 + 1]).toBeGreaterThanOrEqual(0);
        expect(out[i * 2 + 1]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("never collapses two attractors onto the same point", () => {
    const out = new Float32Array(GROUP_COUNT * 2);
    for (let t = 0; t < 200; t += 1.7) {
      attractorPositions(t, out);
      for (let i = 0; i < GROUP_COUNT; i++) {
        for (let j = i + 1; j < GROUP_COUNT; j++) {
          const d = Math.hypot(out[i * 2] - out[j * 2], out[i * 2 + 1] - out[j * 2 + 1]);
          expect(d).toBeGreaterThan(0.01);
        }
      }
    }
  });

  it("is stable for the same tSec and moves as tSec advances", () => {
    const a = attractorPositions(3.1, new Float32Array(GROUP_COUNT * 2));
    const b = attractorPositions(3.1, new Float32Array(GROUP_COUNT * 2));
    expect(Array.from(a)).toEqual(Array.from(b));
    const c = attractorPositions(30, new Float32Array(GROUP_COUNT * 2));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it("survives a non-finite clock", () => {
    const out = attractorPositions(NaN, new Float32Array(GROUP_COUNT * 2));
    expect(Array.from(out).every(Number.isFinite)).toBe(true);
  });
});

describe("packUnit/unpackUnit round trip", () => {
  it("recovers a value to within a 16-bit step across the range", () => {
    for (const range of [1, Math.PI * 2, 4]) {
      const step = range / 65535;
      for (let f = 0; f <= 1; f += 0.013) {
        const v = f * range;
        const [hi, lo] = packUnit(v, range);
        const back = unpackUnit(hi, lo, range);
        expect(Math.abs(back - v)).toBeLessThanOrEqual(step / 2 + 1e-9);
      }
    }
  });

  it("clamps out-of-range and non-finite input rather than wrapping or throwing", () => {
    expect(unpackUnit(...packUnit(-5, 1), 1)).toBe(0);
    expect(unpackUnit(...packUnit(5, 1), 1)).toBe(1);
    expect(unpackUnit(...packUnit(NaN, 1), 1)).toBe(0);
  });

  it("both bytes stay in the [0, 255] range", () => {
    for (let f = 0; f <= 1; f += 0.05) {
      const [hi, lo] = packUnit(f * 4, 4);
      expect(hi).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(255);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(lo).toBeLessThanOrEqual(255);
    }
  });
});

describe("physarum's auto settings reproduce their default at NEUTRAL", () => {
  it("every setting with an auto table resolves to spec.default when every dial sits at NEUTRAL", () => {
    const settings = physarumScene.settings ?? [];
    const withAuto = settings.filter((s) => s.auto);
    expect(withAuto.length).toBeGreaterThan(0);
    for (const spec of withAuto) {
      expect(computeAutoTarget(spec, NEUTRAL, 1)).toBe(spec.default);
    }
  });
});
