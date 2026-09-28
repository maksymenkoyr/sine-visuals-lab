import { describe, it, expect } from "vitest";
import {
  fileClosure,
  formatSceneVersion,
  intersects,
  majorOf,
  ownedFiles,
  parseImportSpecifiers,
  parseRegistryImports,
  parseSceneMajors,
  resolveImport,
  sceneVersion,
  unitNameFromImportPath,
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

describe("unitNameFromImportPath", () => {
  it("is the basename for a direct file", () => {
    expect(unitNameFromImportPath("./caustics.ts")).toBe("caustics");
    expect(unitNameFromImportPath("./meshGrid.ts")).toBe("meshGrid");
  });

  it("is the folder for a nested path", () => {
    expect(unitNameFromImportPath("./sky/sky.ts")).toBe("sky");
    expect(unitNameFromImportPath("./tessera/index.ts")).toBe("tessera");
    expect(unitNameFromImportPath("./dancers/index.ts")).toBe("dancers");
  });
});

describe("parseRegistryImports", () => {
  it("pairs each binding with its unit and raw path, in order", () => {
    const source = `
      import { causticsScene } from "./caustics.ts";
      import { skyScene } from "./sky/sky.ts";
      registerScene(causticsScene);
      registerScene(skyScene);
    `;
    expect(parseRegistryImports(source)).toEqual([
      { binding: "causticsScene", unit: "caustics", path: "./caustics.ts" },
      { binding: "skyScene", unit: "sky", path: "./sky/sky.ts" },
    ]);
  });

  it("ignores an import never passed to registerScene", () => {
    // The registry's own real shape: listScenes/registerScene imported from
    // "../scene.ts", and collectPrivateScenes from "./privateScenes.ts" —
    // neither is itself ever registered, so neither should read as a scene
    // (the bug this guards: unitNameFromImportPath("../scene.ts") would
    // otherwise produce the bogus unit "..", and "privateScenes" a scene
    // that was never registered).
    const source = `
      import { listScenes, registerScene } from "../scene.ts";
      import { collectPrivateScenes } from "./privateScenes.ts";
      import { causticsScene } from "./caustics.ts";
      registerScene(causticsScene);
      const privateScenes = collectPrivateScenes(import.meta.glob("./private/*/index.ts", { eager: true }));
      for (const scene of privateScenes.scenes) registerScene(scene);
    `;
    expect(parseRegistryImports(source)).toEqual([
      { binding: "causticsScene", unit: "caustics", path: "./caustics.ts" },
    ]);
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
