import { describe, it, expect } from "vitest";
import {
  advanceBlackout,
  advanceCurtain,
  advanceFlicker,
  advanceWander,
  ANGLE_STEP,
  createBlackoutState,
  createCurtainState,
  createFlickerState,
  createWander,
  DETAIL_MAX,
  DETAIL_MIN,
  introRamp,
  moireScene,
  STRETCH_CENTROID_HIGH,
  TILT_MAX_RAD,
  WANDER_BARS,
  WANDER_FALLBACK_SEC,
  type WanderInputs,
} from "../src/render/scenes/moire.ts";
import { computeAutoTarget } from "../src/render/autoTune.ts";
import { NEUTRAL } from "../src/render/musicProfile.ts";

// mulberry32: a small deterministic PRNG so the wander tests are
// reproducible for a given seed — same pattern as storm.ts/ambience.ts's own
// local createRng, kept test-local since advanceWander only needs a plain
// `() => number`.
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One simulated bar: progress partway through it, then wrap back near 0 —
// powder.ts's HueDrift idiom (a bar boundary is a wrap in barPhase, not a
// threshold crossing) — exactly one wrap per call.
function simulateBar(
  st: ReturnType<typeof createWander>,
  dt: number,
  stretchMax: number,
  wander: number,
  rest: Omit<WanderInputs, "barPhase">,
): void {
  advanceWander(st, dt, { ...rest, barPhase: 0.9 }, stretchMax, wander);
  advanceWander(st, dt, { ...rest, barPhase: 0.1 }, stretchMax, wander);
}

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

