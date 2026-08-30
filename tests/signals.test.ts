import { describe, it, expect } from "vitest";
import { SIGNALS, type SignalId } from "../src/render/signals.ts";
import { listScenes } from "../src/render/scene.ts";
// Side-effect import: registers every scene (src/render/scenes/index.ts's
// own header comment) so listScenes() below sees the full set, not just
// whichever scene another test file happened to import first.
import "../src/render/scenes/index.ts";

describe("signals registry", () => {
  it("every entry's own id matches its key", () => {
    for (const id of Object.keys(SIGNALS) as SignalId[]) {
      expect(SIGNALS[id].id).toBe(id);
    }
  });

  it("every monitor anchor names a real meter card and row", async () => {
    // audioMeters.ts is a DOM module (imports @fontsource CSS, touches
    // document at call time) — importing it here only to read the type-level
    // MeterCardId/MeterRowId unions back out isn't possible at runtime (they
    // don't exist as values), so this instead hand-maintains the same two
    // small sets signals.ts's own MeterCardId/MeterRowId comments describe,
    // and fails loudly if they ever drift — the two are meant to change
    // together, rarely, both by hand.
    const knownCards = new Set(["scope", "signal", "lufs", "rhythm", "character"]);
    const knownRows = new Set(["section", "tempo", "hits", "centroid"]);
    for (const spec of Object.values(SIGNALS)) {
      if (!spec.monitor) continue;
      expect(knownCards.has(spec.monitor.card)).toBe(true);
      expect(knownRows.has(spec.monitor.row)).toBe(true);
    }
  });

  it("every SceneSetting.reads entry, on every registered scene, resolves in SIGNALS", () => {
    // This is the test that earns the framework its keep: a `reads` id that
    // doesn't (or no longer) match a SIGNALS key would otherwise surface as
    // a silently blank pill in the panel instead of a build failure.
    const scenes = listScenes();
    expect(scenes.length).toBeGreaterThan(0);
    for (const scene of scenes) {
      for (const spec of scene.settings ?? []) {
        for (const link of spec.reads ?? []) {
          const id = typeof link === "string" ? link : link.signal;
          expect(
            SIGNALS[id],
            `${scene.id}'s "${spec.key}" setting reads unknown signal "${id}"`,
          ).toBeDefined();
        }
      }
    }
  });

  it("caustics' Beat ripple and Ripple source both read the signals the trigger logic actually uses", () => {
    const scenes = listScenes();
    const caustics = scenes.find((s) => s.id === "caustics")!;
    const ripple = caustics.settings!.find((s) => s.key === "ripple")!;
    const rippleSrc = caustics.settings!.find((s) => s.key === "rippleSrc")!;

    const idsOf = (spec: typeof ripple) =>
      (spec.reads ?? []).map((l) => (typeof l === "string" ? l : l.signal));

    expect(idsOf(ripple).sort()).toEqual(["anim.dropOnset", "anim.lowOnset", "feature.beat"].sort());
    expect(idsOf(rippleSrc).sort()).toEqual(["anim.lowOnset", "feature.beat"].sort());
  });
});
