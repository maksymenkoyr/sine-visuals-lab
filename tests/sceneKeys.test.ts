import { describe, it, expect } from "vitest";
import { listScenes } from "../src/render/scene.ts";
// Side-effect imports: registers every built-in scene and every built-in
// widget, so this test sees the full set regardless of import order
// elsewhere (mirrors settingGroups.test.ts's own comment).
import "../src/render/scenes/index.ts";
import "../src/ui/widgets/index.ts";
import { settingUniformName } from "../src/render/sceneCommon.ts";
import { getWidget } from "../src/ui/widgets/registry.ts";

// The uniform name is "u" + key[0].toUpperCase() + key.slice(1)
// (sceneCommon.ts's settingUniformName) — a valid GLSL identifier requires
// only that every character be a word character; the leading "u" already
// guarantees a legal identifier *start* regardless of what `key` itself
// begins with.
const KEY_CHARS = /^[A-Za-z0-9_]+$/;

describe("scene setting keys", () => {
  for (const scene of listScenes()) {
    const specs = scene.settings ?? [];
    if (specs.length === 0) continue;

    describe(scene.id, () => {
      it("has unique setting keys", () => {
        const keys = specs.map((s) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
      });

      it("every key is a valid GLSL identifier tail", () => {
        for (const s of specs) {
          expect(KEY_CHARS.test(s.key), `${scene.id}'s "${s.key}" isn't a valid GLSL identifier tail`).toBe(true);
        }
      });

      it("no uniform name collisions counting u<Key>, u<Key>Drive, u<Key>Custom", () => {
        const names = new Set<string>();
        for (const s of specs) {
          const u = settingUniformName(s.key);
          const candidates = s.drive ? [u, `${u}Drive`, `${u}Custom`] : [u];
          for (const name of candidates) {
            expect(names.has(name), `${scene.id}: uniform "${name}" (from setting "${s.key}") collides with another setting's`).toBe(false);
            names.add(name);
          }
        }
      });

      it("every panel section's `items` family exists among this scene's settings", () => {
        for (const section of scene.panel ?? []) {
          if (section.items === undefined) continue;
          const has = specs.some((s) => s.item?.family === section.items);
          expect(
            has,
            `${scene.id}'s panel section "${section.title}" claims item family "${section.items}", but no setting carries it`,
          ).toBe(true);
        }
      });

      it("every item-tagged setting is claimed by some panel section", () => {
        const claimedFamilies = new Set((scene.panel ?? []).map((s) => s.items).filter((x): x is string => x !== undefined));
        for (const s of specs) {
          if (!s.item) continue;
          expect(
            claimedFamilies.has(s.item.family),
            `${scene.id}'s "${s.key}" is tagged item family "${s.item.family}", but no panel section claims it`,
          ).toBe(true);
        }
      });

      it("every panel widget id is registered", () => {
        for (const section of scene.panel ?? []) {
          expect(
            getWidget(section.widget),
            `${scene.id}'s panel section "${section.title}" names unregistered widget "${section.widget}"`,
          ).toBeDefined();
        }
      });
    });
  }
});
