// Dead sliders (#645): a scene setting that changes nothing in the picture. A
// setting is dead when no shader reads its `u<Key>` uniform and no scene code
// reads its key. This is a static scan of each scene's own files, gathered as
// tests/hitDrivers.test.ts does (the import closure under src/render/scenes/,
// minus private/). A setting is live if any of three things appears there with
// comments stripped: its uniform as a whole word, its `<key>Drive(` GLSL
// helper, or its key as a quoted string. Not a compile check, because compiling
// every scene needs a browser in CI and minutes per run; a headless-Chrome
// compile of all scenes on 2026-10-24 dropped no uniform this scan counted as
// read. Per-item settings are skipped because they are read by array index. A
// reverse check (a declared uniform nothing sets) is left out: the runtime
// probe's hits were false alarms (set on a later path, samplers left on unit 0).

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { settingUniformName } from "../src/render/sceneCommon.ts";
import type { SceneCard } from "../src/render/scene.ts";
import { isScene } from "../src/render/scenes/privateScenes.ts";
import { fileClosure, SCENES_DIR, sceneEntries } from "../tools/sceneVersionLib.mjs";

function strip(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function count(text: string, re: RegExp): number {
  return [...text.matchAll(re)].length;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("dead settings: every scene setting is read somewhere", () => {
  const root = path.resolve(__dirname, "..");
  const read = (rel: string) => {
    try {
      return readFileSync(path.join(root, rel), "utf8");
    } catch {
      return null;
    }
  };
  const exists = (rel: string) => existsSync(path.join(root, rel));
  const entries = sceneEntries(readdirSync(path.join(root, SCENES_DIR)), read, exists);

  for (const { unit, file: entryFile } of entries) {
    it(unit, async () => {
      const files = [...fileClosure(entryFile, read, exists)].filter((f) => f.startsWith("src/render/scenes/") && !f.includes("/private/"));
      let text = "";
      for (const f of files) {
        const src = read(f);
        if (src) text += `\n${strip(src)}`;
      }
      const mod = (await import(path.join(root, entryFile))) as Record<string, unknown>;
      // A split scene's entry is its card, which holds the settings.
      const scene = (mod.card ?? Object.values(mod).find(isScene)) as SceneCard;
      for (const spec of scene.settings ?? []) {
        if (spec.item) continue;
        const key = escapeRe(spec.key);
        const U = settingUniformName(spec.key);
        const u = escapeRe(U);
        const glslText = text
          .replace(new RegExp(`uniform\\s+float\\s+${u}\\s*;`, "g"), "")
          .replace(new RegExp(`(["'])${u}\\1`, "g"), "");
        const glsl = count(glslText, new RegExp(`\\b${u}\\b`, "g"));
        const helper = count(text, new RegExp(`\\b${key}Drive\\s*\\(`, "g"));
        const tsText = text.replace(new RegExp(`\\bkey\\s*:\\s*(["'])${key}\\1`, "g"), "");
        const ts = count(tsText, new RegExp(`(["'])${key}\\1`, "g"));
        expect(
          glsl + helper + ts,
          `${scene.id}: "${spec.key}" changes nothing: no shader reads ${U}, nothing calls ${spec.key}Drive(), and no code reads "${spec.key}"`,
        ).toBeGreaterThan(0);
      }
    });
  }
});
