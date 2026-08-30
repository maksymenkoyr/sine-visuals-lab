import { describe, it, expect } from "vitest";
import {
  buildModeTable,
  createModeSelector,
  spectralCentroid,
  grainTextureSide,
  grainGain,
  holdSeconds,
  morphSeconds,
  MODE_TABLE,
  ENERGY_GATE,
  type ModeSelectorInputs,
} from "../src/render/scenes/chladni.ts";
import { qualitySettings } from "../src/render/quality.ts";

describe("chladni mode table", () => {
  it("only holds n < m pairs (n == m is identically zero for the antisymmetric family)", () => {
    for (const mode of buildModeTable(9)) {
      expect(mode.n).toBeLessThan(mode.m);
      expect(mode.n).toBeGreaterThanOrEqual(1);
    }
  });

  it("is sorted ascending by n^2 + m^2, the eigenfrequency proxy", () => {
    const table = buildModeTable(9);
    for (let i = 1; i < table.length; i++) {
      const prev = table[i - 1].n ** 2 + table[i - 1].m ** 2;
      const cur = table[i].n ** 2 + table[i].m ** 2;
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
  });

  it("alternates the symmetry-family sign down the table", () => {
    const table = buildModeTable(9);
    for (let i = 0; i < table.length; i++) {
      expect(table[i].sign).toBe(i % 2 === 0 ? -1 : 1);
    }
  });

  it("starts at the simplest figure, (1, 2)", () => {
    expect(MODE_TABLE[0]).toMatchObject({ n: 1, m: 2 });
  });
});

describe("spectralCentroid", () => {
  it("is 0 for silence rather than NaN", () => {
    expect(spectralCentroid(new Float32Array(24))).toBe(0);
  });

  it("is 0 for pure bass and 1 for pure treble", () => {
    const bass = new Float32Array(24);
    bass[0] = 1;
    const treble = new Float32Array(24);
    treble[23] = 1;
    expect(spectralCentroid(bass)).toBe(0);
    expect(spectralCentroid(treble)).toBe(1);
  });

  it("is 0.5 for a flat spectrum", () => {
    expect(spectralCentroid(new Float32Array(24).fill(0.3))).toBeCloseTo(0.5, 10);
  });
});

describe("grain texture sizing", () => {
  it.each(["high", "mid", "low", "floor"] as const)("side^2 holds every grain at quality %s", (preset) => {
    const count = qualitySettings(preset).maxParticles;
    const side = grainTextureSide(count);
    expect(side * side).toBeGreaterThanOrEqual(count);
    expect((side - 1) * (side - 1)).toBeLessThan(count);
  });

  it("gain is 1 at the reference count and larger for sparser beds", () => {
    expect(grainGain(50_000)).toBeCloseTo(1, 10);
    expect(grainGain(4_000)).toBeGreaterThan(grainGain(200_000));
    expect(grainGain(1)).toBe(3);
    expect(grainGain(1e9)).toBe(0.5);
  });
});

describe("setting curves", () => {
  it("hold spans 0.5s..8s across the slider", () => {
    expect(holdSeconds(0)).toBeCloseTo(0.5, 10);
    expect(holdSeconds(1)).toBeCloseTo(8, 10);
  });

  it("morph is slow at 0 and a near-snap at 1", () => {
    expect(morphSeconds(0)).toBeCloseTo(3, 10);
    expect(morphSeconds(1)).toBeLessThan(0.15);
    expect(morphSeconds(0.5)).toBeLessThan(morphSeconds(0));
  });
});

function inputs(overrides: Partial<ModeSelectorInputs> = {}): ModeSelectorInputs {
  return {
    centroid: 0.5,
    energy: 0.5,
    beat: false,
    tempoLocked: false,
    dropOnset: false,
    complexity: 1,
    holdSec: 1,
    morphSec: 0.5,
    ...overrides,
  };
}

describe("mode selector", () => {
  const dt = 1 / 60;

  it("starts fully on A with A === B", () => {
    const sel = createModeSelector(MODE_TABLE, 2);
    const s = sel.advance(dt, inputs({ centroid: 0 }));
    expect(s.blend).toBe(1);
    expect(s.index).toBe(2);
  });

  it("holds through centroid jitter inside the hold time", () => {
    const sel = createModeSelector(MODE_TABLE, 2);
    for (let t = 0; t < 0.9; t += dt) {
      const s = sel.advance(dt, inputs({ centroid: t % 0.1 < 0.05 ? 0.9 : 0.1, holdSec: 1 }));
      expect(s.index).toBe(2);
      expect(s.blend).toBe(1);
    }
  });

  it("switches once the hold expires, moving at most a few entries toward the target", () => {
    const sel = createModeSelector(MODE_TABLE, 0);
    // Feed a high centroid long enough for the eased pitch to land there.
    let s = sel.state;
    for (let t = 0; t < 1.2; t += dt) s = sel.advance(dt, inputs({ centroid: 1, holdSec: 1 }));
    expect(s.blend).toBeLessThan(1); // a transition is under way
    expect(s.index).toBe(0); // A is still shown while morphing
    for (let t = 0; t < 0.5; t += dt) s = sel.advance(dt, inputs({ centroid: 1, holdSec: 1 }));
    expect(s.blend).toBe(1);
    expect(s.index).toBeGreaterThan(0);
    expect(s.index).toBeLessThanOrEqual(3);
    expect(s.a).toBe(s.b);
  });

  it("with a tempo locked, waits for a beat before switching", () => {
    const sel = createModeSelector(MODE_TABLE, 0);
    let s = sel.state;
    for (let t = 0; t < 1.5; t += dt) s = sel.advance(dt, inputs({ centroid: 1, holdSec: 1, tempoLocked: true }));
    expect(s.blend).toBe(1);
    expect(s.index).toBe(0);
    s = sel.advance(dt, inputs({ centroid: 1, holdSec: 1, tempoLocked: true, beat: true }));
    expect(s.blend).toBeLessThan(1);
  });

  it("with a tempo locked but no beats arriving, switches anyway after a couple of holds", () => {
    const sel = createModeSelector(MODE_TABLE, 0);
    let s = sel.state;
    for (let t = 0; t < 2.5; t += dt) s = sel.advance(dt, inputs({ centroid: 1, holdSec: 1, tempoLocked: true }));
    expect(s.blend).toBeLessThan(1);
  });

  it("blend reaches 1 after the morph duration, then A becomes B", () => {
    const sel = createModeSelector(MODE_TABLE, 0);
    let s = sel.state;
    for (let t = 0; t < 1.2; t += dt) s = sel.advance(dt, inputs({ centroid: 1, holdSec: 1, morphSec: 0.5 }));
    const target = s.b;
    expect(s.blend).toBeLessThan(1);
    s = sel.advance(0.5, inputs({ centroid: 1, holdSec: 1, morphSec: 0.5 }));
    expect(s.blend).toBe(1);
    expect(s.a).toBe(target);
  });

  it("a drop leaps immediately, ignoring the hold", () => {
    const sel = createModeSelector(MODE_TABLE, 5);
    const s = sel.advance(dt, inputs({ centroid: 1, holdSec: 8, dropOnset: true }));
    expect(s.blend).toBeLessThan(1);
    expect(MODE_TABLE.indexOf(s.b)).toBe(9);
  });

  it("never re-tunes while the plate isn't being driven", () => {
    const sel = createModeSelector(MODE_TABLE, 2);
    let s = sel.state;
    for (let t = 0; t < 5; t += dt) {
      s = sel.advance(dt, inputs({ centroid: 1, holdSec: 0.5, energy: ENERGY_GATE / 2, dropOnset: true }));
    }
    expect(s.index).toBe(2);
    expect(s.blend).toBe(1);
  });

  it("stays inside the table at both complexity extremes", () => {
    for (const complexity of [0, 1]) {
      for (const centroid of [0, 1]) {
        const sel = createModeSelector(MODE_TABLE, 20);
        let s = sel.state;
        for (let t = 0; t < 60; t += 0.1) s = sel.advance(0.1, inputs({ centroid, complexity, holdSec: 0.5, morphSec: 0.1 }));
        expect(s.index).toBeGreaterThanOrEqual(0);
        expect(s.index).toBeLessThanOrEqual(MODE_TABLE.length - 1);
        if (complexity === 0) expect(s.index).toBe(0);
        if (complexity === 1 && centroid === 1) expect(s.index).toBe(MODE_TABLE.length - 1);
      }
    }
  });
});
