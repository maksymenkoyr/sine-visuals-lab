import { describe, expect, it } from "vitest";
import { collectPrivateScenes } from "../src/render/scenes/privateScenes.ts";
import type { Scene } from "../src/render/scene.ts";

function fakeScene(id: string): Scene {
  return {
    id,
    name: id.toUpperCase(),
    init() {},
    render() {},
    dispose() {},
  } as unknown as Scene;
}

describe("collectPrivateScenes", () => {
  it("returns nothing, with no errors, when no private scenes are checked out", () => {
    expect(collectPrivateScenes({}, new Set(["spectrum"]))).toEqual({ scenes: [], draftIds: [], errors: [] });
  });

  it("collects each module's scene in path order, and only the ones marked draft as drafts", () => {
    const out = collectPrivateScenes(
      {
        "./private/zeta/index.ts": { scene: fakeScene("zeta") },
        "./private/alpha/index.ts": { scene: fakeScene("alpha"), draft: true },
      },
      new Set(),
    );
    expect(out.scenes.map((s) => s.id)).toEqual(["alpha", "zeta"]);
    expect(out.draftIds).toEqual(["alpha"]);
    expect(out.errors).toEqual([]);
  });

  it("skips a module that doesn't export a valid scene, and says which one", () => {
    const out = collectPrivateScenes(
      {
        "./private/empty/index.ts": {},
        "./private/half/index.ts": { scene: { id: "half", name: "Half" } },
        "./private/good/index.ts": { scene: fakeScene("good") },
      },
      new Set(),
    );
    expect(out.scenes.map((s) => s.id)).toEqual(["good"]);
    expect(out.errors).toHaveLength(2);
    expect(out.errors.join("\n")).toContain("./private/empty/index.ts");
    expect(out.errors.join("\n")).toContain("./private/half/index.ts");
  });

  it("never lets a private scene replace a built-in one or an earlier private one", () => {
    const out = collectPrivateScenes(
      {
        "./private/a/index.ts": { scene: fakeScene("spectrum") },
        "./private/b/index.ts": { scene: fakeScene("dup") },
        "./private/c/index.ts": { scene: fakeScene("dup") },
      },
      new Set(["spectrum"]),
    );
    expect(out.scenes.map((s) => s.id)).toEqual(["dup"]);
    expect(out.errors).toHaveLength(2);
    expect(out.errors[0]).toContain('"spectrum"');
    expect(out.errors[1]).toContain("./private/c/index.ts");
  });

  it("treats only draft === true as a draft", () => {
    const out = collectPrivateScenes(
      { "./private/x/index.ts": { scene: fakeScene("x"), draft: "yes" } },
      new Set(),
    );
    expect(out.draftIds).toEqual([]);
  });

  it("doesn't mutate the taken-ids set it was given", () => {
    const taken = new Set(["spectrum"]);
    collectPrivateScenes({ "./private/n/index.ts": { scene: fakeScene("new") } }, taken);
    expect([...taken]).toEqual(["spectrum"]);
  });
});
