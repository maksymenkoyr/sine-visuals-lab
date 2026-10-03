import { describe, it, expect } from "vitest";
import {
  physarum2TrailSide,
  stepAccumulator,
  advanceCrawlPump,
  createCrawlPumpState,
  crawlStepRate,
  physarum2Scene,
  STRAINS,
  SPECIES_COUNT,
  ATTRACT_ROWS,
  TRAIL_SIDE_CAP,
  TRAIL_SIDE_MIN,
  AGENTS_PER_TEXEL,
  AGENT_MULTIPLIER,
  MAX_STEPS_PER_FRAME,
  hueRotateRGB,
  sensorSliderToDist,
  distToSensorSlider,
  turnSliderToDeg,
  degToTurnSlider,
  strideSliderToDist,
  distToStrideSlider,
  seedSpreadSliderToRadius,
  radiusToSeedSpreadSlider,
  resolveStrainEffective,
  equalPopulation,
  applyInjection,
  classifyTerritory,
  TERRITORY_THRESHOLD,
  roomAspectJs,
  roomUvJs,
  coverUvJs,
  uncoverUvJs,
  screenToFieldUv,
  STRAIN_BAND_SIGNALS,
  NUTRIENT_REST,
  LIFE_DEFAULT,
  lifeToDecayMul,
  ANGLE_MIN_DEG,
  ANGLE_MAX_DEG,
  SWITCHING_DEFAULT,
  populationFromBlocks,
  levelPeaks,
  levelGainsFull,
  levelGain,
  LEVEL_GAIN_MIN,
  LEVEL_GAIN_MAX,
  LEVEL_PEAK_FLOOR,
  LEVEL_DEFAULT,
  fillStartInk,
  START_INK_DEFAULT,
  MOTION_PARAMS,
  MOTION_PRESETS,
  type StrainRawValues,
  type StrainDriveValues,
} from "../src/render/scenes/physarum2.ts";
import { FULL_VIEWPORT, type Viewport } from "../src/render/scene.ts";
import { computeAutoTarget, setAutoEnabled } from "../src/render/autoTune.ts";
import { NEUTRAL } from "../src/render/musicProfile.ts";
import { qualitySettings } from "../src/render/quality.ts";
import { getSceneSetting, resetSceneSettings, setSceneSetting } from "../src/render/sceneSettings.ts";
import { applyLook, captureLook, decodeLook, encodeLook } from "../src/render/sceneLooks.ts";

describe("physarum2TrailSide", () => {
  it("holds agent density per texel roughly constant across the quality presets' agent counts", () => {
    for (const preset of ["high", "mid", "low", "floor"] as const) {
      const count = qualitySettings(preset).maxParticles * AGENT_MULTIPLIER;
      const side = physarum2TrailSide(count, TRAIL_SIDE_CAP);
      const density = count / (side * side);
      expect(density).toBeCloseTo(AGENTS_PER_TEXEL, 0);
    }
  });

  it("clamps to [TRAIL_SIDE_MIN, maxSide]", () => {
    expect(physarum2TrailSide(1, 1024)).toBeGreaterThanOrEqual(TRAIL_SIDE_MIN);
    expect(physarum2TrailSide(10_000_000, 1024)).toBeLessThanOrEqual(1024);
    expect(physarum2TrailSide(10_000_000, 10)).toBeLessThanOrEqual(10);
  });

  it("is always an integer, never 0, for a 0/negative/NaN count", () => {
    for (const count of [0, -5, NaN]) {
      const side = physarum2TrailSide(count, TRAIL_SIDE_CAP);
      expect(Number.isInteger(side)).toBe(true);
      expect(side).toBeGreaterThan(0);
    }
  });

  it("is monotonically non-decreasing in agent count", () => {
    let prev = physarum2TrailSide(1, TRAIL_SIDE_CAP);
    for (const count of [10, 100, 1000, 10_000, 100_000, 800_000]) {
      const side = physarum2TrailSide(count, TRAIL_SIDE_CAP);
      expect(side).toBeGreaterThanOrEqual(prev);
      prev = side;
    }
  });
});

describe("stepAccumulator", () => {
  it("never returns more than MAX_STEPS_PER_FRAME steps even for a huge dt/rate", () => {
    const { steps } = stepAccumulator(0, 1, 120);
    expect(steps).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
  });

  it("accumulates fractional progress across frames rather than dropping it", () => {
    // At 30 steps/sec, a 1/60s frame owes half a step — two such frames
    // should produce exactly one step total, not zero.
    const a = stepAccumulator(0, 1 / 60, 30);
    expect(a.steps).toBe(0);
    const b = stepAccumulator(a.acc, 1 / 60, 30);
    expect(b.steps).toBe(1);
  });

  it("drops backlog past the cap instead of carrying it forward", () => {
    // A huge dt owes far more than MAX_STEPS_PER_FRAME steps; the leftover
    // accumulator should be reset rather than left large enough to replay
    // the backlog over the next few frames.
    const { steps, acc } = stepAccumulator(0, 10, 120);
    expect(steps).toBe(MAX_STEPS_PER_FRAME);
    expect(acc).toBeLessThanOrEqual(1);
  });

  it("tolerates non-finite input without throwing or producing NaN", () => {
    const r = stepAccumulator(NaN, NaN, NaN);
    expect(Number.isFinite(r.steps)).toBe(true);
    expect(Number.isFinite(r.acc)).toBe(true);
  });

  it("never lets the accumulator grow unboundedly", () => {
    let acc = 0;
    for (let i = 0; i < 1000; i++) {
      ({ acc } = stepAccumulator(acc, 1 / 60, 120));
    }
    expect(acc).toBeLessThanOrEqual(1);
  });
});

