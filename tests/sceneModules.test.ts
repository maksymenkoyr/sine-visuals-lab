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
      "./old.card.ts": fakeCardModule("old", "released", "2026-08-27"),
      "./b/card.ts": fakeCardModule("b", "draft", "2026-10-05"),
      "./a.card.ts": fakeCardModule("a", "development", "2026-10-05"),
      "./new/card.ts": fakeCardModule("new", "draft", "2026-10-06"),
    });
    expect(out.scenes.map((s) => s.scene.id)).toEqual(["new", "a", "b", "old"]);
    expect(out.scenes.map((s) => s.unit)).toEqual(["new", "a", "b", "old"]);
    expect(out.errors).toEqual([]);
  });

  it("passes over a module with no card, a helper or a body, with no error", () => {
    const out = collectScenes({
      "./fluidSim.ts": { step() {}, SIZE: 4 },
      "./x.ts": { xScene: fakeScene("x") },
    });
    expect(out).toEqual({ scenes: [], errors: [] });
  });

  it("registers a card as a proxy with its gallery record", () => {
    const out = collectScenes({ "./split.card.ts": fakeCardModule("split", "development", "2026-10-05") });
    expect(out.errors).toEqual([]);
    expect(out.scenes).toHaveLength(1);
    expect(sceneCard(out.scenes[0].scene)).toBeDefined();
    expect(out.scenes[0].gallery).toEqual(gallery("development", "2026-10-05"));
  });

  it("reports a duplicate id across two cards and keeps the first", () => {
    const out = collectScenes({
      "./a.card.ts": fakeCardModule("ok"),
      "./b.card.ts": fakeCardModule("ok", "draft", "2026-10-02"),
    });
    expect(out.scenes.map((s) => s.scene.id)).toEqual(["ok"]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatch(/b\.card\.ts: scene id "ok" is already registered/);
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

});

describe("the real scene modules", () => {
  it("all keep the contract", () => {
    const modules = import.meta.glob(["../src/render/scenes/*.card.ts", "../src/render/scenes/*/card.ts"], { eager: true });
    expect(collectScenes(modules).errors).toEqual([]);
  });

  it("are all cards: no scene left in the one-file shape", () => {
    const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
    for (const { file } of sceneEntries(readdirSync(SCENES_DIR), read, existsSync)) {
      expect(/\.card\.ts$|\/card\.ts$/.test(file), `${file}: split it into a card and a body (src/render/scenes/sceneModules.ts's header)`).toBe(true);
    }
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
