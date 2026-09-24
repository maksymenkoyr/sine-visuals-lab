import { describe, it, expect } from "vitest";
import {
  createDriveEngine,
  normalizeDriveSetting,
  PASSTHROUGH_DRIVES,
  driveModes,
  modeOf,
  sameDriveChoice,
  sameDriveSetting,
  type DriveChoice,
  type DrivePatch,
} from "../src/render/drives.ts";
import { createAnimClock, BEAT_PULSE_DECAY_PER_SEC } from "../src/render/animClock.ts";
import { setDriveLine, setDriveLineStrength, setDriveSetting } from "../src/render/driveStore.ts";
import { bandLineDrive } from "../src/audio/bandLine.ts";
import { SIGNALS, type SignalId } from "../src/render/signals.ts";
import { GROUP_TUNING } from "../src/render/bandEnergy.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";
import type { SceneSetting } from "../src/render/sceneSettings.ts";
import { listScenes } from "../src/render/scene.ts";
// Side-effect import: registers every scene, same convention as signals.test.ts.
import "../src/render/scenes/index.ts";
import { causticsScene } from "../src/render/scenes/caustics.ts";

const DT = 1 / 60;

function frame(overrides: Partial<FeatureFrame> = {}): FeatureFrame {
  return {
    time: 0,
    bands: new Float32Array(NUM_BANDS),
    energy: 0,
    level: 1,
    onset: false,
    bpm: 120,
    onsetPhase: 0,
    ...overrides,
  };
}

/** A minimal SceneSetting carrying only the `drive` field a test cares
 *  about — the engine never reads min/max/default for a drive read. */
function settingWithDrive(key: string, choice: DriveChoice, sceneLabel?: string): SceneSetting {
  return { key, label: key, min: 0, max: 1, step: 0.05, default: 0, drive: { default: choice, sceneLabel } };
}

/** A setting installed with a real multi-source patch, for the tests below
 *  that exercise mix/weight/height rather than a single default choice.
 *  `sceneId` is unique per test the same way the rest of this file keys
 *  every scenario, so the store's own state can't bleed between tests. */
function patchSetting(sceneId: string, key: string, patch: DrivePatch): SceneSetting {
  const spec = settingWithDrive(key, "scene");
  setDriveSetting(sceneId, spec, patch);
  return spec;
}

describe("drives: catalogue identity", () => {
  it("a plain SignalId choice reads exactly SIGNALS[id].read(frame, anim), with custom=1", () => {
    const clock = createAnimClock();
    // A few ticks with a real onset so beatPulse/lowPulse aren't just 0.
    const bands = new Float32Array(NUM_BANDS).fill(0.6);
    clock.advance(DT, frame({ bands, onset: true }));
    const anim = clock.advance(DT, frame({ bands, onset: true }));

    const engine = createDriveEngine();
    // "anim.energy" is the one entry whose read() actually uses `frame`
    // (see signals.ts's header) — the engine only ever feeds it the
    // sensitivity-applied `driveEnergy` accumulate() was given, never a
    // plain FeatureFrame, so it has to be seeded through accumulate() here
    // rather than compared against an ad-hoc frame() the engine never saw.
    const driveEnergy = 0.42;
    engine.accumulate(DT, frame({ bands }), driveEnergy, anim, "identity-scene", []);

    for (const id of Object.keys(SIGNALS) as (keyof typeof SIGNALS)[]) {
      const spec = settingWithDrive("k", id);
      const drives = engine.forScene("identity-scene", [spec], anim);
      const expected = id === "anim.energy" ? driveEnergy : SIGNALS[id].read(frame({ bands }), anim);
      expect(drives.uniformPair("k")).toEqual({ drive: expected, custom: 1 });
      expect(drives.value("k", -999)).toBe(expected);
    }
  });

  it("kind: edge entries' fired() reads the paired render-latched boolean off anim", () => {
    const clock = createAnimClock();
    const anim = clock.advance(DT, frame({ onset: true }));
    const engine = createDriveEngine();
    const spec = settingWithDrive("beatTrigger", "feature.onset");
    const drives = engine.forScene("identity-scene-2", [spec], anim);
    expect(drives.fired("beatTrigger", false)).toBe(anim.onset);
  });

  it("kind: level entries have no natural edge — fired() falls back to sceneDefaultFired", () => {
    const clock = createAnimClock();
    const anim = clock.advance(DT, frame({ bands: new Float32Array(NUM_BANDS).fill(0.5) }));
    const engine = createDriveEngine();
    const spec = settingWithDrive("levelTrigger", "anim.mid");
    const drives = engine.forScene("identity-scene-3", [spec], anim);
    expect(drives.fired("levelTrigger", true)).toBe(true);
    expect(drives.fired("levelTrigger", false)).toBe(false);
  });
});

