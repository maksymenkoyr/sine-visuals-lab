import { describe, expect, it } from "vitest";
import type { StemRanges, StemSplitter } from "../audio-subsystem/src/stemSplit.ts";
import { driveSettingFromChoice, type DriveSetting } from "../src/render/drives.ts";
import { setDriveSetting, setSourceMuted } from "../src/render/driveStore.ts";
import type { SceneSetting } from "../src/render/sceneSettings.ts";
import type { SignalId } from "../src/render/signals.ts";
import { createStemGate, wiresReadStems } from "../src/render/stemReaders.ts";

// The store is module-wide, so every test uses its own scene id.

const GLOW: SceneSetting = {
  key: "glow",
  label: "Glow",
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.5,
  drive: { default: "anim.energy" },
};

function builtIn(sceneSources: readonly SignalId[]): SceneSetting {
  return {
    key: "swirl",
    label: "Swirl",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "scene", sceneLabel: "Scene: its own mix", sceneSources },
  };
}

describe("wiresReadStems", () => {
  it("is false for a scene wired to other signals", () => {
    expect(wiresReadStems("stems-none", [GLOW])).toBe(false);
  });

  it("is true once a setting is wired to Hats or Lead", () => {
    setDriveSetting("stems-hats", GLOW, driveSettingFromChoice("anim.hats"));
    expect(wiresReadStems("stems-hats", [GLOW])).toBe(true);
    const both: DriveSetting = { mix: "add", sources: [{ choice: "anim.energy", weight: 1 }, { choice: "anim.lead", weight: 0.5 }] };
    setDriveSetting("stems-lead", GLOW, both);
    expect(wiresReadStems("stems-lead", [GLOW])).toBe(true);
  });

  it("ignores a muted Hats source", () => {
    setDriveSetting("stems-muted", GLOW, driveSettingFromChoice("anim.hats"));
    setSourceMuted("stems-muted", GLOW, 0, true);
    expect(wiresReadStems("stems-muted", [GLOW])).toBe(false);
  });

  it("counts a built-in reaction that lists Lead in its sceneSources", () => {
    expect(wiresReadStems("stems-builtin", [builtIn(["anim.lead"])])).toBe(true);
    expect(wiresReadStems("stems-builtin-mid", [builtIn(["anim.mid"])])).toBe(false);
  });
});

describe("createStemGate", () => {
  const RANGES: StemRanges = { hats: { lo: 4000, hi: 16000 }, lead: { lo: 250, hi: 4000 } };
  const BINS = new Float32Array(8);

  function spy(): StemSplitter & { updates: number; resets: number } {
    const out = { hats: 0.5, lead: 0.25 };
    return {
      updates: 0,
      resets: 0,
      update() {
        this.updates++;
        return out;
      },
      reset() {
        this.resets++;
      },
    };
  }

  it("never calls update while nothing reads, and says so", () => {
    const s = spy();
    const gate = createStemGate(s);
    for (let i = 0; i < 10; i++) expect(gate.update(false, BINS, i / 60, RANGES)).toBeNull();
    expect(s.updates).toBe(0);
    expect(gate.measured()).toBe(false);
  });

  it("runs the split while read, resetting it once on the way back from idle", () => {
    const s = spy();
    const gate = createStemGate(s);
    expect(gate.update(true, BINS, 0, RANGES)).toEqual({ hats: 0.5, lead: 0.25 });
    expect(s.resets).toBe(0); // a gate that was never idle has nothing to forget
    gate.update(false, BINS, 1, RANGES);
    gate.update(true, BINS, 2, RANGES);
    gate.update(true, BINS, 3, RANGES);
    expect(s.resets).toBe(1);
    expect(s.updates).toBe(3);
    expect(gate.measured()).toBe(true);
  });
});
