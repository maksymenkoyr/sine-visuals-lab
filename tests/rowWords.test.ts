import { describe, it, expect } from "vitest";
import { describeRow, type RowNames } from "../src/ui/desk/rowWords.ts";
import type { LookRow } from "../src/net/lookDiff.ts";

const names: RowNames = {
  scene: (id) => `Scene ${id}`,
  palette: (id) => `Palette ${id}`,
  setting: (scope, key) => (scope === "caustics" && key === "density" ? "Density" : null),
};

describe("describeRow", () => {
  it("names a scene row and both palettes by their names", () => {
    const row: LookRow = { id: "scene", kind: "scene", from: "a", to: "b" };
    expect(describeRow(row, names)).toEqual({ name: "Scene", from: "Scene a", to: "Scene b" });
    const pal: LookRow = { id: "palette", kind: "palette", from: "neon", to: "ember" };
    expect(describeRow(pal, names)).toEqual({ name: "Palette", from: "Palette neon", to: "Palette ember" });
  });

  it("labels a scene setting by its spec label and formats numbers to two places", () => {
    const row: LookRow = { id: "e:vibe.sceneSettings|caustics|density", kind: "entry", storageKey: "vibe.sceneSettings", scope: "caustics", key: "density", from: 0.5, to: 1.234 };
    expect(describeRow(row, names)).toEqual({ name: "Density", from: "0.50", to: "1.23" });
  });

  it("falls back to the key for an unknown setting and shows a missing value as default", () => {
    const row: LookRow = { id: "e:vibe.sceneSettings|x|glow", kind: "entry", storageKey: "vibe.sceneSettings", scope: "x", key: "glow", from: undefined, to: 0 };
    expect(describeRow(row, names)).toEqual({ name: "glow", from: "default", to: "0.00" });
  });

  it("names a drive row's wires, and says which parts of a drive changed", () => {
    const row: LookRow = {
      id: "e:vibe.drives|caustics|density",
      kind: "entry",
      storageKey: "vibe.drives",
      scope: "caustics",
      key: "density",
      from: { patch: "bass", readout: "on" },
      to: { patch: "hats", threshold: 0.4, thresholdOn: true, windowMax: 2 },
    };
    expect(describeRow(row, names)).toEqual({ name: "Density wires", from: "as LIVE", to: "wires, reaction, window" });
  });

  it("maps line, smoothness and unknown drive fields to plain words, and deduplicates", () => {
    const row: LookRow = {
      id: "e:vibe.drives|caustics|density",
      kind: "entry",
      storageKey: "vibe.drives",
      scope: "caustics",
      key: "density",
      from: { line: 1, lineStrength: 1 },
      to: { line: 2, lineStrength: 2, smoothness: 3, mystery: 4 },
    };
    expect(describeRow(row, names).to).toBe("drawn line, smoothness, mystery");
  });

  it("reads a drive entry that exists on one side only as default on the other", () => {
    const added: LookRow = { id: "e:vibe.drives|caustics|density", kind: "entry", storageKey: "vibe.drives", scope: "caustics", key: "density", from: undefined, to: { patch: "bass" } };
    expect(describeRow(added, names)).toEqual({ name: "Density wires", from: "default", to: "wires" });
    const removed: LookRow = { id: "e:vibe.drives|caustics|density", kind: "entry", storageKey: "vibe.drives", scope: "caustics", key: "density", from: { patch: "bass" }, to: undefined };
    expect(describeRow(removed, names)).toEqual({ name: "Density wires", from: "as LIVE", to: "default" });
  });

  it("names the master and sensitivity keys, and strips vibe. from any other key", () => {
    const key = (storageKey: string, from: string | null, to: string | null): LookRow => ({ id: `k:${storageKey}`, kind: "key", storageKey, from, to });
    expect(describeRow(key("vibe.sceneMaster", "0.8", "1"), names).name).toBe("Master Scale");
    expect(describeRow(key("vibe.sceneExpansion", null, null), names).name).toBe("Master Expansion");
    expect(describeRow(key("vibe.sceneExpansionShape", null, null), names).name).toBe("Expansion shape");
    expect(describeRow(key("vibe.sensitivity", null, null), names).name).toBe("Sensitivity");
    expect(describeRow(key("vibe.expansion", null, null), names).name).toBe("Expansion");
    expect(describeRow(key("vibe.smoothing", null, null), names).name).toBe("Smoothing");
    expect(describeRow(key("vibe.glowThing", null, null), names).name).toBe("glowThing");
  });

  it("shows a key's value as default, as a number, as itself, or as changed when long", () => {
    const key = (from: string | null, to: string | null): LookRow => ({ id: "k:vibe.x", kind: "key", storageKey: "vibe.x", from, to });
    expect(describeRow(key(null, "2"), names)).toEqual({ name: "x", from: "default", to: "2.00" });
    expect(describeRow(key("  ", "true"), names)).toEqual({ name: "x", from: "  ", to: "true" });
    const long = "a".repeat(30);
    expect(describeRow(key(long, "b"), names)).toEqual({ name: "x", from: "changed", to: "b" });
  });
});
