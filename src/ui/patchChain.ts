/**
 * The chain a focus lights in the controls panel's patch bay (deviceMenu.ts).
 * The panel has three columns: input nodes (the meters), shaping nodes (the
 * middle column, shapingColumn.ts) and settings (the scene's drive rows). A
 * focus is one thing the user points at, and its chain is everything that
 * feeds into it or that it feeds, across the columns:
 *
 * - focusing an input shows its shaping nodes, and every setting wired to
 *   the input or to one of those nodes;
 * - focusing a shaping node shows its input and every setting wired to it;
 * - focusing a setting shows its wires' shaping nodes, and the inputs those
 *   nodes read, plus any input wired to it directly.
 *
 * This module only works out which keys and ids are on the chain, from a
 * plain description of the patch (ChainGraph). deviceMenu.ts builds that
 * graph from the store and the drive rows, and paints the result: glows what
 * is on the chain and draws the cables that run along it.
 */

/** What is focused: one input row (its jacks' keys — a Hits row has several), a shaping node, or a setting. */
export type ChainFocus = { kind: "input"; keys: readonly string[] } | { kind: "node"; id: string } | { kind: "setting"; key: string };

/** The patch as plain keys: each shaping node with its own jack key and its input's jack key, and each wired setting with its wires' jack keys. */
export interface ChainGraph {
  nodes: readonly { id: string; key: string; inputKey: string }[];
  settings: readonly { key: string; wireKeys: readonly string[] }[];
}

export interface Chain {
  /** Input jack keys on the chain. */
  inputs: ReadonlySet<string>;
  /** Shaping node ids on the chain. */
  nodes: ReadonlySet<string>;
  /** Setting keys on the chain. */
  settings: ReadonlySet<string>;
  /** Jack keys whose wires to the chain's settings should draw as a fan: an input focus's own keys and its nodes' keys; a node focus's own key; none for a setting focus (its cables already draw). */
  fanKeys: ReadonlySet<string>;
}

export function chainOf(graph: ChainGraph, focus: ChainFocus): Chain {
  const inputs = new Set<string>();
  const nodes = new Set<string>();
  const settings = new Set<string>();
  const fanKeys = new Set<string>();

  if (focus.kind === "input") {
    const keys = new Set(focus.keys);
    for (const k of keys) {
      inputs.add(k);
      fanKeys.add(k);
    }
    for (const n of graph.nodes) {
      if (!keys.has(n.inputKey)) continue;
      nodes.add(n.id);
      fanKeys.add(n.key);
    }
    const reachKeys = new Set([...keys, ...fanKeys]);
    for (const s of graph.settings) {
      if (s.wireKeys.some((k) => reachKeys.has(k))) settings.add(s.key);
    }
  } else if (focus.kind === "node") {
    const node = graph.nodes.find((n) => n.id === focus.id);
    nodes.add(focus.id);
    if (node) {
      inputs.add(node.inputKey);
      fanKeys.add(node.key);
      for (const s of graph.settings) if (s.wireKeys.includes(node.key)) settings.add(s.key);
    }
  } else {
    settings.add(focus.key);
    const setting = graph.settings.find((s) => s.key === focus.key);
    if (setting) {
      for (const wireKey of setting.wireKeys) {
        const node = graph.nodes.find((n) => n.key === wireKey);
        if (node) {
          nodes.add(node.id);
          inputs.add(node.inputKey);
        } else {
          inputs.add(wireKey);
        }
      }
    }
  }

  return { inputs, nodes, settings, fanKeys };
}
