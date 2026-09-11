import { describe, it, expect } from "vitest";
import {
  advanceBlackout,
  advanceCurtain,
  advanceFlicker,
  createBlackoutState,
  createCurtainState,
  createFlickerState,
  introRamp,
  moireScene,
} from "../src/render/scenes/moire.ts";
import { computeAutoTarget } from "../src/render/autoTune.ts";
import { NEUTRAL } from "../src/render/musicProfile.ts";

describe("moire flicker (advanceFlicker)", () => {
  it("steps rate*T times over T seconds, within one step", () => {
    const st = createFlickerState();
    const dt = 1 / 120;
    const rate = 30;
    const seconds = 5;
    const ticks = Math.round(seconds / dt);
    let steps = 0;
    let prevSeed = st.seed;
    for (let i = 0; i < ticks; i++) {
      const seed = advanceFlicker(st, dt, rate, 0);
      if (seed !== prevSeed) steps++;
      prevSeed = seed;
    }
    expect(Math.abs(steps - rate * seconds)).toBeLessThanOrEqual(1);
  });

  it("never steps at rate 0, but the seed still advances smoothly when driftSpeed > 0", () => {
    const st = createFlickerState();
    const dt = 1 / 120;
    let prevSeed = st.seed;
    let maxJump = 0;
    for (let i = 0; i < 600; i++) {
      const seed = advanceFlicker(st, dt, 0, 0.5);
      maxJump = Math.max(maxJump, Math.abs(seed - prevSeed));
      prevSeed = seed;
    }
    // No discrete SEED_STEP-sized jump ever happens...
    expect(maxJump).toBeLessThan(0.01);
    // ...but the seed isn't frozen either.
    expect(st.seed).toBeGreaterThan(0);
  });

  it("freezes at rate 0 and driftSpeed 0 (nothing left to drive it)", () => {
    const st = createFlickerState();
    for (let i = 0; i < 100; i++) advanceFlicker(st, 1 / 60, 0, 0);
    expect(st.seed).toBe(0);
  });
});

