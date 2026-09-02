import { describe, it, expect } from "vitest";
import {
  buildModeTable,
  createPlateResponse,
  modeFrequencyHz,
  bandPosition,
  ringSeconds,
  grainTextureSide,
  grainGain,
  drawnGrainCount,
  MAX_BED_COVERAGE,
  MODE_TABLE,
  ACTIVE_MODES,
  FUNDAMENTAL_HZ_SMALL,
  FUNDAMENTAL_HZ_LARGE,
  type PlateResponseInputs,
} from "../src/render/scenes/chladni.ts";
import { qualitySettings } from "../src/render/quality.ts";
import { MIN_HZ, MAX_HZ_CAP } from "../src/audio/bandScale.ts";
import { NUM_BANDS } from "../src/audio/types.ts";

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

  it("starts at the fundamental, (1, 2)", () => {
    expect(MODE_TABLE[0]).toMatchObject({ n: 1, m: 2 });
  });
});

describe("mode resonances", () => {
  it("the fundamental sits at FUNDAMENTAL_HZ_SMALL on the smallest plate and at FUNDAMENTAL_HZ_LARGE on the largest", () => {
    expect(modeFrequencyHz(MODE_TABLE[0], 0)).toBeCloseTo(FUNDAMENTAL_HZ_SMALL, 6);
    expect(modeFrequencyHz(MODE_TABLE[0], 1)).toBeCloseTo(FUNDAMENTAL_HZ_LARGE, 6);
  });

  it("rises monotonically down the table at any plate size", () => {
    for (const complexity of [0, 0.5, 1]) {
      for (let i = 1; i < MODE_TABLE.length; i++) {
        expect(modeFrequencyHz(MODE_TABLE[i], complexity)).toBeGreaterThanOrEqual(
          modeFrequencyHz(MODE_TABLE[i - 1], complexity),
        );
      }
    }
  });

  it("bandPosition maps the ladder's ends to 0 and NUM_BANDS", () => {
    expect(bandPosition(MIN_HZ)).toBeCloseTo(0, 10);
    expect(bandPosition(MAX_HZ_CAP)).toBeCloseTo(NUM_BANDS, 10);
  });

  it("ring spans its documented range", () => {
    expect(ringSeconds(0)).toBeCloseTo(0.1, 10);
    expect(ringSeconds(1)).toBeCloseTo(1.5, 10);
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
    expect(grainGain(200_000)).toBeCloseTo(1, 10);
    expect(grainGain(12_000)).toBeGreaterThan(grainGain(200_000));
    expect(grainGain(1)).toBe(6);
    expect(grainGain(1e9)).toBe(0.5);
  });
});

describe("bed coverage", () => {
  it("draws every grain when the bed is far under the coverage cap", () => {
    const count = qualitySettings("floor").maxParticles;
    // A tiny plate and a modest grain size: nowhere near MAX_BED_COVERAGE.
    expect(drawnGrainCount(count, 4, 1920 * 1080)).toBe(count);
  });

  it("thins the bed once coverage would exceed the cap, roughly as 1/size^2", () => {
    const count = qualitySettings("high").maxParticles;
    const platePx2 = 1920 * 1080;
    const small = drawnGrainCount(count, 4, platePx2);
    const big = drawnGrainCount(count, 40, platePx2);
    expect(big).toBeLessThan(small);
    // Doubling grain diameter should roughly quarter the drawn count once
    // both points are bound by the cap rather than by `count` itself.
    const a = drawnGrainCount(count, 20, platePx2);
    const b = drawnGrainCount(count, 40, platePx2);
    expect(a).toBeLessThan(count);
    expect(b / a).toBeCloseTo(0.25, 1);
  });

  it("never draws more than count or fewer than one grain", () => {
    expect(drawnGrainCount(200_000, 1000, 1920 * 1080)).toBeGreaterThanOrEqual(1);
    expect(drawnGrainCount(200_000, 0.01, 1920 * 1080)).toBe(200_000);
    expect(drawnGrainCount(1, 1000, 1920 * 1080)).toBe(1);
  });

  it("is monotonically non-increasing in grain size", () => {
    const count = qualitySettings("high").maxParticles;
    const platePx2 = 3840 * 2160;
    let prev = drawnGrainCount(count, 0.5, platePx2);
    for (let size = 1; size <= 60; size += 1) {
      const drawn = drawnGrainCount(count, size, platePx2);
      expect(drawn).toBeLessThanOrEqual(prev);
      prev = drawn;
    }
  });

  it("the covered area at the returned count never exceeds MAX_BED_COVERAGE by more than one grain", () => {
    const count = qualitySettings("high").maxParticles;
    const platePx2 = 1920 * 1080;
    for (const grainPx of [10, 20, 30, 50]) {
      const drawn = drawnGrainCount(count, grainPx, platePx2);
      const areaPerGrain = (Math.PI / 4) * grainPx * grainPx * (1 + 0.5 ** 2 / 12);
      if (drawn < count) {
        expect((drawn * areaPerGrain) / platePx2).toBeLessThanOrEqual(MAX_BED_COVERAGE + 1e-6);
      }
    }
  });
});

