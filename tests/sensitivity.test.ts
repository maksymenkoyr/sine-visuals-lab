import { describe, it, expect, afterEach, vi } from "vitest";
import {
  EXPANSION_DEFAULT,
  EXPANSION_MAX,
  EXPANSION_MIN,
  SENSITIVITY_DEFAULT,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  SMOOTHING_DEFAULT,
  SMOOTHING_MAX,
  SMOOTHING_MIN,
  applySensitivity,
  getExpansion,
  getSensitivity,
  getSmoothing,
  setExpansion,
  setSensitivity,
  setSmoothing,
  shapeExpansion,
  shapeLevel,
  smoothingRateScale,
} from "../src/audio/sensitivity.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";

function frame(bands: number[], energy: number): FeatureFrame {
  const arr = new Float32Array(NUM_BANDS);
  bands.forEach((v, i) => (arr[i] = v));
  return { time: 1.5, bands: arr, energy, beat: true, bpm: 120, beatPhase: 0.3, level: 0.6 };
}

describe("sensitivity persistence", () => {
  // vitest runs under environment: "node" (vitest.config.ts), so there is no
  // localStorage global at all here — this also proves the module tolerates that.
  it("returns the default for a scene that's never been set", () => {
    expect(getSensitivity("nonexistent-scene")).toBe(SENSITIVITY_DEFAULT);
  });

  it("clamps out-of-range values on set", () => {
    setSensitivity("clamp-test", 999);
    expect(getSensitivity("clamp-test")).toBe(SENSITIVITY_MAX);
    setSensitivity("clamp-test", -5);
    expect(getSensitivity("clamp-test")).toBe(SENSITIVITY_MIN);
  });
});

describe("expansion persistence", () => {
  it("returns the default for a scene that's never been set", () => {
    expect(getExpansion("nonexistent-scene")).toBe(EXPANSION_DEFAULT);
  });

  it("clamps out-of-range values on set", () => {
    setExpansion("clamp-test-expansion", 999);
    expect(getExpansion("clamp-test-expansion")).toBe(EXPANSION_MAX);
    setExpansion("clamp-test-expansion", -5);
    expect(getExpansion("clamp-test-expansion")).toBe(EXPANSION_MIN);
  });

  it("is independent of sensitivity's per-scene storage", () => {
    setSensitivity("shared-scene", 2);
    setExpansion("shared-scene", 3);
    expect(getSensitivity("shared-scene")).toBe(2);
    expect(getExpansion("shared-scene")).toBe(3);
  });
});

describe("smoothing persistence", () => {
  it("returns the default for a scene that's never been set", () => {
    expect(getSmoothing("nonexistent-scene")).toBe(SMOOTHING_DEFAULT);
  });

  it("clamps out-of-range values on set — floored at 0, not SMOOTHING_MIN", () => {
    setSmoothing("clamp-test-smoothing", 999);
    expect(getSmoothing("clamp-test-smoothing")).toBe(SMOOTHING_MAX);
    // Unlike sensitivity/expansion above, a negative value clamps to 0:
    // the store's own floor (see sensitivity.ts's comment on smoothingStore),
    // below SMOOTHING_MIN, so the Smoothing row's zeroAtMin Off stop
    // (deviceMenu.ts) is reachable and holds exactly.
    setSmoothing("clamp-test-smoothing", -5);
    expect(getSmoothing("clamp-test-smoothing")).toBe(0);
  });

  it("holds exactly 0 (the Off stop) rather than snapping to SMOOTHING_MIN", () => {
    setSmoothing("off-test-smoothing", 0);
    expect(getSmoothing("off-test-smoothing")).toBe(0);
    expect(smoothingRateScale(getSmoothing("off-test-smoothing"))).toBe(Infinity);
  });

  it("is independent of sensitivity's and expansion's per-scene storage", () => {
    setSensitivity("shared-scene-2", 2);
    setExpansion("shared-scene-2", 3);
    setSmoothing("shared-scene-2", 0.5);
    expect(getSensitivity("shared-scene-2")).toBe(2);
    expect(getExpansion("shared-scene-2")).toBe(3);
    expect(getSmoothing("shared-scene-2")).toBe(0.5);
  });
});

describe("smoothingRateScale", () => {
  it("is the identity at the default (1x)", () => {
    expect(smoothingRateScale(SMOOTHING_DEFAULT)).toBeCloseTo(1);
  });

  it("is linear on the slow half: 4x smoothing gives quarter rate", () => {
    expect(smoothingRateScale(SMOOTHING_MAX)).toBeCloseTo(0.25);
  });

  it("is square-rooted on the fast half: 0.25x smoothing gives 2x rate, not 4x", () => {
    expect(smoothingRateScale(SMOOTHING_MIN)).toBeCloseTo(2);
  });
});

