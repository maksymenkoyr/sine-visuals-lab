import { describe, it, expect } from "vitest";
import { parseRoute, routeToHash } from "../src/router.ts";

describe("parseRoute", () => {
  it("treats empty, bare hash, and root as the gallery", () => {
    expect(parseRoute("")).toEqual({ kind: "gallery" });
    expect(parseRoute("#")).toEqual({ kind: "gallery" });
    expect(parseRoute("#/")).toEqual({ kind: "gallery" });
  });

  it("parses a viz route, tolerating a trailing slash and case", () => {
    expect(parseRoute("#/v/tunnel")).toEqual({ kind: "viz", sceneId: "tunnel" });
    expect(parseRoute("#/v/tunnel/")).toEqual({ kind: "viz", sceneId: "tunnel" });
    expect(parseRoute("#/v/TUNNEL")).toEqual({ kind: "viz", sceneId: "tunnel" });
  });

  it("falls back to the gallery for malformed or unrecognized routes", () => {
    expect(parseRoute("#/v/")).toEqual({ kind: "gallery" });
    expect(parseRoute("#/nope")).toEqual({ kind: "gallery" });
    expect(parseRoute("#/v/a/b")).toEqual({ kind: "gallery" });
  });

  it("does not validate the scene id against a registry — that's caller policy", () => {
    expect(parseRoute("#/v/not-a-real-scene")).toEqual({ kind: "viz", sceneId: "not-a-real-scene" });
  });

  it("round-trips through routeToHash for canonical forms", () => {
    for (const hash of ["#/", "#/v/tunnel", "#/v/particles"]) {
      expect(routeToHash(parseRoute(hash))).toBe(hash);
    }
  });
});
