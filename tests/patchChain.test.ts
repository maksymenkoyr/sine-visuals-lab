import { describe, expect, it } from "vitest";
import { chainOf, type ChainGraph } from "../src/ui/patchChain.ts";

// Two input jacks (a, b), two shaping nodes (n1 reads a, n2 reads b), and
// three settings: s1 wired straight to a, s2 wired through n1, s3 wired to
// n2 and to a directly.
const graph: ChainGraph = {
  nodes: [
    { id: "n1", key: "shaped:n1", inputKey: "a" },
    { id: "n2", key: "shaped:n2", inputKey: "b" },
  ],
  settings: [
    { key: "s1", wireKeys: ["a"] },
    { key: "s2", wireKeys: ["shaped:n1"] },
    { key: "s3", wireKeys: ["shaped:n2", "a"] },
  ],
};

const sorted = (s: ReadonlySet<string>): string[] => [...s].sort();

describe("chainOf: input focus", () => {
  it("lists the input, the nodes that read it, and every setting on those", () => {
    const c = chainOf(graph, { kind: "input", keys: ["a"] });
    expect(sorted(c.inputs)).toEqual(["a"]);
    expect(sorted(c.nodes)).toEqual(["n1"]);
    expect(sorted(c.settings)).toEqual(["s1", "s2", "s3"]);
    expect(sorted(c.fanKeys)).toEqual(["a", "shaped:n1"]);
  });

  it("reaches a node's settings through the node only when the node's input is focused", () => {
    const c = chainOf(graph, { kind: "input", keys: ["b"] });
    expect(sorted(c.nodes)).toEqual(["n2"]);
    expect(sorted(c.settings)).toEqual(["s3"]);
    expect(sorted(c.fanKeys)).toEqual(["b", "shaped:n2"]);
  });

  it("takes every key of a multi-jack row", () => {
    const c = chainOf(graph, { kind: "input", keys: ["a", "b"] });
    expect(sorted(c.inputs)).toEqual(["a", "b"]);
    expect(sorted(c.nodes)).toEqual(["n1", "n2"]);
    expect(sorted(c.settings)).toEqual(["s1", "s2", "s3"]);
  });

  it("an input whose only path is through a node reaches that node's settings", () => {
    const only: ChainGraph = {
      nodes: [{ id: "n1", key: "shaped:n1", inputKey: "a" }],
      settings: [{ key: "s2", wireKeys: ["shaped:n1"] }],
    };
    const c = chainOf(only, { kind: "input", keys: ["a"] });
    expect(sorted(c.settings)).toEqual(["s2"]);
  });

  it("an input with nothing wired lights only itself", () => {
    const c = chainOf(graph, { kind: "input", keys: ["zz"] });
    expect(sorted(c.inputs)).toEqual(["zz"]);
    expect(c.nodes.size).toBe(0);
    expect(c.settings.size).toBe(0);
    expect(sorted(c.fanKeys)).toEqual(["zz"]);
  });
});

describe("chainOf: node focus", () => {
  it("lists the node, its input, and every setting wired to its jack", () => {
    const c = chainOf(graph, { kind: "node", id: "n1" });
    expect(sorted(c.nodes)).toEqual(["n1"]);
    expect(sorted(c.inputs)).toEqual(["a"]);
    expect(sorted(c.settings)).toEqual(["s2"]);
    expect(sorted(c.fanKeys)).toEqual(["shaped:n1"]);
  });

  it("an unknown node lights only its own id", () => {
    const c = chainOf(graph, { kind: "node", id: "nX" });
    expect(sorted(c.nodes)).toEqual(["nX"]);
    expect(c.inputs.size).toBe(0);
    expect(c.settings.size).toBe(0);
    expect(c.fanKeys.size).toBe(0);
  });
});

describe("chainOf: setting focus", () => {
  it("a setting wired straight to an input lists that input and no node", () => {
    const c = chainOf(graph, { kind: "setting", key: "s1" });
    expect(sorted(c.settings)).toEqual(["s1"]);
    expect(sorted(c.inputs)).toEqual(["a"]);
    expect(c.nodes.size).toBe(0);
    expect(c.fanKeys.size).toBe(0);
  });

  it("a setting wired through a node lists the node and the node's input", () => {
    const c = chainOf(graph, { kind: "setting", key: "s2" });
    expect(sorted(c.settings)).toEqual(["s2"]);
    expect(sorted(c.nodes)).toEqual(["n1"]);
    expect(sorted(c.inputs)).toEqual(["a"]);
  });

  it("a setting wired straight to an input and through a node lists both inputs", () => {
    const c = chainOf(graph, { kind: "setting", key: "s3" });
    expect(sorted(c.nodes)).toEqual(["n2"]);
    expect(sorted(c.inputs)).toEqual(["a", "b"]);
  });

  it("a setting not in the graph lights only itself", () => {
    const c = chainOf(graph, { kind: "setting", key: "sX" });
    expect(sorted(c.settings)).toEqual(["sX"]);
    expect(c.inputs.size).toBe(0);
    expect(c.nodes.size).toBe(0);
    expect(c.fanKeys.size).toBe(0);
  });
});
