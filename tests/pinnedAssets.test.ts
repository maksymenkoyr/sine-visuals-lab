import { globSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pinAsset, pinEverything, pinSceneMedia, sceneMedia } from "../src/pinnedAssets.ts";

/** Font imports resolve to a `@font-face` `src: url(...)`, which `pinEverything()`
 *  covers by sweeping `document.fonts` directly (src/pinnedAssets.ts's header) —
 *  no `pinAsset()` call needed at the import site. */
const FONT_IMPORT_RE = /\.(?:woff2?|ttf|otf)\?url$/i;

const IMPORT_RE = /import\s+(\w+)\s+from\s+["']([^"']+\?(?:worker&url|url))["']/g;

/** An `import.meta.glob(` call, up to the `;` ending its statement: its options
 *  object carries `query: "?url"` when it resolves files to hashed URLs. */
const GLOB_CALL_RE = /import\.meta\.glob\b[^;]*;/g;
const GLOB_URL_QUERY_RE = /query:\s*["']\?(?:worker&)?url(?:&no-inline)?["']/;

/** Files whose `?url` glob is deliberately left unpinned, with the reason. */
const UNPINNED_URL_GLOBS = new Map([
  ["src/ui/galleryStills.ts", "a gallery still that 404s after a deploy just leaves its tile to the live preview"],
]);

describe("every ?url / ?worker&url import is pinned", () => {
  // src/render/scenes/private/ is a gitignored checkout of a separate,
  // private repo (src/render/scenes/privateScenes.ts) — not ours to scan or edit.
  const files = globSync("src/**/*.ts").filter((f) => !f.startsWith("src/render/scenes/private/"));

  it("pairs every non-font ?url import with a pinAsset(...) call in the same file", () => {
    const failures: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(IMPORT_RE)) {
        const [, importedName, specifier] = match;
        if (FONT_IMPORT_RE.test(specifier)) continue;
        const pinned = new RegExp(`pinAsset\\(\\s*${importedName}\\s*[,)]`).test(text);
        if (!pinned) {
          failures.push(`${file}: "${specifier}" imported as ${importedName} is never passed to pinAsset() — see src/pinnedAssets.ts's header for why every lazily-fetched own-origin file must be.`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("pairs every ?url glob with a pinAsset(...) call, except the named unpinned ones", () => {
    const failures: string[] = [];
    for (const file of files) {
      if (UNPINNED_URL_GLOBS.has(file)) continue;
      const text = readFileSync(file, "utf8");
      const hasUrlGlob = [...text.matchAll(GLOB_CALL_RE)].some((m) => GLOB_URL_QUERY_RE.test(m[0]));
      if (hasUrlGlob && !/pinAsset\(/.test(text)) {
        failures.push(`${file}: an import.meta.glob with query "?url" has no pinAsset() call in the file — see src/pinnedAssets.ts's header, or name the file in UNPINNED_URL_GLOBS with its reason.`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("finds the gallery stills glob, so its UNPINNED_URL_GLOBS entry is doing something", () => {
    const text = readFileSync("src/ui/galleryStills.ts", "utf8");
    expect([...text.matchAll(GLOB_CALL_RE)].some((m) => GLOB_URL_QUERY_RE.test(m[0]))).toBe(true);
  });

  // A canary for the scanner itself: if this ever stops finding the known
  // worklet import, the regex above has drifted from how imports are written.
  it("actually found the known worklet import", () => {
    const text = readFileSync("src/audio/engineSource.ts", "utf8");
    expect([...text.matchAll(IMPORT_RE)].length).toBeGreaterThan(0);
  });
});

describe("pinAsset", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches once and caches the bytes", async () => {
    const buf = new ArrayBuffer(4);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(buf) });
    vi.stubGlobal("fetch", fetchMock);

    const asset = pinAsset("https://example.test/pinned-assets-cache.bin");
    const first = await asset.bytes();
    const second = await asset.bytes();

    expect(first).toBe(buf);
    expect(second).toBe(buf);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a failed fetch, and retries on the next call", async () => {
    const buf = new ArrayBuffer(4);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(buf) });
    vi.stubGlobal("fetch", fetchMock);

    const asset = pinAsset("https://example.test/pinned-assets-retry.bin");
    await expect(asset.bytes()).rejects.toThrow("network down");
    await expect(asset.bytes()).resolves.toBe(buf);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("also rejects (and retries) on a non-ok response, not just a network error", async () => {
    const buf = new ArrayBuffer(4);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, arrayBuffer: () => Promise.reject(new Error("unused")) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(buf) });
    vi.stubGlobal("fetch", fetchMock);

    const asset = pinAsset("https://example.test/pinned-assets-404.bin");
    await expect(asset.bytes()).rejects.toThrow(/404/);
    await expect(asset.bytes()).resolves.toBe(buf);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("sceneMedia", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hands out one handle per path and fetches nothing until asked", async () => {
    const buf = new ArrayBuffer(4);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(buf) });
    vi.stubGlobal("fetch", fetchMock);

    const media = sceneMedia("/media/test/handle-v1.bin");
    expect(sceneMedia("/media/test/handle-v1.bin")).toBe(media);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(media.bytes()).resolves.toBe(buf);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is left to pinSceneMedia() by the after-load sweep of pinEverything()", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
    vi.stubGlobal("fetch", fetchMock);
    // A page that has loaded, in a browser that is idle at once.
    vi.stubGlobal("document", { readyState: "complete", fonts: { forEach: () => {} } });
    vi.stubGlobal("window", { requestIdleCallback: (run: () => void) => run() });

    sceneMedia("/media/test/show-v1.bin");
    pinEverything();
    expect(fetchMock.mock.calls.map((call) => call[0])).not.toContain("/media/test/show-v1.bin");
    pinSceneMedia();
    expect(fetchMock.mock.calls.map((call) => call[0])).toContain("/media/test/show-v1.bin");
  });
});
