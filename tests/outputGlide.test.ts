import { describe, it, expect } from "vitest";
import { LOOK_LIMITS } from "../server/lookDoc.ts";
import { createGlide, glideSafe, GLIDE_MAX_MS } from "../src/net/outputGlide.ts";
import type { OutputState } from "../src/net/outputSync.ts";
import type { SceneSetting } from "../src/render/sceneSettings.ts";

const slider = (key: string, over: Partial<SceneSetting> = {}): SceneSetting => ({
  key,
  label: key,
  min: 0,
  max: 1,
  step: 0.05,
  default: 0.5,
  ...over,
});

const SPECS: SceneSetting[] = [
  slider("speed"),
  slider("count", { step: 1, min: 0, max: 20, default: 4 }),
  slider("density", { glide: false }),
  slider("mode", { type: "enum", options: ["a", "b"], min: 0, max: 1, step: 1, default: 0 }),
  slider("flag", { type: "boolean", min: 0, max: 1, step: 1, default: 0 }),
  slider("style", { type: "enum", options: ["a", "b"], min: 0, max: 1, step: 1, default: 0, variant: true }),
];

const P = { sens: 1, exp: 1, smoothing: 1 };
const look = (scene: string, store: Record<string, Record<string, number>>, extra: Record<string, string> = {}, params = P): OutputState => ({
  scene,
  palette: "neon",
  storage: { "vibe.sceneSettings": JSON.stringify(store), ...extra },
  params,
});
const read = (s: OutputState) => JSON.parse(s.storage["vibe.sceneSettings"]) as Record<string, Record<string, number>>;

describe("glideSafe", () => {
  it("takes plain fine-stepped sliders only", () => {
    expect(glideSafe(SPECS[0])).toBe(true);
    expect(glideSafe(SPECS[1])).toBe(false); // whole-number stepper: a count or a seed
    expect(glideSafe(SPECS[2])).toBe(false); // opted out
    expect(glideSafe(SPECS[3])).toBe(false); // enum
    expect(glideSafe(SPECS[4])).toBe(false); // boolean
    expect(glideSafe(SPECS[5])).toBe(false); // the scene's variant
    expect(glideSafe(slider("pad", { item: { family: "strain", index: 0, param: "p" } }))).toBe(false);
  });
});

describe("createGlide", () => {
  it("never glides across a scene change", () => {
    expect(createGlide(look("a", { a: { speed: 0 } }), look("b", { b: { speed: 1 } }), SPECS, 0, 6000)).toBeNull();
  });

  it("has nothing to do when no safe value differs", () => {
    const a = look("a", { a: { count: 1, mode: 0 } });
    const b = look("a", { a: { count: 9, mode: 1 } }); // only unsafe ones differ
    expect(createGlide(a, b, SPECS, 0, 6000)).toBeNull();
  });

  it("walks a safe slider from old to new over the duration and lands exactly", () => {
    const g = createGlide(look("a", { a: { speed: 0 } }), look("a", { a: { speed: 1 } }), SPECS, 1000, 6000)!;
    expect(read(g.lookAt(1000).state).a.speed).toBeCloseTo(0, 9);
    const mid = g.lookAt(4000);
    expect(mid.done).toBe(false);
    expect(read(mid.state).a.speed).toBeCloseTo(0.5, 9); // halfway through an ease-in-out
    const end = g.lookAt(7000);
    expect(end.done).toBe(true);
    expect(read(end.state).a.speed).toBe(1);
  });

  it("eases: slower at the ends than a straight line", () => {
    const g = createGlide(look("a", { a: { speed: 0 } }), look("a", { a: { speed: 1 } }), SPECS, 0, 1000)!;
    expect(read(g.lookAt(100).state).a.speed).toBeLessThan(0.1);
    expect(read(g.lookAt(900).state).a.speed).toBeGreaterThan(0.9);
  });

  it("uses the setting's default where a side has no stored value", () => {
    const g = createGlide(look("a", {}), look("a", { a: { speed: 1 } }), SPECS, 0, 1000)!;
    expect(read(g.lookAt(500).state).a.speed).toBeCloseTo(0.75, 9); // default 0.5 -> 1
  });

  it("leaves everything unsafe exactly as it was until the glide lands", () => {
    const from = look("a", { a: { speed: 0, count: 1, mode: 0, density: 0 } }, { "vibe.other": "old" });
    const to = look("a", { a: { speed: 1, count: 9, mode: 1, density: 1 } }, { "vibe.other": "new" });
    const g = createGlide(from, to, SPECS, 0, 1000)!;
    const mid = g.lookAt(500).state;
    expect(read(mid).a).toMatchObject({ count: 1, mode: 0, density: 0 });
    expect(mid.storage["vibe.other"]).toBe("old");
    expect(mid.palette).toBe("neon");
    const end = g.lookAt(1000);
    expect(end.state).toBe(to);
    expect(read(end.state).a).toMatchObject({ speed: 1, count: 9, mode: 1, density: 1 });
  });

  it("glides the two Master dials and the resolved params", () => {
    const from = look("a", { a: { speed: 0 } }, { "vibe.sceneMaster": "1", "vibe.sceneExpansion": "1" }, { sens: 1, exp: 1, smoothing: 1 });
    const to = look("a", { a: { speed: 0 } }, { "vibe.sceneMaster": "2", "vibe.sceneExpansion": "3" }, { sens: 3, exp: 2, smoothing: 0 });
    const g = createGlide(from, to, SPECS, 0, 1000)!;
    const mid = g.lookAt(500).state;
    expect(Number(mid.storage["vibe.sceneMaster"])).toBeCloseTo(1.5, 9);
    expect(Number(mid.storage["vibe.sceneExpansion"])).toBeCloseTo(2, 9);
    expect(mid.params.sens).toBeCloseTo(2, 9);
    expect(mid.params.smoothing).toBeCloseTo(0.5, 9);
  });

  it("glides a variant-scoped value too", () => {
    const g = createGlide(look("a", { "a@wide": { speed: 0 } }), look("a", { "a@wide": { speed: 1 } }), SPECS, 0, 1000)!;
    expect(read(g.lookAt(500).state)["a@wide"].speed).toBeCloseTo(0.5, 9);
  });

  it("does not touch another scene's stored values", () => {
    const from = look("a", { a: { speed: 0 }, z: { speed: 0 } });
    const to = look("a", { a: { speed: 1 }, z: { speed: 1 } });
    const g = createGlide(from, to, SPECS, 0, 1000)!;
    expect(read(g.lookAt(500).state).z.speed).toBe(0);
  });

  it("caps an absurd duration", () => {
    const g = createGlide(look("a", { a: { speed: 0 } }), look("a", { a: { speed: 1 } }), SPECS, 0, 10 * GLIDE_MAX_MS)!;
    expect(g.lookAt(GLIDE_MAX_MS).done).toBe(true);
  });
});

describe("the room's glide ceiling", () => {
  it("is the same as the glide's own, so a patch can never ask for more than a glide gives", () => {
    expect(LOOK_LIMITS.maxGlideMs).toBe(GLIDE_MAX_MS);
  });
});
