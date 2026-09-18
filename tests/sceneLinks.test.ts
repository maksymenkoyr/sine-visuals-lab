import { describe, it, expect } from "vitest";
import { scenesInFlight } from "../vite-scene-links-plugin.ts";

const closures = new Map<string, Set<string>>([
  ["chladni", new Set(["/s/chladni.ts", "/s/shared.ts", "/render/gl.ts"])],
  ["caustics", new Set(["/s/caustics.ts", "/s/shared.ts", "/render/gl.ts"])],
  ["kaleidoscope", new Set(["/s/kaleido/index.ts", "/s/kaleido/styles.ts", "/render/gl.ts"])],
]);

describe("scenesInFlight", () => {
  it("nominates the scene whose private file changed", () => {
    expect(scenesInFlight(["/s/caustics.ts"], closures)).toEqual(["caustics"]);
  });

  it("follows a scene's imports, not just its entry file", () => {
    expect(scenesInFlight(["/s/kaleido/styles.ts"], closures)).toEqual(["kaleidoscope"]);
  });

  it("ignores files shared by several scenes", () => {
    expect(scenesInFlight(["/s/shared.ts", "/render/gl.ts"], closures)).toEqual([]);
  });

  it("returns several scenes in registry order, each once", () => {
    const changed = ["/s/kaleido/index.ts", "/s/chladni.ts", "/s/kaleido/styles.ts"];
    expect(scenesInFlight(changed, closures)).toEqual(["chladni", "kaleidoscope"]);
  });

  it("returns nothing when nothing relevant changed", () => {
    expect(scenesInFlight([], closures)).toEqual([]);
    expect(scenesInFlight(["/s/unknown.ts"], closures)).toEqual([]);
  });
});
