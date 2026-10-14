// Holds public/media/ to the rule in src/pinnedAssets.ts's header ("Scene
// media"): a tab loaded before a deploy may still fetch any file there, so a
// committed file never changes and never goes. tests/mediaManifest.ts lists
// each with its sha256. Fails on a changed or missing file (a new version gets
// a new name), on a file the manifest lacks (printing the line to add), and on
// a media path written in src/ that the manifest lacks.
import { createHash } from "node:crypto";
import { existsSync, globSync, readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MEDIA_MANIFEST } from "./mediaManifest.ts";

const sha256 = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

/** A media path as the code writes it: one whole string literal, from the site root. */
const MEDIA_PATH_RE = /["'`](\/media\/[^"'`\s]+)["'`]/g;

describe("public/media never changes", () => {
  it("still holds every file in the manifest, byte for byte", () => {
    const failures: string[] = [];
    for (const [path, hash] of Object.entries(MEDIA_MANIFEST)) {
      const file = `public${path}`;
      if (!existsSync(file)) failures.push(`${file} is gone: an open tab may still fetch it, so put it back`);
      else if (sha256(file) !== hash) failures.push(`${file} changed: put it back, and save the new version under a new name (-v2)`);
    }
    expect(failures).toEqual([]);
  });

  it("lists every file under public/media in the manifest", () => {
    const missing = readdirSync("public/media", { recursive: true, encoding: "utf8" })
      .map((rel) => `/media/${rel.replaceAll("\\", "/")}`)
      .filter((path) => !path.split("/").some((part) => part.startsWith(".")))
      .filter((path) => statSync(`public${path}`).isFile() && !(path in MEDIA_MANIFEST))
      .map((path) => `"${path}": "${sha256(`public${path}`)}",`);
    // Each entry is the line to add to tests/mediaManifest.ts.
    expect(missing).toEqual([]);
  });

  it("has every media path the code names", () => {
    const named: string[] = [];
    const unknown: string[] = [];
    // src/render/scenes/private/ is a separate repo's checkout, not ours to scan.
    for (const file of globSync("src/**/*.ts").filter((f) => !f.startsWith("src/render/scenes/private/"))) {
      for (const [, path] of readFileSync(file, "utf8").matchAll(MEDIA_PATH_RE)) {
        named.push(path);
        if (!(path in MEDIA_MANIFEST)) unknown.push(`${file}: ${path}`);
      }
    }
    expect(unknown).toEqual([]);
    // A canary for the scan: the Alien loops and the dancers' clip library are named somewhere.
    expect(named.some((p) => p.startsWith("/media/alien/"))).toBe(true);
    expect(named.some((p) => p.startsWith("/media/dancers/"))).toBe(true);
  });
});
