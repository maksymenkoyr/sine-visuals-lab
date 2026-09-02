import { describe, it, expect } from "vitest";
import {
  patchSceneDefaults,
  locateSceneFile,
  SPEC_SCAN_LIMIT,
  type SceneFileCandidate,
} from "../sceneDefaultsPatch.ts";

// Fixtures shaped like real settings arrays (meshGrid.ts's plain SETTINGS,
// caustics.ts's standalone-driver-plus-SETTINGS) — never read the actual
// scene files here, since this test would then break every time someone
// retunes a scene.
const BASIC = `import type { SceneSetting } from "../sceneSettings.ts";

const ID = "mesh";

const SETTINGS: SceneSetting[] = [
  {
    key: "waveHeight",
    label: "Wave Height",
    min: 0,
    max: 5,
    step: 0.1,
    default: 1.5,
  },
  {
    key: "valley",
    label: "Valley",
    min: -1,
    max: 1,
    step: 0.1,
    default: 0,
  },
  {
    key: "cameraTilt",
    label: "Camera Tilt",
    min: -90,
    max: 90,
    step: 0.5,
    default: -26.5, // negative decimal
  },
];

export const meshScene = createFullscreenScene(ID, "Mesh", FRAG, { settings: SETTINGS });
`;

const WITH_DRIVER = `const SPARKLE: SceneSetting = {
  key: "sparkle",
  label: "Sparkle",
  min: 0,
  max: 1,
  step: 0.01,
  default: 0.4,
};

const SETTINGS: SceneSetting[] = [
  {
    key: "focus",
    label: "Focus",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.7,
  },
  SPARKLE,
  {
    key: "drift",
    label: "Drift",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.1, // -> the old fixed value, kept as a note
  },
];

export const causticsScene = createFullscreenScene("caustics", "Caustics", FRAG, { settings: SETTINGS });
`;

