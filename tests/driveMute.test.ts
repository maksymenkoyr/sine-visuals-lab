import { describe, it, expect, afterEach } from "vitest";
import { createDriveEngine, type DriveChoice, type DrivePatch } from "../src/render/drives.ts";
import { createAnimClock } from "../src/render/animClock.ts";
import { getDriveSetting, setDriveSetting } from "../src/render/driveStore.ts";
import { clearDriveMutes, isDriveMuted, onDriveMuteChange, toggleDriveMute } from "../src/render/driveMute.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";
import type { SceneSetting } from "../src/render/sceneSettings.ts";

const DT = 1 / 60;

function frame(overrides: Partial<FeatureFrame> = {}): FeatureFrame {
  return {
    time: 0,
    bands: new Float32Array(NUM_BANDS),
    energy: 0,
    level: 1,
    hats: 0,
    lead: 0,
    onset: false,
    pulseOnset: false,
    bpm: 120,
    onsetPhase: 0,
    engine: null,
    ...overrides,
  };
}

function settingWithDrive(key: string, choice: DriveChoice): SceneSetting {
  return { key, label: key, min: 0, max: 1, step: 0.05, default: 0, drive: { default: choice } };
}

function patchSetting(sceneId: string, key: string, patch: DrivePatch): SceneSetting {
  const spec = settingWithDrive(key, "scene");
  setDriveSetting(sceneId, spec, patch);
  return spec;
}

// "Mute" (driveMute.ts) is the strips' M button: the same silencing as "Only
// this" (drives.test.ts), but on NEXT only and in memory, never stored.
describe("Mute (driveMute)", () => {
  afterEach(() => {
    clearDriveMutes();
  });

  it("a muted setting reads silenced; an unmuted sibling reads normally", () => {
    const sceneId = "mute-patch-scene";
    const a = patchSetting(sceneId, "A", { mix: "add", sources: [{ choice: "anim.mid", weight: 1 }] });
    const b = patchSetting(sceneId, "B", { mix: "add", sources: [{ choice: "anim.mid", weight: 1 }] });
    const anim = { ...createAnimClock().advance(DT, frame()), mid: 0.8 };
    const engine = createDriveEngine();
    const bBefore = engine.forScene(sceneId, [a, b], anim).value("B", 0, -1);
    expect(bBefore).toBeGreaterThan(0);

    toggleDriveMute(sceneId, "A");
    const drives = engine.forScene(sceneId, [a, b], anim);
    expect(drives.value("A", 0, -1)).toBe(-1);
    expect(drives.value("B", 0, -1)).toBe(bBefore);
  });

  it("a built-in reaction on a muted setting reads its rest, not the scene's own value", () => {
    const sceneId = "mute-builtin-scene";
    const a = settingWithDrive("A", "scene");
    const anim = { ...createAnimClock().advance(DT, frame()), mid: 0.8 };
    const engine = createDriveEngine();
    expect(engine.forScene(sceneId, [a], anim).value("A", 0.6, 0.1)).toBe(0.6);

    toggleDriveMute(sceneId, "A");
    expect(engine.forScene(sceneId, [a], anim).value("A", 0.6, 0.1)).toBe(0.1);
  });

  it("toggling twice restores the setting exactly, and the stored wires are untouched", () => {
    const sceneId = "mute-restore-scene";
    const a = patchSetting(sceneId, "A", { mix: "add", sources: [{ choice: "anim.mid", weight: 1 }] });
    const anim = { ...createAnimClock().advance(DT, frame()), mid: 0.8 };
    const engine = createDriveEngine();
    const before = engine.forScene(sceneId, [a], anim).value("A", 0, -1);
    const storedBefore = JSON.parse(JSON.stringify(getDriveSetting(sceneId, a)));

    toggleDriveMute(sceneId, "A");
    expect(isDriveMuted(sceneId, "A")).toBe(true);
    expect(engine.forScene(sceneId, [a], anim).value("A", 0, -1)).toBe(-1);

    toggleDriveMute(sceneId, "A");
    expect(isDriveMuted(sceneId, "A")).toBe(false);
    expect(engine.forScene(sceneId, [a], anim).value("A", 0, -1)).toBe(before);
    expect(getDriveSetting(sceneId, a)).toEqual(storedBefore);
  });

  it("a mute in one scene does not touch the same key in another", () => {
    const sceneId = "mute-elsewhere-scene";
    const a = patchSetting(sceneId, "A", { mix: "add", sources: [{ choice: "anim.mid", weight: 1 }] });
    const anim = { ...createAnimClock().advance(DT, frame()), mid: 0.8 };
    const engine = createDriveEngine();
    const before = engine.forScene(sceneId, [a], anim).value("A", 0, -1);

    toggleDriveMute("some-other-scene", "A");
    expect(isDriveMuted(sceneId, "A")).toBe(false);
    expect(engine.forScene(sceneId, [a], anim).value("A", 0, -1)).toBe(before);
  });

  it("listeners fire on every toggle and on clear only when something was muted", () => {
    const calls: number[] = [];
    const off = onDriveMuteChange(() => calls.push(1));
    clearDriveMutes();
    expect(calls).toHaveLength(0);

    toggleDriveMute("listen-scene", "A");
    expect(calls).toHaveLength(1);
    toggleDriveMute("listen-scene", "A");
    expect(calls).toHaveLength(2);

    toggleDriveMute("listen-scene", "B");
    clearDriveMutes();
    expect(calls).toHaveLength(4);
    clearDriveMutes();
    expect(calls).toHaveLength(4);

    off();
    toggleDriveMute("listen-scene", "A");
    expect(calls).toHaveLength(4);
  });
});
