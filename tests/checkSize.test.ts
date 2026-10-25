// The pure half of the size step of `npm run check` (tools/check.mjs header):
// a page's first-paint JS read off a Vite build manifest, the built files
// pinAsset() fetches after load, and both held to size-budget.json.
import { describe, expect, it } from "vitest";
import { compareSizes, firstPaintChunks, pinnedFiles } from "../tools/checkLib.mjs";

const manifest = {
  "index.html": { file: "assets/main-a.js", isEntry: true, imports: ["_shared-b.js"], dynamicImports: ["src/late.ts"] },
  "tv.html": { file: "assets/tv-c.js", isEntry: true, imports: ["_shared-b.js", "_version-d.js"] },
  "_shared-b.js": { file: "assets/shared-b.js", imports: ["_version-d.js"], css: ["assets/shared-e.css"] },
  "_version-d.js": { file: "assets/version-d.js" },
  "src/late.ts": { file: "assets/late-f.js", isDynamicEntry: true },
  "src/render/scenes/dancers/clips.bin": { file: "assets/clips-g.bin" },
};
const pin = (path: string, spec: string) => ({ path, text: `import fileUrl from "${spec}";\nconst f = pinAsset(fileUrl);` });
const budget = { pages: { "index.html": 600 * 1024, "tv.html": 400 * 1024 }, pinned: 5000 * 1024 };

describe("the size step", () => {
  it("follows a page's static imports all the way down, once each, and leaves dynamic imports out", () => {
    expect(firstPaintChunks(manifest, "index.html")).toEqual(["assets/main-a.js", "assets/shared-b.js", "assets/version-d.js"]);
    expect(firstPaintChunks(manifest, "tv.html")).toEqual(["assets/tv-c.js", "assets/shared-b.js", "assets/version-d.js"]);
  });

  it("finds the pinned files in the build: ?url through the manifest, a worker by its name", () => {
    const sources = [
      pin("src/audio/tempoSource.ts", "./tempoWorklet.ts?worker&url"),
      pin("src/render/scenes/dancers/index.ts", "./clips.bin?url"),
      pin("src/render/scenes/coderain/index.ts", "../dancers/clips.bin?url"),
      pin("src/tiny.ts", "./tiny.bin?url"), // inlined: not in the manifest, no fetch
      pin("src/ui/theme.ts", "./face.woff2?url"), // a font: pinEverything() loads it
      { path: "src/ui/other.ts", text: 'import picUrl from "./pic.png?url";\nconst img = picUrl;' }, // never pinned
    ];
    const assets = ["assets/clips-g.bin", "assets/tempoWorklet-h1.js", "assets/main-a.js"];
    expect(pinnedFiles(sources, manifest, assets)).toEqual({ files: ["assets/clips-g.bin", "assets/tempoWorklet-h1.js"], problems: [] });
  });

  it("reports a pinned import it can't place: a package, or a worker missing or not told apart", () => {
    const worker = [pin("src/audio/tempoSource.ts", "./tempoWorklet.ts?worker&url")];
    expect(pinnedFiles(worker, manifest, []).problems).toEqual(["can't find the built worker of src/audio/tempoWorklet.ts"]);
    expect(pinnedFiles(worker, manifest, ["assets/tempoWorklet-a.js", "assets/tempoWorklet-b.js"]).problems).toHaveLength(1);
    expect(pinnedFiles([pin("src/a.ts", "pkg/x.wasm?url")], manifest, []).problems).toEqual(["can't place the package import pkg/x.wasm?url (src/a.ts)"]);
  });

  it("passes within budget, with a one-line summary", () => {
    const v = compareSizes({ pages: { "index.html": 599 * 1024, "tv.html": 400 * 1024 }, pinned: 4700 * 1024 }, budget);
    expect(v.ok).toBe(true);
    expect(v.summary).toBe("index.html 599.0 of 600.0 kB · tv.html 400.0 of 400.0 kB · pinned 4700.0 of 5000.0 kB");
  });

  it("fails over budget, and says how to change a budget", () => {
    const v = compareSizes({ pages: { "index.html": 612.5 * 1024, "tv.html": 1 }, pinned: 5100 * 1024 }, budget);
    expect(v.ok).toBe(false);
    expect(v.detail).toContain("index.html loads 612.5 kB of gzipped JS before its first paint, 12.5 kB over its budget.");
    expect(v.detail).toContain("pinAsset() fetches 5100.0 kB after load, 100.0 kB over its budget.");
    expect(v.detail).toContain("raising one past it needs a reason in the pull request description");
    expect(v.detail).not.toContain("tv.html");
  });

  it("fails when size-budget.json and the build disagree on the pages, or there is no pinned budget", () => {
    const v = compareSizes({ pages: { "index.html": 1, "output.html": 1 }, pinned: 1 }, { pages: budget.pages });
    expect(v.detail).toContain("output.html has no budget in size-budget.json: add one.");
    expect(v.detail).toContain("tv.html has a budget in size-budget.json, but the build has no such page: remove it.");
    expect(v.detail).toContain("size-budget.json has no `pinned` budget: add one.");
  });
});
