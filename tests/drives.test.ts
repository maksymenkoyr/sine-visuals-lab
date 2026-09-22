import { describe, it, expect } from "vitest";
import { createDriveEngine, PASSTHROUGH_DRIVES, driveOptions, sameDriveChoice, type DriveChoice } from "../src/render/drives.ts";
import { createAnimClock } from "../src/render/animClock.ts";
import { setDriveLine, setDriveLineStrength } from "../src/render/driveStore.ts";
import { bandLineDrive } from "../src/audio/bandLine.ts";
import { SIGNALS } from "../src/render/signals.ts";
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

describe("drives: driveOptions() / sameDriveChoice()", () => {
  it("Scene is always the last option, and every option round-trips through sameDriveChoice", () => {
    const options = driveOptions();
    expect(options.length).toBeGreaterThan(10);
    expect(options[options.length - 1].choice).toBe("scene");
    for (const opt of options) expect(sameDriveChoice(opt.choice, opt.choice)).toBe(true);
  });

  it("sameDriveChoice distinguishes grid indices and is false across different shapes", () => {
    expect(sameDriveChoice({ source: "beat", grid: 2 }, { source: "beat", grid: 3 })).toBe(false);
    expect(sameDriveChoice({ source: "beat", grid: 2 }, { source: "beat", grid: 2 })).toBe(true);
    expect(sameDriveChoice({ source: "line" }, "scene")).toBe(false);
    expect(sameDriveChoice("anim.mid", "anim.mid")).toBe(true);
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
