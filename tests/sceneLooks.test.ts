import { describe, it, expect } from "vitest";
import type { SceneSetting } from "../src/render/sceneSettings.ts";
import { getSceneSetting, setSceneSetting } from "../src/render/sceneSettings.ts";
import { isAutoEnabled, setAutoEnabled } from "../src/render/autoTune.ts";
import { getDriveSetting, setDriveSetting } from "../src/render/driveStore.ts";
import { driveSettingFromChoice, type DriveSetting } from "../src/render/drives.ts";
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
const FLASH: SceneSetting = {
  key: "flash",
  label: "Flash",
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.6,
  drive: { default: "feature.onset" },
};
const SPECS = [FOCUS, BREATHE];
const SPECS_WITH_DRIVE = [FOCUS, BREATHE, FLASH];

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

  // `d` (SceneSetting.drive settings) is optional and additive — v stays 1.
  it("round-trips a look with drive settings (`d`), one-source patches included", () => {
    const look: SceneLook = {
      name: "Driven",
      sceneId: "caustics",
      manual: { focus: 0.4 },
      drives: { flash: driveSettingFromChoice("anim.lowOnset"), ripple: driveSettingFromChoice({ source: "beat", grid: 3 }) },
    };
    expect(decodeLook(encodeLook(look))).toEqual(look);
  });

  it("a one-source, weight-1, Graded patch encodes on the wire as the bare DriveChoice (old-app compatible)", () => {
    const look: SceneLook = { name: "D", sceneId: "caustics", manual: {}, drives: { flash: driveSettingFromChoice("anim.lowOnset") } };
    const code = encodeLook(look);
    const wire = JSON.parse(atob(code.replace(/-/g, "+").replace(/_/g, "/")));
    expect(wire.d).toEqual({ flash: "anim.lowOnset" });
  });

  it("a real multi-source patch round-trips as the compact {m,s} form", () => {
    const patch: DriveSetting = {
      mix: "gate",
      sources: [
        { choice: "anim.lowOnset", weight: 1.5, height: "fixed" },
        { choice: "anim.mid", weight: 0.7 },
      ],
    };
    const look: SceneLook = { name: "Gated", sceneId: "caustics", manual: {}, drives: { flash: patch } };
    const code = encodeLook(look);
    const wire = JSON.parse(atob(code.replace(/-/g, "+").replace(/_/g, "/")));
    expect(wire.d.flash).toEqual({
      m: "gate",
      s: [
        { c: "anim.lowOnset", w: 1.5, h: "fixed" },
        { c: "anim.mid", w: 0.7 },
      ],
    });
    expect(decodeLook(code)).toEqual(look);
  });

  it("a gate patch with several conditions and a muted source round-trips through a Look's own `d`", () => {
    const patch: DriveSetting = {
      mix: "gate",
      sources: [
        { choice: "anim.lowOnset", weight: 1 },
        { choice: "anim.mid", weight: 1, when: true },
        { choice: "anim.high", weight: 1, when: true, off: true },
      ],
    };
    const look: SceneLook = { name: "Gated when", sceneId: "caustics", manual: {}, drives: { flash: patch } };
    const code = encodeLook(look);
    const wire = JSON.parse(atob(code.replace(/-/g, "+").replace(/_/g, "/")));
    expect(wire.d.flash.s[1].g).toBe(1);
    expect(wire.d.flash.s[2]).toMatchObject({ g: 1, o: 1 });
    expect(decodeLook(code)).toEqual(look);
  });

  it("an old look with no `d` at all still round-trips (the field is simply absent, not empty)", () => {
    const look: SceneLook = { name: "Old", sceneId: "mesh", manual: { focus: 0.3 } };
    const code = encodeLook(look);
    expect(JSON.parse(atob(code.replace(/-/g, "+").replace(/_/g, "/"))).d).toBeUndefined();
    expect(decodeLook(code)).toEqual(look);
  });

  it("returns null for a garbage drive setting inside `d`", () => {
    const badCode = btoa(JSON.stringify({ v: 1, n: "x", s: "mesh", m: {}, d: { flash: { source: "not-real" } } }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeLook(badCode)).toBeNull();
  });

  it("returns null for a compact patch with a garbage mix or a malformed source", () => {
    const badMix = btoa(JSON.stringify({ v: 1, n: "x", s: "mesh", m: {}, d: { flash: { m: "nonsense", s: [{ c: "anim.mid" }] } } }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeLook(badMix)).toBeNull();

    const badSource = btoa(JSON.stringify({ v: 1, n: "x", s: "mesh", m: {}, d: { flash: { m: "add", s: [{ c: "anim.mid", h: "wrong" }] } } }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeLook(badSource)).toBeNull();
  });
});

describe("captureLook", () => {
  it("records only manual keys, skipping keys switched to auto", () => {
    const sceneId = "look-capture-1";
    // focus is manual by default (never touched) — no call needed to make it so.
    setSceneSetting(sceneId, FOCUS, 0.8);
    // breathe is explicitly switched to auto, so captureLook leaves it out.
    setAutoEnabled(sceneId, BREATHE.key, true);
    const look = captureLook("Test", sceneId, SPECS);
    expect(look.manual).toEqual({ focus: 0.8 });
  });

  it("captures a drive setting's choice only when it isn't already the default", () => {
    const sceneId = "look-capture-2";
    const look = captureLook("Test", sceneId, SPECS_WITH_DRIVE);
    expect(look.drives).toBeUndefined(); // flash is still at its default (feature.onset)

    setDriveSetting(sceneId, FLASH, driveSettingFromChoice("anim.lowOnset"));
    const look2 = captureLook("Test", sceneId, SPECS_WITH_DRIVE);
    expect(look2.drives).toEqual({ flash: driveSettingFromChoice("anim.lowOnset") });
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

  it("sets a listed drive choice and resets an unlisted one back to its default", () => {
    const sceneId = "look-apply-2";
    setDriveSetting(sceneId, FLASH, driveSettingFromChoice("anim.highOnset"));

    applyLook({ name: "L", sceneId, manual: {}, drives: { flash: driveSettingFromChoice("anim.lowOnset") } }, SPECS_WITH_DRIVE);
    expect(getDriveSetting(sceneId, FLASH)).toEqual(driveSettingFromChoice("anim.lowOnset"));

    applyLook({ name: "L2", sceneId, manual: {} }, SPECS_WITH_DRIVE);
    expect(getDriveSetting(sceneId, FLASH)).toEqual(driveSettingFromChoice("feature.onset"));
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
