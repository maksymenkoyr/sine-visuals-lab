import { describe, it, expect } from "vitest";
import { BAND_SIGNALS, DIAL_SIGNALS, RETIRED_SIGNALS, SIGNALS, bandSignalId, dialSignalId, type SignalId } from "../src/render/signals.ts";
import { NUM_BANDS } from "../src/audio/types.ts";
import { MUSIC_DIALS } from "../src/render/musicProfile.ts";
import type { AnimFrame } from "../src/render/animClock.ts";
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
    const knownCards = new Set(["sound", "stems", "beat", "song"]);
    const knownRows = new Set([
      "section",
      "tempo",
      "hitAny",
      "hitKick",
      "hitClap",
      "hitHats",
      "hitChord",
      "surge",
      "wave",
      "lock",
      "bar",
      "energy",
      "low",
      "mid",
      "high",
      "lead",
      "keys",
      "playing",
      "drop",
      ...DIAL_SIGNALS,
      ...BAND_SIGNALS,
    ]);
    for (const spec of Object.values(SIGNALS)) {
      if (!spec.monitor) continue;
      expect(knownCards.has(spec.monitor.card)).toBe(true);
      expect(knownRows.has(spec.monitor.row)).toBe(true);
    }
  });

  it("each instrument is a hit reading its song pulse, with its level on the same Sound row", () => {
    const song = {
      kickPulse: 0.1, clapPulse: 0.2, hatPulse: 0.3, chordPulse: 0.4,
      kickOnset: true, clapOnset: false, hatOnset: true, chordOnset: false,
      clapLevel: 0.5, hatLevel: 0.6, chordLevel: 0.7,
    };
    const anim = { song, low: 0.8 } as unknown as AnimFrame;
    const tracks = [
      { hit: "anim.kickOnset", level: "anim.kickLevel", row: "hitKick", pulse: 0.1, edge: true, value: 0.8 },
      { hit: "anim.clapOnset", level: "anim.clapLevel", row: "hitClap", pulse: 0.2, edge: false, value: 0.5 },
      { hit: "anim.hats", level: "anim.hatsLevel", row: "hitHats", pulse: 0.3, edge: true, value: 0.6 },
      { hit: "anim.chordOnset", level: "anim.chordLevel", row: "hitChord", pulse: 0.4, edge: false, value: 0.7 },
    ] as const;
    for (const t of tracks) {
      const hit = SIGNALS[t.hit];
      const level = SIGNALS[t.level];
      expect(hit.kind).toBe("edge");
      expect(hit.read({} as never, anim)).toBe(t.pulse);
      expect(hit.edge!(anim)).toBe(t.edge);
      expect(level.kind).toBe("level");
      expect(level.read({} as never, anim)).toBe(t.value);
      expect(hit.monitor).toEqual({ card: "sound", row: t.row });
      expect(level.monitor).toEqual({ card: "sound", row: t.row });
    }
  });

  it("Keys and Playing read the song layer's levels, Drop is an edge with its level on the same Song row", () => {
    const anim = { song: { keys: 0.3, playing: 0.9, dropLevel: 0.6 }, dropPulse: 0.5, dropOnset: true } as unknown as AnimFrame;
    expect(SIGNALS["anim.keys"].read({} as never, anim)).toBe(0.3);
    expect(SIGNALS["anim.keys"].monitor).toEqual({ card: "stems", row: "keys" });
    expect(SIGNALS["anim.playing"].read({} as never, anim)).toBe(0.9);
    expect(SIGNALS["anim.playing"].monitor).toEqual({ card: "song", row: "playing" });
    expect(SIGNALS["anim.dropOnset"].kind).toBe("edge");
    expect(SIGNALS["anim.dropOnset"].read({} as never, anim)).toBe(0.5);
    expect(SIGNALS["anim.dropOnset"].edge!(anim)).toBe(true);
    expect(SIGNALS["anim.dropLevel"].read({} as never, anim)).toBe(0.6);
    expect(SIGNALS["anim.dropOnset"].monitor).toEqual({ card: "song", row: "drop" });
    expect(SIGNALS["anim.dropLevel"].monitor).toEqual({ card: "song", row: "drop" });
  });

  it("the retired band hits and Kick band are gone from the catalogue", () => {
    for (const id of ["anim.lowOnset", "anim.midOnset", "anim.highOnset", "anim.kickBand"]) {
      expect(Object.keys(SIGNALS)).not.toContain(id);
      expect(SIGNALS[RETIRED_SIGNALS[id]!]).toBeDefined();
    }
  });

  it("every music dial is a level signal reading its own eased dial, anchored to its own cell", () => {
    expect(DIAL_SIGNALS).toEqual(MUSIC_DIALS.map(dialSignalId));
    for (const [i, dial] of MUSIC_DIALS.entries()) {
      const spec = SIGNALS[dialSignalId(dial)];
      expect(spec.kind).toBe("level");
      expect(spec.monitor).toEqual({ card: "song", row: dialSignalId(dial) });
      const profile = Object.fromEntries(MUSIC_DIALS.map((d, j) => [d, j / 10]));
      const anim = { profile } as unknown as AnimFrame;
      expect(spec.read({} as never, anim)).toBe(i / 10);
    }
  });

  it("every band is a level signal reading its own gate-dimmed band, anchored to its own Sound row", () => {
    expect(BAND_SIGNALS.length).toBe(NUM_BANDS);
    const bands = Float32Array.from({ length: NUM_BANDS }, (_, n) => n / 100);
    const anim = { gateDimmer: 0.5 } as unknown as AnimFrame;
    for (let n = 0; n < NUM_BANDS; n++) {
      const id = bandSignalId(n);
      expect(BAND_SIGNALS[n]).toBe(id);
      const spec = SIGNALS[id];
      expect(spec.kind).toBe("level");
      expect(spec.monitor).toEqual({ card: "sound", row: id });
      expect(spec.read({ bands } as never, anim)).toBeCloseTo((n / 100) * 0.5, 6);
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
    expect(idsOf.sort()).toEqual(["anim.kickOnset", "feature.onset"].sort());

    // Bass hit (CUT_MODE.BASS) switches which signal is "active"; the two
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
