import { describe, it, expect } from "vitest";
import { SIGNALS, type SignalId } from "../src/render/signals.ts";
import { listScenes } from "../src/render/scene.ts";
import { SOURCE_SIGNAL } from "../src/render/beatListener.ts";
import { CUT_MODE } from "../src/render/scenes/shards/layout.ts";
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
    const knownRows = new Set(["section", "tempo", "hits", "centroid", "onset", "wave", "tempoLevel", "lock"]);
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

  it("every bandRange is one of the values spectrumStrip's highlight understands", () => {
    // "all"/"low" are the only two the caller (deviceMenu.ts) resolves
    // today — a typo'd third value would otherwise silently fall through
    // to "no highlight" instead of failing here.
    const known = new Set(["all", "low", "mid", "high"]);
    for (const spec of Object.values(SIGNALS)) {
      if (spec.bandRange === undefined) continue;
      expect(known.has(spec.bandRange)).toBe(true);
    }
  });

  // Caustics' old "Ripple source" dial (a continuous blend between two
  // trigger signals) is gone — its `reads` pair moved with it. Ripple's
  // trigger is now a drive choice (SceneSetting.drive, tests/drives.test.ts
  // covers the identity at its Scene default); this file only owns the
  // catalogue itself, so there's nothing scene-specific left to check here.

  it("shards' Cut on reads both broadband and bass signals, with complementary activeWhen", () => {
    const scenes = listScenes();
    const shards = scenes.find((s) => s.id === "shards")!;
    const cutMode = shards.settings!.find((s) => s.key === "cutMode")!;
    const links = cutMode.reads ?? [];
    expect(links.length).toBe(2);

    const idsOf = links.map((l) => (typeof l === "string" ? l : l.signal));
    expect(idsOf.sort()).toEqual(["anim.lowOnset", "feature.onset"].sort());

    // Bass hits (CUT_MODE.BASS) switches which signal is "active"; the two
    // links must disagree at every mode, not just report both as live.
    for (const mode of [CUT_MODE.BEAT, CUT_MODE.BASS, CUT_MODE.BARS]) {
      const get = (key: string) => (key === "cutMode" ? mode : 0);
      const active = links.map((l) => (typeof l === "string" ? true : l.activeWhen(get)));
      expect(active.filter(Boolean).length).toBe(1);
    }
  });

  it("every beatListener.ts SOURCE_SIGNAL entry resolves in SIGNALS", () => {
    for (const id of Object.values(SOURCE_SIGNAL)) {
      expect(SIGNALS[id!]).toBeDefined();
    }
  });
});
