/**
 * The chain a focus lights in the controls panel's patch bay (deviceMenu.ts):
 * input nodes (the meters) on one side, settings (the scene's drive rows) on
 * the other, and the wires between them, each carrying its own modifier
 * (src/render/wireMod.ts). A focus is one thing the user points at, and its
 * chain is everything wired to it:
 *
 * - focusing an input shows every setting wired to it;
 * - focusing a setting shows every input wired to it.
 *
 * This module only works out which keys are on the chain, from a plain
 * description of the patch (ChainGraph). deviceMenu.ts builds that graph from
 * the store and the drive rows, and paints the result: glows what is on the
 * chain and draws the cables that run along it.
 */

/** What is focused: one input row (its jacks' keys — a Hits row has several) or a setting. */
export type ChainFocus = { kind: "input"; keys: readonly string[] } | { kind: "setting"; key: string };

/** The patch as plain keys: each wired setting with its wires' jack keys. */
export interface ChainGraph {
  settings: readonly { key: string; wireKeys: readonly string[] }[];
}

export interface Chain {
  /** Input jack keys on the chain. */
  inputs: ReadonlySet<string>;
  /** Setting keys on the chain. */
  settings: ReadonlySet<string>;
  /** Jack keys whose wires to the chain's settings should draw as a fan: an input focus's own keys; none for a setting focus (its cables already draw). */
  fanKeys: ReadonlySet<string>;
}

export function chainOf(graph: ChainGraph, focus: ChainFocus): Chain {
  const inputs = new Set<string>();
  const settings = new Set<string>();
  const fanKeys = new Set<string>();

  if (focus.kind === "input") {
    for (const k of focus.keys) {
      inputs.add(k);
      fanKeys.add(k);
    }
    for (const s of graph.settings) {
      if (s.wireKeys.some((k) => fanKeys.has(k))) settings.add(s.key);
    }
  } else {
    settings.add(focus.key);
    const setting = graph.settings.find((s) => s.key === focus.key);
    for (const wireKey of setting?.wireKeys ?? []) inputs.add(wireKey);
  }

  return { inputs, settings, fanKeys };
}
