import { describe, it, expect } from "vitest";
import {
  fileClosure,
  formatSceneVersion,
  intersects,
  majorOf,
  ownedFiles,
  parseImportSpecifiers,
  parseSceneMajors,
  resolveImport,
  sceneEntries,
  sceneVersion,
} from "../tools/sceneVersionLib.mjs";

describe("parseImportSpecifiers", () => {
  it("reads named, default, side-effect and namespace imports", () => {
    const source = `
      import { a, b as c } from "./x.ts";
      import Default from "./y.ts";
      import "./z.ts";
      import * as ns from "./w.ts";
      export { d } from "./v.ts";
      export * from "./u.ts";
    `;
    expect(parseImportSpecifiers(source).sort()).toEqual(
      ["./u.ts", "./v.ts", "./w.ts", "./x.ts", "./y.ts", "./z.ts"].sort(),
    );
  });

  it("strips a ?query suffix", () => {
    const source = `
      import clipsUrl from "./clips.bin?url";
      import worker from "./thing.ts?worker&url";
    `;
    expect(parseImportSpecifiers(source).sort()).toEqual(["./clips.bin", "./thing.ts"].sort());
  });

  it("reads dynamic import() including a queried one", () => {
    const source = `const mod = await import("./lazy.ts");\nconst raw = await import("./data.json?raw");`;
    expect(parseImportSpecifiers(source).sort()).toEqual(["./data.json", "./lazy.ts"].sort());
  });

  it("skips dynamic import() with staticOnly", () => {
    const source = `import { a } from "./x.ts";\nexport const load = () => import("./body.ts");`;
    expect(parseImportSpecifiers(source, { staticOnly: true })).toEqual(["./x.ts"]);
    expect(parseImportSpecifiers(source).sort()).toEqual(["./body.ts", "./x.ts"]);
  });

  it("drops bare (package) specifiers", () => {
    const source = `import { z } from "zod";\nimport "./local.ts";`;
    expect(parseImportSpecifiers(source)).toEqual(["./local.ts"]);
  });

  it("follows an import across several lines", () => {
    const source = `import {\n  a,\n  b,\n} from "./multi.ts";`;
    expect(parseImportSpecifiers(source)).toEqual(["./multi.ts"]);
  });

  it("doesn't mistake a string constant for an import", () => {
    const source = `export const CLASS_NAME = ".active";\nimport { a } from "./real.ts";`;
    expect(parseImportSpecifiers(source)).toEqual(["./real.ts"]);
  });
});

describe("sceneEntries", () => {
  const GALLERY = `export const gallery = { stage: "draft", added: "2026-10-01" } as const;\n`;
  const sources: Record<string, string> = {
    "src/render/scenes/index.ts": `import { collectScenes } from "./sceneModules.ts";\nconst gallery = 1;\n`,
    "src/render/scenes/caustics.ts": `export const causticsScene = {};\n${GALLERY}`,
    "src/render/scenes/meshGrid.ts": `${GALLERY}export const meshGridScene = {};\n`,
    "src/render/scenes/fluidSim.ts": `export function step() {}\n`,
    "src/render/scenes/sceneModules.ts": ` * exports \`gallery\`\n * export const gallery in a comment doesn't start a line\n`,
    "src/render/scenes/sky/index.ts": `export { skyScene } from "./sky.ts";\n${GALLERY}`,
    "src/render/scenes/sky/sky.ts": `export const skyScene = {};\n`,
    "src/render/scenes/tessera/index.ts": `${GALLERY}`,
    "src/render/scenes/notes/readme.md": `export const gallery`,
    "src/render/scenes/private/index.ts": `${GALLERY}`,
  };
  const readFile = (p: string) => sources[p] ?? null;
  const exists = (p: string) => p in sources;
  const names = ["index.ts", "caustics.ts", "meshGrid.ts", "fluidSim.ts", "sceneModules.ts", "sceneMajors.json", "sky", "tessera", "notes", "private"];

  it("finds a file or a folder's index.ts that exports gallery, keyed by unit", () => {
    expect(sceneEntries(names, readFile, exists)).toEqual([
      { unit: "caustics", file: "src/render/scenes/caustics.ts" },
      { unit: "meshGrid", file: "src/render/scenes/meshGrid.ts" },
      { unit: "sky", file: "src/render/scenes/sky/index.ts" },
      { unit: "tessera", file: "src/render/scenes/tessera/index.ts" },
    ]);
  });

  it("finds a card file or a folder's card.ts, keyed by unit without .card", () => {
    const cardSources: Record<string, string> = {
      "src/render/scenes/storm.card.ts": GALLERY,
      "src/render/scenes/storm.ts": `export const stormScene = {};\n`,
      "src/render/scenes/tessera/card.ts": GALLERY,
      "src/render/scenes/tessera/index.ts": `export const tesseraScene = {};\n`,
      "src/render/scenes/sky/index.ts": `export { skyScene } from "./sky.ts";\n${GALLERY}`,
      "src/render/scenes/private/index.ts": GALLERY,
    };
    const entries = sceneEntries(
      ["index.ts", "storm.card.ts", "storm.ts", "tessera", "sky", "private"],
      (p) => cardSources[p] ?? null,
      (p) => p in cardSources,
    );
    expect(entries).toEqual([
      { unit: "sky", file: "src/render/scenes/sky/index.ts" },
      { unit: "storm", file: "src/render/scenes/storm.card.ts" },
      { unit: "tessera", file: "src/render/scenes/tessera/card.ts" },
    ]);
    expect(entries.map((e) => e.unit)).not.toContain("storm.card");
  });

  it("skips the registry, helpers, a folder without index.ts, and private/", () => {
    const units = sceneEntries(names, readFile, exists).map((e) => e.unit);
    for (const unit of ["index", "fluidSim", "sceneModules", "notes", "private"]) expect(units).not.toContain(unit);
  });
});

