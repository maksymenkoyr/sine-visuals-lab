import { describe, it, expect } from "vitest";
import { createQualityGovernor, type QualityGovernor } from "../src/render/governor.ts";
import type { TierSettings } from "../src/render/tier.ts";

function baseline(): TierSettings {
  return { tier: "mid", renderScale: 0.75, maxParticles: 50_000, raymarchSteps: 64, bloomPasses: 2, quality: 0.7 };
}

const TARGET_MS = 1000 / 60;

/** A synthetic device whose GPU work actually scales with the governor's
 *  current quality fraction — dt runs at `overMult` x target at level 0 and
 *  eases toward target at the floor. Needed wherever a test wants the
 *  governor's step-down probe to see genuine improvement (see governor.ts's
 *  "Authority probe"): a constant per-frame dt regardless of level is
 *  indistinguishable, from the governor's point of view, from a pace it has
 *  no authority over, and now correctly makes it stand down instead. */
function dtForLevel(gov: QualityGovernor, overMult: number): number {
  const fraction = 1 - gov.level / gov.maxLevel; // 1 at level 0, 0 at the floor
  return TARGET_MS * (1 + (overMult - 1) * fraction);
}

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

  it("steps quality down under sustained slow frames a cut actually fixes", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;
    // Well over budget at full quality, genuinely GPU-bound (dtForLevel eases
    // toward target as the governor cuts quality) — long enough to clear the
    // step-down streak, the probe's cooldown, and its evaluation.
    for (let i = 0; i < 200; i++) {
      t += dtForLevel(gov, 2);
      gov.recordFrame(t);
    }
    expect(gov.level).toBeGreaterThan(0);
    expect(gov.standingDown).toBe(false);
    expect(tier.renderScale).toBeLessThan(0.75);
    expect(tier.raymarchSteps).toBeLessThan(64);
    expect(tier.quality).toBeLessThan(0.7);
  });

  it("never mutates the tier label, only numeric knobs", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;
    for (let i = 0; i < 500; i++) {
      t += dtForLevel(gov, 2);
      gov.recordFrame(t);
    }
    expect(tier.tier).toBe("mid");
  });

  it("recovers after slow frames are followed by a long comfortable stretch", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;

    for (let i = 0; i < 200; i++) {
      t += dtForLevel(gov, 2);
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
      t += dtForLevel(gov, 2);
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

  // Regression coverage for the false-downgrade bug: a render-rate cap with
  // no gate tolerance turned ordinary rAF jitter on a healthy 60Hz display
  // into a stream of "skipped frame -> next frame reads 2x slower" samples,
  // which the old flat targetFrameMs budget misread as sustained overload.
  // framePace.ts's gate tolerance is what stops the skips from happening in
  // the first place; these tests cover the governor's own second line of
  // defense — budgeting against the fastest interval actually achieved,
  // rather than a flat target — in case a skip (or any other jitter source)
  // still occasionally slips through.

  it("a 60Hz cadence with ordinary rAF jitter never downgrades", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;
    // Deterministic pseudo-random jitter in [-3%, +3%] — small LCG so the
    // sequence is reproducible without pulling in a random source.
    let seed = 1;
    for (let i = 0; i < 600; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const jitter = (seed / 0x7fffffff) * 0.06 - 0.03;
      t += TARGET_MS * (1 + jitter);
      gov.recordFrame(t);
    }
    expect(gov.level).toBe(0);
  });

  it("a vsync-quantized cadence from a faster panel is not mistaken for load", () => {
    // 144Hz capped at 60fps renders every 3rd vsync (~1.25x target); 75Hz
    // renders every 2nd (~1.6x target). Neither is the GPU struggling.
    for (const mult of [1.25, 1.6]) {
      const tier = baseline();
      const gov = createQualityGovernor(tier, TARGET_MS);
      let t = 0;
      for (let i = 0; i < 600; i++) {
        t += TARGET_MS * mult;
        gov.recordFrame(t);
      }
      expect(gov.level).toBe(0);
    }
  });

  it("a multi-second gap with nothing rendering doesn't force a downgrade", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;
    for (let i = 0; i < 300; i++) {
      t += TARGET_MS;
      gov.recordFrame(t);
    }
    t += 5000; // e.g. a gallery<->viz round trip, or a backgrounded tab
    gov.recordFrame(t);
    for (let i = 0; i < 300; i++) {
      t += TARGET_MS;
      gov.recordFrame(t);
    }
    expect(gov.level).toBe(0);
  });

  it("a single pathological frame doesn't downgrade", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;
    for (let i = 0; i < 300; i++) {
      t += TARGET_MS;
      gov.recordFrame(t);
    }
    t += 400; // one genuinely slow frame (GC pause, tab-switch jank, ...)
    gov.recordFrame(t);
    for (let i = 0; i < 300; i++) {
      t += TARGET_MS;
      gov.recordFrame(t);
    }
    expect(gov.level).toBe(0);
  });

  it("a device uniformly 2.5x over budget (GPU-bound) still steps down", () => {
    // Guards against the achieved-interval budget (MAX_ACHIEVABLE_MULT)
    // becoming a blanket excuse — real, sustained, fixable overload must
    // still trip.
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;
    for (let i = 0; i < 200; i++) {
      t += dtForLevel(gov, 2.5);
      gov.recordFrame(t);
    }
    expect(gov.level).toBeGreaterThan(0);
    expect(gov.standingDown).toBe(false);
  });

  // Coverage for the Energy Saver bug this file's probe/standingDown
  // machinery exists to fix — see governor.ts's "Authority probe" comment.

  it("stands down instead of cutting quality when a step down buys nothing", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;
    // A constant ~2x-target interval regardless of quality level — the
    // signature of something outside the page setting the pace (e.g.
    // Chrome's Energy Saver halving the display refresh rate), not GPU load.
    for (let i = 0; i < 300; i++) {
      t += TARGET_MS * 2;
      gov.recordFrame(t);
    }
    expect(gov.standingDown).toBe(true);
    expect(gov.level).toBe(0);
    expect(tier.renderScale).toBeCloseTo(0.75, 6);
    expect(tier.raymarchSteps).toBe(64);
    expect(tier.quality).toBeCloseTo(0.7, 6);
  });

  it("re-arms and resumes stepping once the observed cadence actually shifts", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;
    for (let i = 0; i < 300; i++) {
      t += TARGET_MS * 2;
      gov.recordFrame(t);
    }
    expect(gov.standingDown).toBe(true);

    // The cadence itself changes — and this time it's genuinely GPU-bound,
    // so a cut helps. Covers both "the throttle lifted" and "the page got
    // heavier while still throttled": either way, only a cadence shift can
    // make a standing-down governor look again.
    for (let i = 0; i < 300; i++) {
      t += dtForLevel(gov, 4);
      gov.recordFrame(t);
    }
    expect(gov.standingDown).toBe(false);
    expect(gov.level).toBeGreaterThan(0);
  });

  it("setEnabled(false) pins quality to baseline and stops stepping", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;
    for (let i = 0; i < 200; i++) {
      t += dtForLevel(gov, 2);
      gov.recordFrame(t);
    }
    expect(gov.level).toBeGreaterThan(0);

    gov.setEnabled(false);
    expect(gov.level).toBe(0);
    expect(tier.renderScale).toBeCloseTo(0.75, 6);
    expect(tier.raymarchSteps).toBe(64);
    expect(tier.quality).toBeCloseTo(0.7, 6);

    // Still overloaded, but disabled — must not step while off.
    for (let i = 0; i < 200; i++) {
      t += TARGET_MS * 3;
      gov.recordFrame(t);
    }
    expect(gov.level).toBe(0);
    expect(tier.renderScale).toBeCloseTo(0.75, 6);
  });

  it("setEnabled(true) resets stale measurement so detection still works", () => {
    const tier = baseline();
    const gov = createQualityGovernor(tier, TARGET_MS);
    let t = 0;
    // Disable, then run a long, wildly different regime under it — this
    // must not poison ewmaMs/fastestMs for when it's re-enabled.
    gov.setEnabled(false);
    for (let i = 0; i < 500; i++) {
      t += TARGET_MS * 6;
      gov.recordFrame(t);
    }
    gov.setEnabled(true);

    for (let i = 0; i < 200; i++) {
      t += dtForLevel(gov, 2);
      gov.recordFrame(t);
    }
    expect(gov.level).toBeGreaterThan(0);
    expect(gov.standingDown).toBe(false);
  });
});
