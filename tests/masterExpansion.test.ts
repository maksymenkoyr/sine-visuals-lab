import { afterEach, describe, expect, it } from "vitest";
import { createDriveEngine, expandReading } from "../src/render/drives.ts";
import { createAnimClock } from "../src/render/animClock.ts";
import { NUM_BANDS, type FeatureFrame } from "../src/audio/types.ts";
import { SCENE_EXPANSION_DEFAULT, setSceneExpansion, setSceneExpansionShape, type SceneSetting } from "../src/render/sceneSettings.ts";

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

afterEach(() => {
  setSceneExpansion(SCENE_EXPANSION_DEFAULT);
  setSceneExpansionShape("even");
});

describe("Master Expansion on drive readings", () => {
  it("passes the reading through bit-for-bit at 1", () => {
    expect(excursion(1, "mx-identity", 0.6, 0.137, 4)).toBe(0.137);
    expect(expandReading(0.42, { normal: 0.1, usual: 0.9, recent: 0.5, ageSec: 60 }, SCENE_EXPANSION_DEFAULT, "even")).toBe(0.42);
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

  it("Soft top keeps a big jump under the reading's nominal top", () => {
    setSceneExpansionShape("softTop");
    const v = excursion(4, "mx-soft-peak", 0.6, 0.9, 2);
    expect(v).toBeGreaterThan(0.75);
    expect(v).toBeLessThanOrEqual(1);
  });

  it("Soft top leaves a dip exactly as Even has it", () => {
    const even = excursion(4, "mx-soft-dip-even", 0.6, 0.3, 2);
    setSceneExpansionShape("softTop");
    expect(excursion(4, "mx-soft-dip-soft", 0.6, 0.3, 2)).toBeCloseTo(even, 12);
  });

  it("Up only follows a peak as Even does but leaves a dip at normal", () => {
    const evenPeak = excursion(4, "mx-up-peak-even", 0.6, 0.9, 2);
    setSceneExpansionShape("upOnly");
    expect(excursion(4, "mx-up-peak", 0.6, 0.9, 2)).toBeCloseTo(evenPeak, 12);
    // At `normal`, which itself drifts a little toward the dip.
    const dip = excursion(4, "mx-up-dip", 0.6, 0.1, 4);
    expect(dip).toBeGreaterThan(0.5);
    expect(dip).toBeLessThanOrEqual(0.6);
  });

  it("Down only follows a dip as Even does but leaves a peak at normal", () => {
    const evenDip = excursion(4, "mx-down-dip-even", 0.6, 0.1, 4);
    setSceneExpansionShape("downOnly");
    expect(excursion(4, "mx-down-dip", 0.6, 0.1, 4)).toBeCloseTo(evenDip, 12);
    const peak = excursion(4, "mx-down-peak", 0.6, 0.9, 2);
    expect(peak).toBeGreaterThanOrEqual(0.6);
    expect(peak).toBeLessThan(0.65);
  });

  it("Big moves only ignores beat-to-beat pulses but follows a section change", () => {
    setSceneExpansionShape("bigMoves");
    setSceneExpansion(2);
    const engine = createDriveEngine();
    const sceneId = "mx-big-moves";
    const beat = (t: number) => (t % 0.5 < 0.1 ? 0.9 : 0.3); // kicks on a steady level
    let t = 0;
    const read = () => engine.forScene(sceneId, [SPEC], ANIM).value(SPEC.key, -1);
    let lo = Infinity, hi = -Infinity;
    for (; t < 120; t += DT) {
      engine.accumulate(DT, FRAME, beat(t), ANIM, sceneId, [SPEC]);
      if (t > 100) { const v = read(); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    expect(hi - lo).toBeLessThan(0.05); // steady section: the kicks don't move it
    const before = read();
    for (const end = t + 4; t < end; t += DT) engine.accumulate(DT, FRAME, 0.05, ANIM, sceneId, [SPEC]);
    expect(read()).toBeLessThan(before - 0.2); // breakdown: it does
  });

  it("masterExcursion reports how far the picture sits from normal, for the gauge's needle", () => {
    const engine = createDriveEngine();
    const sceneId = "mx-gauge";
    expect(engine.forScene(sceneId, [SPEC], ANIM).masterExcursion()).toBeNull();
    play(engine, sceneId, 0.4, 120);
    expect(Math.abs(engine.forScene(sceneId, [SPEC], ANIM).masterExcursion()!)).toBeLessThan(0.02);
    play(engine, sceneId, 0.9, 1);
    expect(engine.forScene(sceneId, [SPEC], ANIM).masterExcursion()!).toBeGreaterThan(0.4);
  });

  it("expansionPair hands the graph the reading before and after Expansion, and nothing at 1×", () => {
    const engine = createDriveEngine();
    const sceneId = "mx-pair";
    play(engine, sceneId, 0.6, 120);
    expect(engine.forScene(sceneId, [SPEC], ANIM).expansionPair(SPEC.key)).toBeNull();
    setSceneExpansion(4);
    const after = play(engine, sceneId, 0.9, 2);
    const pair = engine.forScene(sceneId, [SPEC], ANIM).expansionPair(SPEC.key)!;
    expect(pair.before).toBeCloseTo(0.9, 6);
    expect(pair.after).toBe(after); // what the scene reads, with the generic gate off
    expect(pair.after).toBeGreaterThan(pair.before);
  });

  it("never reads below zero", () => {
    expect(expandReading(0, { normal: 0.2, usual: 0.9, recent: 0.9, ageSec: 60 }, 4, "even")).toBe(0);
  });
});
