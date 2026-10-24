import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bodyPathOfCard, collectScenes, unitOfPath } from "../src/render/scenes/sceneModules.ts";
import { sceneCard } from "../src/render/lazyScene.ts";
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

function fakeCardModule(id: string, stage = "draft", added = "2026-10-01") {
  const body = fakeScene(id);
  return { card: { id, name: id.toUpperCase() }, loadBody: () => Promise.resolve(body), gallery: gallery(stage, added) };
}

describe("unitOfPath", () => {
  it("is a folder's name for its index.ts, else the file's basename", () => {
    expect(unitOfPath("./tessera/index.ts")).toBe("tessera");
    expect(unitOfPath("./caustics.ts")).toBe("caustics");
    expect(unitOfPath("../src/render/scenes/sky/index.ts")).toBe("sky");
  });

  it("is the name before .card for a card file, and the folder for a folder's card.ts", () => {
    expect(unitOfPath("./storm.card.ts")).toBe("storm");
    expect(unitOfPath("./tessera/card.ts")).toBe("tessera");
    expect(unitOfPath("../src/render/scenes/meshGrid.card.ts")).toBe("meshGrid");
  });
});

describe("bodyPathOfCard", () => {
  it("maps a file card to its file and a folder card to its index.ts", () => {
    expect(bodyPathOfCard("./storm.card.ts")).toBe("./storm.ts");
    expect(bodyPathOfCard("../src/render/scenes/meshGrid.card.ts")).toBe("../src/render/scenes/meshGrid.ts");
    expect(bodyPathOfCard("./tessera/card.ts")).toBe("./tessera/index.ts");
    expect(bodyPathOfCard("/src/render/scenes/tessera/card.ts")).toBe("/src/render/scenes/tessera/index.ts");
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

  it("registers a card as a proxy, ordered with legacy modules", () => {
    const out = collectScenes({
      "./old.ts": { oldScene: fakeScene("old"), gallery: gallery("released", "2026-08-27") },
      "./split.card.ts": fakeCardModule("split", "development", "2026-10-05"),
      "./folder/card.ts": fakeCardModule("folder", "draft", "2026-10-06"),
    });
    expect(out.errors).toEqual([]);
    expect(out.scenes.map((s) => s.scene.id)).toEqual(["folder", "split", "old"]);
    expect(out.scenes.map((s) => s.unit)).toEqual(["folder", "split", "old"]);
    expect(sceneCard(out.scenes[0].scene)).toBeDefined();
    expect(sceneCard(out.scenes[2].scene)).toBeUndefined();
    expect(out.scenes[1].gallery).toEqual(gallery("development", "2026-10-05"));
  });

  it("reports a broken card with one line naming its path", () => {
    const good = fakeCardModule("good");
    const out = collectScenes({
      "./nogallery.card.ts": { card: good.card, loadBody: good.loadBody },
      "./badgallery.card.ts": { ...fakeCardModule("g2"), gallery: gallery("featured", "2026-10-01") },
      "./noid.card.ts": { ...fakeCardModule("n"), card: { id: "", name: "N" } },
      "./noname.card.ts": { ...fakeCardModule("m"), card: { id: "m" } },
      "./noload.card.ts": { card: { id: "l", name: "L" }, gallery: gallery("draft", "2026-10-01") },
      "./ok.card.ts": fakeCardModule("ok"),
    });
    expect(out.scenes.map((s) => s.scene.id)).toEqual(["ok"]);
    expect(out.errors).toHaveLength(5);
    for (const file of ["nogallery", "badgallery", "noid", "noname", "noload"]) {
      expect(out.errors.filter((e) => e.startsWith(`./${file}.card.ts:`))).toHaveLength(1);
    }
    expect(out.errors.join("\n")).toMatch(/noload\.card\.ts: .*loadBody/);
  });

  it("skips a legacy body next to its card silently, but not a lone one", () => {
    const out = collectScenes({
      "./split.card.ts": fakeCardModule("split"),
      "./split.ts": { splitScene: fakeScene("split") },
      "./folder/card.ts": fakeCardModule("folder"),
      "./folder/index.ts": { folderScene: fakeScene("folder") },
      "./lone.ts": { loneScene: fakeScene("lone") },
    });
    expect(out.scenes.map((s) => s.scene.id).sort()).toEqual(["folder", "split"]);
    expect(out.errors).toEqual(["./lone.ts: exports a scene but no `gallery`"]);
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
    const modules = {
      ...import.meta.glob(["../src/render/scenes/*.card.ts", "../src/render/scenes/*/card.ts"], { eager: true }),
      ...import.meta.glob(
        [
          "../src/render/scenes/*.ts",
          "../src/render/scenes/*/index.ts",
          "!../src/render/scenes/index.ts",
          "!../src/render/scenes/*.card.ts",
          "!../src/render/scenes/*/card.ts",
        ],
        { eager: true },
      ),
    };
    expect(collectScenes(modules).errors).toEqual([]);
  });

  it("have cards whose body is the scene its conventional module exports, sharing the card's settings and panel", async () => {
    const cards = import.meta.glob(["../src/render/scenes/*.card.ts", "../src/render/scenes/*/card.ts"], { eager: true }) as Record<
      string,
      { card: { id: string; settings?: unknown; panel?: unknown }; loadBody: () => Promise<Scene> }
    >;
    const bodies = import.meta.glob(["../src/render/scenes/*.ts", "../src/render/scenes/*/index.ts"]);
    const paths = Object.keys(cards);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const { card, loadBody } = cards[path];
      const bodyModule = (await bodies[bodyPathOfCard(path)]()) as Record<string, unknown>;
      const scene = await loadBody();
      expect(Object.values(bodyModule), path).toContain(scene);
      expect(scene.id, path).toBe(card.id);
      expect(scene.settings, path).toBe(card.settings);
      expect(scene.panel, path).toBe(card.panel);
    }
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
