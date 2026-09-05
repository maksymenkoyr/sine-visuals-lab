import { describe, it, expect } from "vitest";
import {
  getSceneSetting,
  setSceneSetting,
  resetSceneSettings,
  registerVariant,
  settingScope,
  settingDefault,
  currentVariant,
  variantFirst,
  type SceneSetting,
} from "../src/render/sceneSettings.ts";
import { isAutoEnabled, setAutoEnabled, computeAutoTarget } from "../src/render/autoTune.ts";
import { applyLook, captureLook } from "../src/render/sceneLooks.ts";
import { NEUTRAL } from "../src/render/musicProfile.ts";
import { listScenes } from "../src/render/scene.ts";
import "../src/render/scenes/index.ts";

// A scene's variant (SceneSetting.variant) gives every other setting one
// profile per option: its own stored value, auto/manual state and default.
// These pin the contract every store shares — sceneSettings.ts's values,
// autoTune.ts's exceptions, sceneLooks.ts's apply order — with a synthetic
// scene, then check the real scenes declare variants legally.

const STYLE: SceneSetting = {
  key: "style", label: "Style", type: "enum", options: ["Alpha", "Beta", "Gamma"],
  min: 0, max: 2, step: 1, default: 0, variant: true,
};
const SYMMETRY: SceneSetting = {
  key: "symmetry", label: "Symmetry", min: 2, max: 32, step: 2, default: 20,
  variantDefaults: { Beta: 6 },
};
const FLOW: SceneSetting = {
  key: "flow", label: "Flow", min: 0, max: 1, step: 0.05, default: 0.5, auto: { tempo: 0.3 },
};
const SPECS = [SYMMETRY, STYLE, FLOW];

function freshScene(name: string): string {
  const id = `variant-test-${name}`;
  registerVariant(id, SPECS);
  return id;
}

describe("variant profiles", () => {
  it("scopes every setting but the variant itself by the current option's name", () => {
    const id = freshScene("scope");
    expect(settingScope(id, STYLE.key)).toBe(id);
    expect(settingScope(id, SYMMETRY.key)).toBe(`${id}@Alpha`);
    setSceneSetting(id, STYLE, 2);
    expect(currentVariant(id)).toBe("Gamma");
    expect(settingScope(id, SYMMETRY.key)).toBe(`${id}@Gamma`);
  });

  it("a scene without a variant is scoped by its id alone", () => {
    const id = "variant-test-none";
    registerVariant(id, [SYMMETRY, FLOW]);
    expect(settingScope(id, SYMMETRY.key)).toBe(id);
    expect(settingDefault(id, SYMMETRY)).toBe(SYMMETRY.default);
  });

  it("keeps a value set under one option when another is selected, and restores it on return", () => {
    const id = freshScene("restore");
    setSceneSetting(id, SYMMETRY, 12);
    setSceneSetting(id, STYLE, 1);
    expect(getSceneSetting(id, SYMMETRY)).toBe(6); // Beta's own default, untouched by Alpha's 12
    setSceneSetting(id, SYMMETRY, 8);
    setSceneSetting(id, STYLE, 0);
    expect(getSceneSetting(id, SYMMETRY)).toBe(12);
    setSceneSetting(id, STYLE, 1);
    expect(getSceneSetting(id, SYMMETRY)).toBe(8);
  });

  it("resolves a per-variant default by option name, falling back to the spec default", () => {
    const id = freshScene("defaults");
    expect(settingDefault(id, SYMMETRY)).toBe(20);
    setSceneSetting(id, STYLE, 1);
    expect(settingDefault(id, SYMMETRY)).toBe(6);
    setSceneSetting(id, STYLE, 2);
    expect(settingDefault(id, SYMMETRY)).toBe(20);
    // The auto identity at NEUTRAL holds against the *scoped* default.
    expect(computeAutoTarget(FLOW, NEUTRAL, 1, 0.8)).toBe(0.8);
  });

  it("reset puts the variant back first, then the rest into the default option's profile", () => {
    const id = freshScene("reset");
    setSceneSetting(id, STYLE, 1);
    setSceneSetting(id, SYMMETRY, 10);
    resetSceneSettings(id, SPECS);
    expect(getSceneSetting(id, STYLE)).toBe(0);
    expect(getSceneSetting(id, SYMMETRY)).toBe(20);
    setSceneSetting(id, STYLE, 1);
    expect(getSceneSetting(id, SYMMETRY)).toBe(10); // Beta's profile was not the one reset
    expect(variantFirst(SPECS).map((s) => s.key)).toEqual(["style", "symmetry", "flow"]);
  });

  it("keeps auto/manual state per option", () => {
    const id = freshScene("auto");
    setAutoEnabled(id, FLOW.key, false);
    expect(isAutoEnabled(id, FLOW.key)).toBe(false);
    setSceneSetting(id, STYLE, 2);
    expect(isAutoEnabled(id, FLOW.key)).toBe(true);
    setSceneSetting(id, STYLE, 0);
    expect(isAutoEnabled(id, FLOW.key)).toBe(false);
  });

  it("applies a Look's variant before its other keys, so they land in that option's profile", () => {
    const id = freshScene("look");
    setSceneSetting(id, STYLE, 1);
    setSceneSetting(id, SYMMETRY, 14);
    setAutoEnabled(id, SYMMETRY.key, false);
    const look = captureLook("Beta fourteen", id, SPECS);
    expect(look.manual).toEqual({ style: 1, symmetry: 14 });
    resetSceneSettings(id, SPECS);
    setSceneSetting(id, STYLE, 2);
    applyLook(look, SPECS);
    expect(getSceneSetting(id, STYLE)).toBe(1);
    expect(getSceneSetting(id, SYMMETRY)).toBe(14);
    expect(settingScope(id, SYMMETRY.key)).toBe(`${id}@Beta`);
    // Gamma's profile was never written to.
    setSceneSetting(id, STYLE, 2);
    expect(getSceneSetting(id, SYMMETRY)).toBe(20);
  });
});

describe("registered scenes' variants", () => {
  it("a scene has at most one variant, and it is an enum", () => {
    for (const scene of listScenes()) {
      const variants = (scene.settings ?? []).filter((s) => s.variant);
      expect(variants.length, `${scene.id} marks ${variants.length} settings as its variant`).toBeLessThanOrEqual(1);
      for (const v of variants) expect(v.type, `${scene.id}'s variant "${v.key}" must be an enum`).toBe("enum");
    }
  });

  it("variantDefaults only appear in a scene with a variant, name real options, and stay in range", () => {
    for (const scene of listScenes()) {
      const specs = scene.settings ?? [];
      const variant = specs.find((s) => s.variant);
      for (const spec of specs) {
        if (!spec.variantDefaults) continue;
        expect(variant, `${scene.id}'s "${spec.key}" has variantDefaults but the scene has no variant`).toBeDefined();
        expect(spec.variant, `${scene.id}'s variant "${spec.key}" can't carry variantDefaults`).toBeFalsy();
        for (const [option, value] of Object.entries(spec.variantDefaults)) {
          expect(variant!.options, `${scene.id}'s "${spec.key}" names unknown option "${option}"`).toContain(option);
          expect(value, `${scene.id}'s "${spec.key}" default for ${option} is out of range`).toBeGreaterThanOrEqual(spec.min);
          expect(value, `${scene.id}'s "${spec.key}" default for ${option} is out of range`).toBeLessThanOrEqual(spec.max);
        }
      }
    }
  });
});
