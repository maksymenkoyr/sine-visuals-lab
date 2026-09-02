import { describe, it, expect, afterEach, vi } from "vitest";
import { causticsScene } from "../src/render/scenes/caustics.ts";
import { meshGridScene } from "../src/render/scenes/meshGrid.ts";
import { chladniScene } from "../src/render/scenes/chladni.ts";
import { dancersScene } from "../src/render/scenes/dancers/index.ts";
import { stormScene } from "../src/render/scenes/storm.ts";
import { setSceneSetting, type SceneSetting } from "../src/render/sceneSettings.ts";
import { setSensitivity, setExpansion, setSmoothing } from "../src/audio/sensitivity.ts";
import { NEUTRAL, type DialValues } from "../src/render/musicProfile.ts";
import {
  computeAutoTarget,
  computeMacroTarget,
  resolveSceneSetting,
  resolveSensitivity,
  resolveExpansion,
  resolveSmoothing,
  advanceAutoTune,
  isAutoEnabled,
  setAutoEnabled,
  isSceneAuto,
  setSceneAuto,
  setAutoStrength,
  seedAuto,
  getSensitivitySpec,
  getExpansionSpec,
  getSmoothingSpec,
  SENSITIVITY_AUTO_KEY,
  EXPANSION_AUTO_KEY,
  SMOOTHING_AUTO_KEY,
} from "../src/render/autoTune.ts";

const ALL_SETTINGS: SceneSetting[] = [
  ...(causticsScene.settings ?? []),
  ...(meshGridScene.settings ?? []),
  ...(chladniScene.settings ?? []),
  ...(dancersScene.settings ?? []),
  ...(stormScene.settings ?? []),
  getSensitivitySpec(),
  getExpansionSpec(),
  getSmoothingSpec(),
];

