import { describe, it, expect } from "vitest";
import {
  particleTextureSide,
  encode16,
  decode16,
  seedState,
  pointGain,
  REFERENCE_PARTICLES,
} from "../src/render/scenes/plume.ts";
import { qualitySettings } from "../src/render/quality.ts";

describe("particle texture sizing", () => {
  it.each(["high", "mid", "low", "floor"] as const)("side^2 holds every particle at quality %s", (preset) => {
    const count = qualitySettings(preset).maxParticles;
    const side = particleTextureSide(count);
    expect(side * side).toBeGreaterThanOrEqual(count);
  });
});

describe("encode16 / decode16 round-trip", () => {
  it("round-trips exactly at 0, 0.5 and 1", () => {
    for (const v of [0, 0.5, 1]) {
      const [hi, lo] = encode16(v);
      expect(decode16(hi, lo)).toBeCloseTo(v, 4);
    }
  });

  it("round-trips randoms within 1/65535", () => {
    for (let i = 0; i < 20; i++) {
      const v = Math.random();
      const [hi, lo] = encode16(v);
      expect(Math.abs(decode16(hi, lo) - v)).toBeLessThanOrEqual(1 / 65535 + 1e-9);
    }
  });

  it("stays inside the byte range", () => {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const [hi, lo] = encode16(v);
      expect(hi).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(255);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(lo).toBeLessThanOrEqual(255);
    }
  });
});

describe("seedState", () => {
  // Mirrors PLUME_GLSL's mapPos/mapVel inverses so the test can decode the
  // raw seed bytes without importing anything GLSL-only.
  const WORLD_HALF = 1.0;
  const VEL_MAX = 4.0;
  const SEED_RADIUS = 0.35;
  function unmapPos(u: number): number {
    return (u - 0.5) * 2 * WORLD_HALF;
  }
  function unmapVel(u: number): number {
    return (u - 0.5) * 2 * VEL_MAX;
  }

  it("decodes to positions inside the seed sphere and velocities ~= 0", () => {
    const side = 8;
    const { tex0, tex1, tex2 } = seedState(side);
    const n = side * side;
    expect(tex0.length).toBe(n * 4);
    expect(tex1.length).toBe(n * 4);
    expect(tex2.length).toBe(n * 4);

    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const px = unmapPos(decode16(tex0[o], tex0[o + 1]));
      const py = unmapPos(decode16(tex0[o + 2], tex0[o + 3]));
      const pz = unmapPos(decode16(tex1[o], tex1[o + 1]));
      const vx = unmapVel(decode16(tex1[o + 2], tex1[o + 3]));
      const vy = unmapVel(decode16(tex2[o], tex2[o + 1]));
      const vz = unmapVel(decode16(tex2[o + 2], tex2[o + 3]));

      const r = Math.sqrt(px * px + py * py + pz * pz);
      expect(r).toBeLessThanOrEqual(SEED_RADIUS + 1e-3);
      expect(vx).toBeCloseTo(0, 3);
      expect(vy).toBeCloseTo(0, 3);
      expect(vz).toBeCloseTo(0, 3);
    }
  });
});

describe("pointGain", () => {
  it("is 1 at the reference count", () => {
    expect(pointGain(REFERENCE_PARTICLES)).toBeCloseTo(1, 10);
  });

  it("is non-increasing as count rises", () => {
    const counts = [4_000, 12_000, 50_000, 200_000, 1_000_000];
    let prev = pointGain(counts[0]);
    for (let i = 1; i < counts.length; i++) {
      const g = pointGain(counts[i]);
      expect(g).toBeLessThanOrEqual(prev);
      prev = g;
    }
  });

  it("stays within [0.5, 6] for every quality preset", () => {
    for (const preset of ["high", "mid", "low", "floor"] as const) {
      const g = pointGain(qualitySettings(preset).maxParticles);
      expect(g).toBeGreaterThanOrEqual(0.5);
      expect(g).toBeLessThanOrEqual(6);
    }
  });
});