describe("shapeLevel", () => {
  it("is fixed at 0 and 1 regardless of sensitivity", () => {
    for (const s of [SENSITIVITY_MIN, 1, 2, SENSITIVITY_MAX]) {
      expect(shapeLevel(0, s)).toBeCloseTo(0);
      expect(shapeLevel(1, s)).toBeCloseTo(1);
    }
  });

  it("is the identity at the default sensitivity", () => {
    for (const x of [0.1, 0.3, 0.7, 0.9]) {
      expect(shapeLevel(x, SENSITIVITY_DEFAULT)).toBeCloseTo(x);
    }
  });

  it("lifts mid-range values when sensitivity > 1", () => {
    expect(shapeLevel(0.3, 2)).toBeGreaterThan(0.3);
  });

  it("lowers mid-range values when sensitivity < 1", () => {
    expect(shapeLevel(0.3, 0.5)).toBeLessThan(0.3);
  });
});

describe("shapeExpansion", () => {
  it("is fixed at 0, 0.5, and 1 regardless of expansion", () => {
    for (const c of [EXPANSION_MIN, 1, 2, EXPANSION_MAX]) {
      expect(shapeExpansion(0, c)).toBeCloseTo(0);
      expect(shapeExpansion(0.5, c)).toBeCloseTo(0.5);
      expect(shapeExpansion(1, c)).toBeCloseTo(1);
    }
  });

  it("is the identity at the default expansion", () => {
    for (const x of [0.1, 0.3, 0.7, 0.9]) {
      expect(shapeExpansion(x, EXPANSION_DEFAULT)).toBeCloseTo(x);
    }
  });

  it("widens the gap above and below the midpoint when expansion > 1", () => {
    expect(shapeExpansion(0.7, 2)).toBeGreaterThan(0.7);
    expect(shapeExpansion(0.3, 2)).toBeLessThan(0.3);
  });

  it("narrows the gap above and below the midpoint when expansion < 1", () => {
    expect(shapeExpansion(0.7, 0.5)).toBeLessThan(0.7);
    expect(shapeExpansion(0.7, 0.5)).toBeGreaterThan(0.5);
    expect(shapeExpansion(0.3, 0.5)).toBeGreaterThan(0.3);
    expect(shapeExpansion(0.3, 0.5)).toBeLessThan(0.5);
  });

  it("stays within [0,1] at both extremes", () => {
    for (const c of [EXPANSION_MIN, EXPANSION_MAX]) {
      for (const x of [0.01, 0.3, 0.7, 0.99]) {
        const out = shapeExpansion(x, c);
        expect(out).toBeGreaterThanOrEqual(0);
        expect(out).toBeLessThanOrEqual(1);
      }
    }
  });

  it("has a bounded slope at the pivot, unlike the old power curve", () => {
    // The old pow-based curve had infinite slope at 0.5 — at high
    // expansion a level drifting 0.45 -> 0.55 would slam across most of
    // the range. The tanh curve's pivot step should stay well under that.
    const step = shapeExpansion(0.55, EXPANSION_MAX) - shapeExpansion(0.45, EXPANSION_MAX);
    expect(step).toBeLessThan(0.25);
  });

  it("eases into the ends: the step near 0/1 is smaller than the step at the pivot", () => {
    const pivotStep = shapeExpansion(0.55, EXPANSION_MAX) - shapeExpansion(0.5, EXPANSION_MAX);
    const endStep = shapeExpansion(1, EXPANSION_MAX) - shapeExpansion(0.95, EXPANSION_MAX);
    expect(endStep).toBeLessThan(pivotStep);
  });

  it("round-trips: expanding then compressing by the inverse factor recovers the input", () => {
    for (const x of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      expect(shapeExpansion(shapeExpansion(x, 2), 0.5)).toBeCloseTo(x, 5);
    }
  });
});

