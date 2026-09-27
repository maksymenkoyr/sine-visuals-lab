import { describe, it, expect } from "vitest";
import {
  physarum2TrailSide,
  stepAccumulator,
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

  it("Dose/Spread/Auto-inject from all sit in one contiguous Motion run with Crawl speed", () => {
    const motionKeys = settings.filter((s) => s.group === "Motion").map((s) => s.key);
    expect(motionKeys).toEqual(["speed", "seed", "seedSpread", "seedFrom"]);
  });
});

describe("resolveStrainEffective — the one strain-motion mapping (shared by the GPU packing and the specimen-box previews)", () => {
  const zeroRaw: StrainRawValues = { nutrient: 0, excite: 0, sensor: 0, turn: 0, stride: 0, stain: 0 };
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
