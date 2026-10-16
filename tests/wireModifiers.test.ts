import { afterEach, describe, expect, it } from "vitest";
import { createAnimClock } from "../src/render/animClock.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";
import { createDriveEngine, type DrivePatch, type DriveSetting } from "../src/render/drives.ts";
import { getDriveSetting, setDriveSetting } from "../src/render/driveStore.ts";
import { isDefaultDriveSetting, neutralModifierDef, throughModifiers, wireFromInput, wiresThroughModifiers, withoutNeutralModifiers } from "../src/render/wireModifiers.ts";
import { getShapingNode, listShapingNodes, removeShapingNode, updateShapingNode, type ShapingNodeDef } from "../src/render/shapingNodes.ts";
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
    ...overrides,
  };
}

function spec(key: string, def: DrivePatch): SceneSetting {
  return { key, label: key, min: 0, max: 1, step: 0.05, default: 0, drive: { default: def } };
}

const HATS_AND_ANY_HIT: DrivePatch = {
  mix: "add",
  sources: [
    { choice: "anim.hats", weight: 1.3 },
    { choice: "feature.onset", weight: 1, height: "fixed" },
  ],
};

// The node store is shared by the whole run: drop every node this file made.
const before = new Set(listShapingNodes().map((n) => n.id));
afterEach(() => {
  for (const n of listShapingNodes()) if (!before.has(n.id)) removeShapingNode(n.id);
});

function shapedIds(setting: DriveSetting): string[] {
  if (setting === "scene") return [];
  return setting.sources.map((s) => (typeof s.choice === "object" && s.choice.source === "shaped" ? s.choice.id : ""));
}

describe("wireModifiers: pure mapping", () => {
  it("throughModifiers moves Height into the modifier and keeps weight, role and mute on the wire", () => {
    const asked: ShapingNodeDef[] = [];
    const setting: DrivePatch = { mix: "gate", sources: [{ choice: "anim.hats", weight: 0.5 }, { choice: "anim.lowOnset", weight: 1, height: "loud", when: true, off: true }] };
    const out = throughModifiers(setting, (def) => {
      asked.push(def);
      return `n${asked.length}`;
    });
    expect(asked).toEqual([neutralModifierDef("anim.hats"), neutralModifierDef("anim.lowOnset", "loud")]);
    expect(out).toEqual({
      mix: "gate",
      sources: [
        { choice: { source: "shaped", id: "n1" }, weight: 0.5 },
        { choice: { source: "shaped", id: "n2" }, weight: 1, when: true, off: true },
      ],
    });
  });

  it("a beat grid, the drawn line and a divided Beat wave stay plain; so does a wire with no room for a modifier", () => {
    const setting: DrivePatch = {
      mix: "add",
      sources: [
        { choice: { source: "beat", grid: 0 }, weight: 1 },
        { choice: { source: "line" }, weight: 1 },
        { choice: "anim.beatWave", weight: 1, every: 4 },
        { choice: "anim.high", weight: 1 },
      ],
    };
    expect(throughModifiers(setting, () => null)).toEqual(setting);
    const out = throughModifiers(setting, () => "n9") as DrivePatch;
    expect(out.sources.slice(0, 3)).toEqual(setting.sources.slice(0, 3));
    expect(out.sources[3]!.choice).toEqual({ source: "shaped", id: "n9" });
  });

  it("withoutNeutralModifiers undoes throughModifiers, and leaves an edited modifier alone", () => {
    const defs = new Map<string, ShapingNodeDef>();
    const through = throughModifiers(HATS_AND_ANY_HIT, (def) => {
      const id = `n${defs.size + 1}`;
      defs.set(id, def);
      return id;
    });
    expect(withoutNeutralModifiers(through, (id) => defs.get(id))).toEqual(HATS_AND_ANY_HIT);
    defs.set("n1", { ...defs.get("n1")!, length: 0.4 });
    expect((withoutNeutralModifiers(through, (id) => defs.get(id)) as DrivePatch).sources[0]!.choice).toEqual({ source: "shaped", id: "n1" });
  });
});

