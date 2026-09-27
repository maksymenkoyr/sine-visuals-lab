import { describe, it, expect } from "vitest";
import { composeSettings, defineItemPairs, defineItems } from "../src/render/sceneItems.ts";
import type { SceneSetting } from "../src/render/sceneSettings.ts";

describe("defineItems", () => {
  it("generates one setting per index, keyed <param.key><index>", () => {
    const specs = defineItems("strain", 4, { key: "nutrient", label: "Nutrient", min: 0, max: 1, step: 0.05, default: 0.6 });
    expect(specs.map((s) => s.key)).toEqual(["nutrient0", "nutrient1", "nutrient2", "nutrient3"]);
    for (const s of specs) {
      expect(s.label).toBe("Nutrient");
      expect(s.default).toBe(0.6);
    }
  });

  it("tags every generated setting with its family/index/param", () => {
    const specs = defineItems("strain", 3, { key: "sensor", label: "Sensor range", min: 0, max: 1, step: 0.05, default: 0.5 });
    specs.forEach((s, i) => {
      expect(s.item).toEqual({ family: "strain", index: i, param: "sensor" });
    });
  });

  it("resolves a per-index default via a function", () => {
    const defaults = [0.1, 0.2, 0.3];
    const specs = defineItems("strain", 3, {
      key: "turn",
      label: "Turn angle",
      min: 0,
      max: 1,
      step: 0.05,
      default: (i) => defaults[i]!,
    });
    expect(specs.map((s) => s.default)).toEqual(defaults);
  });

  it("resolves per-index drive.default/sceneLabel/sceneSources via functions, sharing the rest", () => {
    const bands = ["anim.low", "anim.mid", "anim.high", "anim.energy"] as const;
    const specs = defineItems("strain", 4, {
      key: "nutrient",
      label: "Nutrient",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.6,
      drive: {
        default: "scene",
        sceneLabel: (i) => `Scene: ${bands[i]} level`,
        sceneSources: (i) => [bands[i]!],
      },
    });
    specs.forEach((s, i) => {
      expect(s.drive?.default).toBe("scene");
      expect(s.drive?.sceneLabel).toBe(`Scene: ${bands[i]} level`);
      expect(s.drive?.sceneSources).toEqual([bands[i]]);
    });
  });

  it("shares a plain (non-function) drive.default across every index", () => {
    const specs = defineItems("strain", 4, {
      key: "excite",
      label: "Excitability",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.1,
      drive: { default: "feature.onset" },
    });
    for (const s of specs) expect(s.drive?.default).toBe("feature.onset");
  });
});

describe("defineItemPairs", () => {
  it("generates count*count settings keyed <param.key><i><j>, tagged with `other`", () => {
    const matrix = [
      [1, -1],
      [-1, 1],
    ];
    const specs = defineItemPairs("strain", 2, { key: "att", min: -1.5, max: 1.5, step: 0.05, default: matrix });
    expect(specs.map((s) => s.key)).toEqual(["att00", "att01", "att10", "att11"]);
    expect(specs.map((s) => s.default)).toEqual([1, -1, -1, 1]);
    for (const s of specs) {
      expect(s.item?.family).toBe("strain");
      expect(s.item?.param).toBe("att");
    }
    expect(specs.map((s) => [s.item?.index, s.item?.other])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
  });

  it("accepts a (i, j) => value function instead of a matrix", () => {
    const specs = defineItemPairs("strain", 2, { key: "att", min: -1.5, max: 1.5, step: 0.05, default: (i, j) => (i === j ? 1 : -1) });
    expect(specs.map((s) => s.default)).toEqual([1, -1, -1, 1]);
  });

  it("labels each pair via the (i, j) => string callback when given", () => {
    const codes = ["PP-A1", "PP-B2"];
    const specs = defineItemPairs("strain", 2, {
      key: "att",
      min: -1.5,
      max: 1.5,
      step: 0.05,
      default: () => 0,
      label: (i, j) => (i === j ? `${codes[i]} → own trail` : `${codes[i]} → ${codes[j]}`),
    });
    expect(specs.map((s) => s.label)).toEqual(["PP-A1 → own trail", "PP-A1 → PP-B2", "PP-B2 → PP-A1", "PP-B2 → own trail"]);
  });

  it("falls back to a generic label when none is given", () => {
    const specs = defineItemPairs("strain", 2, { key: "att", min: -1.5, max: 1.5, step: 0.05, default: () => 0 });
    expect(specs[1]!.label).toBe("strain 0→1");
  });
});

describe("composeSettings", () => {
  function spec(key: string, group?: SceneSetting["group"]): SceneSetting {
    return { key, label: key, min: 0, max: 1, step: 0.1, default: 0, group };
  }

  it("concatenates every list", () => {
    const a = [spec("a")];
    const b = [spec("b")];
    expect(composeSettings(a, b).map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("stable-sorts by SETTING_GROUPS order, preserving relative order within a group", () => {
    // Deliberately interleaved and out of SETTING_GROUPS order (Post before
    // Form, Motion split across two input lists) — composeSettings must
    // still produce one contiguous run per group, in Form/Motion/Look/
    // Camera/Post order, exactly like tests/settingGroups.test.ts requires
    // of a hand-written settings array.
    const items = [spec("nutrient0", "Form"), spec("nutrient1", "Form")];
    const globals = [spec("flash", "Post"), spec("speed", "Motion"), spec("scale", "Form"), spec("seed", "Motion")];
    const result = composeSettings(items, globals);
    expect(result.map((s) => s.key)).toEqual(["nutrient0", "nutrient1", "scale", "speed", "seed", "flash"]);
  });

  it("sorts an ungrouped setting before every grouped one", () => {
    const result = composeSettings([spec("grouped", "Post")], [spec("ungrouped")]);
    expect(result.map((s) => s.key)).toEqual(["ungrouped", "grouped"]);
  });
});
