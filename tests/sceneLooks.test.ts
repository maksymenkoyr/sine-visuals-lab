import { describe, it, expect } from "vitest";
import type { SceneSetting } from "../src/render/sceneSettings.ts";
import {
  getSceneSetting,
  getSceneSettingBeatOverride,
  getSceneSettingRate,
  setSceneSetting,
  setSceneSettingBeatOverride,
  setSceneSettingRate,
} from "../src/render/sceneSettings.ts";
import { isAutoEnabled, setAutoEnabled } from "../src/render/autoTune.ts";
import {
  applyLook,
  captureLook,
  decodeLook,
  deleteLook,
  encodeLook,
  listLooks,
  saveLook,
  type SceneLook,
} from "../src/render/sceneLooks.ts";

// Vitest runs under environment: "node" (vitest.config.ts) — no localStorage
// global at all, mirroring panelFolds.test.ts. Proves the module tolerates
// that; only cross-reload persistence depends on it.

const FOCUS: SceneSetting = { key: "focus", label: "Focus", min: 0, max: 1, step: 0.01, default: 0.5 };
const BREATHE: SceneSetting = {
  key: "breathe",
  label: "Breathe",
  min: 0,
  max: 1,
  step: 0.01,
  default: 0.3,
  rate: { kind: "phase", rest: 4 },
};
const FLASH: SceneSetting = {
  key: "flash",
  label: "Flash",
  min: 0,
  max: 1,
  step: 0.01,
  default: 0.6,
  rate: { kind: "override" },
};
const SPECS = [FOCUS, BREATHE, FLASH];

