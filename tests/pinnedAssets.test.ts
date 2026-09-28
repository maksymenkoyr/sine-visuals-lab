import { globSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pinAsset } from "../src/pinnedAssets.ts";

/** Font imports resolve to a `@font-face` `src: url(...)`, which `pinEverything()`
 *  covers by sweeping `document.fonts` directly (src/pinnedAssets.ts's header) —
 *  no `pinAsset()` call needed at the import site. */
const FONT_IMPORT_RE = /\.(?:woff2?|ttf|otf)\?url$/i;

const IMPORT_RE = /import\s+(\w+)\s+from\s+["']([^"']+\?(?:worker&url|url))["']/g;

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

  // A canary for the scanner itself: if this ever stops finding the two known
  // uses, the regex above has drifted from how imports are actually written.
  it("actually found the known worklet and clip-library imports", () => {
    const text = readFileSync("src/audio/tempoSource.ts", "utf8");
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
