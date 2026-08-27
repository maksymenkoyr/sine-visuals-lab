import { describe, it, expect } from "vitest";
import { createQualityGovernor } from "../src/render/governor.ts";
import type { TierSettings } from "../src/render/tier.ts";

function baseline(): TierSettings {
  return { tier: "mid", renderScale: 0.75, maxParticles: 50_000, raymarchSteps: 64, bloomPasses: 2, quality: 0.7 };
}

const TARGET_MS = 1000 / 60;

describe("createQualityGovernor", () => {
  it("does nothing on comfortable frame times", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;
    for (let i = 0; i < 300; i++) {
      t += TARGET_MS; // exactly on budget
      gov.recordFrame(t);
    }
    expect(gov.level).toBe(0);
    expect(tier.renderScale).toBeCloseTo(0.75, 6);
    expect(tier.raymarchSteps).toBe(64);
    expect(tier.quality).toBeCloseTo(0.7, 6);
  });

  it("steps quality down under sustained slow frames", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;
    // Well over budget (2x target) for far longer than the step-down streak
    // requirement, with no cooldown-driven gaps.
    for (let i = 0; i < 200; i++) {
      t += TARGET_MS * 2;
      gov.recordFrame(t);
    }
    expect(gov.level).toBeGreaterThan(0);
    expect(tier.renderScale).toBeLessThan(0.75);
    expect(tier.raymarchSteps).toBeLessThan(64);
    expect(tier.quality).toBeLessThan(0.7);
  });

  it("never mutates the tier label, only numeric knobs", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;
    for (let i = 0; i < 500; i++) {
      t += TARGET_MS * 2;
      gov.recordFrame(t);
    }
    expect(tier.tier).toBe("mid");
  });

  it("recovers after slow frames are followed by a long comfortable stretch", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;

    for (let i = 0; i < 200; i++) {
      t += TARGET_MS * 2;
      gov.recordFrame(t);
    }
    const droppedLevel = gov.level;
    expect(droppedLevel).toBeGreaterThan(0);

    // A long, genuinely comfortable stretch — long enough to clear both the
    // step-up streak requirement and any cooldown windows along the way.
    for (let i = 0; i < 5000; i++) {
      t += TARGET_MS * 0.5;
      gov.recordFrame(t);
    }
    expect(gov.level).toBeLessThan(droppedLevel);
  });

  it("does not oscillate: comfortable frames right after a step-down don't immediately step back up", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;

    for (let i = 0; i < 200; i++) {
      t += TARGET_MS * 2;
      gov.recordFrame(t);
    }
    const droppedLevel = gov.level;
    expect(droppedLevel).toBeGreaterThan(0);

    // Immediately comfortable afterward — but only briefly, well under the
    // step-up streak requirement and inside the cooldown window.
    for (let i = 0; i < 10; i++) {
      t += TARGET_MS * 0.5;
      gov.recordFrame(t);
    }
    expect(gov.level).toBe(droppedLevel); // hasn't bounced back yet
  });

  it("floors out rather than driving settings to zero/negative under extreme sustained load", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;
    for (let i = 0; i < 20000; i++) {
      t += TARGET_MS * 10;
      gov.recordFrame(t);
    }
    expect(tier.renderScale).toBeGreaterThan(0);
    expect(tier.raymarchSteps).toBeGreaterThan(0);
    expect(tier.quality).toBeGreaterThan(0);
  });
});