describe("patchSceneDefaults", () => {
  it("rewrites one literal, leaving the rest of the file byte-identical", () => {
    const out = patchSceneDefaults(BASIC, [{ key: "waveHeight", from: 1.5, to: 3.8 }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain('key: "waveHeight"');
    expect(out.text).toContain("default: 3.8,");
    expect(out.text).not.toContain("default: 1.5,");
    // Everything else byte-identical.
    const untouched = BASIC.replace("default: 1.5,", "default: 3.8,");
    expect(out.text).toBe(untouched);
    expect(out.results).toEqual([{ key: "waveHeight", status: "applied" }]);
  });

  it("preserves a trailing comment and the comma when rewriting", () => {
    const out = patchSceneDefaults(BASIC, [{ key: "cameraTilt", from: -26.5, to: 12.25 }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("default: 12.25, // negative decimal");
  });

  it("handles negative and decimal values on both ends", () => {
    const out = patchSceneDefaults(BASIC, [{ key: "valley", from: 0, to: -0.75 }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("default: -0.75,");
  });

  it("matches default: 1.0, when from is 1", () => {
    const src = BASIC.replace("default: 1.5,", "default: 1.0,");
    const out = patchSceneDefaults(src, [{ key: "waveHeight", from: 1, to: 2 }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("default: 2,");
  });

  it("refuses the whole payload on a from mismatch, reporting the found value", () => {
    const out = patchSceneDefaults(BASIC, [{ key: "waveHeight", from: 9.9, to: 3.8 }]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.results).toEqual([{ key: "waveHeight", status: "from-mismatch", found: 1.5 }]);
  });

  it("is idempotent: current already equal to `to` emits no edit", () => {
    const out = patchSceneDefaults(BASIC, [{ key: "waveHeight", from: 1.5, to: 1.5 }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toBe(BASIC);
    expect(out.results).toEqual([{ key: "waveHeight", status: "already" }]);
  });

  it("reports key-missing for an unknown key and refuses the payload", () => {
    const out = patchSceneDefaults(BASIC, [{ key: "nope", from: 0, to: 1 }]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.results).toEqual([{ key: "nope", status: "key-missing" }]);
  });

  it("reports key-ambiguous for a duplicated key", () => {
    const dup =
      BASIC +
      `\nconst DUP: SceneSetting = {\n  key: "waveHeight",\n  default: 2,\n};\n`;
    const out = patchSceneDefaults(dup, [{ key: "waveHeight", from: 1.5, to: 3 }]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.results).toEqual([{ key: "waveHeight", status: "key-ambiguous" }]);
  });

  it("does not reach into the next object when a spec has no default:", () => {
    const noDefault = `const SETTINGS: SceneSetting[] = [
  {
    key: "alpha",
    label: "Alpha",
    min: 0,
    max: 1,
  },
  {
    key: "beta",
    label: "Beta",
    min: 0,
    max: 1,
    default: 5,
  },
];
`;
    const out = patchSceneDefaults(noDefault, [{ key: "alpha", from: 0, to: 1 }]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.results).toEqual([{ key: "alpha", status: "default-missing" }]);
  });

  it("patches the standalone driver-spec shape (caustics.ts's SPARKLE)", () => {
    const out = patchSceneDefaults(WITH_DRIVER, [{ key: "sparkle", from: 0.4, to: 0.6 }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toMatch(/key: "sparkle",[\s\S]*?default: 0\.6,/);
  });

  it("applies several edits in one call, safe against offset collisions", () => {
    const out = patchSceneDefaults(WITH_DRIVER, [
      { key: "focus", from: 0.7, to: 0.9 },
      { key: "sparkle", from: 0.4, to: 0.15 },
      { key: "drift", from: 0.1, to: 0.35 },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toMatch(/key: "focus",[\s\S]*?default: 0\.9,/);
    expect(out.text).toMatch(/key: "sparkle",[\s\S]*?default: 0\.15,/);
    expect(out.text).toMatch(/key: "drift",[\s\S]*?default: 0\.35, \/\/ -> the old fixed value, kept as a note/);
    expect(out.results).toEqual([
      { key: "focus", status: "applied" },
      { key: "sparkle", status: "applied" },
      { key: "drift", status: "applied" },
    ]);
  });

  it("ignores a key: occurrence that isn't a line of its own (e.g. commented out)", () => {
    // KEY_RE is line-anchored — a "key:" that isn't alone on its line (a
    // trailing comment, or embedded in other code) never counts as a real
    // occurrence, so it can't create a false ambiguity or a false match.
    const withComment = `  // key: "waveHeight", old approach, kept for reference\n` + BASIC;
    const out = patchSceneDefaults(withComment, [{ key: "waveHeight", from: 1.5, to: 3.8 }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.text).toContain("default: 3.8,");
    expect(out.results).toEqual([{ key: "waveHeight", status: "applied" }]);
  });

  it("leaves a far-below default: line alone, bounded by the region cap", () => {
    const padding = "// padding\n".repeat(Math.ceil((SPEC_SCAN_LIMIT + 200) / "// padding\n".length));
    const src = `const SETTINGS: SceneSetting[] = [
  {
    key: "alpha",
    label: "Alpha",
  },
];
${padding}
default: 999,
`;
    const out = patchSceneDefaults(src, [{ key: "alpha", from: 0, to: 1 }]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.results).toEqual([{ key: "alpha", status: "default-missing" }]);
  });
});

describe("locateSceneFile", () => {
  const mesh: SceneFileCandidate = { path: "src/render/scenes/meshGrid.ts", text: BASIC };
  const caustics: SceneFileCandidate = { path: "src/render/scenes/caustics.ts", text: WITH_DRIVER };

  it("returns the single candidate containing every key", () => {
    const out = locateSceneFile([mesh, caustics], "mesh", ["waveHeight", "valley"]);
    expect(out).toEqual({ ok: true, path: mesh.path, text: mesh.text });
  });

  it("breaks a tie on the scene id string literal", () => {
    // Both files share a "focus"-shaped key coincidentally by adding one to mesh.
    const meshWithFocus: SceneFileCandidate = {
      path: "src/render/scenes/other.ts",
      text: BASIC.replace('key: "valley"', 'key: "focus"'),
    };
    const out = locateSceneFile([meshWithFocus, caustics], "caustics", ["focus"]);
    expect(out).toEqual({ ok: true, path: caustics.path, text: caustics.text });
  });

  it("reports no-match when no candidate has every key", () => {
    const out = locateSceneFile([mesh, caustics], "mesh", ["doesNotExist"]);
    expect(out).toEqual({ ok: false, reason: "no-match", paths: [] });
  });

  it("reports ambiguous when the id tie-break still can't decide", () => {
    const meshWithFocus: SceneFileCandidate = {
      path: "src/render/scenes/other.ts",
      text: BASIC.replace('key: "valley"', 'key: "focus"'),
    };
    const out = locateSceneFile([meshWithFocus, caustics], "neither-scene", ["focus"]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("ambiguous");
    expect(out.paths.sort()).toEqual([caustics.path, meshWithFocus.path].sort());
  });
});