describe("drives: Scene passthrough", () => {
  it("value()/fired() are exact passthroughs of the caller's own sceneDefault/sceneDefaultFired", () => {
    const clock = createAnimClock();
    const anim = clock.advance(DT, frame());
    const engine = createDriveEngine();
    const spec = settingWithDrive("composite", "scene", "Scene: a mix of things");
    const drives = engine.forScene("scene-passthrough", [spec], anim);
    expect(drives.value("composite", 0.7291)).toBe(0.7291);
    expect(drives.fired("composite", true)).toBe(true);
    expect(drives.fired("composite", false)).toBe(false);
  });

  it("uniformPair() is always {drive:0, custom:0} for Scene, so mix(sceneDefault, 0, 0) reduces to sceneDefault exactly", () => {
    const clock = createAnimClock();
    const anim = clock.advance(DT, frame());
    const engine = createDriveEngine();
    const spec = settingWithDrive("composite2", "scene");
    const drives = engine.forScene("scene-passthrough-2", [spec], anim);
    expect(drives.uniformPair("composite2")).toEqual({ drive: 0, custom: 0 });
  });

  it("PASSTHROUGH_DRIVES (every caller not wired to a real engine) behaves identically to a Scene choice", () => {
    expect(PASSTHROUGH_DRIVES.value("anything", 0.55)).toBe(0.55);
    expect(PASSTHROUGH_DRIVES.fired("anything", true)).toBe(true);
    expect(PASSTHROUGH_DRIVES.excess("anything")).toBeNull();
    expect(PASSTHROUGH_DRIVES.uniformPair("anything")).toEqual({ drive: 0, custom: 0 });
  });
});

describe("drives: beat-grid choice", () => {
  const GRID_QUARTER = 2; // BEAT_GRIDS index for "1/4" — see src/audio/beatGrid.ts

  it("latches its fired edge across ticks accumulate() sees but forScene().fired() doesn't consume until asked, then clears it", () => {
    const engine = createDriveEngine();
    const spec = settingWithDrive("gridTrigger", { source: "beat", grid: GRID_QUARTER });
    const sceneId = "grid-latch-scene";
    const gained = frame();

    const tick = (beats: number, onset: boolean) => {
      const anim = { ...createAnimClock().advance(DT, frame()), beats, onset, tempoLock: 1 };
      engine.accumulate(DT, gained, 0, anim, sceneId, [spec]);
      return anim;
    };

    // Arms silently on the first tick — see gridPulse.ts's own header.
    tick(0, false);
    // Crosses the beat-1 boundary: this is the tick that should fire.
    tick(1.5, false);
    // A further tick within the SAME grid cell — no new crossing, but the
    // edge from the previous tick must still be pending (renderLatch-style).
    const lastAnim = tick(1.6, false);

    const drives = engine.forScene(sceneId, [spec], lastAnim);
    expect(drives.fired("gridTrigger", false)).toBe(true);
    // Consumed — a second read (the next render, nothing new accumulated)
    // must not still report the same edge.
    expect(drives.fired("gridTrigger", false)).toBe(false);
  });

  it("never fires on the very first tick it's asked about (arms silently, same as gridPulse.ts's own contract)", () => {
    const engine = createDriveEngine();
    const spec = settingWithDrive("gridTrigger2", { source: "beat", grid: GRID_QUARTER });
    const sceneId = "grid-arm-scene";
    const gained = frame();
    const anim = { ...createAnimClock().advance(DT, frame()), beats: 3.2, onset: false, tempoLock: 1 };
    engine.accumulate(DT, gained, 0, anim, sceneId, [spec]);
    expect(engine.forScene(sceneId, [spec], anim).fired("gridTrigger2", false)).toBe(false);
  });

  it("its value() is a decaying pulse that jumps to 1 on the fired tick and releases afterward", () => {
    const engine = createDriveEngine();
    const spec = settingWithDrive("gridValue", { source: "beat", grid: GRID_QUARTER });
    const sceneId = "grid-value-scene";
    const gained = frame();

    const tick = (beats: number) => {
      const anim = { ...createAnimClock().advance(DT, frame()), beats, onset: false, tempoLock: 1 };
      engine.accumulate(DT, gained, 0, anim, sceneId, [spec]);
      return anim;
    };

    tick(0);
    const firedAnim = tick(1.5);
    const peak = engine.forScene(sceneId, [spec], firedAnim).uniformPair("gridValue").drive;
    expect(peak).toBe(1);

    let anim = firedAnim;
    for (let i = 0; i < 30; i++) anim = tick(1.5 + i * 0.002); // stay in the same cell, just advance time
    const after = engine.forScene(sceneId, [spec], anim).uniformPair("gridValue").drive;
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(peak);
  });
});

