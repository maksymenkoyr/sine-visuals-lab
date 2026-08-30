import { describe, it, expect } from "vitest";
import type { SceneSetting } from "../src/render/sceneSettings.ts";
import { getSceneSetting, setSceneSetting } from "../src/render/sceneSettings.ts";
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
const BREATHE: SceneSetting = { key: "breathe", label: "Breathe", min: 0, max: 1, step: 0.01, default: 0.3 };
const SPECS = [FOCUS, BREATHE];

describe("encodeLook / decodeLook", () => {
  it("round-trips a look, including a non-ASCII name", () => {
    const look: SceneLook = { name: "Café Drift ✨", sceneId: "mesh", manual: { focus: 0.72, breathe: 0.1 } };
    const decoded = decodeLook(encodeLook(look));
    expect(decoded).toEqual(look);
  });

  it("round-trips an empty manual set", () => {
    const look: SceneLook = { name: "Bare", sceneId: "mesh", manual: {} };
    expect(decodeLook(encodeLook(look))).toEqual(look);
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
});

describe("applyLook", () => {
  it("pins listed keys and returns unlisted keys to auto at default", () => {
    const sceneId = "look-apply-1";
    // Start with both manual, at non-default values.
    setAutoEnabled(sceneId, FOCUS.key, false);
    setSceneSetting(sceneId, FOCUS, 0.9);
    setAutoEnabled(sceneId, BREATHE.key, false);
    setSceneSetting(sceneId, BREATHE, 0.9);

    applyLook({ name: "L", sceneId, manual: { focus: 0.2 } }, SPECS);

    expect(isAutoEnabled(sceneId, FOCUS.key)).toBe(false);
    expect(getSceneSetting(sceneId, FOCUS)).toBeCloseTo(0.2);
    expect(isAutoEnabled(sceneId, BREATHE.key)).toBe(true);
    expect(getSceneSetting(sceneId, BREATHE)).toBeCloseTo(BREATHE.default);
  });
});

describe("saveLook / listLooks / deleteLook", () => {
  it("saving an existing name replaces rather than duplicates", () => {
    const sceneId = "look-store-1";
    saveLook({ name: "A", sceneId, manual: { focus: 0.1 } });
    saveLook({ name: "A", sceneId, manual: { focus: 0.9 } });
    const looks = listLooks(sceneId);
    expect(looks).toHaveLength(1);
    expect(looks[0].manual.focus).toBe(0.9);
  });

  it("deletes by name without touching other looks or scenes", () => {
    const sceneId = "look-store-2";
    const otherScene = "look-store-2-other";
    saveLook({ name: "A", sceneId, manual: {} });
    saveLook({ name: "B", sceneId, manual: {} });
    saveLook({ name: "A", sceneId: otherScene, manual: {} });

    deleteLook(sceneId, "A");

    expect(listLooks(sceneId).map((l) => l.name)).toEqual(["B"]);
    expect(listLooks(otherScene).map((l) => l.name)).toEqual(["A"]);
  });
});