function inputs(overrides: Partial<PlateResponseInputs> = {}): PlateResponseInputs {
  return { complexity: 1, resonance: 0.6, ring: 0.4, ...overrides };
}

/** Bands with all the energy in one band. */
function tone(band: number, level = 1): Float32Array {
  const b = new Float32Array(NUM_BANDS);
  b[band] = level;
  return b;
}

const SILENCE = new Float32Array(NUM_BANDS);

function run(response: ReturnType<typeof createPlateResponse>, bands: Float32Array, seconds: number, inp = inputs()) {
  const dt = 1 / 60;
  let modes = response.advance(0, bands, inp);
  for (let t = 0; t < seconds; t += dt) modes = response.advance(dt, bands, inp);
  return modes;
}

describe("plate response", () => {
  it("starts on the fundamental alone and holds it through silence", () => {
    const r = createPlateResponse();
    const modes = run(r, SILENCE, 2);
    expect(modes).toHaveLength(ACTIVE_MODES);
    expect(modes[0]).toMatchObject({ n: 1, m: 2, weight: 1 });
    for (let k = 1; k < ACTIVE_MODES; k++) expect(modes[k].weight).toBe(0);
  });

  it("weights always sum to 1", () => {
    const r = createPlateResponse();
    for (const band of [0, 7, 15, 23]) {
      const modes = run(r, tone(band), 1);
      const sum = modes.reduce((s, m) => s + m.weight, 0);
      expect(sum).toBeCloseTo(1, 6);
      expect(modes[0].weight).toBeGreaterThanOrEqual(modes[ACTIVE_MODES - 1].weight);
    }
  });

  it("a bass tone on a big plate rings the fundamental; a treble tone on a small plate rings a fine mode", () => {
    const bass = run(createPlateResponse(), tone(0), 1, inputs({ complexity: 1 }));
    expect(bass[0]).toMatchObject({ n: 1, m: 2 });

    const treble = run(createPlateResponse(), tone(NUM_BANDS - 1), 1, inputs({ complexity: 0 }));
    const idx = MODE_TABLE.findIndex((m) => m.n === treble[0].n && m.m === treble[0].m);
    expect(idx).toBeGreaterThan(MODE_TABLE.length / 2);
  });

  it("the same mid tone rings a low mode on a small plate and a fine mode on a big one", () => {
    const mid = 12; // ~800 Hz
    const small = run(createPlateResponse(), tone(mid), 1, inputs({ complexity: 0 }));
    const big = run(createPlateResponse(), tone(mid), 1, inputs({ complexity: 1 }));
    const idxOf = (m: { n: number; m: number }) => MODE_TABLE.findIndex((t) => t.n === m.n && t.m === m.m);
    expect(idxOf(small[0])).toBeLessThan(4);
    expect(idxOf(big[0])).toBeGreaterThan(MODE_TABLE.length / 2);
  });

  it("a tone off the end of the plate's range barely rings anything — the figure holds", () => {
    // A big plate's finest mode sits near 1.2 kHz; a 14 kHz tone is far past it.
    const r = createPlateResponse();
    const modes = run(r, tone(NUM_BANDS - 1), 1, inputs({ complexity: 1 }));
    expect(Math.max(...r.amplitudes)).toBeLessThan(1e-3);
    expect(modes[0]).toMatchObject({ n: 1, m: 2, weight: 1 });
  });

  it("a sharper resonance hands the dominant mode a bigger share", () => {
    const damped = run(createPlateResponse(), tone(10), 1, inputs({ resonance: 0 }));
    const sharp = run(createPlateResponse(), tone(10), 1, inputs({ resonance: 1 }));
    expect(sharp[0].weight).toBeGreaterThan(damped[0].weight);
  });

  it("keeps ringing after the tone stops, decaying over the Ring time, and the figure holds", () => {
    const r = createPlateResponse();
    const during = run(r, tone(10), 1);
    const held = { n: during[0].n, m: during[0].m };
    const peak = Math.max(...r.amplitudes);
    const after = run(r, SILENCE, 0.5);
    expect(Math.max(...r.amplitudes)).toBeLessThan(peak);
    expect(Math.max(...r.amplitudes)).toBeGreaterThan(0);
    expect(after[0]).toMatchObject(held);
  });

  it("a longer Ring decays slower", () => {
    const short = createPlateResponse();
    run(short, tone(10), 1, inputs({ ring: 0 }));
    run(short, SILENCE, 0.3, inputs({ ring: 0 }));
    const long = createPlateResponse();
    run(long, tone(10), 1, inputs({ ring: 1 }));
    run(long, SILENCE, 0.3, inputs({ ring: 1 }));
    expect(Math.max(...long.amplitudes)).toBeGreaterThan(Math.max(...short.amplitudes));
  });

  it("moves to a new figure when the tone moves", () => {
    // Default plate (complexity 0.5) spans roughly 150 Hz .. 4.4 kHz; both
    // tones sit inside that.
    const r = createPlateResponse();
    const first = run(r, tone(6), 1, inputs({ complexity: 0.5 }));
    const held = { n: first[0].n, m: first[0].m };
    const second = run(r, tone(17), 2, inputs({ complexity: 0.5 }));
    expect(second[0]).not.toMatchObject(held);
  });
});