describe("STRAINS / ATTRACT_ROWS shape", () => {
  it("STRAINS and ATTRACT_ROWS each have exactly SPECIES_COUNT entries", () => {
    expect(STRAINS.length).toBe(SPECIES_COUNT);
    expect(ATTRACT_ROWS.length).toBe(SPECIES_COUNT);
  });

  it("every attraction row has SPECIES_COUNT weights, own-strain weight positive", () => {
    for (let k = 0; k < SPECIES_COUNT; k++) {
      const row = ATTRACT_ROWS[k];
      expect(row.length).toBe(SPECIES_COUNT);
      expect(row[k]).toBeGreaterThan(0);
    }
  });

  it("every strain has a positive fixed sensor angle and a channel colour in [0, 1]", () => {
    for (const s of STRAINS) {
      expect(s.sensorAngleRad).toBeGreaterThan(0);
      for (const channel of s.color) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it("every strain has a unique, non-empty code", () => {
    const codes = STRAINS.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code.length).toBeGreaterThan(0);
  });
});

describe("hueRotateRGB", () => {
  it("returns the input unchanged (not just close) at shift 0", () => {
    const rgb: [number, number, number] = [1.0, 0.3, 0.28];
    expect(hueRotateRGB(rgb, 0)).toEqual(rgb);
  });

  it("wraps a full turn back to (approximately) the same colour", () => {
    const rgb: [number, number, number] = [0.05, 0.78, 0.7];
    const rotated = hueRotateRGB(rgb, 1);
    rotated.forEach((c, i) => expect(c).toBeCloseTo(rgb[i]!, 5));
  });

  it("actually shifts hue for a non-zero shift (channels reorder)", () => {
    const rgb: [number, number, number] = [1.0, 0.3, 0.28];
    const rotated = hueRotateRGB(rgb, 1 / 3);
    expect(rotated).not.toEqual(rgb);
  });
});

describe("per-strain settings", () => {
  const settings = physarum2Scene.settings ?? [];

  it("removed the old shared feed/beatSurge settings", () => {
    expect(settings.find((s) => s.key === "feed")).toBeUndefined();
    expect(settings.find((s) => s.key === "beatSurge")).toBeUndefined();
  });

  it("generates nutrient/excite/sensor/turn/stride/stain for every strain, tagged item family strain", () => {
    for (const param of ["nutrient", "excite", "sensor", "turn", "stride", "stain"]) {
      for (let k = 0; k < SPECIES_COUNT; k++) {
        const spec = settings.find((s) => s.key === `${param}${k}`);
        expect(spec, `missing ${param}${k}`).toBeDefined();
        expect(spec!.item).toEqual({ family: "strain", index: k, param });
      }
    }
  });

  it("generates a full att<i><j> affinity matrix defaulting to ATTRACT_ROWS, tagged with `other`", () => {
    for (let i = 0; i < SPECIES_COUNT; i++) {
      for (let j = 0; j < SPECIES_COUNT; j++) {
        const spec = settings.find((s) => s.key === `att${i}${j}`);
        expect(spec, `missing att${i}${j}`).toBeDefined();
        expect(spec!.default).toBe(ATTRACT_ROWS[i]![j]);
        expect(spec!.item).toEqual({ family: "strain", index: i, param: "att", other: j });
      }
    }
  });

  it("nutrient defaults to 0.6 and excite to 0.1 for every strain (the old shared defaults)", () => {
    for (let k = 0; k < SPECIES_COUNT; k++) {
      expect(settings.find((s) => s.key === `nutrient${k}`)!.default).toBe(0.6);
      expect(settings.find((s) => s.key === `excite${k}`)!.default).toBe(0.1);
    }
  });

  it("sensor/turn/stride defaults round-trip through the slider mapping to the old fixed motion", () => {
    // The scene's own motion before per-strain sliders existed — physarum2.ts's
    // own LEGACY_MOTION, duplicated here as the regression's expected values.
    const legacy = [
      { sensorDist: 30, turnDeg: 40, strideDist: 1.4 },
      { sensorDist: 12, turnDeg: 35, strideDist: 0.9 },
      { sensorDist: 45, turnDeg: 100, strideDist: 1.8 },
      { sensorDist: 5, turnDeg: 20, strideDist: 0.45 },
    ];
    for (let k = 0; k < SPECIES_COUNT; k++) {
      const sensorDefault = settings.find((s) => s.key === `sensor${k}`)!.default;
      const turnDefault = settings.find((s) => s.key === `turn${k}`)!.default;
      const strideDefault = settings.find((s) => s.key === `stride${k}`)!.default;
      expect(sensorSliderToDist(sensorDefault)).toBeCloseTo(legacy[k]!.sensorDist, 9);
      expect(turnSliderToDeg(turnDefault)).toBeCloseTo(legacy[k]!.turnDeg, 9);
      expect(strideSliderToDist(strideDefault)).toBeCloseTo(legacy[k]!.strideDist, 9);
      // And the inverse direction agrees with the forward one.
      expect(distToSensorSlider(legacy[k]!.sensorDist)).toBeCloseTo(sensorDefault, 9);
      expect(degToTurnSlider(legacy[k]!.turnDeg)).toBeCloseTo(turnDefault, 9);
      expect(distToStrideSlider(legacy[k]!.strideDist)).toBeCloseTo(strideDefault, 9);
    }
  });

  it("sensor/turn/stride/stain each default to their own strain's band (STRAIN_BAND_SIGNALS), same as Nutrient's own Scene composite", () => {
    for (let k = 0; k < SPECIES_COUNT; k++) {
      for (const param of ["sensor", "turn", "stride", "stain"] as const) {
        expect(settings.find((s) => s.key === `${param}${k}`)!.drive?.default, `${param}${k}`).toBe(STRAIN_BAND_SIGNALS[k]);
      }
      expect(settings.find((s) => s.key === `nutrient${k}`)!.drive?.default, `nutrient${k}`).toBe("scene");
      expect(settings.find((s) => s.key === `nutrient${k}`)!.drive?.sceneSources, `nutrient${k}.sceneSources`).toEqual([STRAIN_BAND_SIGNALS[k]]);
    }
  });

  it("stain defaults to 0 for every strain (Stain's own colour, unshifted)", () => {
    for (let k = 0; k < SPECIES_COUNT; k++) {
      expect(settings.find((s) => s.key === `stain${k}`)!.default).toBe(0);
    }
  });

  it("has one Strains panel section over the itemBoxes widget, claiming family \"strain\"", () => {
    const panel = physarum2Scene.panel ?? [];
    expect(panel.length).toBe(1);
    expect(panel[0]!.widget).toBe("itemBoxes");
    expect(panel[0]!.items).toBe("strain");
  });

  it("generates exactly the off-diagonal touch<i><j> keys — no touchii", () => {
    for (let i = 0; i < SPECIES_COUNT; i++) {
      for (let j = 0; j < SPECIES_COUNT; j++) {
        const spec = settings.find((s) => s.key === `touch${i}${j}`);
        if (i === j) {
          expect(spec, `touch${i}${j} should not exist`).toBeUndefined();
        } else {
          expect(spec, `missing touch${i}${j}`).toBeDefined();
          expect(spec!.default).toBe(0);
          expect(spec!.min).toBe(-1.5);
          expect(spec!.max).toBe(1.5);
          expect(spec!.item).toEqual({ family: "strain", index: i, param: "touch", other: j });
        }
      }
    }
  });

  it("att and touch are all exempt from the scene master and have no auto/drive", () => {
    for (const spec of settings) {
      if (spec.item?.param === "att" || spec.item?.param === "touch") {
        expect(spec.masterScale, `${spec.key} masterScale`).toBe(false);
        expect(spec.auto, `${spec.key} auto`).toBeUndefined();
        expect(spec.drive, `${spec.key} drive`).toBeUndefined();
      }
    }
  });
});

describe("physarum2 Looks back-compat (att/touch)", () => {
  const ID = "physarum2";
  const specs = physarum2Scene.settings ?? [];

  it("an old Look with no touch keys resets every touch key to 0", () => {
    // Dirty every touch value first, so a Look that says nothing about touch
    // must still be authoritative (applyLook puts an absent key back to its
    // default, not leaving it untouched) — see sceneLooks.ts's header.
    for (const spec of specs) {
      if (spec.item?.param === "touch") setSceneSetting(ID, spec, -0.9);
    }
    applyLook({ name: "old", sceneId: ID, manual: { att01: 0.5 } }, specs);
    for (const spec of specs) {
      if (spec.item?.param === "touch") expect(getSceneSetting(ID, spec)).toBe(0);
    }
    resetSceneSettings(ID, specs);
  });

  it("a captured/encoded/decoded Look round-trips a touch value", () => {
    const touch01 = specs.find((s) => s.key === "touch01")!;
    // The previous test's applyLook put every key not in its manual (every
    // touch key included) back into auto — captureLook only captures a
    // key's manual value while it's NOT auto, so this test's own dirty step
    // must explicitly turn auto back off first.
    setAutoEnabled(ID, touch01.key, false);
    setSceneSetting(ID, touch01, -0.9);
    const look = captureLook("mine", ID, specs);
    const code = encodeLook(look);
    const decoded = decodeLook(code)!;
    expect(decoded).not.toBeNull();
    resetSceneSettings(ID, specs);
    applyLook(decoded, specs);
    expect(getSceneSetting(ID, touch01)).toBe(-0.9);
    resetSceneSettings(ID, specs);
  });
});

describe("physarum2's auto settings reproduce their default at NEUTRAL", () => {
  it("every setting with an auto table resolves to spec.default when every dial sits at NEUTRAL", () => {
    const settings = physarum2Scene.settings ?? [];
    const withAuto = settings.filter((s) => s.auto);
    expect(withAuto.length).toBeGreaterThan(0);
    for (const spec of withAuto) {
      expect(computeAutoTarget(spec, NEUTRAL, 1)).toBe(spec.default);
    }
  });
});

describe("Phase 3 settings: Dose (relabelled seed), Spread, Auto-inject from", () => {
  const settings = physarum2Scene.settings ?? [];

  it("relabels \"seed\" to \"Dose\" without changing its key, default or step", () => {
    const spec = settings.find((s) => s.key === "seed")!;
    expect(spec.label).toBe("Dose");
    expect(spec.default).toBe(0.01);
    expect(spec.step).toBe(0.01);
  });

  it("seedSpread's default reproduces the scene's old fixed reseed radius (0.12)", () => {
    const spec = settings.find((s) => s.key === "seedSpread")!;
    expect(spec.group).toBe("Motion");
    expect(seedSpreadSliderToRadius(spec.default)).toBeCloseTo(0.12, 9);
    // And the inverse direction agrees with the forward one.
    expect(radiusToSeedSpreadSlider(0.12)).toBeCloseTo(spec.default, 9);
  });

  it("seedFrom is an enum of \"All strains\" plus every strain code, defaulting to \"All strains\"", () => {
    const spec = settings.find((s) => s.key === "seedFrom")!;
    expect(spec.group).toBe("Motion");
    expect(spec.type).toBe("enum");
    expect(spec.options).toEqual(["All strains", ...STRAINS.map((s) => s.code)]);
    expect(spec.default).toBe(0);
    expect(spec.max).toBe(SPECIES_COUNT);
  });

  it("Dose/Switching/Spread/Auto-inject from all sit in one contiguous Motion run with Crawl speed", () => {
    const motionKeys = settings.filter((s) => s.group === "Motion").map((s) => s.key);
    expect(motionKeys).toEqual(["speed", "speedBoost", "speedPump", "seed", "switching", "seedSpread", "seedFrom"]);
  });
});

describe("Crawl speed / Speed boost / Speed pump", () => {
  it("advanceCrawlPump: a push accelerates, then the extra speed coasts back to zero", () => {
    const st = createCrawlPumpState();
    for (let i = 0; i < 12; i++) advanceCrawlPump(st, 1 / 60, 1, 1);
    const peak = st.vel;
    expect(peak).toBeGreaterThan(0);
    for (let i = 0; i < 60 * 15; i++) advanceCrawlPump(st, 1 / 60, 0, 1);
    expect(st.vel).toBeLessThan(peak * 0.001);
  });

  it("advanceCrawlPump: no amount or no input never moves it, and a dense run stays capped", () => {
    const a = createCrawlPumpState();
    advanceCrawlPump(a, 1 / 60, 1, 0);
    advanceCrawlPump(a, 1 / 60, 0, 1);
    expect(a.vel).toBe(0);
    const b = createCrawlPumpState();
    for (let i = 0; i < 60 * 60; i++) advanceCrawlPump(b, 1 / 60, 1, 1);
    expect(b.vel).toBeLessThanOrEqual(60);
    const bad = createCrawlPumpState();
    advanceCrawlPump(bad, NaN, NaN, NaN);
    expect(bad.vel).toBe(0);
  });

  it("crawlStepRate: the base alone is the old 30..120 map", () => {
    expect(crawlStepRate({ speed: 0, boost: 0, level: 0, pumpVel: 0 })).toBe(30);
    expect(crawlStepRate({ speed: 0.5, boost: 0, level: 1, pumpVel: 0 })).toBe(75);
    expect(crawlStepRate({ speed: 1, boost: 0, level: 0, pumpVel: 0 })).toBe(120);
  });

  it("crawlStepRate: boost and pump add on top, even with the base at its slowest", () => {
    const base = crawlStepRate({ speed: 0, boost: 0, level: 0, pumpVel: 0 });
    expect(crawlStepRate({ speed: 0, boost: 1, level: 1, pumpVel: 0 })).toBeGreaterThan(base);
    expect(crawlStepRate({ speed: 0, boost: 0, level: 0, pumpVel: 20 })).toBe(base + 20);
    // an unplugged boost jack (level 0) adds nothing at any slider value
    expect(crawlStepRate({ speed: 0.5, boost: 1, level: 0, pumpVel: 0 })).toBe(75);
  });

  it("crawlStepRate: never exceeds the cap", () => {
    expect(crawlStepRate({ speed: 1, boost: 1, level: 1, pumpVel: 60 })).toBeLessThanOrEqual(150);
  });
});

describe("resolveStrainEffective — the one strain-motion mapping (shared by the GPU packing and the specimen-box previews)", () => {
  const zeroRaw: StrainRawValues = { nutrient: 0, excite: 0, sensor: 0, turn: 0, stride: 0, stain: 0, angle: 22, life: LIFE_DEFAULT };
  const zeroDrive: StrainDriveValues = { nutrient: 0, excite: 0, sensor: 0, turn: 0, stride: 0, stain: 0 };

  it("at zero raw values and zero drive, reproduces the sliders' own MIN and the strain's unshifted colour", () => {
    for (let k = 0; k < SPECIES_COUNT; k++) {
      const eff = resolveStrainEffective(k, zeroRaw, zeroDrive);
      expect(eff.sensorDist).toBeCloseTo(sensorSliderToDist(0), 9);
      expect(eff.rotationRad).toBeCloseTo(turnSliderToDeg(0) * (Math.PI / 180), 9);
      expect(eff.stepDist).toBeCloseTo(strideSliderToDist(0), 9); // surge = 1 at excite drive 0
      expect(eff.feed).toBeCloseTo(1, 9); // lerp(1, X, 0) === 1 regardless of X
      expect(eff.color).toEqual(STRAINS[k]!.color);
    }
  });

  it("matches the plain slider->physical conversion at every strain's stored default, undriven — the same invariant the old inline resolveStrains code kept, now through the shared function", () => {
    const settings = physarum2Scene.settings ?? [];
    for (let k = 0; k < SPECIES_COUNT; k++) {
      const raw: StrainRawValues = {
        ...zeroRaw,
        sensor: settings.find((s) => s.key === `sensor${k}`)!.default,
        turn: settings.find((s) => s.key === `turn${k}`)!.default,
        stride: settings.find((s) => s.key === `stride${k}`)!.default,
      };
      const eff = resolveStrainEffective(k, raw, zeroDrive);
      expect(eff.sensorDist).toBeCloseTo(sensorSliderToDist(raw.sensor), 9);
      expect(eff.rotationRad).toBeCloseTo(turnSliderToDeg(raw.turn) * (Math.PI / 180), 9);
      expect(eff.stepDist).toBeCloseTo(strideSliderToDist(raw.stride), 9);
    }
  });

  it("Excitability's drive multiplies stepDist by the surge formula (1 + excite*drive*6), independent of sensor/turn", () => {
    const raw: StrainRawValues = { ...zeroRaw, excite: 0.5, stride: 0.5 };
    const drive: StrainDriveValues = { ...zeroDrive, excite: 1 };
    const eff = resolveStrainEffective(0, raw, drive);
    const expectedSurge = 1 + 0.5 * 1 * 6.0; // physarum2.ts's own SURGE_GAIN
    expect(eff.stepDist).toBeCloseTo(strideSliderToDist(0.5) * expectedSurge, 6);
  });

  it("a non-zero Stain value or drive actually shifts the colour away from STRAINS' own base", () => {
    const raw: StrainRawValues = { ...zeroRaw, stain: 0.2 };
    const eff = resolveStrainEffective(0, raw, zeroDrive);
    expect(eff.color).not.toEqual(STRAINS[0]!.color);
  });

  it("with drive.nutrient at NUTRIENT_REST, feed is exactly 1 regardless of the raw slider (an unplugged Nutrient jack doesn't run the slider backwards)", () => {
    for (const nutrient of [0, 0.6, 1]) {
      const raw: StrainRawValues = { ...zeroRaw, nutrient };
      const drive: StrainDriveValues = { ...zeroDrive, nutrient: NUTRIENT_REST };
      const eff = resolveStrainEffective(0, raw, drive);
      expect(eff.feed).toBeCloseTo(1, 9);
    }
  });
});

describe("Strain Console settings: Sensor angle, Trail life, Switching, Synergy", () => {
  const settings = physarum2Scene.settings ?? [];

  it("Sensor angle is a per-strain slider in degrees whose default is the strain's own fixed angle", () => {
    for (let k = 0; k < SPECIES_COUNT; k++) {
      const spec = settings.find((s) => s.key === `angle${k}`)!;
      expect(spec.item).toEqual({ family: "strain", index: k, param: "angle" });
      expect(spec.min).toBe(ANGLE_MIN_DEG);
      expect(spec.max).toBe(ANGLE_MAX_DEG);
      expect(spec.default * (Math.PI / 180)).toBeCloseTo(STRAINS[k]!.sensorAngleRad, 2);
    }
  });

  it("the effective sensor angle is the stored one in radians (clamped to the slider's range)", () => {
    const raw: StrainRawValues = { nutrient: 0, excite: 0, sensor: 0, turn: 0, stride: 0, stain: 0, angle: 60, life: LIFE_DEFAULT };
    const drive: StrainDriveValues = { nutrient: 0, excite: 0, sensor: 0, turn: 0, stride: 0, stain: 0 };
    expect(resolveStrainEffective(0, raw, drive).sensorAngleRad).toBeCloseTo(60 * (Math.PI / 180), 9);
    expect(resolveStrainEffective(0, { ...raw, angle: 999 }, drive).sensorAngleRad).toBeCloseTo(ANGLE_MAX_DEG * (Math.PI / 180), 9);
  });

  it("Trail life defaults to the shared decay exactly and right = a longer-lived trail", () => {
    for (let k = 0; k < SPECIES_COUNT; k++) {
      const spec = settings.find((s) => s.key === `life${k}`)!;
      expect(spec.item).toEqual({ family: "strain", index: k, param: "life" });
      expect(spec.default).toBe(LIFE_DEFAULT);
    }
    expect(lifeToDecayMul(LIFE_DEFAULT)).toBe(1);
    expect(lifeToDecayMul(1)).toBeLessThan(1);
    expect(lifeToDecayMul(0)).toBeGreaterThan(1);
    expect(lifeToDecayMul(0.7)).toBeLessThan(lifeToDecayMul(0.4));
  });

  it("Switching is a Motion slider on by default; Synergy is a Look slider off by default (the stored stains are the look)", () => {
    const sw = settings.find((s) => s.key === "switching")!;
    expect(sw.group).toBe("Motion");
    expect(sw.default).toBe(SWITCHING_DEFAULT);
    const sy = settings.find((s) => s.key === "synergy")!;
    expect(sy.group).toBe("Look");
    expect(sy.default).toBe(0);
  });
});

describe("populationFromBlocks (Headcount's GPU count)", () => {
  it("averages the blocks' strain fractions and normalises to shares summing to 1", () => {
    // Two blocks: the first all strain 0, the second half strain 1 / half strain 2.
    const buf = [255, 0, 0, 0, 0, 128, 127, 0];
    const pop = populationFromBlocks(buf, 2, 4);
    expect(pop.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(pop[0]).toBeCloseTo(0.5, 2);
    expect(pop[1]).toBeCloseTo(0.25, 2);
    expect(pop[2]).toBeCloseTo(0.25, 2);
    expect(pop[3]).toBe(0);
  });

  it("falls back to an equal split for an empty buffer", () => {
    expect(populationFromBlocks([0, 0, 0, 0], 1, 4)).toEqual(equalPopulation(4));
  });

  it("gives the same shares from a fine, ragged-edged target as from a coarse one", () => {
    // The same agent field counted into a coarse and a fine grid of blocks:
    // strain 0 fills the left half, strain 1 a quarter, strain 2 the rest.
    // The fine grid's right-hand cells lie past the agent grid and write 0
    // (POP_FRAG skips texels outside it), like the ragged edge at small counts.
    const fill = (side: number, usedSide: number): Uint8Array => {
      const buf = new Uint8Array(side * side * 4);
      for (let y = 0; y < usedSide; y++)
        for (let x = 0; x < usedSide; x++) {
          const k = x < usedSide / 2 ? 0 : y < usedSide / 2 ? 1 : 2;
          buf[(y * side + x) * 4 + k] = 255;
        }
      return buf;
    };
    const coarse = populationFromBlocks(fill(32, 32), 32 * 32, 4);
    const fine = populationFromBlocks(fill(128, 100), 128 * 128, 4);
    for (let k = 0; k < 4; k++) expect(fine[k]).toBeCloseTo(coarse[k]!, 2);
    expect(fine[0]).toBeCloseTo(0.5, 2);
  });
});

describe("population bookkeeping (equalPopulation/applyInjection)", () => {
  it("equalPopulation splits evenly and sums to 1", () => {
    const pop = equalPopulation(4);
    expect(pop).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(pop.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("applyInjection moves exactly `dose` share into `strain`, keeping the total at 1", () => {
    const pop = equalPopulation(4);
    const next = applyInjection(pop, 2, 0.4);
    // Every strain (including 2) keeps (1-0.4) of its own share; strain 2
    // alone also gains the 0.4 that left everyone.
    expect(next[0]).toBeCloseTo(0.25 * 0.6, 9);
    expect(next[1]).toBeCloseTo(0.25 * 0.6, 9);
    expect(next[2]).toBeCloseTo(0.25 * 0.6 + 0.4, 9);
    expect(next[3]).toBeCloseTo(0.25 * 0.6, 9);
    expect(next.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("dose 0 is a no-op; dose 1 collapses everything onto the injected strain", () => {
    const pop = [0.5, 0.2, 0.2, 0.1];
    expect(applyInjection(pop, 1, 0)).toEqual(pop);
    expect(applyInjection(pop, 1, 1)).toEqual([0, 1, 0, 0]);
  });

  it("clamps a non-finite or out-of-range dose instead of producing NaN or a share outside [0,1]", () => {
    for (const dose of [NaN, -1, 5, Infinity, -Infinity]) {
      const next = applyInjection(equalPopulation(4), 0, dose);
      for (const p of next) {
        expect(Number.isFinite(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });

  it("repeated rebalance-then-inject round trips stay within [0,1] and sum to 1 over many draws", () => {
    let pop = equalPopulation(4);
    for (let i = 0; i < 50; i++) {
      pop = applyInjection(pop, i % 4, 0.1 + 0.05 * (i % 3));
      const sum = pop.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 6);
      for (const p of pop) {
        expect(p).toBeGreaterThanOrEqual(-1e-9);
        expect(p).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});

describe("classifyTerritory (Phase 3's territory readout)", () => {
  const SIDE = 16;
  const CELLS = SIDE * SIDE;

  function makeBuffer(fill: (i: number) => [number, number, number, number]): Uint8Array {
    const buf = new Uint8Array(CELLS * 4);
    for (let i = 0; i < CELLS; i++) {
      const [r, g, b, a] = fill(i);
      buf[i * 4] = r;
      buf[i * 4 + 1] = g;
      buf[i * 4 + 2] = b;
      buf[i * 4 + 3] = a;
    }
    return buf;
  }

  it("an all-zero buffer classifies nobody (every share 0)", () => {
    const buf = makeBuffer(() => [0, 0, 0, 0]);
    expect(classifyTerritory(buf, CELLS, 4)).toEqual([0, 0, 0, 0]);
  });

  it("a buffer split evenly by channel gives each strain exactly its own quarter", () => {
    const buf = makeBuffer((i) => {
      const k = i % 4;
      const px: [number, number, number, number] = [0, 0, 0, 0];
      px[k] = 200;
      return px;
    });
    const shares = classifyTerritory(buf, CELLS, 4);
    for (const s of shares) expect(s).toBeCloseTo(0.25, 9);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("a value at or below TERRITORY_THRESHOLD never counts toward anybody", () => {
    const buf = makeBuffer(() => [TERRITORY_THRESHOLD, 0, 0, 0]);
    expect(classifyTerritory(buf, CELLS, 4)).toEqual([0, 0, 0, 0]);
    const bufJustAbove = makeBuffer(() => [TERRITORY_THRESHOLD + 1, 0, 0, 0]);
    expect(classifyTerritory(bufJustAbove, CELLS, 4)[0]).toBeCloseTo(1, 9);
  });

  it("ties break toward the lowest index, and shares needn't sum to 1 when some cells are background", () => {
    const buf = makeBuffer((i) => (i === 0 ? [100, 100, 0, 0] : [0, 0, 0, 0]));
    const shares = classifyTerritory(buf, CELLS, 4);
    expect(shares[0]).toBeCloseTo(1 / CELLS, 9);
    expect(shares[1]).toBe(0);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1 / CELLS, 9);
  });
});

describe("screen -> field mapping (roomAspectJs/coverUvJs/uncoverUvJs)", () => {
  it("at the full viewport, roomAspect is just the device's own resolution aspect", () => {
    expect(roomAspectJs(1920, 1080, FULL_VIEWPORT)).toBeCloseTo(1920 / 1080, 9);
  });

  it("roomUvJs is the identity at the full viewport", () => {
    const uv = { x: 0.3, y: 0.7 };
    expect(roomUvJs(uv, FULL_VIEWPORT)).toEqual(uv);
  });

  it("uncoverUvJs is coverUvJs's exact inverse, for any aspect and any point", () => {
    const aspects = [0.2, 0.5, 1, 1.3333, 2, 3.5];
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.5, y: 0.5 },
      { x: 0.1, y: 0.9 },
      { x: -0.3, y: 1.6 }, // outside [0,1] is fine too — this is pure algebra
    ];
    for (const aspect of aspects) {
      for (const p of points) {
        const field = coverUvJs(p, aspect);
        const back = uncoverUvJs(field, aspect);
        expect(back.x).toBeCloseTo(p.x, 9);
        expect(back.y).toBeCloseTo(p.y, 9);
      }
    }
  });

  it("screenToFieldUv chains roomUvJs then coverUvJs (a Panorama slice, not just the full viewport)", () => {
    const viewport: Viewport = { x: 0.5, y: 0, w: 0.5, h: 1 };
    const uv = { x: 0.2, y: 0.6 };
    const expected = coverUvJs(roomUvJs(uv, viewport), roomAspectJs(800, 600, viewport));
    const actual = screenToFieldUv(uv, viewport, 800, 600);
    expect(actual.x).toBeCloseTo(expected.x, 9);
    expect(actual.y).toBeCloseTo(expected.y, 9);
  });
});

describe("Auto level (levelPeaks / levelGainsFull / levelGain)", () => {
  it("levelPeaks reads, per channel, the value the top share of blocks reach", () => {
    const cells = 100;
    const buf = new Uint8Array(cells * 4);
    for (let i = 0; i < cells; i++) {
      buf[i * 4] = i; // channel 0: 0..99 — top 5% reach 95
      buf[i * 4 + 1] = i < 3 ? 250 : 10; // channel 1: three hot blocks, the rest 10
      buf[i * 4 + 2] = 0; // channel 2: empty
      buf[i * 4 + 3] = 200; // channel 3: flat
    }
    const peaks = levelPeaks(buf, cells, 4, 0.05);
    expect(peaks[0]).toBeCloseTo(95 / 255, 9);
    // Three hot blocks are fewer than the top 5%: a lone hot spot doesn't set the level.
    expect(peaks[1]).toBeCloseTo(10 / 255, 9);
    expect(peaks[2]).toBe(0);
    expect(peaks[3]).toBeCloseTo(200 / 255, 9);
  });

  it("levelGainsFull evens equal peaks to exactly 1 and leaves the geometric mean unchanged", () => {
    for (const v of levelGainsFull([0.4, 0.4, 0.4, 0.4])) expect(v).toBeCloseTo(1, 12);
    const g = levelGainsFull([0.2, 0.4, 0.4, 0.8]);
    expect(g[0]).toBeGreaterThan(1);
    expect(g[3]).toBeLessThan(1);
    expect(g[0]! * g[1]! * g[2]! * g[3]!).toBeCloseTo(1, 9);
    // Every strain's peak lands on the same level.
    const levelled = [0.2, 0.4, 0.4, 0.8].map((p, k) => p * g[k]!);
    for (const v of levelled) expect(v).toBeCloseTo(levelled[0]!, 9);
  });

  it("clamps the gain, and floors an empty strain's peak so it can't blow up its grain", () => {
    const g = levelGainsFull([0, 0.9, 0.9, 0.9]);
    for (const v of g) {
      expect(v).toBeGreaterThanOrEqual(LEVEL_GAIN_MIN);
      expect(v).toBeLessThanOrEqual(LEVEL_GAIN_MAX);
    }
    for (const v of levelGainsFull([NaN, LEVEL_PEAK_FLOOR, LEVEL_PEAK_FLOOR, LEVEL_PEAK_FLOOR])) expect(v).toBeCloseTo(1, 12);
  });

  it("levelGain is exactly 1 at level 0 and the full gain at 1", () => {
    expect(levelGain(2.7, 0)).toBe(1);
    expect(levelGain(2.7, 1)).toBeCloseTo(2.7, 12);
    expect(levelGain(4, 0.5)).toBeCloseTo(2, 12);
  });
});

describe("Start ink (fillStartInk)", () => {
  it("is all zero at 0 — the old black start", () => {
    const buf = new Uint8Array(64 * 4).fill(7);
    fillStartInk(buf, 4, 0, () => 0.99);
    expect(buf.every((v) => v === 0)).toBe(true);
  });
  it("fills only the live channels, more at a higher setting", () => {
    let x = 1;
    const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647;
    const lo = new Uint8Array(1024 * 4);
    const hi = new Uint8Array(1024 * 4);
    fillStartInk(lo, 3, 0.2, rnd);
    fillStartInk(hi, 3, 1, rnd);
    const mean = (b: Uint8Array) => b.reduce((a, v) => a + v, 0) / b.length;
    expect(mean(hi)).toBeGreaterThan(mean(lo) * 2);
    for (let i = 3; i < hi.length; i += 4) expect(hi[i]).toBe(0);
  });
});

describe("Fogleman's extras: settings and motion presets", () => {
  const specs = physarum2Scene.settings!;
  const spec = (key: string) => specs.find((s) => s.key === key)!;

  it("Wander, Start ink and Auto level are plain rows with the documented defaults", () => {
    expect(spec("wander").default).toBe(0);
    expect(spec("wander").group).toBe("Form");
    expect(spec("startInk").default).toBe(START_INK_DEFAULT);
    expect(spec("level").default).toBe(LEVEL_DEFAULT);
    expect(spec("level").group).toBe("Look");
    for (const key of ["wander", "startInk", "level"]) {
      expect(spec(key).item).toBeUndefined();
      expect(spec(key).min).toBe(0);
      expect(spec(key).max).toBe(1);
    }
  });

  it("every motion preset sets every motion param for every strain, inside each slider's range", () => {
    for (const preset of MOTION_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.hint.length).toBeGreaterThan(0);
      for (const p of MOTION_PARAMS) {
        const values = preset.values[p];
        expect(values.length).toBe(SPECIES_COUNT);
        values.forEach((v, k) => {
          const s = spec(`${p}${k}`);
          expect(v).toBeGreaterThanOrEqual(s.min);
          expect(v).toBeLessThanOrEqual(s.max);
        });
      }
    }
    expect(new Set(MOTION_PRESETS.map((p) => p.name)).size).toBe(MOTION_PRESETS.length);
  });

  it("the Lab preset is the shipped default motion", () => {
    const lab = MOTION_PRESETS.find((p) => p.name === "Lab")!;
    for (const p of MOTION_PARAMS) {
      lab.values[p].forEach((v, k) => expect(v).toBeCloseTo(spec(`${p}${k}`).default, 9));
    }
  });
});