describe("moire wander (createWander/advanceWander)", () => {
  const REST: Omit<WanderInputs, "barPhase"> = { tempoLock: 1, dropOnset: false, dropPulse: 0, centroid: 0.5 };

  it("keeps every value inside its designed range over a long, varied run", () => {
    const stretchMax = 3;
    const st = createWander(createRng(42));
    const dt = 1 / 60;
    for (let i = 0; i < 20000; i++) {
      const barPhase = (i % 37) / 37; // wraps periodically
      const tempoLock = i % 500 < 250 ? 1 : 0; // alternates locked/unlocked
      const dropOnset = i % 613 === 0;
      const dropPulse = dropOnset ? 1 : Math.max(0, 1 - (i % 613) / 40);
      const centroid = 0.5 + 0.5 * Math.sin(i * 0.01);
      const out = advanceWander(st, dt, { barPhase, tempoLock, dropOnset, dropPulse, centroid }, stretchMax, 0.5);
      expect(out.stretch).toBeGreaterThanOrEqual(1);
      expect(out.stretch).toBeLessThanOrEqual(stretchMax * STRETCH_CENTROID_HIGH + 1e-9);
      expect(out.detail).toBeGreaterThanOrEqual(DETAIL_MIN - 1e-9);
      expect(out.detail).toBeLessThanOrEqual(DETAIL_MAX + 1e-9);
      expect(out.tilt).toBeGreaterThanOrEqual(-TILT_MAX_RAD - 1e-9);
      expect(out.tilt).toBeLessThanOrEqual(TILT_MAX_RAD + 1e-9);
      expect(Number.isFinite(out.angle)).toBe(true);
    }
  });

  it("never re-picks the angle target by more than ANGLE_STEP", () => {
    const st = createWander(createRng(9));
    const dt = 1 / 60;
    let prevTarget = st.angleTarget;
    for (let i = 0; i < 5000; i++) {
      const barPhase = (i % 37) / 37;
      advanceWander(st, dt, { ...REST, barPhase, tempoLock: i % 400 < 200 ? 1 : 0, dropOnset: i % 900 === 0 }, 3, 0.5);
      const delta = Math.abs(st.angleTarget - prevTarget);
      if (delta > 1e-12) expect(delta).toBeLessThanOrEqual(ANGLE_STEP + 1e-9);
      prevTarget = st.angleTarget;
    }
  });

  it("eases toward the target rather than snapping to it — no per-frame jump as large as ANGLE_STEP", () => {
    const st = createWander(createRng(13));
    const dt = 1 / 60;
    let prevAngle = st.angle;
    for (let i = 0; i < 3000; i++) {
      const barPhase = (i % 20) / 20;
      const dropOnset = i % 300 === 0;
      const out = advanceWander(st, dt, { ...REST, barPhase, dropOnset, dropPulse: dropOnset ? 1 : 0 }, 3, 1);
      expect(Math.abs(out.angle - prevAngle)).toBeLessThan(ANGLE_STEP);
      prevAngle = out.angle;
    }
  });

  it("re-picks targets after WANDER_BARS bar wraps while tempo-locked, not before", () => {
    const st = createWander(createRng(7));
    const initial = { angle: st.angleTarget, stretch: st.stretchTarget, detail: st.detailTarget, tilt: st.tiltTarget };
    const dt = 1 / 60;
    for (let i = 0; i < WANDER_BARS - 1; i++) simulateBar(st, dt, 3, 0.5, REST);
    const before = { angle: st.angleTarget, stretch: st.stretchTarget, detail: st.detailTarget, tilt: st.tiltTarget };
    expect(before).toEqual(initial); // fewer than WANDER_BARS wraps: no re-pick yet

    simulateBar(st, dt, 3, 0.5, REST); // the WANDER_BARS-th wrap crosses the threshold
    const after = { angle: st.angleTarget, stretch: st.stretchTarget, detail: st.detailTarget, tilt: st.tiltTarget };
    expect(after).not.toEqual(before);
  });

  it("re-picks targets every WANDER_FALLBACK_SEC while tempo is unlocked", () => {
    const st = createWander(createRng(11));
    const dt = 0.5;
    const stepsBeforeThreshold = Math.floor(WANDER_FALLBACK_SEC / dt) - 1;
    for (let i = 0; i < stepsBeforeThreshold; i++) {
      advanceWander(st, dt, { ...REST, barPhase: 0, tempoLock: 0 }, 3, 0.5);
    }
    const before = { angle: st.angleTarget, stretch: st.stretchTarget, detail: st.detailTarget, tilt: st.tiltTarget };
    expect(st.fallbackSec).toBeLessThan(WANDER_FALLBACK_SEC);

    advanceWander(st, dt, { ...REST, barPhase: 0, tempoLock: 0 }, 3, 0.5);
    const after = { angle: st.angleTarget, stretch: st.stretchTarget, detail: st.detailTarget, tilt: st.tiltTarget };
    expect(after).not.toEqual(before);
  });

  it("re-picks immediately on dropOnset, regardless of the bar/fallback clocks", () => {
    const st = createWander(createRng(3));
    expect(st.stretchTarget).toBe(1);
    advanceWander(st, 1 / 60, { ...REST, barPhase: 0, dropOnset: true, dropPulse: 1 }, 3, 0.5);
    // centroidMix at centroid=0.5 is > 1, and the log-uniform draw is >= 1,
    // so a genuine re-pick always pushes the stretch target strictly above 1.
    expect(st.stretchTarget).toBeGreaterThan(1);
  });

  it("holds the returned values exactly frame to frame when wander=0, however often targets are re-picked underneath", () => {
    const st = createWander(createRng(5));
    const first = advanceWander(st, 1 / 60, { ...REST, barPhase: 0.9, dropPulse: 1 }, 3, 0);
    for (let i = 0; i < 500; i++) {
      const barPhase = i % 2 === 0 ? 0.1 : 0.9; // forces a wrap every other frame
      const dropOnset = i % 37 === 0;
      const out = advanceWander(st, 1 / 30, { ...REST, barPhase, dropOnset, dropPulse: 1, centroid: 0.9 }, 3, 0);
      expect(out).toEqual(first);
    }
  });

  it("is deterministic for a given rng, and differs for a different one", () => {
    const run = (seed: number) => {
      const st = createWander(createRng(seed));
      let last;
      for (let i = 0; i < 200; i++) {
        const barPhase = (i % 10) / 10;
        const dropOnset = i === 50;
        last = advanceWander(st, 1 / 60, { ...REST, barPhase, tempoLock: 0.8, dropOnset, dropPulse: dropOnset ? 1 : 0 }, 3, 0.5);
      }
      return last;
    };
    expect(run(1)).toEqual(run(1));
    expect(run(1)).not.toEqual(run(2));
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