describe("drives: line choice", () => {
  it("matches bandLineDrive() against the setting's own stored line/strength, off the gained (band-gained) frame", () => {
    const spec = settingWithDrive("freqSetting", { source: "line" });
    const sceneId = "line-choice-scene";
    const heights = new Float32Array(NUM_BANDS).fill(0); // flat-0: full headroom everywhere
    setDriveLine(sceneId, spec, heights);
    setDriveLineStrength(sceneId, spec, 1);

    const bands = Float32Array.from({ length: NUM_BANDS }, (_, i) => (i % 5) / 10);
    const gained = frame({ bands });
    const anim = createAnimClock().advance(DT, gained);

    const engine = createDriveEngine();
    engine.accumulate(DT, gained, 0, anim, sceneId, [spec]);
    const drives = engine.forScene(sceneId, [spec], anim);

    const expected = bandLineDrive(bands, heights, 1).drive;
    expect(drives.uniformPair("freqSetting").drive).toBeCloseTo(expected, 5);
    expect(drives.excess("freqSetting")).not.toBeNull();
  });

  it("excess() is null for every choice except line", () => {
    const engine = createDriveEngine();
    const spec = settingWithDrive("notLine", "anim.mid");
    const anim = createAnimClock().advance(DT, frame());
    expect(engine.forScene("no-line-scene", [spec], anim).excess("notLine")).toBeNull();
  });
});

describe("drives: sameDriveChoice()", () => {
  it("sameDriveChoice distinguishes grid indices and is false across different shapes", () => {
    expect(sameDriveChoice({ source: "beat", grid: 2 }, { source: "beat", grid: 3 })).toBe(false);
    expect(sameDriveChoice({ source: "beat", grid: 2 }, { source: "beat", grid: 2 })).toBe(true);
    expect(sameDriveChoice({ source: "line" }, "scene")).toBe(false);
    expect(sameDriveChoice("anim.mid", "anim.mid")).toBe(true);
  });
});

