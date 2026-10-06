import { describe, it, expect } from "vitest";
import {
  addedSceneUnits,
  areaOfFile,
  categorize,
  changesFromLog,
  extractHighlights,
  extractReleaseNotes,
  formatEntry,
  NOTES_END,
  parsePrMerge,
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
  it("puts the written notes first, then categories in page order, scene versions, the compare link", () => {
    const notes = renderNotes({
      notes: "Big release.",
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
    const order = ["Big release.", "## Every change", "New scenes", "* Caustics: a", "* Storm: b", "Docs & tooling", "| Coil (`coil`) | 0.1.0 |", "compare/v0.1.0...v0.2.0"];
    const at = order.map((s) => notes.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(notes).not.toContain("Sound & beat");
  });

  it("folds the generated parts under written notes, and only then", () => {
    const entries = [{ subject: "Coil (#4)", pr: 4, author: "a", category: "newScene" as const }];
    const sceneVersions = [{ unit: "coil", name: "Coil", version: "0.1.0" }];
    const written = renderNotes({ notes: "Big release.", entries, sceneVersions });
    expect(written.match(/<details>/g)).toHaveLength(2);
    expect(written.match(/<\/details>/g)).toHaveLength(2);
    expect(written).not.toContain("## What's Changed");
    const bare = renderNotes({ entries, sceneVersions });
    expect(bare).not.toContain("<details>");
    expect(bare).toContain("## What's Changed");
    expect(bare).toContain("## Scene versions");
  });

  it("says so when nothing changed", () => {
    expect(renderNotes({ entries: [] })).toContain("Nothing new since the last release");
  });
});

describe("extractReleaseNotes", () => {
  it("takes everything above the end line, headings and rules included, without comments", () => {
    const body = [
      "A lead.",
      "<!-- how to write this -->",
      "",
      "## Highlights",
      "### Pop-out window",
      "",
      "---",
      "",
      "## Also new",
      "- **Row** — more",
      `${NOTES_END}: everything above opens the GitHub Release -->`,
      "",
      "---",
      "Merge with a merge commit.",
    ].join("\r\n");
    expect(extractReleaseNotes(body)).toBe("A lead.\n\n## Highlights\n### Pop-out window\n\n---\n\n## Also new\n- **Row** — more");
  });

  it("is empty when only the placeholder comment is above the end line", () => {
    expect(extractReleaseNotes(`<!-- write here -->\n\n${NOTES_END} -->\n\n---\nfooter`)).toBe("");
  });

  it("falls back to the older Highlights section without the end line", () => {
    expect(extractReleaseNotes("## Highlights\nOne\n\n---\nfooter")).toBe("One");
  });
});

describe("parsePrMerge", () => {
  it("reads GitHub's merge commit: number, head branch, title from the body", () => {
    expect(parsePrMerge("Merge pull request #392 from me/worktree-gallery", "\nGallery: drafts\n")).toEqual({
      pr: 392,
      branch: "worktree-gallery",
      title: "Gallery: drafts",
    });
    expect(parsePrMerge("Merge pull request #7 from me/x", "")?.title).toBeNull();
    expect(parsePrMerge("Merge main into crossfades (stack base)", "")).toBeNull();
    expect(parsePrMerge("Coil: a coil (#209)", "")).toBeNull();
  });
});

describe("changesFromLog", () => {
  // main: m2 merges PR #2 (commits b1, b2, with a stack merge s1 inside it),
  // d1 is a direct push, q1 a squash-merged PR, r1 a release merge of main.
  const log = [
    { sha: "r1", parents: ["p0", "m2"], subject: "Merge pull request #9 from me/main", body: "Release to Stable" },
    { sha: "m2", parents: ["d1", "b2"], subject: "Merge pull request #2 from me/feature", body: "Feature: a thing" },
    { sha: "b2", parents: ["s1"], subject: "Feature: second step" },
    { sha: "s1", parents: ["b1", "x1"], subject: "Merge A (#5) into feature: stack" },
    { sha: "x1", parents: ["b1"], subject: "Stacked work" },
    { sha: "b1", parents: ["q1"], subject: "Feature: first step" },
    { sha: "d1", parents: ["q1"], subject: "Docs: a direct push" },
    { sha: "q1", parents: ["q0"], subject: "Older: squashed (#1)" },
  ];
  const own: Record<string, string[]> = { r1: ["m2", "b2", "s1", "x1", "b1", "d1", "q1"], m2: ["b2", "s1", "x1", "b1"], s1: ["x1"] };

  it("is one change per merged PR, plus uncovered single commits, newest first", () => {
    expect(changesFromLog(log, (sha) => own[sha] ?? [])).toEqual([
      { sha: "m2", base: "d1", pr: 2, subject: "Feature: a thing" },
      { sha: "d1", base: null, pr: null, subject: "Docs: a direct push" },
      { sha: "q1", base: null, pr: 1, subject: "Older: squashed (#1)" },
    ]);
  });
});
