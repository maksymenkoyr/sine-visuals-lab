import { describe, it, expect } from "vitest";
import {
  addedSceneUnits,
  areaOfFile,
  categorize,
  extractHighlights,
  formatEntry,
  prNumberFromSubject,
  renderNotes,
  sceneNameFromSource,
} from "../tools/releaseNotesLib.mjs";

describe("prNumberFromSubject", () => {
  it("reads the trailing (#N) only", () => {
    expect(prNumberFromSubject("Coil: a shell coil (#209)")).toBe(209);
    expect(prNumberFromSubject("Remove the symlink (#213); ignore node_modules (#223)")).toBe(223);
    expect(prNumberFromSubject("A direct push")).toBeNull();
  });
});

describe("extractHighlights", () => {
  it("takes the section up to the rule, without comments", () => {
    const body = "## Highlights\n\n<!-- hint -->\nNew **Coil** scene.\n\n- Output window\n\n---\n\nMerge with a merge commit.";
    expect(extractHighlights(body)).toBe("New **Coil** scene.\n\n- Output window");
  });

  it("stops at the next heading", () => {
    expect(extractHighlights("## Highlights\nOne\n## Other\nTwo")).toBe("One");
  });

  it("is empty for an untouched template or no section", () => {
    expect(extractHighlights("## Highlights\n\n<!-- write here -->\n\n---\nfooter")).toBe("");
    expect(extractHighlights("Merging this deploys Stable.")).toBe("");
    expect(extractHighlights(null)).toBe("");
  });
});

describe("addedSceneUnits", () => {
  it("reads registered scene imports added by a diff", () => {
    const diff = [
      "@@ -1,3 +1,4 @@",
      '+import { coilScene } from "./coil/index.ts";',
      '-import { oldScene } from "./old.ts";',
      '+import { collectPrivateScenes } from "./privateScenes.ts";',
      "+registerScene(coilScene);",
    ].join("\n");
    expect(addedSceneUnits(diff)).toEqual(["coil"]);
  });
});

describe("sceneNameFromSource", () => {
  it("reads the name after id", () => {
    expect(sceneNameFromSource('  return {\n    id: ID,\n    name: "Coil",\n')).toBe("Coil");
    expect(sceneNameFromSource('{ id: "x", name: "Physarum 2" }')).toBe("Physarum 2");
    expect(sceneNameFromSource('export const s = createFullscreenScene(\n  "moire2",\n  "Moiré 2",\n  FRAG);')).toBe("Moiré 2");
    expect(sceneNameFromSource("const name = 'nope';")).toBeNull();
  });
});

describe("areaOfFile", () => {
  it("sorts files into product areas", () => {
    expect(areaOfFile("src/render/scenes/caustics.ts")).toBe("scenes");
    expect(areaOfFile("docs/scenes/coil.md")).toBe("scenes");
    expect(areaOfFile("src/audio/features.ts")).toBe("sound");
    expect(areaOfFile("src/render/drives.ts")).toBe("sound");
    expect(areaOfFile("src/net/outputSync.ts")).toBe("output");
    expect(areaOfFile("server/room.ts")).toBe("output");
    expect(areaOfFile("src/ui/deviceMenu.ts")).toBe("app");
    expect(areaOfFile(".github/workflows/release.yml")).toBe("other");
    expect(areaOfFile("tests/drives.test.ts")).toBeNull();
  });
});

describe("categorize", () => {
  const sceneNames = ["Caustics", "Storm", "Physarum 2", "Coil"];

  it("puts a scene registration under new scenes", () => {
    expect(categorize({ subject: "Coil: a shell coil (#209)", files: [], newScenes: ["coil"], sceneNames })).toBe("newScene");
  });

  it("trusts a title prefix that names a scene, whatever files moved", () => {
    expect(categorize({ subject: "Caustics & Storm: remove Drop (#215)", files: ["src/ui/a.ts", "src/ui/b.ts"], sceneNames })).toBe("scenes");
    expect(categorize({ subject: "Physarum 2: Crawl speed (#243)", files: ["src/ui/a.ts"], sceneNames })).toBe("scenes");
  });

  it("trusts a title prefix that names an area", () => {
    expect(categorize({ subject: "Output: Resolution slider (#237)", files: ["src/ui/a.ts", "src/ui/b.ts"], sceneNames })).toBe("output");
    expect(categorize({ subject: "Pop-out output window with Cue / Go (#227)", files: ["src/ui/a.ts"], sceneNames })).toBe("output");
    expect(categorize({ subject: "Drive graphs: one scale (#242)", files: ["src/ui/a.ts"], sceneNames })).toBe("sound");
  });

  it("otherwise goes by the most touched product files, tests ignored", () => {
    const files = ["src/ui/a.ts", "src/ui/b.ts", "src/net/x.ts", "tests/a.test.ts", "tests/b.test.ts", "tests/c.test.ts"];
    expect(categorize({ subject: "Panel blur: opt-in switch", files, sceneNames })).toBe("app");
  });

  it("is docs & tooling only when no product file moved", () => {
    expect(categorize({ subject: "Wrap: status snapshot", files: ["docs/status.md", "tools/x.mjs"], sceneNames })).toBe("other");
    expect(categorize({ subject: "Launch prep: README", files: ["README.md", "a.md", "src/ui/gallery.ts"], sceneNames })).toBe("app");
  });
});

describe("formatEntry", () => {
  it("matches the GitHub CLI's release lines", () => {
    expect(formatEntry({ subject: "Coil: a coil (#209)", pr: 209, author: "someone" })).toBe("* Coil: a coil by @someone in #209");
    expect(formatEntry({ subject: "Direct push", pr: null, author: null, sha: "abcdef1234" })).toBe("* Direct push (abcdef1)");
  });
});

describe("renderNotes", () => {
  it("puts highlights first, then categories in page order, scene versions, the compare link", () => {
    const notes = renderNotes({
      highlights: "Big release.",
      entries: [
        { subject: "Tools: x (#3)", pr: 3, author: "a", category: "other" },
        { subject: "Storm: b (#2)", pr: 2, author: "a", category: "scenes" },
        { subject: "Caustics: a (#1)", pr: 1, author: "a", category: "scenes" },
        { subject: "Coil (#4)", pr: 4, author: "a", category: "newScene" },
      ],
      sceneVersions: [{ unit: "coil", name: "Coil", version: "0.1.0" }],
      repo: "o/r",
      prevTag: "v0.1.0",
      tag: "v0.2.0",
    });
    const order = ["Big release.", "## What's Changed", "New scenes", "* Caustics: a", "* Storm: b", "Docs & tooling", "| Coil (`coil`) | 0.1.0 |", "compare/v0.1.0...v0.2.0"];
    const at = order.map((s) => notes.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(notes).not.toContain("Sound & beat");
  });

  it("says so when nothing changed", () => {
    expect(renderNotes({ entries: [] })).toContain("Nothing new since the last release");
  });
});
