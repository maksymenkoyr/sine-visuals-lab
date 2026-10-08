// Hit drivers (src/render/drives.ts's header, "Hit drivers"): a setting that
// does one thing per hit declares SceneSetting.drive.hit, and the engine runs
// standout.ts's detector as its threshold, with the Reaction row's Flat or
// Sized read-out (driveStore.ts's getDriveReadout) deciding how big
// drives.hitSize says the reaction is.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createDriveEngine, isEngineHitDriver, PASSTHROUGH_DRIVES, type DrivePatch } from "../src/render/drives.ts";
import { createAnimClock } from "../src/render/animClock.ts";
import { getDriveReadout, setDriveReadout, setDriveSetting, setDriveThreshold, setDriveThresholdOn } from "../src/render/driveStore.ts";
import { takeSettingMarks } from "../src/render/settingMarks.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";
import type { SceneSetting } from "../src/render/sceneSettings.ts";
import type { Scene } from "../src/render/scene.ts";
import { fileClosure, parseRegistryImports } from "../tools/sceneVersionLib.mjs";

const DT = 1 / 60;

function frame(overrides: Partial<FeatureFrame> = {}): FeatureFrame {
  return { time: 0, bands: new Float32Array(NUM_BANDS), energy: 0, level: 1, onset: false, pulseOnset: false, bpm: 120, onsetPhase: 0, ...overrides };
}

/** A hit driver on a one-source Loud-height Beat patch: each hit's pulse is
 *  exactly the driveEnergy it lands with, so a test sets every hit's height. */
function hitSpec(sceneId: string, hit: NonNullable<NonNullable<SceneSetting["drive"]>["hit"]> = {}): SceneSetting {
  const spec: SceneSetting = { key: "k", label: "k", min: 0, max: 1, step: 0.05, default: 0, drive: { default: "feature.onset", hit } };
  const patch: DrivePatch = { mix: "add", sources: [{ choice: "feature.onset", weight: 1, height: "loud" }] };
  setDriveSetting(sceneId, spec, patch);
  return spec;
}

/** Steps a clock + engine one tick at a time, asking fired() every tick the
 *  way a scene must, and returns what each tick said. */
function rig(sceneId: string, spec: SceneSetting) {
  const clock = createAnimClock();
  const engine = createDriveEngine();
  return (onset: boolean, height: number) => {
    const anim = clock.advance(DT, frame({ onset }));
    engine.accumulate(DT, frame(), height, anim, sceneId, [spec]);
    const drives = engine.forScene(sceneId, [spec], anim);
    const fired = drives.fired("k", false);
    return { fired, size: drives.hitSize("k"), drives };
  };
}

/** A bar of kicks (1.0), a medium hit (0.5) and background hats (0.12),
 *  `ticksApart` ticks between hits. Returns, per hit, whether it fired (on
 *  its own tick or the next one, where Sized reports a hit that didn't
 *  stand out fully) and the size reported. */
function playBars(step: ReturnType<typeof rig>, bars: number, ticksApart = 15) {
  const out: { height: number; fired: boolean; size: number }[] = [];
  const pattern = [1, 0.12, 0.5, 0.12];
  for (let b = 0; b < bars; b++) {
    for (const height of pattern) {
      let fired = false;
      let size = 0;
      for (let t = 0; t < ticksApart; t++) {
        const r = step(t === 0, height);
        if (r.fired && t <= 1) {
          fired = true;
          size = r.size;
        }
      }
      out.push({ height, fired, size });
    }
  }
  return out;
}