describe("drives: driveModes() / modeOf() — the panel's two-row picker", () => {
  it("every registered scene's drive setting has its default reachable in driveModes(setting)", () => {
    let checked = 0;
    for (const scene of listScenes()) {
      for (const spec of scene.settings ?? []) {
        if (!spec.drive) continue;
        checked++;
        const rows = driveModes(spec);
        const def = spec.drive.default;
        if (def === "scene") {
          expect(rows.some((r) => r.mode === "scene"), `${scene.id}'s "${spec.key}" is Scene-default but driveModes() has no Scene mix row`).toBe(true);
        } else {
          const found = rows.some((r) => r.options.some((o) => o.isDefault && sameDriveChoice(o.choice, def)));
          expect(found, `${scene.id}'s "${spec.key}"'s default (${JSON.stringify(def)}) isn't reachable in its own driveModes()`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("every option every driveModes() row offers round-trips through modeOf() to that same row's mode", () => {
    // A setting whose own default is Scene, and touches both default-only
    // extras, so every row (including Scene mix and the two extras) is
    // actually present to check.
    const centroidSetting = settingWithDrive("centroidSetting", "anim.centroid");
    const sectionSetting = settingWithDrive("sectionSetting", "anim.sectionIntensity");
    const sceneSetting = settingWithDrive("sceneSetting", "scene", "Scene: a mix of things");
    for (const setting of [centroidSetting, sectionSetting, sceneSetting]) {
      for (const row of driveModes(setting)) {
        for (const opt of row.options) {
          expect(modeOf(opt.choice).mode, `${row.mode}'s "${opt.label}" chip resolves to a different mode via modeOf()`).toBe(row.mode);
        }
      }
    }
  });

  it("Scene mix is offered only for a setting whose own default is Scene", () => {
    const nonScene = settingWithDrive("nonScene", "anim.lowOnset");
    expect(driveModes(nonScene).some((r) => r.mode === "scene")).toBe(false);
    const scene = settingWithDrive("scene", "scene", "Scene: a mix of things");
    expect(driveModes(scene).some((r) => r.mode === "scene")).toBe(true);
  });

  it("the default-only Brightness/Song extras appear in the Loudness row only for the one setting they default for", () => {
    const centroidSetting = settingWithDrive("centroidSetting", "anim.centroid");
    const loudnessOptions = driveModes(centroidSetting).find((r) => r.mode === "loudness")!.options;
    const brightness = loudnessOptions.find((o) => o.label === "Brightness");
    expect(brightness).toBeTruthy();
    expect(brightness!.isDefault).toBe(true);
    expect(brightness!.choice).toBe("anim.centroid");

    const otherSetting = settingWithDrive("otherSetting", "anim.mid");
    expect(driveModes(otherSetting).find((r) => r.mode === "loudness")!.options.some((o) => o.label === "Brightness")).toBe(false);
    expect(driveModes(otherSetting).find((r) => r.mode === "loudness")!.options.some((o) => o.label === "Song")).toBe(false);
  });

  it("exactly one option is marked isDefault, matching the setting's own drive.default, for a plain catalogue/grid/line default", () => {
    const settings: SceneSetting[] = [
      settingWithDrive("a", "feature.onset"),
      settingWithDrive("b", "anim.high"),
      settingWithDrive("c", { source: "beat", grid: 3 }),
      settingWithDrive("d", { source: "line" }),
    ];
    for (const setting of settings) {
      const flagged = driveModes(setting).flatMap((r) => r.options.filter((o) => o.isDefault));
      expect(flagged.length).toBe(1);
      expect(sameDriveChoice(flagged[0].choice, setting.drive!.default)).toBe(true);
    }
  });
});

// The identity check the plan's Verification section calls for: walk every
// registered scene's drive settings and assert that, at the default choice,
// the engine's value equals the signal the scene previously read (a
// catalogue default), or that u<Key>Custom is 0 (Scene) — the bit-for-bit
// guarantee in code rather than by eye.
describe("drives: identity at defaults, across every registered scene", () => {
  it("every drive setting's default resolves to Scene (custom=0) or a real catalogue/grid/line reading (custom=1)", () => {
    const clock = createAnimClock();
    const bands = new Float32Array(NUM_BANDS).fill(0.5);
    clock.advance(DT, frame({ bands, onset: true }));
    const anim = clock.advance(DT, frame({ bands, onset: true }));
    const engine = createDriveEngine();

    let checked = 0;
    for (const scene of listScenes()) {
      const settings = scene.settings ?? [];
      const driveSettings = settings.filter((s) => s.drive);
      if (driveSettings.length === 0) continue;
      engine.accumulate(DT, frame({ bands }), 0.5, anim, scene.id, settings);
      const drives = engine.forScene(scene.id, settings, anim);
      for (const spec of driveSettings) {
        checked++;
        const choice = spec.drive!.default;
        const pair = drives.uniformPair(spec.key);
        if (choice === "scene") {
          expect(pair).toEqual({ drive: 0, custom: 0 });
          expect(spec.drive!.sceneLabel, `${scene.id}'s "${spec.key}" is Scene-default with no sceneLabel`).toBeTruthy();
        } else {
          expect(pair.custom).toBe(1);
          expect(Number.isFinite(pair.drive), `${scene.id}'s "${spec.key}" produced a non-finite drive value`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

// Caustics-specific: pins the exact old uniform each simple-GLSL setting's
// default reproduces, and which settings default to Scene — the concrete
// version of the generic walk above, for the one scene Phase 1 migrated.
describe("drives: caustics defaults reproduce today's couplings exactly", () => {
  const settings = causticsScene.settings!;
  const byKey = (key: string) => settings.find((s) => s.key === key)!;

  function animWith(overrides: { bands?: Float32Array; onset?: boolean }) {
    const clock = createAnimClock();
    const bands = overrides.bands ?? new Float32Array(NUM_BANDS).fill(0.55);
    clock.advance(DT, frame({ bands, onset: overrides.onset ?? false }));
    return clock.advance(DT, frame({ bands, onset: overrides.onset ?? false }));
  }

  it("flash and focus default to Beat, matching anim.beatPulse exactly", () => {
    const anim = animWith({ onset: true });
    const engine = createDriveEngine();
    const drives = engine.forScene("caustics", settings, anim);
    expect(drives.uniformPair("flash")).toEqual({ drive: anim.beatPulse, custom: 1 });
    expect(drives.uniformPair("focus")).toEqual({ drive: anim.beatPulse, custom: 1 });
  });

  it("turbulence defaults to Mid level, matching anim.mid exactly", () => {
    const anim = animWith({});
    const engine = createDriveEngine();
    const drives = engine.forScene("caustics", settings, anim);
    expect(drives.uniformPair("turbulence")).toEqual({ drive: anim.mid, custom: 1 });
  });

  it("bass and driftKick default to Bass hit, matching anim.lowPulse exactly", () => {
    const anim = animWith({ bands: new Float32Array(NUM_BANDS).fill(0.7), onset: true });
    const engine = createDriveEngine();
    const drives = engine.forScene("caustics", settings, anim);
    expect(drives.uniformPair("bass")).toEqual({ drive: anim.lowPulse, custom: 1 });
    expect(drives.value("driftKick", -1)).toBe(anim.lowPulse);
  });

  it("driftBeat and driftChurn default to Beat, matching anim.onset exactly for fired()", () => {
    const anim = animWith({ onset: true });
    const engine = createDriveEngine();
    const drives = engine.forScene("caustics", settings, anim);
    expect(drives.fired("driftBeat", false)).toBe(anim.onset);
    expect(drives.fired("driftChurn", false)).toBe(anim.onset);
  });

  it("sparkle, injection, ripple and driftLoud default to Scene", () => {
    const anim = animWith({});
    const engine = createDriveEngine();
    const drives = engine.forScene("caustics", settings, anim);
    for (const key of ["sparkle", "injection", "ripple", "driftLoud"]) {
      expect(drives.uniformPair(key)).toEqual({ drive: 0, custom: 0 });
      expect(byKey(key).drive!.sceneLabel).toBeTruthy();
    }
  });

  it("ripple's Scene default reproduces today's exact trigger (bass hit OR beat hit, unconditionally)", () => {
    const engine = createDriveEngine();
    // Bass hit only.
    const bassOnly = animWith({ bands: new Float32Array(NUM_BANDS).fill(0.9), onset: false });
    const sceneDefaultBass = bassOnly.lowOnset || bassOnly.onset;
    expect(engine.forScene("caustics", settings, bassOnly).fired("ripple", sceneDefaultBass)).toBe(sceneDefaultBass);
    // Neither.
    const neither = animWith({});
    const sceneDefaultNeither = neither.lowOnset || neither.onset;
    expect(sceneDefaultNeither).toBe(false);
    expect(engine.forScene("caustics", settings, neither).fired("ripple", sceneDefaultNeither)).toBe(false);
  });
});

// ---- Phase 1 of the patch-bay plan: multi-source DrivePatch -------------

describe("drives: patch normalization — weight clamp, dedupe, empty -> scene", () => {
  it("clamps weight to 0..2", () => {
    const patch: DrivePatch = {
      mix: "add",
      sources: [
        { choice: "anim.low", weight: 5 },
        { choice: "anim.mid", weight: -3 },
      ],
    };
    const normalized = normalizeDriveSetting(patch);
    if (normalized === "scene") throw new Error("unreachable — two sources, never collapses to scene");
    expect(normalized.sources[0]!.weight).toBe(2);
    expect(normalized.sources[1]!.weight).toBe(0);
  });

  it("drops a later source colliding with an earlier one's key, and a second line source", () => {
    const patch: DrivePatch = {
      mix: "add",
      sources: [
        { choice: "anim.low", weight: 1 },
        { choice: "anim.low", weight: 2 }, // duplicate key — dropped
        { choice: { source: "line" }, weight: 1 },
        { choice: { source: "line" }, weight: 1 }, // second line — dropped
      ],
    };
    const normalized = normalizeDriveSetting(patch);
    if (normalized === "scene") throw new Error("unreachable");
    expect(normalized.sources).toHaveLength(2);
    expect(normalized.sources[0]).toEqual({ choice: "anim.low", weight: 1 });
  });

  it("an empty patch normalizes to scene", () => {
    expect(normalizeDriveSetting({ mix: "add", sources: [] })).toBe("scene");
  });

  it("sameDriveSetting compares mix, source order, weight and height", () => {
    const a: DrivePatch = { mix: "add", sources: [{ choice: "anim.low", weight: 1 }] };
    const b: DrivePatch = { mix: "add", sources: [{ choice: "anim.low", weight: 1 }] };
    const c: DrivePatch = { mix: "add", sources: [{ choice: "anim.low", weight: 1.1 }] };
    expect(sameDriveSetting(a, b)).toBe(true);
    expect(sameDriveSetting(a, c)).toBe(false);
    expect(sameDriveSetting(a, "scene")).toBe(false);
    expect(sameDriveSetting("scene", "scene")).toBe(true);
  });
});

describe("drives: multi-source patch mixing (add/max/gate) and gain", () => {
  it("add sums every source's own weight * value", () => {
    const clock = createAnimClock();
    const bands = new Float32Array(NUM_BANDS).fill(0.5);
    const anim = clock.advance(DT, frame({ bands }));
    const sceneId = "patch-add";
    const spec = patchSetting(sceneId, "k", {
      mix: "add",
      sources: [
        { choice: "anim.low", weight: 1.5 },
        { choice: "anim.mid", weight: 0.5 },
      ],
    });
    const engine = createDriveEngine();
    engine.accumulate(DT, frame({ bands }), 0, anim, sceneId, [spec]);
    const expected = 1.5 * anim.low + 0.5 * anim.mid;
    expect(engine.forScene(sceneId, [spec], anim).uniformPair("k")).toEqual({ drive: expected, custom: 1 });
  });

  it("max takes the single largest weighted source, not their sum", () => {
    const clock = createAnimClock();
    const bands = new Float32Array(NUM_BANDS).fill(0.5);
    const anim = clock.advance(DT, frame({ bands }));
    const sceneId = "patch-max";
    const spec = patchSetting(sceneId, "k", {
      mix: "max",
      sources: [
        { choice: "anim.low", weight: 2 },
        { choice: "anim.mid", weight: 0.1 },
      ],
    });
    const engine = createDriveEngine();
    engine.accumulate(DT, frame({ bands }), 0, anim, sceneId, [spec]);
    const expected = Math.max(2 * anim.low, 0.1 * anim.mid);
    const drive = engine.forScene(sceneId, [spec], anim).uniformPair("k").drive;
    expect(drive).toBe(expected);
    expect(drive).toBeLessThan(2 * anim.low + 0.1 * anim.mid); // sanity: really not add
  });

  it("gate multiplies source 0 by a smoothstep of source 1; a third source is stored but ignored", () => {
    const clock = createAnimClock();
    const bands = new Float32Array(NUM_BANDS).fill(0.5);
    const anim = clock.advance(DT, frame({ bands }));
    const sceneId = "patch-gate";
    const spec = patchSetting(sceneId, "k", {
      mix: "gate",
      sources: [
        { choice: "anim.low", weight: 1 },
        { choice: "anim.mid", weight: 1 },
        { choice: "anim.high", weight: 1 }, // ignored — only sources 0 and 1 count
      ],
    });
    const engine = createDriveEngine();
    engine.accumulate(DT, frame({ bands }), 0, anim, sceneId, [spec]);
    const t = Math.min(1, Math.max(0, (anim.mid - 0.35) / (0.55 - 0.35)));
    const smooth = t * t * (3 - 2 * t);
    const expected = anim.low * smooth;
    expect(engine.forScene(sceneId, [spec], anim).uniformPair("k").drive).toBeCloseTo(expected, 10);
  });

  it("gate with only one source treats the gate as always open (falls back to that source alone)", () => {
    const clock = createAnimClock();
    const bands = new Float32Array(NUM_BANDS).fill(0.3);
    const anim = clock.advance(DT, frame({ bands }));
    const sceneId = "patch-gate-single";
    const spec = patchSetting(sceneId, "k", { mix: "gate", sources: [{ choice: "anim.low", weight: 1.4 }] });
    const engine = createDriveEngine();
    engine.accumulate(DT, frame({ bands }), 0, anim, sceneId, [spec]);
    expect(engine.forScene(sceneId, [spec], anim).uniformPair("k").drive).toBeCloseTo(1.4 * anim.low, 10);
  });

  it("drive.gain scales the mix-combined result once, not each source", () => {
    const clock = createAnimClock();
    const bands = new Float32Array(NUM_BANDS).fill(0.5);
    const anim = clock.advance(DT, frame({ bands }));
    const sceneId = "patch-gain";
    const spec: SceneSetting = { key: "k", label: "k", min: 0, max: 1, step: 0.05, default: 0, drive: { default: "scene", gain: 2 } };
    setDriveSetting(sceneId, spec, {
      mix: "add",
      sources: [
        { choice: "anim.low", weight: 1 },
        { choice: "anim.mid", weight: 1 },
      ],
    });
    const engine = createDriveEngine();
    engine.accumulate(DT, frame({ bands }), 0, anim, sceneId, [spec]);
    expect(engine.forScene(sceneId, [spec], anim).uniformPair("k").drive).toBeCloseTo(2 * (anim.low + anim.mid), 10);
  });
});

/** Two quiet ticks (to give bandEnergy's rate-of-rise trigger a real
 *  `prevRaw` to compare against — see bandEnergy.ts's own `state.prevRaw ===
 *  null` guard) then one loud tick, sharp enough to clear every group's *and*
 *  the broadband detector's adaptive threshold. Shares one AnimClock/engine
 *  across all three ticks (real per-tick state, not three independent
 *  clocks) and returns the firing tick's AnimFrame. */
function tickToOnset(
  clock: ReturnType<typeof createAnimClock>,
  engine: ReturnType<typeof createDriveEngine>,
  sceneId: string,
  specs: SceneSetting[],
  spikeDriveEnergy = 0.9,
) {
  const quiet = new Float32Array(NUM_BANDS).fill(0.05);
  const spike = new Float32Array(NUM_BANDS).fill(0.9);
  let anim = clock.advance(DT, frame({ bands: quiet, onset: false }));
  engine.accumulate(DT, frame({ bands: quiet }), 0.05, anim, sceneId, specs);
  anim = clock.advance(DT, frame({ bands: quiet, onset: false }));
  engine.accumulate(DT, frame({ bands: quiet }), 0.05, anim, sceneId, specs);
  anim = clock.advance(DT, frame({ bands: spike, onset: true }));
  engine.accumulate(DT, frame({ bands: spike }), spikeDriveEnergy, anim, sceneId, specs);
  return anim;
}

describe("drives: hit heights (Fixed/Loud) on a patch source", () => {
  it("Graded (the default) is untouched — exactly the catalogue's own pulse", () => {
    const clock = createAnimClock();
    const engine = createDriveEngine();
    const sceneId = "height-graded";
    const spec = patchSetting(sceneId, "k", { mix: "add", sources: [{ choice: "anim.lowOnset", weight: 1 }] });
    const anim = tickToOnset(clock, engine, sceneId, [spec]);
    expect(engine.forScene(sceneId, [spec], anim).uniformPair("k").drive).toBe(anim.lowPulse);
  });

  it("Fixed jumps to 1 on the source's own edge and decays at that source's own pulse-decay rate", () => {
    const clock = createAnimClock();
    const engine = createDriveEngine();
    const sceneId = "height-fixed";
    const spec = patchSetting(sceneId, "k", { mix: "add", sources: [{ choice: "anim.lowOnset", weight: 1, height: "fixed" }] });
    const anim = tickToOnset(clock, engine, sceneId, [spec]);
    expect(anim.lowOnset).toBe(true); // sanity: the tick really fired
    expect(engine.forScene(sceneId, [spec], anim).uniformPair("k").drive).toBe(1);

    // One further tick at the same (held) level: no new rise, so no new
    // edge — heightEnv should just have decayed once, at bandEnergy's own
    // low-group rate (GROUP_TUNING), the exact rate the Graded pulse it
    // stands in for decays at.
    const held = new Float32Array(NUM_BANDS).fill(0.9);
    const anim2 = clock.advance(DT, frame({ bands: held, onset: false }));
    engine.accumulate(DT, frame({ bands: held }), 0.9, anim2, sceneId, [spec]);
    expect(anim2.lowOnset).toBe(false);
    const after = engine.forScene(sceneId, [spec], anim2).uniformPair("k").drive;
    expect(after).toBeCloseTo(Math.exp(-DT * GROUP_TUNING.low.pulseDecayRate), 6);
  });

  it("Loud jumps to the source's own band-group level on the edge — anim.low for Bass hit", () => {
    const clock = createAnimClock();
    const engine = createDriveEngine();
    const sceneId = "height-loud";
    const spec = patchSetting(sceneId, "k", { mix: "add", sources: [{ choice: "anim.lowOnset", weight: 1, height: "loud" }] });
    const anim = tickToOnset(clock, engine, sceneId, [spec]);
    expect(anim.lowOnset).toBe(true);
    expect(engine.forScene(sceneId, [spec], anim).uniformPair("k").drive).toBe(anim.low);
  });

  it("Loud on Any hit (broadband) uses driveEnergy, since it isn't band-specific", () => {
    const clock = createAnimClock();
    const engine = createDriveEngine();
    const sceneId = "height-loud-broadband";
    const spec = patchSetting(sceneId, "k", { mix: "add", sources: [{ choice: "feature.onset", weight: 1, height: "loud" }] });
    const anim = tickToOnset(clock, engine, sceneId, [spec], 0.77);
    expect(anim.onset).toBe(true);
    expect(engine.forScene(sceneId, [spec], anim).uniformPair("k").drive).toBe(0.77);
  });

  it("Fixed on Any hit decays at animClock's own BEAT_PULSE_DECAY_PER_SEC, the same rate its Graded pulse uses", () => {
    const clock = createAnimClock();
    const engine = createDriveEngine();
    const sceneId = "height-fixed-broadband";
    const spec = patchSetting(sceneId, "k", { mix: "add", sources: [{ choice: "feature.onset", weight: 1, height: "fixed" }] });
    const anim = tickToOnset(clock, engine, sceneId, [spec]);
    expect(anim.onset).toBe(true);
    expect(engine.forScene(sceneId, [spec], anim).uniformPair("k").drive).toBe(1);

    const held = new Float32Array(NUM_BANDS).fill(0.9);
    const anim2 = clock.advance(DT, frame({ bands: held, onset: false }));
    engine.accumulate(DT, frame({ bands: held }), 0.9, anim2, sceneId, [spec]);
    const after = engine.forScene(sceneId, [spec], anim2).uniformPair("k").drive;
    expect(after).toBeCloseTo(Math.exp(-DT * BEAT_PULSE_DECAY_PER_SEC), 6);
  });

  it("a level-kind source (Bass level) ignores height entirely, even if one is stored", () => {
    const clock = createAnimClock();
    const engine = createDriveEngine();
    const sceneId = "height-ignored-level";
    const spec = patchSetting(sceneId, "k", { mix: "add", sources: [{ choice: "anim.low", weight: 1, height: "fixed" }] });
    const anim = tickToOnset(clock, engine, sceneId, [spec]);
    // Still reads the plain level, never a 1-then-decay envelope.
    expect(engine.forScene(sceneId, [spec], anim).uniformPair("k").drive).toBe(anim.low);
  });

  it("the drawn line ignores height entirely, even if one is stored", () => {
    const sceneId = "height-ignored-line";
    const spec = patchSetting(sceneId, "k", { mix: "add", sources: [{ choice: { source: "line" }, weight: 1, height: "loud" }] });
    setDriveLine(sceneId, spec, new Float32Array(NUM_BANDS).fill(0)); // flat-0: full headroom
    setDriveLineStrength(sceneId, spec, 1);
    const bands = Float32Array.from({ length: NUM_BANDS }, (_, i) => (i % 5) / 10);
    const gained = frame({ bands });
    const anim = createAnimClock().advance(DT, gained);
    const engine = createDriveEngine();
    engine.accumulate(DT, gained, 0, anim, sceneId, [spec]);
    const expected = bandLineDrive(bands, new Float32Array(NUM_BANDS).fill(0), 1).drive;
    expect(engine.forScene(sceneId, [spec], anim).uniformPair("k").drive).toBeCloseTo(expected, 5);
  });
});

describe("drives: fired() across multiple sources", () => {
  it("add/max OR every source's own edge (catalogue sources)", () => {
    const engine = createDriveEngine();
    const sceneId = "fired-or-catalogue";
    const spec = patchSetting(sceneId, "k", {
      mix: "add",
      sources: [
        { choice: "anim.lowOnset", weight: 1 },
        { choice: "anim.midOnset", weight: 1 },
      ],
    });
    const base = createAnimClock().advance(DT, frame());
    expect(engine.forScene(sceneId, [spec], { ...base, lowOnset: false, midOnset: false }).fired("k", false)).toBe(false);
    expect(engine.forScene(sceneId, [spec], { ...base, lowOnset: true, midOnset: false }).fired("k", false)).toBe(true);
    expect(engine.forScene(sceneId, [spec], { ...base, lowOnset: false, midOnset: true }).fired("k", false)).toBe(true);
  });

  it("gate: fires only when source 0's own edge coincides with the gate being open", () => {
    const engine = createDriveEngine();
    const sceneId = "fired-gate";
    const spec = patchSetting(sceneId, "k", {
      mix: "gate",
      sources: [
        { choice: "anim.lowOnset", weight: 1 },
        { choice: "anim.mid", weight: 1 },
      ],
    });
    const base = createAnimClock().advance(DT, frame());
    expect(engine.forScene(sceneId, [spec], { ...base, lowOnset: true, mid: 0.9 }).fired("k", false)).toBe(true);
    expect(engine.forScene(sceneId, [spec], { ...base, lowOnset: true, mid: 0.1 }).fired("k", false)).toBe(false);
    expect(engine.forScene(sceneId, [spec], { ...base, lowOnset: false, mid: 0.9 }).fired("k", false)).toBe(false);
  });
});

describe("drives: two settings sharing a grid choice keep independent latches", () => {
  it("reading setting A's fired edge never consumes setting B's, on the same grid index", () => {
    const engine = createDriveEngine();
    const sceneId = "grid-share-scene";
    const GRID_QUARTER = 2; // BEAT_GRIDS index for "1/4"
    const specA = patchSetting(sceneId, "a", { mix: "add", sources: [{ choice: { source: "beat", grid: GRID_QUARTER }, weight: 1 }] });
    const specB = patchSetting(sceneId, "b", { mix: "add", sources: [{ choice: { source: "beat", grid: GRID_QUARTER }, weight: 1 }] });

    const tick = (beats: number) => {
      const anim = { ...createAnimClock().advance(DT, frame()), beats, onset: false, tempoLock: 1 };
      engine.accumulate(DT, frame(), 0, anim, sceneId, [specA, specB]);
      return anim;
    };

    tick(0); // arms silently
    const firedAnim = tick(1.5); // both cross the same boundary this tick

    const drives = engine.forScene(sceneId, [specA, specB], firedAnim);
    expect(drives.fired("a", false)).toBe(true);
    // B's own edge must still be pending — reading A didn't steal it.
    expect(drives.fired("b", false)).toBe(true);
  });
});

describe("drives: sourceValues()/valueOf() — the panel's inspection API", () => {
  it("sourceValues returns each source's own weight*value in patch order, un-gained", () => {
    const clock = createAnimClock();
    const bands = new Float32Array(NUM_BANDS).fill(0.4);
    const anim = clock.advance(DT, frame({ bands }));
    const sceneId = "source-values-scene";
    const spec = patchSetting(sceneId, "k", {
      mix: "add",
      sources: [
        { choice: "anim.high", weight: 0.3 },
        { choice: "anim.low", weight: 1.7 },
      ],
    });
    const engine = createDriveEngine();
    engine.accumulate(DT, frame({ bands }), 0, anim, sceneId, [spec]);
    const values = engine.forScene(sceneId, [spec], anim).sourceValues("k");
    expect(values).not.toBeNull();
    expect(values![0]).toBeCloseTo(0.3 * anim.high, 6);
    expect(values![1]).toBeCloseTo(1.7 * anim.low, 6);
  });

  it("sourceValues is null for a Scene setting", () => {
    const engine = createDriveEngine();
    const spec = settingWithDrive("k", "scene", "Scene: x");
    const anim = createAnimClock().advance(DT, frame());
    expect(engine.forScene("scene-sourcevalues", [spec], anim).sourceValues("k")).toBeNull();
  });

  it("valueOf matches uniformPair().drive, and is 0 for a Scene setting", () => {
    const clock = createAnimClock();
    const bands = new Float32Array(NUM_BANDS).fill(0.4);
    const anim = clock.advance(DT, frame({ bands }));
    const sceneId = "valueof-scene";
    const spec = patchSetting(sceneId, "k", { mix: "add", sources: [{ choice: "anim.low", weight: 1 }] });
    const engine = createDriveEngine();
    engine.accumulate(DT, frame({ bands }), 0, anim, sceneId, [spec]);
    const drives = engine.forScene(sceneId, [spec], anim);
    expect(drives.valueOf("k")).toBe(drives.uniformPair("k").drive);

    const sceneSpec = settingWithDrive("k2", "scene", "Scene: x");
    expect(engine.forScene("valueof-scene-2", [sceneSpec], anim).valueOf("k2")).toBe(0);
  });
});

describe("drives: sceneSources — display-only scene-mix metadata", () => {
  it("every declared sceneSources entry is a real SignalId, only on a Scene-default setting", () => {
    let checked = 0;
    for (const scene of listScenes()) {
      for (const spec of scene.settings ?? []) {
        if (!spec.drive?.sceneSources) continue;
        checked++;
        expect(spec.drive.default, `${scene.id}'s "${spec.key}" has sceneSources but isn't Scene-default`).toBe("scene");
        expect(spec.drive.sceneSources.length).toBeGreaterThan(0);
        for (const id of spec.drive.sceneSources) {
          expect(SIGNALS[id as SignalId], `${scene.id}'s "${spec.key}" sceneSources names unknown signal "${id}"`).toBeDefined();
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
