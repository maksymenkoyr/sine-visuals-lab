import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectScenes, unitOfPath } from "../src/render/scenes/sceneModules.ts";
import { DRAFT_SCENE_IDS, PAID_SCENE_IDS, SCENE_UNITS, sceneStage } from "../src/render/scenes/index.ts";
import { listScenes, type Scene } from "../src/render/scene.ts";
import { SCENES_DIR, sceneEntries } from "../tools/sceneVersionLib.mjs";

function fakeScene(id: string): Scene {
  return {
    id,
    name: id.toUpperCase(),
    init() {},
    render() {},
    dispose() {},
  } as unknown as Scene;
}

const gallery = (stage: string, added: string) => ({ stage, added });

describe("unitOfPath", () => {
  it("is a folder's name for its index.ts, else the file's basename", () => {
    expect(unitOfPath("./tessera/index.ts")).toBe("tessera");
    expect(unitOfPath("./caustics.ts")).toBe("caustics");
    expect(unitOfPath("../src/render/scenes/sky/index.ts")).toBe("sky");
  });
});

describe("collectScenes", () => {
  it("orders newest added first, ties by id", () => {
    const out = collectScenes({
      "./old.ts": { oldScene: fakeScene("old"), gallery: gallery("released", "2026-08-27") },
      "./b/index.ts": { bScene: fakeScene("b"), gallery: gallery("draft", "2026-10-05") },
      "./a.ts": { aScene: fakeScene("a"), gallery: gallery("development", "2026-10-05") },
      "./new/index.ts": { newScene: fakeScene("new"), gallery: gallery("draft", "2026-10-06") },
    });
    expect(out.scenes.map((s) => s.scene.id)).toEqual(["new", "a", "b", "old"]);
    expect(out.scenes.map((s) => s.unit)).toEqual(["new", "a", "b", "old"]);
    expect(out.errors).toEqual([]);
  });

  it("passes over a helper that exports neither a scene nor gallery", () => {
    const out = collectScenes({ "./fluidSim.ts": { step() {}, SIZE: 4 } });
    expect(out).toEqual({ scenes: [], errors: [] });
  });

  it("reports a module that breaks the contract and keeps the rest", () => {
    const out = collectScenes({
      "./nogallery.ts": { xScene: fakeScene("x") },
      "./badstage.ts": { yScene: fakeScene("y"), gallery: gallery("featured", "2026-10-01") },
      "./baddate.ts": { zScene: fakeScene("z"), gallery: gallery("draft", "Oct 1") },
      "./two.ts": { p: fakeScene("p"), q: fakeScene("q"), gallery: gallery("draft", "2026-10-01") },
      "./none.ts": { gallery: gallery("draft", "2026-10-01") },
      "./ok.ts": { okScene: fakeScene("ok"), gallery: gallery("draft", "2026-10-01") },
      "./zdup.ts": { dupScene: fakeScene("ok"), gallery: gallery("draft", "2026-10-02") },
    });
    expect(out.scenes.map((s) => s.scene.id)).toEqual(["ok"]);
    expect(out.errors).toHaveLength(6);
    expect(out.errors.join("\n")).toMatch(/nogallery\.ts: exports a scene but no `gallery`/);
    expect(out.errors.join("\n")).toMatch(/zdup\.ts: scene id "ok" is already registered/);
  });

  it("counts one scene exported under two names as one", () => {
    const s = fakeScene("s");
    const out = collectScenes({ "./s.ts": { sScene: s, default: s, gallery: gallery("draft", "2026-10-01") } });
    expect(out.scenes.map((c) => c.scene.id)).toEqual(["s"]);
    expect(out.errors).toEqual([]);
  });
});

describe("the real scene modules", () => {
  it("all keep the contract", () => {
    const modules = import.meta.glob(["../src/render/scenes/*.ts", "../src/render/scenes/*/index.ts", "!../src/render/scenes/index.ts"], {
      eager: true,
    });
    expect(collectScenes(modules).errors).toEqual([]);
  });

  it("are the units the build tools find by reading files", () => {
    const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
    const fromFiles = sceneEntries(readdirSync(SCENES_DIR), read, existsSync).map((e) => e.unit);
    expect([...SCENE_UNITS.keys()].sort()).toEqual(fromFiles);
  });

  it("are every registered scene but the paid ones, each in its own section", () => {
    const free = new Set(SCENE_UNITS.values());
    for (const scene of listScenes()) {
      if (PAID_SCENE_IDS.has(scene.id)) continue;
      expect(free.has(scene), scene.id).toBe(true);
    }
    for (const scene of free) {
      expect(DRAFT_SCENE_IDS.has(scene.id)).toBe(sceneStage(scene.id) === "draft");
    }
  });
});