describe("hit drivers: what the engine does", () => {
  it("untouched (threshold Off, Flat): fires on exactly the edges a plain setting does, at size 1", () => {
    const plain: SceneSetting = { key: "k", label: "k", min: 0, max: 1, step: 0.05, default: 0, drive: { default: "feature.onset" } };
    const hit = hitSpec("hit-identity");
    setDriveSetting("hit-identity-plain", plain, { mix: "add", sources: [{ choice: "feature.onset", weight: 1, height: "loud" }] });
    const a = rig("hit-identity", hit);
    const b = rig("hit-identity-plain", plain);
    for (let i = 0; i < 300; i++) {
      const onset = i % 7 === 0 || i % 11 === 0;
      const height = (i % 5) / 5;
      const ra = a(onset, height);
      const rb = b(onset, height);
      expect(ra.fired).toBe(rb.fired);
      expect(ra.size).toBe(1);
    }
  });

  it("is never gated by the generic gate: value() passes the reading through with the threshold On", () => {
    const sceneId = "hit-no-generic-gate";
    const spec = hitSpec(sceneId);
    setDriveThresholdOn(sceneId, spec, true);
    setDriveThreshold(sceneId, spec, 1);
    const step = rig(sceneId, spec);
    for (let i = 0; i < 120; i++) step(i % 10 === 0, 0.2);
    const r = step(true, 0.2);
    expect(r.drives.value("k", -1)).toBeCloseTo(0.2, 5);
    expect(r.drives.gateLine("k")).toBeUndefined();
  });

  it("threshold On, Flat: once it has learned the background, the hats never fire and the kicks always do", () => {
    const sceneId = "hit-on-flat";
    const spec = hitSpec(sceneId);
    setDriveThresholdOn(sceneId, spec, true);
    const hits = playBars(rig(sceneId, spec), 12).slice(16);
    for (const h of hits) {
      if (h.height === 1) expect(h.fired).toBe(true);
      if (h.height === 0.12) expect(h.fired).toBe(false);
      if (h.fired) expect(h.size).toBe(1);
    }
  });

  it("threshold On, Sized: the medium hit reacts at its own size, the kicks at about full, the hats not at all", () => {
    const sceneId = "hit-on-sized";
    const spec = hitSpec(sceneId);
    setDriveThresholdOn(sceneId, spec, true);
    setDriveReadout(sceneId, spec, "sized");
    const hits = playBars(rig(sceneId, spec), 12).slice(16);
    for (const h of hits) {
      if (h.height === 1) {
        expect(h.fired).toBe(true);
        expect(h.size).toBeGreaterThan(0.9);
      }
      if (h.height === 0.5) {
        expect(h.fired).toBe(true);
        expect(h.size).toBeGreaterThan(0.1);
        expect(h.size).toBeLessThan(0.9);
      }
      if (h.height === 0.12) expect(h.fired).toBe(false);
    }
  });

  it("threshold Off, Sized: every edge fires, as big as its own climb", () => {
    const sceneId = "hit-off-sized";
    const spec = hitSpec(sceneId);
    setDriveReadout(sceneId, spec, "sized");
    const step = rig(sceneId, spec);
    for (let i = 0; i < 30; i++) step(false, 0);
    const r = step(true, 0.4);
    expect(r.fired).toBe(true);
    expect(r.size).toBeCloseTo(0.4, 1);
  });

  it("asking twice in one frame gives the same answer, without stepping the detector twice", () => {
    const sceneId = "hit-twice";
    const spec = hitSpec(sceneId);
    setDriveThresholdOn(sceneId, spec, true);
    const step = rig(sceneId, spec);
    for (let i = 0; i < 30; i++) step(false, 0);
    const r = step(true, 1);
    expect(r.fired).toBe(true);
    expect(r.drives.fired("k", false)).toBe(true);
  });

  it("a built-in reaction runs the detector on the sceneSignal it's given, and passes the scene's own edge through without one", () => {
    const sceneId = "hit-built-in";
    const spec: SceneSetting = { key: "k", label: "k", min: 0, max: 1, step: 0.05, default: 0, drive: { default: "scene", hit: {} } };
    setDriveThresholdOn(sceneId, spec, true);
    const clock = createAnimClock();
    const engine = createDriveEngine();
    const read = (edge: boolean, signal: number | undefined) => {
      const anim = clock.advance(DT, frame());
      engine.accumulate(DT, frame(), 0, anim, sceneId, [spec]);
      return engine.forScene(sceneId, [spec], anim).fired("k", edge, undefined, signal);
    };
    expect(read(true, undefined)).toBe(true);
    for (let i = 0; i < 30; i++) read(false, 0);
    expect(read(false, 1)).toBe(true); // the signal's climb stands out, whatever the edge says
    for (let i = 0; i < 30; i++) read(false, Math.exp(-6 * DT * (i + 1)));
  });

  it("draws its reach line while the threshold is On, and a dot for each reaction", () => {
    const sceneId = "hit-marks";
    const spec = hitSpec(sceneId, { reactionLabel: "burst" });
    setDriveThresholdOn(sceneId, spec, true);
    const step = rig(sceneId, spec);
    for (let i = 0; i < 30; i++) step(false, 0);
    takeSettingMarks(sceneId, "k", "test"); // a reader starts collecting from its first read
    expect(step(true, 1).fired).toBe(true);
    const marks = takeSettingMarks(sceneId, "k", "test")!;
    expect(marks.reactionLabel).toBe("burst");
    expect(marks.lines.map((l) => l.label)).toEqual(["reach to react"]);
    expect(marks.reaction).toBe(1);
  });
});