describe("resolveImport", () => {
  const files = new Set(["src/render/scenes/index.ts", "src/render/scenes/caustics.ts", "src/render/scenes/sky/sky.ts", "src/render/scenes/dancers/index.ts", "src/render/scenes/dancers/clips.bin"]);
  const exists = (p: string) => files.has(p);

  it("resolves a direct file", () => {
    expect(resolveImport("src/render/scenes/index.ts", "./caustics.ts", exists)).toBe(
      "src/render/scenes/caustics.ts",
    );
  });

  it("resolves a nested direct file", () => {
    expect(resolveImport("src/render/scenes/index.ts", "./sky/sky.ts", exists)).toBe(
      "src/render/scenes/sky/sky.ts",
    );
  });

  it("falls back to an index.ts when the folder itself has no direct file", () => {
    expect(resolveImport("src/render/scenes/index.ts", "./dancers", exists)).toBe(
      "src/render/scenes/dancers/index.ts",
    );
  });

  it("resolves a non-ts leaf by its exact path", () => {
    expect(resolveImport("src/render/scenes/dancers/index.ts", "./clips.bin", exists)).toBe(
      "src/render/scenes/dancers/clips.bin",
    );
  });

  it("is null for nothing that exists", () => {
    expect(resolveImport("src/render/scenes/index.ts", "./nope.ts", exists)).toBeNull();
  });
});

describe("fileClosure and ownedFiles: territory and shared-file exclusion", () => {
  // A small in-memory file graph: two scenes sharing a helper, plus an "app"
  // owner whose own entry (app.ts) imports the registry — which must be a
  // leaf for the app owner, not descended into (or it would pull in both
  // scenes' closures as if the app core owned them too).
  const sources: Record<string, string> = {
    // "../shared.ts" from src/render/scenes/{a,b}.ts and "./render/shared.ts"
    // from src/app.ts both resolve to the same "src/render/shared.ts" — the
    // real shape this mirrors is a scene and app.ts both reaching a helper
    // under src/render/ (e.g. sceneCommon.ts).
    "src/app.ts": `import "./render/scenes/index.ts";\nimport { helper } from "./render/shared.ts";`,
    "src/render/scenes/index.ts": `import { aScene } from "./a.ts";\nimport { bScene } from "./b.ts";`,
    "src/render/scenes/a.ts": `import { helper } from "../shared.ts";\nimport { onlyA } from "./aOnly.ts";`,
    "src/render/scenes/b.ts": `import { helper } from "../shared.ts";\nimport { onlyB } from "./bOnly.ts";`,
    "src/render/scenes/aOnly.ts": ``,
    "src/render/scenes/bOnly.ts": ``,
    "src/render/shared.ts": ``,
  };
  const exists = (p: string) => p in sources;
  const readFile = (p: string) => sources[p] ?? null;

  it("gives each scene its own private files and excludes what's shared", () => {
    const aClosure = fileClosure(["src/render/scenes/a.ts"], readFile, exists);
    const bClosure = fileClosure(["src/render/scenes/b.ts"], readFile, exists);
    const appClosure = fileClosure(["src/app.ts"], readFile, exists, {
      stopAt: new Set(["src/render/scenes/index.ts"]),
    });

    expect(appClosure.has("src/render/scenes/index.ts")).toBe(true);
    expect(appClosure.has("src/render/scenes/a.ts")).toBe(false); // stopAt kept it from descending

    const territory = ownedFiles(
      new Map([
        ["a", aClosure],
        ["b", bClosure],
        ["app", appClosure],
      ]),
    );

    expect(territory.get("a")).toEqual(new Set(["src/render/scenes/a.ts", "src/render/scenes/aOnly.ts"]));
    expect(territory.get("b")).toEqual(new Set(["src/render/scenes/b.ts", "src/render/scenes/bOnly.ts"]));
    // shared.ts is reachable from a, b, AND the app core: it belongs to none.
    expect(territory.get("a")!.has("src/render/shared.ts")).toBe(false);
    expect(territory.get("b")!.has("src/render/shared.ts")).toBe(false);
    expect(territory.get("app")!.has("src/render/shared.ts")).toBe(false);
  });
});