describe("wireModifiers: wiresThroughModifiers", () => {
  it("an untouched default goes through shared modifiers and still counts as the default", () => {
    const a = spec("sparkle", HATS_AND_ANY_HIT);
    const b = spec("glow", { mix: "max", sources: [{ choice: "anim.hats", weight: 1 }] });
    wiresThroughModifiers("dm-scene-1", [a]);
    wiresThroughModifiers("dm-scene-2", [b]);

    const sa = getDriveSetting("dm-scene-1", a);
    const sb = getDriveSetting("dm-scene-2", b);
    const [hats, anyHit] = shapedIds(sa);
    expect(hats).toMatch(/^n\d+$/);
    expect(anyHit).toMatch(/^n\d+$/);
    expect(getShapingNode(anyHit!)!.height).toBe("fixed");
    // One Hats modifier for both scenes.
    expect(shapedIds(sb)).toEqual([hats]);
    expect(isDefaultDriveSetting(a, sa)).toBe(true);
    expect(isDefaultDriveSetting(b, sb)).toBe(true);

    // Running it again changes nothing.
    wiresThroughModifiers("dm-scene-1", [a]);
    expect(getDriveSetting("dm-scene-1", a)).toEqual(sa);
  });

  it("an edited modifier is no longer the default, and the next default makes a fresh neutral one", () => {
    const a = spec("sparkle", HATS_AND_ANY_HIT);
    wiresThroughModifiers("dm-scene-3", [a]);
    const [hats] = shapedIds(getDriveSetting("dm-scene-3", a));
    updateShapingNode(hats!, { length: 0.5 });
    expect(isDefaultDriveSetting(a, getDriveSetting("dm-scene-3", a))).toBe(false);

    const c = spec("other", { mix: "add", sources: [{ choice: "anim.hats", weight: 1 }] });
    wiresThroughModifiers("dm-scene-4", [c]);
    const [fresh] = shapedIds(getDriveSetting("dm-scene-4", c));
    expect(fresh).not.toBe(hats);
    expect(getShapingNode(fresh!)!.length).toBe(0);
  });

  it("a wire the user plugged goes through a modifier too; a built-in setting is left alone", () => {
    const a = spec("sparkle", HATS_AND_ANY_HIT);
    setDriveSetting("dm-scene-5", a, { mix: "add", sources: [{ choice: "anim.mid", weight: 0.7 }, { choice: { source: "beat", grid: 0 }, weight: 1 }] });
    const builtIn: SceneSetting = { key: "b", label: "b", min: 0, max: 1, step: 0.05, default: 0, drive: { default: "scene" } };
    wiresThroughModifiers("dm-scene-5", [a, builtIn]);
    const mine = getDriveSetting("dm-scene-5", a) as DrivePatch;
    const [mid] = shapedIds(mine);
    expect(getShapingNode(mid!)!.src).toBe("anim.mid");
    expect(mine.sources[0]!.weight).toBe(0.7);
    expect(mine.sources[1]!.choice).toEqual({ source: "beat", grid: 0 });
    expect(isDefaultDriveSetting(a, mine)).toBe(false);
    expect(getDriveSetting("dm-scene-5", builtIn)).toBe("scene");
  });

  it("wireFromInput finds an input's wire plain or through a modifier", () => {
    const a = spec("sparkle", HATS_AND_ANY_HIT);
    expect(wireFromInput(HATS_AND_ANY_HIT, "feature.onset")).toBe(1);
    wiresThroughModifiers("dm-scene-6", [a]);
    const through = getDriveSetting("dm-scene-6", a);
    expect(wireFromInput(through, "anim.hats")).toBe(0);
    expect(wireFromInput(through, "feature.onset")).toBe(1);
    expect(wireFromInput(through, "anim.mid")).toBe(-1);
    expect(wireFromInput("scene", "anim.mid")).toBe(-1);
  });
});

describe("wireModifiers: the picture does not change", () => {
  it("a default through neutral modifiers reads and fires exactly as the plain default", () => {
    const plain = spec("k", HATS_AND_ANY_HIT);
    const through = spec("k", HATS_AND_ANY_HIT);
    wiresThroughModifiers("dm-through", [through]);
    expect(shapedIds(getDriveSetting("dm-through", through)).every((id) => id !== "")).toBe(true);

    const plainEngine = createDriveEngine();
    const throughEngine = createDriveEngine();
    const clock = createAnimClock();
    let fires = 0;
    for (let i = 0; i < 240; i++) {
      const hit = i % 30 === 0;
      const f = frame({ time: i * DT, onset: hit, energy: 0.5, hats: (i % 7) / 7, bands: new Float32Array(NUM_BANDS).fill(0.4) });
      const anim = clock.advance(DT, f);
      plainEngine.accumulate(DT, f, 0.5, anim, "dm-plain", [plain]);
      throughEngine.accumulate(DT, f, 0.5, anim, "dm-through", [through]);
      const p = plainEngine.forScene("dm-plain", [plain], anim);
      const t = throughEngine.forScene("dm-through", [through], anim);
      expect(t.value("k", -1)).toBeCloseTo(p.value("k", -1), 9);
      const pf = p.fired("k", false);
      expect(t.fired("k", false)).toBe(pf);
      if (pf) fires++;
    }
    expect(fires).toBeGreaterThan(0);
  });
});