describe("encodeLook / decodeLook", () => {
  it("round-trips a look, including a non-ASCII name", () => {
    const look: SceneLook = {
      name: "Café Drift ✨",
      sceneId: "mesh",
      manual: { focus: 0.72, breathe: 0.1 },
      rates: {},
    };
    const decoded = decodeLook(encodeLook(look));
    expect(decoded).toEqual(look);
  });

  it("round-trips an empty manual set", () => {
    const look: SceneLook = { name: "Bare", sceneId: "mesh", manual: {}, rates: {} };
    expect(decodeLook(encodeLook(look))).toEqual(look);
  });

  it("round-trips a non-default beat rate and an override pin together", () => {
    const look: SceneLook = { name: "Slow", sceneId: "caustics", manual: {}, rates: { breathe: 8, flash: 3 } };
    expect(decodeLook(encodeLook(look))).toEqual(look);
  });

  it("decodes a v1 code with no `d` key at all as every setting at rest", () => {
    // A link handed out before settingBeatRate.ts existed — no `d` field,
    // not even an empty one. Must still decode, with `rates` coming back {}.
    const preRateCode = btoa(JSON.stringify({ v: 1, n: "Old link", s: "caustics", m: { focus: 0.6 } }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeLook(preRateCode)).toEqual({
      name: "Old link",
      sceneId: "caustics",
      manual: { focus: 0.6 },
      rates: {},
    });
  });

  it("returns null for garbage input", () => {
    expect(decodeLook("not-a-real-code")).toBeNull();
    expect(decodeLook("")).toBeNull();
  });

  it("returns null for a future schema version", () => {
    const futureCode = btoa(JSON.stringify({ v: 2, n: "x", s: "mesh", m: {} }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeLook(futureCode)).toBeNull();
  });

  it("returns null when a manual value isn't a finite number", () => {
    const badCode = btoa(JSON.stringify({ v: 1, n: "x", s: "mesh", m: { focus: "0.5" } }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeLook(badCode)).toBeNull();
  });

  it("returns null when a rate value isn't a finite number", () => {
    const badCode = btoa(JSON.stringify({ v: 1, n: "x", s: "mesh", m: {}, d: { breathe: "8" } }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeLook(badCode)).toBeNull();
  });

  it("decodes a rate value that isn't legal for its own spec, leaving clamping to the reader", () => {
    // `d` only checks "finite number" (see the module header) — a value
    // that isn't actually one of BEAT_RATES/BEAT_GRIDS still decodes; it's
    // getSceneSettingRate/getSceneSettingBeatOverride's job to fall back to
    // rest once the Look is actually applied (see the applyLook test below).
    const code = btoa(JSON.stringify({ v: 1, n: "x", s: "mesh", m: {}, d: { breathe: 3 } }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeLook(code)).toEqual({ name: "x", sceneId: "mesh", manual: {}, rates: { breathe: 3 } });
  });
});

describe("captureLook", () => {
  it("records only manual keys, skipping keys still on auto", () => {
    const sceneId = "look-capture-1";
    setAutoEnabled(sceneId, FOCUS.key, false);
    setSceneSetting(sceneId, FOCUS, 0.8);
    // breathe stays auto (isAutoEnabled defaults true for a key never set manual).
    const look = captureLook("Test", sceneId, SPECS);
    expect(look.manual).toEqual({ focus: 0.8 });
  });

  it("records only a phase setting's non-default rate", () => {
    const sceneId = "look-capture-2";
    setSceneSettingRate(sceneId, BREATHE, 8); // BREATHE rests at 4
    const look = captureLook("Test", sceneId, SPECS);
    expect(look.rates).toEqual({ breathe: 8 });
  });

  it("omits a phase setting left at its own rest rate", () => {
    const sceneId = "look-capture-3";
    setSceneSettingRate(sceneId, BREATHE, 4);
    const look = captureLook("Test", sceneId, SPECS);
    expect(look.rates).toEqual({});
  });

  it("records only an override setting's non-Scene pin", () => {
    const sceneId = "look-capture-4";
    setSceneSettingBeatOverride(sceneId, FLASH, 3);
    const look = captureLook("Test", sceneId, SPECS);
    expect(look.rates).toEqual({ flash: 3 });
  });

  it("omits an override setting left at Scene", () => {
    const sceneId = "look-capture-5";
    const look = captureLook("Test", sceneId, SPECS);
    expect(look.rates).toEqual({});
  });
});

describe("applyLook", () => {
  it("pins listed keys and returns unlisted keys to auto at default", () => {
    const sceneId = "look-apply-1";
    // Start with both manual, at non-default values.
    setAutoEnabled(sceneId, FOCUS.key, false);
    setSceneSetting(sceneId, FOCUS, 0.9);
    setAutoEnabled(sceneId, BREATHE.key, false);
    setSceneSetting(sceneId, BREATHE, 0.9);

    applyLook({ name: "L", sceneId, manual: { focus: 0.2 }, rates: {} }, SPECS);

    expect(isAutoEnabled(sceneId, FOCUS.key)).toBe(false);
    expect(getSceneSetting(sceneId, FOCUS)).toBeCloseTo(0.2);
    expect(isAutoEnabled(sceneId, BREATHE.key)).toBe(true);
    expect(getSceneSetting(sceneId, BREATHE)).toBeCloseTo(BREATHE.default);
  });

  it("sets a listed rate and returns an unlisted phase setting to rest", () => {
    const sceneId = "look-apply-2";
    setSceneSettingRate(sceneId, BREATHE, 2);

    applyLook({ name: "L", sceneId, manual: {}, rates: {} }, SPECS);

    expect(getSceneSettingRate(sceneId, BREATHE)).toBe(4);
  });

  it("applies a listed non-default rate", () => {
    const sceneId = "look-apply-3";
    applyLook({ name: "L", sceneId, manual: {}, rates: { breathe: 8 } }, SPECS);
    expect(getSceneSettingRate(sceneId, BREATHE)).toBe(8);
  });

  it("applies a listed override pin and returns an unlisted override to Scene", () => {
    const sceneId = "look-apply-4";
    setSceneSettingBeatOverride(sceneId, FLASH, 1);

    applyLook({ name: "L", sceneId, manual: {}, rates: { flash: 3 } }, SPECS);

    expect(getSceneSettingBeatOverride(sceneId, FLASH)).toBe(3);
  });

  it("clamps a decoded rate that isn't legal for its own spec back to rest", () => {
    const sceneId = "look-apply-5";
    applyLook({ name: "L", sceneId, manual: {}, rates: { breathe: 3 } }, SPECS);
    expect(getSceneSettingRate(sceneId, BREATHE)).toBe(4);
  });
});

describe("saveLook / listLooks / deleteLook", () => {
  it("saving an existing name replaces rather than duplicates", () => {
    const sceneId = "look-store-1";
    saveLook({ name: "A", sceneId, manual: { focus: 0.1 }, rates: {} });
    saveLook({ name: "A", sceneId, manual: { focus: 0.9 }, rates: {} });
    const looks = listLooks(sceneId);
    expect(looks).toHaveLength(1);
    expect(looks[0].manual.focus).toBe(0.9);
  });

  it("deletes by name without touching other looks or scenes", () => {
    const sceneId = "look-store-2";
    const otherScene = "look-store-2-other";
    saveLook({ name: "A", sceneId, manual: {}, rates: {} });
    saveLook({ name: "B", sceneId, manual: {}, rates: {} });
    saveLook({ name: "A", sceneId: otherScene, manual: {}, rates: {} });

    deleteLook(sceneId, "A");

    expect(listLooks(sceneId).map((l) => l.name)).toEqual(["B"]);
    expect(listLooks(otherScene).map((l) => l.name)).toEqual(["A"]);
  });
});
