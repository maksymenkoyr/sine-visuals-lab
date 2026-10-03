import { afterEach, describe, expect, it } from "vitest";
import { createDriveEngine, expandReading } from "../src/render/drives.ts";
import { createAnimClock } from "../src/render/animClock.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";
import { SCENE_EXPANSION_DEFAULT, setSceneExpansion, type SceneSetting } from "../src/render/sceneSettings.ts";

// The Master card's Expansion acting on drive readings — drives.ts's
// header, "Master Expansion". "anim.energy" reads the driveEnergy handed to
// accumulate(), so each test plays a strength curve straight in.

const DT = 1 / 60;
const FRAME: FeatureFrame = {
  time: 0,
  bands: new Float32Array(NUM_BANDS),
  energy: 0,
  level: 1,
  onset: false,
  pulseOnset: false,
  bpm: 120,
  onsetPhase: 0,
};
const ANIM = createAnimClock().advance(DT, FRAME);
const SPEC: SceneSetting = { key: "amt", label: "Amount", min: 0, max: 1, step: 0.05, default: 0, drive: { default: "anim.energy" } };

/** Plays `seconds` of a constant strength into the engine, then returns
 *  what the scene reads. */
function play(engine: ReturnType<typeof createDriveEngine>, sceneId: string, strength: number, seconds: number): number {
  for (let t = 0; t < seconds; t += DT) engine.accumulate(DT, FRAME, strength, ANIM, sceneId, [SPEC]);
  return engine.forScene(sceneId, [SPEC], ANIM).value(SPEC.key, -1);
}

/** Two minutes at a usual level, then `seconds` at another. */
function excursion(expansion: number, sceneId: string, usual: number, then: number, seconds: number): number {
  setSceneExpansion(expansion);
  const engine = createDriveEngine();
  play(engine, sceneId, usual, 120);
  return play(engine, sceneId, then, seconds);
}

afterEach(() => setSceneExpansion(SCENE_EXPANSION_DEFAULT));

describe("Master Expansion on drive readings", () => {
  it("passes the reading through bit-for-bit at 1", () => {
    expect(excursion(1, "mx-identity", 0.6, 0.137, 4)).toBe(0.137);
    expect(expandReading(0.42, 0.1, 0.9, SCENE_EXPANSION_DEFAULT)).toBe(0.42);
  });

  it("low Expansion pulls a quiet stretch back to the normal level", () => {
    const v = excursion(0.25, "mx-low-dip", 0.6, 0.1, 4);
    expect(v).toBeGreaterThan(0.45);
    expect(v).toBeLessThan(0.65);
  });

  it("low Expansion keeps a sustained peak near the normal level", () => {
    const v = excursion(0.25, "mx-low-peak", 0.6, 0.9, 2);
    expect(v).toBeLessThan(0.7);
  });

  it("high Expansion holds a quiet stretch further down than the music itself", () => {
    expect(excursion(4, "mx-high-dip", 0.6, 0.1, 4)).toBeLessThan(0.1);
  });

  it("high Expansion throws a peak further than the music itself", () => {
    expect(excursion(4, "mx-high-peak", 0.6, 0.9, 2)).toBeGreaterThan(1);
  });

  it("a scene that opens on silence settles on the music within seconds", () => {
    setSceneExpansion(0.25);
    const engine = createDriveEngine();
    play(engine, "mx-warm-start", 0, 1);
    expect(play(engine, "mx-warm-start", 0.6, 10)).toBeGreaterThan(0.45);
  });

  it("never reads below zero", () => {
    expect(expandReading(0, 0.2, 0.9, 4)).toBe(0);
  });
});
