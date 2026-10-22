import { describe, expect, it } from "vitest";
import { chainOf, type ChainGraph } from "../src/ui/patchChain.ts";

// Two input jacks (a, b) and three settings: s1 wired to a, s2 to b, s3 to
// both.
const graph: ChainGraph = {
  settings: [
    { key: "s1", wireKeys: ["a"] },
    { key: "s2", wireKeys: ["b"] },
    { key: "s3", wireKeys: ["b", "a"] },
  ],
};

const sorted = (s: ReadonlySet<string>): string[] => [...s].sort();

describe("chainOf: input focus", () => {
  it("lists the input and every setting wired to it", () => {
    const c = chainOf(graph, { kind: "input", keys: ["a"] });
    expect(sorted(c.inputs)).toEqual(["a"]);
    expect(sorted(c.settings)).toEqual(["s1", "s3"]);
    expect(sorted(c.fanKeys)).toEqual(["a"]);
  });

  it("takes every key of a multi-jack row", () => {
    const c = chainOf(graph, { kind: "input", keys: ["a", "b"] });
    expect(sorted(c.inputs)).toEqual(["a", "b"]);
    expect(sorted(c.settings)).toEqual(["s1", "s2", "s3"]);
  });

  it("an input with nothing wired lights only itself", () => {
    const c = chainOf(graph, { kind: "input", keys: ["zz"] });
    expect(sorted(c.inputs)).toEqual(["zz"]);
    expect(c.settings.size).toBe(0);
    expect(sorted(c.fanKeys)).toEqual(["zz"]);
  });
});

describe("chainOf: setting focus", () => {
  it("lists every input wired to the setting, with no fan", () => {
    const c = chainOf(graph, { kind: "setting", key: "s3" });
    expect(sorted(c.settings)).toEqual(["s3"]);
    expect(sorted(c.inputs)).toEqual(["a", "b"]);
    expect(c.fanKeys.size).toBe(0);
  });

  it("a setting not in the graph lights only itself", () => {
    const c = chainOf(graph, { kind: "setting", key: "sX" });
    expect(sorted(c.settings)).toEqual(["sX"]);
    expect(c.inputs.size).toBe(0);
    expect(c.fanKeys.size).toBe(0);
  });
});