describe("hit drivers: the read-out", () => {
  it("defaults to the declaration's readout, else Flat, and a flatOnly setting is Flat whatever is stored", () => {
    const flat = hitSpec("readout-default");
    expect(getDriveReadout("readout-default", flat)).toBe("flat");
    const sized = hitSpec("readout-sized", { readout: "sized" });
    expect(getDriveReadout("readout-sized", sized)).toBe("sized");
    const only = hitSpec("readout-flat-only", { flatOnly: "A cut either happens or it doesn't." });
    setDriveReadout("readout-flat-only", only, "sized");
    expect(getDriveReadout("readout-flat-only", only)).toBe("flat");
    const plain: SceneSetting = { key: "p", label: "p", min: 0, max: 1, step: 0.05, default: 0, drive: { default: "feature.onset" } };
    expect(getDriveReadout("readout-plain", plain)).toBeUndefined();
  });

  it("with no engine, hitSize is 1 and readout is left to the caller", () => {
    expect(PASSTHROUGH_DRIVES.hitSize("k")).toBe(1);
    expect(PASSTHROUGH_DRIVES.readout("k")).toBeUndefined();
  });

  it("a scene that runs its own detector, or has a scene-handled threshold, is not an engine-run hit driver", () => {
    const own: SceneSetting = { key: "o", label: "o", min: 0, max: 1, step: 0.05, default: 0, drive: { default: "scene", hit: { ownDetector: true } } };
    const handled: SceneSetting = {
      key: "h",
      label: "h",
      min: 0,
      max: 1,
      step: 0.05,
      default: 0,
      drive: { default: "scene", hit: {}, threshold: { default: 0.25, label: "T", hint: "" } },
    };
    expect(isEngineHitDriver(own)).toBe(false);
    expect(isEngineHitDriver(handled)).toBe(false);
    expect(isEngineHitDriver(hitSpec("engine-hit"))).toBe(true);
  });
});

// Every setting a scene asks `drives.fired()` about reacts once per hit, so it
// has to declare `drive.hit`: otherwise its threshold row would be the generic
// gate and its Reaction row would be missing. Each registered scene's own
// files come from the same import closure its version is counted from
// (tools/sceneVersionLib.mjs).
describe("hit drivers: every drives.fired() setting declares drive.hit", () => {
  const root = path.resolve(__dirname, "..");
  const read = (rel: string) => {
    try {
      return readFileSync(path.join(root, rel), "utf8");
    } catch {
      return null;
    }
  };
  const exists = (rel: string) => existsSync(path.join(root, rel));
  const registry = read("src/render/scenes/index.ts")!;
  const entries = parseRegistryImports(registry) as { binding: string; unit: string; path: string }[];
  const entryFileOf = (p: string) => path.posix.join("src/render/scenes", p.replace(/^\.\//, ""));

  for (const entry of entries) {
    it(entry.binding, async () => {
      const entryFile = entryFileOf(entry.path);
      // Every scene file it imports, shared ones included (Physarum 2 runs on
      // physarum.ts's helpers); a key this scene has no setting for belongs
      // to another scene sharing the file.
      const files = [...fileClosure(entryFile, read, exists)].filter((f) => f.startsWith("src/render/scenes/") && !f.includes("/private/"));
      const keys = new Set<string>();
      for (const f of files) {
        const src = read(f);
        if (!src) continue;
        for (const m of src.matchAll(/drives\.fired\(\s*"([^"]+)"/g)) keys.add(m[1]!);
      }
      const mod = (await import(path.join(root, entryFile))) as Record<string, Scene>;
      const scene = mod[entry.binding]!;
      for (const key of keys) {
        const spec = scene.settings?.find((s) => s.key === key);
        if (!spec) continue;
        expect(spec.drive?.hit, `${scene.id}: "${key}" is read with drives.fired() but doesn't declare drive.hit`).toBeDefined();
      }
      // And the other way: an engine-run hit driver the scene never asks
      // fired() about would have a Reaction row that does nothing.
      for (const spec of scene.settings ?? []) {
        if (isEngineHitDriver(spec)) expect(keys.has(spec.key), `${scene.id}: "${spec.key}" declares drive.hit but is never read with drives.fired()`).toBe(true);
      }
    });
  }
});