describe("computeAutoTarget", () => {
  // The load-bearing property the whole "safe to ship on by default" claim
  // rests on: at every dial neutral, auto must reproduce the plain default
  // bit-for-bit, for every real setting this pass ships weights for (every
  // caustics and mesh grid setting, plus Sensitivity, Expansion, and
  // Smoothing — see ALL_SETTINGS above).
  it.each(ALL_SETTINGS.map((s) => [s.label, s] as const))(
    "returns exactly spec.default for %s when every dial is neutral",
    (_label, spec) => {
      expect(computeAutoTarget(spec, NEUTRAL, 1)).toBe(spec.default);
    },
  );

  it("returns spec.default regardless of dials when strength is 0", () => {
    const spec = ALL_SETTINGS.find((s) => s.auto)!;
    const extreme: DialValues = { pulse: 1, tempo: 0, brightness: 1, density: 0, dynamics: 1, attack: 0, loudness: 1 };
    expect(computeAutoTarget(spec, extreme, 0)).toBe(spec.default);
  });

  // Regression test for why this whole change exists: a typical (near-
  // neutral) dial reading used to move a setting by well under one slider
  // step. computeAutoTarget shapes each dial through shapeExpansion before
  // weighting it, which must widen — not just preserve — that deviation for
  // a realistic, mid-range dial reading.
  it("widens the deviation for a near-neutral dial reading (the fix for auto barely moving anything)", () => {
    const spec: SceneSetting = { key: "w", label: "W", min: 0, max: 1, step: 0.05, default: 0.5, auto: { brightness: 0.35 } };
    // A small, realistic excursion — not a synthetic extreme.
    const target = computeAutoTarget(spec, { ...NEUTRAL, brightness: 0.55 }, 1);
    const naiveDeviation = 0.35 * (0.55 - 0.5); // what the old, unshaped formula would have produced
    expect(Math.abs(target - spec.default)).toBeGreaterThan(Math.abs(naiveDeviation) * 1.5);
  });

  it("stays within [min, max] for extreme dials at strength 2, including mesh grid's non-0..1 ranges", () => {
    const high: DialValues = { pulse: 1, tempo: 1, brightness: 1, density: 1, dynamics: 1, attack: 1, loudness: 1 };
    const low: DialValues = { pulse: 0, tempo: 0, brightness: 0, density: 0, dynamics: 0, attack: 0, loudness: 0 };
    for (const spec of ALL_SETTINGS) {
      for (const profile of [high, low]) {
        const v = computeAutoTarget(spec, profile, 2);
        expect(v).toBeGreaterThanOrEqual(spec.min);
        expect(v).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  it("raises the target when a positively-weighted dial rises", () => {
    const spec: SceneSetting = { key: "x", label: "X", min: 0, max: 2, step: 0.05, default: 1, auto: { brightness: 0.4 } };
    const low = computeAutoTarget(spec, { ...NEUTRAL, brightness: 0.1 }, 1);
    const high = computeAutoTarget(spec, { ...NEUTRAL, brightness: 0.9 }, 1);
    expect(high).toBeGreaterThan(low);
  });

  it("lowers the target when a negatively-weighted dial rises", () => {
    const spec: SceneSetting = { key: "y", label: "Y", min: 0, max: 2, step: 0.05, default: 1, auto: { brightness: -0.4 } };
    const low = computeAutoTarget(spec, { ...NEUTRAL, brightness: 0.1 }, 1);
    const high = computeAutoTarget(spec, { ...NEUTRAL, brightness: 0.9 }, 1);
    expect(high).toBeLessThan(low);
  });

  it("resolves to spec.default for a spec with no auto field", () => {
    const spec: SceneSetting = { key: "z", label: "Z", min: 0, max: 2, step: 0.05, default: 0.7 };
    const extreme: DialValues = { pulse: 1, tempo: 1, brightness: 1, density: 1, dynamics: 1, attack: 1, loudness: 1 };
    expect(computeAutoTarget(spec, extreme, 2)).toBe(spec.default);
  });
});

describe("computeMacroTarget", () => {
  const macroSpecs = ALL_SETTINGS.filter((s) => s.macro);

  it("has at least one real macro-driven setting to exercise (today: caustics' Sparkle sub-params)", () => {
    expect(macroSpecs.length).toBeGreaterThan(0);
  });

  // The load-bearing property behind "the sparkle macro ships as a visual
  // no-op": at the driver sitting on its own default (SPARKLE's 0.4, the
  // exact value nobody's touched anything yet), every real macro-driven
  // setting on every registered scene must reproduce its own plain default
  // bit-for-bit — same identity-at-rest contract computeAutoTarget has at
  // NEUTRAL dials, just anchored to a driver's default instead.
  it.each(macroSpecs.map((s) => [s.label, s] as const))(
    "returns exactly spec.default for %s when its driver sits at its own default",
    (_label, spec) => {
      expect(computeMacroTarget(spec, spec.macro!.driver.default)).toBe(spec.default);
    },
  );

  it("stays within [min, max] at the driver's extremes, for every real macro-driven setting", () => {
    for (const spec of macroSpecs) {
      const { driver } = spec.macro!;
      for (const driverValue of [driver.min, driver.max]) {
        const v = computeMacroTarget(spec, driverValue);
        expect(v).toBeGreaterThanOrEqual(spec.min);
        expect(v).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  it("raises the target when a positively-weighted driver rises", () => {
    const driver: SceneSetting = { key: "d", label: "D", min: 0, max: 1, step: 0.05, default: 0.5 };
    const spec: SceneSetting = { key: "p", label: "P", min: 0, max: 2, step: 0.05, default: 1, macro: { driver, weight: 0.4 } };
    const low = computeMacroTarget(spec, 0.1);
    const high = computeMacroTarget(spec, 0.9);
    expect(high).toBeGreaterThan(low);
  });

  it("lowers the target when a negatively-weighted driver rises", () => {
    const driver: SceneSetting = { key: "d", label: "D", min: 0, max: 1, step: 0.05, default: 0.5 };
    const spec: SceneSetting = { key: "n", label: "N", min: 0, max: 2, step: 0.05, default: 1, macro: { driver, weight: -0.4 } };
    const low = computeMacroTarget(spec, 0.1);
    const high = computeMacroTarget(spec, 0.9);
    expect(high).toBeLessThan(low);
  });

  it("stays flat regardless of the driver when weight is 0 (sparkleGrain's convention: independent of the master)", () => {
    const driver: SceneSetting = { key: "d", label: "D", min: 0, max: 1, step: 0.05, default: 0.5 };
    const spec: SceneSetting = { key: "f", label: "F", min: 0, max: 2, step: 0.05, default: 1, macro: { driver, weight: 0 } };
    expect(computeMacroTarget(spec, driver.min)).toBe(spec.default);
    expect(computeMacroTarget(spec, driver.max)).toBe(spec.default);
  });

  it("resolves to spec.default for a spec with no macro field", () => {
    const spec: SceneSetting = { key: "q", label: "Q", min: 0, max: 2, step: 0.05, default: 0.7 };
    expect(computeMacroTarget(spec, 999)).toBe(spec.default);
  });
});

const SPEC: SceneSetting = {
  key: "drift",
  label: "Drift",
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.5,
  auto: { tempo: 0.4 },
};

describe("auto state and resolution", () => {
  // Every test below uses its own sceneId — the exceptions map and slew
  // cache are both keyed by "sceneId/key", so distinct ids keep tests from
  // reading each other's leftover state (see tests/sceneSettings.test.ts).

  it("is auto by default for a param never touched", () => {
    expect(isAutoEnabled("scene-auto-1", "drift")).toBe(true);
  });

  it("setAutoEnabled(false) makes resolveSceneSetting return the manual stored value", () => {
    const sceneId = "scene-auto-2";
    setSceneSetting(sceneId, SPEC, 0.9);
    setAutoEnabled(sceneId, SPEC.key, false);
    advanceAutoTune(1, { ...NEUTRAL, tempo: 1 }); // would push well past 0.9 if this were auto
    expect(resolveSceneSetting(sceneId, SPEC)).toBeCloseTo(0.9);
  });

  it("setAutoEnabled(true) restores auto driving", () => {
    const sceneId = "scene-auto-3";
    setAutoEnabled(sceneId, SPEC.key, false);
    setAutoEnabled(sceneId, SPEC.key, true);
    expect(isAutoEnabled(sceneId, SPEC.key)).toBe(true);
  });

  it("a freshly-seen param resolves at its target immediately, with no glide-in", () => {
    const sceneId = "scene-auto-4";
    setAutoStrength(1);
    const highTempo: DialValues = { ...NEUTRAL, tempo: 1 };
    advanceAutoTune(1 / 60, highTempo);
    const target = computeAutoTarget(SPEC, highTempo, 1);
    expect(resolveSceneSetting(sceneId, SPEC)).toBeCloseTo(target, 5);
  });

  it("converges toward a new target over repeated per-tick advance+resolve calls", () => {
    const sceneId = "scene-auto-5";
    setAutoStrength(1);
    advanceAutoTune(1 / 60, NEUTRAL);
    const atDefault = resolveSceneSetting(sceneId, SPEC);
    expect(atDefault).toBeCloseTo(SPEC.default, 5);

    const highTempo: DialValues = { ...NEUTRAL, tempo: 1 };
    const target = computeAutoTarget(SPEC, highTempo, 1);

    advanceAutoTune(1 / 60, highTempo);
    const oneTickLater = resolveSceneSetting(sceneId, SPEC);
    expect(Math.abs(oneTickLater - target)).toBeGreaterThan(1e-4); // a single small tick shouldn't snap
    expect(oneTickLater).toBeGreaterThan(atDefault);

    let last = oneTickLater;
    for (let i = 0; i < 600; i++) {
      advanceAutoTune(1 / 10, highTempo);
      last = resolveSceneSetting(sceneId, SPEC);
    }
    expect(last).toBeCloseTo(target, 2);
  });

  it("isSceneAuto is true only while every auto-capable setting passed to it is auto", () => {
    const sceneId = "scene-auto-6";
    const specs = [SPEC, getSensitivitySpec(), getExpansionSpec(), getSmoothingSpec()];
    expect(isSceneAuto(sceneId, specs)).toBe(true);
    setAutoEnabled(sceneId, SPEC.key, false);
    expect(isSceneAuto(sceneId, specs)).toBe(false);
    setSceneAuto(sceneId, specs, true);
    expect(isSceneAuto(sceneId, specs)).toBe(true);
  });

  it("resolveSensitivity follows the same auto/manual split as scene settings", () => {
    const sceneId = "scene-auto-7";
    setAutoStrength(1);
    const extreme: DialValues = { ...NEUTRAL, dynamics: 1, density: 0 }; // positive deviation for both weights

    setAutoEnabled(sceneId, SENSITIVITY_AUTO_KEY, false);
    advanceAutoTune(1, extreme);
    const manualValue = resolveSensitivity(sceneId);

    setAutoEnabled(sceneId, SENSITIVITY_AUTO_KEY, true);
    seedAuto(sceneId, SENSITIVITY_AUTO_KEY, manualValue);
    advanceAutoTune(1, extreme);
    const autoValue = resolveSensitivity(sceneId);

    expect(autoValue).toBeGreaterThan(manualValue);
  });

  it("resolveExpansion is a full parallel to resolveSensitivity, including its opposite-signed weight", () => {
    const sceneId = "scene-auto-8";
    setAutoStrength(1);
    setExpansion(sceneId, 1); // manual store's default

    setAutoEnabled(sceneId, EXPANSION_AUTO_KEY, false);
    const manualValue = resolveExpansion(sceneId);

    const highDynamics: DialValues = { ...NEUTRAL, dynamics: 1 }; // Expansion's weight on the `dynamics` dial is negative
    setAutoEnabled(sceneId, EXPANSION_AUTO_KEY, true);
    seedAuto(sceneId, EXPANSION_AUTO_KEY, manualValue);
    advanceAutoTune(1, highDynamics);
    const autoValue = resolveExpansion(sceneId);

    // A track that's already dynamic should pull Expansion DOWN (less
    // artificial expansion), the opposite direction from Sensitivity's pull.
    expect(autoValue).toBeLessThan(manualValue);
  });

  it("resolveSmoothing pulls smoothing down (snappier) for a percussive track", () => {
    const sceneId = "scene-auto-10";
    setAutoStrength(1);
    setSmoothing(sceneId, 1); // manual store's default

    setAutoEnabled(sceneId, SMOOTHING_AUTO_KEY, false);
    const manualValue = resolveSmoothing(sceneId);

    const highAttack: DialValues = { ...NEUTRAL, attack: 1 }; // Smoothing's weight on `attack` is negative
    setAutoEnabled(sceneId, SMOOTHING_AUTO_KEY, true);
    seedAuto(sceneId, SMOOTHING_AUTO_KEY, manualValue);
    advanceAutoTune(1, highAttack);
    const autoValue = resolveSmoothing(sceneId);

    // A percussive track should pull Smoothing DOWN — snappier, not smoother.
    expect(autoValue).toBeLessThan(manualValue);
  });

  it("manual Sensitivity/Expansion/Smoothing stores are untouched by auto — resolve() only reads them, never writes", () => {
    const sceneId = "scene-auto-9";
    setSensitivity(sceneId, 2);
    setExpansion(sceneId, 2);
    setSmoothing(sceneId, 2);
    setAutoStrength(1);
    advanceAutoTune(1, { ...NEUTRAL, dynamics: 1, density: 0 });
    resolveSensitivity(sceneId);
    resolveExpansion(sceneId);
    resolveSmoothing(sceneId);
    // Auto resolution must never mutate the manual store — only reading it
    // when a param is manual, and only the device menu's explicit
    // onSensitivityChange/onExpansionChange/onSmoothingChange (app.ts)
    // should ever call setSensitivity/setExpansion/setSmoothing.
    setAutoEnabled(sceneId, SENSITIVITY_AUTO_KEY, false);
    setAutoEnabled(sceneId, EXPANSION_AUTO_KEY, false);
    setAutoEnabled(sceneId, SMOOTHING_AUTO_KEY, false);
    expect(resolveSensitivity(sceneId)).toBeCloseTo(2);
    expect(resolveExpansion(sceneId)).toBeCloseTo(2);
    expect(resolveSmoothing(sceneId)).toBeCloseTo(2);
  });
});

describe("auto-exception migration from the legacy @contrast key", () => {
  // vibe.sceneAuto's exceptions are loaded once at module load, same as the
  // per-scene value stores in sensitivity.ts — see that file's migration
  // test for why this needs vi.resetModules() plus a fresh dynamic import
  // rather than the statically-imported module used everywhere else above.
  function makeFakeLocalStorage() {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      raw: store,
    };
  }

  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
    vi.resetModules();
  });

  it("rewrites a scene's '@contrast' manual exception to '@expansion' and persists the rewrite", async () => {
    const fake = makeFakeLocalStorage();
    fake.setItem("vibe.sceneAuto", JSON.stringify({ "scene-a": { "@contrast": false, "@sensitivity": false } }));
    (globalThis as { localStorage?: unknown }).localStorage = fake;

    vi.resetModules();
    const fresh = await import("../src/render/autoTune.ts");

    // The old key must not still count as manual (it would silently flip
    // Expansion back to auto if left unmigrated), and the new key must.
    expect(fresh.isAutoEnabled("scene-a", "@contrast")).toBe(true);
    expect(fresh.isAutoEnabled("scene-a", fresh.EXPANSION_AUTO_KEY)).toBe(false);
    // Sensitivity's unrelated exception survives the rewrite untouched.
    expect(fresh.isAutoEnabled("scene-a", fresh.SENSITIVITY_AUTO_KEY)).toBe(false);

    const persisted = JSON.parse(fake.raw.get("vibe.sceneAuto")!);
    expect(persisted["scene-a"]).toEqual({ "@expansion": false, "@sensitivity": false });
  });

  it("rewrites the intermediate '@acceleration' key too, and a scene already on '@expansion' keeps its own value", async () => {
    const fake = makeFakeLocalStorage();
    fake.setItem(
      "vibe.sceneAuto",
      JSON.stringify({
        "scene-a": { "@acceleration": false },
        // Both present: the current key wins, the stale one is just dropped.
        "scene-b": { "@expansion": false, "@contrast": false },
      }),
    );
    (globalThis as { localStorage?: unknown }).localStorage = fake;

    vi.resetModules();
    const fresh = await import("../src/render/autoTune.ts");

    expect(fresh.isAutoEnabled("scene-a", "@acceleration")).toBe(true);
    expect(fresh.isAutoEnabled("scene-a", fresh.EXPANSION_AUTO_KEY)).toBe(false);
    expect(fresh.isAutoEnabled("scene-b", fresh.EXPANSION_AUTO_KEY)).toBe(false);

    const persisted = JSON.parse(fake.raw.get("vibe.sceneAuto")!);
    expect(persisted).toEqual({ "scene-a": { "@expansion": false }, "scene-b": { "@expansion": false } });
  });
});

describe("caustics Focus snap auto weights", () => {
  // Regression guard on the weight change in caustics.ts's `focus` spec.
  // The old weights ({ pulse: 0.35, attack: 0.25 }) resolved focus to ~0.90
  // on a steady percussive track and held it there for the whole track —
  // `pulse` alone floors near 0.92 once tempo locks (it's 60% tempoLock,
  // which saturates for almost any music with a steady beat), so this
  // wasn't a rare edge case. The caustics shader's resting sharpness floor
  // scales directly with uFocus (focusFloor = 0.35 * uFocus), so sitting
  // that close to 1 kept the *resting* state elevated for the whole track,
  // not just responding to individual beats. This asserts the new weights
  // keep the resolved value meaningfully below that ceiling.
  const focusSpec = causticsScene.settings!.find((s) => s.key === "focus")!;
  const steadyPercussive: DialValues = { ...NEUTRAL, pulse: 0.92, attack: 0.6 };

  it("stays inside the verified sharpness band on a steady percussive track", () => {
    expect(computeAutoTarget(focusSpec, steadyPercussive, 1)).toBeLessThanOrEqual(0.85);
  });

  it("stays bounded even at maximum Auto strength", () => {
    expect(computeAutoTarget(focusSpec, steadyPercussive, 2)).toBeLessThanOrEqual(0.95);
  });
});
