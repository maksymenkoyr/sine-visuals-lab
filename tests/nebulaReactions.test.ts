// Nebula's music reactions (src/render/scenes/nebula/reactions.ts): Twinkle's slots and flash, the
// drop shock's front and burn, Colour tilt's lean, and every uniform bounded over a long session.

import { describe, it, expect } from "vitest";
import {
  advanceReactions,
  createReactions,
  igniteAmp,
  SHOCK_AHEAD,
  SHOCK_RMAX,
  shockAmp,
  shockUniforms,
  triggerShock,
  triggerTwinkle,
  twinkleUniforms,
} from "../src/render/scenes/nebula/reactions.ts";

const DT = 1 / 60;

function run(r: ReturnType<typeof createReactions>, sec: number, centroid = 0.5, lead = 0.5): void {
  for (let t = 0; t < sec - 1e-9; t += DT) advanceReactions(r, DT, lead, centroid);
}

describe("Nebula reactions", () => {
  it("is quiet before any hat or drop", () => {
    const r = createReactions();
    run(r, 1);
    const tw = twinkleUniforms(r);
    expect(tw[1]).toBe(0);
    expect(tw[3]).toBe(0);
    expect(shockAmp(r)).toBe(0);
    expect(igniteAmp(r)).toBe(0);
    for (const v of shockUniforms(r, [0, 0, 0])) expect(Number.isFinite(v)).toBe(true);
  });

  it("starts a drop ahead of the camera and grows its front, the burn outlasting it", () => {
    const r = createReactions();
    triggerShock(r, [1, 2, 3], [0, 0, 1]);
    const u = shockUniforms(r, [1, 2, 3]);
    expect([u[0], u[1], u[2]]).toEqual([0, 0, SHOCK_AHEAD]);
    let last = -1;
    let at1 = { shock: 0, ignite: 0 };
    for (let t = 0; t < 15.5; t += DT) {
      advanceReactions(r, DT, 0.5, 0.5);
      const radius = shockUniforms(r, [1, 2, 3])[3];
      expect(radius).toBeGreaterThanOrEqual(last);
      expect(radius).toBeLessThanOrEqual(SHOCK_RMAX);
      last = radius;
      if (Math.abs(r.shockAge - 1) < DT / 2) at1 = { shock: shockAmp(r), ignite: igniteAmp(r) };
      if (r.shockAge >= 6) expect(shockAmp(r)).toBe(0);
      if (r.shockAge >= 15) expect(igniteAmp(r)).toBe(0);
    }
    expect(at1.ignite).toBeGreaterThan(at1.shock);
  });

  it("puts each hat in the older slot with a fresh seed, and lets its flash fall away", () => {
    const r = createReactions();
    const seq = [0.1, 0.7, 0.3];
    let k = 0;
    const rand = () => seq[k++];
    triggerTwinkle(r, 1, rand);
    run(r, 0.05);
    triggerTwinkle(r, 1, rand);
    expect(r.twinkle[0].seed).not.toBe(r.twinkle[1].seed);
    const older = r.twinkle[0].age > r.twinkle[1].age ? 0 : 1;
    run(r, 0.05);
    triggerTwinkle(r, 1, rand);
    expect(r.twinkle[older].age).toBe(0);
    for (const s of r.twinkle) {
      expect(Number.isInteger(s.seed)).toBe(true);
      expect(s.seed).toBeGreaterThanOrEqual(0);
      expect(s.seed).toBeLessThan(65536);
    }

    const peakOf = (size: number) => {
      const q = createReactions();
      triggerTwinkle(q, size, () => 0.5);
      let peak = 0;
      let peakAt = 0;
      for (let t = 0; t < 0.5; t += DT) {
        advanceReactions(q, DT, 0.5, 0.5);
        const f = twinkleUniforms(q)[1];
        if (f > peak) {
          peak = f;
          peakAt = q.twinkle[0].age;
        }
      }
      return { peak, peakAt, end: twinkleUniforms(q)[1] };
    };
    const full = peakOf(1);
    const half = peakOf(0.5);
    expect(full.peakAt).toBeLessThan(0.1);
    expect(full.end).toBeLessThan(0.05);
    expect(half.peak).toBeCloseTo(full.peak / 2, 5);
  });

  it("leans warm below the centroid's running mean and cool above it", () => {
    const r = createReactions();
    run(r, 120, 0.5);
    expect(Math.abs(r.tilt)).toBeLessThan(0.01);
    run(r, 3, 0.3);
    expect(r.tilt).toBeGreaterThan(0.5);
    const cool = createReactions();
    run(cool, 120, 0.5);
    run(cool, 3, 0.7);
    expect(cool.tilt).toBeLessThan(-0.5);
    expect(Math.abs(r.tilt)).toBeLessThanOrEqual(1);
    expect(Math.abs(cool.tilt)).toBeLessThanOrEqual(1);
  });

  it("lights the inside with the lead, more as it rises above its usual level, and not at all in silence", () => {
    const quiet = createReactions();
    run(quiet, 60, 0.5, 0);
    expect(quiet.inner).toBe(0);
    const r = createReactions();
    run(r, 120, 0.5, 0.8);
    const usual = r.inner;
    expect(usual).toBeGreaterThan(0);
    expect(usual).toBeLessThan(0.8);
    run(r, 1, 0.5, 1);
    expect(r.inner).toBeGreaterThan(usual * 1.5);
    run(r, 60, 0.5, 0);
    expect(r.inner).toBeLessThan(0.01);
  });

  it("keeps every uniform bounded over a long session", () => {
    const r = createReactions();
    let nextHat = 0;
    let nextDrop = 0;
    const cam = [0, 0, 0];
    // Extremes, asserted once after the loop: an expect per frame ran past vitest's 5 s limit on CI.
    // A NaN carries through Math.min/max and fails the asserts below.
    let innerMin = Number.POSITIVE_INFINITY;
    let innerMax = Number.NEGATIVE_INFINITY;
    let seedMax = 0;
    let tiltMax = 0;
    let allFinite = true;
    for (let t = 0; t < 600; t += DT) {
      cam[2] = t * 0.22;
      if (t >= nextHat) {
        triggerTwinkle(r, 1);
        nextHat += 0.25;
      }
      if (t >= nextDrop) {
        triggerShock(r, cam, [0, 0, 1]);
        nextDrop += 8;
      }
      advanceReactions(r, DT, 0.8 + 0.2 * Math.sin(0.7 * t), 0.5 + 0.3 * Math.sin(t));
      innerMin = Math.min(innerMin, r.inner);
      innerMax = Math.max(innerMax, r.inner);
      for (const v of twinkleUniforms(r)) allFinite &&= Number.isFinite(v);
      for (const v of shockUniforms(r, cam)) allFinite &&= Number.isFinite(v);
      seedMax = Math.max(seedMax, r.twinkle[0].seed);
      tiltMax = Math.max(tiltMax, Math.abs(r.tilt));
    }
    expect(innerMin).toBeGreaterThanOrEqual(0);
    expect(innerMax).toBeLessThanOrEqual(1);
    expect(allFinite).toBe(true);
    expect(seedMax).toBeLessThan(65536);
    expect(tiltMax).toBeLessThanOrEqual(1);
  });
});
