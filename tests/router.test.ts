import { describe, it, expect } from "vitest";
import { parseRoute, routeToHash, hashQuery, parseOptions } from "../src/router.ts";

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

  it("resolves the scene when the hash carries a query string", () => {
    // Every documented tuning URL used to be written this way, and the id
    // used to swallow the whole tail — see docs/tuning.md.
    expect(parseRoute("#/v/mesh?audio=synthetic&bpm=120")).toEqual({ kind: "viz", sceneId: "mesh" });
    expect(parseRoute("#/v/mesh/?audio=synthetic")).toEqual({ kind: "viz", sceneId: "mesh" });
    expect(parseRoute("#/v/mesh&audio=synthetic")).toEqual({ kind: "viz", sceneId: "mesh" });
  });

  it("round-trips through routeToHash for canonical forms", () => {
    for (const hash of ["#/", "#/v/tunnel", "#/v/particles"]) {
      expect(routeToHash(parseRoute(hash))).toBe(hash);
    }
  });
});

describe("hashQuery", () => {
  it("returns everything after the first ? or &, or empty", () => {
    expect(hashQuery("#/v/mesh?audio=synthetic&bpm=120")).toBe("audio=synthetic&bpm=120");
    expect(hashQuery("#/v/mesh&audio=synthetic")).toBe("audio=synthetic");
    expect(hashQuery("#/v/mesh")).toBe("");
    expect(hashQuery("")).toBe("");
  });
});

describe("parseOptions", () => {
  it("reads options from the real query string", () => {
    expect(parseOptions("?audio=synthetic&bpm=120", "#/v/mesh").get("audio")).toBe("synthetic");
  });

  it("reads options the hash carries, which is the form the tuning docs used", () => {
    const options = parseOptions("", "#/v/mesh?audio=synthetic&bpm=120");
    expect(options.get("audio")).toBe("synthetic");
    expect(options.get("bpm")).toBe("120");
  });

  it("prefers the real query string on conflict", () => {
    expect(parseOptions("?bpm=90", "#/v/mesh?bpm=120").get("bpm")).toBe("90");
  });

  it("still merges non-conflicting keys from both sides", () => {
    const options = parseOptions("?room=ABCD", "#/v/mesh?audio=synthetic");
    expect(options.get("room")).toBe("ABCD");
    expect(options.get("audio")).toBe("synthetic");
  });

  it("is empty when neither side carries anything", () => {
    expect([...parseOptions("", "#/v/mesh")]).toEqual([]);
  });
});