describe("fileClosure through a card", () => {
  const sources: Record<string, string> = {
    "src/render/scenes/storm.card.ts": `import type { SceneCard } from "../scene.ts";\nexport const loadBody = () => import("./storm.ts");`,
    "src/render/scenes/storm.ts": `import { card } from "./storm.card.ts";\nimport { stormOnly } from "./stormOnly.ts";`,
    "src/render/scenes/stormOnly.ts": ``,
    "src/render/scene.ts": ``,
  };
  const exists = (p: string) => p in sources;
  const readFile = (p: string) => sources[p] ?? null;

  it("reaches the body through the card's import()", () => {
    const closure = fileClosure(["src/render/scenes/storm.card.ts"], readFile, exists);
    expect(closure.has("src/render/scenes/storm.ts")).toBe(true);
    expect(closure.has("src/render/scenes/stormOnly.ts")).toBe(true);
  });

  it("stays out of the body with staticOnly", () => {
    const closure = fileClosure(["src/render/scenes/storm.card.ts"], readFile, exists, { staticOnly: true });
    expect(closure).toEqual(new Set(["src/render/scenes/storm.card.ts", "src/render/scene.ts"]));
  });
});

describe("intersects", () => {
  it("is true only when a file is in the territory", () => {
    const territory = new Set(["a.ts", "b.ts"]);
    expect(intersects(["c.ts", "b.ts"], territory)).toBe(true);
    expect(intersects(["c.ts", "d.ts"], territory)).toBe(false);
    expect(intersects([], territory)).toBe(false);
  });
});

describe("parseSceneMajors / majorOf", () => {
  it("defaults everything to 0 when the file is missing or invalid", () => {
    expect(majorOf(parseSceneMajors(null), "caustics")).toBe(0);
    expect(majorOf(parseSceneMajors(""), "caustics")).toBe(0);
    expect(majorOf(parseSceneMajors("not json"), "caustics")).toBe(0);
    expect(majorOf(parseSceneMajors("[1,2,3]"), "caustics")).toBe(0);
  });

  it("reads a set major and defaults an absent one", () => {
    const majors = parseSceneMajors('{"caustics": 1}');
    expect(majorOf(majors, "caustics")).toBe(1);
    expect(majorOf(majors, "sky")).toBe(0);
  });
});

describe("sceneVersion — the version rule", () => {
  it("is 0.1.0 on a scene's first-ever release", () => {
    expect(sceneVersion([{ changed: true, major: 0 }], 0, 0)).toEqual({ major: 0, minor: 1, patch: 0 });
  });

  it("doesn't bump the minor for a release that didn't change the scene", () => {
    const releases = [
      { changed: true, major: 0 },
      { changed: false, major: 0 },
    ];
    expect(sceneVersion(releases, 0, 0)).toEqual({ major: 0, minor: 1, patch: 0 });
  });

  it("carries the given patch straight through", () => {
    expect(sceneVersion([{ changed: true, major: 0 }], 0, 7)).toEqual({ major: 0, minor: 1, patch: 7 });
  });

  it("lands a raised major at N.0.0, even though that release changed the scene", () => {
    // sceneMajors.json bumped to 1, and the release that carries the bump
    // also happens to touch the scene's own files.
    const releases = [
      { changed: true, major: 0 },
      { changed: true, major: 1 },
    ];
    expect(sceneVersion(releases, 1, 0)).toEqual({ major: 1, minor: 0, patch: 0 });
  });

  it("opens N.1.0 on the next changed release at that major", () => {
    const releases = [
      { changed: true, major: 0 },
      { changed: true, major: 1 },
      { changed: true, major: 1 },
    ];
    expect(sceneVersion(releases, 1, 0)).toEqual({ major: 1, minor: 1, patch: 0 });
  });

  it("shows M.0.P for a major raised on main but not yet released", () => {
    // No release has recorded major 1 yet — the bump is only on disk.
    const releases = [
      { changed: true, major: 0 },
      { changed: true, major: 0 },
    ];
    expect(sceneVersion(releases, 1, 5)).toEqual({ major: 1, minor: 0, patch: 5 });
  });
});

describe("formatSceneVersion", () => {
  it("formats plainly, and with a +dev suffix", () => {
    const v = { major: 0, minor: 2, patch: 3 };
    expect(formatSceneVersion(v)).toBe("0.2.3");
    expect(formatSceneVersion(v, false)).toBe("0.2.3");
    expect(formatSceneVersion(v, true)).toBe("0.2.3+dev");
  });
});