describe("applySensitivity", () => {
  it("is a no-op at both defaults (fast path, same object)", () => {
    const f = frame([0, 0.3, 0.7, 1], 0.5);
    const out = applySensitivity(f, SENSITIVITY_DEFAULT, EXPANSION_DEFAULT);
    expect(out).toBe(f);
  });

  it("leaves 0 and 1 as fixed points regardless of sensitivity or expansion", () => {
    const f = frame([0, 1], 0);
    for (const s of [SENSITIVITY_MIN, 2, SENSITIVITY_MAX]) {
      for (const c of [EXPANSION_MIN, 2, EXPANSION_MAX]) {
        const out = applySensitivity(f, s, c);
        expect(out.bands[0]).toBeCloseTo(0);
        expect(out.bands[1]).toBeCloseTo(1);
      }
    }
  });

  it("raises mid-range values when sensitivity > 1 (more reactive)", () => {
    const f = frame([0.3], 0.3);
    const out = applySensitivity(f, 2, EXPANSION_DEFAULT);
    expect(out.bands[0]).toBeGreaterThan(0.3);
    expect(out.energy).toBeGreaterThan(0.3);
  });

  it("lowers mid-range values when sensitivity < 1 (calmer)", () => {
    const f = frame([0.3], 0.3);
    const out = applySensitivity(f, 0.5, EXPANSION_DEFAULT);
    expect(out.bands[0]).toBeLessThan(0.3);
    expect(out.energy).toBeLessThan(0.3);
  });

  it("applies expansion on top of sensitivity, in that order", () => {
    const f = frame([0.7], 0.7);
    // bands is a reused scratch buffer (see applySensitivity), so read each
    // result's scalar before the next call overwrites it in place.
    const sensitivityOnlyBand = applySensitivity(f, 2, EXPANSION_DEFAULT).bands[0];
    const sensitivityOnlyEnergy = applySensitivity(f, 2, EXPANSION_DEFAULT).energy;
    const bothBand = applySensitivity(f, 2, 2).bands[0];
    const bothEnergy = applySensitivity(f, 2, 2).energy;
    // Expansion > 1 further widens whatever sensitivity already produced above the midpoint.
    expect(bothBand).toBeGreaterThan(sensitivityOnlyBand);
    expect(bothEnergy).toBeGreaterThan(sensitivityOnlyEnergy);
  });

  it("stays within [0,1] at both extremes", () => {
    const f = frame([0.01, 0.5, 0.99], 0.5);
    for (const s of [SENSITIVITY_MIN, SENSITIVITY_MAX]) {
      for (const c of [EXPANSION_MIN, EXPANSION_MAX]) {
        const out = applySensitivity(f, s, c);
        for (const b of out.bands) {
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(1);
        }
        expect(out.energy).toBeGreaterThanOrEqual(0);
        expect(out.energy).toBeLessThanOrEqual(1);
      }
    }
  });

  it("passes time/beat/bpm/beatPhase/level through unchanged", () => {
    const f = frame([0.3], 0.3);
    const out = applySensitivity(f, 2, 2);
    expect(out.time).toBe(f.time);
    expect(out.beat).toBe(f.beat);
    expect(out.bpm).toBe(f.bpm);
    expect(out.beatPhase).toBe(f.beatPhase);
    // level must stay raw — it's auto mode's own input signal (see
    // musicProfile.ts), so shaping it here would feed the gain stage its
    // own output.
    expect(out.level).toBe(f.level);
  });
});

describe("expansion store migration from the legacy vibe.dynamics key", () => {
  // The per-scene stores are created once at module load, seeded from
  // whatever localStorage holds at that moment — so exercising the
  // legacyKey migration means installing a fake localStorage with
  // "vibe.dynamics" data *before* a fresh import of the module, via
  // vi.resetModules(). Every other describe block in this file imports the
  // module statically and never touches localStorage, so this is isolated
  // to its own block rather than mixed into "expansion persistence".
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

  it("migrates a legacy vibe.dynamics value to vibe.expansion and removes the old key", async () => {
    const fake = makeFakeLocalStorage();
    fake.setItem("vibe.dynamics", JSON.stringify({ "scene-a": 2.5 }));
    (globalThis as { localStorage?: unknown }).localStorage = fake;

    vi.resetModules();
    const fresh = await import("../src/audio/sensitivity.ts");

    expect(fresh.getExpansion("scene-a")).toBe(2.5);
    expect(fake.raw.has("vibe.dynamics")).toBe(false);
    expect(JSON.parse(fake.raw.get("vibe.expansion")!)).toEqual({ "scene-a": 2.5 });
  });

  it("migrates the intermediate vibe.acceleration key, preferring it over an even older vibe.dynamics, and removes both", async () => {
    const fake = makeFakeLocalStorage();
    fake.setItem("vibe.dynamics", JSON.stringify({ "scene-a": 2.5 }));
    fake.setItem("vibe.acceleration", JSON.stringify({ "scene-a": 3 }));
    (globalThis as { localStorage?: unknown }).localStorage = fake;

    vi.resetModules();
    const fresh = await import("../src/audio/sensitivity.ts");

    expect(fresh.getExpansion("scene-a")).toBe(3);
    expect(fake.raw.has("vibe.acceleration")).toBe(false);
    expect(fake.raw.has("vibe.dynamics")).toBe(false);
    expect(JSON.parse(fake.raw.get("vibe.expansion")!)).toEqual({ "scene-a": 3 });
  });

  it("prefers an existing vibe.expansion value over a legacy one, and leaves the legacy key alone", async () => {
    const fake = makeFakeLocalStorage();
    fake.setItem("vibe.dynamics", JSON.stringify({ "scene-a": 2.5 }));
    fake.setItem("vibe.expansion", JSON.stringify({ "scene-a": 1.5 }));
    (globalThis as { localStorage?: unknown }).localStorage = fake;

    vi.resetModules();
    const fresh = await import("../src/audio/sensitivity.ts");

    expect(fresh.getExpansion("scene-a")).toBe(1.5);
    expect(fake.raw.has("vibe.dynamics")).toBe(true);
  });
});