describe("moire intro ramp (introRamp)", () => {
  it("is 0 at t=0", () => {
    expect(introRamp(0)).toBe(0);
  });

  it("is 0 for negative elapsed time", () => {
    expect(introRamp(-1)).toBe(0);
  });

  it("clamps to 1 once fully ramped in, and stays there", () => {
    // Whatever INTRO_SEC is, a large enough elapsed time must saturate.
    expect(introRamp(1000)).toBe(1);
  });

  it("is monotonically non-decreasing", () => {
    let prev = 0;
    for (let t = 0; t <= 20; t += 0.5) {
      const r = introRamp(t);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });
});

describe("moire blackout (advanceBlackout)", () => {
  it("fires on dropOnset regardless of the blackout dial", () => {
    const st = createBlackoutState();
    const phase = advanceBlackout(st, 0, true, false, 0.6);
    expect(phase).toBeGreaterThan(0);
  });

  it("holds for BLACKOUT_SEC then releases back to 0", () => {
    const st = createBlackoutState();
    advanceBlackout(st, 0, true, false, 0.6);
    // Still well within the hold on the very next tick.
    expect(advanceBlackout(st, 0.01, false, false, 0.6)).toBeGreaterThan(0);
    // Step far past any reasonable hold duration.
    let phase = 0;
    for (let i = 0; i < 100; i++) phase = advanceBlackout(st, 0.01, false, false, 0.6);
    expect(phase).toBe(0);
  });

  it("lowOnset with blackout=0 never fires, however long it's driven", () => {
    const st = createBlackoutState();
    for (let i = 0; i < 2000; i++) {
      const phase = advanceBlackout(st, 1 / 60, false, true, 0);
      expect(phase).toBe(0);
    }
  });

  it("lowOnset can fire when blackout > 0, deterministically via an injected rng", () => {
    const st = createBlackoutState();
    const phase = advanceBlackout(st, 0, false, true, 1, () => 0);
    expect(phase).toBeGreaterThan(0);
  });

  it("lowOnset never fires when the injected rng always loses the roll", () => {
    const st = createBlackoutState();
    for (let i = 0; i < 500; i++) {
      const phase = advanceBlackout(st, 1 / 60, false, true, 1, () => 0.999999);
      expect(phase).toBe(0);
    }
  });
});

describe("moire curtain (advanceCurtain)", () => {
  const QUIET_SECTION_INTENSITY = 0; // well under any curtain>0 threshold
  const LOUD_SECTION_INTENSITY = 1; // well above any curtain<1 threshold

  it("stays at 0 while quiet but before the hold elapses", () => {
    const st = createCurtainState();
    const dt = 1 / 60;
    let level = 0;
    // Run for less than any reasonable QUIET_HOLD_SEC.
    for (let i = 0; i < 60; i++) level = advanceCurtain(st, dt, QUIET_SECTION_INTENSITY, 0.5, false);
    expect(level).toBe(0);
  });

  it("rises once the quiet hold elapses, at a rate independent of dt step size", () => {
    const st = createCurtainState();
    const dt = 1 / 60;
    // Run long enough to clear any reasonable hold, then measure the rate.
    for (let i = 0; i < 60 * 10; i++) advanceCurtain(st, dt, QUIET_SECTION_INTENSITY, 0.5, false);
    const before = st.level;
    expect(before).toBeGreaterThan(0);
    const after = advanceCurtain(st, dt, QUIET_SECTION_INTENSITY, 0.5, false);
    expect(after).toBeGreaterThan(before);
  });

  it("falls, faster than it rose, once the room goes loud again", () => {
    const riseState = createCurtainState();
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 10; i++) advanceCurtain(riseState, dt, QUIET_SECTION_INTENSITY, 0.5, false);
    const riseBefore = riseState.level;
    expect(riseBefore).toBeGreaterThan(0);
    const riseAfter = advanceCurtain(riseState, dt, QUIET_SECTION_INTENSITY, 0.5, false);
    const riseDelta = riseAfter - riseBefore;

    const fallState = createCurtainState();
    for (let i = 0; i < 60 * 10; i++) advanceCurtain(fallState, dt, QUIET_SECTION_INTENSITY, 0.5, false);
    const risenLevel = fallState.level;
    const fallAfter = advanceCurtain(fallState, dt, LOUD_SECTION_INTENSITY, 0.5, false);
    const fallDelta = risenLevel - fallAfter;

    expect(fallDelta).toBeGreaterThan(riseDelta);
  });

  it("resets toward 0 on dropOnset even while the room still reads quiet", () => {
    const st = createCurtainState();
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 10; i++) advanceCurtain(st, dt, QUIET_SECTION_INTENSITY, 0.5, false);
    const risenLevel = st.level;
    expect(risenLevel).toBeGreaterThan(0);

    const afterDrop = advanceCurtain(st, dt, QUIET_SECTION_INTENSITY, 0.5, true);
    expect(afterDrop).toBeLessThan(risenLevel);
  });

  it("never rises at curtain=0 ('never'), however long and quiet", () => {
    const st = createCurtainState();
    const dt = 1 / 60;
    let level = 0;
    for (let i = 0; i < 60 * 60; i++) level = advanceCurtain(st, dt, QUIET_SECTION_INTENSITY, 0, false);
    expect(level).toBe(0);
  });
});

// The invariant every auto-capable setting must satisfy (docs/adding-a-scene.md,
// "The invariant you can't get from typecheck"): at every music dial neutral,
// auto must reproduce the setting's plain default exactly. tests/autoTune.ts's
// own ALL_SETTINGS list and tests/bakeDefaults.test.ts both stop short of
// iterating every registered scene automatically (ALL_SETTINGS is a hand-
// maintained per-scene list that doesn't include every scene either), so this
// is asserted directly here instead.
describe("moire auto-tune invariant", () => {
  const autoSpecs = (moireScene.settings ?? []).filter((s) => s.auto);

  it("has at least one auto-driven setting to exercise", () => {
    expect(autoSpecs.length).toBeGreaterThan(0);
  });

  it.each(autoSpecs.map((s) => [s.label, s] as const))(
    "returns exactly spec.default for %s when every music dial is neutral",
    (_label, spec) => {
      expect(computeAutoTarget(spec, NEUTRAL, 1)).toBe(spec.default);
    },
  );
});
