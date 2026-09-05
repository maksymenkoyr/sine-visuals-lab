import { describe, it, expect } from "vitest";
import { SETTING_GROUPS } from "../src/render/sceneSettings.ts";
import { listScenes } from "../src/render/scene.ts";
// Side-effect import: registers every scene (src/render/scenes/index.ts's
// own header comment) so listScenes() below sees the full set, not just
// whichever scene another test file happened to import first.
import "../src/render/scenes/index.ts";

describe("scene setting groups", () => {
  it("every scene groups all its settings, or none", () => {
    // renderSceneSettings() (deviceMenu.ts) renders an ungrouped setting
    // under whatever heading came before it with no visual cue — a scene
    // that mixes grouped and ungrouped settings would silently misfile some
    // of them under the wrong heading.
    for (const scene of listScenes()) {
      const specs = scene.settings ?? [];
      if (specs.length === 0) continue;
      const groupedCount = specs.filter((s) => s.group !== undefined).length;
      expect(
        groupedCount === 0 || groupedCount === specs.length,
        `${scene.id} groups ${groupedCount}/${specs.length} of its settings — all or none`,
      ).toBe(true);
    }
  });

  it("each scene's groups form one contiguous run per group, in SETTING_GROUPS order", () => {
    // Rendering is positional (deviceMenu.ts's renderSceneSettings): a group
    // heading appears every time spec.group changes from the last one seen.
    // A non-contiguous group (or one out of SETTING_GROUPS order) would
    // silently render as two separate headings, or headings out of the
    // canonical Form/Motion/Look/Camera/Post order.
    for (const scene of listScenes()) {
      const specs = scene.settings ?? [];
      const seen: string[] = [];
      let last: string | undefined;
      for (const spec of specs) {
        if (spec.group === undefined) continue;
        expect(
          SETTING_GROUPS.includes(spec.group),
          `${scene.id}'s "${spec.key}" setting has unknown group "${spec.group}"`,
        ).toBe(true);
        if (spec.group !== last) {
          expect(
            seen.includes(spec.group),
            `${scene.id}'s "${spec.group}" group is split into more than one run`,
          ).toBe(false);
          seen.push(spec.group);
          last = spec.group;
        }
      }
      const order = seen.map((g) => SETTING_GROUPS.indexOf(g as (typeof SETTING_GROUPS)[number]));
      const sorted = [...order].sort((a, b) => a - b);
      expect(order, `${scene.id}'s groups are out of SETTING_GROUPS order: ${seen.join(", ")}`).toEqual(sorted);
    }
  });

  it("at most one advanced run per group", () => {
    // The advanced-section fold id (deviceMenu.ts's createAdvancedSection
    // call) is keyed by (sceneId, group) only, and its row-count loop scans
    // past group boundaries — a second advanced run inside the same group
    // would collide on that fold id and misreport its own count.
    for (const scene of listScenes()) {
      const specs = scene.settings ?? [];
      let lastGroup: string | undefined;
      let inAdvancedRun = false;
      const advancedGroupsSeen = new Set<string | undefined>();
      for (const spec of specs) {
        if (spec.group !== lastGroup) {
          lastGroup = spec.group;
          inAdvancedRun = false;
        }
        if (spec.advanced) {
          if (!inAdvancedRun) {
            expect(
              advancedGroupsSeen.has(spec.group),
              `${scene.id}'s "${spec.group}" group has more than one advanced run`,
            ).toBe(false);
            advancedGroupsSeen.add(spec.group);
            inAdvancedRun = true;
          }
        } else {
          inAdvancedRun = false;
        }
      }
    }
  });
});
